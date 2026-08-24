// src/pages/admin/todaysallocationhistory.tsx
//
// "History" tab on the Today's Allocation page (see manualallocation.tsx).
// The Allocate/Cases/Employees tabs only ever show ONE date at a time (the
// date picked in the filter bar) — there was no single place to see every
// PAST day's allocation at a glance. This tab lists every daily_work batch
// (across all dates, newest first) except today's, with a per-row "Clear"
// button that PERMANENTLY DELETES that batch — both its allocations and
// the Daily Work entry itself. That's what actually unblocks deleting a
// service from Products/Services (it's blocked while any Daily Work batch
// still references it), not just resetting the allocated quantities.
//
// Reuses existing endpoints only, no backend changes:
//   GET    /api/daily-work                       (no ?date= -> every batch)
//   DELETE /api/allocations/by-daily-work/:id     (clears allocations —
//                                                   required first, since
//                                                   the backend blocks
//                                                   deleting a batch that
//                                                   still has allocations)
//   DELETE /api/daily-work/:id                    (deletes the batch row)

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
type Batch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
};

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso: string) {
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

export default function TodaysAllocationHistory() {
    const [products, setProducts] = useState<Product[]>([]);
    const [batches, setBatches] = useState<Batch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");

    const [productFilter, setProductFilter] = useState("");
    const [searchText, setSearchText] = useState("");

    // Clicking "Clear" opens a confirmation popup instead of deleting
    // right away — confirmTarget holds the batch waiting on that popup.
    const [confirmTarget, setConfirmTarget] = useState<Batch | null>(null);
    const [clearingId, setClearingId] = useState<string | null>(null);

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

    const fetchBatches = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            // No ?date= — returns every batch, newest work_date first.
            const res = await authFetch(`${API_BASE}/api/daily-work`);
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to load allocation history");
            setBatches(json.data || []);
        } catch (err: any) {
            setError(err.message || "Failed to load allocation history");
            setBatches([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
        fetchBatches();
    }, [fetchProducts, fetchBatches]);

    const today = todayStr();
    const pastBatches = useMemo(() => {
        let list = batches.filter((b) => b.workDate !== today);
        if (productFilter) list = list.filter((b) => b.productId === productFilter);
        const q = searchText.trim().toLowerCase();
        if (q) {
            list = list.filter((b) =>
                [b.productName, b.workDate].filter(Boolean).join(" ").toLowerCase().includes(q)
            );
        }
        return list;
    }, [batches, productFilter, searchText, today]);

    const handleClear = async (batch: Batch) => {
        setConfirmTarget(null);
        setClearingId(batch.id);
        try {
            // Step 1: clear allocations for this batch (daily-work delete
            // below is blocked by the backend while allocations exist).
            const clearRes = await authFetch(
                `${API_BASE}/api/allocations/by-daily-work/${batch.id}`,
                { method: "DELETE" }
            );
            const clearJson = await clearRes.json();
            if (!clearRes.ok || !clearJson.success)
                throw new Error(clearJson.message || "Failed to clear allocations");

            // Step 2: delete the Daily Work batch entry itself, so it no
            // longer blocks deleting the service from Products/Services.
            const delRes = await authFetch(`${API_BASE}/api/daily-work/${batch.id}`, {
                method: "DELETE",
            });
            const delJson = await delRes.json();
            if (!delRes.ok || !delJson.success)
                throw new Error(delJson.message || "Failed to delete Daily Work batch");

            setBatches((prev) => prev.filter((b) => b.id !== batch.id));
            showToast(
                `Deleted ${batch.productName || "service"} on ${formatDisplayDate(batch.workDate)} — allocations and the Daily Work entry are both gone.`
            );
        } catch (err: any) {
            showToast(err?.message || "Failed to clear this batch.");
        } finally {
            setClearingId(null);
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
                            Every past day's allocation, service by service — Clear here permanently
                            deletes that batch (allocations + the Daily Work entry itself), e.g. so
                            a service can be deleted from Products afterwards.
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
                    ) : pastBatches.length === 0 ? (
                        <div style={styles.emptyNote}>
                            No past allocations yet — today's entries will show up here once a new
                            day starts.
                        </div>
                    ) : (
                        pastBatches.map((b) => {
                            const isClearing = clearingId === b.id;
                            return (
                                <div key={b.id} style={styles.tableRow}>
                                    <span style={styles.colDate}>
                                        {formatDisplayDate(b.workDate)}
                                    </span>
                                    <span style={styles.colService}>{b.productName || "—"}</span>
                                    <span style={{ ...styles.colNum, ...styles.pillWrap }}>
                                        <span
                                            style={{
                                                ...styles.pill,
                                                background: "#eef2ff",
                                                color: BRAND.blue,
                                            }}
                                        >
                                            {b.totalQty}
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
                                            {b.allocatedQty}
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
                                            {b.pendingQty}
                                        </span>
                                    </span>
                                    <span style={styles.colAction}>
                                        <button
                                            type="button"
                                            disabled={isClearing}
                                            onClick={() => setConfirmTarget(b)}
                                            style={{
                                                ...styles.clearBtn,
                                                opacity: isClearing ? 0.5 : 1,
                                                cursor: isClearing ? "not-allowed" : "pointer",
                                            }}
                                            title="Permanently delete this batch (allocations + Daily Work entry)"
                                        >
                                            <i
                                                className="ti ti-trash"
                                                style={{ fontSize: fontSize.sm }}
                                            />
                                            {isClearing ? "Deleting…" : "Clear"}
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
                            Are you sure you want to clear{" "}
                            <strong>{confirmTarget.productName || "this service"}</strong> for{" "}
                            {formatDisplayDate(confirmTarget.workDate)}? This deletes its
                            allocations and the Daily Work entry itself — it can't be recovered.
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
        fontSize: fontSize["4xl"],
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
    },
    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflow: "hidden",
    },
    tableHeadRow: {
        display: "grid",
        gridTemplateColumns: "110px 1fr 90px 90px 90px 110px",
        alignItems: "center",
        columnGap: 12,
        padding: "10px 20px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    tableRow: {
        display: "grid",
        gridTemplateColumns: "110px 1fr 90px 90px 90px 110px",
        alignItems: "center",
        columnGap: 12,
        padding: "10px 20px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
    },
    colDate: { color: "#374151" },
    colService: { fontWeight: fontWeight.medium, color: "#1a1a2e" },
    colNum: {},
    colAction: { display: "flex", justifyContent: "flex-end" },
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
