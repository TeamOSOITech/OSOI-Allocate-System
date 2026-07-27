import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    violet: "#5B3DF5",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
};
const GRADIENT = `linear-gradient(90deg, ${BRAND.blue} 0%, ${BRAND.violet} 100%)`;

// --- Minimal inline icon set (no external icon library required) ---
type IconProps = { size?: number; color?: string; style?: CSSProperties };
const iconBase = (size: number) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
});

function Calendar({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}
function RefreshCw({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    );
}
function Box({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
    );
}
function Users({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}
function Gauge({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M4.6 19a9 9 0 1 1 14.8 0" />
            <line x1="12" y1="12" x2="15" y2="9" />
        </svg>
    );
}
function Gift({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z" />
        </svg>
    );
}
function CheckCircle2({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
function ChevronUp({ size = 12, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polyline points="18 15 12 9 6 15" />
        </svg>
    );
}
function ChevronDown({ size = 12, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}
function Send({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    );
}
function Undo2({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
        </svg>
    );
}
function Zap({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}
function Hand({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path d="M6 14v-2a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3a8 8 0 0 0 8 8h1a7 7 0 0 0 7-7v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
        </svg>
    );
}
function InfoCircle({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    );
}

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

type DailyWorkBatch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
};

type Employee = {
    id: string;
    name: string;
    employeeCode: string | null;
    team?: string | null;
    department?: string | null;
};
type AttendanceRow = { employeeId: string; status: string };

function formatDisplayDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

// Deterministic pastel avatar color from a name, so the same person always
// gets the same color across sessions.
const AVATAR_PALETTE = ["#E9E4FB", "#FCE7D6", "#DCEFFB", "#FCE4EC", "#E1F3EC", "#EDEBFF"];
const AVATAR_TEXT = ["#6D4FE0", "#C2761B", "#1785B0", "#C2447A", "#1E9A78", "#5B3DF5"];
function avatarColors(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const idx = hash % AVATAR_PALETTE.length;
    return { bg: AVATAR_PALETTE[idx], fg: AVATAR_TEXT[idx] };
}
function initials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function withAlpha(hex: string, alpha: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Tab = "smart" | "manual";

export default function Allocation() {
    const isMobile = useIsMobile();
    const [tab, setTab] = useState<Tab>("smart");

    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [presentIds, setPresentIds] = useState<Set<string>>(new Set());

    const [selectedId, setSelectedId] = useState("");
    const [productFilter, setProductFilter] = useState("");
    const [teamFilter, setTeamFilter] = useState("");
    const [departmentFilter, setDepartmentFilter] = useState("");

    const [qtyByEmployee, setQtyByEmployee] = useState<Record<string, string>>({});
    const [onLeaveIds, setOnLeaveIds] = useState<Set<string>>(new Set());

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadInitial = async () => {
        setLoading(true);
        setError(null);
        try {
            const [batchRes, empRes] = await Promise.all([
                authFetch(`${API_BASE}/api/daily-work`),
                authFetch(`${API_BASE}/api/employees`),
            ]);
            const batchJson = await batchRes.json();
            const empJson = await empRes.json();
            if (!batchRes.ok || !batchJson.success)
                throw new Error(batchJson.message || "Failed to load batches");
            if (!empRes.ok) throw new Error("Failed to load employees");
            const batchList: DailyWorkBatch[] = batchJson.data || [];
            setBatches(batchList);
            setEmployees(Array.isArray(empJson) ? empJson : empJson.data || []);
            setSelectedId((prev) => {
                if (prev && batchList.some((b) => b.id === prev && b.pendingQty > 0)) return prev;
                return batchList.find((b) => b.pendingQty > 0)?.id || "";
            });
        } catch (err: any) {
            setError(err.message || "Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadInitial();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const products = useMemo(
        () => Array.from(new Set(batches.map((b) => b.productName).filter(Boolean))) as string[],
        [batches]
    );
    const pendingBatches = useMemo(() => {
        let list = batches.filter((b) => b.pendingQty > 0);
        if (productFilter) list = list.filter((b) => b.productName === productFilter);
        return list;
    }, [batches, productFilter]);

    useEffect(() => {
        if (selectedId && !pendingBatches.some((b) => b.id === selectedId)) {
            setSelectedId("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productFilter]);

    const selectedBatch = useMemo(
        () => batches.find((b) => b.id === selectedId) || null,
        [batches, selectedId]
    );

    // Load who's marked present for this batch's date, so allocation only
    // targets people who actually showed up.
    useEffect(() => {
        if (!selectedBatch) {
            setPresentIds(new Set());
            return;
        }
        (async () => {
            try {
                const res = await authFetch(
                    `${API_BASE}/api/attendance?date=${selectedBatch.workDate}`
                );
                const json = await res.json();
                if (res.ok && json.success) {
                    const present = (json.data as AttendanceRow[])
                        .filter((r) => r.status === "PRESENT")
                        .map((r) => r.employeeId);
                    setPresentIds(new Set(present));
                }
            } catch {
                setPresentIds(new Set());
            }
        })();
        setQtyByEmployee({});
        setOnLeaveIds(new Set());
        setSuccess(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBatch?.id]);

    const teams = useMemo(
        () => Array.from(new Set(employees.map((e) => e.team).filter(Boolean))) as string[],
        [employees]
    );
    const departments = useMemo(
        () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
        [employees]
    );

    const visibleEmployees = useMemo(() => {
        let list =
            presentIds.size === 0 ? employees : employees.filter((e) => presentIds.has(e.id));
        if (teamFilter) list = list.filter((e) => e.team === teamFilter);
        if (departmentFilter) list = list.filter((e) => e.department === departmentFilter);
        return list;
    }, [employees, presentIds, teamFilter, departmentFilter]);

    const eligibleForSmart = useMemo(
        () => visibleEmployees.filter((e) => !onLeaveIds.has(e.id)),
        [visibleEmployees, onLeaveIds]
    );

    const baseQty =
        selectedBatch && eligibleForSmart.length > 0
            ? Math.floor(selectedBatch.pendingQty / eligibleForSmart.length)
            : 0;
    const leftover =
        selectedBatch && eligibleForSmart.length > 0
            ? selectedBatch.pendingQty - baseQty * eligibleForSmart.length
            : 0;

    const totalEntered = useMemo(
        () => Object.values(qtyByEmployee).reduce((sum, v) => sum + (Number(v) || 0), 0),
        [qtyByEmployee]
    );
    const remaining = selectedBatch ? selectedBatch.pendingQty - totalEntered : 0;
    const hasEntries = Object.values(qtyByEmployee).some((v) => (Number(v) || 0) > 0);

    const setQty = (employeeId: string, value: number) => {
        if (onLeaveIds.has(employeeId)) return;
        setQtyByEmployee((prev) => ({ ...prev, [employeeId]: String(Math.max(0, value)) }));
    };

    const toggleLeave = (employeeId: string) => {
        setOnLeaveIds((prev) => {
            const next = new Set(prev);
            if (next.has(employeeId)) next.delete(employeeId);
            else next.add(employeeId);
            return next;
        });
        setQtyByEmployee((prev) => ({ ...prev, [employeeId]: "0" }));
    };

    const handleAutoDistribute = () => {
        if (!selectedBatch || eligibleForSmart.length === 0) return;
        const next: Record<string, string> = {};
        eligibleForSmart.forEach((emp, i) => {
            const qty = baseQty + (i < leftover ? 1 : 0);
            next[emp.id] = String(qty);
        });
        onLeaveIds.forEach((id) => {
            next[id] = "0";
        });
        setQtyByEmployee(next);
        setSuccess(null);
        setError(null);
    };

    const handleUndo = () => {
        setQtyByEmployee({});
        setError(null);
    };

    const handleSubmit = async () => {
        if (!selectedBatch) return;
        const allocations = Object.entries(qtyByEmployee)
            .filter(([employeeId]) => !onLeaveIds.has(employeeId))
            .map(([employeeId, qty]) => ({ employeeId, qty: Number(qty) || 0 }))
            .filter((a) => a.qty > 0);

        if (allocations.length === 0) {
            setError("Enter at least one quantity greater than 0");
            return;
        }
        if (remaining < 0) {
            setError("Total entered exceeds the pending quantity for this batch");
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const res = await authFetch(`${API_BASE}/api/allocations/manual`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dailyWorkId: selectedBatch.id, allocations }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Allocation failed");
            setSuccess(
                `Allocated ${allocations.reduce((s, a) => s + a.qty, 0)} units. ${json.data.summary.pendingQty} still pending.`
            );
            setQtyByEmployee({});
            setOnLeaveIds(new Set());
            loadInitial();
        } catch (err: any) {
            setError(err.message || "Allocation failed");
        } finally {
            setSubmitting(false);
        }
    };

    const isSmart = tab === "smart";

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.headerRow}>
                <div>
                    <h1 style={styles.title}>
                        {isSmart ? "Smart Allocation" : "Manual Allocation"}
                    </h1>
                    <p style={styles.subtitle}>
                        {isSmart
                            ? "Automatically distribute cases equally among available employees."
                            : "Hand out exact quantities per employee for a pending batch."}
                    </p>
                </div>
                <div style={styles.headerActions}>
                    {selectedBatch && (
                        <div style={styles.dateBadge}>
                            <Calendar size={14} color="#6b7280" />
                            <span>{formatDisplayDate(selectedBatch.workDate)}</span>
                        </div>
                    )}
                    <button style={styles.refreshBtn} onClick={loadInitial} disabled={loading}>
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </div>

            <div style={styles.tabBar}>
                <button
                    style={{ ...styles.tabBtn, ...(isSmart ? styles.tabBtnActive : {}) }}
                    onClick={() => setTab("smart")}
                >
                    <Zap size={14} />
                    Smart Allocation
                </button>
                <button
                    style={{ ...styles.tabBtn, ...(!isSmart ? styles.tabBtnActive : {}) }}
                    onClick={() => setTab("manual")}
                >
                    <Hand size={14} />
                    Manual Allocation
                </button>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}
            {success && <div style={styles.successBanner}>{success}</div>}

            <div style={styles.card}>
                <div style={isMobile ? styles.batchRowMobile : styles.batchRow}>
                    <div
                        style={
                            isMobile
                                ? { ...styles.productField, width: "100%" }
                                : styles.productField
                        }
                    >
                        <label style={styles.label}>Product</label>
                        <select
                            style={styles.select}
                            value={productFilter}
                            onChange={(e) => setProductFilter(e.target.value)}
                        >
                            <option value="">All Products</option>
                            {products.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={styles.batchField}>
                        <label style={styles.label}>Select Daily Work batch</label>
                        <select
                            style={styles.select}
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            disabled={loading}
                        >
                            <option value="">
                                {loading ? "Loading..." : "-- Select batch --"}
                            </option>
                            {pendingBatches.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {formatDisplayDate(b.workDate)} • {b.productName || "Unknown"} •
                                    Pending {b.pendingQty}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {selectedBatch && (
                <>
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div style={styles.filterField}>
                            <label style={styles.label}>Team</label>
                            <select
                                style={styles.select}
                                value={teamFilter}
                                onChange={(e) => setTeamFilter(e.target.value)}
                            >
                                <option value="">All Teams</option>
                                {teams.map((t) => (
                                    <option key={t} value={t}>
                                        {t}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div style={styles.filterField}>
                            <label style={styles.label}>Department</label>
                            <select
                                style={styles.select}
                                value={departmentFilter}
                                onChange={(e) => setDepartmentFilter(e.target.value)}
                            >
                                <option value="">All Departments</option>
                                {departments.map((d) => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {isSmart && (
                            <div style={styles.infoBox}>
                                <InfoCircle
                                    size={15}
                                    color={BRAND.violet}
                                    style={{ flexShrink: 0, marginTop: 1 }}
                                />
                                <div>
                                    <div style={styles.infoTitle}>About Smart Allocation</div>
                                    <div style={styles.infoText}>
                                        base_qty = floor(total_qty / present_count). Leftover units
                                        go one by one to the first employees in the list until
                                        nothing's left.
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={isMobile ? styles.summaryRowMobile : styles.summaryRow}>
                        <SummaryStat
                            icon={Box}
                            label="Total Cases"
                            sub="Total quantity"
                            value={selectedBatch.pendingQty}
                            color={BRAND.violet}
                        />
                        <SummaryStat
                            icon={Users}
                            label="Present Employees"
                            sub="Available to allocate"
                            value={eligibleForSmart.length}
                            color={BRAND.green}
                        />
                        {isSmart ? (
                            <>
                                <SummaryStat
                                    icon={Gauge}
                                    label="Base Allocation"
                                    sub="Per employee (base_qty)"
                                    value={baseQty}
                                    color={BRAND.blue}
                                />
                                <SummaryStat
                                    icon={Gift}
                                    label="Leftover"
                                    sub="Will be distributed"
                                    value={leftover}
                                    color={BRAND.amber}
                                />
                            </>
                        ) : (
                            <>
                                <SummaryStat
                                    icon={Gauge}
                                    label="Total Entered"
                                    sub="Entered so far"
                                    value={totalEntered}
                                    color={BRAND.blue}
                                />
                                <SummaryStat
                                    icon={CheckCircle2}
                                    label="Remaining"
                                    sub="Left to allocate"
                                    value={remaining}
                                    color={remaining < 0 ? BRAND.red : BRAND.amber}
                                />
                            </>
                        )}
                    </div>

                    {isSmart && (
                        <div style={styles.autoDistributeBar}>
                            <div style={styles.autoDistributeText}>
                                <div style={styles.autoDistributeTitle}>
                                    Auto Distribute Equally
                                </div>
                                <div style={styles.autoDistributeSub}>
                                    Click to evenly distribute cases among present employees.
                                </div>
                            </div>
                            <button
                                style={{
                                    ...styles.autoDistributeBtn,
                                    opacity: eligibleForSmart.length === 0 ? 0.5 : 1,
                                }}
                                disabled={eligibleForSmart.length === 0}
                                onClick={handleAutoDistribute}
                            >
                                <Zap size={14} />
                                Auto Distribute
                            </button>
                        </div>
                    )}

                    {presentIds.size === 0 && (
                        <p style={styles.noteWarning}>
                            No PRESENT attendance found for{" "}
                            {formatDisplayDate(selectedBatch.workDate)} — showing all employees.
                            Mark attendance first for an accurate list.
                        </p>
                    )}

                    <div style={styles.tableCard}>
                        <div style={styles.tableHeadRow}>
                            <span style={{ flex: 1.4 }}>
                                Employees ({visibleEmployees.length}{" "}
                                {presentIds.size === 0 ? "" : "Present"})
                            </span>
                            {isSmart && (
                                <span style={styles.tableHeadNote}>
                                    Mark Leave for employees who should not receive allocation
                                </span>
                            )}
                        </div>
                        <div style={styles.tableSubHeadRow}>
                            <span style={{ flex: 1.4 }}>Employee</span>
                            {!isMobile && <span style={{ width: 110 }}>Team</span>}
                            {!isMobile && <span style={{ width: 110 }}>Department</span>}
                            {!isMobile && <span style={{ width: 90 }}>Status</span>}
                            <span style={{ width: 130, textAlign: "right" }}>Case Allocation</span>
                            {isSmart && (
                                <span style={{ width: 80, textAlign: "right" }}>Leave</span>
                            )}
                        </div>

                        {hasEntries && (
                            <div style={styles.undoBar}>
                                <span style={styles.undoBarText}>
                                    {
                                        Object.values(qtyByEmployee).filter(
                                            (v) => (Number(v) || 0) > 0
                                        ).length
                                    }{" "}
                                    quantity entered — not saved yet.
                                </span>
                                <button style={styles.undoButton} onClick={handleUndo}>
                                    <Undo2 size={13} />
                                    Undo All
                                </button>
                            </div>
                        )}

                        {visibleEmployees.length === 0 ? (
                            <div style={styles.emptyNote}>No employees to show.</div>
                        ) : (
                            visibleEmployees.map((emp) => {
                                const { bg, fg } = avatarColors(emp.name);
                                const onLeave = onLeaveIds.has(emp.id);
                                const qty = Number(qtyByEmployee[emp.id] || 0);
                                return (
                                    <div
                                        key={emp.id}
                                        style={{ ...styles.tableRow, opacity: onLeave ? 0.5 : 1 }}
                                    >
                                        <div style={{ ...styles.empInfo, flex: 1.4 }}>
                                            <div
                                                style={{
                                                    ...styles.avatar,
                                                    background: bg,
                                                    color: fg,
                                                }}
                                            >
                                                {initials(emp.name)}
                                            </div>
                                            <div>
                                                <div style={styles.empName}>{emp.name}</div>
                                                {emp.employeeCode && (
                                                    <div style={styles.empCode}>
                                                        {emp.employeeCode}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {!isMobile && (
                                            <span
                                                style={{
                                                    width: 110,
                                                    fontSize: 13,
                                                    color: "#374151",
                                                }}
                                            >
                                                {emp.team || "-"}
                                            </span>
                                        )}
                                        {!isMobile && (
                                            <span
                                                style={{
                                                    width: 110,
                                                    fontSize: 13,
                                                    color: "#374151",
                                                }}
                                            >
                                                {emp.department || "-"}
                                            </span>
                                        )}
                                        {!isMobile && (
                                            <span style={{ width: 90 }}>
                                                <span style={styles.statusBadge}>
                                                    <span style={styles.statusDot} />
                                                    Present
                                                </span>
                                            </span>
                                        )}
                                        <div
                                            style={{
                                                width: 130,
                                                display: "flex",
                                                justifyContent: "flex-end",
                                            }}
                                        >
                                            <div style={styles.stepper}>
                                                <input
                                                    style={{
                                                        ...styles.stepperInput,
                                                        background: onLeave ? "#f3f4f6" : "#fff",
                                                    }}
                                                    type="number"
                                                    min={0}
                                                    disabled={onLeave}
                                                    value={qtyByEmployee[emp.id] || ""}
                                                    placeholder="0"
                                                    onChange={(e) =>
                                                        setQty(emp.id, Number(e.target.value) || 0)
                                                    }
                                                />
                                                <div style={styles.stepperArrows}>
                                                    <button
                                                        style={styles.stepperArrowBtn}
                                                        disabled={onLeave}
                                                        onClick={() => setQty(emp.id, qty + 1)}
                                                        aria-label="Increase"
                                                    >
                                                        <ChevronUp size={11} />
                                                    </button>
                                                    <button
                                                        style={styles.stepperArrowBtn}
                                                        disabled={onLeave}
                                                        onClick={() => setQty(emp.id, qty - 1)}
                                                        aria-label="Decrease"
                                                    >
                                                        <ChevronDown size={11} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        {isSmart && (
                                            <div
                                                style={{
                                                    width: 80,
                                                    display: "flex",
                                                    justifyContent: "flex-end",
                                                }}
                                            >
                                                <label style={styles.leaveLabel}>
                                                    <input
                                                        type="checkbox"
                                                        checked={onLeave}
                                                        onChange={() => toggleLeave(emp.id)}
                                                        style={{ cursor: "pointer" }}
                                                    />
                                                    On Leave
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}

                        {visibleEmployees.length > 0 && (
                            <div style={styles.totalsRow}>
                                <TotalStat
                                    label="Total Cases"
                                    value={selectedBatch.pendingQty}
                                    color="#1a1a2e"
                                />
                                <TotalStat
                                    label="Total Allocated"
                                    value={totalEntered}
                                    color={BRAND.violet}
                                />
                                <TotalStat
                                    label="Remaining"
                                    value={remaining}
                                    color={remaining < 0 ? BRAND.red : BRAND.green}
                                    withCheck={remaining === 0}
                                />
                            </div>
                        )}
                    </div>

                    <button
                        style={{
                            ...styles.submitButton,
                            opacity: submitting ? 0.6 : 1,
                            cursor: submitting ? "not-allowed" : "pointer",
                        }}
                        disabled={submitting}
                        onClick={handleSubmit}
                    >
                        <Send size={15} />
                        {submitting ? "Allocating..." : "Submit Allocation"}
                    </button>
                    <p style={styles.footnote}>
                        Please review allocations before submitting. Employees marked as Leave will
                        not receive any cases.
                    </p>
                </>
            )}
        </div>
    );
}

function SummaryStat({
    icon: Icon,
    label,
    sub,
    value,
    color,
}: {
    icon: typeof Box;
    label: string;
    sub: string;
    value: number;
    color: string;
}) {
    return (
        <div style={styles.statCard}>
            <div style={{ ...styles.statIconWrap, background: withAlpha(color, 0.12) }}>
                <Icon size={17} color={color} />
            </div>
            <div>
                <div style={{ ...styles.statValue, color }}>{value}</div>
                <div style={styles.statLabel}>{label}</div>
                <div style={styles.statSub}>{sub}</div>
            </div>
        </div>
    );
}

function TotalStat({
    label,
    value,
    color,
    withCheck,
}: {
    label: string;
    value: number;
    color: string;
    withCheck?: boolean;
}) {
    return (
        <div style={styles.totalStat}>
            <div style={styles.totalStatLabel}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ ...styles.totalStatValue, color }}>{value}</div>
                {withCheck && <CheckCircle2 size={16} color={BRAND.green} />}
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { padding: "28px 32px", width: "100%", boxSizing: "border-box" },
    rootMobile: { padding: "16px", width: "100%", boxSizing: "border-box" },
    headerRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 18,
    },
    title: { fontSize: 24, fontWeight: 800, color: "#1a1a2e", margin: 0 },
    subtitle: { fontSize: 13, color: "#6b7280", marginTop: 6 },
    headerActions: { display: "flex", gap: 10, alignItems: "center" },
    dateBadge: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "9px 14px",
        fontSize: 13,
        color: "#374151",
        fontWeight: 500,
    },
    refreshBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
    },
    tabBar: {
        display: "flex",
        gap: 8,
        background: "#fff",
        border: "1px solid #ececec",
        borderRadius: 12,
        padding: 6,
        marginBottom: 18,
    },
    tabBtn: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "11px 16px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "#6b7280",
        fontWeight: 700,
        fontSize: 13.5,
        cursor: "pointer",
    },
    tabBtnActive: {
        background: GRADIENT,
        color: "#fff",
        boxShadow: "0 2px 8px rgba(91,61,245,0.25)",
    },
    errorBanner: {
        background: "#FEF2F2",
        color: BRAND.red,
        border: "1px solid #FECACA",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 16,
    },
    successBanner: {
        background: "rgba(46,187,168,0.1)",
        color: BRAND.green,
        border: `1px solid ${BRAND.green}`,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 16,
    },
    card: {
        background: "#fff",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        marginBottom: 18,
    },
    label: { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 },
    batchRow: { display: "flex", gap: 16, alignItems: "flex-start" },
    batchRowMobile: { display: "flex", flexDirection: "column", gap: 14 },
    productField: { width: 220, flexShrink: 0 },
    batchField: { flex: 1, minWidth: 0 },
    select: {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #d1d5db",
        fontSize: 13.5,
    },
    filterRow: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1.6fr",
        gap: 14,
        marginBottom: 18,
        alignItems: "stretch",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginBottom: 16,
    },
    filterField: {
        background: "#fff",
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    },
    infoBox: {
        display: "flex",
        gap: 10,
        background: "#F3EEFE",
        border: "1px solid #E4D9FC",
        borderRadius: 12,
        padding: 14,
    },
    infoTitle: { fontSize: 12.5, fontWeight: 700, color: BRAND.violet, marginBottom: 3 },
    infoText: { fontSize: 11.5, color: "#5b4b8a", lineHeight: 1.5 },
    summaryRow: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        marginBottom: 18,
    },
    summaryRowMobile: {
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 10,
        marginBottom: 16,
    },
    statCard: {
        background: "#fff",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    },
    statIconWrap: {
        width: 38,
        height: 38,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    statValue: { fontSize: 20, fontWeight: 800, lineHeight: 1.1 },
    statLabel: { fontSize: 12, color: "#374151", fontWeight: 600, marginTop: 3 },
    statSub: { fontSize: 10.5, color: "#9ca3af", marginTop: 1 },
    autoDistributeBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 14,
        background: "#fff",
        borderRadius: 12,
        padding: "16px 20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        marginBottom: 18,
        flexWrap: "wrap",
    },
    autoDistributeText: {},
    autoDistributeTitle: { fontSize: 13.5, fontWeight: 700, color: "#1a1a2e" },
    autoDistributeSub: { fontSize: 12, color: "#6b7280", marginTop: 2 },
    autoDistributeBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "11px 18px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        flexShrink: 0,
    },
    noteWarning: {
        fontSize: 12,
        color: BRAND.amber,
        marginBottom: 14,
        background: "rgba(245,158,11,0.08)",
        padding: "10px 14px",
        borderRadius: 8,
    },
    tableCard: {
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        overflow: "hidden",
        marginBottom: 18,
    },
    tableHeadRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 20px 4px",
        fontSize: 13,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    tableHeadNote: { fontSize: 11.5, color: "#9ca3af", fontWeight: 500 },
    tableSubHeadRow: {
        display: "flex",
        padding: "8px 20px 12px",
        borderBottom: "1px solid #f1f1f1",
        fontSize: 11,
        fontWeight: 700,
        color: "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        gap: 8,
    },
    tableRow: {
        display: "flex",
        alignItems: "center",
        padding: "12px 20px",
        borderBottom: "1px solid #f1f1f1",
        gap: 8,
        flexWrap: "wrap",
    },
    empInfo: { display: "flex", alignItems: "center", gap: 12 },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
    },
    empName: { fontSize: 13.5, color: "#1a1a2e", fontWeight: 600 },
    empCode: { fontSize: 11.5, color: "#9ca3af", marginTop: 1 },
    statusBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: BRAND.green,
        fontWeight: 600,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: BRAND.green,
        display: "inline-block",
    },
    stepper: { display: "flex", alignItems: "center", gap: 4 },
    stepperInput: {
        width: 58,
        padding: "7px 8px",
        borderRadius: 8,
        border: "1px solid #d1d5db",
        fontSize: 13,
        textAlign: "center",
        fontWeight: 600,
        color: BRAND.blue,
    },
    stepperArrows: { display: "flex", flexDirection: "column", gap: 1 },
    stepperArrowBtn: {
        width: 20,
        height: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid #d1d5db",
        background: "#fff",
        color: "#6b7280",
        borderRadius: 4,
        cursor: "pointer",
        padding: 0,
    },
    leaveLabel: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        color: "#6b7280",
        fontWeight: 500,
        whiteSpace: "nowrap",
    },
    emptyNote: { padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: 13 },
    undoBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 20px",
        background: "#FFFBEB",
        borderBottom: "1px solid #FDE68A",
        flexWrap: "wrap",
        gap: 10,
    },
    undoBarText: { fontSize: 12.5, color: "#92400E" },
    undoButton: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 7,
        border: `1px solid ${BRAND.amber}`,
        background: "#fff",
        color: BRAND.amber,
        fontWeight: 600,
        fontSize: 12,
        cursor: "pointer",
    },
    totalsRow: {
        display: "flex",
        justifyContent: "space-around",
        padding: "16px 20px",
        background: "#fafafa",
        borderTop: "1px solid #f1f1f1",
        flexWrap: "wrap",
        gap: 12,
    },
    totalStat: { textAlign: "center" },
    totalStatLabel: { fontSize: 11.5, color: "#6b7280", marginBottom: 4 },
    totalStatValue: { fontSize: 18, fontWeight: 800 },
    submitButton: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "14px",
        borderRadius: 10,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: 700,
        fontSize: 14,
    },
    footnote: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 10 },
};
