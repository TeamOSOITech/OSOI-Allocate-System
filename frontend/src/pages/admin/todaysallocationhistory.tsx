// src/pages/admin/todaysallocationhistory.tsx
//
// "History" tab on the Today's Allocation page (see manualallocation.tsx).
// The Allocate/Cases/Employees tabs only ever show ONE date at a time (the
// date picked in the filter bar) — there was no single place to see every
// day's allocation (including today) at a glance across dates. This tab
// lists every service + date combination that has logged CASES
// (service_cases rows), newest first, with Total/Allocated/Pending
// counted by CASE NUMBER (rows in service_cases) instead of the old
// daily_work batch's quantity fields — case creation doesn't touch
// daily_work at all, so a batch-based list was both the wrong basis for
// the numbers and could miss dates that only ever had cases logged (no
// batch ever created for them).
//
// Styled to match the Cases tab (todaysallocationcases.tsx) — same
// flex-based table row layout, column padding/gap, and font sizes —
// instead of the CSS-grid layout this used before, so the two tabs look
// like one consistent page.
//
// A per-row "Clear" button unassigns every ALLOCATED case in that
// service+date group back to Pending (same as the Cases tab's own
// "Clear" button, just scoped to a specific date picked from this list
// instead of whatever date happens to be selected on the Cases tab) — it
// does NOT delete the case rows themselves, only their allocation.
//
// Reuses existing endpoints only, no backend changes:
//   GET   /api/service-cases?page=&pageSize=100   (looped across every
//                                                   page to build the
//                                                   full case list, then
//                                                   grouped client-side
//                                                   by productId+workDate)
//   PATCH /api/service-cases/:id/allocate         (employeeId: null,
//                                                   same as Cases tab's
//                                                   Clear)

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = { id: string; product_name: string };
type CaseRow = {
    id: string;
    productId: string;
    productName: string | null;
    workDate: string;
    allocationStatus: "PENDING" | "ALLOCATED";
};
// One row here = every case for a given service+date, rolled up into
// counts — replaces the old one-row-per-daily_work-batch shape.
type HistoryGroup = {
    key: string; // `${productId}__${workDate}`
    workDate: string;
    productId: string;
    productName: string | null;
    total: number;
    allocated: number;
    pending: number;
};

function formatDisplayDate(iso: string) {
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

export default function TodaysAllocationHistory() {
    const [products, setProducts] = useState<Product[]>([]);
    const [groups, setGroups] = useState<HistoryGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");

    const [productFilter, setProductFilter] = useState("");
    const [searchText, setSearchText] = useState("");

    // Clicking "Clear" opens a confirmation popup instead of unassigning
    // right away — confirmTarget holds the group waiting on that popup.
    const [confirmTarget, setConfirmTarget] = useState<HistoryGroup | null>(null);
    const [clearingKey, setClearingKey] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    const fetchProducts = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await res.json();
            if (res.ok) setProducts(json.data || []);
        } catch (err) {
            console.error("Failed to fetch products:", err);
        }
    }, []);

    // Loops every page of /api/service-cases (org-wide, no filters) and
    // rolls the rows up into one HistoryGroup per productId+workDate —
    // there's no backend aggregate endpoint for this, so the grouping
    // happens client-side. Fine at typical case volumes; if this ever
    // gets slow for an org with a very large case history, the right
    // fix is a dedicated GROUP BY endpoint rather than more looping here.
    const fetchCaseHistory = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const pageSize = 100;
            let page = 1;
            let totalPages = 1;
            const allRows: CaseRow[] = [];
            do {
                const params = new URLSearchParams();
                params.set("page", String(page));
                params.set("pageSize", String(pageSize));
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json.message || "Failed to load allocation history");
                allRows.push(...(json.data || []));
                totalPages = json.pagination?.totalPages || 1;
                page += 1;
            } while (page <= totalPages);

            const byKey = new Map<string, HistoryGroup>();
            allRows.forEach((c) => {
                const key = `${c.productId}__${c.workDate}`;
                const existing = byKey.get(key);
                if (existing) {
                    existing.total += 1;
                    if (c.allocationStatus === "ALLOCATED") existing.allocated += 1;
                } else {
                    byKey.set(key, {
                        key,
                        workDate: c.workDate,
                        productId: c.productId,
                        productName: c.productName,
                        total: 1,
                        allocated: c.allocationStatus === "ALLOCATED" ? 1 : 0,
                        pending: 0,
                    });
                }
            });
            byKey.forEach((g) => {
                g.pending = g.total - g.allocated;
            });

            setGroups(Array.from(byKey.values()));
        } catch (err: any) {
            setError(err.message || "Failed to load allocation history");
            setGroups([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
        fetchCaseHistory();
    }, [fetchProducts, fetchCaseHistory]);

    // Every service+date group with logged cases, newest date first —
    // includes today (no longer excluded), since the whole point of this
    // tab is now "every day's allocation in one list", not just past days.
    const filteredGroups = useMemo(() => {
        let list = groups;
        if (productFilter) list = list.filter((g) => g.productId === productFilter);
        const q = searchText.trim().toLowerCase();
        if (q) {
            list = list.filter((g) =>
                [g.productName, g.workDate].filter(Boolean).join(" ").toLowerCase().includes(q)
            );
        }
        return list.sort((a, b) => {
            if (a.workDate !== b.workDate) return b.workDate.localeCompare(a.workDate);
            return (a.productName || "").localeCompare(b.productName || "");
        });
    }, [groups, productFilter, searchText]);

    // Unassigns every currently-ALLOCATED case in this service+date group
    // back to Pending — same pattern as the Cases tab's own "Clear"
    // button (handleClearAllocations in todaysallocationcases.tsx), just
    // scoped to a past date picked from this list instead of whatever
    // date is selected there. Case rows themselves are never deleted.
    const handleClear = async (group: HistoryGroup) => {
        setConfirmTarget(null);
        setClearingKey(group.key);
        try {
            const allocatedIds: string[] = [];
            let fetchPage = 1;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const params = new URLSearchParams();
                params.set("page", String(fetchPage));
                params.set("pageSize", "100");
                params.set("productId", group.productId);
                params.set("workDate", group.workDate);
                params.set("allocationStatus", "ALLOCATED");
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json.message || "Failed to load allocated cases");
                const rows: CaseRow[] = json.data || [];
                allocatedIds.push(...rows.map((c) => c.id));
                const totalPages = Math.ceil((json.pagination?.total ?? rows.length) / 100);
                if (fetchPage >= totalPages || rows.length === 0) break;
                fetchPage += 1;
            }

            if (allocatedIds.length === 0) {
                showToast("Nothing allocated for this service/date.");
                return;
            }

            await Promise.all(
                allocatedIds.map((id) =>
                    authFetch(`${API_BASE}/api/service-cases/${id}/allocate`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ employeeId: null }),
                    })
                )
            );

            setGroups((prev) =>
                prev.map((g) =>
                    g.key === group.key ? { ...g, allocated: 0, pending: g.total } : g
                )
            );
            showToast(
                `Cleared ${allocatedIds.length} allocation(s) for ${group.productName || "this service"} on ${formatDisplayDate(group.workDate)} — back to Pending.`
            );
        } catch (err: any) {
            showToast(err?.message || "Failed to clear this group.");
        } finally {
            setClearingKey(null);
        }
    };

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                <div style={styles.headerRow}>
                    <div>
                        <h1 style={styles.pageTitle}>History</h1>
                        <p style={styles.headerSubtext}>
                            Every day's allocation (including today), service by service — Total,
                            Allocated and Pending are counted by case number. Clear here unassigns
                            every allocated case for that service/date back to Pending.
                        </p>
                    </div>
                </div>

                {error && <div style={styles.errorBanner}>{error}</div>}

                <div style={styles.filterBar}>
                    <div>
                        <label style={styles.label}>Service</label>
                        <select
                            style={styles.select}
                            value={productFilter}
                            onChange={(e) => setProductFilter(e.target.value)}
                        >
                            <option value="">All services</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                        <label style={styles.label}>Search</label>
                        <input
                            style={styles.select}
                            placeholder="Service or date…"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                    </div>
                </div>

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <span style={styles.colDate}>Date</span>
                        <span style={styles.colService}>Service</span>
                        <span style={styles.colNum}>Total</span>
                        <span style={styles.colNum}>Allocated</span>
                        <span style={styles.colNum}>Pending</span>
                        <span style={styles.colAction}>Actions</span>
                    </div>
                    {loading ? (
                        <div style={styles.emptyNote}>Loading history…</div>
                    ) : filteredGroups.length === 0 ? (
                        <div style={styles.emptyNote}>
                            No allocations logged yet — entries show up here as soon as cases are
                            logged for a service/date.
                        </div>
                    ) : (
                        filteredGroups.map((g) => {
                            const isClearing = clearingKey === g.key;
                            return (
                                <div key={g.key} style={styles.tableRow}>
                                    <span style={styles.colDate}>
                                        {formatDisplayDate(g.workDate)}
                                    </span>
                                    <span style={styles.colService}>{g.productName || "—"}</span>
                                    <span style={{ ...styles.colNum, ...styles.pillWrap }}>
                                        <span
                                            style={{
                                                ...styles.pill,
                                                background: "#eef2ff",
                                                color: BRAND.blue,
                                            }}
                                        >
                                            {g.total}
                                        </span>
                                    </span>
                                    <span style={{ ...styles.colNum, ...styles.pillWrap }}>
                                        <span
                                            style={{
                                                ...styles.pill,
                                                background: "#eaf7ec",
                                                color: "#1f7a34",
                                            }}
                                        >
                                            {g.allocated}
                                        </span>
                                    </span>
                                    <span style={{ ...styles.colNum, ...styles.pillWrap }}>
                                        <span
                                            style={{
                                                ...styles.pill,
                                                background: "#fef3e2",
                                                color: "#b45309",
                                            }}
                                        >
                                            {g.pending}
                                        </span>
                                    </span>
                                    <span style={styles.colAction}>
                                        <button
                                            type="button"
                                            disabled={isClearing || g.allocated === 0}
                                            onClick={() => setConfirmTarget(g)}
                                            style={{
                                                ...styles.clearBtn,
                                                opacity: isClearing || g.allocated === 0 ? 0.5 : 1,
                                                cursor:
                                                    isClearing || g.allocated === 0
                                                        ? "not-allowed"
                                                        : "pointer",
                                            }}
                                            title={
                                                g.allocated === 0
                                                    ? "Nothing allocated for this service/date"
                                                    : "Unassign every allocated case for this service/date back to Pending"
                                            }
                                        >
                                            <i
                                                className="ti ti-trash"
                                                style={{ fontSize: fontSize.sm }}
                                            />
                                            {isClearing ? "Clearing…" : "Clear"}
                                        </button>
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Confirmation popup — matches the app's other "Delete X?"
                modals (see servicecases.tsx) instead of an inline
                arm/confirm toggle, since this action is destructive and
                irreversible. */}
            {confirmTarget && (
                <div style={styles.overlay} onClick={() => setConfirmTarget(null)}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>
                                Clear {confirmTarget.productName || "this service"}?
                            </h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={() => setConfirmTarget(null)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />
                        <p style={styles.modalBody}>
                            This unassigns all <strong>{confirmTarget.allocated}</strong> allocated
                            case(s) for{" "}
                            <strong>{confirmTarget.productName || "this service"}</strong> on{" "}
                            {formatDisplayDate(confirmTarget.workDate)} back to Pending. You can
                            reassign them manually or re-run Smart Allocation on the Cases tab
                            afterwards.
                        </p>
                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={styles.modalCancelBtn}
                                onClick={() => setConfirmTarget(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={styles.modalDeleteBtn}
                                onClick={() => handleClear(confirmTarget)}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column" },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "left",
    },
    headerSubtext: {
        margin: "4px 0 0",
        fontSize: fontSize.base,
        color: "#767F92",
        maxWidth: 640,
        textAlign: "left",
    },
    errorBanner: {
        background: "#fef3e2",
        border: "1px solid #fde3b0",
        color: "#b45309",
        fontSize: fontSize.sm,
        padding: "9px 12px",
        borderRadius: radius.sm,
    },
    filterBar: { display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" },
    label: {
        display: "block",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
        margin: "0 0 6px",
        textAlign: "left",
    },
    select: {
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
        minWidth: 170,
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
    },
    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflow: "hidden",
    },
    // Matches the Cases tab's flex-based row layout (todaysallocationcases
    // tsx's tableHeadRow/tableRow) instead of the CSS-grid layout this
    // used before, so the two tabs read as one consistent table style.
    tableHeadRow: {
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "12px 20px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    tableRow: {
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "12px 20px",
        minHeight: 56,
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
    },
    colDate: { width: 100, flexShrink: 0, color: "#374151", textAlign: "left" },
    colService: {
        width: 200,
        flexShrink: 0,
        fontWeight: fontWeight.medium,
        color: "#1a1a2e",
        textAlign: "left",
    },
    colNum: { width: 90, flexShrink: 0, textAlign: "center" },
    colAction: {
        display: "flex",
        justifyContent: "flex-end",
        marginLeft: "auto",
        textAlign: "left",
    },
    pillWrap: { display: "flex" },
    pill: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        padding: "3px 9px",
        borderRadius: radius.pill,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
    },
    clearBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: radius.sm,
        border: `1px solid ${BRAND.red}`,
        background: "#fff",
        color: BRAND.red,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    },
    // Confirmation popup
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,17,25,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
    },
    modal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: "100%",
        maxWidth: 440,
        boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        overflow: "hidden",
    },
    modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 20px 14px",
    },
    modalTitle: {
        margin: 0,
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "center",
        flex: 1,
    },
    modalCloseBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: radius.circle,
        border: "none",
        background: "#f1f2f6",
        color: "#374151",
        cursor: "pointer",
        flexShrink: 0,
    },
    modalDivider: { height: 1, background: "#eef0f5" },
    modalBody: {
        margin: 0,
        padding: "18px 22px",
        fontSize: fontSize.base,
        color: "#374151",
        textAlign: "center",
        lineHeight: 1.6,
    },
    modalActions: {
        display: "flex",
        gap: 12,
        padding: "0 20px 20px",
    },
    modalCancelBtn: {
        flex: 1,
        padding: "12px 16px",
        borderRadius: radius.md,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: BRAND.blue,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    modalDeleteBtn: {
        flex: 1,
        padding: "12px 16px",
        borderRadius: radius.md,
        border: "none",
        background: BRAND.red,
        color: "#fff",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(220,38,38,0.3)",
    },
    emptyNote: {
        padding: "28px 20px",
        textAlign: "center",
        color: "#9ca3af",
        fontSize: fontSize.base,
    },
    toast: {
        position: "fixed",
        bottom: 24,
        right: 24,
        background: BRAND.blue,
        color: "#fff",
        padding: "12px 18px",
        borderRadius: radius.md,
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        zIndex: 1000,
    },
};
