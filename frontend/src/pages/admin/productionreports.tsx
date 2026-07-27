import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

// NOTE: this is a NEW page, separate from pages/admin/reportdashboard.tsx
// (which already exists, is wired to /report and /reportdashboard, and
// serves a different purpose — generic per-user daily task reports via
// POST /api/reports/daily). That page was left untouched.
//
// This page is Checklist Page 8 ("Reports.tsx" — Date Filter + Table +
// Export CSV) for garment PRODUCTION data: it reuses the existing
// GET /api/daily-work endpoint (no backend changes needed) and filters/
// exports client-side.

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`; // matches Products/Clients/Landing gradient exactly

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

function Layers({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
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
function CheckCircle({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
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
function ArrowRight({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
        </svg>
    );
}
function Download({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}
function Filter({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
    );
}
function FileChart({ size = 40, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="17" x2="9" y2="14" />
            <line x1="12" y1="17" x2="12" y2="12" />
            <line x1="15" y1="17" x2="15" y2="15" />
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
    status: string;
};

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function daysAgoStr(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

function toCsv(rows: DailyWorkBatch[]) {
    const header = ["Date", "Product", "Total Qty", "Allocated Qty", "Pending Qty", "Status"];
    const lines = rows.map((r) =>
        [
            r.workDate,
            (r.productName || "").replace(/,/g, " "),
            r.totalQty,
            r.allocatedQty,
            r.pendingQty,
            r.status,
        ].join(",")
    );
    return [header.join(","), ...lines].join("\n");
}

const DEFAULT_FROM = daysAgoStr(30);
const DEFAULT_TO = todayStr();

export default function ProductionReports() {
    const isMobile = useIsMobile();
    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(DEFAULT_FROM);
    const [toDate, setToDate] = useState(DEFAULT_TO);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                // Backend supports a single ?date= filter; fetch the full
                // (org-scoped) list once and slice by range client-side.
                const res = await authFetch(`${API_BASE}/api/daily-work`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json.message || "Failed to load reports");
                setBatches(json.data || []);
            } catch (err: any) {
                setError(err.message || "Failed to load reports");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const filtered = useMemo(() => {
        return batches
            .filter((b) => b.workDate >= fromDate && b.workDate <= toDate)
            .sort((a, b) => (a.workDate < b.workDate ? 1 : -1));
    }, [batches, fromDate, toDate]);

    const totals = useMemo(
        () =>
            filtered.reduce(
                (acc, b) => ({
                    total: acc.total + b.totalQty,
                    allocated: acc.allocated + b.allocatedQty,
                    pending: acc.pending + b.pendingQty,
                }),
                { total: 0, allocated: 0, pending: 0 }
            ),
        [filtered]
    );

    const filtersActive = fromDate !== DEFAULT_FROM || toDate !== DEFAULT_TO;
    const handleClearFilters = () => {
        setFromDate(DEFAULT_FROM);
        setToDate(DEFAULT_TO);
    };

    const handleExportCsv = () => {
        const csv = toCsv(filtered);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `production-report_${fromDate}_to_${toDate}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.pageBody}>
                <div style={styles.headerRow}>
                    <div>
                        <h1 style={styles.title}>Production Reports</h1>
                        <p style={styles.subtitle}>
                            Daily Work batches by date range, with CSV export.
                        </p>
                    </div>
                    <div style={styles.headerActions}>
                        <div style={styles.rangeBadge}>
                            <Calendar size={14} color="#6b7280" />
                            <span>{formatDisplayDate(fromDate)}</span>
                            <ArrowRight size={13} color="#9ca3af" />
                            <span>{formatDisplayDate(toDate)}</span>
                        </div>
                        <button
                            style={{
                                ...styles.exportButton,
                                opacity: filtered.length === 0 ? 0.6 : 1,
                            }}
                            disabled={filtered.length === 0}
                            onClick={handleExportCsv}
                        >
                            <Download size={14} />
                            Export CSV
                        </button>
                    </div>
                </div>

                {error && <div style={styles.errorBanner}>{error}</div>}

                <div style={isMobile ? styles.summaryRowMobile : styles.summaryRow}>
                    <SummaryStat
                        icon={Layers}
                        label="Batches"
                        value={filtered.length}
                        color={BRAND.lightBlue}
                    />
                    <SummaryStat
                        icon={Box}
                        label="Total Qty"
                        value={totals.total}
                        color={BRAND.lightBlue}
                    />
                    <SummaryStat
                        icon={CheckCircle}
                        label="Allocated"
                        value={totals.allocated}
                        color={BRAND.green}
                    />
                    <SummaryStat
                        icon={Clock}
                        label="Pending"
                        value={totals.pending}
                        color={BRAND.amber}
                    />
                </div>

                <div style={styles.filterBar}>
                    <div>
                        <label style={styles.label}>From</label>
                        <div style={styles.dateInputWrap}>
                            <Calendar size={14} color="#9ca3af" />
                            <input
                                style={styles.dateInput}
                                type="date"
                                value={fromDate}
                                max={toDate}
                                onChange={(e) => setFromDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label style={styles.label}>To</label>
                        <div style={styles.dateInputWrap}>
                            <Calendar size={14} color="#9ca3af" />
                            <input
                                style={styles.dateInput}
                                type="date"
                                value={toDate}
                                min={fromDate}
                                max={todayStr()}
                                onChange={(e) => setToDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <button
                        style={{
                            ...styles.clearButton,
                            opacity: filtersActive ? 1 : 0.5,
                            cursor: filtersActive ? "pointer" : "default",
                        }}
                        disabled={!filtersActive}
                        onClick={handleClearFilters}
                    >
                        <Filter size={13} />
                        Clear Filters
                    </button>
                </div>

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <span style={{ width: 100 }}>Date</span>
                        <span style={{ flex: 1 }}>Product</span>
                        <span style={{ width: 80, textAlign: "right" }}>Total</span>
                        <span style={{ width: 90, textAlign: "right" }}>Allocated</span>
                        <span style={{ width: 80, textAlign: "right" }}>Pending</span>
                        <span style={{ width: 100, textAlign: "right" }}>Status</span>
                    </div>
                    {loading ? (
                        <div style={styles.emptyState}>
                            <div style={styles.emptyText}>Loading...</div>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={styles.emptyState}>
                            <div style={styles.emptyIconWrap}>
                                <FileChart size={36} color={BRAND.lightBlue} />
                            </div>
                            <div style={styles.emptyText}>No batches found in this date range.</div>
                        </div>
                    ) : (
                        filtered.map((b) => (
                            <div key={b.id} style={styles.tableRow}>
                                <span style={{ width: 100, fontSize: 13 }}>
                                    {formatDisplayDate(b.workDate)}
                                </span>
                                <span style={{ flex: 1, fontSize: 13 }}>
                                    {b.productName || "-"}
                                </span>
                                <span style={{ width: 80, textAlign: "right", fontSize: 13 }}>
                                    {b.totalQty}
                                </span>
                                <span
                                    style={{
                                        width: 90,
                                        textAlign: "right",
                                        fontSize: 13,
                                        color: BRAND.green,
                                        fontWeight: 600,
                                    }}
                                >
                                    {b.allocatedQty}
                                </span>
                                <span
                                    style={{
                                        width: 80,
                                        textAlign: "right",
                                        fontSize: 13,
                                        color: BRAND.amber,
                                        fontWeight: 600,
                                    }}
                                >
                                    {b.pendingQty}
                                </span>
                                <span
                                    style={{
                                        width: 100,
                                        textAlign: "right",
                                        fontSize: 12,
                                        color: "#6b7280",
                                    }}
                                >
                                    {b.status}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Decorative footer wave */}
            <svg
                style={styles.wave}
                viewBox="0 0 1440 160"
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M0,96 C240,32 480,144 720,96 C960,48 1200,128 1440,80 L1440,160 L0,160 Z"
                    fill="url(#waveGradient)"
                    opacity="0.35"
                />
                <path
                    d="M0,128 C240,80 480,160 720,120 C960,80 1200,150 1440,110 L1440,160 L0,160 Z"
                    fill="url(#waveGradient)"
                />
                <defs>
                    <linearGradient id="waveGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={BRAND.blue} />
                        <stop offset="100%" stopColor={BRAND.lightBlue} />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
}

function SummaryStat({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: typeof Layers;
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div style={styles.statCard}>
            <div style={{ ...styles.statIconWrap, background: withAlpha(color, 0.12) }}>
                <Icon size={18} color={color} />
            </div>
            <div>
                <div style={{ ...styles.statValue, color }}>{value}</div>
                <div style={styles.statLabel}>{label}</div>
            </div>
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

const styles: Record<string, CSSProperties> = {
    root: {
        position: "relative",
        overflow: "hidden",
        minHeight: "100%",
        background: "#f7f7fb",
    },
    rootMobile: {
        position: "relative",
        overflow: "hidden",
        minHeight: "100%",
        background: "#f7f7fb",
    },
    pageBody: {
        position: "relative",
        zIndex: 1,
        padding: "28px 32px 64px",
        width: "100%",
        boxSizing: "border-box",
    },
    headerRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 20,
    },
    title: { fontSize: 24, fontWeight: 800, color: "#1a1a2e", margin: 0 },
    subtitle: { fontSize: 13, color: "#6b7280", marginTop: 6 },
    headerActions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    rangeBadge: {
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
    exportButton: {
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
    errorBanner: {
        background: "#FEF2F2",
        color: BRAND.red,
        border: "1px solid #FECACA",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
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
    statLabel: { fontSize: 12, color: "#6b7280", marginTop: 2 },
    filterBar: {
        display: "flex",
        gap: 16,
        alignItems: "flex-end",
        background: "#fff",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        marginBottom: 16,
        flexWrap: "wrap",
    },
    label: { fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 },
    dateInputWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid #d1d5db",
        borderRadius: 8,
        padding: "8px 10px",
    },
    dateInput: {
        border: "none",
        outline: "none",
        fontSize: 13,
        color: "#374151",
        background: "transparent",
    },
    clearButton: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "9px 16px",
        borderRadius: 8,
        border: `1px solid ${BRAND.lightBlue}`,
        background: "#fff",
        color: BRAND.lightBlue,
        fontWeight: 600,
        fontSize: 12.5,
    },
    tableCard: {
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        overflow: "hidden",
    },
    tableHeadRow: {
        display: "flex",
        padding: "12px 20px",
        background: "#f9fafb",
        fontSize: 11,
        fontWeight: 700,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    tableRow: {
        display: "flex",
        padding: "12px 20px",
        borderTop: "1px solid #f1f1f1",
        alignItems: "center",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
    },
    emptyIconWrap: {
        width: 72,
        height: 72,
        borderRadius: "50%",
        background: "#F3EEFE",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 14,
    },
    emptyText: { color: "#9ca3af", fontSize: 13.5 },
    wave: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: 140,
        zIndex: 0,
        pointerEvents: "none",
    },
};
