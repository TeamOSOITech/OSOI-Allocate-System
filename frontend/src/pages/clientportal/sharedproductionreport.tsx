// src/pages/clientportal/sharedproductionreport.tsx
//
// Read-only Production Report for a CLIENT login, shown inside the Client
// Dashboard once staff have shared the "Production Reports" page with them.
// Data comes from GET /api/client-portal/shared/production-reports and is
// already limited server-side to the caller's own client.
//
// Layout: header with client + date range -> share details (who shared it,
// when, for which client and dates) -> status pipeline -> three section
// cards (service / day / cases) -> the opened section.
//
// Header ("Shared with me" version): client (left), client dropdown
// (`picker`, see sharepicker.tsx) + Export CSV in one box (right).
// The date range lives in the right of the "Share details" bar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight } from "../../styles/theme";

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
    client?: { id: string | number; name: string };
    share?: {
        page: string;
        sharedBy: string | null;
        sharedAt: string | null;
        permission: string;
    };
    from: string;
    to: string;
    truncated: boolean;
    bounds?: { min: string | null; max: string | null };
    filters?: { label: string; value: string }[];
    summary: { total: number; byStatus: Record<string, number> };
    byService: { service: string; total: number; completed: number }[];
    byDay: { date: string; total: number; completed: number }[];
    cases: Row[];
};

type Section = "service" | "day" | "cases";

const STATUSES = ["Received", "In Progress", "Submitted", "Under Review", "Completed"] as const;

// solid colour for bars/dots, soft tint + ink for pills
const STATUS_STYLE: Record<string, { solid: string; bg: string; fg: string; icon: string }> = {
    Received: { solid: "#10B981", bg: "#DDF5EA", fg: "#0B7A56", icon: "ti-mail" },
    "In Progress": { solid: "#8B5CF6", bg: "#EEE5FB", fg: "#6D28D9", icon: "ti-clock" },
    Submitted: { solid: "#F97316", bg: "#FFEBD9", fg: "#B45309", icon: "ti-send" },
    "Under Review": { solid: "#0EA5C6", bg: "#D9F3F7", fg: "#0E7490", icon: "ti-shield-check" },
    Completed: { solid: "#C026D3", bg: "#F6E4FA", fg: "#86198F", icon: "ti-check" },
};

const INK = "#1B2150";
const MUTED = "#667094";
const LINE = "#E3E7F4";
const BRAND = "#3B4AB8";

const iso = (d: Date) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
};
void iso;

const fmt = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime())
        ? d
        : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
// "12 Nov 2026, 03:45 pm"
const fmtDateTime = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime())
        ? d
        : `${dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, ${dt
              .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
              .toLowerCase()}`;
};
const fmtShort = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime())
        ? { day: d, month: "" }
        : {
              day: dt.toLocaleDateString("en-GB", { day: "2-digit" }),
              month: dt.toLocaleDateString("en-GB", { month: "short" }),
          };
};
const nf = (n: number) => n.toLocaleString("en-IN");

const CSS = `
.spr { font-family: ${fontFamily.base}; color: ${INK}; text-align: left; }
.spr { container-type: inline-size; }
/* "Shared with me" header: two rows. Row 1 = title | picker + export (one box). Row 2 = client */
.spr-hero-grid { display: flex; flex-direction: column; }
.spr-hero-top, .spr-hero-bottom { display: flex; align-items: center; gap: 14px 20px; flex-wrap: wrap; min-width: 0; }
.spr-hero-top { justify-content: space-between; }
.spr-hero-bottom { justify-content: flex-end; padding-top: 14px; border-top: 1px solid rgba(91,71,201,.14); }
.spr-ctrl { display: inline-flex; align-items: stretch; gap: 8px; padding: 6px; border-radius: 18px; background: rgba(255,255,255,.75); border: 1px solid ${LINE}; max-width: 100%; }
.spr-picker { zoom: .88; min-width: 0; display: flex; align-items: center; }
.spr-dates { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 8px; }
@container (max-width: 760px) { .spr-hero-bottom { justify-content: flex-start; } }
@container (max-width: 520px) { .spr-dates { flex-wrap: wrap; } .spr-ctrl { flex-wrap: wrap; } }
.spr * { box-sizing: border-box; }
.spr-card { background: #fff; border: 1px solid ${LINE}; border-radius: 20px; box-shadow: 0 1px 2px rgba(27,33,80,.04); }
.spr-title { font-size: 16px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.spr-sub { font-size: 12.5px; color: ${MUTED}; margin: 2px 0 0; }
.spr-date { height: 38px; padding: 0 12px; border: 1px solid rgba(255,255,255,.35); border-radius: 12px; background: #fff; color: ${INK}; font: 600 13px ${fontFamily.base}; }
.spr-date:focus-visible, .spr-search:focus-visible { outline: 3px solid #A9B4F2; outline-offset: 1px; }
.spr-btn { height: 38px; padding: 0 16px; border-radius: 12px; font: 700 13px ${fontFamily.base}; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.spr-btn:focus-visible, .spr-chip:focus-visible, .spr-legend:focus-visible, .spr-pg:focus-visible { outline: 3px solid #A9B4F2; outline-offset: 2px; }
.spr-btn[disabled] { opacity: .5; cursor: not-allowed; }
.spr-chip { border: 1px solid ${LINE}; background: #fff; color: ${INK}; border-radius: 999px; padding: 6px 12px; font: 600 12.5px ${fontFamily.base}; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.spr-chip:hover { background: #F3F5FD; }
.spr-chip[aria-pressed="true"] { background: ${INK}; border-color: ${INK}; color: #fff; }
.spr-chip small { font-size: 11.5px; opacity: .7; font-weight: 600; }
.spr-legend { text-align: left; border: 1.5px solid transparent; border-radius: 16px; padding: 14px 16px; cursor: pointer; font-family: inherit; color: inherit; }
.spr-legend:hover { filter: brightness(.97); }
.spr-legend[aria-pressed="true"] { border-color: ${INK}; box-shadow: 0 0 0 3px rgba(27,33,80,.08); }
.spr-tab { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid ${LINE}; background: #fff; color: ${INK}; font: 700 13.5px ${fontFamily.base}; cursor: pointer; }
.spr-tab i { font-size: 17px; color: ${BRAND}; }
.spr-tab small { font-size: 12px; font-weight: 700; background: #EEF1FB; color: ${BRAND}; border-radius: 999px; padding: 1px 8px; }
.spr-tab:hover { background: #F3F5FD; }
.spr-tab[aria-selected="true"] { background: ${INK}; border-color: ${INK}; color: #fff; }
.spr-tab[aria-selected="true"] i { color: #fff; }
.spr-tab[aria-selected="true"] small { background: rgba(255,255,255,.2); color: #fff; }
.spr-tab:focus-visible { outline: 3px solid #A9B4F2; outline-offset: 2px; }
.spr-share { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0; }
.spr-share-item { display: flex; gap: 12px; align-items: center; padding: 14px 20px; min-width: 0; }
.spr-share-item + .spr-share-item { border-left: 1px solid ${LINE}; }
@media (max-width: 760px) { .spr-share-item + .spr-share-item { border-left: 0; border-top: 1px solid ${LINE}; } }
.spr-hero h2, .spr-hero div, .spr-hero label { color: #fff; }
.spr-hero > div { position: relative; z-index: 1; }
.spr-hero .spr-date { color: ${INK}; }
.spr-hero .spr-btn { color: ${INK}; }
.spr-hero-light h1, .spr-hero-light div, .spr-hero-light label { color: ${INK}; }
.spr-hero-light .spr-date { border: 1px solid ${LINE}; background: #fff; }
.spr-cardbtn { display: flex; align-items: flex-start; gap: 12px; width: 100%; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; color: inherit; }
.spr-cardbtn:focus-visible { outline: 3px solid #A9B4F2; outline-offset: 4px; border-radius: 12px; }
.spr-prev { transition: border-color .15s ease, box-shadow .15s ease; }
.spr-prev:hover { box-shadow: 0 6px 20px rgba(59,74,184,.10); }
@keyframes spr-reveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) { .spr-panel { animation: spr-reveal .25s ease both; } }
.spr-row:hover td { background: #F7F8FD; }
.spr-pg { width: 34px; height: 34px; border-radius: 10px; border: 1px solid ${LINE}; background: #fff; cursor: pointer; color: ${INK}; }
.spr-pg[disabled] { opacity: .4; cursor: not-allowed; }
.spr-col:hover .spr-colbar { filter: brightness(.92); }
.spr-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.spr-scroll::-webkit-scrollbar-thumb { background: #CBD2EC; border-radius: 8px; }
@media (prefers-reduced-motion: no-preference) {
  .spr-grow { transition: width .5s ease, height .5s ease; }
}
`;

const th: CSSProperties = {
    textAlign: "left",
    padding: "11px 18px",
    fontSize: 12,
    fontWeight: 700,
    color: MUTED,
    background: "#F7F8FD",
    borderBottom: `1px solid ${LINE}`,
    whiteSpace: "nowrap",
};
const td: CSSProperties = {
    padding: "13px 18px",
    fontSize: 13.5,
    color: INK,
    borderBottom: "1px solid #EEF1F8",
    textAlign: "left",
    background: "#fff",
};

const Pill = ({ status }: { status: string }) => {
    const st = STATUS_STYLE[status] || {
        solid: "#94A3B8",
        bg: "#EEF1F6",
        fg: "#55607A",
        icon: "ti-point",
    };
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px 4px 10px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 700,
                background: st.bg,
                color: st.fg,
                whiteSpace: "nowrap",
            }}
        >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.solid }} />
            {status}
        </span>
    );
};

const CardHead = ({
    icon,
    title,
    sub,
    right,
}: {
    icon: string;
    title: string;
    sub?: string;
    right?: React.ReactNode;
}) => (
    <div
        style={{
            padding: "18px 20px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
        }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
                style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: "#ECEFFB",
                    color: BRAND,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 19,
                }}
            >
                <i className={`ti ${icon}`} aria-hidden="true" />
            </span>
            <div>
                <h3 className="spr-title">{title}</h3>
                {sub && <p className="spr-sub">{sub}</p>}
            </div>
        </div>
        {right}
    </div>
);

const panelGrid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    gap: 16,
    padding: "0 20px 20px",
    alignItems: "stretch",
};

// One half of a two-column panel: titled header strip + scrolling body.
const Box = ({
    title,
    right,
    pad = 16,
    children,
}: {
    title: string;
    right?: React.ReactNode;
    pad?: number;
    children: React.ReactNode;
}) => (
    <div
        style={{
            border: `1px solid ${LINE}`,
            borderRadius: 16,
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            height: 420,
            overflow: "hidden",
        }}
    >
        <div
            style={{
                padding: "12px 16px",
                background: "#F7F8FD",
                borderBottom: `1px solid ${LINE}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 13.5,
                fontWeight: 700,
                flexShrink: 0,
            }}
        >
            <span>{title}</span>
            {right}
        </div>
        <div
            className="spr-scroll"
            style={{ flex: 1, overflow: "auto", padding: pad, minHeight: 0 }}
        >
            {children}
        </div>
    </div>
);

const Legend = () => (
    <span style={{ display: "inline-flex", gap: 14, fontSize: 12, fontWeight: 600, color: MUTED }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i
                style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "#C6CEF2",
                    display: "inline-block",
                }}
            />
            Total
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i
                style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: BRAND,
                    display: "inline-block",
                }}
            />
            Completed
        </span>
    </span>
);

const MiniTable = ({
    head,
    rows,
}: {
    head: [string, string, string];
    rows: { key: string; label: string; total: number; completed: number }[];
}) => {
    const sumT = rows.reduce((a, r) => a + r.total, 0);
    const sumC = rows.reduce((a, r) => a + r.completed, 0);
    const cell: CSSProperties = { ...td, padding: "11px 16px", fontSize: 13.5 };
    const num: CSSProperties = {
        ...cell,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        width: 90,
    };
    const hcell: CSSProperties = { ...th, position: "sticky", top: 0, zIndex: 1 };
    const fcell: CSSProperties = {
        ...cell,
        position: "sticky",
        bottom: 0,
        background: "#F7F8FD",
        borderTop: `1px solid ${LINE}`,
        borderBottom: "none",
        fontWeight: 800,
    };
    return (
        <table
            style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                tableLayout: "fixed",
            }}
        >
            <thead>
                <tr>
                    <th style={hcell}>{head[0]}</th>
                    <th style={{ ...hcell, textAlign: "right", width: 90 }}>{head[1]}</th>
                    <th style={{ ...hcell, textAlign: "right", width: 90 }}>{head[2]}</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={r.key} className="spr-row">
                        <td style={{ ...cell, fontWeight: 600, wordBreak: "break-word" }}>
                            {r.label}
                        </td>
                        <td style={{ ...num, fontWeight: 700 }}>{nf(r.total)}</td>
                        <td style={{ ...num, color: MUTED }}>{nf(r.completed)}</td>
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr>
                    <td style={fcell}>All</td>
                    <td
                        style={{ ...fcell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    >
                        {nf(sumT)}
                    </td>
                    <td
                        style={{ ...fcell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    >
                        {nf(sumC)}
                    </td>
                </tr>
            </tfoot>
        </table>
    );
};

// one cell of the "Share details" strip: icon tile + small label + value
const ShareItem = ({
    icon,
    label,
    value,
    sub,
    color,
    tint,
}: {
    icon: string;
    label: string;
    value: string;
    sub?: string;
    color: string;
    tint: string;
}) => (
    <div className="spr-share-item">
        <span
            aria-hidden="true"
            style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                background: tint,
                color,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 21,
                flexShrink: 0,
            }}
        >
            <i className={`ti ${icon}`} />
        </span>
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{label}</div>
            <div
                style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    marginTop: 1,
                    wordBreak: "break-word",
                    lineHeight: 1.3,
                }}
            >
                {value}
            </div>
            {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{sub}</div>}
        </div>
    </div>
);

const SharedProductionReport = ({
    shareId,
    eyebrow,
    picker,
}: {
    shareId?: string;
    eyebrow?: string;
    /** client dropdown, shown in the right side of the header (see sharepicker.tsx) */
    picker?: ReactNode;
}) => {
    // empty until the first response: the server picks the shared date range
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const skipNextLoad = useRef(false);
    const casesRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<string>("");
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<Section | null>("cases");

    const load = useCallback(async () => {
        if (skipNextLoad.current) {
            skipNextLoad.current = false;
            return;
        }
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(
                `${API_BASE}/api/client-portal/shared/production-reports?${new URLSearchParams({
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {}),
                    ...(shareId ? { shareId } : {}),
                }).toString()}`,
                { cache: "no-store" }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not load the report.");
            setData(json.data);
            setPage(1);
            setStatusFilter("");
            setQuery("");
            // first load: adopt the range the server chose (no second fetch)
            if (!from || !to) {
                skipNextLoad.current = true;
                setFrom(json.data.from);
                setTo(json.data.to);
            }
        } catch (e: any) {
            setError(e?.message || "Could not load the report.");
        } finally {
            setLoading(false);
        }
    }, [from, to, shareId]);

    useEffect(() => {
        load();
    }, [load]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (data?.cases || []).filter(
            (c) =>
                (!statusFilter || c.status === statusFilter) &&
                (!q ||
                    `${c.caseNumber} ${c.service} ${c.subclient || ""}`.toLowerCase().includes(q))
        );
    }, [data, statusFilter, query]);

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const slice = useMemo(
        () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filtered, page]
    );

    const pickStatus = (s: string, scroll = false) => {
        setStatusFilter((cur) => (cur === s ? "" : s));
        setPage(1);
        if (scroll) {
            setOpen("cases");
            setTimeout(
                () => casesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                60
            );
        }
    };

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

    const total = data?.summary.total || 0;
    const completed = data?.summary.byStatus["Completed"] || 0;
    const dayAsc = useMemo(() => [...(data?.byDay || [])].reverse(), [data]);
    const maxDay = Math.max(1, ...dayAsc.map((d) => d.total));
    const CHART_H = 170;
    const busiestDay = useMemo(
        () =>
            (data?.byDay || []).reduce<Report["byDay"][number] | null>(
                (b, d) => (!b || d.total > b.total ? d : b),
                null
            ),
        [data]
    );
    void busiestDay;
    const donutPct = total ? Math.round((completed / total) * 100) : 0;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    const PURPLE = "#5B47C9";

    // allowed window the sender shared (min..max); empty side = open ended
    const sharedWindow = (() => {
        const mn = data?.bounds?.min;
        const mx = data?.bounds?.max;
        if (mn && mx) return `${fmt(mn)} – ${fmt(mx)}`;
        if (mn) return `From ${fmt(mn)}`;
        if (mx) return `Up to ${fmt(mx)}`;
        return "All dates";
    })();

    return (
        <div className="spr">
            <style>{CSS}</style>

            {/* ---------- Header ---------- */}
            {eyebrow ? (
                <div
                    className="spr-hero spr-hero-light spr-hero-grid"
                    style={{
                        position: "relative",
                        background: "linear-gradient(120deg, #EEF0FF 0%, #F5EFFF 100%)",
                        border: `1px solid ${LINE}`,
                        borderRadius: 22,
                        padding: "16px 24px",
                        marginBottom: 16,
                        boxShadow: "0 1px 2px rgba(27,33,80,.04)",
                    }}
                >
                    {/* client (left) | client picker + export in one box (right) */}
                    <div className="spr-hero-top">
                        <div
                            style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 44,
                                    height: 44,
                                    flexShrink: 0,
                                    borderRadius: 14,
                                    background: "linear-gradient(135deg, #3B2F9E, #5B3FD1)",
                                    color: "#fff",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 22,
                                }}
                            >
                                <i className="ti ti-building" />
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <div
                                    style={{
                                        fontSize: 18,
                                        fontWeight: fontWeight.bold,
                                        letterSpacing: "-0.01em",
                                        lineHeight: 1.2,
                                    }}
                                >
                                    {data?.client?.name || "Your cases"}
                                </div>
                                <div
                                    style={{
                                        marginTop: 3,
                                        display: "flex",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                        gap: 8,
                                        fontSize: fontSize.sm,
                                        fontWeight: fontWeight.medium,
                                        color: MUTED,
                                    }}
                                >
                                    <span style={{ color: MUTED }}>Production Report</span>
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            gap: 6,
                                            alignItems: "center",
                                            background: "#E6E2FB",
                                            color: PURPLE,
                                            borderRadius: 999,
                                            padding: "2px 9px",
                                            fontSize: fontSize.sm,
                                            fontWeight: fontWeight.semibold,
                                        }}
                                    >
                                        <i className="ti ti-eye" aria-hidden="true" /> View only
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="spr-ctrl">
                            {picker && <div className="spr-picker">{picker}</div>}
                            <button
                                className="spr-btn"
                                onClick={exportCsv}
                                disabled={!data || data.cases.length === 0}
                                style={{
                                    height: "auto",
                                    minHeight: 44,
                                    alignSelf: "stretch",
                                    borderRadius: 14,
                                    background: "linear-gradient(135deg, #3B2F9E, #5B3FD1)",
                                    color: "#fff",
                                    border: "none",
                                    boxShadow: "0 4px 10px rgba(59,47,158,.25)",
                                }}
                            >
                                <i className="ti ti-download" aria-hidden="true" /> Export CSV
                            </button>
                        </div>
                    </div>

                    <h1
                        style={{
                            position: "absolute",
                            width: 1,
                            height: 1,
                            margin: -1,
                            padding: 0,
                            overflow: "hidden",
                            clip: "rect(0 0 0 0)",
                            whiteSpace: "nowrap",
                            border: 0,
                        }}
                    >
                        {eyebrow}
                    </h1>
                </div>
            ) : (
                <div
                    className="spr-hero"
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        background: "linear-gradient(120deg, #1F2766 0%, #3340B5 100%)",
                        borderRadius: 24,
                        padding: "26px 28px",
                        color: "#fff",
                        marginBottom: 16,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 20,
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                    }}
                >
                    <div style={{ minWidth: 240, position: "relative", zIndex: 1 }}>
                        <div
                            style={{
                                fontSize: 13,
                                opacity: 0.8,
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            Production report
                        </div>
                        <h2
                            style={{
                                margin: "4px 0 10px",
                                fontSize: 30,
                                lineHeight: 1.15,
                                fontWeight: 800,
                                letterSpacing: "-0.02em",
                                color: "#fff",
                            }}
                        >
                            {data?.client?.name || "Your cases"}
                        </h2>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                                alignItems: "center",
                            }}
                        >
                            <span
                                style={{
                                    display: "inline-flex",
                                    gap: 6,
                                    alignItems: "center",
                                    background: "rgba(255,255,255,.16)",
                                    borderRadius: 999,
                                    padding: "5px 12px",
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                }}
                            >
                                <i className="ti ti-eye" aria-hidden="true" /> View only
                            </span>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 12,
                            alignItems: "flex-end",
                            position: "relative",
                            zIndex: 1,
                        }}
                    >
                        <div style={{ display: "contents" }}>
                            <label style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9 }}>
                                <div style={{ marginBottom: 5 }}>From</div>
                                <input
                                    className="spr-date"
                                    type="date"
                                    value={from || data?.from || ""}
                                    min={data?.bounds?.min || undefined}
                                    max={to || data?.bounds?.max || undefined}
                                    onChange={(e) => e.target.value && setFrom(e.target.value)}
                                />
                            </label>
                            <label style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9 }}>
                                <div style={{ marginBottom: 5 }}>To</div>
                                <input
                                    className="spr-date"
                                    type="date"
                                    value={to || data?.to || ""}
                                    min={from || data?.bounds?.min || undefined}
                                    max={data?.bounds?.max || undefined}
                                    onChange={(e) => e.target.value && setTo(e.target.value)}
                                />
                            </label>
                        </div>
                        <button
                            className="spr-btn"
                            onClick={exportCsv}
                            disabled={!data || data.cases.length === 0}
                            style={{ background: "#fff", color: INK, border: "1px solid #fff" }}
                        >
                            <i className="ti ti-download" aria-hidden="true" /> Export CSV
                        </button>
                    </div>
                </div>
            )}

            {loading && (
                <div className="spr-card" style={{ padding: 28, color: MUTED, fontWeight: 600 }}>
                    Loading your report…
                </div>
            )}
            {!loading && error && (
                <div
                    role="alert"
                    style={{
                        background: "#FFF1F1",
                        border: "1px solid #F5C2C2",
                        color: "#A32020",
                        padding: "14px 16px",
                        borderRadius: 14,
                    }}
                >
                    {error}
                </div>
            )}

            {!loading && !error && data && (
                <>
                    {/* ---------- Share details: who shared it, when, for whom ---------- */}
                    <div className="spr-card" style={{ marginBottom: 16, overflow: "hidden" }}>
                        <div
                            style={{
                                padding: "14px 20px 12px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                flexWrap: "wrap",
                                borderBottom: `1px solid ${LINE}`,
                                background: "#FAFBFE",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <i
                                    className="ti ti-share-3"
                                    aria-hidden="true"
                                    style={{ color: PURPLE, fontSize: 20 }}
                                />
                                <h3 className="spr-title">Share details</h3>
                            </div>
                            {/* dates: no From/To labels, just the two dates */}
                            <div className="spr-dates">
                                <input
                                    className="spr-date"
                                    type="date"
                                    aria-label="From date"
                                    title="From date"
                                    style={{ height: 36 }}
                                    value={from || data?.from || ""}
                                    min={data?.bounds?.min || undefined}
                                    max={to || data?.bounds?.max || undefined}
                                    onChange={(e) => e.target.value && setFrom(e.target.value)}
                                />
                                <i
                                    className="ti ti-arrow-right"
                                    aria-hidden="true"
                                    style={{ color: MUTED, fontSize: 16 }}
                                />
                                <input
                                    className="spr-date"
                                    type="date"
                                    aria-label="To date"
                                    title="To date"
                                    style={{ height: 36 }}
                                    value={to || data?.to || ""}
                                    min={from || data?.bounds?.min || undefined}
                                    max={data?.bounds?.max || undefined}
                                    onChange={(e) => e.target.value && setTo(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="spr-share">
                            <ShareItem
                                icon="ti-user-check"
                                label="Shared by"
                                value={data.share?.sharedBy || "Your service team"}
                                color="#5B47C9"
                                tint="#EEEAFB"
                            />
                            <ShareItem
                                icon="ti-calendar-event"
                                label="Shared on"
                                value={
                                    data.share?.sharedAt ? fmtDateTime(data.share.sharedAt) : "—"
                                }
                                color="#EA6A0A"
                                tint="#FFF0E3"
                            />
                            <ShareItem
                                icon="ti-building"
                                label="Client"
                                value={data.client?.name || "—"}
                                color="#3B4AB8"
                                tint="#ECEFFB"
                            />
                            <ShareItem
                                icon="ti-file-analytics"
                                label="What was shared"
                                value={data.share?.page || "Production Reports"}
                                sub={data.share?.permission || "View only"}
                                color="#0E7490"
                                tint="#D9F3F7"
                            />
                            <ShareItem
                                icon="ti-calendar-stats"
                                label="Dates shared"
                                value={sharedWindow}
                                sub={`Viewing ${fmt(data.from)} – ${fmt(data.to)}`}
                                color="#A21CAF"
                                tint="#F8E7FB"
                            />
                        </div>
                        {(data.filters || []).length > 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "12px 20px",
                                    borderTop: `1px solid ${LINE}`,
                                    background: "#FAFBFE",
                                }}
                            >
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED }}>
                                    <i
                                        className="ti ti-filter"
                                        aria-hidden="true"
                                        style={{ marginRight: 6 }}
                                    />
                                    Filters set by the sender
                                </span>
                                {(data.filters || []).map((f) => (
                                    <span
                                        key={`${f.label}:${f.value}`}
                                        style={{
                                            background: "#ECEFFB",
                                            color: BRAND,
                                            borderRadius: 999,
                                            padding: "4px 12px",
                                            fontSize: 12.5,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {f.label}: {f.value}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {data.truncated && (
                        <div
                            style={{
                                color: "#9A6700",
                                background: "#FFF4DB",
                                padding: "10px 14px",
                                borderRadius: 12,
                                marginBottom: 14,
                                fontSize: 13,
                            }}
                        >
                            Very large range — showing the first 5,000 cases. Narrow the dates for
                            the full picture.
                        </div>
                    )}

                    {eyebrow ? (
                        <>
                            {/* ---------- Total cases (compact) ---------- */}
                            <div
                                className="spr-card"
                                style={{
                                    padding: "12px 20px",
                                    marginBottom: 14,
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                    <span
                                        aria-hidden="true"
                                        style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: 13,
                                            background: "#EEEAFB",
                                            color: PURPLE,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 22,
                                            flexShrink: 0,
                                        }}
                                    >
                                        <i className="ti ti-file-text" />
                                    </span>
                                    <div>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "baseline",
                                                gap: 10,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontSize: fontSize.md,
                                                    fontWeight: fontWeight.bold,
                                                }}
                                            >
                                                Total Cases
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 28,
                                                    lineHeight: 1.1,
                                                    fontWeight: 800,
                                                    letterSpacing: "-0.02em",
                                                }}
                                            >
                                                {nf(total)}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                                            between {fmt(data.from)} and {fmt(data.to)}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <svg
                                        width="52"
                                        height="52"
                                        viewBox="0 0 84 84"
                                        role="img"
                                        aria-label={`${donutPct}% completed`}
                                    >
                                        <circle
                                            cx="42"
                                            cy="42"
                                            r="34"
                                            fill="none"
                                            stroke="#EEEAFB"
                                            strokeWidth="10"
                                        />
                                        <circle
                                            cx="42"
                                            cy="42"
                                            r="34"
                                            fill="none"
                                            stroke="#7C5CE8"
                                            strokeWidth="10"
                                            strokeLinecap="round"
                                            strokeDasharray={`${(donutPct / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
                                            transform="rotate(-90 42 42)"
                                        />
                                        <text
                                            x="42"
                                            y="49"
                                            textAnchor="middle"
                                            fontSize="22"
                                            fontWeight="800"
                                            fill={INK}
                                        >
                                            {donutPct}%
                                        </text>
                                    </svg>
                                    <div>
                                        <div
                                            style={{
                                                fontSize: fontSize.base,
                                                fontWeight: fontWeight.bold,
                                            }}
                                        >
                                            Completed
                                        </div>
                                        <div style={{ fontSize: 12.5, color: MUTED }}>
                                            {nf(completed)} of {nf(total)} cases
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ---------- Status cards ---------- */}
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                                    gap: 14,
                                    marginBottom: 18,
                                }}
                            >
                                {STATUSES.map((st) => {
                                    const n = data.summary.byStatus[st] || 0;
                                    const sty = STATUS_STYLE[st];
                                    return (
                                        <button
                                            key={st}
                                            className="spr-legend"
                                            aria-pressed={statusFilter === st}
                                            onClick={() => pickStatus(st, true)}
                                            title={`Show ${st} cases`}
                                            style={{
                                                background: sty.bg,
                                                borderRadius: 18,
                                                padding: "16px 18px",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 34,
                                                        height: 34,
                                                        borderRadius: 11,
                                                        background: sty.solid,
                                                        color: "#fff",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontSize: 18,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    <i
                                                        className={`ti ${sty.icon}`}
                                                        aria-hidden="true"
                                                    />
                                                </span>
                                                <span
                                                    style={{
                                                        flex: 1,
                                                        fontSize: fontSize.md,
                                                        fontWeight: fontWeight.bold,
                                                        color: sty.fg,
                                                    }}
                                                >
                                                    {st}
                                                </span>
                                                <i
                                                    className="ti ti-chevron-right"
                                                    aria-hidden="true"
                                                    style={{ color: sty.solid, fontSize: 18 }}
                                                />
                                            </div>
                                            <div
                                                style={{
                                                    marginTop: 14,
                                                    fontSize: 32,
                                                    fontWeight: 800,
                                                    lineHeight: 1,
                                                    color: INK,
                                                }}
                                            >
                                                {nf(n)}
                                            </div>
                                            <div
                                                style={{
                                                    marginTop: 10,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    fontSize: fontSize.sm,
                                                    fontWeight: fontWeight.semibold,
                                                    color: sty.fg,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: sty.solid,
                                                    }}
                                                />
                                                {pct(n)}%
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* ---------- Pipeline ---------- */}
                            <div className="spr-card" style={{ padding: 22, marginBottom: 18 }}>
                                <div
                                    style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        alignItems: "flex-end",
                                        gap: 18,
                                        justifyContent: "space-between",
                                        marginBottom: 16,
                                    }}
                                >
                                    <div>
                                        <div
                                            style={{
                                                fontSize: 44,
                                                lineHeight: 1,
                                                fontWeight: 800,
                                                letterSpacing: "-0.03em",
                                            }}
                                        >
                                            {nf(total)}
                                        </div>
                                        <div style={{ fontSize: 13.5, color: MUTED, marginTop: 6 }}>
                                            cases between {fmt(data.from)} and {fmt(data.to)}
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontSize: 15, fontWeight: 700 }}>
                                                Completed
                                            </div>
                                            <div style={{ fontSize: 13, color: MUTED }}>
                                                {nf(completed)} of {nf(total)} cases
                                            </div>
                                        </div>
                                        <svg
                                            width="76"
                                            height="76"
                                            viewBox="0 0 84 84"
                                            role="img"
                                            aria-label={`${donutPct}% completed`}
                                        >
                                            <circle
                                                cx="42"
                                                cy="42"
                                                r="34"
                                                fill="none"
                                                stroke="#EEF1F8"
                                                strokeWidth="10"
                                            />
                                            <circle
                                                cx="42"
                                                cy="42"
                                                r="34"
                                                fill="none"
                                                stroke={STATUS_STYLE.Completed.solid}
                                                strokeWidth="10"
                                                strokeLinecap="round"
                                                strokeDasharray={`${(donutPct / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
                                                transform="rotate(-90 42 42)"
                                            />
                                            <text
                                                x="42"
                                                y="48"
                                                textAnchor="middle"
                                                fontSize="18"
                                                fontWeight="800"
                                                fill={INK}
                                            >
                                                {donutPct}%
                                            </text>
                                        </svg>
                                    </div>
                                </div>

                                {/* the segmented status bar */}
                                <div
                                    role="img"
                                    aria-label={STATUSES.map(
                                        (s) => `${s}: ${data.summary.byStatus[s] || 0}`
                                    ).join(", ")}
                                    style={{
                                        display: "flex",
                                        height: 16,
                                        borderRadius: 999,
                                        overflow: "hidden",
                                        background: "#EEF1F8",
                                        gap: 2,
                                        marginBottom: 18,
                                    }}
                                >
                                    {STATUSES.map((s) => {
                                        const n = data.summary.byStatus[s] || 0;
                                        if (!n || !total) return null;
                                        return (
                                            <div
                                                key={s}
                                                className="spr-grow"
                                                title={`${s}: ${nf(n)}`}
                                                style={{
                                                    width: `${(n / total) * 100}%`,
                                                    background: STATUS_STYLE[s].solid,
                                                }}
                                            />
                                        );
                                    })}
                                </div>

                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                                        gap: 10,
                                    }}
                                >
                                    {STATUSES.map((s) => {
                                        const n = data.summary.byStatus[s] || 0;
                                        return (
                                            <button
                                                key={s}
                                                className="spr-legend"
                                                aria-pressed={statusFilter === s}
                                                onClick={() => pickStatus(s, true)}
                                                title={`Show ${s} cases`}
                                                style={{ background: STATUS_STYLE[s].bg }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 10,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            width: 30,
                                                            height: 30,
                                                            borderRadius: 10,
                                                            background: STATUS_STYLE[s].solid,
                                                            color: "#fff",
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            fontSize: 16,
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        <i
                                                            className={`ti ${STATUS_STYLE[s].icon}`}
                                                            aria-hidden="true"
                                                        />
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: 13.5,
                                                            fontWeight: 700,
                                                            color: STATUS_STYLE[s].fg,
                                                        }}
                                                    >
                                                        {s}
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        marginTop: 10,
                                                        fontSize: 26,
                                                        fontWeight: 800,
                                                        color: INK,
                                                        lineHeight: 1,
                                                    }}
                                                >
                                                    {nf(n)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    {/* ---------- Section tabs (slim) ---------- */}
                    <div
                        role="tablist"
                        aria-label="Report sections"
                        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}
                    >
                        {(
                            [
                                {
                                    key: "cases",
                                    icon: "ti-file-text",
                                    label: "Cases",
                                    n: data.cases.length,
                                },
                                {
                                    key: "service",
                                    icon: "ti-layout-grid",
                                    label: "By service",
                                    n: data.byService.length,
                                },
                                {
                                    key: "day",
                                    icon: "ti-calendar",
                                    label: "By day",
                                    n: data.byDay.length,
                                },
                            ] as { key: Section; icon: string; label: string; n: number }[]
                        ).map((t) => {
                            const on = open === t.key;
                            return (
                                <button
                                    key={t.key}
                                    role="tab"
                                    aria-selected={on}
                                    className="spr-tab"
                                    onClick={() => setOpen(t.key)}
                                >
                                    <i className={`ti ${t.icon}`} aria-hidden="true" />
                                    {t.label}
                                    <small>{nf(t.n)}</small>
                                </button>
                            );
                        })}
                    </div>

                    {open === "service" && (
                        <div className="spr-card spr-panel" style={{ overflow: "hidden" }}>
                            <CardHead
                                icon="ti-layout-grid"
                                title="By service"
                                sub={`${data.byService.length} service${data.byService.length === 1 ? "" : "s"} in this range`}
                            />
                            {data.byService.length === 0 ? (
                                <div style={{ padding: "6px 20px 24px", color: MUTED }}>
                                    No data in this range.
                                </div>
                            ) : (
                                <div style={{ ...panelGrid, gridTemplateColumns: "1fr" }}>
                                    <Box title="Services" pad={0}>
                                        <MiniTable
                                            head={["Service", "Total", "Completed"]}
                                            rows={data.byService.map((x) => ({
                                                key: x.service,
                                                label: x.service,
                                                total: x.total,
                                                completed: x.completed,
                                            }))}
                                        />
                                    </Box>
                                </div>
                            )}
                        </div>
                    )}

                    {open === "day" && (
                        <div className="spr-card spr-panel" style={{ overflow: "hidden" }}>
                            <CardHead
                                icon="ti-calendar"
                                title="By day"
                                sub={`${dayAsc.length} working day${dayAsc.length === 1 ? "" : "s"} in this range`}
                            />
                            {dayAsc.length === 0 ? (
                                <div style={{ padding: "6px 20px 24px", color: MUTED }}>
                                    No data in this range.
                                </div>
                            ) : (
                                <div style={panelGrid}>
                                    <Box title="Daily volume" right={<Legend />}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "flex-end",
                                                justifyContent: "center",
                                                gap: 10,
                                                minWidth: "max-content",
                                                minHeight: "100%",
                                                paddingTop: 8,
                                            }}
                                        >
                                            {dayAsc.map((d) => {
                                                const sd = fmtShort(d.date);
                                                const h = Math.max(6, (d.total / maxDay) * CHART_H);
                                                const ch = d.total
                                                    ? (d.completed / d.total) * 100
                                                    : 0;
                                                return (
                                                    <div
                                                        key={d.date}
                                                        className="spr-col"
                                                        title={`${fmt(d.date)}: ${d.total} cases, ${d.completed} completed`}
                                                        style={{
                                                            width: 36,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "center",
                                                            gap: 6,
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                fontSize: 12,
                                                                fontWeight: 700,
                                                            }}
                                                        >
                                                            {d.total}
                                                        </span>
                                                        <div
                                                            className="spr-colbar spr-grow"
                                                            style={{
                                                                width: "100%",
                                                                height: h,
                                                                background: "#C6CEF2",
                                                                borderRadius: "8px 8px 4px 4px",
                                                                display: "flex",
                                                                alignItems: "flex-end",
                                                                overflow: "hidden",
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: "100%",
                                                                    height: `${ch}%`,
                                                                    background: BRAND,
                                                                }}
                                                            />
                                                        </div>
                                                        <span
                                                            style={{
                                                                fontSize: 11.5,
                                                                color: MUTED,
                                                                textAlign: "center",
                                                                lineHeight: 1.2,
                                                                fontWeight: 600,
                                                            }}
                                                        >
                                                            {sd.day}
                                                            <br />
                                                            {sd.month}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Box>
                                    <Box title="Day list" pad={0}>
                                        <MiniTable
                                            head={["Date", "Total", "Completed"]}
                                            rows={data.byDay.map((x) => ({
                                                key: x.date,
                                                label: fmt(x.date),
                                                total: x.total,
                                                completed: x.completed,
                                            }))}
                                        />
                                    </Box>
                                </div>
                            )}
                        </div>
                    )}

                    {open === "cases" && (
                        <div
                            ref={casesRef}
                            className="spr-card spr-panel"
                            style={{ overflow: "hidden", scrollMarginTop: 12 }}
                        >
                            <CardHead
                                icon="ti-file-text"
                                title="Cases"
                                sub={`${nf(filtered.length)} of ${nf(data.cases.length)} shown`}
                                right={
                                    <div style={{ position: "relative" }}>
                                        <i
                                            className="ti ti-search"
                                            aria-hidden="true"
                                            style={{
                                                position: "absolute",
                                                left: 12,
                                                top: 10,
                                                color: MUTED,
                                                fontSize: 16,
                                            }}
                                        />
                                        <input
                                            className="spr-search"
                                            type="search"
                                            value={query}
                                            placeholder="Search case, service or subclient"
                                            aria-label="Search cases"
                                            onChange={(e) => {
                                                setQuery(e.target.value);
                                                setPage(1);
                                            }}
                                            style={{
                                                height: 38,
                                                width: 280,
                                                maxWidth: "100%",
                                                padding: "0 12px 0 34px",
                                                border: `1px solid ${LINE}`,
                                                borderRadius: 12,
                                                font: `500 13px ${fontFamily.base}`,
                                                color: INK,
                                                background: "#fff",
                                            }}
                                        />
                                    </div>
                                }
                            />
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                    padding: "0 20px 14px",
                                }}
                            >
                                <button
                                    className="spr-chip"
                                    aria-pressed={statusFilter === ""}
                                    onClick={() => {
                                        setStatusFilter("");
                                        setPage(1);
                                    }}
                                >
                                    All <small>{nf(data.cases.length)}</small>
                                </button>
                                {STATUSES.map((s) => (
                                    <button
                                        key={s}
                                        className="spr-chip"
                                        aria-pressed={statusFilter === s}
                                        onClick={() => pickStatus(s)}
                                    >
                                        {s} <small>{nf(data.summary.byStatus[s] || 0)}</small>
                                    </button>
                                ))}
                            </div>

                            {filtered.length === 0 ? (
                                <div
                                    style={{
                                        padding: "40px 20px 48px",
                                        textAlign: "center",
                                        color: MUTED,
                                        borderTop: `1px solid ${LINE}`,
                                    }}
                                >
                                    <i
                                        className="ti ti-inbox"
                                        aria-hidden="true"
                                        style={{ fontSize: 30 }}
                                    />
                                    <div style={{ marginTop: 8, fontSize: 14.5 }}>
                                        {data.cases.length === 0
                                            ? "No cases in this date range."
                                            : "No cases match your search or filter."}
                                    </div>
                                </div>
                            ) : (
                                <div className="spr-scroll" style={{ overflowX: "auto" }}>
                                    <table
                                        style={{
                                            width: "100%",
                                            borderCollapse: "collapse",
                                            minWidth: 640,
                                        }}
                                    >
                                        <thead>
                                            <tr>
                                                <th style={th}>Case no.</th>
                                                <th style={th}>Service</th>
                                                <th style={th}>Subclient</th>
                                                <th style={th}>Work date</th>
                                                <th style={th}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {slice.map((c) => (
                                                <tr key={c.id} className="spr-row">
                                                    <td style={{ ...td, fontWeight: 700 }}>
                                                        {c.caseNumber}
                                                    </td>
                                                    <td style={td}>{c.service}</td>
                                                    <td
                                                        style={{
                                                            ...td,
                                                            color: c.subclient ? INK : MUTED,
                                                        }}
                                                    >
                                                        {c.subclient || "—"}
                                                    </td>
                                                    <td style={td}>{fmt(c.workDate)}</td>
                                                    <td style={td}>
                                                        <Pill status={c.status} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {filtered.length > PAGE_SIZE && (
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                        gap: 10,
                                        padding: "14px 20px",
                                        borderTop: `1px solid ${LINE}`,
                                    }}
                                >
                                    <span style={{ fontSize: 13, color: MUTED }}>
                                        Showing {(page - 1) * PAGE_SIZE + 1}–
                                        {Math.min(page * PAGE_SIZE, filtered.length)} of{" "}
                                        {nf(filtered.length)}
                                    </span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <button
                                            className="spr-pg"
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                            disabled={page === 1}
                                            aria-label="Previous page"
                                        >
                                            <i className="ti ti-chevron-left" aria-hidden="true" />
                                        </button>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                                            Page {page} of {pages}
                                        </span>
                                        <button
                                            className="spr-pg"
                                            onClick={() => setPage((p) => Math.min(pages, p + 1))}
                                            disabled={page === pages}
                                            aria-label="Next page"
                                        >
                                            <i className="ti ti-chevron-right" aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default SharedProductionReport;
