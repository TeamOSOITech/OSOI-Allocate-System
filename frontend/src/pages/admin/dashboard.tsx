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
import { useTheme } from "../../context/themecontext";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

// blue/lightBlue/green now come from the active theme color (useTheme()
// below) instead of being hardcoded, so this page repaints with the rest
// of the app when the user switches theme color. amber is a fixed status
// color (Pending), not a brand color, so it stays constant across themes.
const STATUS_AMBER = "#F59E0B";

function withAlpha(hex: string, alpha: number) {
    const clean = hex.replace("#", "");
    const n = parseInt(clean, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

// Takes BRAND (from the active theme) so the "in progress" tint tracks the
// theme's light-blue instead of a hardcoded one.
function statusBadgeStyle(
    status: string,
    BRAND: { lightBlue: string; green: string }
): CSSProperties {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETED") {
        return { background: withAlpha(BRAND.green, 0.12), color: BRAND.green };
    }
    if (s === "ASSIGNED" || s === "IN_PROGRESS") {
        return { background: withAlpha(BRAND.lightBlue, 0.12), color: BRAND.lightBlue };
    }
    return { background: "rgba(245,158,11,0.14)", color: "#B45309" }; // PENDING / default
}

// ------------------------------------------------------------
// Month/Year "Compare" helpers — shared by the Manager view's
// Production panel and the Quality view's QC Accuracy panel. A period
// is keyed as "YYYY-MM" (month mode) or "YYYY" (year mode); everything
// below just works off that string so both panels can reuse it.
// ------------------------------------------------------------
const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

function monthKeyOf(dateStr: string) {
    return (dateStr || "").slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}
function yearKeyOf(dateStr: string) {
    return (dateStr || "").slice(0, 4); // "YYYY-MM-DD" -> "YYYY"
}

// Last `n` month keys ending at the current month, most recent first —
// used to populate the period dropdowns regardless of what data exists,
// so "this month vs last month" is always pickable even with 0 batches.
function lastNMonthKeys(n: number): string[] {
    const out: string[] = [];
    const d = new Date();
    d.setDate(1); // avoid month-length rollover surprises
    for (let i = 0; i < n; i++) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        out.push(`${y}-${m}`);
        d.setMonth(d.getMonth() - 1);
    }
    return out;
}
function lastNYearKeys(n: number): string[] {
    const out: string[] = [];
    const y0 = new Date().getFullYear();
    for (let i = 0; i < n; i++) out.push(String(y0 - i));
    return out;
}

function monthKeyLabel(key: string) {
    const [y, m] = key.split("-");
    const idx = Number(m) - 1;
    return `${MONTH_NAMES[idx] || m} ${y}`;
}

// Inclusive [from, to] work_date range covering a given period key, for
// APIs (like /api/qc-audit/summary) that filter server-side by date.
function periodRange(mode: "month" | "year", key: string): { from: string; to: string } {
    if (mode === "year") {
        return { from: `${key}-01-01`, to: `${key}-12-31` };
    }
    const [y, m] = key.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
    return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, "0")}` };
}

// % change from `a` to `b`. Null when there's no meaningful base to
// compare against (avoids a divide-by-zero reading as "+Infinity%").
function pctChange(a: number | null, b: number | null): number | null {
    if (a == null || b == null) return null;
    if (a === 0) return b === 0 ? 0 : null;
    return Math.round(((b - a) / a) * 1000) / 10;
}

// Small reusable "Period A vs Period B" comparison card — mode toggle,
// two period pickers, a two-bar chart, and an increase/decrease badge.
// Used for both Production (qty) and QC Accuracy (%) on this page; the
// actual numbers come from `getValue(mode, periodKey)`, passed in by
// the caller, so this component itself has no idea which one it is.
function ComparePanel({
    title,
    icon,
    unit,
    valueFormatter,
    getValue,
    getValueAsync,
    loading,
    styles,
    BRAND,
    isMobile,
}: {
    title: string;
    icon: string;
    unit: string;
    valueFormatter?: (v: number) => string;
    // Two ways to supply numbers: `getValue` for data already sitting in
    // memory (e.g. Production, summed client-side from batch history —
    // instant, no loading state needed), or `getValueAsync` for numbers
    // that need a network call per period (e.g. QC Accuracy, which asks
    // the backend to filter+aggregate for that date range). Exactly one
    // of the two should be passed.
    getValue?: (mode: "month" | "year", periodKey: string) => number | null;
    getValueAsync?: (mode: "month" | "year", periodKey: string) => Promise<number | null>;
    loading?: boolean;
    styles: Record<string, CSSProperties>;
    BRAND: { blue: string; lightBlue: string; green: string; amber: string };
    isMobile: boolean;
}) {
    const [mode, setMode] = useState<"month" | "year">("month");
    const monthOptions = useMemo(() => lastNMonthKeys(12), []);
    const yearOptions = useMemo(() => lastNYearKeys(5), []);
    const options = mode === "month" ? monthOptions : yearOptions;
    const label = (key: string) => (mode === "month" ? monthKeyLabel(key) : key);

    // Default: current period vs the one right before it.
    const [periodA, setPeriodA] = useState(options[1] || options[0]);
    const [periodB, setPeriodB] = useState(options[0]);

    // Switching Month<->Year: re-anchor both pickers to that scale's
    // "current vs previous" instead of leaving stale month keys selected
    // while year options are showing (or vice versa).
    const handleModeChange = (next: "month" | "year") => {
        setMode(next);
        const opts = next === "month" ? lastNMonthKeys(12) : lastNYearKeys(5);
        setPeriodA(opts[1] || opts[0]);
        setPeriodB(opts[0]);
    };

    // Async path: re-fetch both periods' values whenever the mode or
    // either period selection changes. `cancelled` guards against a
    // slower, stale request overwriting a faster, newer one.
    const [asyncValues, setAsyncValues] = useState<{ a: number | null; b: number | null }>({
        a: null,
        b: null,
    });
    const [asyncLoading, setAsyncLoading] = useState(false);
    useEffect(() => {
        if (!getValueAsync) return;
        let cancelled = false;
        setAsyncLoading(true);
        Promise.all([getValueAsync(mode, periodA), getValueAsync(mode, periodB)])
            .then(([a, b]) => {
                if (!cancelled) setAsyncValues({ a, b });
            })
            .finally(() => {
                if (!cancelled) setAsyncLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [getValueAsync, mode, periodA, periodB]);

    const valueA = getValueAsync ? asyncValues.a : getValue ? getValue(mode, periodA) : null;
    const valueB = getValueAsync ? asyncValues.b : getValue ? getValue(mode, periodB) : null;
    const isLoading = loading || (getValueAsync ? asyncLoading : false);
    const delta = pctChange(valueA, valueB);
    const fmt = valueFormatter || ((v: number) => String(v));

    const chartData = [
        { name: label(periodA), Value: valueA ?? 0 },
        { name: label(periodB), Value: valueB ?? 0 },
    ];

    return (
        <div style={styles.panel}>
            <div style={styles.panelTitleRow}>
                <div style={styles.panelTitle}>
                    <i className={icon} style={{ marginRight: 6 }} aria-hidden="true" />
                    {title} — Compare
                </div>
                <div style={styles.panelTitleUnderline} />
            </div>

            {/* Mode toggle + period pickers */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        borderRadius: radius.md,
                        overflow: "hidden",
                        border: "1px solid #e1e5ee",
                    }}
                >
                    {(["month", "year"] as const).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => handleModeChange(m)}
                            style={{
                                border: "none",
                                cursor: "pointer",
                                padding: "6px 14px",
                                fontSize: fontSize.sm,
                                fontWeight: fontWeight.medium,
                                background: mode === m ? BRAND.blue : "#fff",
                                color: mode === m ? "#fff" : "#4b5563",
                            }}
                        >
                            {m === "month" ? "By Month" : "By Year"}
                        </button>
                    ))}
                </div>

                <select
                    value={periodA}
                    onChange={(e) => setPeriodA(e.target.value)}
                    style={{
                        padding: "6px 10px",
                        borderRadius: radius.md,
                        border: "1px solid #e1e5ee",
                        fontSize: fontSize.sm,
                        color: "#374151",
                    }}
                >
                    {options.map((k) => (
                        <option key={k} value={k}>
                            {label(k)}
                        </option>
                    ))}
                </select>

                <span style={{ color: "#9ca3af", fontSize: fontSize.sm }}>vs</span>

                <select
                    value={periodB}
                    onChange={(e) => setPeriodB(e.target.value)}
                    style={{
                        padding: "6px 10px",
                        borderRadius: radius.md,
                        border: "1px solid #e1e5ee",
                        fontSize: fontSize.sm,
                        color: "#374151",
                    }}
                >
                    {options.map((k) => (
                        <option key={k} value={k}>
                            {label(k)}
                        </option>
                    ))}
                </select>

                {delta != null && (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: fontSize.sm,
                            fontWeight: fontWeight.semibold,
                            background:
                                delta > 0
                                    ? withAlpha(BRAND.green, 0.14)
                                    : delta < 0
                                      ? "rgba(220,38,38,0.12)"
                                      : "rgba(107,114,128,0.12)",
                            color: delta > 0 ? BRAND.green : delta < 0 ? "#DC2626" : "#6b7280",
                        }}
                    >
                        <i
                            className={
                                delta > 0
                                    ? "ti ti-arrow-up-right"
                                    : delta < 0
                                      ? "ti ti-arrow-down-right"
                                      : "ti ti-minus"
                            }
                            aria-hidden="true"
                        />
                        {delta > 0 ? "+" : ""}
                        {delta}% ({label(periodA)} → {label(periodB)})
                    </span>
                )}
            </div>

            {loading ? (
                <div style={styles.emptyState}>
                    <div style={styles.emptyText}>Loading…</div>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
                        <XAxis dataKey="name" tick={{ fontSize: fontSize.sm, fill: "#6b7280" }} />
                        <YAxis
                            tick={{ fontSize: fontSize.sm, fill: "#6b7280" }}
                            allowDecimals={false}
                        />
                        <Tooltip
                            formatter={(value) => {
                                const v = Array.isArray(value)
                                    ? Number(value[0])
                                    : Number(value ?? 0);
                                return [`${fmt(v)} ${unit}`, title];
                            }}
                        />
                        <Bar
                            dataKey="Value"
                            fill={BRAND.blue}
                            radius={[4, 4, 0, 0]}
                            barSize={isMobile ? 40 : 64}
                        />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}

export default function Dashboard({ user }: DashboardProps) {
    const isMobile = useIsMobile();
    const { colors: themeColors } = useTheme();
    const BRAND = {
        blue: themeColors.blue,
        lightBlue: themeColors.lightBlue,
        green: themeColors.green,
        amber: STATUS_AMBER,
    };
    const styles = getStyles(BRAND);

    // NEW: two dashboard "views" sharing this one page — Manager (the
    // existing daily-work snapshot below) and Quality Manager (QC/Audit
    // stats). Which toggle button(s) show depends on role:
    //   - OPS_MANAGER / PROCESS_LEAD -> Manager only
    //   - AUDIT_MANAGER              -> Quality Manager only
    //   - SUPER_ADMIN                -> both, can switch freely
    // A role that only has one view available never sees the other
    // button at all (not just disabled) — there's nothing to switch to.
    const role = user?.role;
    const isSuperAdmin = role === "SUPER_ADMIN";
    const isAuditManager = role === "AUDIT_MANAGER";
    const isManagerRole = role === "OPS_MANAGER" || role === "PROCESS_LEAD";
    const showManagerBtn = isSuperAdmin || isManagerRole;
    const showQualityBtn = isSuperAdmin || isAuditManager;
    const [viewMode, setViewMode] = useState<"manager" | "quality">(
        isAuditManager && !isSuperAdmin ? "quality" : "manager"
    );

    const [employeeCount, setEmployeeCount] = useState<number | null>(null);
    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [errorDismissed, setErrorDismissed] = useState(false);

    // NEW: full (all-dates) Daily Work history, fetched once — powers
    // the "Production — Compare" panel below, which needs whole months/
    // years of totalQty rather than just today's. Separate from
    // `batches` (today only) so the existing KPI cards/chart/pending
    // table above are completely unaffected.
    const [batchHistory, setBatchHistory] = useState<DailyWorkBatch[]>([]);
    const [batchHistoryLoading, setBatchHistoryLoading] = useState(true);

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

    // No `date` query param -> every batch ever logged for the org (see
    // dailywork.controller.js: `date` is optional, filter is skipped
    // when absent). Grouped client-side by month/year in
    // `productionByPeriod` below.
    const fetchBatchHistory = async () => {
        setBatchHistoryLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setBatchHistory(json.data || []);
        } catch (err) {
            console.error("Failed to fetch daily work history:", err);
        } finally {
            setBatchHistoryLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployeeCount();
        fetchTodayBatches();
        fetchBatchHistory();
    }, []);

    // Sum of totalQty for a given month ("YYYY-MM") or year ("YYYY") key,
    // from the full batch history above.
    const getProductionValue = (mode: "month" | "year", key: string) => {
        const keyOf = mode === "month" ? monthKeyOf : yearKeyOf;
        return batchHistory.reduce(
            (sum, b) => (keyOf(b.workDate) === key ? sum + (b.totalQty || 0) : sum),
            0
        );
    };

    // ---- Quality Manager view state/fetch ----

    interface QcSummary {
        submittedTotal: number;
        qcNotSent: number;
        qcPending: number;
        qcPass: number;
        qcFail: number;
        qcAvgMarks: number | null;
        auditPending: number;
        auditPass: number;
        auditFail: number;
        auditAvgMarks: number | null;
    }
    const [qcSummary, setQcSummary] = useState<QcSummary | null>(null);
    const [qcLoading, setQcLoading] = useState(false);
    const [qcError, setQcError] = useState("");

    useEffect(() => {
        if (viewMode !== "quality") return;
        let cancelled = false;
        (async () => {
            setQcLoading(true);
            setQcError("");
            try {
                const res = await authFetch(`${API_BASE}/api/qc-audit/summary`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json?.message || `HTTP ${res.status}`);
                if (!cancelled) setQcSummary(json.data);
            } catch (err: any) {
                if (!cancelled) setQcError(err?.message || "Failed to load quality summary.");
            } finally {
                if (!cancelled) setQcLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [viewMode]);

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
                {/* NEW: Manager / Quality Manager toggle — only shown when the
                    person actually has more than one view available (Super
                    Admin). A single-view role just never sees a button for
                    the view they don't have. */}
                {showManagerBtn && showQualityBtn && (
                    <div style={styles.viewToggleRow}>
                        <button
                            type="button"
                            style={{
                                ...styles.viewToggleBtn,
                                ...(viewMode === "manager" ? styles.viewToggleBtnActive : {}),
                            }}
                            onClick={() => setViewMode("manager")}
                        >
                            Manager
                        </button>
                        <button
                            type="button"
                            style={{
                                ...styles.viewToggleBtn,
                                ...(viewMode === "quality" ? styles.viewToggleBtnActive : {}),
                            }}
                            onClick={() => setViewMode("quality")}
                        >
                            Quality Manager
                        </button>
                    </div>
                )}

                {viewMode === "quality" ? (
                    <QualityManagerView
                        isMobile={isMobile}
                        styles={styles}
                        BRAND={BRAND}
                        summary={qcSummary}
                        loading={qcLoading}
                        error={qcError}
                        userName={user?.name || user?.role}
                    />
                ) : (
                    <>
                        {/* Page header: icon badge + title + subtitle, same layout as
                    dailywork.tsx / employees.tsx page headers. */}
                        <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                            <div>
                                <h2 style={styles.pageTitle}>Dashboard</h2>
                                <p style={styles.headerSubtext}>
                                    Welcome, <strong>{user?.name || user?.role}</strong> — here's
                                    today's snapshot.
                                </p>
                            </div>
                            <div style={styles.dateBadge}>
                                <i className="ti ti-calendar" style={{ fontSize: fontSize.base }} />
                                {formatDisplayDate(todayStr())}
                            </div>
                        </div>

                        {error && !errorDismissed && (
                            <div style={styles.errorBanner}>
                                <i
                                    className="ti ti-alert-triangle"
                                    style={{ fontSize: fontSize.lg }}
                                />
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

                        {/* NEW: Production trend — month-vs-month or year-vs-year,
                            picked by the user, from ALL logged Daily Work (not just
                            today), so this always has real numbers to show even on
                            a day nothing's been logged yet. */}
                        <ComparePanel
                            title="Production"
                            icon="ti ti-chart-bar"
                            unit="units"
                            getValue={getProductionValue}
                            loading={batchHistoryLoading}
                            styles={styles}
                            BRAND={BRAND}
                            isMobile={isMobile}
                        />

                        {/* KPI cards */}
                        <div style={isMobile ? styles.kpiGridMobile : styles.kpiGrid}>
                            {kpis.map((kpi) => (
                                <div key={kpi.label} style={styles.kpiCard} title={kpi.tip}>
                                    <div style={styles.kpiTop}>
                                        <div
                                            style={{
                                                ...styles.kpiIconWrap,
                                                background: kpi.gradient,
                                            }}
                                        >
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
                                        {loading && kpi.label !== "Total Employees"
                                            ? "…"
                                            : kpi.value}
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
                                            style={{
                                                fontSize: fontSize["5xl"],
                                                color: BRAND.lightBlue,
                                            }}
                                        />
                                    </div>
                                    <div style={styles.emptyText}>
                                        No daily work logged for today yet.
                                    </div>
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
                                        <Bar
                                            dataKey="Total"
                                            fill={BRAND.blue}
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="Allocated"
                                            fill={BRAND.green}
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="Pending"
                                            fill={BRAND.amber}
                                            radius={[4, 4, 0, 0]}
                                        />
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
                                            background: withAlpha(BRAND.green, 0.1),
                                        }}
                                    >
                                        <i
                                            className="ti ti-mood-smile"
                                            style={{
                                                fontSize: fontSize["6xl"],
                                                color: BRAND.green,
                                            }}
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
                                                        ...statusBadgeStyle(b.status, BRAND),
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
                                                <td style={styles.td}>
                                                    {b.productName || "Unnamed"}
                                                </td>
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
                                                            ...statusBadgeStyle(b.status, BRAND),
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
                    </>
                )}
            </div>
        </div>
    );
}

// ------------------------------------------------------------
// Quality Manager Dashboard — QC/Audit stage counts + average marks,
// pulled from GET /api/qc-audit/summary. Kept in this same file (not
// its own page) since it's just an alternate view toggled on the
// existing Dashboard route, not a separate route/page of its own.
// ------------------------------------------------------------
function QualityManagerView({
    isMobile,
    styles,
    BRAND,
    summary,
    loading,
    error,
    userName,
}: {
    isMobile: boolean;
    styles: Record<string, CSSProperties>;
    BRAND: { blue: string; lightBlue: string; green: string; amber: string };
    summary: {
        submittedTotal: number;
        qcNotSent: number;
        qcPending: number;
        qcPass: number;
        qcFail: number;
        qcAvgMarks: number | null;
        auditPending: number;
        auditPass: number;
        auditFail: number;
        auditAvgMarks: number | null;
    } | null;
    loading: boolean;
    error: string;
    userName?: string;
}) {
    const qcCards = [
        {
            label: "Awaiting QC",
            value: summary?.qcNotSent ?? "—",
            icon: "ti ti-inbox",
            gradient: `linear-gradient(135deg, ${BRAND.amber}, #EA580C)`,
            tip: "Submitted cases not yet sent to a QC reviewer",
        },
        {
            label: "QC In Progress",
            value: summary?.qcPending ?? "—",
            icon: "ti ti-clock",
            gradient: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            tip: "Assigned to a QC reviewer, decision pending",
        },
        {
            label: "QC Passed",
            value: summary?.qcPass ?? "—",
            icon: "ti ti-circle-check",
            gradient: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.lightBlue})`,
            tip: "Cases that passed QC review",
        },
        {
            label: "QC Failed",
            value: summary?.qcFail ?? "—",
            icon: "ti ti-circle-x",
            gradient: "linear-gradient(135deg, #DC2626, #EA580C)",
            tip: "Cases that failed QC review",
        },
    ];
    const auditCards = [
        {
            label: "Awaiting Audit Pick",
            value:
                summary && summary.qcPass != null && summary.auditPending != null
                    ? Math.max(summary.qcPass - summary.auditPending - 0, 0)
                    : "—",
            icon: "ti ti-list-search",
            gradient: `linear-gradient(135deg, ${BRAND.amber}, #EA580C)`,
            tip: "QC-passed cases not yet picked for audit (approx.)",
        },
        {
            label: "Audit In Progress",
            value: summary?.auditPending ?? "—",
            icon: "ti ti-clock",
            gradient: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            tip: "Assigned to an auditor, decision pending",
        },
        {
            label: "Audit Passed",
            value: summary?.auditPass ?? "—",
            icon: "ti ti-shield-check",
            gradient: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.lightBlue})`,
            tip: "Cases that passed audit",
        },
        {
            label: "Audit Failed",
            value: summary?.auditFail ?? "—",
            icon: "ti ti-shield-x",
            gradient: "linear-gradient(135deg, #DC2626, #EA580C)",
            tip: "Cases that failed audit",
        },
    ];

    return (
        <>
            <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                <div>
                    <h2 style={styles.pageTitle}>Quality Dashboard</h2>
                    <p style={styles.headerSubtext}>
                        Welcome, <strong>{userName}</strong> — QC and Audit stage snapshot,
                        org-wide.
                    </p>
                </div>
                <div style={styles.dateBadge}>
                    <i className="ti ti-calendar" style={{ fontSize: fontSize.base }} />
                    {formatDisplayDate(todayStr())}
                </div>
            </div>

            {error && (
                <div style={styles.errorBanner}>
                    <i className="ti ti-alert-triangle" style={{ fontSize: fontSize.lg }} />
                    <span style={{ flex: 1 }}>{error}</span>
                </div>
            )}

            {loading ? (
                <div style={styles.emptyState}>
                    <div style={styles.emptyText}>Loading…</div>
                </div>
            ) : (
                <>
                    <div style={styles.panelTitleRow}>
                        <div style={styles.panelTitle}>QC Stage</div>
                        <div style={styles.panelTitleUnderline} />
                    </div>
                    <div style={isMobile ? styles.kpiGridMobile : styles.kpiGrid}>
                        {qcCards.map((kpi) => (
                            <div key={kpi.label} style={styles.kpiCard} title={kpi.tip}>
                                <div style={styles.kpiTop}>
                                    <div
                                        style={{ ...styles.kpiIconWrap, background: kpi.gradient }}
                                    >
                                        <i
                                            className={kpi.icon}
                                            style={{ fontSize: fontSize.xl, color: "#fff" }}
                                        />
                                    </div>
                                </div>
                                <div style={styles.kpiValue}>{kpi.value}</div>
                                <div style={styles.kpiLabel}>{kpi.label}</div>
                            </div>
                        ))}
                    </div>
                    {summary?.qcAvgMarks != null && (
                        <div style={styles.headerSubtext}>
                            Average QC marks (decided cases): <strong>{summary.qcAvgMarks}</strong>
                            /100
                        </div>
                    )}

                    <div style={{ ...styles.panelTitleRow, marginTop: 8 }}>
                        <div style={styles.panelTitle}>Audit Stage</div>
                        <div style={styles.panelTitleUnderline} />
                    </div>
                    <div style={isMobile ? styles.kpiGridMobile : styles.kpiGrid}>
                        {auditCards.map((kpi) => (
                            <div key={kpi.label} style={styles.kpiCard} title={kpi.tip}>
                                <div style={styles.kpiTop}>
                                    <div
                                        style={{ ...styles.kpiIconWrap, background: kpi.gradient }}
                                    >
                                        <i
                                            className={kpi.icon}
                                            style={{ fontSize: fontSize.xl, color: "#fff" }}
                                        />
                                    </div>
                                </div>
                                <div style={styles.kpiValue}>{kpi.value}</div>
                                <div style={styles.kpiLabel}>{kpi.label}</div>
                            </div>
                        ))}
                    </div>
                    {summary?.auditAvgMarks != null && (
                        <div style={styles.headerSubtext}>
                            Average Audit marks (decided cases):{" "}
                            <strong>{summary.auditAvgMarks}</strong>/100
                        </div>
                    )}
                </>
            )}
        </>
    );
}

// Built from the active theme color instead of hardcoded hex values, so
// the brand rail, KPI gradients, panel underline, and date badge all
// repaint when the user switches theme color — same pattern as
// adduser.tsx / profile.tsx.
function getStyles(BRAND: {
    blue: string;
    lightBlue: string;
    green: string;
    amber: string;
}): Record<string, CSSProperties> {
    return {
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

            textAlign: "left",
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
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.28)}`,
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
            height: 240,
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
            background: withAlpha(BRAND.lightBlue, 0.1),
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
            textAlign: "left",
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
        // NEW: Manager / Quality Manager toggle at the top of the page.
        viewToggleRow: { display: "flex", gap: 8 },
        viewToggleBtn: {
            padding: "8px 18px",
            borderRadius: radius.md,
            border: "1px solid #e4e9f2",
            background: "#fff",
            color: "#3b4a63",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        viewToggleBtnActive: {
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.28)}`,
        },
    };
}
