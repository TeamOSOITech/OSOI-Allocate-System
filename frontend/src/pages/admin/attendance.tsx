import { useState, useEffect, useMemo } from "react";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

// --- Minimal inline icon set (no external icon library required) ---
type IconProps = { size?: number; color?: string; className?: string; style?: CSSProperties };
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
function UserCheck2({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="m17 11 2 2 4-4" />
        </svg>
    );
}
function UserX({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="17" y1="8" x2="22" y2="13" />
            <line x1="22" y1="8" x2="17" y2="13" />
        </svg>
    );
}
function Clock({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}
function HelpCircle({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}
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
function RefreshCw({ size = 16, color = "currentColor", className, ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} className={className} {...rest}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    );
}
function Save({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
    );
}
function Info({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    );
}
function ChevronDown({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
};

// Header gradient used for the primary save button and the "Save Attendance" bar
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`; // matches Products/Clients/Landing gradient exactly

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

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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

type Employee = { id: string; name: string; employeeCode: string | null };
type Status = "PRESENT" | "ABSENT" | "LEAVE";

const STATUS_OPTIONS: { value: Status; label: string; color: string; icon: typeof UserCheck2 }[] = [
    { value: "PRESENT", label: "Present", color: BRAND.green, icon: UserCheck2 },
    { value: "ABSENT", label: "Absent", color: BRAND.red, icon: UserX },
    { value: "LEAVE", label: "Leave", color: BRAND.amber, icon: Clock },
];

export default function Attendance() {
    const isMobile = useIsMobile();
    const date = todayStr();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [statusByEmployee, setStatusByEmployee] = useState<Record<string, Status>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [empRes, attRes] = await Promise.all([
                authFetch(`${API_BASE}/api/employees`),
                authFetch(`${API_BASE}/api/attendance?date=${date}`),
            ]);
            const empJson = await empRes.json();
            const attJson = await attRes.json();
            if (!empRes.ok) throw new Error("Failed to load employees");

            const empList: Employee[] = Array.isArray(empJson) ? empJson : empJson.data || [];
            setEmployees(empList);

            const existing: Record<string, Status> = {};
            if (attRes.ok && attJson.success) {
                for (const row of attJson.data) {
                    existing[row.employeeId] = row.status;
                }
            }
            setStatusByEmployee(existing);
        } catch (err: any) {
            setError(err.message || "Failed to load attendance");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const counts = useMemo(() => {
        const c = { PRESENT: 0, ABSENT: 0, LEAVE: 0, unmarked: 0 };
        for (const emp of employees) {
            const s = statusByEmployee[emp.id];
            if (s) c[s]++;
            else c.unmarked++;
        }
        return c;
    }, [employees, statusByEmployee]);

    const markAll = (status: Status) => {
        const next: Record<string, Status> = {};
        for (const emp of employees) next[emp.id] = status;
        setStatusByEmployee(next);
    };

    const handleSave = async () => {
        const records = employees
            .filter((emp) => statusByEmployee[emp.id])
            .map((emp) => ({ employeeId: emp.id, status: statusByEmployee[emp.id] }));

        if (records.length === 0) {
            setError("Mark at least one employee before saving");
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await authFetch(`${API_BASE}/api/attendance/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date, records }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to save attendance");
            setSuccess(`Attendance saved for ${records.length} employee(s).`);
        } catch (err: any) {
            setError(err.message || "Failed to save attendance");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.headerRow}>
                <div style={styles.pageTitleBlock}>
                    <h1 style={styles.title}>Attendance</h1>
                    <p style={styles.subtitle}>
                        <Calendar size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
                        {date} — mark who's present before running Smart Auto Allocation.
                    </p>
                </div>
                <div style={styles.headerActions}>
                    <div style={styles.dateBadge}>
                        <Calendar size={14} color="#6b7280" />
                        <span>{date}</span>
                        <ChevronDown size={14} color="#9ca3af" />
                    </div>
                    <button
                        style={styles.refreshBtn}
                        onClick={loadData}
                        disabled={loading}
                        aria-label="Refresh"
                    >
                        <RefreshCw size={14} className={loading ? "spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}
            {success && <div style={styles.successBanner}>{success}</div>}

            <div style={isMobile ? styles.summaryRowMobile : styles.summaryRow}>
                <SummaryChip
                    icon={Users}
                    label="Present"
                    value={counts.PRESENT}
                    color={BRAND.green}
                />
                <SummaryChip icon={UserX} label="Absent" value={counts.ABSENT} color={BRAND.red} />
                <SummaryChip icon={Clock} label="Leave" value={counts.LEAVE} color={BRAND.amber} />
                <SummaryChip
                    icon={HelpCircle}
                    label="Unmarked"
                    value={counts.unmarked}
                    color={BRAND.lightBlue}
                />
            </div>

            <div style={styles.quickActions}>
                {STATUS_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                        <button
                            key={opt.value}
                            style={{
                                ...styles.quickBtn,
                                borderColor: withAlpha(opt.color, 0.35),
                                color: opt.color,
                            }}
                            onClick={() => markAll(opt.value)}
                        >
                            <Icon size={13} />
                            Mark all {opt.label}
                        </button>
                    );
                })}
            </div>

            <div style={styles.card}>
                <div style={styles.tableHead}>
                    <span>Employee</span>
                    <span style={styles.tableHeadRight}>
                        Status
                        <Info size={13} color="#9ca3af" />
                    </span>
                </div>

                {loading ? (
                    <div style={styles.emptyNote}>Loading employees...</div>
                ) : employees.length === 0 ? (
                    <div style={styles.emptyNote}>No employees found.</div>
                ) : (
                    employees.map((emp) => {
                        const { bg, fg } = avatarColors(emp.name);
                        return (
                            <div key={emp.id} style={styles.row}>
                                <div style={styles.empInfo}>
                                    <div style={{ ...styles.avatar, background: bg, color: fg }}>
                                        {initials(emp.name)}
                                    </div>
                                    <span style={styles.empName}>
                                        {emp.name}
                                        {emp.employeeCode ? (
                                            <span style={styles.empCode}>
                                                {" "}
                                                ({emp.employeeCode})
                                            </span>
                                        ) : null}
                                    </span>
                                </div>
                                <div style={styles.pillGroup}>
                                    {STATUS_OPTIONS.map((opt) => {
                                        const active = statusByEmployee[emp.id] === opt.value;
                                        const Icon = opt.icon;
                                        return (
                                            <button
                                                key={opt.value}
                                                style={{
                                                    ...styles.pill,
                                                    background: active ? opt.color : "#fff",
                                                    borderColor: active ? opt.color : "#e5e7eb",
                                                    color: active ? "#fff" : opt.color,
                                                }}
                                                onClick={() =>
                                                    setStatusByEmployee((prev) => ({
                                                        ...prev,
                                                        [emp.id]: opt.value,
                                                    }))
                                                }
                                            >
                                                <Icon size={13} />
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {employees.length > 0 && (
                <button
                    style={{ ...styles.saveButton, opacity: saving ? 0.6 : 1 }}
                    disabled={saving}
                    onClick={handleSave}
                >
                    <Save size={15} />
                    {saving ? "Saving..." : "Save Attendance"}
                </button>
            )}
        </div>
    );
}

function withAlpha(hex: string, alpha: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function SummaryChip({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: typeof Users;
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div style={{ ...styles.chip, borderTop: `3px solid ${color}` }}>
            <div style={{ ...styles.chipIconWrap, background: withAlpha(color, 0.12) }}>
                <Icon size={16} color={color} />
            </div>
            <div>
                <div style={{ ...styles.chipValue, color }}>{value}</div>
                <div style={styles.chipLabel}>{label}</div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        padding: "28px 32px",
        width: "100%",
        boxSizing: "border-box",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    rootMobile: {
        padding: "16px",
        width: "100%",
        boxSizing: "border-box",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    headerRow: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 20,
        minHeight: 48,
    },
    pageTitleBlock: { textAlign: "center" },
    title: { fontSize: fontSize["5xl"], fontWeight: 800, color: "#17181C", margin: 0 },
    subtitle: {
        fontSize: fontSize.base,
        color: "#767F92",
        margin: "4px 0 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    headerActions: {
        position: "absolute",
        right: 0,
        display: "flex",
        gap: 10,
        alignItems: "center",
    },
    dateBadge: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "9px 14px",
        fontSize: fontSize.base,
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
        fontSize: fontSize.base,
        fontWeight: 600,
        cursor: "pointer",
    },
    errorBanner: {
        background: "#FEF2F2",
        color: BRAND.red,
        border: "1px solid #FECACA",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: fontSize.base,
        marginBottom: 16,
    },
    successBanner: {
        background: "rgba(46,187,168,0.1)",
        color: BRAND.green,
        border: `1px solid ${BRAND.green}`,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: fontSize.base,
        marginBottom: 16,
    },
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
    chip: {
        background: "#fff",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    },
    chipIconWrap: {
        width: 34,
        height: 34,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    chipValue: { fontSize: fontSize["4xl"], fontWeight: 800, lineHeight: 1.1 },
    chipLabel: { fontSize: fontSize.sm, color: "#6b7280", marginTop: 2 },
    quickActions: { display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" },
    quickBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 8,
        border: "1px solid",
        background: "#fff",
        fontSize: fontSize.base,
        fontWeight: 600,
        cursor: "pointer",
    },
    card: {
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        overflow: "hidden",
    },
    tableHead: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 20px",
        background: "#fafafa",
        borderBottom: "1px solid #f1f1f1",
        fontSize: fontSize.sm,
        fontWeight: 700,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    tableHeadRight: { display: "flex", alignItems: "center", gap: 6 },
    row: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 20px",
        borderBottom: "1px solid #f1f1f1",
        gap: 12,
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
        fontSize: fontSize.sm,
        fontWeight: 700,
        flexShrink: 0,
    },
    empName: { fontSize: fontSize.md, color: "#1a1a2e", fontWeight: 600 },
    empCode: { color: "#9ca3af", fontWeight: 500 },
    pillGroup: { display: "flex", gap: 8 },
    pill: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 13px",
        borderRadius: 20,
        border: "1px solid",
        fontSize: fontSize.sm,
        fontWeight: 600,
        cursor: "pointer",
    },
    emptyNote: { padding: "30px", textAlign: "center", color: "#9ca3af", fontSize: fontSize.base },
    saveButton: {
        marginTop: 20,
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
        fontSize: fontSize.md,
        cursor: "pointer",
    },
};
