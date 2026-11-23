// src/pages/clientportal/sharedwithme.tsx
//
// "Shared with me" — for ANY logged-in user (staff of another org, a team
// member, etc.) who has been given view access to a page for some client.
// New client-only logins see the same thing inside the Client Dashboard.
//
// The client dropdown (searchable, with prev / next arrows, see ./sharepicker)
// is passed into the report and shown in the right side of its header.

import { lazy, Suspense, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, radius } from "../../styles/theme";
import SharePicker from "./sharepicker";

const API_BASE = import.meta.env.VITE_API_URL;

const SharedProductionReport = lazy(() => import("./sharedproductionreport"));
// `eyebrow` makes the report draw its own "Shared with me" header
const SHARED_PAGES: Record<
    string,
    ComponentType<{ shareId?: string; eyebrow?: string; picker?: ReactNode }>
> = {
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
                    {Page && current && (
                        <Suspense fallback={<div style={{ color: "#6b6280" }}>Loading…</div>}>
                            <Page
                                key={current.shareId}
                                shareId={current.shareId}
                                eyebrow="Shared with me"
                                // the client dropdown lives in the right side of the report header
                                picker={
                                    <SharePicker
                                        compact
                                        items={pages.map((p) => ({
                                            id: p.shareId,
                                            title: p.clientName || p.label,
                                            subtitle: p.clientName ? p.label : undefined,
                                            isNew: !p.seen,
                                        }))}
                                        activeId={active}
                                        onPick={setActive}
                                    />
                                }
                            />
                        </Suspense>
                    )}
                </>
            )}
        </div>
    );
};

export default SharedWithMe;
