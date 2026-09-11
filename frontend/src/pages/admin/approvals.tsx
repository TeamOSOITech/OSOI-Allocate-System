import { useState, useEffect, useMemo, useRef } from "react";
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
    USER_CREATE: "New User",
    // Bulk-upload types reuse the same label as their single-record
    // counterpart — the row shows the actual name(s) from the sheet
    // (see payloadEntityName) instead of leaning on the badge to say
    // "this was a bulk upload".
    SERVICE_BULK_CREATE: "New Service",
    CLIENT_BULK_CREATE: "New Client",
    USER_BULK_CREATE: "New User",
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
    USER: "#d97706",
};

function tintFor(type: string) {
    const family = type.split("_")[0];
    return TYPE_TINTS[type] || TYPE_TINTS[family] || "#204297";
}

// Bulk-upload payloads don't store a single entity — they store every
// parsed spreadsheet row (or, for users, the raw `{ users: [...] }`
// body). Both shapes are just an array of row-like objects, so
// normalize to that array regardless of which key it lives under.
function bulkRows(payload: Record<string, any> | null | undefined) {
    if (!payload) return null;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.users)) return payload.users;
    return null;
}

// Which column/field holds the human name for a given bulk row —
// mirrors the column headers the backend actually reads (see
// parseProductBulkRows/"Service Name", clients.controller.js's
// "Client Name", user.service.js's fullName).
function bulkRowName(row: Record<string, any>, type: string) {
    if (!row) return null;
    if (type.startsWith("SERVICE")) return row["Service Name"] || row.product_name || null;
    if (type.startsWith("CLIENT")) return row["Client Name"] || row.name || null;
    if (type.startsWith("USER")) {
        return (
            row.fullName ||
            [row.firstName, row.lastName].filter(Boolean).join(" ") ||
            row.name ||
            null
        );
    }
    return row.name || null;
}

// Best-effort human name for whatever's in the payload, so the row
// reads "Acme Corp" instead of just "New Client". For bulk uploads this
// pulls every row's name out of the sheet instead of falling back to
// "—" — a bulk request should read like the normal one, just with
// however many names it actually contains.
function payloadEntityName(payload: Record<string, any> | null | undefined, type: string) {
    if (!payload) return null;

    const rows = bulkRows(payload);
    if (rows && rows.length) {
        const names = rows.map((row) => bulkRowName(row, type)).filter(Boolean);
        if (!names.length) return `${rows.length} row${rows.length === 1 ? "" : "s"}`;
        if (names.length <= 3) return names.join(", ");
        return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
    }

    return payload.name || payload.product_name || payload.fullName || null;
}

// Turns a payload/row key into a readable label:
// "product_name" -> "Product Name", "fullName" -> "Full Name",
// "Service Name" -> "Service Name" (already human, left as-is).
function humanizeKey(key: string) {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Renders a payload value for the details view — arrays/booleans/empty
// values get a readable form instead of raw JSON syntax.
function formatValue(value: any): string {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

// A flat key/value block for a single record (one payload, or one bulk
// row). Skips nothing — every field the backend stored is shown — just
// relabeled and reformatted so it reads like a form, not a JSON blob.
function DetailFields({ record }: { record: Record<string, any> }) {
    const entries = Object.entries(record);
    if (!entries.length) return <span style={styles.detailEmpty}>No fields.</span>;
    return (
        <div style={styles.detailGrid}>
            {entries.map(([key, value]) => (
                <div key={key} style={styles.detailRow}>
                    <span style={styles.detailLabel}>{humanizeKey(key)}</span>
                    <span style={styles.detailValue}>{formatValue(value)}</span>
                </div>
            ))}
        </div>
    );
}

// Full "View details" panel for one approval request. Bulk-upload
// payloads (rows/users array) render as one card per row, numbered to
// match the sheet; anything else renders as a single field block.
function PayloadDetails({ payload, type }: { payload: Record<string, any>; type: string }) {
    const rows = bulkRows(payload);
    if (rows && rows.length) {
        return (
            <div style={styles.detailRowsWrap}>
                {rows.map((row, i) => (
                    <div key={i} style={styles.detailRowCard}>
                        <div style={styles.detailRowHeader}>
                            {bulkRowName(row, type) || `Row ${i + 1}`}
                        </div>
                        <DetailFields record={row} />
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div style={styles.detailRowCard}>
            <DetailFields record={payload || {}} />
        </div>
    );
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
    requestedByRole?: string | null;
    target_user_id: string | null;
    payload: Record<string, any>;
    status: string;
    created_at: string;
    decided_at?: string | null;
    decidedByName?: string | null;
    remarks?: string | null;
};

type HistoryCounts = { total: number; approved: number; rejected: number };

const GLOBAL_CSS = `
.ap-row { transition: background .12s ease; }
.ap-row:hover { background: #f6f9fd; }
.ap-approve-btn:hover { filter: brightness(1.06); }
.ap-reject-btn:hover { background: #fee2e2; }
.ap-expand-btn:hover { text-decoration: underline; }
.ap-tab-btn:hover { background: #eef2f8; }
`;

export default function Approvals() {
    const isMobile = useIsMobile();

    const [tab, setTab] = useState<"pending" | "history">("pending");

    const [requests, setRequests] = useState<ApprovalRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // History tab: fetched lazily the first time someone switches to it,
    // then cached — a rejected/approved row moves here right after a
    // decision (see handleDecision) instead of needing a refetch.
    const [history, setHistory] = useState<ApprovalRequest[]>([]);
    const [historyCounts, setHistoryCounts] = useState<HistoryCounts>({
        total: 0,
        approved: 0,
        rejected: 0,
    });
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState("");
    const [historyStatusFilter, setHistoryStatusFilter] = useState<"ALL" | "APPROVED" | "REJECTED">(
        "ALL"
    );

    const [search, setSearch] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Filter toggle: "Process Lead only" narrows the list down to
    // requests raised by a Process Lead (e.g. Add Service/Client/
    // Subclient/User) — off shows everything the caller is eligible to
    // act on, same as before.
    const [processLeadOnly, setProcessLeadOnly] = useState(false);

    // Requests currently in flight — a Set (not a single id) so several
    // rows can show "Working…" at once during a bulk action, without
    // locking the whole list the way a single decidingId would.
    const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
    const [decideError, setDecideError] = useState<{ id: string; message: string } | null>(null);

    // Belt-and-suspenders duplicate guard: once a request id has actually
    // been sent to the backend for a decision, it goes in here and stays
    // — even across the brief gap before disabled-button state re-renders
    // — so the SAME request can never be submitted twice (double-click,
    // a stale row re-appearing, or being picked twice across selection +
    // a manual click). A second attempt just shows an alert instead of
    // hitting the network again.
    const sentIdsRef = useRef<Set<string>>(new Set());

    // Reject confirmation modal: which request (if any) is pending a
    // "are you sure?" + remarks before the reject actually fires.
    const [rejectTarget, setRejectTarget] = useState<ApprovalRequest | null>(null);
    const [rejectRemarks, setRejectRemarks] = useState("");

    // Approve confirmation modal — same "are you sure?" pattern as
    // Reject, minus the remarks field.
    const [approveTarget, setApproveTarget] = useState<ApprovalRequest | null>(null);

    // Multi-select (Pending tab only) — mirrors the "Select" toggle +
    // bulk-action bar pattern already used on Products/Clients: hidden by
    // default, checkboxes appear once turned on.
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Bulk reject/approve confirmation modals — same shape as the
    // single-request ones above, just holding an array of targets.
    const [bulkRejectTargets, setBulkRejectTargets] = useState<ApprovalRequest[] | null>(null);
    const [bulkApproveTargets, setBulkApproveTargets] = useState<ApprovalRequest[] | null>(null);
    const [bulkRemarks, setBulkRemarks] = useState("");
    const [bulkProcessing, setBulkProcessing] = useState(false);

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

    const fetchHistory = async () => {
        setHistoryLoading(true);
        setHistoryError("");
        try {
            const res = await authFetch(`${ENDPOINT}/history`, { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to load approval history");
            }
            setHistory(json.data || []);
            setHistoryCounts(
                json.counts || {
                    total: (json.data || []).length,
                    approved: (json.data || []).filter(
                        (r: ApprovalRequest) => r.status === "APPROVED"
                    ).length,
                    rejected: (json.data || []).filter(
                        (r: ApprovalRequest) => r.status === "REJECTED"
                    ).length,
                }
            );
            setHistoryLoaded(true);
        } catch (err: any) {
            setHistoryError(err.message || "Something went wrong.");
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    }, []);

    // Load history the first time the History tab is opened, not
    // up-front — most visits are to decide pending requests.
    useEffect(() => {
        if (tab === "history" && !historyLoaded) {
            fetchHistory();
        }
    }, [tab, historyLoaded]);

    const filteredRequests = useMemo(() => {
        const base = processLeadOnly
            ? requests.filter((r) => r.requestedByRole === "PROCESS_LEAD")
            : requests;

        const q = search.trim().toLowerCase();
        if (!q) return base;
        return base.filter((r) => {
            const typeLabel = (TYPE_LABELS[r.type] || r.type).toLowerCase();
            const entityName = (payloadEntityName(r.payload, r.type) || "").toLowerCase();
            const requester = (r.requestedByName || "").toLowerCase();
            return typeLabel.includes(q) || entityName.includes(q) || requester.includes(q);
        });
    }, [requests, search, processLeadOnly]);

    const filteredHistory = useMemo(() => {
        const base =
            historyStatusFilter === "ALL"
                ? history
                : history.filter((r) => r.status === historyStatusFilter);

        const q = search.trim().toLowerCase();
        if (!q) return base;
        return base.filter((r) => {
            const typeLabel = (TYPE_LABELS[r.type] || r.type).toLowerCase();
            const entityName = (payloadEntityName(r.payload, r.type) || "").toLowerCase();
            const requester = (r.requestedByName || "").toLowerCase();
            const decider = (r.decidedByName || "").toLowerCase();
            return (
                typeLabel.includes(q) ||
                entityName.includes(q) ||
                requester.includes(q) ||
                decider.includes(q)
            );
        });
    }, [history, search, historyStatusFilter]);

    const openRejectModal = (request: ApprovalRequest) => {
        setRejectTarget(request);
        setRejectRemarks("");
        setDecideError(null);
    };

    const closeRejectModal = () => {
        if (rejectTarget && decidingIds.has(rejectTarget.id)) return; // don't dismiss mid-submit
        setRejectTarget(null);
        setRejectRemarks("");
    };

    const openApproveModal = (request: ApprovalRequest) => {
        setApproveTarget(request);
        setDecideError(null);
    };

    const closeApproveModal = () => {
        if (approveTarget && decidingIds.has(approveTarget.id)) return; // don't dismiss mid-submit
        setApproveTarget(null);
    };

    // Select mode (Pending tab): toggling it on/off always clears
    // whatever was checked, same as Products/Clients.
    const toggleSelectMode = () => {
        setIsSelectMode((v) => !v);
        setSelectedIds(new Set());
    };
    const toggleSelectOne = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const allVisibleSelected =
        filteredRequests.length > 0 && filteredRequests.every((r) => selectedIds.has(r.id));
    const toggleSelectAll = () => {
        setSelectedIds(allVisibleSelected ? new Set() : new Set(filteredRequests.map((r) => r.id)));
    };
    const selectedRequests = useMemo(
        () => filteredRequests.filter((r) => selectedIds.has(r.id)),
        [filteredRequests, selectedIds]
    );

    // Leaving the Pending tab always exits select mode — the bulk bar and
    // its selection are meaningless on History.
    useEffect(() => {
        if (tab !== "pending") {
            setIsSelectMode(false);
            setSelectedIds(new Set());
        }
    }, [tab]);

    // Sends exactly one decision to the backend. sentIdsRef guarantees a
    // given request id is only ever POSTed once — a second call for the
    // same id (double-click, duplicate row, re-selecting it) is turned
    // away as "duplicate" without touching the network. A 409 from the
    // server (someone else already decided it, or it was somehow queued
    // twice) comes back as "already-decided" instead of "ok" so callers
    // can tell the two success paths apart.
    type DecisionOutcome =
        | { kind: "duplicate" }
        | { kind: "already-decided" }
        | { kind: "error"; message: string }
        | { kind: "ok" };

    const submitDecision = async (
        request: ApprovalRequest,
        decision: "APPROVE" | "REJECT",
        remarks?: string
    ): Promise<DecisionOutcome> => {
        if (sentIdsRef.current.has(request.id)) {
            return { kind: "duplicate" };
        }
        sentIdsRef.current.add(request.id);
        try {
            const res = await authFetch(`${ENDPOINT}/${request.id}/decision`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(remarks ? { decision, remarks } : { decision }),
            });
            const json = await res.json();
            if (res.status === 409) {
                return { kind: "already-decided" };
            }
            if (!res.ok || json.success === false) {
                sentIdsRef.current.delete(request.id); // let them retry
                return {
                    kind: "error",
                    message: json.message || `Failed to ${decision.toLowerCase()} request`,
                };
            }
            return { kind: "ok" };
        } catch (err: any) {
            sentIdsRef.current.delete(request.id);
            return { kind: "error", message: err.message || "Something went wrong." };
        }
    };

    const dropFromPending = (id: string) => {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const addToHistory = (
        request: ApprovalRequest,
        decision: "APPROVE" | "REJECT",
        remarks?: string
    ) => {
        if (!historyLoaded) return;
        const decided: ApprovalRequest = {
            ...request,
            status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
            decided_at: new Date().toISOString(),
            remarks: remarks || null,
        };
        setHistory((prev) => [decided, ...prev]);
        setHistoryCounts((prev) => ({
            total: prev.total + 1,
            approved: prev.approved + (decision === "APPROVE" ? 1 : 0),
            rejected: prev.rejected + (decision === "REJECT" ? 1 : 0),
        }));
    };

    const handleDecision = async (
        request: ApprovalRequest,
        decision: "APPROVE" | "REJECT",
        remarks?: string
    ) => {
        const id = request.id;

        if (sentIdsRef.current.has(id)) {
            window.alert("This request has already been sent.");
            return;
        }

        setDecidingIds((prev) => new Set(prev).add(id));
        setDecideError(null);
        const outcome = await submitDecision(request, decision, remarks);
        setDecidingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });

        if (outcome.kind === "duplicate") {
            window.alert("This request has already been sent.");
            return;
        }
        if (outcome.kind === "already-decided") {
            window.alert("Already sent — this request has already been decided.");
            dropFromPending(id);
            setRejectTarget(null);
            setApproveTarget(null);
            setRejectRemarks("");
            return;
        }
        if (outcome.kind === "error") {
            setDecideError({ id, message: outcome.message });
            return;
        }

        // ok — decided requests drop out of the PENDING list on the
        // backend; remove locally too instead of a full refetch, and (if
        // the History tab has already been loaded) drop the freshly-
        // decided request straight into it so it's there without a
        // re-fetch.
        dropFromPending(id);
        addToHistory(request, decision, remarks);
        if (decision === "REJECT") {
            setRejectTarget(null);
            setRejectRemarks("");
        } else {
            setApproveTarget(null);
        }
    };

    const confirmReject = () => {
        if (!rejectTarget) return;
        handleDecision(rejectTarget, "REJECT", rejectRemarks.trim() || undefined);
    };

    const confirmApprove = () => {
        if (!approveTarget) return;
        handleDecision(approveTarget, "APPROVE");
    };

    // Bulk approve/reject — processed one at a time (not in parallel) so
    // there's never more than one in-flight decision for the whole batch,
    // same "send it once" guarantee as the single-request path just
    // extended across a selection. Anything the backend reports as
    // already decided is quietly dropped from Pending; the alert at the
    // end only fires when something in the batch needed the user's
    // attention (already sent, or failed).
    const runBulkDecision = async (
        targets: ApprovalRequest[],
        decision: "APPROVE" | "REJECT",
        remarks?: string
    ) => {
        setBulkProcessing(true);
        let done = 0;
        let alreadyDone = 0;
        let failed = 0;

        for (const target of targets) {
            setDecidingIds((prev) => new Set(prev).add(target.id));
            const outcome = await submitDecision(target, decision, remarks);
            setDecidingIds((prev) => {
                const next = new Set(prev);
                next.delete(target.id);
                return next;
            });

            if (outcome.kind === "ok") {
                done += 1;
                dropFromPending(target.id);
                addToHistory(target, decision, remarks);
            } else if (outcome.kind === "already-decided" || outcome.kind === "duplicate") {
                alreadyDone += 1;
                dropFromPending(target.id);
            } else {
                failed += 1;
            }
        }

        setBulkProcessing(false);
        setBulkRejectTargets(null);
        setBulkApproveTargets(null);
        setBulkRemarks("");
        setIsSelectMode(false);

        if (alreadyDone > 0 || failed > 0) {
            const parts: string[] = [];
            if (done) parts.push(`${done} ${decision === "APPROVE" ? "approved" : "rejected"}`);
            if (alreadyDone) parts.push(`${alreadyDone} already sent (skipped)`);
            if (failed) parts.push(`${failed} failed — please retry`);
            window.alert(parts.join(", ") + ".");
        }
    };

    const confirmBulkReject = () => {
        if (!bulkRejectTargets || !bulkRejectTargets.length) return;
        runBulkDecision(bulkRejectTargets, "REJECT", bulkRemarks.trim() || undefined);
    };

    const confirmBulkApprove = () => {
        if (!bulkApproveTargets || !bulkApproveTargets.length) return;
        runBulkDecision(bulkApproveTargets, "APPROVE");
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
                                    (
                                    {tab === "pending"
                                        ? filteredRequests.length
                                        : filteredHistory.length}
                                    )
                                </span>
                            </h2>
                            <p style={styles.headerSubtext}>
                                {tab === "pending"
                                    ? "Requests waiting on your decision, plus anything you've submitted yourself."
                                    : "Everything that's already been decided — approved and rejected."}
                            </p>
                        </div>
                        <div style={styles.tabRow}>
                            <button
                                type="button"
                                className="ap-tab-btn"
                                style={{
                                    ...styles.tabBtn,
                                    ...(tab === "pending" ? styles.tabBtnActive : {}),
                                }}
                                onClick={() => setTab("pending")}
                            >
                                Pending
                            </button>
                            <button
                                type="button"
                                className="ap-tab-btn"
                                style={{
                                    ...styles.tabBtn,
                                    ...(tab === "history" ? styles.tabBtnActive : {}),
                                }}
                                onClick={() => setTab("history")}
                            >
                                History
                            </button>
                        </div>
                    </div>

                    {tab === "pending" && error && (
                        <div style={styles.errorBanner}>
                            <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                            {error}
                        </div>
                    )}
                    {tab === "history" && historyError && (
                        <div style={styles.errorBanner}>
                            <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                            {historyError}
                        </div>
                    )}

                    {tab === "history" && (
                        <div style={styles.historyStatsRow}>
                            <div style={styles.historyStatCard}>
                                <span style={styles.historyStatNum}>{historyCounts.total}</span>
                                <span style={styles.historyStatLabel}>Total decided</span>
                            </div>
                            <div style={styles.historyStatCard}>
                                <span style={{ ...styles.historyStatNum, color: "#0ca678" }}>
                                    {historyCounts.approved}
                                </span>
                                <span style={styles.historyStatLabel}>Approved</span>
                            </div>
                            <div style={styles.historyStatCard}>
                                <span style={{ ...styles.historyStatNum, color: "#dc2626" }}>
                                    {historyCounts.rejected}
                                </span>
                                <span style={styles.historyStatLabel}>Rejected</span>
                            </div>
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
                        {tab === "pending" ? (
                            <>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.plFilterBtn,
                                        ...(processLeadOnly ? styles.plFilterBtnActive : {}),
                                    }}
                                    onClick={() => setProcessLeadOnly((v) => !v)}
                                    aria-pressed={processLeadOnly}
                                >
                                    <i className="ti ti-filter" style={{ fontSize: fontSize.md }} />
                                    Process Lead requests
                                </button>
                                {/* "Select" toggle — checkboxes for bulk approve/reject only
                                    show once this is switched on, same pattern as bulk-delete
                                    on Products/Clients. */}
                                {filteredRequests.length > 0 && (
                                    <button
                                        type="button"
                                        style={{
                                            ...styles.selectModeBtn,
                                            ...(isSelectMode ? styles.selectModeBtnActive : {}),
                                        }}
                                        onClick={toggleSelectMode}
                                    >
                                        <i
                                            className={isSelectMode ? "ti ti-x" : "ti ti-checkbox"}
                                            style={{ fontSize: fontSize.md }}
                                        />
                                        {isSelectMode ? "Cancel" : "Select"}
                                    </button>
                                )}
                            </>
                        ) : (
                            <div style={styles.historyStatusFilterGroup}>
                                {(["ALL", "APPROVED", "REJECTED"] as const).map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        style={{
                                            ...styles.plFilterBtn,
                                            ...(historyStatusFilter === s
                                                ? styles.plFilterBtnActive
                                                : {}),
                                        }}
                                        onClick={() => setHistoryStatusFilter(s)}
                                        aria-pressed={historyStatusFilter === s}
                                    >
                                        {s === "ALL"
                                            ? "All"
                                            : s === "APPROVED"
                                              ? "Approved"
                                              : "Rejected"}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Bulk-select bar — a "Select All" checkbox plus Approve/Reject
                        Selected buttons that appear once at least one request is
                        checked, so acting on many requests doesn't mean opening each
                        row's confirm dialog one at a time. */}
                    {tab === "pending" && isSelectMode && filteredRequests.length > 0 && (
                        <div style={styles.bulkSelectBar}>
                            <label style={styles.bulkSelectAllLabel}>
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={toggleSelectAll}
                                />
                                {allVisibleSelected ? "Deselect All" : "Select All"}
                                {selectedIds.size > 0 && (
                                    <span style={styles.bulkSelectCount}>
                                        {selectedIds.size} selected
                                    </span>
                                )}
                            </label>
                            {selectedIds.size > 0 && (
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        type="button"
                                        style={styles.bulkRejectBtn}
                                        onClick={() => setBulkRejectTargets(selectedRequests)}
                                    >
                                        <i
                                            className="ti ti-x"
                                            style={{ fontSize: fontSize.base }}
                                        />
                                        Reject Selected ({selectedIds.size})
                                    </button>
                                    <button
                                        type="button"
                                        style={styles.bulkApproveBtn}
                                        onClick={() => setBulkApproveTargets(selectedRequests)}
                                    >
                                        <i
                                            className="ti ti-check"
                                            style={{ fontSize: fontSize.base }}
                                        />
                                        Approve Selected ({selectedIds.size})
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === "pending" ? (
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
                                        const entityName = payloadEntityName(r.payload, r.type);
                                        const isExpanded = expandedId === r.id;
                                        const isDeciding = decidingIds.has(r.id);
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
                                                        {isSelectMode && (
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedIds.has(r.id)}
                                                                onChange={() =>
                                                                    toggleSelectOne(r.id)
                                                                }
                                                                style={styles.rowSelectCheckbox}
                                                                aria-label={`Select ${
                                                                    TYPE_LABELS[r.type] || r.type
                                                                } request`}
                                                            />
                                                        )}
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
                                                    <PayloadDetails
                                                        payload={r.payload}
                                                        type={r.type}
                                                    />
                                                )}

                                                {rowError && (
                                                    <p style={styles.rowError}>{rowError}</p>
                                                )}

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
                                                        onClick={() => openRejectModal(r)}
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
                                                        onClick={() => openApproveModal(r)}
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
                    ) : (
                        <div style={styles.scrollArea}>
                            {historyLoading ? (
                                <div style={styles.emptyState}>
                                    <p style={styles.emptyText}>Loading…</p>
                                </div>
                            ) : filteredHistory.length === 0 ? (
                                <div style={styles.emptyState}>
                                    <i
                                        className="ti ti-history"
                                        style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                                    />
                                    <p style={styles.emptyText}>
                                        {history.length === 0
                                            ? "Nothing decided yet."
                                            : "No requests match your search."}
                                    </p>
                                </div>
                            ) : (
                                <div style={styles.list}>
                                    {filteredHistory.map((r) => {
                                        const tint = tintFor(r.type);
                                        const entityName = payloadEntityName(r.payload, r.type);
                                        const isExpanded = expandedId === r.id;
                                        const isApproved = r.status === "APPROVED";

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
                                                        <span
                                                            style={{
                                                                ...styles.statusBadge,
                                                                background: isApproved
                                                                    ? "#0ca67822"
                                                                    : "#dc262622",
                                                                color: isApproved
                                                                    ? "#0ca678"
                                                                    : "#dc2626",
                                                            }}
                                                        >
                                                            {isApproved ? "Approved" : "Rejected"}
                                                        </span>
                                                    </div>
                                                    <span style={styles.rowMeta}>
                                                        {r.decided_at
                                                            ? formatDateTime(r.decided_at)
                                                            : "—"}
                                                    </span>
                                                </div>

                                                <div style={styles.rowMetaLine}>
                                                    Requested by{" "}
                                                    <strong>
                                                        {r.requestedByName || "Unknown user"}
                                                    </strong>
                                                    {" · "}
                                                    {isApproved ? "Approved" : "Rejected"} by{" "}
                                                    <strong>
                                                        {r.decidedByName || "Unknown user"}
                                                    </strong>
                                                </div>

                                                {r.remarks && (
                                                    <div style={styles.remarksLine}>
                                                        <span style={styles.remarksLabel}>
                                                            Remarks:
                                                        </span>{" "}
                                                        {r.remarks}
                                                    </div>
                                                )}

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
                                                    <PayloadDetails
                                                        payload={r.payload}
                                                        type={r.type}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Reject confirmation modal — remarks are optional, "Yes,
                Reject" is disabled while the decision is in flight so a
                double-click can't fire it twice. */}
            {rejectTarget && (
                <div style={styles.overlay} onClick={closeRejectModal}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Reject this request?</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={closeRejectModal}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <p style={{ margin: 0, fontSize: fontSize.base, color: "#3b4a63" }}>
                                Are you sure you want to reject{" "}
                                <strong>
                                    {payloadEntityName(rejectTarget.payload, rejectTarget.type) ||
                                        TYPE_LABELS[rejectTarget.type] ||
                                        rejectTarget.type}
                                </strong>
                                ? This can't be undone.
                            </p>

                            <div>
                                <label style={styles.formLabel}>Remarks (optional)</label>
                                <textarea
                                    style={styles.formTextarea}
                                    rows={3}
                                    placeholder="Add a reason for rejecting…"
                                    value={rejectRemarks}
                                    onChange={(e) => setRejectRemarks(e.target.value)}
                                />
                            </div>

                            {decideError && decideError.id === rejectTarget.id && (
                                <p style={styles.formError}>{decideError.message}</p>
                            )}

                            <div style={{ display: "flex", gap: 10 }}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={closeRejectModal}
                                    disabled={decidingIds.has(rejectTarget.id)}
                                >
                                    No
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.rejectConfirmBtn,
                                        flex: 1,
                                        opacity: decidingIds.has(rejectTarget.id) ? 0.7 : 1,
                                        cursor: decidingIds.has(rejectTarget.id)
                                            ? "not-allowed"
                                            : "pointer",
                                    }}
                                    onClick={confirmReject}
                                    disabled={decidingIds.has(rejectTarget.id)}
                                >
                                    {decidingIds.has(rejectTarget.id)
                                        ? "Rejecting…"
                                        : "Yes, Reject"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Approve confirmation modal — same "are you sure?" pattern
                as Reject, minus the remarks field. */}
            {approveTarget && (
                <div style={styles.overlay} onClick={closeApproveModal}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Approve this request?</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={closeApproveModal}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <p style={{ margin: 0, fontSize: fontSize.base, color: "#3b4a63" }}>
                                Are you sure you want to approve{" "}
                                <strong>
                                    {payloadEntityName(approveTarget.payload, approveTarget.type) ||
                                        TYPE_LABELS[approveTarget.type] ||
                                        approveTarget.type}
                                </strong>
                                ? This will take effect immediately.
                            </p>

                            {decideError && decideError.id === approveTarget.id && (
                                <p style={styles.formError}>{decideError.message}</p>
                            )}

                            <div style={{ display: "flex", gap: 10 }}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={closeApproveModal}
                                    disabled={decidingIds.has(approveTarget.id)}
                                >
                                    No
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.approveConfirmBtn,
                                        flex: 1,
                                        opacity: decidingIds.has(approveTarget.id) ? 0.7 : 1,
                                        cursor: decidingIds.has(approveTarget.id)
                                            ? "not-allowed"
                                            : "pointer",
                                    }}
                                    onClick={confirmApprove}
                                    disabled={decidingIds.has(approveTarget.id)}
                                >
                                    {decidingIds.has(approveTarget.id)
                                        ? "Approving…"
                                        : "Yes, Approve"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk reject confirmation — same "are you sure?" + remarks
                pattern as the single-request modal, applied to every
                selected request. */}
            {bulkRejectTargets && bulkRejectTargets.length > 0 && (
                <div
                    style={styles.overlay}
                    onClick={() => !bulkProcessing && setBulkRejectTargets(null)}
                >
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>
                                Reject {bulkRejectTargets.length} request
                                {bulkRejectTargets.length === 1 ? "" : "s"}?
                            </h3>
                            <button
                                style={styles.closeBtn}
                                onClick={() => !bulkProcessing && setBulkRejectTargets(null)}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <p style={{ margin: 0, fontSize: fontSize.base, color: "#3b4a63" }}>
                                Are you sure you want to reject these{" "}
                                <strong>{bulkRejectTargets.length}</strong> request
                                {bulkRejectTargets.length === 1 ? "" : "s"}? This can't be undone.
                            </p>

                            <div>
                                <label style={styles.formLabel}>
                                    Remarks (optional, applied to all)
                                </label>
                                <textarea
                                    style={styles.formTextarea}
                                    rows={3}
                                    placeholder="Add a reason for rejecting…"
                                    value={bulkRemarks}
                                    onChange={(e) => setBulkRemarks(e.target.value)}
                                />
                            </div>

                            <div style={{ display: "flex", gap: 10 }}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={() => setBulkRejectTargets(null)}
                                    disabled={bulkProcessing}
                                >
                                    No
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.rejectConfirmBtn,
                                        flex: 1,
                                        opacity: bulkProcessing ? 0.7 : 1,
                                        cursor: bulkProcessing ? "not-allowed" : "pointer",
                                    }}
                                    onClick={confirmBulkReject}
                                    disabled={bulkProcessing}
                                >
                                    {bulkProcessing
                                        ? "Rejecting…"
                                        : `Yes, Reject ${bulkRejectTargets.length}`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk approve confirmation — same pattern, minus remarks. */}
            {bulkApproveTargets && bulkApproveTargets.length > 0 && (
                <div
                    style={styles.overlay}
                    onClick={() => !bulkProcessing && setBulkApproveTargets(null)}
                >
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>
                                Approve {bulkApproveTargets.length} request
                                {bulkApproveTargets.length === 1 ? "" : "s"}?
                            </h3>
                            <button
                                style={styles.closeBtn}
                                onClick={() => !bulkProcessing && setBulkApproveTargets(null)}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <p style={{ margin: 0, fontSize: fontSize.base, color: "#3b4a63" }}>
                                Are you sure you want to approve these{" "}
                                <strong>{bulkApproveTargets.length}</strong> request
                                {bulkApproveTargets.length === 1 ? "" : "s"}? This will take effect
                                immediately.
                            </p>

                            <div style={{ display: "flex", gap: 10 }}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={() => setBulkApproveTargets(null)}
                                    disabled={bulkProcessing}
                                >
                                    No
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.approveConfirmBtn,
                                        flex: 1,
                                        opacity: bulkProcessing ? 0.7 : 1,
                                        cursor: bulkProcessing ? "not-allowed" : "pointer",
                                    }}
                                    onClick={confirmBulkApprove}
                                    disabled={bulkProcessing}
                                >
                                    {bulkProcessing
                                        ? "Approving…"
                                        : `Yes, Approve ${bulkApproveTargets.length}`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
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
        fontWeight: fontWeight.semibold,
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

    plFilterBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        background: "#f7f9fc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#3b4a63",
        cursor: "pointer",
        flexShrink: 0,
    },
    plFilterBtnActive: {
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        borderColor: "transparent",
        color: "#fff",
    },

    // ---- Multi-select (bulk approve/reject) ----
    selectModeBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#f7f9fc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#3b4a63",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    selectModeBtnActive: {
        background: "#e7ecf8",
        color: "#204297",
        border: "1px solid #204297",
    },
    bulkSelectBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        flexShrink: 0,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "10px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    bulkSelectAllLabel: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#3b4a63",
        cursor: "pointer",
    },
    bulkSelectCount: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#204297",
        background: "#e7ecf8",
        padding: "3px 10px",
        borderRadius: 999,
    },
    bulkApproveBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "9px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 14px rgba(32,66,151,0.25)",
        whiteSpace: "nowrap",
    },
    bulkRejectBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#dc2626",
        border: "1px solid #fecaca",
        borderRadius: radius.md,
        padding: "9px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    rowSelectCheckbox: {
        width: 16,
        height: 16,
        cursor: "pointer",
        flexShrink: 0,
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
    detailRowsWrap: { display: "flex", flexDirection: "column", gap: 8 },
    detailRowCard: {
        background: "#f7f9fc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.sm,
        padding: 12,
    },
    detailRowHeader: {
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
        marginBottom: 8,
    },
    detailGrid: { display: "flex", flexDirection: "column", gap: 6 },
    detailRow: {
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        fontSize: fontSize.xs,
        borderBottom: "1px solid #e9edf4",
        paddingBottom: 6,
    },
    detailLabel: { color: "#7c8aa3", fontWeight: fontWeight.medium, whiteSpace: "nowrap" },
    detailValue: { color: "#3b4a63", fontWeight: fontWeight.semibold, textAlign: "right" },
    detailEmpty: { fontSize: fontSize.xs, color: "#7c8aa3" },

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

    // ---- Tabs (Pending / History) ----
    tabRow: {
        display: "flex",
        gap: 6,
        background: "#eef2f8",
        padding: 4,
        borderRadius: radius.md,
        flexShrink: 0,
    },
    tabBtn: {
        border: "none",
        background: "transparent",
        color: "#3b4a63",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        padding: "8px 16px",
        borderRadius: radius.sm,
        cursor: "pointer",
    },
    tabBtnActive: {
        background: "#fff",
        color: "#204297",
        boxShadow: "0 2px 8px rgba(0,0,0,.08)",
    },

    // ---- History tab ----
    historyStatsRow: { display: "flex", gap: 10, flexShrink: 0 },
    historyStatCard: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 16px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    historyStatNum: {
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.semibold,
        color: "#16233c",
    },
    historyStatLabel: { fontSize: fontSize.sm, color: "#7c8aa3" },
    historyStatusFilterGroup: { display: "flex", gap: 8, flexShrink: 0 },
    statusBadge: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
    },
    remarksLine: {
        fontSize: fontSize.sm,
        color: "#3b4a63",
        background: "#f7f9fc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.sm,
        padding: "8px 10px",
    },
    remarksLabel: { fontWeight: fontWeight.semibold, color: "#7c8aa3" },

    // ---- Reject confirmation modal ----
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    detailsModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 480,
        maxWidth: "94vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    detailsHeader: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "22px 28px 16px",
        borderBottom: "1px solid #f0f0f0",
    },
    detailsTitle: {
        margin: 0,
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.semibold,
        color: "#16233c",
    },
    closeBtn: {
        position: "absolute",
        top: 18,
        right: 20,
        border: "none",
        background: "#f3f4f6",
        borderRadius: radius.circle,
        width: 28,
        height: 28,
        fontSize: fontSize.md,
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    detailsBody: { padding: "20px 28px 28px", display: "flex", flexDirection: "column", gap: 14 },
    formLabel: {
        display: "block",
        marginBottom: 6,
        color: "#3b4a63",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
    },
    formTextarea: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        outline: "none",
        fontSize: fontSize.base,
        borderRadius: radius.sm,
        boxSizing: "border-box",
        color: "#16233c",
        fontFamily: fontFamily.base,
        resize: "vertical",
    },
    formError: {
        color: "#dc2626",
        margin: 0,
        fontWeight: fontWeight.medium,
        fontSize: fontSize.sm,
    },
    secondaryBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#204297",
        border: "1px solid #cfe0f5",
        borderRadius: radius.md,
        padding: "11px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    rejectConfirmBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #ef4444, #b91c1c)",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "12px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 16px rgba(220,38,38,0.3)",
    },
    approveConfirmBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "12px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 16px rgba(32,66,151,0.25)",
    },
};
