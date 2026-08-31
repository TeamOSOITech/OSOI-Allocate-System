// src/pages/admin/qcaudit.tsx
//
// QC + Audit workflow — two tabs:
//   QC Queue    — cases an employee has submitted, waiting to be sent
//                 to QC and reviewed (Pass/Fail + marks + remarks).
//   Audit Queue — cases that passed QC, hand-picked by an Audit
//                 Manager for a second review (Pass/Fail + marks +
//                 remarks).
//
// Styled to match servicecases.tsx (Case Register) — same colors,
// header layout, card/table look, and responsive breakpoint — so this
// feels like part of the same product rather than a bolted-on page.
//
// Talks to /api/qc-audit/* (see backend src/modules/qcaudit/).

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
import { getCurrentUser } from "../../utils/auth";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 20;
const MOBILE_BREAKPOINT = 768;

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

// Same brand tokens/CSS vars as servicecases.tsx, so colors match
// exactly (including in dark/white-label themes that override these vars).
const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    amber: "#D97706",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

function withBrandAlpha(varName: "blue" | "lightBlue" | "green", alpha: number) {
    const rgbVar =
        varName === "blue"
            ? "--brand-blue-rgb"
            : varName === "lightBlue"
              ? "--brand-light-blue-rgb"
              : "--brand-green-rgb";
    return `rgba(var(${rgbVar}), ${alpha})`;
}

interface CaseRow {
    id: string;
    caseNumber: string;
    workDate: string;
    productName: string | null;
    clientName: string | null;
    assignedEmployeeName: string | null;
    submissionStatus: string;
    qcStatus: string | null;
    qcEmployeeId: string | null;
    qcEmployeeName: string | null;
    qcReviewedAt: string | null;
    qcNotes: string | null;
    qcMarks: number | null;
    auditStatus: string | null;
    auditEmployeeId: string | null;
    auditEmployeeName: string | null;
    auditReviewedAt: string | null;
    auditNotes: string | null;
    auditMarks: number | null;
}

interface Person {
    id: string;
    name: string;
}

function StatusBadge({ status, styles }: { status: string | null; styles: any }) {
    if (!status) return <span style={styles.badgeMuted}>Not sent</span>;
    const map: Record<string, { bg: string; fg: string; label: string }> = {
        QC_PENDING: { bg: "#fef3c7", fg: BRAND.amber, label: "Pending" },
        QC_PASS: { bg: withBrandAlpha("green", 0.12), fg: BRAND.green, label: "Pass" },
        QC_FAIL: { bg: "#fee2e2", fg: BRAND.red, label: "Fail" },
        AUDIT_PENDING: { bg: "#fef3c7", fg: BRAND.amber, label: "Pending" },
        AUDIT_PASS: { bg: withBrandAlpha("green", 0.12), fg: BRAND.green, label: "Pass" },
        AUDIT_FAIL: { bg: "#fee2e2", fg: BRAND.red, label: "Fail" },
    };
    const s = map[status] || { bg: "#f3f4f6", fg: BRAND.grey, label: status };
    return <span style={{ ...styles.badge, background: s.bg, color: s.fg }}>{s.label}</span>;
}

// ---- inline Pass/Fail + marks + remarks form, opened per-row ----
function ReviewForm({
    styles,
    onSubmit,
    onCancel,
}: {
    styles: any;
    onSubmit: (result: "PASS" | "FAIL", marks: string, notes: string) => void;
    onCancel: () => void;
}) {
    const [marks, setMarks] = useState("");
    const [notes, setNotes] = useState("");
    return (
        <div style={styles.reviewForm}>
            <input
                type="number"
                min={0}
                max={100}
                style={styles.marksInput}
                placeholder="Marks (0-100)"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
            />
            <textarea
                style={styles.reviewTextarea}
                placeholder="Remarks (optional for Pass, recommended for Fail)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
            />
            <div style={{ display: "flex", gap: 8 }}>
                <button
                    type="button"
                    style={{ ...styles.smallBtn, background: BRAND.green }}
                    onClick={() => onSubmit("PASS", marks, notes)}
                >
                    Pass
                </button>
                <button
                    type="button"
                    style={{ ...styles.smallBtn, background: BRAND.red }}
                    onClick={() => onSubmit("FAIL", marks, notes)}
                >
                    Fail
                </button>
                <button type="button" style={styles.cancelBtn} onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

export default function QcAudit() {
    const isMobile = useIsMobile();
    const styles = getStyles(isMobile);
    const currentUser = getCurrentUser();

    // Vertical Head / Process Lead / Super Admin can push cases into the
    // QC queue and override someone else's pending QC review — same
    // eligibility the backend enforces (qcaudit.controller.js
    // canAssignQc). A plain Team Member can still act on QC cases
    // specifically assigned to THEM (checked per-row below).
    const canManageQc = ["SUPER_ADMIN", "VERTICAL_HEAD", "PROCESS_LEAD"].includes(
        currentUser?.role || ""
    );
    // Audit Queue tab is Audit Manager territory end to end.
    const canManageAudit = ["SUPER_ADMIN", "AUDIT_MANAGER"].includes(currentUser?.role || "");

    // Two tabs on one page: QC Queue + Audit Queue, switched with the
    // toggle buttons below. QC Queue is open to everyone (a plain Team
    // Member can review cases specifically assigned to them); Audit
    // Queue is Audit Manager territory, so that button/tab only shows
    // for canManageAudit.
    const [activeTab, setActiveTab] = useState<"qc" | "audit">("qc");

    // ---- QC Queue state ----
    const [qcCases, setQcCases] = useState<CaseRow[]>([]);
    const [qcTeam, setQcTeam] = useState<Person[]>([]);
    const [qcLoading, setQcLoading] = useState(false);
    const [qcError, setQcError] = useState("");
    const [qcPage, setQcPage] = useState(1);
    const [qcTotalPages, setQcTotalPages] = useState(1);
    const [qcShowAll, setQcShowAll] = useState(false);
    const [qcAssignPicks, setQcAssignPicks] = useState<Record<string, string>>({});
    const [qcReviewingId, setQcReviewingId] = useState<string | null>(null);

    // ---- Audit Queue state ----
    const [auditCases, setAuditCases] = useState<CaseRow[]>([]);
    const [auditManagers, setAuditManagers] = useState<Person[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditError, setAuditError] = useState("");
    const [auditPage, setAuditPage] = useState(1);
    const [auditTotalPages, setAuditTotalPages] = useState(1);
    const [auditShowAll, setAuditShowAll] = useState(false);
    const [auditAssignPicks, setAuditAssignPicks] = useState<Record<string, string>>({});
    const [auditReviewingId, setAuditReviewingId] = useState<string | null>(null);

    // ---- fetchers ----
    const fetchQcTeam = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/qc-team`);
            const json = await res.json();
            if (res.ok && json.success) setQcTeam(json.data || []);
        } catch (err) {
            console.error("Failed to load QC team:", err);
        }
    }, []);

    const fetchQcQueue = useCallback(async () => {
        setQcLoading(true);
        setQcError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(qcPage));
            params.set("pageSize", String(PAGE_SIZE));
            params.set("status", qcShowAll ? "" : "pending");
            const res = await authFetch(`${API_BASE}/api/qc-audit/qc-queue?${params}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setQcCases(json.data || []);
            setQcTotalPages(json.pagination?.totalPages || 1);
        } catch (err: any) {
            setQcError(err?.message || "Failed to load QC queue.");
        } finally {
            setQcLoading(false);
        }
    }, [qcPage, qcShowAll]);

    const fetchAuditManagers = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/audit-managers`);
            const json = await res.json();
            if (res.ok && json.success) setAuditManagers(json.data || []);
        } catch (err) {
            console.error("Failed to load audit managers:", err);
        }
    }, []);

    const fetchAuditQueue = useCallback(async () => {
        setAuditLoading(true);
        setAuditError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(auditPage));
            params.set("pageSize", String(PAGE_SIZE));
            params.set("status", auditShowAll ? "" : "pending");
            const res = await authFetch(`${API_BASE}/api/qc-audit/audit-queue?${params}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setAuditCases(json.data || []);
            setAuditTotalPages(json.pagination?.totalPages || 1);
        } catch (err: any) {
            setAuditError(err?.message || "Failed to load audit queue.");
        } finally {
            setAuditLoading(false);
        }
    }, [auditPage, auditShowAll]);

    useEffect(() => {
        fetchQcTeam();
    }, [fetchQcTeam]);
    useEffect(() => {
        fetchQcQueue();
    }, [fetchQcQueue]);
    useEffect(() => {
        if (canManageAudit) fetchAuditManagers();
    }, [fetchAuditManagers, canManageAudit]);
    useEffect(() => {
        if (activeTab === "audit") fetchAuditQueue();
    }, [fetchAuditQueue, activeTab]);

    // ---- actions ----
    async function handleAssignQc(caseId: string) {
        const qcEmployeeId = qcAssignPicks[caseId];
        if (!qcEmployeeId) return;
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/${caseId}/qc-assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qcEmployeeId }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to assign");
            fetchQcQueue();
        } catch (err: any) {
            alert(err?.message || "Failed to assign to QC.");
        }
    }

    async function handleQcResult(
        caseId: string,
        result: "PASS" | "FAIL",
        marks: string,
        notes: string
    ) {
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/${caseId}/qc-result`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result, marks: marks === "" ? null : marks, notes }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to record result");
            setQcReviewingId(null);
            fetchQcQueue();
        } catch (err: any) {
            alert(err?.message || "Failed to record QC result.");
        }
    }

    async function handleAssignAudit(caseId: string) {
        const auditEmployeeId = auditAssignPicks[caseId];
        if (!auditEmployeeId) return;
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/${caseId}/audit-assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ auditEmployeeId }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to assign");
            fetchAuditQueue();
        } catch (err: any) {
            alert(err?.message || "Failed to assign to audit.");
        }
    }

    async function handleAuditResult(
        caseId: string,
        result: "PASS" | "FAIL",
        marks: string,
        notes: string
    ) {
        try {
            const res = await authFetch(`${API_BASE}/api/qc-audit/${caseId}/audit-result`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result, marks: marks === "" ? null : marks, notes }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to record result");
            setAuditReviewingId(null);
            fetchAuditQueue();
        } catch (err: any) {
            alert(err?.message || "Failed to record audit result.");
        }
    }

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                {/* ---- header ---- */}
                <div style={styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div>
                            <h1 style={styles.pageTitle}>
                                {activeTab === "qc" ? "Quality Check" : "Audit"}
                            </h1>
                            <p style={styles.headerSubtext}>
                                {activeTab === "qc"
                                    ? "Cases an employee has submitted, waiting to be reviewed for QC (Pass/Fail + marks + remarks)."
                                    : "Cases that passed QC land here — an Audit Manager hand-picks some of them for a second review."}
                            </p>
                        </div>
                    </div>
                    {!isMobile && (
                        <div style={styles.breadcrumb}>
                            <i className="ti ti-home" style={{ fontSize: fontSize.md }} />
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbItem}>Dashboard</span>
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbActive}>
                                {activeTab === "qc" ? "Quality Check" : "Audit"}
                            </span>
                        </div>
                    )}
                </div>

                {/* QC Queue + Audit Queue on the same page, switched with
                these two toggle buttons. QC Queue is always shown (open
                to everyone); Audit Queue button only shows for roles
                that can manage audit. */}
                <div style={styles.modeToggleRow}>
                    <button
                        type="button"
                        style={{
                            ...styles.modeToggleBtn,
                            ...(activeTab === "qc" ? styles.modeToggleBtnActive : {}),
                        }}
                        onClick={() => setActiveTab("qc")}
                    >
                        QC Queue
                    </button>
                    {canManageAudit && (
                        <button
                            type="button"
                            style={{
                                ...styles.modeToggleBtn,
                                ...(activeTab === "audit" ? styles.modeToggleBtnActive : {}),
                            }}
                            onClick={() => setActiveTab("audit")}
                        >
                            Audit Queue
                        </button>
                    )}
                </div>

                {activeTab === "qc" && (
                    <div style={styles.tableCard}>
                        <div style={styles.formPanelHeader}>
                            <i
                                className="ti ti-clipboard-check"
                                style={{ fontSize: fontSize.xl }}
                            />
                            <span style={{ flex: 1 }}>QC Queue</span>
                        </div>
                        <div style={styles.tableToolbar}>
                            <span style={styles.countBadge}>{qcCases.length} shown</span>
                            <label style={styles.toggleLabel}>
                                <input
                                    type="checkbox"
                                    checked={qcShowAll}
                                    onChange={(e) => {
                                        setQcShowAll(e.target.checked);
                                        setQcPage(1);
                                    }}
                                />
                                Show decided cases too
                            </label>
                        </div>

                        <div style={styles.tableScroll}>
                            {qcLoading ? (
                                <div style={styles.emptyNote}>Loading…</div>
                            ) : qcError ? (
                                <div style={{ ...styles.emptyNote, color: BRAND.red }}>
                                    {qcError}
                                </div>
                            ) : qcCases.length === 0 ? (
                                <div style={styles.emptyNote}>Nothing waiting on QC right now.</div>
                            ) : (
                                <>
                                    <div style={styles.qcHeadRow}>
                                        <span>Case No.</span>
                                        <span>Client / Service</span>
                                        <span>Submitted By</span>
                                        <span>QC Status</span>
                                        <span>Reviewer</span>
                                        <span>Marks</span>
                                        <span>Remarks</span>
                                        <span>Action</span>
                                    </div>
                                    {qcCases.map((c) => {
                                        const isMine = c.qcEmployeeId === currentUser?.id;
                                        const canRecord =
                                            c.qcStatus === "QC_PENDING" && (isMine || canManageQc);
                                        return (
                                            <div key={c.id} style={styles.qcRow}>
                                                <span style={styles.caseNoCell}>
                                                    {c.caseNumber}
                                                </span>
                                                <span style={styles.subCell}>
                                                    {c.clientName || "-"}
                                                    <br />
                                                    <span style={styles.mutedText}>
                                                        {c.productName || "-"}
                                                    </span>
                                                </span>
                                                <span>{c.assignedEmployeeName || "-"}</span>
                                                <span>
                                                    <StatusBadge
                                                        status={c.qcStatus}
                                                        styles={styles}
                                                    />
                                                </span>
                                                <span>{c.qcEmployeeName || "-"}</span>
                                                <span>{c.qcMarks ?? "-"}</span>
                                                <span style={styles.mutedText}>
                                                    {c.qcNotes || "-"}
                                                </span>
                                                <span>
                                                    {!c.qcStatus && canManageQc && (
                                                        <div style={styles.assignRow}>
                                                            <select
                                                                style={styles.assignSelect}
                                                                value={qcAssignPicks[c.id] || ""}
                                                                onChange={(e) =>
                                                                    setQcAssignPicks((p) => ({
                                                                        ...p,
                                                                        [c.id]: e.target.value,
                                                                    }))
                                                                }
                                                            >
                                                                <option value="">
                                                                    -- QC person --
                                                                </option>
                                                                {qcTeam.map((p) => (
                                                                    <option key={p.id} value={p.id}>
                                                                        {p.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                style={styles.smallBtn}
                                                                disabled={!qcAssignPicks[c.id]}
                                                                onClick={() => handleAssignQc(c.id)}
                                                            >
                                                                Assign
                                                            </button>
                                                        </div>
                                                    )}
                                                    {!c.qcStatus && !canManageQc && (
                                                        <span style={styles.mutedText}>—</span>
                                                    )}
                                                    {canRecord &&
                                                        (qcReviewingId === c.id ? (
                                                            <ReviewForm
                                                                styles={styles}
                                                                onSubmit={(result, marks, notes) =>
                                                                    handleQcResult(
                                                                        c.id,
                                                                        result,
                                                                        marks,
                                                                        notes
                                                                    )
                                                                }
                                                                onCancel={() =>
                                                                    setQcReviewingId(null)
                                                                }
                                                            />
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                style={styles.smallBtn}
                                                                onClick={() =>
                                                                    setQcReviewingId(c.id)
                                                                }
                                                            >
                                                                Review
                                                            </button>
                                                        ))}
                                                    {c.qcStatus === "QC_PENDING" && !canRecord && (
                                                        <span style={styles.mutedText}>
                                                            Waiting on {c.qcEmployeeName}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </div>

                        <div style={styles.paginationRow}>
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={qcPage <= 1}
                                onClick={() => setQcPage((p) => Math.max(p - 1, 1))}
                            >
                                Prev
                            </button>
                            <span style={styles.pageLabel}>
                                Page {qcPage} of {qcTotalPages}
                            </span>
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={qcPage >= qcTotalPages}
                                onClick={() => setQcPage((p) => p + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === "audit" && canManageAudit && (
                    <div style={styles.tableCard}>
                        <div style={styles.formPanelHeader}>
                            <i className="ti ti-shield-check" style={{ fontSize: fontSize.xl }} />
                            <span style={{ flex: 1 }}>Audit Queue</span>
                        </div>
                        <div style={styles.tableToolbar}>
                            <span style={styles.countBadge}>{auditCases.length} shown</span>
                            <label style={styles.toggleLabel}>
                                <input
                                    type="checkbox"
                                    checked={auditShowAll}
                                    onChange={(e) => {
                                        setAuditShowAll(e.target.checked);
                                        setAuditPage(1);
                                    }}
                                />
                                Show decided cases too
                            </label>
                        </div>

                        <div style={styles.tableScroll}>
                            {auditLoading ? (
                                <div style={styles.emptyNote}>Loading…</div>
                            ) : auditError ? (
                                <div style={{ ...styles.emptyNote, color: BRAND.red }}>
                                    {auditError}
                                </div>
                            ) : auditCases.length === 0 ? (
                                <div style={styles.emptyNote}>
                                    No QC-passed cases waiting to be picked for audit.
                                </div>
                            ) : (
                                <>
                                    <div style={styles.auditHeadRow}>
                                        <span>Case No.</span>
                                        <span>Client / Service</span>
                                        <span>QC Reviewer / Marks</span>
                                        <span>Audit Status</span>
                                        <span>Auditor</span>
                                        <span>Marks</span>
                                        <span>Remarks</span>
                                        <span>Action</span>
                                    </div>
                                    {auditCases.map((c) => (
                                        <div key={c.id} style={styles.auditRow}>
                                            <span style={styles.caseNoCell}>{c.caseNumber}</span>
                                            <span style={styles.subCell}>
                                                {c.clientName || "-"}
                                                <br />
                                                <span style={styles.mutedText}>
                                                    {c.productName || "-"}
                                                </span>
                                            </span>
                                            <span style={styles.subCell}>
                                                {c.qcEmployeeName || "-"}
                                                <br />
                                                <span style={styles.mutedText}>
                                                    {c.qcMarks ?? "-"}
                                                </span>
                                            </span>
                                            <span>
                                                <StatusBadge
                                                    status={c.auditStatus}
                                                    styles={styles}
                                                />
                                            </span>
                                            <span>{c.auditEmployeeName || "-"}</span>
                                            <span>{c.auditMarks ?? "-"}</span>
                                            <span style={styles.mutedText}>
                                                {c.auditNotes || "-"}
                                            </span>
                                            <span>
                                                {!c.auditStatus && (
                                                    <div style={styles.assignRow}>
                                                        <select
                                                            style={styles.assignSelect}
                                                            value={auditAssignPicks[c.id] || ""}
                                                            onChange={(e) =>
                                                                setAuditAssignPicks((p) => ({
                                                                    ...p,
                                                                    [c.id]: e.target.value,
                                                                }))
                                                            }
                                                        >
                                                            <option value="">-- Auditor --</option>
                                                            {auditManagers.map((p) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            type="button"
                                                            style={styles.smallBtn}
                                                            disabled={!auditAssignPicks[c.id]}
                                                            onClick={() => handleAssignAudit(c.id)}
                                                        >
                                                            Assign
                                                        </button>
                                                    </div>
                                                )}
                                                {c.auditStatus === "AUDIT_PENDING" &&
                                                    (auditReviewingId === c.id ? (
                                                        <ReviewForm
                                                            styles={styles}
                                                            onSubmit={(result, marks, notes) =>
                                                                handleAuditResult(
                                                                    c.id,
                                                                    result,
                                                                    marks,
                                                                    notes
                                                                )
                                                            }
                                                            onCancel={() =>
                                                                setAuditReviewingId(null)
                                                            }
                                                        />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            style={styles.smallBtn}
                                                            onClick={() =>
                                                                setAuditReviewingId(c.id)
                                                            }
                                                        >
                                                            Review
                                                        </button>
                                                    ))}
                                            </span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <div style={styles.paginationRow}>
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={auditPage <= 1}
                                onClick={() => setAuditPage((p) => Math.max(p - 1, 1))}
                            >
                                Prev
                            </button>
                            <span style={styles.pageLabel}>
                                Page {auditPage} of {auditTotalPages}
                            </span>
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={auditPage >= auditTotalPages}
                                onClick={() => setAuditPage((p) => p + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function getStyles(isMobile: boolean): Record<string, CSSProperties> {
    // Same column tracks on mobile AND desktop — matches the rest of the
    // app's convention (servicecases.tsx doesn't redesign its table for
    // mobile either): the row stays consistent with its header, and
    // narrow screens get horizontal scroll instead of a mismatched
    // reflowed layout.
    const qcCols = "100px 1fr 1fr 110px 1fr 70px 1fr 200px";
    const auditCols = "100px 1fr 1fr 110px 1fr 70px 1fr 200px";

    return {
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            flex: 1,
            minHeight: 0,
            background: "#f4f7fb",
            fontFamily: fontFamily.base,
            overflow: "hidden",
        },
        topBar: { height: 4, width: "100%", background: GRADIENT, flexShrink: 0 },
        contentBody: {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: isMobile ? "16px" : "24px 28px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 18,
        },
        headerRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: isMobile ? undefined : "flex-start",
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 10 : undefined,
        },
        headerLeft: { display: "flex", gap: 14, alignItems: "flex-start" },
        breadcrumb: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.sm,
            color: "#64748b",
            marginTop: 6,
        },
        breadcrumbSep: { color: "#c7cbe0" },
        breadcrumbItem: { color: "#64748b" },
        breadcrumbActive: { color: BRAND.blue, fontWeight: fontWeight.semibold },
        pageTitle: {
            margin: 0,
            fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            textAlign: "left",
        },
        headerSubtext: {
            margin: "4px 0 0",
            fontSize: fontSize.base,
            color: "#767F92",
            maxWidth: 560,
        },
        modeToggleRow: { display: "flex", gap: 8, flexWrap: "wrap" },
        modeToggleBtn: {
            flex: isMobile ? "1 1 auto" : undefined,
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
            background: GRADIENT,
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
        },
        tableCard: {
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
        },
        formPanelHeader: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 18px",
            background: GRADIENT,
            color: "#fff",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
        },
        tableToolbar: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px 8px",
            flexWrap: "wrap",
            gap: 10,
        },
        countBadge: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withBrandAlpha("blue", 0.08),
            borderRadius: radius.xl,
            padding: "2px 9px",
        },
        toggleLabel: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.xs,
            color: "#6b7280",
        },
        tableScroll: { overflowX: "auto" },
        qcHeadRow: {
            display: "grid",
            gridTemplateColumns: qcCols,
            alignItems: "center",
            columnGap: 16,
            padding: "10px 20px",
            background: "#F4F8FD",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            minWidth: 900,
        },
        qcRow: {
            display: "grid",
            gridTemplateColumns: qcCols,
            alignItems: "start",
            columnGap: 16,
            padding: "12px 20px",
            borderTop: "1px solid #f1f1f1",
            fontSize: fontSize.sm,
            color: "#17181C",
            minWidth: 900,
        },
        auditHeadRow: {
            display: "grid",
            gridTemplateColumns: auditCols,
            alignItems: "center",
            columnGap: 16,
            padding: "10px 20px",
            background: "#F4F8FD",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            minWidth: 900,
        },
        auditRow: {
            display: "grid",
            gridTemplateColumns: auditCols,
            alignItems: "start",
            columnGap: 16,
            padding: "12px 20px",
            borderTop: "1px solid #f1f1f1",
            fontSize: fontSize.sm,
            color: "#17181C",
            minWidth: 900,
        },
        caseNoCell: { fontWeight: fontWeight.semibold },
        subCell: { lineHeight: 1.4 },
        mutedText: { fontSize: fontSize.xs, color: "#9ca3af" },
        emptyNote: { padding: 32, textAlign: "center", fontSize: fontSize.sm, color: "#9ca3af" },
        badge: {
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: radius.pill,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.medium,
        },
        badgeMuted: {
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: radius.pill,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.medium,
            background: "#f3f4f6",
            color: "#9ca3af",
        },
        assignRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
        assignSelect: {
            padding: "5px 8px",
            borderRadius: radius.xs,
            border: "1px solid #ececf5",
            fontSize: fontSize.xs,
            background: "#fafafa",
        },
        smallBtn: {
            padding: "6px 14px",
            borderRadius: radius.sm,
            border: "none",
            background: BRAND.blue,
            color: "#fff",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        cancelBtn: {
            padding: "6px 14px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            background: "#fff",
            color: "#6b7280",
            fontSize: fontSize.xs,
            cursor: "pointer",
        },
        reviewForm: {
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: isMobile ? "100%" : 220,
        },
        marksInput: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: radius.xs,
            border: "1px solid #ececf5",
            fontSize: fontSize.xs,
            background: "#fafafa",
            boxSizing: "border-box",
        },
        reviewTextarea: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: radius.xs,
            border: "1px solid #ececf5",
            fontSize: fontSize.xs,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
        },
        paginationRow: {
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
        },
        pageBtn: {
            padding: "6px 14px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            background: "#fff",
            fontSize: fontSize.xs,
            cursor: "pointer",
        },
        pageLabel: { fontSize: fontSize.xs, color: "#6b7280" },
    };
}
