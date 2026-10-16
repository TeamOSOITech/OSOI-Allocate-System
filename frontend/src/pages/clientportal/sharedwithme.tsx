// src/pages/client/sharedwithme.tsx
//
// "Shared with me" — for ANY logged-in user (staff of another org, a team
// member, etc.) who has been given view access to a page for some client.
// New client-only logins see the same thing inside the Client Dashboard.
// Add a route + a sidebar link for this page (see notes in the chat).

import { lazy, Suspense, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

const SharedProductionReport = lazy(() => import("./sharedproductionreport"));
const SHARED_PAGES: Record<string, ComponentType<{ shareId?: string }>> = {
    "production-reports": SharedProductionReport,
};

type MyPage = {
    shareId: string;
    pageKey: string;
    label: string;
    permission: "VIEW" | "EDIT";
    clientName: string | null;
    seen?: boolean;
};

const SharedWithMe = () => {
    const [pages, setPages] = useState<MyPage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [active, setActive] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/client-portal/my-pages`, {
                    cache: "no-store",
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json.success === false)
                    throw new Error(json.message || "Could not load shared pages.");
                const list: MyPage[] = (json.data || []).filter(
                    (p: MyPage) => SHARED_PAGES[p.pageKey]
                );
                setPages(list);
                setActive(list[0]?.shareId || "");
                // opening this page clears the "new" badge in the sidebar
                if (list.some((p) => !p.seen)) {
                    authFetch(`${API_BASE}/api/client-portal/my-pages/seen`, {
                        method: "POST",
                    })
                        .then(() => window.dispatchEvent(new Event("shares-seen")))
                        .catch(() => {});
                }
            } catch (e: any) {
                setError(e?.message || "Could not load shared pages.");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const current = pages.find((p) => p.shareId === active);
    const Page = current ? SHARED_PAGES[current.pageKey] : null;

    return (
        <div style={{ padding: "24px 28px", fontFamily: fontFamily.base, minHeight: "100%" }}>
            <div
                style={{
                    fontSize: fontSize["2xl"],
                    fontWeight: fontWeight.semibold,
                    color: "#17181C",
                    marginBottom: 4,
                }}
            >
                Shared with me
            </div>
            <div style={{ color: "#6b6280", fontSize: fontSize.sm, marginBottom: 18 }}>
                Pages that have been shared with you. These are read-only.
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

            {!loading && !error && pages.length === 0 && (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "#8a8fa3" }}>
                    Nothing has been shared with you yet.
                </div>
            )}

            {!loading && !error && pages.length > 0 && (
                <>
                    <div
                        role="tablist"
                        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}
                    >
                        {pages.map((p) => {
                            const isActive = p.shareId === active;
                            return (
                                <button
                                    key={p.shareId}
                                    role="tab"
                                    aria-selected={isActive}
                                    onClick={() => setActive(p.shareId)}
                                    style={{
                                        padding: "9px 18px",
                                        borderRadius: radius.lg,
                                        border: isActive
                                            ? "1px solid var(--brand-blue)"
                                            : "1px solid #D9DEEE",
                                        background: isActive ? "var(--brand-blue)" : "#fff",
                                        color: isActive ? "#fff" : "#2b2a3a",
                                        fontSize: fontSize.base,
                                        fontWeight: fontWeight.semibold,
                                        fontFamily: fontFamily.base,
                                        cursor: "pointer",
                                    }}
                                >
                                    {p.label}
                                    {p.clientName ? ` — ${p.clientName}` : ""}
                                </button>
                            );
                        })}
                    </div>

                    {Page && current && (
                        <Suspense fallback={<div style={{ color: "#6b6280" }}>Loading…</div>}>
                            <Page key={current.shareId} shareId={current.shareId} />
                        </Suspense>
                    )}
                </>
            )}
        </div>
    );
};

export default SharedWithMe;
