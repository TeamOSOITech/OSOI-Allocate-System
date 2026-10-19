import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
import { useTheme } from "../../context/themecontext";
import { useRoleLabels } from "../../context/roleLabelsContext";

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

// ------------------------------------------------------------
// Dashboard visual kit — soft pastel KPI cards and pill selects.
// ------------------------------------------------------------
const KPI_TONES = [
    {
        bg: "linear-gradient(135deg,#FFFFFF 0%,#EEF0FF 100%)",
        tile: "#E1E5FF",
        ink: "#4F46E5",
        wave: "#DDE2FF",
    },
    {
        bg: "linear-gradient(135deg,#FFFFFF 0%,#E9FAF4 100%)",
        tile: "#CFF3E6",
        ink: "#0F9F7B",
        wave: "#CFF1E4",
    },
    {
        bg: "linear-gradient(135deg,#FFFFFF 0%,#F3ECFF 100%)",
        tile: "#E5D8FF",
        ink: "#7C3AED",
        wave: "#E6DBFF",
    },
    {
        bg: "linear-gradient(135deg,#FFFFFF 0%,#FFF1E4 100%)",
        tile: "#FFDFC2",
        ink: "#EA580C",
        wave: "#FFE2C8",
    },
    {
        bg: "linear-gradient(135deg,#FFFFFF 0%,#E8F9EE 100%)",
        tile: "#CDF1D9",
        ink: "#16A34A",
        wave: "#CFF1DC",
    },
];

function KpiCard({
    index,
    label,
    value,
    icon,
    tip,
    isMobile,
}: {
    index: number;
    label: string;
    value: string | number;
    icon: string;
    tip?: string;
    isMobile: boolean;
}) {
    const tone = KPI_TONES[index % KPI_TONES.length];
    return (
        <div
            title={tip}
            style={{
                position: "relative",
                overflow: "hidden",
                background: tone.bg,
                border: "1px solid rgba(255,255,255,.9)",
                borderRadius: 20,
                padding: isMobile ? "12px 12px 14px" : "14px 16px 16px",
                boxShadow: "0 8px 24px rgba(31,41,90,.07)",
                textAlign: "left",
                fontFamily: fontFamily.base,
            }}
        >
            <svg
                aria-hidden="true"
                width="120"
                height="70"
                viewBox="0 0 120 70"
                style={{ position: "absolute", right: 0, bottom: 0, pointerEvents: "none" }}
            >
                <path
                    d="M120 0C96 14 80 36 56 48 38 56 18 62 0 70H120Z"
                    fill={tone.wave}
                    opacity=".75"
                />
                <path d="M120 26C102 38 90 54 70 62 56 67 42 69 30 70H120Z" fill={tone.wave} />
            </svg>
            <div
                style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 8,
                }}
            >
                <div
                    style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        background: tone.tile,
                        color: tone.ink,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <i className={icon} style={{ fontSize: 20 }} />
                </div>
                <span
                    aria-hidden="true"
                    style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: "#fff",
                        border: "1px solid #EDEFF8",
                        color: "#27305c",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <i className="ti ti-chevron-right" style={{ fontSize: 12 }} />
                </span>
            </div>
            <div
                style={{
                    position: "relative",
                    fontSize: fontSize["4xl"],
                    fontWeight: fontWeight.semibold,
                    color: "#14183a",
                    lineHeight: 1.1,
                }}
            >
                {value}
            </div>
            <div
                style={{
                    position: "relative",
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.medium,
                    color: "#1d2350",
                    marginTop: 6,
                }}
            >
                {label}
            </div>
            {tip && (
                <div
                    style={{
                        position: "relative",
                        fontSize: fontSize.xxs,
                        color: "#8a93ad",
                        marginTop: 4,
                        lineHeight: 1.4,
                        maxWidth: "88%",
                    }}
                >
                    {tip}
                </div>
            )}
        </div>
    );
}

// Rounded select with a leading icon and a custom chevron.
function PillSelect({
    icon,
    value,
    onChange,
    children,
    ariaLabel,
}: {
    icon: string;
    value: string;
    onChange: (v: string) => void;
    children: ReactNode;
    ariaLabel?: string;
}) {
    return (
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <i
                className={`ti ${icon}`}
                aria-hidden="true"
                style={{
                    position: "absolute",
                    left: 11,
                    fontSize: 14,
                    color: "#4F46E5",
                    pointerEvents: "none",
                }}
            />
            <select
                value={value}
                aria-label={ariaLabel}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    appearance: "none",
                    WebkitAppearance: "none",
                    height: 34,
                    padding: "0 30px 0 32px",
                    borderRadius: 999,
                    border: "1px solid #E4E7F5",
                    background: "#fff",
                    color: "#1d2350",
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.medium,
                    fontFamily: fontFamily.base,
                    cursor: "pointer",
                    outline: "none",
                    boxShadow: "0 2px 8px rgba(31,41,90,.05)",
                }}
            >
                {children}
            </select>
            <i
                className="ti ti-chevron-down"
                aria-hidden="true"
                style={{
                    position: "absolute",
                    right: 11,
                    fontSize: 12,
                    color: "#5b6488",
                    pointerEvents: "none",
                }}
            />
        </span>
    );
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

    const maxVal = Math.max(valueA ?? 0, valueB ?? 0, 1);

    // Always-visible callout above each bar: dot on the bar top + a small
    // white card with the period and its value.
    const renderCallout = (props: any) => {
        const { x, y, width, index } = props;
        const row = chartData[index];
        if (!row || x == null) return null;
        const cx = x + width / 2;
        const boxW = 150;
        const boxH = 42;
        const boxY = Math.max(y - boxH - 18, 2);
        return (
            <g>
                <rect
                    x={cx - boxW / 2}
                    y={boxY}
                    width={boxW}
                    height={boxH}
                    rx={10}
                    fill="#fff"
                    stroke="#E4E7F5"
                    filter="drop-shadow(0 4px 10px rgba(31,41,90,.10))"
                />
                <text x={cx} y={boxY + 17} textAnchor="middle" fontSize={11} fill="#6b7394">
                    {row.name}
                </text>
                <text x={cx} y={boxY + 33} textAnchor="middle" fontSize={11} fill="#4b5578">
                    {title} :{" "}
                    <tspan fontWeight={700} fill="#4F46E5">
                        {fmt(row.Value)} {unit}
                    </tspan>
                </text>
                <circle cx={cx} cy={y} r={5} fill="#4F46E5" stroke="#fff" strokeWidth={2} />
            </g>
        );
    };

    return (
        <div style={styles.panel}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 14,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            background: "#E8EAFF",
                            color: "#4F46E5",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <i className={icon} style={{ fontSize: 17 }} aria-hidden="true" />
                    </span>
                    <div
                        style={{
                            fontSize: fontSize.lg,
                            fontWeight: fontWeight.semibold,
                            color: "#14183a",
                        }}
                    >
                        {title} — Compare
                    </div>
                </div>
                {/* Month wise / Year wise dropdown (right side) */}
                <PillSelect
                    icon="ti-chart-bar"
                    value={mode}
                    ariaLabel="Compare by"
                    onChange={(v) => handleModeChange(v as "month" | "year")}
                >
                    <option value="month">Month wise</option>
                    <option value="year">Year wise</option>
                </PillSelect>
            </div>

            {/* Period pickers */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                }}
            >
                <PillSelect
                    icon="ti-calendar"
                    value={periodA}
                    onChange={setPeriodA}
                    ariaLabel="First period"
                >
                    {options.map((k) => (
                        <option key={k} value={k}>
                            {label(k)}
                        </option>
                    ))}
                </PillSelect>

                <span
                    style={{
                        color: "#9aa3bd",
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.medium,
                    }}
                >
                    vs
                </span>

                <PillSelect
                    icon="ti-calendar"
                    value={periodB}
                    onChange={setPeriodB}
                    ariaLabel="Second period"
                >
                    {options.map((k) => (
                        <option key={k} value={k}>
                            {label(k)}
                        </option>
                    ))}
                </PillSelect>

                {delta != null && (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            height: 34,
                            padding: "0 14px",
                            borderRadius: 999,
                            fontSize: fontSize.sm,
                            fontWeight: fontWeight.medium,
                            background:
                                delta > 0
                                    ? "#E3F8EE"
                                    : delta < 0
                                      ? "rgba(220,38,38,0.10)"
                                      : "rgba(107,114,128,0.12)",
                            color: delta > 0 ? "#0F9F7B" : delta < 0 ? "#DC2626" : "#6b7280",
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

            {loading || asyncLoading ? (
                <div style={styles.emptyState}>
                    <div style={styles.emptyText}>Loading…</div>
                </div>
            ) : (
                <div
                    style={{
                        borderRadius: 16,
                        background: "linear-gradient(180deg,#F5F6FF 0%,#FFFFFF 100%)",
                        padding: "6px 4px 0 0",
                    }}
                >
                    <ResponsiveContainer width="100%" height={isMobile ? 240 : 270}>
                        <BarChart
                            data={chartData}
                            margin={{ top: 60, right: 24, left: 0, bottom: 8 }}
                        >
                            <defs>
                                <linearGradient id="cmpBarGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#5B5BE6" />
                                    <stop offset="100%" stopColor="#3B3FB8" />
                                </linearGradient>
                            </defs>
                            <CartesianGrid
                                strokeDasharray="3 4"
                                stroke="#E6E9F5"
                                vertical={false}
                            />
                            <XAxis
                                dataKey="name"
                                tick={{ fontSize: fontSize.sm, fill: "#4b5578" }}
                                axisLine={{ stroke: "#CBD1E6" }}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fontSize: fontSize.xs, fill: "#6b7394" }}
                                allowDecimals={false}
                                axisLine={false}
                                tickLine={false}
                                domain={[0, Math.ceil(maxVal * 1.1)]}
                            />
                            <Bar
                                dataKey="Value"
                                fill="url(#cmpBarGrad)"
                                radius={[8, 8, 0, 0]}
                                barSize={isMobile ? 56 : 100}
                                isAnimationActive={false}
                                label={renderCallout}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

export default function Dashboard({ user }: DashboardProps) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const { colors: themeColors } = useTheme();
    const { getRoleLabel } = useRoleLabels();
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
    const [, setBatchHistory] = useState<DailyWorkBatch[]>([]);
    const [, setBatchHistoryLoading] = useState(true);

    // NEW: KPI cards below now read case-based counts (from service_cases,
    // via the same /api/service-cases endpoint Today's Allocation's Cases
    // tab uses) instead of the old daily_work-batch allocatedQty/pendingQty.
    // The old quantity-based "Allocate & Save" flow that used to write to
    // the `allocations` table is disabled now (manualallocation.tsx's
    // Allocate tab embeds the case-based Cases table instead), so nothing
    // writes to `allocations` anymore — the old numbers would always show
    // 0 allocated / everything pending, regardless of real allocations.
    // Two lightweight pageSize=1 calls (one unfiltered, one
    // allocationStatus=ALLOCATED) just read back `pagination.total` for an
    // exact org-wide count across every service, same trick used on the
    // Today's Allocation page (but without a productId filter there).
    const [caseTotalCount, setCaseTotalCount] = useState(0);
    const [caseAllocatedCount, setCaseAllocatedCount] = useState(0);
    // Today's completed = cases already submitted (submission_status =
    // SUBMITTED) by the assigned employee for today's work date.
    const [caseCompletedCount, setCaseCompletedCount] = useState(0);
    const [caseCountsLoading, setCaseCountsLoading] = useState(true);
    const caseRemainingCount = caseTotalCount - caseAllocatedCount;

    const fetchCaseCounts = async (silent = false) => {
        if (!silent) setCaseCountsLoading(true);
        try {
            const baseParams = new URLSearchParams();
            baseParams.set("page", "1");
            baseParams.set("pageSize", "1");
            baseParams.set("workDate", todayStr());
            // Carries forward any still-PENDING case from an earlier date
            // instead of undercounting "Remaining" — same flag the Cases
            // tab sends.
            baseParams.set("includeBacklog", "true");

            const allocatedParams = new URLSearchParams(baseParams);
            allocatedParams.set("allocationStatus", "ALLOCATED");

            const completedParams = new URLSearchParams(baseParams);
            completedParams.set("submissionStatus", "SUBMITTED");

            const [totalRes, allocatedRes, completedRes] = await Promise.all([
                authFetch(`${API_BASE}/api/service-cases?${baseParams.toString()}`),
                authFetch(`${API_BASE}/api/service-cases?${allocatedParams.toString()}`),
                authFetch(`${API_BASE}/api/service-cases?${completedParams.toString()}`),
            ]);
            const [totalJson, allocatedJson, completedJson] = await Promise.all([
                totalRes.json(),
                allocatedRes.json(),
                completedRes.json(),
            ]);
            setCaseCompletedCount(
                completedRes.ok && completedJson.success
                    ? (completedJson.pagination?.total ?? 0)
                    : 0
            );
            setCaseTotalCount(
                totalRes.ok && totalJson.success ? (totalJson.pagination?.total ?? 0) : 0
            );
            setCaseAllocatedCount(
                allocatedRes.ok && allocatedJson.success
                    ? (allocatedJson.pagination?.total ?? 0)
                    : 0
            );
        } catch (err) {
            console.error("Failed to fetch today's case counts:", err);
            if (!silent) {
                setCaseTotalCount(0);
                setCaseAllocatedCount(0);
                setCaseCompletedCount(0);
            }
        } finally {
            if (!silent) setCaseCountsLoading(false);
        }
    };

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

    const fetchTodayBatches = async (silent = false) => {
        if (!silent) {
            setLoading(true);
            setError("");
            setErrorDismissed(false);
        }
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work?date=${todayStr()}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setBatches(json.data || []);
            if (silent) setError("");
        } catch (err: any) {
            console.error("Failed to fetch today's daily work:", err);
            // A silent background refresh failing (e.g. a dropped connection
            // during the 30s auto-refresh) shouldn't yank away data that's
            // already on screen and replace it with an error state — only
            // a foreground load shows the error.
            if (!silent) setError(err?.message || "Failed to load today's daily work.");
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // No `date` query param -> every batch ever logged for the org (see
    // dailywork.controller.js: `date` is optional, filter is skipped
    // when absent). Grouped client-side by month/year in
    // `productionByPeriod` below.
    const fetchBatchHistory = async (silent = false) => {
        if (!silent) setBatchHistoryLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setBatchHistory(json.data || []);
        } catch (err) {
            console.error("Failed to fetch daily work history:", err);
        } finally {
            if (!silent) setBatchHistoryLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployeeCount();
        fetchTodayBatches();
        fetchBatchHistory();
        fetchCaseCounts();
    }, []);

    // NEW: auto-refresh every 30s so the dashboard reflects allocations/
    // daily work logged by anyone else without needing a manual page
    // reload. Runs "silent" (see the `silent` param above) so the
    // KPI cards/chart/table don't flash back to their loading state on
    // every refresh — they just update in place once the new data
    // arrives. Quality view's summary is included too, but only while
    // that view is actually the one on screen.
    useEffect(() => {
        const interval = setInterval(() => {
            // PERF: skip the 4-5 request refresh while the tab is hidden
            if (document.hidden) return;
            fetchEmployeeCount();
            fetchTodayBatches(true);
            fetchBatchHistory(true);
            fetchCaseCounts(true);
            if (viewMode === "quality") fetchQcSummary(true);
        }, 30000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode]);

    // Completed (submitted) cases in a month/year, straight from
    // service_cases — a pageSize=1 call just to read pagination.total.
    // Stable via useCallback because ComparePanel re-fetches whenever
    // this function's identity changes.
    const getCompletedValue = useCallback(
        async (mode: "month" | "year", key: string): Promise<number | null> => {
            try {
                const { from, to } = periodRange(mode, key);
                const params = new URLSearchParams({
                    page: "1",
                    pageSize: "1",
                    submissionStatus: "SUBMITTED",
                    workDateFrom: from,
                    workDateTo: to,
                });
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success) return null;
                return json.pagination?.total ?? 0;
            } catch {
                return null;
            }
        },
        []
    );

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

    const fetchQcSummary = async (silent = false) => {
        if (!silent) {
            setQcLoading(true);
            setQcError("");
        }
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/summary`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setQcSummary(json.data);
            if (silent) setQcError("");
        } catch (err: any) {
            if (!silent) setQcError(err?.message || "Failed to load quality summary.");
        } finally {
            if (!silent) setQcLoading(false);
        }
    };

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

    const kpis = [
        {
            label: "Total Employees",
            value: employeeCount === null ? "—" : employeeCount,
            icon: "ti ti-users",
            gradient: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            tip: "Total employees in your organization",
        },
        {
            label: "Today's Total Cases",
            value: caseTotalCount,
            icon: "ti ti-package",
            gradient: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.green})`,
            tip: "Total service cases for today (including any still-pending backlog)",
        },
        {
            label: "Today's Allocated",
            value: caseAllocatedCount,
            icon: "ti ti-circle-check",
            gradient: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.lightBlue})`,
            tip: "Cases already allocated to an employee today",
        },
        {
            label: "Today's Remaining",
            value: caseRemainingCount,
            icon: "ti ti-hourglass",
            gradient: `linear-gradient(135deg, ${BRAND.amber}, #EA580C)`,
            tip: "Cases still waiting to be allocated today",
        },
        {
            label: "Today's Completed",
            value: caseCompletedCount,
            icon: "ti ti-checks",
            gradient: `linear-gradient(135deg, ${BRAND.green}, #15803D)`,
            tip: "Cases completed & submitted by employees today",
        },
    ];

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={isMobile ? styles.contentBodyMobile : styles.contentBody}>
                {/* Top bar: Manager / Quality Manager pills (only when the person
                    has more than one view) + today's date + profile shortcut. */}
                <div style={styles.topRow}>
                    <div style={styles.viewToggleRow}>
                        {showManagerBtn && showQualityBtn && (
                            <>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.viewToggleBtn,
                                        ...(viewMode === "manager"
                                            ? styles.viewToggleBtnActive
                                            : {}),
                                    }}
                                    onClick={() => setViewMode("manager")}
                                >
                                    <i className="ti ti-users" style={{ fontSize: 14 }} />
                                    Manager
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.viewToggleBtn,
                                        ...(viewMode === "quality"
                                            ? styles.viewToggleBtnActive
                                            : {}),
                                    }}
                                    onClick={() => setViewMode("quality")}
                                >
                                    <i className="ti ti-shield-check" style={{ fontSize: 14 }} />
                                    Quality Manager
                                </button>
                            </>
                        )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={styles.dateBadge}>
                            <i className="ti ti-calendar" style={{ fontSize: fontSize.base }} />
                            {formatDisplayDate(todayStr())}
                        </div>
                        <button
                            type="button"
                            style={styles.profileBtn}
                            onClick={() => navigate("/profile")}
                            aria-label="My profile"
                            title="My profile"
                        >
                            <i className="ti ti-user" style={{ fontSize: 17 }} />
                        </button>
                    </div>
                </div>

                {viewMode === "quality" ? (
                    <QualityManagerView
                        isMobile={isMobile}
                        styles={styles}
                        BRAND={BRAND}
                        summary={qcSummary}
                        loading={qcLoading}
                        error={qcError}
                        userName={user?.name || getRoleLabel(user?.role)}
                    />
                ) : (
                    <>
                        <div>
                            <h2 style={styles.pageTitle}>
                                Welcome, {user?.name || getRoleLabel(user?.role)}{" "}
                                <span aria-hidden="true">👋</span>
                            </h2>
                            <p style={styles.headerSubtext}>
                                Here's what's happening with your team today.
                            </p>
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

                        {/* KPI cards — quick-glance numbers come first, before any
                            chart or comparison panel, so the very first thing a
                            user sees on the page is today's simple totals. */}
                        <div style={isMobile ? styles.kpiGridMobile : styles.kpiGrid}>
                            {kpis.map((kpi, i) => (
                                <KpiCard
                                    key={kpi.label}
                                    index={i}
                                    label={kpi.label}
                                    icon={kpi.icon}
                                    tip={kpi.tip}
                                    isMobile={isMobile}
                                    value={
                                        kpi.label !== "Total Employees" && caseCountsLoading
                                            ? "…"
                                            : kpi.value
                                    }
                                />
                            ))}
                        </div>

                        {/* Production trend — month-vs-month or year-vs-year, picked
                            by the user, from ALL logged Daily Work (not just today),
                            so this always has real numbers to show even on a day
                            nothing's been logged yet. Shown after the KPI cards, as
                            a "dig deeper" panel rather than the first thing seen. */}
                        <ComparePanel
                            title="Completed Cases"
                            icon="ti ti-chart-bar"
                            unit="cases"
                            getValueAsync={getCompletedValue}
                            styles={styles}
                            BRAND={BRAND}
                            isMobile={isMobile}
                        />
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
            <div>
                <h2 style={styles.pageTitle}>
                    Welcome, {userName} <span aria-hidden="true">👋</span>
                </h2>
                <p style={styles.headerSubtext}>QC and Audit stage snapshot, org-wide.</p>
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
                        {qcCards.map((kpi, i) => (
                            <KpiCard
                                key={kpi.label}
                                index={i + 0}
                                label={kpi.label}
                                icon={kpi.icon}
                                tip={kpi.tip}
                                isMobile={isMobile}
                                value={kpi.value}
                            />
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
                        {auditCards.map((kpi, i) => (
                            <KpiCard
                                key={kpi.label}
                                index={i + 1}
                                label={kpi.label}
                                icon={kpi.icon}
                                tip={kpi.tip}
                                isMobile={isMobile}
                                value={kpi.value}
                            />
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
            background: "linear-gradient(180deg,#F5F7FE 0%,#EEF1FB 100%)",
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
            color: "#14183a",
            textAlign: "left",
        },
        topRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
        },
        profileBtn: {
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid #E4E7F5",
            background: "#EEF0FF",
            color: "#4F46E5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
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
            gap: 8,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#27305c",
            background: "#E6EAFB",
            padding: "8px 16px",
            borderRadius: 999,
            whiteSpace: "nowrap",
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
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
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
            // Matches the KPI numbers on Service Cases (fontSize["4xl"]).
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: "#16233a",
            lineHeight: 1.15,
        },
        kpiLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#4b5b73",
            marginTop: 6,
        },
        kpiTip: {
            // Always-visible caption (the old native `title` tooltip does
            // not work on touch devices).
            fontSize: fontSize.xxs,
            color: "#93a0b4",
            marginTop: 2,
            lineHeight: 1.35,
        },
        panel: {
            background: "#fff",
            borderRadius: 20,
            padding: "22px",
            border: "1px solid #EEF0F8",
            boxShadow: "0 8px 24px rgba(31,41,90,.06)",
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
            // Same as the table headers on Profile / Employees (xs).
            textAlign: "left",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#5b6b82",
            padding: "10px 12px",
            borderBottom: "2px solid #eef0f3",
        },
        td: {
            // Same as the table cells on Profile (base).
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
        viewToggleRow: { display: "flex", gap: 10, flexWrap: "wrap" },
        viewToggleBtn: {
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid #E4E7F5",
            background: "#fff",
            color: "#3b4a63",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            cursor: "pointer",
        },
        viewToggleBtnActive: {
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: `0 8px 20px ${withAlpha(BRAND.blue, 0.3)}`,
        },
    };
}
