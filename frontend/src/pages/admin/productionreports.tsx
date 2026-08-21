import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
import { useTheme } from "../../context/themecontext";

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

// NOTE: blue/lightBlue/green come from the active theme color (useTheme(),
// set inside the component below) — amber/red are accent colors that stay
// fixed across every theme (kept out of ThemePalette on purpose).

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

// NEW: History (case-number) view — one row per individual case, from
// the Case Register / service_cases table, instead of one row per
// batch. Same shape the Case Register page already uses.
type ServiceCaseRow = {
    id: string;
    caseNumber: string;
    productName: string | null;
    clientName: string | null;
    workDate: string;
    allocationStatus: string;
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

// NEW: CSV export for the History (case-number) view.
function toHistoryCsv(rows: ServiceCaseRow[]) {
    const header = ["Case No.", "Client", "Service", "Date", "Status"];
    const lines = rows.map((r) =>
        [
            r.caseNumber,
            (r.clientName || "").replace(/,/g, " "),
            (r.productName || "").replace(/,/g, " "),
            r.workDate,
            r.allocationStatus,
        ].join(",")
    );
    return [header.join(","), ...lines].join("\n");
}

const DEFAULT_FROM = daysAgoStr(30);
const DEFAULT_TO = todayStr();

export default function ProductionReports() {
    const isMobile = useIsMobile();
    const { colors: themeColors } = useTheme();
    const BRAND = {
        blue: themeColors.blue,
        lightBlue: themeColors.lightBlue,
        green: themeColors.green,
        amber: "#F59E0B",
        red: "#DC2626",
    };
    // Same gradient recipe used on Products/Clients/Landing/History — now
    // sourced from the active theme instead of a hardcoded blue.
    const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;
    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(DEFAULT_FROM);
    const [toDate, setToDate] = useState(DEFAULT_TO);

    // NEW: Count (existing, unchanged) vs History (case-number) view.
    const [reportMode, setReportMode] = useState<"count" | "history">("count");
    const [caseNumberFilter, setCaseNumberFilter] = useState("");
    const [historyRows, setHistoryRows] = useState<ServiceCaseRow[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyTotalPages, setHistoryTotalPages] = useState(1);
    const [historyTotal, setHistoryTotal] = useState(0);
    const HISTORY_PAGE_SIZE = 20;

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

    // NEW: History view fetch — same date range as Count mode, plus the
    // Case Number filter. Server-side paginated (service_cases can span
    // thousands of rows for a busy org).
    useEffect(() => {
        if (reportMode !== "history") return;
        (async () => {
            setHistoryLoading(true);
            setHistoryError(null);
            try {
                const params = new URLSearchParams();
                params.set("page", String(historyPage));
                params.set("pageSize", String(HISTORY_PAGE_SIZE));
                if (fromDate) params.set("workDateFrom", fromDate);
                if (toDate) params.set("workDateTo", toDate);
                if (caseNumberFilter.trim()) params.set("caseNumber", caseNumberFilter.trim());

                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json.message || "Failed to load case history");
                setHistoryRows(json.data || []);
                setHistoryTotalPages(json.pagination?.totalPages || 1);
                setHistoryTotal(json.pagination?.total || 0);
            } catch (err: any) {
                setHistoryError(err.message || "Failed to load case history");
            } finally {
                setHistoryLoading(false);
            }
        })();
    }, [reportMode, historyPage, fromDate, toDate, caseNumberFilter]);

    // Changing any filter should jump History back to page 1 — same
    // reasoning as the Case Register page's own filter-reset effect.
    useEffect(() => {
        setHistoryPage(1);
    }, [fromDate, toDate, caseNumberFilter, reportMode]);

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

    const filtersActive =
        fromDate !== DEFAULT_FROM || toDate !== DEFAULT_TO || caseNumberFilter.trim() !== "";
    const handleClearFilters = () => {
        setFromDate(DEFAULT_FROM);
        setToDate(DEFAULT_TO);
        setCaseNumberFilter("");
    };

    const handleExportCsv = () => {
        if (reportMode === "history") {
            const csv = toHistoryCsv(historyRows);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `production-report-history_${fromDate}_to_${toDate}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }
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
                            {reportMode === "count"
                                ? "Daily Work batches by date range, with CSV export."
                                : "Every logged case, by date range and case number, with CSV export."}
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
                                background: GRADIENT,
                                opacity:
                                    (reportMode === "count"
                                        ? filtered.length
                                        : historyRows.length) === 0
                                        ? 0.6
                                        : 1,
                            }}
                            disabled={
                                (reportMode === "count" ? filtered.length : historyRows.length) ===
                                0
                            }
                            onClick={handleExportCsv}
                        >
                            <Download size={14} />
                            Export CSV
                        </button>
                    </div>
                </div>

                {/* NEW: Count (existing, unchanged) vs History (case-number)
                    view toggle — same pill-button pattern used on the Case
                    Register page's Auto-generate/Upload toggle. */}
                <div style={styles.modeToggleRow}>
                    <button
                        type="button"
                        style={{
                            ...styles.modeToggleBtn,
                            ...(reportMode === "count"
                                ? { ...styles.modeToggleBtnActive, background: GRADIENT }
                                : {}),
                        }}
                        onClick={() => setReportMode("count")}
                    >
                        Count
                    </button>
                    <button
                        type="button"
                        style={{
                            ...styles.modeToggleBtn,
                            ...(reportMode === "history"
                                ? { ...styles.modeToggleBtnActive, background: GRADIENT }
                                : {}),
                        }}
                        onClick={() => setReportMode("history")}
                    >
                        History
                    </button>
                </div>

                {error && <div style={styles.errorBanner}>{error}</div>}
                {reportMode === "history" && historyError && (
                    <div style={styles.errorBanner}>{historyError}</div>
                )}

                {reportMode === "count" && (
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
                )}

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
                    {/* NEW: History-only filter — everything else in this
                        bar (From, To, Clear Filters) stays exactly as it
                        was, shared by both views. */}
                    {reportMode === "history" && (
                        <div>
                            <label style={styles.label}>Case Number</label>
                            <div style={styles.dateInputWrap}>
                                <input
                                    style={styles.dateInput}
                                    type="text"
                                    placeholder="e.g. CASEB011"
                                    value={caseNumberFilter}
                                    onChange={(e) => setCaseNumberFilter(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    <button
                        style={{
                            ...styles.clearButton,
                            borderColor: BRAND.lightBlue,
                            color: BRAND.lightBlue,
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
                    {reportMode === "count" ? (
                        <>
                            <div style={{ ...styles.tableHeadRow, background: GRADIENT }}>
                                <span>Date</span>
                                <span>Product</span>
                                <span style={{ textAlign: "right" }}>Total</span>
                                <span style={{ textAlign: "right" }}>Allocated</span>
                                <span style={{ textAlign: "right" }}>Pending</span>
                                <span style={{ textAlign: "right" }}>Status</span>
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
                                    <div style={styles.emptyText}>
                                        No batches found in this date range.
                                    </div>
                                </div>
                            ) : (
                                filtered.map((b) => (
                                    <div key={b.id} style={styles.tableRow}>
                                        <span style={{ fontSize: fontSize.base }}>
                                            {formatDisplayDate(b.workDate)}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: fontSize.base,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {b.productName || "-"}
                                        </span>
                                        <span
                                            style={{
                                                textAlign: "right",
                                                fontSize: fontSize.base,
                                            }}
                                        >
                                            {b.totalQty}
                                        </span>
                                        <span
                                            style={{
                                                textAlign: "right",
                                                fontSize: fontSize.base,
                                                color: BRAND.green,
                                                fontWeight: fontWeight.medium,
                                            }}
                                        >
                                            {b.allocatedQty}
                                        </span>
                                        <span
                                            style={{
                                                textAlign: "right",
                                                fontSize: fontSize.base,
                                                color: BRAND.amber,
                                                fontWeight: fontWeight.medium,
                                            }}
                                        >
                                            {b.pendingQty}
                                        </span>
                                        <span
                                            style={{
                                                textAlign: "right",
                                                fontSize: fontSize.sm,
                                                color: "#6b7280",
                                            }}
                                        >
                                            {b.status}
                                        </span>
                                    </div>
                                ))
                            )}
                        </>
                    ) : (
                        <>
                            <div style={{ ...styles.historyTableHeadRow, background: GRADIENT }}>
                                <span>Case No.</span>
                                <span>Client</span>
                                <span>Service</span>
                                <span>Date</span>
                                <span style={{ textAlign: "right" }}>Status</span>
                            </div>
                            {historyLoading ? (
                                <div style={styles.emptyState}>
                                    <div style={styles.emptyText}>Loading...</div>
                                </div>
                            ) : historyRows.length === 0 ? (
                                <div style={styles.emptyState}>
                                    <div style={styles.emptyIconWrap}>
                                        <FileChart size={36} color={BRAND.lightBlue} />
                                    </div>
                                    <div style={styles.emptyText}>
                                        No cases found for this filter.
                                    </div>
                                </div>
                            ) : (
                                historyRows.map((c) => (
                                    <div key={c.id} style={styles.historyTableRow}>
                                        <span
                                            style={{
                                                fontSize: fontSize.base,
                                                fontWeight: fontWeight.medium,
                                            }}
                                        >
                                            {c.caseNumber}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: fontSize.base,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {c.clientName || "-"}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: fontSize.base,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {c.productName || "-"}
                                        </span>
                                        <span style={{ fontSize: fontSize.base }}>
                                            {formatDisplayDate(c.workDate)}
                                        </span>
                                        <span
                                            style={{
                                                textAlign: "right",
                                                fontSize: fontSize.sm,
                                                color:
                                                    c.allocationStatus === "ALLOCATED"
                                                        ? BRAND.green
                                                        : BRAND.amber,
                                                fontWeight: fontWeight.medium,
                                            }}
                                        >
                                            {c.allocationStatus === "ALLOCATED"
                                                ? "Allocated"
                                                : "Pending"}
                                        </span>
                                    </div>
                                ))
                            )}
                            {!historyLoading && historyRows.length > 0 && (
                                <div style={styles.historyPaginationRow}>
                                    <span style={styles.tableFooterText}>
                                        {historyTotal} case(s) total
                                    </span>
                                    <div style={styles.pagination}>
                                        <button
                                            type="button"
                                            style={{
                                                ...styles.pageBtn,
                                                opacity: historyPage <= 1 ? 0.5 : 1,
                                                cursor:
                                                    historyPage <= 1 ? "not-allowed" : "pointer",
                                            }}
                                            disabled={historyPage <= 1}
                                            onClick={() =>
                                                setHistoryPage((p) => Math.max(1, p - 1))
                                            }
                                        >
                                            <i className="ti ti-chevron-left" />
                                        </button>
                                        <span style={styles.pageIndicator}>
                                            Page {historyPage} of {historyTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            style={{
                                                ...styles.pageBtn,
                                                opacity: historyPage >= historyTotalPages ? 0.5 : 1,
                                                cursor:
                                                    historyPage >= historyTotalPages
                                                        ? "not-allowed"
                                                        : "pointer",
                                            }}
                                            disabled={historyPage >= historyTotalPages}
                                            onClick={() =>
                                                setHistoryPage((p) =>
                                                    Math.min(historyTotalPages, p + 1)
                                                )
                                            }
                                        >
                                            <i className="ti ti-chevron-right" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Decorative footer wave — visible only when there's no data
                to show; hidden as soon as the table has rows, same rule
                as Services/Clients/Employees. */}
            {!loading && reportMode === "count" && filtered.length === 0 && (
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
            )}
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
    title: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "left",
    },
    subtitle: { fontSize: fontSize.base, color: "#6b7280", marginTop: 6, textAlign: "left" },
    headerActions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    rangeBadge: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: radius.md,
        padding: "9px 14px",
        fontSize: fontSize.base,
        color: "#374151",
        fontWeight: fontWeight.regular,
    },
    exportButton: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        // background is set inline from the active theme's GRADIENT
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "10px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },
    errorBanner: {
        background: "#FEF2F2",
        color: "#DC2626",
        border: "1px solid #FECACA",
        borderRadius: radius.sm,
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
    statCard: {
        background: "#fff",
        borderRadius: radius.md,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    },
    statIconWrap: {
        width: 38,
        height: 38,
        borderRadius: radius.circle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    statValue: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, lineHeight: 1.1 },
    statLabel: { fontSize: fontSize.sm, color: "#6b7280", marginTop: 2 },
    filterBar: {
        display: "flex",
        gap: 16,
        alignItems: "flex-end",
        background: "#fff",
        padding: 18,
        borderRadius: radius.md,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        marginBottom: 16,
        flexWrap: "wrap",
    },
    label: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        color: "#374151",
        display: "block",
        marginBottom: 6,
    },
    dateInputWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid #d1d5db",
        borderRadius: radius.sm,
        padding: "8px 10px",
    },
    dateInput: {
        border: "none",
        outline: "none",
        fontSize: fontSize.base,
        color: "#374151",
        background: "transparent",
    },
    clearButton: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "9px 16px",
        borderRadius: radius.sm,
        border: "1px solid transparent", // borderColor set inline from the active theme
        background: "#fff",
        fontWeight: fontWeight.medium,
        fontSize: fontSize.sm,
    },
    tableCard: {
        background: "#fff",
        borderRadius: radius.md,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        overflow: "hidden",
    },
    // Grid (not flex) on purpose: with flex + one flex:1 column, the
    // Product cell grows to soak up every leftover pixel on wide screens,
    // shoving Total/Allocated/Pending/Status into a huge empty gap on the
    // right. A fixed column template keeps that gap small and consistent
    // no matter how wide the page gets. Column widths must match between
    // tableHeadRow and tableRow so header/data line up.
    tableHeadRow: {
        display: "grid",
        gridTemplateColumns: "100px minmax(140px, 1.4fr) 90px 100px 90px 100px",
        columnGap: 12,
        padding: "12px 20px",
        // background set inline (theme GRADIENT) — matches header styling on other pages
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#eaf2ff",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    tableRow: {
        display: "grid",
        gridTemplateColumns: "100px minmax(140px, 1.4fr) 90px 100px 90px 100px",
        columnGap: 12,
        padding: "12px 20px",
        borderTop: "1px solid #f1f1f1",
        alignItems: "center",
    },
    // NEW: History (case-number) view — separate 5-column grid, same
    // header/row visual language as the Count table above.
    historyTableHeadRow: {
        display: "grid",
        gridTemplateColumns: "120px 160px minmax(140px, 1.4fr) 100px 100px",
        columnGap: 12,
        padding: "12px 20px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#eaf2ff",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    historyTableRow: {
        display: "grid",
        gridTemplateColumns: "120px 160px minmax(140px, 1.4fr) 100px 100px",
        columnGap: 12,
        padding: "12px 20px",
        borderTop: "1px solid #f1f1f1",
        alignItems: "center",
    },
    historyPaginationRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderTop: "1px solid #f1f1f1",
        flexWrap: "wrap",
        gap: 10,
    },
    tableFooterText: { fontSize: fontSize.xs, color: "#94a3b8" },
    pagination: { display: "flex", gap: 6, alignItems: "center" },
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
    },
    pageIndicator: { fontSize: fontSize.sm, color: "#374151", fontWeight: fontWeight.medium },
    // NEW: Count / History mode toggle — same pill-button pattern as the
    // Case Register page's Auto-generate/Upload toggle.
    modeToggleRow: {
        display: "flex",
        gap: 8,
        marginBottom: 4,
        flexWrap: "wrap",
    },
    modeToggleBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
        color: "#3b4a63",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 18px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    modeToggleBtnActive: {
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
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
        borderRadius: radius.circle,
        background: "#F3EEFE",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 14,
    },
    emptyText: { color: "#9ca3af", fontSize: fontSize.base },
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
