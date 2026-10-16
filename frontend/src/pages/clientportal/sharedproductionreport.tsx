// src/pages/client/sharedproductionreport.tsx
//
// Read-only Production Report for a CLIENT login, shown inside the Client
// Dashboard once staff have shared the "Production Reports" page with them.
// Data comes from GET /api/client-portal/shared/production-reports and is
// already limited server-side to the caller's own client.

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 15;

type Row = {
    id: string | number;
    caseNumber: string;
    service: string;
    subclient: string | null;
    workDate: string;
    status: string;
};
type Report = {
    from: string;
    to: string;
    truncated: boolean;
    summary: { total: number; byStatus: Record<string, number> };
    byService: { service: string; total: number; completed: number }[];
    byDay: { date: string; total: number; completed: number }[];
    cases: Row[];
};

const iso = (d: Date) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
};
const fmt = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime())
        ? d
        : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const card = { background: "#fff", border: "1px solid #E7EBF5", borderRadius: radius.xl } as const;
const th = {
    textAlign: "left",
    padding: "10px 14px",
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: "#6b6280",
    textTransform: "uppercase",
    background: "#F6F8FD",
    borderBottom: "1px solid #E7EBF5",
    whiteSpace: "nowrap",
} as const;
const td = {
    padding: "10px 14px",
    fontSize: fontSize.base,
    color: "#2b2a3a",
    borderBottom: "1px solid #EEF1F8",
    textAlign: "left",
} as const;
const dateInput = {
    padding: "8px 12px",
    border: "1px solid #D9DEEE",
    borderRadius: radius.lg,
    fontSize: fontSize.base,
    fontFamily: fontFamily.base,
    background: "#fff",
} as const;

// Stat-card icons + colours (Tabler icon font, same as the rest of the app)
const STAT_STYLE: Record<string, { icon: string; bg: string; fg: string }> = {
    "Total cases": { icon: "ti-file-text", bg: "#E4EEFB", fg: "#3B6FD4" },
    Received: { icon: "ti-mail", bg: "#DDF5EA", fg: "#0E9F6E" },
    "In Progress": { icon: "ti-clock", bg: "#EEE5FB", fg: "#7C3AED" },
    Submitted: { icon: "ti-send", bg: "#FFEBD9", fg: "#F97316" },
    "Under Review": { icon: "ti-shield-check", bg: "#D9F3F7", fg: "#0891B2" },
    Completed: { icon: "ti-check", bg: "#F1E3FA", fg: "#A21CAF" },
};
const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
    Received: { bg: "#DDF5EA", fg: "#0E9F6E" },
    "In Progress": { bg: "#EEE5FB", fg: "#7C3AED" },
    Submitted: { bg: "#FFEBD9", fg: "#C2570C" },
    "Under Review": { bg: "#D9F3F7", fg: "#0E7490" },
    Completed: { bg: "#F1E3FA", fg: "#86198F" },
};

const StatCard = ({ label, value }: { label: string; value: number }) => {
    const st = STAT_STYLE[label];
    return (
        <div
            style={{
                ...card,
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                boxShadow: "0 1px 3px rgba(23,24,28,0.04)",
            }}
        >
            <span
                style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: st.bg,
                    color: st.fg,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                }}
            >
                <i className={`ti ${st.icon}`} aria-hidden="true" />
            </span>
            <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: fontSize.sm, color: "#55607A" }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: fontWeight.semibold, lineHeight: 1.15 }}>
                    {value}
                </div>
            </div>
        </div>
    );
};

const CardTitle = ({ icon, children }: { icon: string; children: string }) => (
    <div
        style={{
            padding: "14px 18px",
            fontWeight: fontWeight.semibold,
            borderBottom: "1px solid #E7EBF5",
            display: "flex",
            alignItems: "center",
            gap: 10,
            textAlign: "left",
        }}
    >
        <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 20, color: "#3B4AB8" }} />
        {children}
    </div>
);

const SharedProductionReport = ({ shareId }: { shareId?: string }) => {
    const now = new Date();
    const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
    const [to, setTo] = useState(iso(now));
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(
                `${API_BASE}/api/client-portal/shared/production-reports?from=${from}&to=${to}${
                    shareId ? `&shareId=${encodeURIComponent(shareId)}` : ""
                }`,
                { cache: "no-store" }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not load the report.");
            setData(json.data);
            setPage(1);
        } catch (e: any) {
            setError(e?.message || "Could not load the report.");
        } finally {
            setLoading(false);
        }
    }, [from, to, shareId]);

    useEffect(() => {
        load();
    }, [load]);

    const pages = useMemo(
        () => Math.max(1, Math.ceil((data?.cases.length || 0) / PAGE_SIZE)),
        [data]
    );
    const slice = useMemo(
        () => (data?.cases || []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [data, page]
    );

    const exportCsv = () => {
        if (!data) return;
        const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [
            ["Case No.", "Service", "Subclient", "Work date", "Status"].map(esc).join(","),
        ];
        data.cases.forEach((c) =>
            lines.push(
                [c.caseNumber, c.service, c.subclient || "", c.workDate, c.status]
                    .map(esc)
                    .join(",")
            )
        );
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `production-report_${from}_to_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div style={{ textAlign: "left" }}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 16,
                }}
            >
                <label style={{ fontSize: fontSize.sm, color: "#6b6280" }}>
                    From{" "}
                    <input
                        type="date"
                        value={from}
                        max={to}
                        onChange={(e) => e.target.value && setFrom(e.target.value)}
                        style={dateInput}
                    />
                </label>
                <label style={{ fontSize: fontSize.sm, color: "#6b6280" }}>
                    To{" "}
                    <input
                        type="date"
                        value={to}
                        min={from}
                        onChange={(e) => e.target.value && setTo(e.target.value)}
                        style={dateInput}
                    />
                </label>
                <span
                    style={{
                        background: "#EEF1F6",
                        color: "#55607A",
                        borderRadius: 999,
                        padding: "4px 12px",
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold,
                    }}
                >
                    View only
                </span>
                <button
                    onClick={exportCsv}
                    disabled={!data || data.cases.length === 0}
                    style={{
                        marginLeft: "auto",
                        padding: "9px 16px",
                        border: "1px solid var(--brand-blue)",
                        background: "#fff",
                        color: "var(--brand-blue)",
                        borderRadius: radius.lg,
                        fontSize: fontSize.base,
                        fontWeight: fontWeight.semibold,
                        fontFamily: fontFamily.base,
                        cursor: "pointer",
                    }}
                >
                    <i className="ti ti-download" aria-hidden="true" /> Export CSV
                </button>
            </div>

            {loading && <div style={{ color: "#6b6280" }}>Loading…</div>}
            {!loading && error && (
                <div
                    role="alert"
                    style={{
                        background: "#FFF1F1",
                        border: "1px solid #F5C2C2",
                        color: "#A32020",
                        padding: "14px 16px",
                        borderRadius: radius.lg,
                    }}
                >
                    {error}
                </div>
            )}

            {!loading && !error && data && (
                <>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                            gap: 12,
                            marginBottom: 16,
                        }}
                    >
                        <StatCard label="Total cases" value={data.summary.total} />
                        {["Received", "In Progress", "Submitted", "Under Review", "Completed"].map(
                            (st) => (
                                <StatCard
                                    key={st}
                                    label={st}
                                    value={data.summary.byStatus[st] || 0}
                                />
                            )
                        )}
                    </div>

                    {data.truncated && (
                        <div
                            style={{
                                color: "#9A6700",
                                background: "#FFF4DB",
                                padding: "8px 12px",
                                borderRadius: radius.lg,
                                marginBottom: 12,
                                fontSize: fontSize.sm,
                            }}
                        >
                            Very large range — showing the first 5,000 cases. Narrow the dates for
                            the full picture.
                        </div>
                    )}

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                            gap: 16,
                            marginBottom: 16,
                        }}
                    >
                        <div style={{ ...card, overflow: "hidden" }}>
                            <CardTitle icon="ti-layout-grid">By service</CardTitle>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Service</th>
                                        <th style={th}>Total</th>
                                        <th style={th}>Completed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.byService.length === 0 && (
                                        <tr>
                                            <td style={td} colSpan={3}>
                                                No data in this range.
                                            </td>
                                        </tr>
                                    )}
                                    {data.byService.map((s) => (
                                        <tr key={s.service}>
                                            <td style={td}>{s.service}</td>
                                            <td style={td}>{s.total}</td>
                                            <td style={td}>{s.completed}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ ...card, overflow: "hidden" }}>
                            <CardTitle icon="ti-calendar">By day</CardTitle>
                            <div style={{ maxHeight: 260, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr>
                                            <th style={th}>Date</th>
                                            <th style={th}>Total</th>
                                            <th style={th}>Completed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.byDay.length === 0 && (
                                            <tr>
                                                <td style={td} colSpan={3}>
                                                    No data in this range.
                                                </td>
                                            </tr>
                                        )}
                                        {data.byDay.map((d) => (
                                            <tr key={d.date}>
                                                <td style={td}>{fmt(d.date)}</td>
                                                <td style={td}>{d.total}</td>
                                                <td style={td}>{d.completed}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div style={{ ...card, overflow: "hidden" }}>
                        <CardTitle icon="ti-file-text">Cases</CardTitle>
                        {data.cases.length === 0 ? (
                            <div style={{ padding: 32, textAlign: "center", color: "#8a8fa3" }}>
                                No cases in this date range.
                            </div>
                        ) : (
                            <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr>
                                            <th style={th}>Case No.</th>
                                            <th style={th}>Service</th>
                                            <th style={th}>Subclient</th>
                                            <th style={th}>Work date</th>
                                            <th style={th}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {slice.map((c) => (
                                            <tr key={c.id}>
                                                <td
                                                    style={{
                                                        ...td,
                                                        fontWeight: fontWeight.semibold,
                                                    }}
                                                >
                                                    {c.caseNumber}
                                                </td>
                                                <td style={td}>{c.service}</td>
                                                <td style={td}>{c.subclient || "—"}</td>
                                                <td style={td}>{fmt(c.workDate)}</td>
                                                <td style={td}>
                                                    <span
                                                        style={{
                                                            display: "inline-block",
                                                            padding: "3px 12px",
                                                            borderRadius: 999,
                                                            fontSize: fontSize.sm,
                                                            fontWeight: fontWeight.semibold,
                                                            background: (
                                                                STATUS_PILL[c.status] || {
                                                                    bg: "#EEF1F6",
                                                                }
                                                            ).bg,
                                                            color: (
                                                                STATUS_PILL[c.status] || {
                                                                    fg: "#55607A",
                                                                }
                                                            ).fg,
                                                        }}
                                                    >
                                                        {c.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {pages > 1 && (
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    gap: 12,
                                    padding: 12,
                                }}
                            >
                                <button
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    aria-label="Previous page"
                                    style={{
                                        padding: "6px 12px",
                                        border: "1px solid #D9DEEE",
                                        background: "#fff",
                                        borderRadius: radius.md,
                                        cursor: page === 1 ? "not-allowed" : "pointer",
                                    }}
                                >
                                    <i className="ti ti-chevron-left" aria-hidden="true" />
                                </button>
                                <span style={{ fontSize: fontSize.base }}>
                                    Page {page} of {pages}
                                </span>
                                <button
                                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                                    disabled={page === pages}
                                    aria-label="Next page"
                                    style={{
                                        padding: "6px 12px",
                                        border: "1px solid #D9DEEE",
                                        background: "#fff",
                                        borderRadius: radius.md,
                                        cursor: page === pages ? "not-allowed" : "pointer",
                                    }}
                                >
                                    <i className="ti ti-chevron-right" aria-hidden="true" />
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default SharedProductionReport;
