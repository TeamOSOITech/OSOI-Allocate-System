// src/pages/admin/todaysallocationemployees.tsx
//
// "Employees" tab on the Today's Allocation page (see manualallocation.tsx).
// Pick a service, narrow down to only the employees whose Team is linked to
// that service (Products/Services -> Teams multi-select), then mark each
// one Present / Absent / Leave for the day and save.
//
// Saves straight into the existing `attendance` table via the existing
// GET/POST /api/attendance endpoints (backend/src/modules/attendance) —
// the same table Daily Work's own Smart Allocation reads. The Cases tab's
// "Smart Allocation" button reads whoever is PRESENT here for the chosen
// date before splitting cases.

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

type Product = { id: string; product_name: string; teams?: string[] };
type Employee = {
    id: string;
    name: string;
    employeeCode: string | null;
    department: string | null;
    team: string | null;
};
type AttStatus = "PRESENT" | "ABSENT" | "LEAVE";

const STATUS_META: Record<AttStatus, { label: string; color: string; icon: string }> = {
    PRESENT: { label: "Present", color: BRAND.green, icon: "ti-circle-check" },
    ABSENT: { label: "Absent", color: BRAND.red, icon: "ti-circle-x" },
    LEAVE: { label: "Leave", color: BRAND.grey, icon: "ti-calendar-off" },
};

function initials(name: string) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
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
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [teamFilter, setTeamFilter] = useState("");
    const [searchText, setSearchText] = useState("");

    const [statusByEmployee, setStatusByEmployee] = useState<Record<string, AttStatus>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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

    const fetchAttendance = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/attendance?date=${workDate}`);
            const json = await res.json();
            if (!res.ok || !json.success) return;
            const next: Record<string, AttStatus> = {};
            (json.data || []).forEach((a: any) => {
                if (["PRESENT", "ABSENT", "LEAVE"].includes(a.status)) {
                    next[a.employeeId] = a.status;
                }
            });
            setStatusByEmployee(next);
        } catch (err) {
            console.error("Failed to fetch attendance:", err);
        } finally {
            setLoading(false);
        }
    }, [workDate]);

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

    const teams = useMemo(
        () => Array.from(new Set(serviceMatched.map((e) => e.team).filter(Boolean))) as string[],
        [serviceMatched]
    );

    const filteredEmployees = useMemo(() => {
        let list = serviceMatched;
        if (teamFilter) list = list.filter((e) => e.team === teamFilter);
        const q = searchText.trim().toLowerCase();
        if (!q) return list;
        return list.filter((e) =>
            [e.name, e.employeeCode, e.department, e.team]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q)
        );
    }, [serviceMatched, teamFilter, searchText]);

    const setStatus = (employeeId: string, status: AttStatus) => {
        setStatusByEmployee((prev) => ({ ...prev, [employeeId]: status }));
    };
    const markAllPresent = () => {
        setStatusByEmployee((prev) => {
            const next = { ...prev };
            filteredEmployees.forEach((e) => {
                next[e.id] = "PRESENT";
            });
            return next;
        });
    };

    const counts = useMemo(() => {
        let present = 0,
            absent = 0,
            leave = 0;
        filteredEmployees.forEach((e) => {
            const s = statusByEmployee[e.id] || "PRESENT";
            if (s === "PRESENT") present++;
            else if (s === "ABSENT") absent++;
            else leave++;
        });
        return { present, absent, leave };
    }, [filteredEmployees, statusByEmployee]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const records = filteredEmployees.map((e) => ({
                employeeId: e.id,
                status: statusByEmployee[e.id] || "PRESENT",
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

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                <div style={styles.headerRow}>
                    <div>
                        <h1 style={styles.pageTitle}>Employees</h1>
                        <p style={styles.headerSubtext}>
                            Select a service, mark who's Present / Absent / Leave today, and save —
                            Smart Allocation on the Cases tab splits pending cases equally across
                            everyone marked Present here.
                        </p>
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
                            <option value="">All</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={styles.label}>Team</label>
                        <select
                            style={styles.select}
                            value={teamFilter}
                            onChange={(e) => setTeamFilter(e.target.value)}
                        >
                            <option value="">All teams</option>
                            {teams.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
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
                    <button type="button" style={styles.ghostBtn} onClick={markAllPresent}>
                        <i className="ti ti-checks" /> Mark all Present
                    </button>
                </div>

                <div style={styles.countRow}>
                    <span style={{ ...styles.countPill, color: BRAND.green }}>
                        {counts.present} Present
                    </span>
                    <span style={{ ...styles.countPill, color: BRAND.red }}>
                        {counts.absent} Absent
                    </span>
                    <span style={{ ...styles.countPill, color: BRAND.grey }}>
                        {counts.leave} Leave
                    </span>
                </div>

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <span style={styles.colName}>Employee</span>
                        <span style={styles.colTeam}>Team</span>
                        <span style={styles.colStatus}>Status</span>
                    </div>
                    {loading ? (
                        <div style={styles.emptyNote}>Loading employees…</div>
                    ) : filteredEmployees.length === 0 ? (
                        <div style={styles.emptyNote}>No employees match this filter.</div>
                    ) : (
                        filteredEmployees.map((emp) => {
                            const status = statusByEmployee[emp.id] || "PRESENT";
                            return (
                                <div key={emp.id} style={styles.tableRow}>
                                    <span style={styles.colName}>
                                        <span style={styles.avatar}>{initials(emp.name)}</span>
                                        <span>
                                            <div style={styles.empName}>{emp.name}</div>
                                            {emp.employeeCode && (
                                                <div style={styles.empCode}>{emp.employeeCode}</div>
                                            )}
                                        </span>
                                    </span>
                                    <span style={styles.colTeam}>{emp.team || "—"}</span>
                                    <span style={styles.colStatus}>
                                        {(Object.keys(STATUS_META) as AttStatus[]).map((s) => (
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
                                        ))}
                                    </span>
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
        gap: 8,
    },
    colName: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 },
    colTeam: { width: 160, flexShrink: 0, color: "#6b7280" },
    colStatus: { display: "flex", gap: 6, flexShrink: 0 },
    avatar: {
        width: 32,
        height: 32,
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
    empName: { fontSize: fontSize.base, color: "#1a1a2e", fontWeight: fontWeight.medium },
    empCode: { fontSize: fontSize.xs, color: "#9ca3af", marginTop: 1 },
    statusBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
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
