import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const MOBILE_BREAKPOINT = 768;
const API_BASE = import.meta.env.VITE_API_URL;
const ENDPOINT = `${API_BASE}/api/approvals`;

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

// Mirrors APPROVAL_RULES keys in backend/src/config/permissions.js.
// Anything not in this map falls back to the raw type string, so a new
// approval type added later still renders (just less prettily) instead
// of silently disappearing.
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
    NEW_VERTICAL: "New Vertical",
    HIDE_TASK: "Hide Task",
};

// Which brand-tint each type family gets, purely visual (matches the
// per-entity accent colors already used on Clients/Products pages).
const TYPE_TINTS: Record<string, string> = {
    SERVICE: "#08A1CE",
    CLIENT: "#204297",
    SUBCLIENT: "#7c3aed",
    QC_PERMISSION_GRANT: "#0ca678",
    NEW_VERTICAL: "#ea580c",
    HIDE_TASK: "#dc2626",
};

function tintFor(type: string) {
    const family = type.split("_")[0];
    return TYPE_TINTS[type] || TYPE_TINTS[family] || "#204297";
}

// Best-effort human name for whatever's in the payload, so the row
// reads "Acme Corp" instead of just "New Client".
function payloadEntityName(payload: Record<string, any> | null | undefined) {
    if (!payload) return null;
    return payload.name || payload.product_name || null;
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

type ApprovalRequest = {
    id: string;
    type: string;
    requested_by: string;
    requestedByName?: string | null;
    target_user_id: string | null;
    payload: Record<string, any>;
    status: string;
    created_at: string;
};

const GLOBAL_CSS = `
.ap-row { transition: background .12s ease; }
.ap-row:hover { background: #f6f9fd; }
.ap-approve-btn:hover { filter: brightness(1.06); }
.ap-reject-btn:hover { background: #fee2e2; }
.ap-expand-btn:hover { text-decoration: underline; }
`;

export default function Approvals() {
    const isMobile = useIsMobile();

    const [requests, setRequests] = useState<ApprovalRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Per-row decision in flight, so only that row's buttons disable —
    // acting on one request doesn't lock the whole list.
    const [decidingId, setDecidingId] = useState<string | null>(null);
    const [decideError, setDecideError] = useState<{ id: string; message: string } | null>(null);

    const fetchRequests = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(ENDPOINT, { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to load approvals");
            }
            setRequests(json.data || []);
        } catch (err: any) {
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    }, []);

    const filteredRequests = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return requests;
        return requests.filter((r) => {
            const typeLabel = (TYPE_LABELS[r.type] || r.type).toLowerCase();
            const entityName = (payloadEntityName(r.payload) || "").toLowerCase();
            const requester = (r.requestedByName || "").toLowerCase();
            return typeLabel.includes(q) || entityName.includes(q) || requester.includes(q);
        });
    }, [requests, search]);

    const handleDecision = async (id: string, decision: "APPROVE" | "REJECT") => {
        setDecidingId(id);
        setDecideError(null);
        try {
            const res = await authFetch(`${ENDPOINT}/${id}/decision`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || `Failed to ${decision.toLowerCase()} request`);
            }
            // Decided requests drop out of the PENDING list on the backend —
            // remove locally too instead of a full refetch.
            setRequests((prev) => prev.filter((r) => r.id !== id));
        } catch (err: any) {
            setDecideError({ id, message: err.message || "Something went wrong." });
        } finally {
            setDecidingId(null);
        }
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    <div style={styles.headerRow}>
                        <div>
                            <h2 style={styles.pageTitle}>
                                Approvals{" "}
                                <span style={styles.pageTitleCount}>
                                    ({filteredRequests.length})
                                </span>
                            </h2>
                            <p style={styles.headerSubtext}>
                                Requests waiting on your decision, plus anything you've submitted
                                yourself.
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div style={styles.errorBanner}>
                            <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                            {error}
                        </div>
                    )}

                    <div style={styles.filterRow}>
                        <div style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: fontSize.lg, color: "#7c8aa3" }}
                                aria-hidden="true"
                            />
                            <input
                                style={styles.searchInput}
                                placeholder="Search by type, entity, or requester..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div style={styles.scrollArea}>
                        {loading ? (
                            <div style={styles.emptyState}>
                                <p style={styles.emptyText}>Loading…</p>
                            </div>
                        ) : filteredRequests.length === 0 ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-checkbox"
                                    style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                                />
                                <p style={styles.emptyText}>
                                    {requests.length === 0
                                        ? "Nothing pending — you're all caught up."
                                        : "No requests match your search."}
                                </p>
                            </div>
                        ) : (
                            <div style={styles.list}>
                                {filteredRequests.map((r) => {
                                    const tint = tintFor(r.type);
                                    const entityName = payloadEntityName(r.payload);
                                    const isExpanded = expandedId === r.id;
                                    const isDeciding = decidingId === r.id;
                                    const rowError =
                                        decideError && decideError.id === r.id
                                            ? decideError.message
                                            : null;

                                    return (
                                        <div
                                            key={r.id}
                                            className="ap-row"
                                            style={{
                                                ...styles.row,
                                                borderLeft: `3px solid ${tint}`,
                                            }}
                                        >
                                            <div style={styles.rowTop}>
                                                <div style={styles.rowMain}>
                                                    <span
                                                        style={{
                                                            ...styles.typeBadge,
                                                            background: `${tint}1A`,
                                                            color: tint,
                                                        }}
                                                    >
                                                        {TYPE_LABELS[r.type] || r.type}
                                                    </span>
                                                    <span style={styles.entityName}>
                                                        {entityName || "—"}
                                                    </span>
                                                </div>
                                                <span style={styles.rowMeta}>
                                                    {formatDateTime(r.created_at)}
                                                </span>
                                            </div>

                                            <div style={styles.rowMetaLine}>
                                                Requested by{" "}
                                                <strong>
                                                    {r.requestedByName || "Unknown user"}
                                                </strong>
                                            </div>

                                            <button
                                                type="button"
                                                className="ap-expand-btn"
                                                style={styles.expandBtn}
                                                onClick={() =>
                                                    setExpandedId(isExpanded ? null : r.id)
                                                }
                                            >
                                                {isExpanded ? "Hide details" : "View details"}
                                            </button>

                                            {isExpanded && (
                                                <pre style={styles.payloadBlock}>
                                                    {JSON.stringify(r.payload, null, 2)}
                                                </pre>
                                            )}

                                            {rowError && <p style={styles.rowError}>{rowError}</p>}

                                            <div style={styles.actionsRow}>
                                                <button
                                                    type="button"
                                                    className="ap-reject-btn"
                                                    style={{
                                                        ...styles.rejectBtn,
                                                        opacity: isDeciding ? 0.6 : 1,
                                                        cursor: isDeciding
                                                            ? "not-allowed"
                                                            : "pointer",
                                                    }}
                                                    disabled={isDeciding}
                                                    onClick={() => handleDecision(r.id, "REJECT")}
                                                >
                                                    Reject
                                                </button>
                                                <button
                                                    type="button"
                                                    className="ap-approve-btn"
                                                    style={{
                                                        ...styles.approveBtn,
                                                        opacity: isDeciding ? 0.6 : 1,
                                                        cursor: isDeciding
                                                            ? "not-allowed"
                                                            : "pointer",
                                                    }}
                                                    disabled={isDeciding}
                                                    onClick={() => handleDecision(r.id, "APPROVE")}
                                                >
                                                    {isDeciding ? "Working…" : "Approve"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        width: "100%",
        height: "100vh",
        flex: 1,
        minHeight: 0,
        background: "#f4f7fb",
        fontFamily: fontFamily.base,
        overflow: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100dvh",
        minHeight: 0,
        width: "100%",
        background: "#f4f7fb",
        fontFamily: fontFamily.base,
        position: "relative",
        overflow: "hidden",
    },
    contentCol: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
    contentColMobile: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px",
        flex: 1,
        minHeight: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        gap: 14,
    },

    headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "left",
    },
    pageTitleCount: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: "#7d90a6" },
    headerSubtext: { margin: "4px 0 0", fontSize: fontSize.base, color: "#7c8aa3" },

    errorBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fdecea",
        color: "#c0392b",
        padding: "10px 14px",
        borderRadius: radius.md,
        fontSize: fontSize.base,
        flexShrink: 0,
    },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
        flexShrink: 0,
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 12px",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.base,
        color: "#16233c",
        width: "100%",
    },

    scrollArea: { flex: 1, minHeight: 0, overflowY: "auto" },

    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 0",
    },
    emptyText: { margin: 0, fontSize: fontSize.base, color: "#7c8aa3" },

    list: { display: "flex", flexDirection: "column", gap: 10 },
    row: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: 16,
        boxShadow: "0 4px 14px rgba(0,0,0,.04)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    rowTop: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    rowMain: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
    typeBadge: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
    },
    entityName: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
    },
    rowMeta: { fontSize: fontSize.sm, color: "#9099AC", whiteSpace: "nowrap" },
    rowMetaLine: { fontSize: fontSize.sm, color: "#7d90a6" },

    expandBtn: {
        alignSelf: "flex-start",
        border: "none",
        background: "transparent",
        color: "#204297",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        padding: 0,
    },
    payloadBlock: {
        background: "#f7f9fc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.sm,
        padding: 12,
        fontSize: fontSize.xs,
        color: "#3b4a63",
        overflowX: "auto",
        margin: 0,
    },

    rowError: { margin: 0, fontSize: fontSize.sm, color: "#dc2626", fontWeight: fontWeight.medium },

    actionsRow: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 },
    approveBtn: {
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "9px 20px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 14px rgba(32,66,151,0.25)",
    },
    rejectBtn: {
        background: "#fff",
        color: "#dc2626",
        border: "1px solid #fecaca",
        borderRadius: radius.md,
        padding: "9px 20px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
    },
};
