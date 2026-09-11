// src/components/myPendingApprovals.tsx
//
// Process Lead no longer has access to the full /approvals page (that's
// decision-maker only — Ops Manager / Audit Manager / Super Admin, see
// App.jsx's route guard and sidebar.tsx). But Process Lead still needs a
// way to check "did my request go through / is it still pending?" after
// an Add Service / Add Client / Add Subclient / Add User action returns
// "Submitted for approval". This component is that: a small button that
// opens a read-only list of the caller's own PENDING requests.
//
// Deliberately read-only — no Approve/Reject buttons — because the
// backend's decideRequest() would 403 a Process Lead anyway (Process
// Lead is never in any APPROVAL_RULES[type].approvers list). Reusing the
// same GET /api/approvals endpoint as the full Approvals page works
// as-is: approvals.controller.js's listRequests() already always
// includes "your own" requests regardless of role (`if (request.
// requested_by === req.user.userId) return true;`), and Process Lead
// isn't an approver for anything, so the response naturally is already
// scoped to just their own — no separate endpoint or query param needed.
//
// Drop <MyPendingApprovals /> into any page's header actions row; it
// renders nothing for roles other than PROCESS_LEAD.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const ENDPOINT = `${API_BASE}/api/approvals`;

const TYPE_LABELS: Record<string, string> = {
    SERVICE_CREATE: "New Service",
    SERVICE_UPDATE: "Service Update",
    SERVICE_DELETE: "Service Deletion",
    CLIENT_CREATE: "New Client",
    CLIENT_UPDATE: "Client Update",
    CLIENT_DELETE: "Client Deletion",
    SUBCLIENT_CREATE: "New Subclient",
    SUBCLIENT_UPDATE: "Subclient Update",
    SUBCLIENT_DELETE: "Subclient Deletion",
    QC_PERMISSION_GRANT: "QC Permission Grant",
    USER_CREATE: "New User",
};

function payloadEntityName(payload: Record<string, any> | null | undefined) {
    if (!payload) return null;
    return payload.name || payload.product_name || payload.fullName || null;
}

function formatDateTime(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

type MyRequest = {
    id: string;
    type: string;
    payload: Record<string, any>;
    status: string;
    created_at: string;
};

type MyPendingApprovalsProps = {
    // Restrict the list to only these approval types (e.g. only
    // SERVICE_* on the Services page, only CLIENT_*/SUBCLIENT_* on the
    // Clients page). Omit to show everything the caller has pending —
    // filtering happens client-side after the fetch, since the backend
    // already scopes the response to "my own requests" for a Process
    // Lead; this just narrows it further per-page.
    types?: string[];
};

export default function MyPendingApprovals({ types }: MyPendingApprovalsProps) {
    let role = "";
    try {
        const userStr = localStorage.getItem("user");
        const user = userStr ? JSON.parse(userStr) : null;
        role = (user?.role || "").toUpperCase();
    } catch {
        role = "";
    }

    const [open, setOpen] = useState(false);
    const [requests, setRequests] = useState<MyRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Component's own hover state for the tooltip — deliberately NOT
    // relying on any page's GLOBAL_CSS (.pr-tooltip-wrap / .cl-tooltip-wrap
    // / etc. differ per page, and Employees has none at all), so this
    // looks and behaves identically no matter which page it's dropped
    // into instead of only working correctly on Services.
    const [hovering, setHovering] = useState(false);

    const fetchMine = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(ENDPOINT, { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to load your requests");
            }
            const all: MyRequest[] = json.data || [];
            setRequests(types ? all.filter((r) => types.includes(r.type)) : all);
        } catch (err: any) {
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) fetchMine();
    }, [open]);

    if (role !== "PROCESS_LEAD") return null;

    return (
        <>
            <div
                style={styles.wrap}
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
            >
                <button type="button" style={styles.btn} onClick={() => setOpen(true)}>
                    <i className="ti ti-clock-hour-4" style={{ fontSize: fontSize.md }} />
                    My Pending Requests
                </button>
                {hovering && (
                    <span style={styles.tooltipBubble}>
                        See the status of requests you've submitted for approval
                    </span>
                )}
            </div>

            {open && (
                <div style={styles.overlay} onClick={() => setOpen(false)}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h3 style={styles.modalTitle}>My Pending Requests</h3>
                            <button
                                type="button"
                                style={styles.closeBtn}
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.modalBody}>
                            {loading ? (
                                <p style={styles.emptyText}>Loading…</p>
                            ) : error ? (
                                <p style={styles.errorText}>{error}</p>
                            ) : requests.length === 0 ? (
                                <p style={styles.emptyText}>
                                    Nothing pending right now — everything you've submitted has been
                                    decided.
                                </p>
                            ) : (
                                <div style={styles.list}>
                                    {requests.map((r) => {
                                        const entityName = payloadEntityName(r.payload);
                                        return (
                                            <div key={r.id} style={styles.row}>
                                                <div style={styles.rowTop}>
                                                    <span style={styles.typeBadge}>
                                                        {TYPE_LABELS[r.type] || r.type}
                                                    </span>
                                                    <span style={styles.rowMeta}>
                                                        {formatDateTime(r.created_at)}
                                                    </span>
                                                </div>
                                                {entityName && (
                                                    <span style={styles.entityName}>
                                                        {entityName}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

const styles: Record<string, CSSProperties> = {
    wrap: {
        position: "relative",
        display: "inline-flex",
    },
    btn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#3b4a63",
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    tooltipBubble: {
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        background: "#16233c",
        color: "#fff",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        padding: "6px 10px",
        borderRadius: radius.sm,
        whiteSpace: "nowrap",
        boxShadow: "0 6px 16px rgba(0,0,0,.18)",
        zIndex: 20,
        pointerEvents: "none",
    },
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
    },
    modal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: "100%",
        maxWidth: 480,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 50px rgba(0,0,0,.25)",
        fontFamily: fontFamily.base,
    },
    modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 18px",
        borderBottom: "1px solid #eef1f6",
    },
    modalTitle: {
        margin: 0,
        fontSize: fontSize.lg,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    closeBtn: {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: fontSize.md,
        color: "#7c8aa3",
    },
    modalBody: {
        padding: 16,
        overflowY: "auto",
    },
    emptyText: {
        margin: 0,
        fontSize: fontSize.base,
        color: "#7c8aa3",
        textAlign: "center",
        padding: "20px 0",
    },
    errorText: {
        margin: 0,
        fontSize: fontSize.base,
        color: "#dc2626",
        textAlign: "center",
        padding: "20px 0",
    },

    list: { display: "flex", flexDirection: "column", gap: 8 },
    row: {
        background: "#f7f9fc",
        border: "1px solid #eef1f6",
        borderRadius: radius.md,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    rowTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    typeBadge: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        background: "#eaf6fb",
        color: "#204297",
        whiteSpace: "nowrap",
    },
    rowMeta: { fontSize: fontSize.xs, color: "#9099AC", whiteSpace: "nowrap" },
    entityName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: "#16233c" },
};
