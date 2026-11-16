// src/components/acceptancestatus.tsx
//
// For the person who ALLOCATES (Today's Allocation screen): a button that
// shows, per employee, how much of the work I allocated today is
//   - accepted,
//   - still waiting for an answer (and for how long),
//   - declined (and why).
// So there is no need to wait for the 2-hour reminder mail to find out.
//
//   GET /api/service-cases/acceptance-status

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

type StatusRow = {
    employeeId: string;
    name: string;
    accepted: number;
    waiting: number;
    declined: number;
    waitingSince: string | null;
    declineReasons: string[];
};

type StatusData = {
    ready: boolean;
    rows: StatusRow[];
    totals: { accepted: number; waiting: number; declined: number };
};

// the backend mails a reminder after this long (see ACCEPT_REMINDER_HOURS)
const REMINDER_MINUTES = 120;
const REFRESH_MS = 60 * 1000;

function waitingFor(iso: string | null, nowMs: number): string {
    if (!iso) return "";
    const mins = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

export default function AcceptanceStatusButton() {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<StatusData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const load = useCallback(async (spinner: boolean) => {
        if (spinner) setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/acceptance-status`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                if (spinner) setError(json?.message || "Could not load the status.");
                return;
            }
            setData(json.data);
            setError(null);
            setNowMs(Date.now());
        } catch (err) {
            console.error("acceptance-status load failed:", err);
            if (spinner) setError("Could not load the status.");
        } finally {
            if (spinner) setLoading(false);
        }
    }, []);

    // keeps the badge on the button fresh (only while the tab is visible)
    useEffect(() => {
        load(false);
        const t = setInterval(() => {
            if (document.visibilityState === "visible") load(false);
        }, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    useEffect(() => {
        if (!open) return;
        load(true);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, load]);

    const waiting = data?.totals.waiting || 0;

    return (
        <>
            <button
                type="button"
                style={S.btn}
                onClick={() => setOpen(true)}
                title="See who accepted, who is still waiting and who declined"
            >
                <i className="ti ti-user-check" />
                Acceptance Status
                {waiting > 0 && <span style={S.badge}>{waiting} waiting</span>}
            </button>

            {open && (
                <div style={S.overlay} onClick={() => setOpen(false)}>
                    <div
                        style={S.card}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Acceptance status"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={S.head}>
                            <div>
                                <h3 style={S.title}>Acceptance status</h3>
                                <p style={S.sub}>Work you allocated today, per employee.</p>
                            </div>
                            <div style={S.headRight}>
                                <button
                                    type="button"
                                    style={S.refreshBtn}
                                    disabled={loading}
                                    onClick={() => load(true)}
                                >
                                    {loading ? "Refreshing…" : "Refresh"}
                                </button>
                                <button
                                    type="button"
                                    style={S.closeX}
                                    onClick={() => setOpen(false)}
                                    aria-label="Close"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        {error && <p style={S.error}>{error}</p>}

                        {!error && data && !data.ready && (
                            <p style={S.note}>
                                Accept / Decline is not switched on yet (database update pending).
                            </p>
                        )}

                        {!error && data && data.ready && data.rows.length === 0 && (
                            <p style={S.note}>You have not allocated anything to anyone today.</p>
                        )}

                        {!error && data && data.ready && data.rows.length > 0 && (
                            <>
                                <div style={S.chips}>
                                    <span
                                        style={{
                                            ...S.chip,
                                            background: "#DCFCE7",
                                            color: "#166534",
                                        }}
                                    >
                                        <strong>{data.totals.accepted}</strong> accepted
                                    </span>
                                    <span
                                        style={{
                                            ...S.chip,
                                            background: "#FEF3C7",
                                            color: "#92400E",
                                        }}
                                    >
                                        <strong>{data.totals.waiting}</strong> waiting
                                    </span>
                                    <span
                                        style={{
                                            ...S.chip,
                                            background: "#FEE2E2",
                                            color: "#991B1B",
                                        }}
                                    >
                                        <strong>{data.totals.declined}</strong> declined
                                    </span>
                                </div>

                                <div style={S.tableWrap}>
                                    <table style={S.table}>
                                        <thead>
                                            <tr>
                                                {[
                                                    "Employee",
                                                    "Accepted",
                                                    "Waiting",
                                                    "Declined",
                                                    "Status",
                                                ].map((h) => (
                                                    <th key={h} style={S.th}>
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.rows.map((r) => {
                                                const mins = r.waitingSince
                                                    ? Math.floor(
                                                          (nowMs -
                                                              new Date(r.waitingSince).getTime()) /
                                                              60000
                                                      )
                                                    : 0;
                                                const overdue =
                                                    r.waiting > 0 && mins >= REMINDER_MINUTES;
                                                let status = "Accepted";
                                                let color = "#166534";
                                                let bg = "#DCFCE7";
                                                if (r.waiting > 0) {
                                                    status = "Waiting";
                                                    color = "#92400E";
                                                    bg = "#FEF3C7";
                                                } else if (r.declined > 0 && r.accepted === 0) {
                                                    status = "Declined";
                                                    color = "#991B1B";
                                                    bg = "#FEE2E2";
                                                } else if (r.declined > 0) {
                                                    status = "Partly declined";
                                                    color = "#991B1B";
                                                    bg = "#FEE2E2";
                                                }
                                                return (
                                                    <tr key={r.employeeId}>
                                                        <td style={S.tdName}>{r.name}</td>
                                                        <td style={S.td}>{r.accepted || "—"}</td>
                                                        <td style={S.td}>
                                                            {r.waiting ? (
                                                                <strong>{r.waiting}</strong>
                                                            ) : (
                                                                "—"
                                                            )}
                                                            {r.waiting > 0 && (
                                                                <div
                                                                    style={{
                                                                        ...S.muted,
                                                                        color: overdue
                                                                            ? "#B91C1C"
                                                                            : "#9CA3AF",
                                                                    }}
                                                                >
                                                                    {waitingFor(
                                                                        r.waitingSince,
                                                                        nowMs
                                                                    )}
                                                                    {overdue
                                                                        ? " · reminder sent"
                                                                        : ""}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td style={S.td}>
                                                            {r.declined ? (
                                                                <strong>{r.declined}</strong>
                                                            ) : (
                                                                "—"
                                                            )}
                                                            {r.declineReasons.map((reason) => (
                                                                <div key={reason} style={S.muted}>
                                                                    {reason}
                                                                </div>
                                                            ))}
                                                        </td>
                                                        <td style={S.td}>
                                                            <span
                                                                style={{
                                                                    ...S.status,
                                                                    color,
                                                                    background: bg,
                                                                }}
                                                            >
                                                                {status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p style={S.foot}>
                                    Anyone still waiting after 2 hours gets a reminder mail, and
                                    their reporting manager is told. Numbers are cases (a count
                                    counts as its quantity).
                                </p>
                            </>
                        )}

                        {!error && !data && <p style={S.note}>Loading…</p>}
                    </div>
                </div>
            )}
        </>
    );
}

const BLUE = "var(--brand-blue)";

const S: Record<string, CSSProperties> = {
    btn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: radius.sm,
        border: `1px solid ${BLUE}`,
        background: "#fff",
        color: BLUE,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    badge: {
        marginLeft: 4,
        padding: "1px 8px",
        borderRadius: 999,
        background: "#F59E0B",
        color: "#fff",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.bold,
    },
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1100,
    },
    card: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
        width: "min(720px, 100%)",
        maxHeight: "85vh",
        overflowY: "auto",
        padding: 20,
    },
    head: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 },
    headRight: { display: "flex", alignItems: "flex-start", gap: 8 },
    title: {
        margin: 0,
        textAlign: "left",
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#1e2a4a",
    },
    sub: { margin: "4px 0 0", textAlign: "left", fontSize: fontSize.sm, color: "#6b7690" },
    refreshBtn: {
        padding: "6px 12px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    closeX: {
        border: "none",
        background: "transparent",
        fontSize: 26,
        lineHeight: 1,
        cursor: "pointer",
        color: "#767F92",
    },
    chips: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
    chip: { padding: "4px 12px", borderRadius: 999, fontSize: fontSize.sm },
    tableWrap: { overflowX: "auto", border: "1px solid #eef1f6", borderRadius: radius.md },
    table: { width: "100%", borderCollapse: "collapse", minWidth: 520 },
    th: {
        textAlign: "left",
        padding: "8px 10px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
    },
    td: {
        textAlign: "left",
        padding: "10px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.sm,
        color: "#17181C",
        verticalAlign: "top",
    },
    tdName: {
        textAlign: "left",
        padding: "10px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        verticalAlign: "top",
    },
    muted: { fontSize: fontSize.xs, color: "#9CA3AF", marginTop: 2 },
    status: {
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    },
    foot: { margin: "12px 0 0", fontSize: fontSize.xs, color: "#9CA3AF", textAlign: "left" },
    note: { margin: "8px 0", fontSize: fontSize.sm, color: "#6b7690", textAlign: "left" },
    error: { margin: "8px 0", fontSize: fontSize.sm, color: "#DC2626", textAlign: "left" },
};
