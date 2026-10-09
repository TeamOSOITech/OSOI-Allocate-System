// src/pages/admin/todaysallocationemployees.tsx
//
// "Employees" tab on the Today's Allocation page (see manualallocation.tsx).
// Pick a service, narrow down to only the employees whose Team is linked to
// that service (Products/Services -> Teams multi-select), then mark each
// one Present / Leave / Half Day for the day and save.
//
// Saves straight into the existing `attendance` table via the existing
// GET/POST /api/attendance endpoints (backend/src/modules/attendance) —
// the same table Daily Work's own Smart Allocation reads. The Cases tab's
// "Smart Allocation" button reads whoever is PRESENT or HALF_DAY here for
// the chosen date before splitting cases — a Half Day employee counts as
// half a unit, so they end up with roughly half the work of a full-day
// Present employee.
//
// NEW: Leave Periods — mark an employee on leave from a FROM date to a TO
// date once (POST /api/employee-leaves). On any date inside that period the
// employee shows as Leave by default, no daily marking needed. A status
// saved manually for a specific day still wins over the leave period.

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
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
    department: string | null;
    team: string | null;
};
type AttStatus = "PRESENT" | "ABSENT" | "LEAVE" | "HALF_DAY";
// Absent was folded into Leave — "absent ya leave, same baat hai". Kept as
// its own AttStatus above only so old rows already saved as ABSENT still
// type-check; it's normalized to LEAVE the moment attendance loads (see
// fetchAttendance below) and is no longer a status the buttons can set.
type SelectableStatus = "PRESENT" | "LEAVE" | "HALF_DAY";

// NEW: one leave period (from -> to, inclusive) for one employee.
type LeavePeriod = {
    id: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    reason: string;
};

const STATUS_META: Record<SelectableStatus, { label: string; color: string; icon: string }> = {
    PRESENT: { label: "Present", color: BRAND.green, icon: "ti-circle-check" },
    LEAVE: { label: "Leave", color: BRAND.grey, icon: "ti-calendar-off" },
    // Counts as 0.5 towards Smart Allocation's employee count — someone
    // marked Half Day gets roughly half the work a full-day Present
    // employee gets. See allocations.controller.js / servicecases.controller.js.
    HALF_DAY: { label: "Half Day", color: BRAND.amber, icon: "ti-clock-hour-4" },
};

function initials(name: string) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

// YYYY-MM-DD -> DD-MM-YYYY (same display format as the Case Register).
function fmtDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

type Props = {
    productId: string;
    onChangeProductId: (id: string) => void;
    workDate: string;
};

export default function TodaysAllocationEmployees({
    productId,
    onChangeProductId,
    workDate,
}: Props) {
    const isMobile = useIsMobile();
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [searchText, setSearchText] = useState("");
    // NEW: "External Members" — lets an admin pull in employees whose own
    // Team ISN'T linked to the selected service, for just this one
    // service/date (e.g. borrowing someone to help clear a backlog).
    const [externalIds, setExternalIds] = useState<Set<string>>(new Set());
    const [externalMenuOpen, setExternalMenuOpen] = useState(false);
    const [externalSearch, setExternalSearch] = useState("");
    // NEW: view filter shown just above the employee table — "All" (team
    // + any external adds), "My Team" (service-matched only), or
    // "External" (only the manually added ones).
    const [viewScope, setViewScope] = useState<"all" | "team" | "external">("all");

    // Only holds statuses that were SAVED for this date (or clicked just
    // now). Anyone missing from here is "default" — Present, or Leave if
    // they're inside a leave period (see effectiveStatus below).
    const [statusByEmployee, setStatusByEmployee] = useState<Record<string, SelectableStatus>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState("");

    // NEW: leave periods covering the selected date (drives the default
    // Leave status + the "On leave" tag) and the current/upcoming list
    // shown inside the Leave Period popup.
    const [dayLeaves, setDayLeaves] = useState<LeavePeriod[]>([]);
    const [upcomingLeaves, setUpcomingLeaves] = useState<LeavePeriod[]>([]);
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [leaveEmpIds, setLeaveEmpIds] = useState<Set<string>>(new Set());
    const [leaveFrom, setLeaveFrom] = useState(workDate);
    const [leaveTo, setLeaveTo] = useState(workDate);
    const [leaveReason, setLeaveReason] = useState("");
    const [leaveSearch, setLeaveSearch] = useState("");
    const [leaveError, setLeaveError] = useState("");
    const [savingLeave, setSavingLeave] = useState(false);
    const [deletingLeaveId, setDeletingLeaveId] = useState<string | null>(null);

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

    const fetchAttendance = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/attendance?date=${workDate}`);
            const json = await res.json();
            if (!res.ok || !json.success) return;
            const next: Record<string, SelectableStatus> = {};
            (json.data || []).forEach((a: any) => {
                // Virtual rows coming from a leave period aren't manually saved
                // statuses — the leave-period logic below already covers them.
                if (a.fromLeavePeriod) return;
                if (["PRESENT", "ABSENT", "LEAVE", "HALF_DAY"].includes(a.status)) {
                    // Absent is folded into Leave on this page — see note by
                    // SelectableStatus above.
                    next[a.employeeId] = a.status === "ABSENT" ? "LEAVE" : a.status;
                }
            });
            setStatusByEmployee(next);
        } catch (err) {
            console.error("Failed to fetch attendance:", err);
        } finally {
            setLoading(false);
        }
    }, [workDate]);

    // NEW: leave periods that cover the selected date.
    const fetchDayLeaves = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employee-leaves?date=${workDate}`);
            const json = await res.json();
            setDayLeaves(res.ok && json.success ? json.data || [] : []);
        } catch (err) {
            console.error("Failed to fetch leave periods:", err);
            setDayLeaves([]);
        }
    }, [workDate]);

    // NEW: every current/upcoming leave period (for the popup's list).
    const fetchUpcomingLeaves = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employee-leaves`);
            const json = await res.json();
            setUpcomingLeaves(res.ok && json.success ? json.data || [] : []);
        } catch (err) {
            console.error("Failed to fetch upcoming leaves:", err);
            setUpcomingLeaves([]);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
    }, [fetchProducts, fetchEmployees]);

    // NOTE: "All" (empty productId) is the intended default, shared with
    // the Cases tab (same productId state in manualallocation.tsx) — no
    // auto-select-first-service effect here either.

    useEffect(() => {
        fetchAttendance();
    }, [fetchAttendance]);

    useEffect(() => {
        fetchDayLeaves();
    }, [fetchDayLeaves]);

    // employeeId -> the leave period covering the selected date.
    const leaveByEmployee = useMemo(() => {
        const map: Record<string, LeavePeriod> = {};
        dayLeaves.forEach((l) => {
            map[l.employeeId] = l;
        });
        return map;
    }, [dayLeaves]);

    // What the row actually shows: a manually saved/clicked status for this
    // date wins; otherwise Leave if inside a leave period; otherwise Present.
    const effectiveStatus = useCallback(
        (employeeId: string): SelectableStatus =>
            statusByEmployee[employeeId] || (leaveByEmployee[employeeId] ? "LEAVE" : "PRESENT"),
        [statusByEmployee, leaveByEmployee]
    );

    const employeeNameById = useMemo(() => {
        const map: Record<string, string> = {};
        employees.forEach((e) => {
            map[e.id] = e.name;
        });
        return map;
    }, [employees]);

    const selectedProduct = useMemo(
        () => products.find((p) => String(p.id) === String(productId)) || null,
        [products, productId]
    );

    // "Service-wise" narrowing: only employees whose Team is one of the
    // teams actually linked to the selected service (Products/Services ->
    // Teams multi-select). Falls back to the full employee list ONLY when
    // the service has no teams linked at all — if teams ARE linked but
    // zero employees currently have a matching Team, the list is meant to
    // come up empty rather than silently showing everyone.
    const serviceMatched = useMemo(() => {
        if (!selectedProduct) return employees;
        const productTeams = (selectedProduct.teams || []).filter(Boolean);
        if (productTeams.length === 0) return employees;
        const allowed = new Set(productTeams.map((t) => t.toLowerCase()));
        return employees.filter((e) => e.team && allowed.has(e.team.toLowerCase()));
    }, [employees, selectedProduct]);

    const serviceMatchedIds = useMemo(
        () => new Set(serviceMatched.map((e) => e.id)),
        [serviceMatched]
    );

    // NEW: read-only label showing which team(s) the SELECTED SERVICE is
    // aligned to (Products/Services -> Teams multi-select).
    const alignedTeamsLabel = useMemo(() => {
        if (!productId) return "All teams";
        const productTeams = (selectedProduct?.teams || []).filter(Boolean);
        if (productTeams.length === 0) return "Not linked to any team yet";
        return productTeams.join(", ");
    }, [productId, selectedProduct]);

    // Persisted server-side (external_service_members table) so the same
    // picks come back automatically next time this service+date is opened.
    const fetchExternalMembers = useCallback(async () => {
        if (!productId) {
            setExternalIds(new Set());
            return;
        }
        try {
            const res = await authFetch(
                `${API_BASE}/api/external-members?productId=${productId}&workDate=${workDate}`
            );
            const json = await res.json();
            setExternalIds(res.ok && json.success ? new Set(json.data || []) : new Set());
        } catch (err) {
            console.error("Failed to fetch external members:", err);
            setExternalIds(new Set());
        }
    }, [productId, workDate]);
    useEffect(() => {
        fetchExternalMembers();
    }, [fetchExternalMembers]);

    // Saves the FULL external set for this service+date right away on
    // every toggle — no separate "save" step needed.
    const persistExternalMembers = useCallback(
        async (ids: Set<string>) => {
            if (!productId) return;
            try {
                await authFetch(`${API_BASE}/api/external-members`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productId,
                        workDate,
                        employeeIds: Array.from(ids),
                    }),
                });
            } catch (err) {
                console.error("Failed to save external members:", err);
            }
        },
        [productId, workDate]
    );

    // Candidates for the External multi-select: everyone NOT already
    // team-matched to this service, optionally narrowed by the search
    // box inside that dropdown.
    const externalCandidates = useMemo(() => {
        const pool = employees.filter((e) => !serviceMatchedIds.has(e.id));
        const q = externalSearch.trim().toLowerCase();
        if (!q) return pool;
        return pool.filter((e) =>
            [e.name, e.employeeCode, e.department, e.team]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q)
        );
    }, [employees, serviceMatchedIds, externalSearch]);

    const toggleExternal = (id: string) => {
        setExternalIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            persistExternalMembers(next);
            return next;
        });
    };

    // Team-matched employees + whichever externals were manually added.
    const combinedList = useMemo(() => {
        if (viewScope === "team") return serviceMatched;
        if (viewScope === "external") return employees.filter((e) => externalIds.has(e.id));
        const extras = employees.filter(
            (e) => externalIds.has(e.id) && !serviceMatchedIds.has(e.id)
        );
        return [...serviceMatched, ...extras];
    }, [viewScope, serviceMatched, employees, externalIds, serviceMatchedIds]);

    const filteredEmployees = useMemo(() => {
        const list = combinedList;
        const q = searchText.trim().toLowerCase();
        if (!q) return list;
        return list.filter((e) =>
            [e.name, e.employeeCode, e.department, e.team]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q)
        );
    }, [combinedList, searchText]);

    const setStatus = (employeeId: string, status: SelectableStatus) => {
        setStatusByEmployee((prev) => ({ ...prev, [employeeId]: status }));
    };
    // Employees inside a leave period are skipped here — "Mark all
    // Present" shouldn't silently cancel someone's planned leave. Click
    // Present on that row if they're actually back.
    const markAllPresent = () => {
        setStatusByEmployee((prev) => {
            const next = { ...prev };
            filteredEmployees.forEach((e) => {
                if (leaveByEmployee[e.id] && !prev[e.id]) return;
                next[e.id] = "PRESENT";
            });
            return next;
        });
    };

    const counts = useMemo(() => {
        let present = 0,
            leave = 0,
            halfDay = 0;
        filteredEmployees.forEach((e) => {
            const s = effectiveStatus(e.id);
            if (s === "PRESENT") present++;
            else if (s === "HALF_DAY") halfDay++;
            else leave++;
        });
        return { present, leave, halfDay };
    }, [filteredEmployees, effectiveStatus]);

    const handleSave = async () => {
        setSaving(true);
        try {
            // Employees who are only "Leave" because of a leave period (no
            // manual status for this date) aren't written as daily rows —
            // the leave period itself is the source of truth for them.
            const records = filteredEmployees
                .filter((e) => !(leaveByEmployee[e.id] && !statusByEmployee[e.id]))
                .map((e) => ({
                    employeeId: e.id,
                    status: effectiveStatus(e.id),
                }));
            const res = await authFetch(`${API_BASE}/api/attendance/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: workDate, records }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to save");
            showToast(
                `Saved. ${counts.present} present — head to the Cases tab and run Smart Allocation.`
            );
        } catch (err: any) {
            showToast(err?.message || "Failed to save attendance.");
        } finally {
            setSaving(false);
        }
    };

    // ---- NEW: Leave Period popup ----
    const openLeaveModal = () => {
        setLeaveEmpIds(new Set());
        setLeaveFrom(workDate);
        setLeaveTo(workDate);
        setLeaveReason("");
        setLeaveSearch("");
        setLeaveError("");
        setLeaveModalOpen(true);
        fetchUpcomingLeaves();
    };

    const leaveCandidates = useMemo(() => {
        const q = leaveSearch.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter((e) =>
            [e.name, e.employeeCode, e.department, e.team]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q)
        );
    }, [employees, leaveSearch]);

    const toggleLeaveEmp = (id: string) => {
        setLeaveEmpIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSaveLeave = async () => {
        setLeaveError("");
        if (leaveEmpIds.size === 0) {
            setLeaveError("Select at least one employee.");
            return;
        }
        if (!leaveFrom || !leaveTo) {
            setLeaveError("Choose both From and To dates.");
            return;
        }
        if (leaveTo < leaveFrom) {
            setLeaveError("To date can't be before From date.");
            return;
        }
        setSavingLeave(true);
        try {
            const res = await authFetch(`${API_BASE}/api/employee-leaves`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeIds: Array.from(leaveEmpIds),
                    fromDate: leaveFrom,
                    toDate: leaveTo,
                    reason: leaveReason.trim(),
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to save leave");
            showToast(json.message || "Leave period saved.");
            setLeaveEmpIds(new Set());
            setLeaveReason("");
            fetchDayLeaves();
            fetchUpcomingLeaves();
        } catch (err: any) {
            setLeaveError(err?.message || "Failed to save leave.");
        } finally {
            setSavingLeave(false);
        }
    };

    const handleDeleteLeave = async (leave: LeavePeriod) => {
        if (
            !window.confirm(
                `Remove leave for ${employeeNameById[leave.employeeId] || "this employee"} (${fmtDate(leave.fromDate)} to ${fmtDate(leave.toDate)})?`
            )
        )
            return;
        setDeletingLeaveId(leave.id);
        try {
            const res = await authFetch(`${API_BASE}/api/employee-leaves/${leave.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to remove");
            fetchDayLeaves();
            fetchUpcomingLeaves();
        } catch (err: any) {
            setLeaveError(err?.message || "Failed to remove leave.");
        } finally {
            setDeletingLeaveId(null);
        }
    };

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div
                style={{
                    ...styles.contentBody,
                    padding: isMobile ? "16px" : "20px 24px",
                }}
            >
                <div style={styles.headerRow}>
                    <div>
                        <h2
                            style={{
                                ...styles.pageTitle,
                                fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
                            }}
                        >
                            Employees
                        </h2>
                        <p style={styles.headerSubtext}>
                            Select a service, mark who's Present / Leave / Half Day today, and save
                            — Smart Allocation on the Cases tab splits pending cases equally across
                            everyone marked Present here. For a longer absence, use Leave Period to
                            mark a from–to date range once.
                        </p>
                    </div>
                </div>

                <div style={styles.filterBar}>
                    <div style={{ width: 190 }}>
                        <label style={styles.label}>Service</label>
                        <div
                            style={styles.teamAlignedLabel}
                            title={selectedProduct?.product_name || "All Services"}
                        >
                            {selectedProduct?.product_name || "All Services"}
                        </div>
                    </div>
                    <div style={{ width: 190 }}>
                        <label style={styles.label}>Team</label>
                        <div style={styles.teamAlignedLabel} title={alignedTeamsLabel}>
                            {alignedTeamsLabel}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                        <label style={styles.label}>Search</label>
                        <input
                            style={styles.select}
                            placeholder="Name, code, team…"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                    </div>
                    <div style={{ position: "relative" }}>
                        <label style={styles.label}>External Members</label>
                        <button
                            type="button"
                            style={{ ...styles.select, textAlign: "left", cursor: "pointer" }}
                            onClick={() => setExternalMenuOpen((o) => !o)}
                        >
                            {externalIds.size === 0
                                ? "Add from other teams…"
                                : `${externalIds.size} added`}
                        </button>
                        {externalMenuOpen && (
                            <div style={styles.externalPanel}>
                                <input
                                    autoFocus
                                    style={{ ...styles.select, marginBottom: 8 }}
                                    placeholder="Search other teams…"
                                    value={externalSearch}
                                    onChange={(e) => setExternalSearch(e.target.value)}
                                />
                                <div style={styles.externalList}>
                                    {externalCandidates.length === 0 ? (
                                        <div style={styles.externalEmpty}>
                                            No other employees found.
                                        </div>
                                    ) : (
                                        externalCandidates.map((e) => (
                                            <label key={e.id} style={styles.externalRow}>
                                                <input
                                                    type="checkbox"
                                                    checked={externalIds.has(e.id)}
                                                    onChange={() => toggleExternal(e.id)}
                                                />
                                                <span>
                                                    {e.name}{" "}
                                                    <span style={styles.externalRowTeam}>
                                                        ({e.team || "No team"})
                                                    </span>
                                                </span>
                                            </label>
                                        ))
                                    )}
                                </div>
                                <button
                                    type="button"
                                    style={styles.externalDoneBtn}
                                    onClick={() => setExternalMenuOpen(false)}
                                >
                                    Done
                                </button>
                            </div>
                        )}
                    </div>
                    <button type="button" style={styles.ghostBtn} onClick={markAllPresent}>
                        <i className="ti ti-checks" /> Mark all Present
                    </button>
                    {/* NEW: opens the from–to Leave Period popup. */}
                    <button type="button" style={styles.ghostBtn} onClick={openLeaveModal}>
                        <i className="ti ti-calendar-event" /> Leave Period
                    </button>
                </div>

                <div style={styles.countRow}>
                    <span style={{ ...styles.countPill, color: BRAND.green }}>
                        {counts.present} Present
                    </span>
                    <span style={{ ...styles.countPill, color: BRAND.grey }}>
                        {counts.leave} Leave
                    </span>
                    <span style={{ ...styles.countPill, color: BRAND.amber }}>
                        {counts.halfDay} Half Day
                    </span>
                </div>

                <div style={{ maxWidth: 220 }}>
                    <label style={styles.label}>Show</label>
                    <select
                        style={styles.select}
                        value={viewScope}
                        onChange={(e) => setViewScope(e.target.value as any)}
                    >
                        <option value="all">All </option>
                        <option value="team">My Team only</option>
                        <option value="external">External only</option>
                    </select>
                </div>

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <div style={styles.colName}>Employee</div>
                        <div style={styles.colTeam}>Team</div>
                        <div style={{ ...styles.colStatus, ...styles.colStatusHead }}>Status</div>
                    </div>
                    {loading ? (
                        <div style={styles.emptyNote}>Loading employees…</div>
                    ) : filteredEmployees.length === 0 ? (
                        <div style={styles.emptyNote}>No employees match this filter.</div>
                    ) : (
                        filteredEmployees.map((emp) => {
                            const status = effectiveStatus(emp.id);
                            const leave = leaveByEmployee[emp.id];
                            return (
                                <div key={emp.id} style={styles.tableRow}>
                                    <div style={styles.colName}>
                                        <span style={styles.avatar}>{initials(emp.name)}</span>
                                        <div style={styles.nameBlock}>
                                            <div style={styles.empName}>
                                                <span>{emp.name}</span>
                                                {externalIds.has(emp.id) && (
                                                    <span style={styles.externalTag}>External</span>
                                                )}
                                            </div>
                                            {emp.employeeCode && (
                                                <div style={styles.empCode}>{emp.employeeCode}</div>
                                            )}
                                            {/* NEW: shows the leave period this
                                                employee is inside of. */}
                                            {leave && (
                                                <div style={styles.leaveTag}>
                                                    <i className="ti ti-calendar-off" /> On leave{" "}
                                                    {fmtDate(leave.fromDate)} to{" "}
                                                    {fmtDate(leave.toDate)}
                                                    {leave.reason ? ` · ${leave.reason}` : ""}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={styles.colTeam}>{emp.team || "—"}</div>
                                    <div style={styles.colStatus}>
                                        {(Object.keys(STATUS_META) as SelectableStatus[]).map(
                                            (s) => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setStatus(emp.id, s)}
                                                    style={{
                                                        ...styles.statusBtn,
                                                        background:
                                                            status === s
                                                                ? STATUS_META[s].color
                                                                : "transparent",
                                                        color:
                                                            status === s
                                                                ? "#fff"
                                                                : STATUS_META[s].color,
                                                        border: `1px solid ${STATUS_META[s].color}`,
                                                    }}
                                                >
                                                    <i className={`ti ${STATUS_META[s].icon}`} />
                                                    {STATUS_META[s].label}
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <button
                    type="button"
                    style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }}
                    disabled={saving || filteredEmployees.length === 0}
                    onClick={handleSave}
                >
                    <i className="ti ti-device-floppy" />
                    {saving ? "Saving…" : "Save Attendance"}
                </button>
            </div>

            {/* NEW: Leave Period popup */}
            {leaveModalOpen && (
                <div style={styles.modalOverlay} onClick={() => setLeaveModalOpen(false)}>
                    <div
                        style={{
                            ...styles.modalCard,
                            width: isMobile ? "calc(100% - 24px)" : 560,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={styles.modalHeader}>
                            <span>
                                <i className="ti ti-calendar-event" /> Leave Period
                            </span>
                            <button
                                type="button"
                                style={styles.modalClose}
                                onClick={() => setLeaveModalOpen(false)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" />
                            </button>
                        </div>

                        <div style={styles.modalBody}>
                            <div style={styles.dateRow}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>From</label>
                                    <input
                                        type="date"
                                        style={styles.select}
                                        value={leaveFrom}
                                        onChange={(e) => {
                                            setLeaveFrom(e.target.value);
                                            if (leaveTo < e.target.value)
                                                setLeaveTo(e.target.value);
                                        }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>To</label>
                                    <input
                                        type="date"
                                        style={styles.select}
                                        value={leaveTo}
                                        min={leaveFrom}
                                        onChange={(e) => setLeaveTo(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={styles.label}>Reason (optional)</label>
                                <input
                                    style={styles.select}
                                    placeholder="e.g. Long weekend, family function"
                                    maxLength={200}
                                    value={leaveReason}
                                    onChange={(e) => setLeaveReason(e.target.value)}
                                />
                            </div>

                            <div>
                                <label style={styles.label}>
                                    Employees{" "}
                                    {leaveEmpIds.size > 0 && (
                                        <span style={{ color: BRAND.blue }}>
                                            ({leaveEmpIds.size} selected)
                                        </span>
                                    )}
                                </label>
                                <input
                                    style={{ ...styles.select, marginBottom: 8 }}
                                    placeholder="Search name, code, team…"
                                    value={leaveSearch}
                                    onChange={(e) => setLeaveSearch(e.target.value)}
                                />
                                <div style={styles.leavePickList}>
                                    {leaveCandidates.length === 0 ? (
                                        <div style={styles.externalEmpty}>No employees found.</div>
                                    ) : (
                                        leaveCandidates.map((e) => (
                                            <label key={e.id} style={styles.externalRow}>
                                                <input
                                                    type="checkbox"
                                                    checked={leaveEmpIds.has(e.id)}
                                                    onChange={() => toggleLeaveEmp(e.id)}
                                                />
                                                <span>
                                                    {e.name}{" "}
                                                    <span style={styles.externalRowTeam}>
                                                        ({e.team || "No team"})
                                                    </span>
                                                </span>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>

                            {leaveError && <p style={styles.leaveError}>{leaveError}</p>}

                            <button
                                type="button"
                                style={{ ...styles.saveBtn, opacity: savingLeave ? 0.6 : 1 }}
                                disabled={savingLeave}
                                onClick={handleSaveLeave}
                            >
                                <i className="ti ti-device-floppy" />
                                {savingLeave ? "Saving…" : "Save Leave Period"}
                            </button>

                            <div>
                                <label style={styles.label}>Current &amp; upcoming leaves</label>
                                <div style={styles.leavePickList}>
                                    {upcomingLeaves.length === 0 ? (
                                        <div style={styles.externalEmpty}>
                                            No leave periods set.
                                        </div>
                                    ) : (
                                        upcomingLeaves.map((l) => (
                                            <div key={l.id} style={styles.leaveListRow}>
                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                    <strong>
                                                        {employeeNameById[l.employeeId] ||
                                                            "Unknown employee"}
                                                    </strong>
                                                    <div style={styles.externalRowTeam}>
                                                        {fmtDate(l.fromDate)} to {fmtDate(l.toDate)}
                                                        {l.reason ? ` · ${l.reason}` : ""}
                                                    </div>
                                                </span>
                                                <button
                                                    type="button"
                                                    style={{
                                                        ...styles.leaveDeleteBtn,
                                                        opacity: deletingLeaveId === l.id ? 0.5 : 1,
                                                    }}
                                                    disabled={deletingLeaveId === l.id}
                                                    onClick={() => handleDeleteLeave(l)}
                                                    aria-label="Remove leave period"
                                                    title="Remove leave period"
                                                >
                                                    <i className="ti ti-trash" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

// Fixed widths so header labels and row cells line up in the same columns.
const TEAM_COL_WIDTH = 160;
const STATUS_BTN_WIDTH = 94;
const STATUS_GAP = 6;
const STATUS_COL_WIDTH = STATUS_BTN_WIDTH * 3 + STATUS_GAP * 2;

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        flex: 1,
        minHeight: "100%",
        background: "#eff4fa",
    },
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
        fontWeight: fontWeight.semibold,
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
        textAlign: "left",
    },
    select: {
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
        color: "#17181C",
        minWidth: 170,
        width: "100%",
        boxSizing: "border-box",
    },
    teamAlignedLabel: {
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#f0f1f6",
        color: "#374151",
        width: "100%",
        boxSizing: "border-box",
        lineHeight: "normal",
        display: "flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    ghostBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 14px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    countRow: { display: "flex", gap: 10 },
    countPill: {
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        padding: "4px 12px",
        borderRadius: radius.pill,
        background: "#f4f8fd",
    },
    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflowX: "auto",
        overflowY: "hidden",
    },
    tableHeadRow: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 20px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        textAlign: "left",
        minWidth: 720,
    },
    tableRow: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 20px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
        textAlign: "left",
        minWidth: 720,
    },
    // Name column: avatar + text block, always left aligned.
    colName: {
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
    },
    // Team column: same fixed width in header and rows, left aligned.
    colTeam: {
        width: TEAM_COL_WIDTH,
        flexShrink: 0,
        color: "#6b7280",
        textAlign: "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // Status column: fixed width = 3 equal buttons, so every row lines up.
    colStatus: {
        display: "flex",
        alignItems: "center",
        gap: STATUS_GAP,
        width: STATUS_COL_WIDTH,
        flexShrink: 0,
    },
    colStatusHead: { display: "block", textAlign: "left" },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: radius.circle,
        background: "#DCEFFB",
        color: "#1785B0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    // Stacks name / code / leave tag, all left aligned.
    nameBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        minWidth: 0,
        textAlign: "left",
    },
    empName: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.base,
        color: "#1a1a2e",
        fontWeight: fontWeight.medium,
        textAlign: "left",
    },
    empCode: {
        fontSize: fontSize.xs,
        color: "#9ca3af",
        textAlign: "left",
    },
    // NEW: "On leave dd-mm-yyyy to dd-mm-yyyy" line under the employee.
    leaveTag: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: fontSize.xs,
        color: "#B45309",
        background: "#FEF3C7",
        padding: "2px 8px",
        borderRadius: radius.pill,
        marginTop: 2,
        textAlign: "left",
    },
    // "External" shown as a small badge next to the name.
    externalTag: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        color: "#B45309",
        background: "#FEF3C7",
        padding: "1px 8px",
        borderRadius: radius.pill,
        lineHeight: "16px",
    },
    externalPanel: {
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        width: 280,
        maxHeight: 320,
        background: "#fff",
        border: "1px solid #ececf5",
        borderRadius: radius.sm,
        boxShadow: "0 10px 30px rgba(0,0,0,.12)",
        padding: 10,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
    },
    externalList: { overflowY: "auto", maxHeight: 200, display: "flex", flexDirection: "column" },
    externalEmpty: { padding: "10px 4px", color: "#9ca3af", fontSize: fontSize.sm },
    externalRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 4px",
        fontSize: fontSize.sm,
        color: "#17181C",
        cursor: "pointer",
        textAlign: "left",
    },
    externalRowTeam: { color: "#9ca3af", fontSize: fontSize.xs, textAlign: "left" },
    externalDoneBtn: {
        marginTop: 8,
        padding: "8px 12px",
        borderRadius: radius.sm,
        border: "none",
        background: BRAND.blue,
        color: "#fff",
        fontWeight: fontWeight.medium,
        fontSize: fontSize.sm,
        cursor: "pointer",
    },
    // Equal-width pill buttons so Present / Leave / Half Day line up.
    statusBtn: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        width: STATUS_BTN_WIDTH,
        padding: "6px 0",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    emptyNote: {
        padding: "28px 20px",
        textAlign: "center",
        color: "#9ca3af",
        fontSize: fontSize.base,
    },
    saveBtn: {
        alignSelf: "flex-end",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 22px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.3)",
    },
    // NEW: Leave Period popup.
    modalOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
    },
    modalCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 20px 50px rgba(0,0,0,.25)",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "14px 18px",
        background: GRADIENT,
        color: "#fff",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
    },
    modalClose: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        border: "1px solid rgba(255,255,255,0.5)",
        background: "rgba(255,255,255,0.12)",
        color: "#fff",
        cursor: "pointer",
    },
    modalBody: {
        padding: "16px 18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        overflowY: "auto",
    },
    dateRow: { display: "flex", gap: 12 },
    leavePickList: {
        maxHeight: 170,
        overflowY: "auto",
        border: "1px solid #ececf5",
        borderRadius: radius.sm,
        padding: "4px 8px",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
    },
    leaveListRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 2px",
        borderBottom: "1px solid #f1f1f1",
        fontSize: fontSize.sm,
        color: "#17181C",
        textAlign: "left",
    },
    leaveDeleteBtn: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        border: "1px solid #fecaca",
        background: "#fef2f2",
        color: BRAND.red,
        cursor: "pointer",
        flexShrink: 0,
    },
    leaveError: {
        margin: 0,
        fontSize: fontSize.sm,
        color: BRAND.red,
        fontWeight: fontWeight.medium,
        textAlign: "left",
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
