// src/components/allocationacceptancepopup.tsx
//
// Shown whenever an employee opens or refreshes the app and work that
// SOMEONE ELSE allocated to them is still waiting for an answer. Every
// allocation is listed with Accept and Decline; Decline needs a reason picked
// from a dropdown. It can NOT be closed: it stays until every allocation has
// been accepted or declined (nothing here depends on the e-mail).
//
//   GET  /api/service-cases/my-acceptances           -> items + reasons
//   POST /api/service-cases/my-acceptances/respond   -> accept / decline
//
// If nothing is answered for 2 hours the backend also mails the employee and
// their reporting manager (that is a separate reminder, not needed for this).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

type AcceptanceItem = {
    kind: "CASE" | "COUNT";
    id: string;
    caseNumber: string | null;
    // 1 for a case; for a count: how many cases (no case numbers added yet)
    quantity: number;
    productName: string | null;
    clientName: string | null;
    subclientName: string | null;
    workDate: string | null;
    allocatedAt: string | null;
    allocatedByName: string | null;
};

type Decision = {
    kind: "CASE" | "COUNT";
    id: string;
    action: "ACCEPT" | "DECLINE";
    reason?: string;
    // the employee's own words - required when the reason is "Other"
    reasonNote?: string;
};

const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
const OTHER = "Other";
const MAX_NOTE = 300;

// Allocations are always for the current day, so the date is shown once in
// the header and the rows only say who allocated.
const todayLabel = () =>
    new Date().toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
    });

export default function AllocationAcceptancePopup({
    enabled,
    userKey,
    onChanged,
}: {
    enabled: boolean;
    userKey: string | null;
    // called after anything was accepted / declined, so the page can reload
    // its case + count lists
    onChanged?: () => void;
}) {
    const [items, setItems] = useState<AcceptanceItem[]>([]);
    const [reasons, setReasons] = useState<string[]>([]);
    const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    // "View": what exactly was allocated, service by service
    const [showView, setShowView] = useState(false);
    // services whose case-number list is open in the View popup
    const [openNumbers, setOpenNumbers] = useState<Record<string, boolean>>({});
    // one reason for "Decline all"
    const [allReason, setAllReason] = useState("");
    // text typed when the reason is "Other" (per row, and for Decline all)
    const [noteByKey, setNoteByKey] = useState<Record<string, string>>({});
    const [allNote, setAllNote] = useState("");

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/my-acceptances`);
            const json = await res.json();
            if (!res.ok || !json?.success) return;
            const list: AcceptanceItem[] = json.data?.items || [];
            setItems(list);
            setReasons(json.data?.reasons || []);
        } catch (err) {
            console.error("my-acceptances load failed:", err);
        }
    }, [setItems]);

    // on login / first load of the page
    useEffect(() => {
        if (!enabled || !userKey) return;
        load();
    }, [enabled, userKey, load]);

    // a new allocation can arrive while the tab is open: look again when the
    // employee comes back to the tab
    useEffect(() => {
        if (!enabled || !userKey) return;
        const onVisible = () => {
            if (document.visibilityState === "visible") load();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [enabled, userKey, load]);

    const send = async (decisions: Decision[]) => {
        if (decisions.length === 0 || busy) return;
        setBusy(true);
        setError(null);
        setNote(null);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/my-acceptances/respond`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decisions }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                setError(json?.message || "Could not save your answer. Please try again.");
                return;
            }
            // everything that was sent is settled now (done, or already gone)
            const done = new Set(decisions.map(keyOf));
            const left = items.filter((i) => !done.has(keyOf(i)));
            setItems(left);
            const { accepted = 0, declined = 0, skipped = 0 } = json.data || {};
            const parts: string[] = [];
            if (accepted) parts.push(`${accepted} accepted`);
            if (declined) parts.push(`${declined} declined`);
            if (skipped) parts.push(`${skipped} already changed`);
            setNote(parts.join(" · ") || null);
            onChanged?.();
        } catch (err) {
            console.error("respond failed:", err);
            setError("Could not save your answer. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    const accept = (i: AcceptanceItem) => send([{ kind: i.kind, id: i.id, action: "ACCEPT" }]);
    // a reason is complete when it is picked, and (for "Other") also written
    const reasonReady = (reason: string, note: string) =>
        !!reason && (reason !== OTHER || note.trim().length > 0);

    const decline = (i: AcceptanceItem) => {
        const k = keyOf(i);
        const reason = reasonByKey[k];
        const note = noteByKey[k] || "";
        if (!reasonReady(reason, note)) return;
        send([
            {
                kind: i.kind,
                id: i.id,
                action: "DECLINE",
                reason,
                ...(reason === OTHER ? { reasonNote: note.trim() } : {}),
            },
        ]);
    };
    const acceptAll = () =>
        send(items.map((i) => ({ kind: i.kind, id: i.id, action: "ACCEPT" as const })));
    const declineAll = () => {
        if (!reasonReady(allReason, allNote)) return;
        if (
            !window.confirm(`Decline all ${items.length} allocation${items.length > 1 ? "s" : ""}?`)
        )
            return;
        send(
            items.map((i) => ({
                kind: i.kind,
                id: i.id,
                action: "DECLINE" as const,
                reason: allReason,
                ...(allReason === OTHER ? { reasonNote: allNote.trim() } : {}),
            }))
        );
    };

    const totalUnits = useMemo(() => items.reduce((s, i) => s + (i.quantity || 1), 0), [items]);

    // service -> how many cases, which clients, which case numbers
    const byService = useMemo(() => {
        const map = new Map<
            string,
            {
                service: string;
                cases: number;
                clients: Set<string>;
                numbers: string[];
                noNumber: number;
            }
        >();
        items.forEach((i) => {
            const name = i.productName || "Service";
            const g = map.get(name) || {
                service: name,
                cases: 0,
                clients: new Set<string>(),
                numbers: [],
                noNumber: 0,
            };
            g.cases += i.quantity || 1;
            if (i.clientName) g.clients.add(i.clientName);
            if (i.kind === "CASE" && i.caseNumber) g.numbers.push(i.caseNumber);
            if (i.kind === "COUNT") g.noNumber += i.quantity || 0;
            map.set(name, g);
        });
        return [...map.values()].sort((a, b) => b.cases - a.cases);
    }, [items]);

    const totalWith = useMemo(
        () => byService.reduce((x, g) => x + g.numbers.length, 0),
        [byService]
    );
    const totalWithout = useMemo(() => byService.reduce((x, g) => x + g.noNumber, 0), [byService]);

    // Esc closes the View popup only (the accept / decline popup stays)
    useEffect(() => {
        if (!showView) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShowView(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showView]);

    // everything answered -> nothing left to look at
    useEffect(() => {
        if (items.length === 0) setShowView(false);
    }, [items.length]);

    if (!enabled || items.length === 0) return null;

    return (
        <div style={S.overlay}>
            <div style={S.card} role="dialog" aria-modal="true" aria-label="New allocations">
                <div style={S.head}>
                    <div>
                        <h3 style={S.title}>New work allocated to you</h3>
                        <p style={S.sub}>
                            Please accept each one, or decline it with a reason, to continue.
                        </p>
                        <div style={S.chips}>
                            <span style={S.chip}>{todayLabel()}</span>
                            <span style={S.chip}>
                                <strong>{totalUnits}</strong> case{totalUnits > 1 ? "s" : ""}
                            </span>
                            <span style={S.chip}>
                                <strong>{byService.length}</strong> service
                                {byService.length > 1 ? "s" : ""}
                            </span>
                        </div>
                    </div>
                    <button type="button" style={S.viewBtn} onClick={() => setShowView(true)}>
                        View Details
                    </button>
                </div>

                <div style={S.tableWrap}>
                    <table style={S.table}>
                        <thead>
                            <tr>
                                {["Service", "Cases", "Your answer"].map((h) => (
                                    <th key={h} style={S.th}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((i) => {
                                const k = keyOf(i);
                                const reason = reasonByKey[k] || "";
                                const note = noteByKey[k] || "";
                                const ready = reasonReady(reason, note);
                                return (
                                    <tr key={k}>
                                        <td style={S.td}>
                                            <strong>{i.productName || "—"}</strong>
                                            <div style={S.muted}>by {i.allocatedByName || "—"}</div>
                                        </td>
                                        <td style={S.td}>
                                            {i.kind === "CASE" ? (
                                                <strong>{i.caseNumber || "—"}</strong>
                                            ) : (
                                                <>
                                                    <strong>
                                                        {i.quantity} case{i.quantity > 1 ? "s" : ""}
                                                    </strong>
                                                    <div style={S.muted}>no case no. yet</div>
                                                </>
                                            )}
                                        </td>
                                        <td style={{ ...S.td, minWidth: 290 }}>
                                            <div style={S.answerRow}>
                                                <select
                                                    style={S.select}
                                                    value={reason}
                                                    disabled={busy}
                                                    onChange={(e) =>
                                                        setReasonByKey((prev) => ({
                                                            ...prev,
                                                            [k]: e.target.value,
                                                        }))
                                                    }
                                                    aria-label="Reason to decline"
                                                >
                                                    <option value="">Reason (to decline)</option>
                                                    {reasons.map((r) => (
                                                        <option key={r} value={r}>
                                                            {r}
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    style={{
                                                        ...S.declineBtn,
                                                        opacity: !ready || busy ? 0.45 : 1,
                                                        cursor:
                                                            !ready || busy
                                                                ? "not-allowed"
                                                                : "pointer",
                                                    }}
                                                    disabled={!ready || busy}
                                                    title={
                                                        ready
                                                            ? ""
                                                            : reason === OTHER
                                                              ? "Write your reason first"
                                                              : "Pick a reason first"
                                                    }
                                                    onClick={() => decline(i)}
                                                >
                                                    Decline
                                                </button>
                                                <button
                                                    type="button"
                                                    style={{
                                                        ...S.acceptBtn,
                                                        opacity: busy ? 0.6 : 1,
                                                    }}
                                                    disabled={busy}
                                                    onClick={() => accept(i)}
                                                >
                                                    Accept
                                                </button>
                                            </div>
                                            {/* "Other" -> the employee writes the reason */}
                                            {reason === OTHER && (
                                                <input
                                                    type="text"
                                                    style={S.noteInput}
                                                    value={note}
                                                    maxLength={MAX_NOTE}
                                                    disabled={busy}
                                                    placeholder="Write your reason"
                                                    onChange={(e) =>
                                                        setNoteByKey((prev) => ({
                                                            ...prev,
                                                            [k]: e.target.value,
                                                        }))
                                                    }
                                                    aria-label="Write your reason"
                                                />
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {error && <p style={S.error}>{error}</p>}
                {note && !error && <p style={S.note}>{note}</p>}

                <div style={S.footer}>
                    {allReason === OTHER && (
                        <input
                            type="text"
                            style={{ ...S.noteInput, order: -1, flex: "1 1 100%", marginTop: 0 }}
                            value={allNote}
                            maxLength={MAX_NOTE}
                            disabled={busy}
                            placeholder="Write your reason (applies to all)"
                            onChange={(e) => setAllNote(e.target.value)}
                            aria-label="Write your reason for all"
                        />
                    )}
                    <select
                        style={{ ...S.select, flex: "0 1 210px" }}
                        value={allReason}
                        disabled={busy}
                        onChange={(e) => setAllReason(e.target.value)}
                        aria-label="Reason to decline all"
                    >
                        <option value="">Reason (to decline all)</option>
                        {reasons.map((r) => (
                            <option key={r} value={r}>
                                {r}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        style={{
                            ...S.declineBtn,
                            opacity: !reasonReady(allReason, allNote) || busy ? 0.45 : 1,
                            cursor:
                                !reasonReady(allReason, allNote) || busy
                                    ? "not-allowed"
                                    : "pointer",
                        }}
                        disabled={!reasonReady(allReason, allNote) || busy}
                        title={
                            reasonReady(allReason, allNote)
                                ? ""
                                : allReason === OTHER
                                  ? "Write your reason first"
                                  : "Pick a reason first"
                        }
                        onClick={declineAll}
                    >
                        Decline all ({items.length})
                    </button>
                    <button
                        type="button"
                        style={{ ...S.acceptAllBtn, opacity: busy ? 0.6 : 1 }}
                        disabled={busy}
                        onClick={acceptAll}
                    >
                        Accept all ({items.length})
                    </button>
                </div>
            </div>

            {showView && (
                <div style={S.viewOverlay} onClick={() => setShowView(false)}>
                    <div
                        style={S.viewCard}
                        role="dialog"
                        aria-modal="true"
                        aria-label="What was allocated"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={S.viewHead}>
                            <div>
                                <h3 style={S.title}>What was allocated to you</h3>
                                <p style={S.sub}>
                                    {totalUnits} case{totalUnits > 1 ? "s" : ""} in{" "}
                                    {byService.length} service
                                    {byService.length > 1 ? "s" : ""} · {totalWith} with case number
                                    · {totalWithout} without case number
                                </p>
                            </div>
                            <button
                                type="button"
                                style={S.closeX}
                                onClick={() => setShowView(false)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <div style={S.tableWrap}>
                            <table style={{ ...S.table, minWidth: 600 }}>
                                <thead>
                                    <tr>
                                        {[
                                            "Service",
                                            "Client",
                                            "With case no.",
                                            "Without case no.",
                                            "Total",
                                        ].map((h) => (
                                            <th key={h} style={S.th}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {byService.map((g) => {
                                        const isOpen = !!openNumbers[g.service];
                                        return (
                                            <tr key={g.service}>
                                                <td style={S.td}>
                                                    <strong>{g.service}</strong>
                                                </td>
                                                <td style={S.td}>
                                                    {[...g.clients].join(", ") || "—"}
                                                </td>
                                                <td style={S.td}>
                                                    <div style={S.withRow}>
                                                        <strong>{g.numbers.length}</strong>
                                                        {/* only where case numbers exist */}
                                                        {g.numbers.length > 0 && (
                                                            <button
                                                                type="button"
                                                                style={S.listBtn}
                                                                onClick={() =>
                                                                    setOpenNumbers((prev) => ({
                                                                        ...prev,
                                                                        [g.service]:
                                                                            !prev[g.service],
                                                                    }))
                                                                }
                                                            >
                                                                {isOpen ? "Hide" : "View"}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {isOpen && (
                                                        <div style={S.numList}>
                                                            {g.numbers.map((n) => (
                                                                <span key={n} style={S.numChip}>
                                                                    {n}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={S.td}>
                                                    <strong>{g.noNumber}</strong>
                                                </td>
                                                <td style={S.td}>
                                                    <strong>{g.cases}</strong>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    <tr>
                                        <td style={{ ...S.td, background: "#F4F8FD" }} colSpan={2}>
                                            <strong>
                                                Total · {byService.length} service
                                                {byService.length > 1 ? "s" : ""}
                                            </strong>
                                        </td>
                                        <td style={{ ...S.td, background: "#F4F8FD" }}>
                                            <strong>{totalWith}</strong>
                                        </td>
                                        <td style={{ ...S.td, background: "#F4F8FD" }}>
                                            <strong>{totalWithout}</strong>
                                        </td>
                                        <td style={{ ...S.td, background: "#F4F8FD" }}>
                                            <strong>{totalUnits}</strong>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div style={S.footer}>
                            <button
                                type="button"
                                style={S.closeBtn}
                                onClick={() => setShowView(false)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const BLUE = "var(--brand-blue)";
const GREEN = "var(--brand-green)";
const RED = "#DC2626";

const S: Record<string, CSSProperties> = {
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1200,
    },
    card: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
        width: "min(640px, 100%)",
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 18,
    },
    head: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 },
    title: {
        margin: 0,
        textAlign: "left",
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#1e2a4a",
    },
    sub: {
        margin: "4px 0 0",
        textAlign: "left",
        fontSize: fontSize.sm,
        color: "#6b7690",
        lineHeight: 1.4,
    },
    tableWrap: { overflowX: "auto", border: "1px solid #eef1f6", borderRadius: radius.md },
    table: { width: "100%", borderCollapse: "collapse", minWidth: 560 },
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
        verticalAlign: "middle",
    },
    muted: { fontSize: fontSize.xs, color: "#9CA3AF", marginTop: 2 },
    answerRow: { display: "flex", gap: 8, alignItems: "center" },
    noteInput: {
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        marginTop: 6,
        padding: "6px 8px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fff",
        fontSize: fontSize.xs,
    },
    select: {
        flex: 1,
        minWidth: 0,
        padding: "6px 8px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fafafa",
        fontSize: fontSize.xs,
    },
    declineBtn: {
        padding: "6px 12px",
        borderRadius: radius.sm,
        border: `1px solid ${RED}`,
        background: "#fff",
        color: RED,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
    },
    acceptBtn: {
        padding: "6px 14px",
        borderRadius: radius.sm,
        border: "none",
        background: GREEN,
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    withRow: { display: "flex", alignItems: "center", gap: 8 },
    listBtn: {
        padding: "2px 10px",
        borderRadius: radius.sm,
        border: `1px solid ${BLUE}`,
        background: "#fff",
        color: BLUE,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    numList: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 6,
        maxHeight: 110,
        overflowY: "auto",
    },
    numChip: {
        padding: "2px 8px",
        borderRadius: 6,
        background: "#F1F5F9",
        color: "#17181C",
        fontSize: fontSize.xs,
    },
    chips: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
    chip: {
        padding: "4px 12px",
        borderRadius: 999,
        background: "rgba(8,161,206,0.12)",
        color: "#0B6E8F",
        fontSize: fontSize.sm,
    },
    viewBtn: {
        alignSelf: "flex-start",
        padding: "8px 18px",
        whiteSpace: "nowrap",
        borderRadius: radius.sm,
        border: `1px solid ${BLUE}`,
        background: "#fff",
        color: BLUE,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    viewOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1300,
    },
    viewCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        width: "min(760px, 100%)",
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 22,
    },
    viewHead: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 },
    closeX: {
        border: "none",
        background: "transparent",
        fontSize: 26,
        lineHeight: 1,
        cursor: "pointer",
        color: "#767F92",
        alignSelf: "flex-start",
    },
    closeBtn: {
        padding: "10px 20px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    footer: {
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 12,
    },
    acceptAllBtn: {
        padding: "8px 18px",
        borderRadius: radius.sm,
        border: "none",
        background: BLUE,
        color: "#fff",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    error: { margin: "12px 0 0", color: RED, fontSize: fontSize.sm },
    note: { margin: "12px 0 0", color: "#6b7690", fontSize: fontSize.sm },
};
