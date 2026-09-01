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

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 10;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(
        typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
    );
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return isMobile;
}

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = { id: string; product_name: string; teams?: string[] };
type Employee = {
    id: string;
    name: string;
    employeeCode: string | null;
    team: string | null;
};
type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    subclientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    // NEW: who ran the allocate action (manual or Smart Allocation) —
    // separate from assignedEmployeeName, which is who the case landed
    // on. Shown as a small "by <name>" caption under the Assign dropdown.
    allocatedByName: string | null;
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
    // NEW: when true, hides this component's own title/subtext, its
    // Service/Date/Status filter row (incl. Smart Allocation + Clear
    // buttons), and the eligibility hint — used when this component is
    // embedded under another page's header/filters (see manualallocation
    // tsx's merged "Allocate" tab) so there's only one filter bar on
    // screen. Defaults to false so nothing changes for any other caller.
    hideHeader?: boolean;
    // NEW: fired after any action that changes a case's allocation
    // status (manual allocate, bulk "Allocate" button, Smart
    // Allocation, or Clear) — lets an embedding page (manualallocation
    // tsx's KPI cards, which count cases separately from this
    // component's own list) refetch its own counts instead of going
    // stale until the next productId/date change. Optional so nothing
    // breaks for any other caller.
    onCasesChanged?: () => void;
};

export default function TodaysAllocationCases({
    productId,
    onChangeProductId,
    workDate,
    onChangeWorkDate,
    hideHeader = false,
    onCasesChanged,
}: Props) {
    const isMobile = useIsMobile();
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
    // NEW: "Clear" button — unassigns every currently-ALLOCATED case for
    // the selected service+date back to Pending, so a bad Smart
    // Allocation run (e.g. wrong team, wrong day) can be undone right
    // here instead of hunting it down on the History tab.
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [clearing, setClearing] = useState(false);

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

    // FIX: re-fetch Products (with their Teams) and Employees whenever
    // the person switches the Service dropdown — not just once when this
    // tab first mounts. Without this, linking a Team to a service on the
    // Products/Services page mid-session wouldn't show up here until a
    // full page reload or a manual "Refresh" click, even after picking
    // that exact service again.
    useEffect(() => {
        if (!productId) return;
        fetchProducts();
        fetchEmployees();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productId]);

    useEffect(() => {
        if (!productId && products.length > 0) onChangeProductId(products[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [products]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    // Only employees whose Team is linked to the selected service
    // (Products/Services -> Teams multi-select) are eligible here — same
    // narrowing as the Employees tab. Falls back to every employee ONLY
    // when the service has no teams linked at all — if teams ARE linked
    // but zero employees currently have a matching Team, the list is
    // meant to come up empty rather than silently allocating to everyone
    // present.
    // FIX: match on String(p.id) === String(productId) — productId can
    // arrive here as a string from the <select>'s value while p.id (from
    // the API) may not always be, so a strict `===` could silently fail
    // to find the product and fall back to showing every employee even
    // though Teams ARE linked. Same defensive pattern already used for
    // this exact lookup in manualallocation.tsx.
    const selectedProduct = useMemo(
        () => products.find((p) => String(p.id) === String(productId)) || null,
        [products, productId]
    );
    const eligibleEmployees = useMemo(() => {
        const productTeams = (selectedProduct?.teams || [])
            .map((t) => (t || "").trim())
            .filter(Boolean);
        if (productTeams.length === 0) return employees;
        const allowed = new Set(productTeams.map((t) => t.toLowerCase()));
        return employees.filter((e) => e.team && allowed.has(e.team.trim().toLowerCase()));
    }, [employees, selectedProduct]);

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
            onCasesChanged?.();
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
            const presentIds = eligibleEmployees
                .filter((e) => !unavailableIds.has(e.id))
                .map((e) => e.id);

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
            onCasesChanged?.();
        } catch (err: any) {
            showToast(err?.message || "Auto allocation failed.");
        } finally {
            setAutoRunning(false);
        }
    };

    // Fetches every ALLOCATED case for the current service+date (looping
    // pages if there are more than fit in one, since the list endpoint
    // caps pageSize at 100) and unassigns each one back to Pending.
    const handleClearAllocations = async () => {
        setClearConfirmOpen(false);
        setClearing(true);
        try {
            const allocatedIds: string[] = [];
            let fetchPage = 1;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const params = new URLSearchParams();
                params.set("page", String(fetchPage));
                params.set("pageSize", "100");
                if (productId) params.set("productId", productId);
                if (workDate) params.set("workDate", workDate);
                params.set("allocationStatus", "ALLOCATED");
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json?.message || "Failed to load allocated cases");
                const rows: ServiceCase[] = json.data || [];
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

            showToast(`Cleared ${allocatedIds.length} allocation(s) — back to Pending.`);
            setAutoResult(null);
            setPendingSelection({});
            setPage(1);
            fetchCases();
            onCasesChanged?.();
        } catch (err: any) {
            showToast(err?.message || "Failed to clear allocations.");
        } finally {
            setClearing(false);
        }
    };

    const [refreshingLookups, setRefreshingLookups] = useState(false);
    // Manual refresh — Products/Employees are only fetched once when this
    // tab mounts, so editing a service's Teams (or an employee's Team) on
    // another page/tab while this one is still open won't show up until
    // this runs again. Lets that be a click instead of a full page reload.
    const refreshLookups = async () => {
        setRefreshingLookups(true);
        try {
            await Promise.all([fetchProducts(), fetchEmployees()]);
            showToast("Services and employees refreshed.");
        } finally {
            setRefreshingLookups(false);
        }
    };

    const pendingCount = cases.filter((c) => c.allocationStatus === "PENDING").length;
    const allocatedCount = cases.filter((c) => c.allocationStatus === "ALLOCATED").length;

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div
                style={{
                    ...styles.contentBody,
                    padding: isMobile ? "16px" : "20px 24px",
                }}
            >
                {!hideHeader && (
                    <>
                        <div style={styles.headerRow}>
                            <div style={styles.headerLeft}>
                                <div>
                                    <h1
                                        style={{
                                            ...styles.pageTitle,
                                            fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
                                        }}
                                    >
                                        Cases
                                    </h1>
                                    <p style={styles.headerSubtext}>
                                        Every logged case for the selected service/date — allocate
                                        each one manually below, or run Smart Allocation to split
                                        all pending cases equally across every employee (except
                                        anyone marked Absent or Leave on the Employees tab).
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
                            {/* NEW: unassigns every ALLOCATED case for this
                                service+date back to Pending — undo a bad Smart
                                Allocation run without going to the History tab. */}
                            <button
                                type="button"
                                style={{
                                    ...styles.clearAllocBtn,
                                    opacity: clearing || allocatedCount === 0 ? 0.6 : 1,
                                    cursor:
                                        clearing || allocatedCount === 0
                                            ? "not-allowed"
                                            : "pointer",
                                }}
                                disabled={clearing || allocatedCount === 0}
                                onClick={() => setClearConfirmOpen(true)}
                                title={
                                    allocatedCount === 0
                                        ? "Nothing allocated on this page"
                                        : "Unassign every allocated case for this service/date"
                                }
                            >
                                <i className="ti ti-eraser" />
                                {clearing ? "Clearing…" : "Clear"}
                            </button>
                        </div>

                        {/* Eligibility hint — shows exactly who Smart Allocation
                            (and the manual dropdown) will consider for the
                            selected service, based on that service's linked
                            Teams. If this list doesn't match expectations, the
                            mismatch is in Team names on the Employees/Products
                            pages, not in this page's filtering logic. */}
                        <p style={styles.eligibilityHint}>
                            {selectedProduct &&
                            (selectedProduct.teams || []).filter(Boolean).length > 0 ? (
                                <>
                                    Team-eligible for{" "}
                                    <strong>{selectedProduct.product_name}</strong> (
                                    {(selectedProduct.teams || []).filter(Boolean).join(", ")}):{" "}
                                    {eligibleEmployees.length === 0 ? (
                                        <span style={{ color: BRAND.red }}>
                                            no employees have a matching Team — check the Team field
                                            on the Employees page.
                                        </span>
                                    ) : (
                                        eligibleEmployees.map((e) => e.name).join(", ")
                                    )}
                                </>
                            ) : (
                                <>No team linked to this service — every employee is eligible.</>
                            )}{" "}
                            <button
                                type="button"
                                onClick={refreshLookups}
                                disabled={refreshingLookups}
                                style={styles.refreshLink}
                                title="Just changed a service's Teams or an employee's Team elsewhere? Refresh here instead of reloading the page."
                            >
                                <i
                                    className="ti ti-refresh"
                                    style={{
                                        fontSize: fontSize.xs,
                                        display: "inline-block",
                                    }}
                                />
                                {refreshingLookups ? "Refreshing…" : "Refresh"}
                            </button>
                        </p>

                        {autoResult && (
                            <div style={styles.autoSummary}>
                                <strong>{autoResult.allocatedCount}</strong> case(s) allocated
                                across {autoResult.perEmployee.length} employee(s):{" "}
                                {autoResult.perEmployee
                                    .map((e) => `${e.employeeName || "Unknown"} (${e.caseCount})`)
                                    .join(", ")}
                            </div>
                        )}
                    </>
                )}

                {/* NEW: when the full header/filter row is hidden (embedded
                    under another page's own filters), still surface Smart
                    Allocation + Clear as a slim action row of their own —
                    same handlers/state as the full filter bar above, just
                    without the duplicate Service/Date/Status dropdowns. */}
                {hideHeader && (
                    <div style={{ ...styles.filterBar, marginBottom: 12 }}>
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
                        <button
                            type="button"
                            style={{
                                ...styles.clearAllocBtn,
                                opacity: clearing || allocatedCount === 0 ? 0.6 : 1,
                                cursor:
                                    clearing || allocatedCount === 0 ? "not-allowed" : "pointer",
                            }}
                            disabled={clearing || allocatedCount === 0}
                            onClick={() => setClearConfirmOpen(true)}
                            title={
                                allocatedCount === 0
                                    ? "Nothing allocated on this page"
                                    : "Unassign every allocated case for this service/date"
                            }
                        >
                            <i className="ti ti-eraser" />
                            {clearing ? "Clearing…" : "Clear"}
                        </button>
                        {autoResult && (
                            <div style={{ ...styles.autoSummary, width: "100%" }}>
                                <strong>{autoResult.allocatedCount}</strong> case(s) allocated
                                across {autoResult.perEmployee.length} employee(s):{" "}
                                {autoResult.perEmployee
                                    .map((e) => `${e.employeeName || "Unknown"} (${e.caseCount})`)
                                    .join(", ")}
                            </div>
                        )}
                    </div>
                )}

                {error && <p style={styles.errorText}>{error}</p>}

                <div style={styles.tableCard}>
                    <div style={styles.tableScroll}>
                        <div style={styles.tableHeadRow}>
                            <span style={styles.colCase}>Case #</span>
                            <span style={styles.colClient}>Client</span>
                            <span style={styles.colSubclient}>Sub-Client</span>
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
                                    <span style={styles.colClient}>{c.clientName || "—"}</span>
                                    <span style={styles.colSubclient}>
                                        {c.subclientName || "—"}
                                    </span>
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
                                                pendingSelection[c.id] ??
                                                (c.assignedEmployeeId || "")
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
                                            {(eligibleEmployees.some(
                                                (e) => e.id === c.assignedEmployeeId
                                            )
                                                ? eligibleEmployees
                                                : [
                                                      ...(c.assignedEmployeeId
                                                          ? employees.filter(
                                                                (e) => e.id === c.assignedEmployeeId
                                                            )
                                                          : []),
                                                      ...eligibleEmployees,
                                                  ]
                                            ).map((emp) => (
                                                <option key={emp.id} value={emp.id}>
                                                    {emp.name}
                                                </option>
                                            ))}
                                        </select>
                                        {/* NEW: "who allocated this" — only shown once a case is
                                            actually ALLOCATED and we know who ran that action. */}
                                        {c.allocationStatus === "ALLOCATED" &&
                                            c.allocatedByName && (
                                                <span style={styles.allocatedByCaption}>
                                                    by {c.allocatedByName}
                                                </span>
                                            )}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
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

            {/* Confirmation popup for "Clear" — same overlay/modal pattern
                as the History tab's delete confirmation. */}
            {clearConfirmOpen && (
                <div style={styles.overlay} onClick={() => setClearConfirmOpen(false)}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Clear allocations?</h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={() => setClearConfirmOpen(false)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />
                        <p style={styles.modalBody}>
                            This unassigns all <strong>{allocatedCount}</strong> allocated case(s)
                            for <strong>{selectedProduct?.product_name || "this service"}</strong>{" "}
                            on {workDate} back to Pending. You can reassign them manually or re-run
                            Smart Allocation afterwards.
                        </p>
                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={styles.modalCancelBtn}
                                onClick={() => setClearConfirmOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={styles.modalClearBtn}
                                onClick={handleClearAllocations}
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
    headerRow: { display: "flex", alignItems: "center" },
    headerLeft: { display: "flex", alignItems: "center", gap: 14 },
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
    clearAllocBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: radius.md,
        border: `1px solid ${BRAND.red}`,
        background: "#fff",
        color: BRAND.red,
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
    },
    eligibilityHint: {
        margin: 0,
        fontSize: fontSize.xs,
        color: "#767F92",
        textAlign: "left",
    },
    refreshLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        color: BRAND.blue,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        padding: 0,
    },
    // Confirmation popup (Clear allocations)
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
    modalClearBtn: {
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
        // Slightly wider than the filter/stat cards above — bleeds a
        // touch past the content padding on both sides.
        width: "calc(100% + 16px)",
        marginLeft: -8,
        marginRight: -8,
    },
    // FIX: the table's columns have fixed pixel widths totalling well
    // over 1000px (Case #, Client, Sub-Client, Service, Date, Status,
    // Allocate-to) — on a narrow/mobile screen, tableCard's
    // overflow:hidden above was silently CLIPPING every column past
    // what fit on screen instead of letting the person scroll to see
    // them. This inner wrapper scrolls horizontally on its own — the
    // outer card still clips at its own (rounded) edges, but this
    // scrollable region inside it stays fully reachable.
    tableScroll: { overflowX: "auto" },
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
    colCase: { width: 120, flexShrink: 0, fontWeight: fontWeight.medium },
    colClient: { width: 150, flexShrink: 0 },
    colSubclient: { width: 150, flexShrink: 0 },
    colService: { width: 140, flexShrink: 0 },
    colDate: { width: 100, flexShrink: 0 },
    colStatus: { width: 110, flexShrink: 0 },
    colAssign: { width: 220, flexShrink: 0, textAlign: "right", marginLeft: "auto" },
    // NEW: small "by <name>" line under the Assign dropdown, showing who
    // ran the allocate action.
    allocatedByCaption: {
        display: "block",
        marginTop: 4,
        fontSize: "11px",
        color: "#9CA3AF",
        textAlign: "right",
    },
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
