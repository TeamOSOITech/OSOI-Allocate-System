// src/pages/client/clientdashboard.tsx
//
// Client Dashboard — the ONLY page a CLIENT login can open. Shows just the
// cases staff have shared with this client (GET /api/client-portal/dashboard).
// Read-only. Every other sidebar tab is disabled for this role (see
// components/sidebar.tsx) and blocked server-side (middlewares/auth.js).

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

// Pages staff can share with a client (see PAGE_KEYS on the backend).
// To add one: register its read-only component here.
const SharedProductionReport = lazy(() => import("./sharedproductionreport"));
const SHARED_PAGES: Record<string, ComponentType<{ shareId?: string }>> = {
    "production-reports": SharedProductionReport,
};
type MyPage = {
    pageKey: string;
    label: string;
    permission: "VIEW" | "EDIT";
    shareId: string;
};

type Status = "Received" | "In Progress" | "Submitted" | "Under Review" | "Completed";

type SharedCase = {
    id: string;
    caseNumber: string;
    service: string | null;
    subclient: string | null;
    workDate: string | null;
    status: Status;
    submittedAt: string | null;
    sharedAt: string | null;
};

type Dashboard = {
    client: { id: string; name: string };
    summary: {
        total: number;
        received: number;
        inProgress: number;
        submitted: number;
        underReview: number;
        completed: number;
    };
    cases: SharedCase[];
};

const STATUS_STYLE: Record<Status, { bg: string; fg: string }> = {
    Received: { bg: "#EEF1F6", fg: "#55607A" },
    "In Progress": { bg: "#FFF4DB", fg: "#9A6700" },
    Submitted: { bg: "#E3F0FF", fg: "#0B5CAD" },
    "Under Review": { bg: "#F1E8FF", fg: "#6B3FB5" },
    Completed: { bg: "#DFF6E8", fg: "#1B7F46" },
};

const fmtDate = (d?: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime())
        ? String(d)
        : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const ClientDashboard = () => {
    const [data, setData] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState<"All" | Status>("All");
    const [search, setSearch] = useState("");
    const [myPages, setMyPages] = useState<MyPage[]>([]);
    const [tab, setTab] = useState<string>("cases");

    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/client-portal/my-pages`, {
                    cache: "no-store",
                });
                const json = await res.json().catch(() => ({}));
                if (res.ok && json.success !== false) {
                    setMyPages((json.data || []).filter((p: MyPage) => SHARED_PAGES[p.pageKey]));
                }
            } catch {
                /* no shared pages — only the cases tab is shown */
            }
        })();
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/client-portal/dashboard`, {
                    cache: "no-store",
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false) {
                    throw new Error(json.message || "Could not load your dashboard.");
                }
                if (!cancelled) setData(json.data);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || "Could not load your dashboard.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (data?.cases || []).filter((c) => {
            if (filter !== "All" && c.status !== filter) return false;
            if (!term) return true;
            return [c.caseNumber, c.service, c.subclient]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(term));
        });
    }, [data, filter, search]);

    const cards: { key: "All" | Status; label: string; value: number; icon: string }[] = data
        ? [
              {
                  key: "All",
                  label: "Shared with you",
                  value: data.summary.total,
                  icon: "ti ti-share",
              },
              {
                  key: "Received",
                  label: "Received",
                  value: data.summary.received,
                  icon: "ti ti-inbox",
              },
              {
                  key: "In Progress",
                  label: "In Progress",
                  value: data.summary.inProgress,
                  icon: "ti ti-loader",
              },
              {
                  key: "Submitted",
                  label: "Submitted",
                  value: data.summary.submitted,
                  icon: "ti ti-send",
              },
              {
                  key: "Under Review",
                  label: "Under Review",
                  value: data.summary.underReview,
                  icon: "ti ti-eye-check",
              },
              {
                  key: "Completed",
                  label: "Completed",
                  value: data.summary.completed,
                  icon: "ti ti-circle-check",
              },
          ]
        : [];

    const th = {
        textAlign: "left" as const,
        padding: "10px 14px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#6b6280",
        textTransform: "uppercase" as const,
        letterSpacing: 0.4,
        background: "#F6F8FD",
        borderBottom: "1px solid #E7EBF5",
        whiteSpace: "nowrap" as const,
    };
    const td = {
        padding: "11px 14px",
        fontSize: fontSize.base,
        color: "#2b2a3a",
        borderBottom: "1px solid #EEF1F8",
    };

    return (
        <div style={{ padding: "24px 28px", fontFamily: fontFamily.base, minHeight: "100%" }}>
            {/* Banner */}
            <div
                style={{
                    background:
                        "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
                    color: "#fff",
                    borderRadius: radius.xl,
                    padding: "22px 26px",
                    marginBottom: 20,
                    boxShadow: "0 6px 18px rgba(var(--brand-blue-rgb),0.25)",
                }}
            >
                <div style={{ fontSize: fontSize.sm, opacity: 0.85 }}>Client Dashboard</div>
                <div
                    style={{
                        fontSize: fontSize["3xl"],
                        fontWeight: fontWeight.semibold,
                        marginTop: 4,
                    }}
                >
                    {data ? data.client.name : "Welcome"}
                </div>
                <div style={{ fontSize: fontSize.sm, opacity: 0.85, marginTop: 6 }}>
                    You can see only the work that has been shared with you.
                </div>
            </div>

            {myPages.length > 0 && (
                <div
                    role="tablist"
                    style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}
                >
                    {[{ pageKey: "cases", label: "Shared cases" }, ...myPages].map((t) => {
                        const active = tab === t.pageKey;
                        return (
                            <button
                                key={t.pageKey}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setTab(t.pageKey)}
                                style={{
                                    padding: "9px 18px",
                                    borderRadius: radius.lg,
                                    border: active
                                        ? "1px solid var(--brand-blue)"
                                        : "1px solid #D9DEEE",
                                    background: active ? "var(--brand-blue)" : "#fff",
                                    color: active ? "#fff" : "#2b2a3a",
                                    fontSize: fontSize.base,
                                    fontWeight: fontWeight.semibold,
                                    fontFamily: fontFamily.base,
                                    cursor: "pointer",
                                }}
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {tab !== "cases" && SHARED_PAGES[tab] && (
                <Suspense fallback={<div style={{ color: "#6b6280" }}>Loading…</div>}>
                    {(() => {
                        const Page = SHARED_PAGES[tab];
                        return <Page shareId={myPages.find((p) => p.pageKey === tab)?.shareId} />;
                    })()}
                </Suspense>
            )}

            {tab === "cases" && (
                <>
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
                            {/* KPI cards — click to filter */}
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                                    gap: 12,
                                    marginBottom: 20,
                                }}
                            >
                                {cards.map((c) => {
                                    const active = filter === c.key;
                                    return (
                                        <button
                                            key={c.key}
                                            onClick={() => setFilter(c.key)}
                                            style={{
                                                textAlign: "left",
                                                cursor: "pointer",
                                                background: active ? "var(--brand-blue)" : "#fff",
                                                color: active ? "#fff" : "#2b2a3a",
                                                border: active
                                                    ? "1px solid var(--brand-blue)"
                                                    : "1px solid #E7EBF5",
                                                borderRadius: radius.xl,
                                                padding: "14px 16px",
                                                fontFamily: fontFamily.base,
                                                boxShadow: "0 2px 8px rgba(20,30,70,0.05)",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    fontSize: fontSize.sm,
                                                    opacity: active ? 0.9 : 0.7,
                                                }}
                                            >
                                                <i className={c.icon} aria-hidden="true" />
                                                {c.label}
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: 26,
                                                    fontWeight: fontWeight.semibold,
                                                    marginTop: 6,
                                                }}
                                            >
                                                {c.value}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Table */}
                            <div
                                style={{
                                    background: "#fff",
                                    border: "1px solid #E7EBF5",
                                    borderRadius: radius.xl,
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: 10,
                                        alignItems: "center",
                                        padding: "14px 16px",
                                        borderBottom: "1px solid #E7EBF5",
                                    }}
                                >
                                    <div
                                        style={{
                                            fontWeight: fontWeight.semibold,
                                            fontSize: fontSize.lg,
                                            color: "#2b2a3a",
                                        }}
                                    >
                                        {filter === "All" ? "All shared cases" : filter}{" "}
                                        <span
                                            style={{
                                                color: "#8a8fa3",
                                                fontWeight: fontWeight.regular,
                                                fontSize: fontSize.sm,
                                            }}
                                        >
                                            ({visible.length})
                                        </span>
                                    </div>
                                    <input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search case number, service, subclient"
                                        aria-label="Search cases"
                                        style={{
                                            marginLeft: "auto",
                                            minWidth: 240,
                                            padding: "8px 12px",
                                            border: "1px solid #D9DEEE",
                                            borderRadius: radius.lg,
                                            fontSize: fontSize.base,
                                            fontFamily: fontFamily.base,
                                            outline: "none",
                                        }}
                                    />
                                </div>

                                {visible.length === 0 ? (
                                    <div
                                        style={{
                                            padding: "40px 16px",
                                            textAlign: "center",
                                            color: "#8a8fa3",
                                        }}
                                    >
                                        {data.summary.total === 0
                                            ? "Nothing has been shared with you yet."
                                            : "No cases match this filter."}
                                    </div>
                                ) : (
                                    <div style={{ overflowX: "auto" }}>
                                        <table
                                            style={{ width: "100%", borderCollapse: "collapse" }}
                                        >
                                            <thead>
                                                <tr>
                                                    <th style={th}>Case No.</th>
                                                    <th style={th}>Service</th>
                                                    <th style={th}>Subclient</th>
                                                    <th style={th}>Work date</th>
                                                    <th style={th}>Status</th>
                                                    <th style={th}>Shared on</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {visible.map((c) => {
                                                    const st =
                                                        STATUS_STYLE[c.status] ||
                                                        STATUS_STYLE.Received;
                                                    return (
                                                        <tr key={c.id}>
                                                            <td
                                                                style={{
                                                                    ...td,
                                                                    fontWeight: fontWeight.semibold,
                                                                }}
                                                            >
                                                                {c.caseNumber}
                                                            </td>
                                                            <td style={td}>{c.service || "—"}</td>
                                                            <td style={td}>{c.subclient || "—"}</td>
                                                            <td style={td}>
                                                                {fmtDate(c.workDate)}
                                                            </td>
                                                            <td style={td}>
                                                                <span
                                                                    style={{
                                                                        background: st.bg,
                                                                        color: st.fg,
                                                                        padding: "3px 10px",
                                                                        borderRadius: 999,
                                                                        fontSize: fontSize.sm,
                                                                        fontWeight:
                                                                            fontWeight.semibold,
                                                                        whiteSpace: "nowrap",
                                                                    }}
                                                                >
                                                                    {c.status}
                                                                </span>
                                                            </td>
                                                            <td style={td}>
                                                                {fmtDate(c.sharedAt)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default ClientDashboard;
