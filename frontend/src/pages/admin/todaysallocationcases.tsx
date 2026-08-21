// src/pages/admin/todaysallocationcases.tsx
//
// "Cases" tab on the Today's Allocation page (see manualallocation.tsx).
// Shows every case (from the Case Register / service_cases table) for a
// chosen service + date, with a per-row dropdown to MANUALLY allocate a
// case to one employee, plus a "Smart Allocation" button that AUTO
// allocates every still-pending case for that service/date as evenly as
// possible across whoever was marked Present on the Employees tab
// (todaysallocationemployees.tsx) — same `attendance` table Daily Work's
// own Smart Allocation already reads.
//
// Completely separate from the original quantity-based "Allocate" tab
// in manualallocation.tsx — nothing here touches daily_work batches or
// the existing `allocations` table.

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 10;

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
type Employee = { id: string; name: string; employeeCode: string | null };
type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    allocationStatus: "PENDING" | "ALLOCATED";
};

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

type Props = {
    productId: string;
    onChangeProductId: (id: string) => void;
    workDate: string;
    onChangeWorkDate: (date: string) => void;
};

export default function TodaysAllocationCases({
    productId,
    onChangeProductId,
    workDate,
    onChangeWorkDate,
}: Props) {
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);

    const [cases, setCases] = useState<ServiceCase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "ALLOCATED">("");
    const [page, setPage] = useState(1);

    const [allocatingId, setAllocatingId] = useState<string | null>(null);
    // NEW: dropdown picks an employee but does NOT allocate immediately —
    // it's held here per case until the row's "Allocate" button is
    // clicked, so a stray/accidental dropdown click can't reassign a
    // case. Seeded from each case's current assignment when cases load
    // (see the sync effect below), so the dropdown shows the right value
    // even before anyone touches it.
    const [pendingSelection, setPendingSelection] = useState<Record<string, string>>({});
    const [autoRunning, setAutoRunning] = useState(false);
    const [autoResult, setAutoResult] = useState<{
        allocatedCount: number;
        perEmployee: { employeeId: string; employeeName: string | null; caseCount: number }[];
    } | null>(null);
    const [toast, setToast] = useState("");

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

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employees`);
            const json = await res.json();
            if (!res.ok) return;
            setEmployees(Array.isArray(json) ? json : json.data || []);
        } catch (err) {
            console.error("Failed to fetch employees:", err);
        }
    }, []);

    const fetchCases = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("pageSize", String(PAGE_SIZE));
            if (productId) params.set("productId", productId);
            if (workDate) params.set("workDate", workDate);
            if (statusFilter) params.set("allocationStatus", statusFilter);

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            const rows: ServiceCase[] = json.data || [];
            setCases(rows);
            // Seed the pending dropdown value from each row's current
            // assignment — only for rows not already tracked, so an
            // in-progress unsaved selection on a row already on screen
            // isn't clobbered by a refetch (e.g. after allocating a
            // different row).
            setPendingSelection((prev) => {
                const next = { ...prev };
                rows.forEach((c) => {
                    if (!(c.id in next)) next[c.id] = c.assignedEmployeeId || "";
                });
                return next;
            });
        } catch (err: any) {
            setError(err?.message || "Failed to load cases.");
        } finally {
            setLoading(false);
        }
    }, [page, productId, workDate, statusFilter]);

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
    }, [fetchProducts, fetchEmployees]);

    useEffect(() => {
        if (!productId && products.length > 0) onChangeProductId(products[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [products]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    useEffect(() => {
        setPage(1);
        setAutoResult(null);
    }, [productId, workDate, statusFilter]);

    const handleManualAllocate = async (caseId: string, employeeId: string) => {
        setAllocatingId(caseId);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${caseId}/allocate`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ employeeId: employeeId || null }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to allocate");
            setCases((prev) =>
                prev.map((c) =>
                    c.id === caseId
                        ? {
                              ...c,
                              assignedEmployeeId: json.data.assignedEmployeeId,
                              assignedEmployeeName: json.data.assignedEmployeeName,
                              allocationStatus: json.data.allocationStatus,
                          }
                        : c
                )
            );
            setPendingSelection((prev) => ({
                ...prev,
                [caseId]: json.data.assignedEmployeeId || "",
            }));
            return true;
        } catch (err: any) {
            showToast(err?.message || `Failed to allocate ${caseId}.`);
            return false;
        } finally {
            setAllocatingId(null);
        }
    };

    // NEW: single bottom "Allocate" button for the whole page — instead
    // of one button per row, it saves every row whose dropdown selection
    // actually changed from what's saved, in one click.
    const [bulkSaving, setBulkSaving] = useState(false);
    const changedCaseIds = cases
        .filter((c) => {
            const picked = pendingSelection[c.id] ?? (c.assignedEmployeeId || "");
            return picked !== (c.assignedEmployeeId || "");
        })
        .map((c) => c.id);

    const handleAllocateAll = async () => {
        if (changedCaseIds.length === 0) return;
        setBulkSaving(true);
        try {
            let okCount = 0;
            for (const caseId of changedCaseIds) {
                const ok = await handleManualAllocate(caseId, pendingSelection[caseId] ?? "");
                if (ok) okCount++;
            }
            if (okCount > 0) showToast(`${okCount} case(s) allocated.`);
        } finally {
            setBulkSaving(false);
        }
    };

    const handleAutoAllocate = async () => {
        if (!productId) {
            showToast("Select a service first.");
            return;
        }
        setAutoRunning(true);
        setAutoResult(null);
        try {
            // Present is the default for everyone — only skip an employee
            // if attendance for this date explicitly marks them ABSENT or
            // LEAVE. Nobody needs to be actively marked Present on the
            // Employees tab first; Smart Allocation just needs to know
            // who's NOT available.
            const attRes = await authFetch(`${API_BASE}/api/attendance?date=${workDate}`);
            const attJson = await attRes.json();
            if (!attRes.ok || !attJson.success)
                throw new Error(attJson?.message || "Failed to load attendance");
            const unavailableIds = new Set(
                (attJson.data || [])
                    .filter((a: any) => a.status === "ABSENT" || a.status === "LEAVE")
                    .map((a: any) => a.employeeId)
            );
            const presentIds = employees.filter((e) => !unavailableIds.has(e.id)).map((e) => e.id);

            if (presentIds.length === 0) {
                showToast("No employees available to allocate to.");
                return;
            }

            const res = await authFetch(`${API_BASE}/api/service-cases/auto-allocate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId, workDate, employeeIds: presentIds }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Auto allocation failed");
            setAutoResult(json.data);
            showToast(json.message || "Cases allocated.");
            setPage(1);
            // Auto-allocation reassigns many rows at once — drop any
            // stale pending dropdown selections so they reseed fresh
            // from the server on the next fetchCases().
            setPendingSelection({});
            fetchCases();
        } catch (err: any) {
            showToast(err?.message || "Auto allocation failed.");
        } finally {
            setAutoRunning(false);
        }
    };

    const pendingCount = cases.filter((c) => c.allocationStatus === "PENDING").length;

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                <div style={styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div style={styles.headerIcon}>
                            <i
                                className="ti ti-list-numbers"
                                style={{ fontSize: fontSize["4xl"] }}
                            />
                        </div>
                        <div>
                            <h1 style={styles.pageTitle}>Cases</h1>
                            <p style={styles.headerSubtext}>
                                Every logged case for the selected service/date — allocate each one
                                manually below, or run Smart Allocation to split all pending cases
                                equally across every employee (except anyone marked Absent or Leave
                                on the Employees tab).
                            </p>
                        </div>
                    </div>
                </div>

                <div style={styles.filterBar}>
                    <div>
                        <label style={styles.label}>Service</label>
                        <select
                            style={styles.select}
                            value={productId}
                            onChange={(e) => onChangeProductId(e.target.value)}
                        >
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={styles.label}>Date</label>
                        <input
                            type="date"
                            style={styles.select}
                            value={workDate}
                            onChange={(e) => onChangeWorkDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label style={styles.label}>Status</label>
                        <select
                            style={styles.select}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                        >
                            <option value="">All</option>
                            <option value="PENDING">Pending</option>
                            <option value="ALLOCATED">Allocated</option>
                        </select>
                    </div>
                    <button
                        type="button"
                        style={{
                            ...styles.autoBtn,
                            opacity: autoRunning || pendingCount === 0 ? 0.6 : 1,
                        }}
                        disabled={autoRunning || pendingCount === 0}
                        onClick={handleAutoAllocate}
                        title={
                            pendingCount === 0
                                ? "No pending cases on this page"
                                : "Smart Allocation"
                        }
                    >
                        <i className="ti ti-bolt" />
                        {autoRunning ? "Allocating…" : "Smart Allocation"}
                    </button>
                </div>

                {autoResult && (
                    <div style={styles.autoSummary}>
                        <strong>{autoResult.allocatedCount}</strong> case(s) allocated across{" "}
                        {autoResult.perEmployee.length} employee(s):{" "}
                        {autoResult.perEmployee
                            .map((e) => `${e.employeeName || "Unknown"} (${e.caseCount})`)
                            .join(", ")}
                    </div>
                )}

                {error && <p style={styles.errorText}>{error}</p>}

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <span style={styles.colCase}>Case #</span>
                        <span style={styles.colService}>Service</span>
                        <span style={styles.colDate}>Date</span>
                        <span style={styles.colStatus}>Status</span>
                        <span style={styles.colAssign}>Allocate to</span>
                    </div>
                    {loading ? (
                        <div style={styles.emptyNote}>Loading cases…</div>
                    ) : cases.length === 0 ? (
                        <div style={styles.emptyNote}>No cases found for this filter.</div>
                    ) : (
                        cases.map((c) => (
                            <div key={c.id} style={styles.tableRow}>
                                <span style={styles.colCase}>{c.caseNumber}</span>
                                <span style={styles.colService}>{c.productName || "—"}</span>
                                <span style={styles.colDate}>{c.workDate}</span>
                                <span style={styles.colStatus}>
                                    <span
                                        style={{
                                            ...styles.statusPill,
                                            background:
                                                c.allocationStatus === "ALLOCATED"
                                                    ? "rgba(var(--brand-green-rgb),0.12)"
                                                    : "rgba(156,163,175,0.15)",
                                            color:
                                                c.allocationStatus === "ALLOCATED"
                                                    ? BRAND.green
                                                    : BRAND.grey,
                                        }}
                                    >
                                        {c.allocationStatus === "ALLOCATED"
                                            ? "Allocated"
                                            : "Pending"}
                                    </span>
                                </span>
                                <span style={styles.colAssign}>
                                    <select
                                        style={styles.assignSelect}
                                        value={
                                            pendingSelection[c.id] ?? (c.assignedEmployeeId || "")
                                        }
                                        disabled={allocatingId === c.id || bulkSaving}
                                        onChange={(e) =>
                                            setPendingSelection((prev) => ({
                                                ...prev,
                                                [c.id]: e.target.value,
                                            }))
                                        }
                                    >
                                        <option value="">Unallocated</option>
                                        {employees.map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.name}
                                            </option>
                                        ))}
                                    </select>
                                </span>
                            </div>
                        ))
                    )}
                    {!loading && cases.length > 0 && (
                        <div style={styles.bulkAllocateRow}>
                            <button
                                type="button"
                                style={{
                                    ...styles.allocateAllBtn,
                                    opacity: bulkSaving || changedCaseIds.length === 0 ? 0.6 : 1,
                                }}
                                disabled={bulkSaving || changedCaseIds.length === 0}
                                onClick={handleAllocateAll}
                            >
                                <i className="ti ti-check" />
                                {bulkSaving
                                    ? "Allocating…"
                                    : changedCaseIds.length > 0
                                      ? `Allocate (${changedCaseIds.length})`
                                      : "Allocate"}
                            </button>
                        </div>
                    )}
                    <div style={styles.paginationRow}>
                        <button
                            type="button"
                            style={styles.pageBtn}
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            <i className="ti ti-chevron-left" />
                        </button>
                        <span style={styles.pageIndicator}>Page {page}</span>
                        <button
                            type="button"
                            style={styles.pageBtn}
                            disabled={cases.length < PAGE_SIZE}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            <i className="ti ti-chevron-right" />
                        </button>
                    </div>
                </div>
            </div>

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
    headerRow: { display: "flex", alignItems: "center" },
    headerLeft: { display: "flex", alignItems: "center", gap: 14 },
    headerIcon: {
        width: 48,
        height: 48,
        borderRadius: radius.md,
        background: "rgba(var(--brand-blue-rgb),0.08)",
        color: BRAND.blue,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["4xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },
    headerSubtext: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92", maxWidth: 640 },
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
    },
    autoBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.3)",
    },
    autoSummary: {
        padding: "10px 16px",
        borderRadius: radius.sm,
        background: "rgba(var(--brand-green-rgb),0.08)",
        color: "#17181C",
        fontSize: fontSize.sm,
    },
    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },
    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflow: "hidden",
    },
    tableHeadRow: {
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
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
        padding: "10px 20px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
    },
    colCase: { width: 120, flexShrink: 0, fontWeight: fontWeight.medium },
    colService: { flex: 1, minWidth: 0 },
    colDate: { width: 100, flexShrink: 0 },
    colStatus: { width: 110, flexShrink: 0 },
    colAssign: { width: 220, flexShrink: 0, textAlign: "right" },
    statusPill: {
        display: "inline-flex",
        padding: "3px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    assignSelect: {
        width: "100%",
        padding: "7px 10px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
    },
    // Single "Allocate" button below the whole list — saves every row
    // whose dropdown selection differs from what's saved, in one click,
    // instead of a button per row.
    bulkAllocateRow: {
        display: "flex",
        justifyContent: "flex-end",
        padding: "14px 20px",
        borderTop: "1px solid #f1f1f1",
    },
    allocateAllBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "9px 20px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    emptyNote: {
        padding: "28px 20px",
        textAlign: "center",
        color: "#9ca3af",
        fontSize: fontSize.base,
    },
    paginationRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "14px 20px",
        borderTop: "1px solid #f1f1f1",
    },
    pageBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#374151",
        cursor: "pointer",
    },
    pageIndicator: { fontSize: fontSize.sm, color: "#374151", fontWeight: fontWeight.medium },
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
