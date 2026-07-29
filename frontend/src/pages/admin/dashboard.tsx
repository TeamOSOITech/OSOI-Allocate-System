import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

// Same three-color brand palette used everywhere else (header.tsx brandRail,
// clients.tsx avatars, sidebar active state, etc.)
const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
};

interface User {
    name: string;
    role: string;
}

interface DashboardProps {
    user: User;
    onLogout: () => void;
}

type DailyWorkBatch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
    status: string;
};

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

function formatDisplayDate(iso: string) {
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

function statusBadgeStyle(status: string): CSSProperties {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETED") {
        return { background: "rgba(46,187,168,0.12)", color: BRAND.green };
    }
    if (s === "ASSIGNED" || s === "IN_PROGRESS") {
        return { background: "rgba(8,161,206,0.12)", color: BRAND.lightBlue };
    }
    return { background: "rgba(245,158,11,0.14)", color: "#B45309" }; // PENDING / default
}

export default function Dashboard({ user }: DashboardProps) {
    const isMobile = useIsMobile();

    const [employeeCount, setEmployeeCount] = useState<number | null>(null);
    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [errorDismissed, setErrorDismissed] = useState(false);

    const fetchEmployeeCount = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employees`);
            const json = await res.json();
            if (!res.ok) return;
            // employees endpoint returns a plain array, not { data: [...] }
            const list = Array.isArray(json) ? json : json.data || [];
            setEmployeeCount(list.length);
        } catch (err) {
            console.error("Failed to fetch employee count:", err);
        }
    };

    const fetchTodayBatches = async () => {
        setLoading(true);
        setError("");
        setErrorDismissed(false);
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work?date=${todayStr()}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setBatches(json.data || []);
        } catch (err: any) {
            console.error("Failed to fetch today's daily work:", err);
            setError(err?.message || "Failed to load today's daily work.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployeeCount();
        fetchTodayBatches();
    }, []);

    const totalQtyToday = useMemo(
        () => batches.reduce((sum, b) => sum + (b.totalQty || 0), 0),
        [batches]
    );
    const allocatedQtyToday = useMemo(
        () => batches.reduce((sum, b) => sum + (b.allocatedQty || 0), 0),
        [batches]
    );
    const pendingQtyToday = useMemo(
        () => batches.reduce((sum, b) => sum + (b.pendingQty || 0), 0),
        [batches]
    );

    const pendingBatches = useMemo(() => batches.filter((b) => (b.pendingQty || 0) > 0), [batches]);

    const chartData = useMemo(
        () =>
            batches.map((b) => ({
                name: b.productName || "Unnamed",
                Total: b.totalQty || 0,
                Allocated: b.allocatedQty || 0,
                Pending: b.pendingQty || 0,
            })),
        [batches]
    );

    const kpis = [
        {
            label: "Total Employees",
            value: employeeCount === null ? "—" : employeeCount,
            icon: "ti ti-users",
            gradient: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            tip: "Total employees in your organization",
        },
        {
            label: "Today's Total Qty",
            value: totalQtyToday,
            icon: "ti ti-package",
            gradient: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.green})`,
            tip: "Sum of total_qty across today's daily work batches",
        },
        {
            label: "Today's Allocated Qty",
            value: allocatedQtyToday,
            icon: "ti ti-circle-check",
            gradient: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.lightBlue})`,
            tip: "Quantity already split across present employees today",
        },
        {
            label: "Today's Pending Qty",
            value: pendingQtyToday,
            icon: "ti ti-hourglass",
            gradient: `linear-gradient(135deg, ${BRAND.amber}, #EA580C)`,
            tip: "Quantity still waiting to be allocated today",
        },
    ];

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            {/* Thin three-color brand rail — same signature strip used in header.tsx */}
            <div style={styles.topBar} />

            <div style={isMobile ? styles.contentBodyMobile : styles.contentBody}>
                {/* Page header: icon badge + title + subtitle, same layout as
                    dailywork.tsx / employees.tsx page headers. */}
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div style={styles.headerIcon}>
                            <i
                                className="ti ti-layout-dashboard"
                                style={{ fontSize: fontSize["4xl"] }}
                            />
                        </div>
                        <div>
                            <h1 style={styles.pageTitle}>Dashboard</h1>
                            <p style={styles.pageSubtitle}>
                                Welcome, <strong>{user?.name || user?.role}</strong> — here's
                                today's snapshot.
                            </p>
                        </div>
                    </div>
                    <div style={styles.dateBadge}>
                        <i className="ti ti-calendar" style={{ fontSize: fontSize.base }} />
                        {formatDisplayDate(todayStr())}
                    </div>
                </div>

                {error && !errorDismissed && (
                    <div style={styles.errorBanner}>
                        <i className="ti ti-alert-triangle" style={{ fontSize: fontSize.lg }} />
                        <span style={{ flex: 1 }}>{error}</span>
                        <button
                            style={styles.errorDismissBtn}
                            onClick={() => setErrorDismissed(true)}
                            aria-label="Dismiss"
                            type="button"
                        >
                            <i className="ti ti-x" style={{ fontSize: fontSize.base }} />
                        </button>
                    </div>
                )}

                {/* KPI cards */}
                <div style={isMobile ? styles.kpiGridMobile : styles.kpiGrid}>
                    {kpis.map((kpi) => (
                        <div key={kpi.label} style={styles.kpiCard} title={kpi.tip}>
                            <div style={styles.kpiTop}>
                                <div style={{ ...styles.kpiIconWrap, background: kpi.gradient }}>
                                    <i
                                        className={kpi.icon}
                                        style={{ fontSize: fontSize["2xl"], color: "#fff" }}
                                    />
                                </div>
                                <i
                                    className="ti ti-info-circle"
                                    style={{ fontSize: fontSize.md, color: "#c7cbe0" }}
                                    aria-hidden="true"
                                />
                            </div>
                            <div style={styles.kpiValue}>
                                {loading && kpi.label !== "Total Employees" ? "…" : kpi.value}
                            </div>
                            <div style={styles.kpiLabel}>{kpi.label}</div>
                        </div>
                    ))}
                </div>

                {/* Chart */}
                <div style={styles.panel}>
                    <div style={styles.panelTitleRow}>
                        <div style={styles.panelTitle}>
                            Today's Work — Total vs Allocated vs Pending
                        </div>
                        <div style={styles.panelTitleUnderline} />
                    </div>
                    {chartData.length === 0 && !loading ? (
                        <div style={styles.emptyState}>
                            <div style={styles.emptyIconCircle}>
                                <i
                                    className="ti ti-chart-bar"
                                    style={{ fontSize: fontSize["6xl"], color: BRAND.lightBlue }}
                                />
                            </div>
                            <div style={styles.emptyText}>No daily work logged for today yet.</div>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart
                                data={chartData}
                                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: fontSize.sm, fill: "#6b7280" }}
                                />
                                <YAxis
                                    tick={{ fontSize: fontSize.sm, fill: "#6b7280" }}
                                    allowDecimals={false}
                                />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="Total" fill={BRAND.blue} radius={[4, 4, 0, 0]} />
                                <Bar dataKey="Allocated" fill={BRAND.green} radius={[4, 4, 0, 0]} />
                                <Bar dataKey="Pending" fill={BRAND.amber} radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Pending table */}
                <div style={styles.panel}>
                    <div style={styles.panelTitleRow}>
                        <div style={styles.panelTitle}>Pending Allocations (Today)</div>
                        <div style={styles.panelTitleUnderline} />
                    </div>

                    {loading ? (
                        <div style={styles.emptyState}>
                            <div style={styles.emptyText}>Loading…</div>
                        </div>
                    ) : pendingBatches.length === 0 ? (
                        <div style={styles.emptyState}>
                            <div
                                style={{
                                    ...styles.emptyIconCircle,
                                    background: "rgba(46,187,168,0.1)",
                                }}
                            >
                                <i
                                    className="ti ti-mood-smile"
                                    style={{ fontSize: fontSize["6xl"], color: BRAND.green }}
                                />
                            </div>
                            <div style={styles.emptyText}>
                                Nothing pending — all of today's work is fully allocated.
                            </div>
                        </div>
                    ) : isMobile ? (
                        <div style={styles.cardList}>
                            {pendingBatches.map((b) => (
                                <div key={b.id} style={styles.pendingCard}>
                                    <div style={styles.pendingCardTop}>
                                        <span style={styles.pendingCardProduct}>
                                            {b.productName || "Unnamed"}
                                        </span>
                                        <span
                                            style={{
                                                ...styles.statusBadge,
                                                ...statusBadgeStyle(b.status),
                                            }}
                                        >
                                            {b.status}
                                        </span>
                                    </div>
                                    <div style={styles.pendingCardRow}>
                                        <span>Total: {b.totalQty}</span>
                                        <span>Allocated: {b.allocatedQty}</span>
                                        <span
                                            style={{
                                                color: BRAND.amber,
                                                fontWeight: fontWeight.semibold,
                                            }}
                                        >
                                            Pending: {b.pendingQty}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>Product</th>
                                    <th style={styles.th}>Total Qty</th>
                                    <th style={styles.th}>Allocated</th>
                                    <th style={styles.th}>Pending</th>
                                    <th style={styles.th}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingBatches.map((b) => (
                                    <tr key={b.id}>
                                        <td style={styles.td}>{b.productName || "Unnamed"}</td>
                                        <td style={styles.td}>{b.totalQty}</td>
                                        <td style={styles.td}>{b.allocatedQty}</td>
                                        <td
                                            style={{
                                                ...styles.td,
                                                fontWeight: fontWeight.semibold,
                                                color: BRAND.amber,
                                            }}
                                        >
                                            {b.pendingQty}
                                        </td>
                                        <td style={styles.td}>
                                            <span
                                                style={{
                                                    ...styles.statusBadge,
                                                    ...statusBadgeStyle(b.status),
                                                }}
                                            >
                                                {b.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        width: "100%",
        minHeight: "100%",
        background: "#f4f5fb",
        fontFamily: fontFamily.base,
    },
    rootMobile: {
        width: "100%",
        minHeight: "100%",
        background: "#f0f0f5",
        fontFamily: fontFamily.base,
    },
    // Same signature strip as header.tsx's brandRail — all three brand
    // colors in one gradient, used consistently at the top of the page.
    topBar: {
        height: "4px",
        width: "100%",
        background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
    },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "20px 24px 28px",
    },
    contentBodyMobile: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "14px 14px 22px",
    },

    headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
    headerRowMobile: { display: "flex", flexDirection: "column", gap: "10px" },
    headerLeft: { display: "flex", gap: "14px", alignItems: "flex-start" },
    headerIcon: {
        width: 44,
        height: 44,
        minWidth: 44,
        borderRadius: radius.md,
        background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    pageTitle: {
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.bold,
        color: "#1e1b4b",
        margin: 0,
    },
    pageSubtitle: {
        fontSize: fontSize.sm,
        color: "#64748b",
        margin: "4px 0 0",
        maxWidth: 520,
        lineHeight: 1.5,
    },
    dateBadge: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#fff",
        background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
        padding: "8px 14px",
        borderRadius: radius.md,
        whiteSpace: "nowrap",
        boxShadow: `0 6px 16px rgba(32,66,151,0.28)`,
    },
    errorBanner: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#fef2f2",
        color: "#b91c1c",
        border: "1px solid #fecaca",
        borderRadius: radius.md,
        padding: "10px 14px",
        fontSize: fontSize.base,
    },
    errorDismissBtn: {
        border: "none",
        background: "transparent",
        color: "#b91c1c",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: 4,
    },
    kpiGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
    },
    kpiGridMobile: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
    },
    kpiCard: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    kpiTop: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 14,
    },
    kpiIconWrap: {
        width: 40,
        height: 40,
        minWidth: 40,
        borderRadius: radius.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    kpiValue: {
        fontSize: fontSize["4xl"],
        fontWeight: fontWeight.bold,
        color: "#16233a",
        lineHeight: 1.2,
    },
    kpiLabel: { fontSize: fontSize.sm, color: "#7d90a6", marginTop: 4 },
    panel: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "20px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    panelTitleRow: { marginBottom: 16 },
    panelTitle: {
        fontSize: fontSize.lg,
        fontWeight: fontWeight.bold,
        color: "#16233a",
        textAlign: "left",
    },
    panelTitleUnderline: {
        width: 40,
        height: 3,
        borderRadius: 2,
        background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
        margin: "8px 0 0", // was "8px auto 0" (auto centered it)
    },
    emptyState: {
        padding: "28px 0 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
    },
    emptyIconCircle: {
        width: 56,
        height: 56,
        borderRadius: radius.circle,
        background: "rgba(8,161,206,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    emptyText: { color: "#7d90a6", fontSize: fontSize.base, textAlign: "center" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: {
        textAlign: "left",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#7d90a6",
        padding: "10px 12px",
        borderBottom: "2px solid #eef0f3",
    },
    td: {
        fontSize: fontSize.base,
        color: "#16233a",
        padding: "12px",
        borderBottom: "1px solid #f1f2f4",
    },
    statusBadge: {
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: radius.xl,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    cardList: { display: "flex", flexDirection: "column", gap: 10 },
    pendingCard: {
        border: "1px solid #eef0f3",
        borderRadius: radius.md,
        padding: "12px 14px",
    },
    pendingCardTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    pendingCardProduct: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
    },
    pendingCardRow: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: fontSize.sm,
        color: "#7d90a6",
    },
};
