// src/components/allocationacceptancepopup.tsx
//
// Shown when an employee opens the app and work that SOMEONE ELSE allocated
// to them is still waiting for an answer. Every allocation is listed with
// Accept and Decline; Decline needs a reason picked from a dropdown.
//
//   GET  /api/service-cases/my-acceptances           -> items + reasons
//   POST /api/service-cases/my-acceptances/respond   -> accept / decline
//
// "Decide later" just closes it - the popup comes back next time the app is
// opened, and if nothing is answered for 2 hours the backend mails the
// employee and their reporting manager.

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
};

const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;

function fmtWhen(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });
}

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
    const [open, setOpen] = useState(false);
    const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(
        async (openIfAny: boolean) => {
            try {
                const res = await authFetch(`${API_BASE}/api/service-cases/my-acceptances`);
                const json = await res.json();
                if (!res.ok || !json?.success) return;
                const list: AcceptanceItem[] = json.data?.items || [];
                setItems(list);
                setReasons(json.data?.reasons || []);
                if (openIfAny && list.length > 0) setOpen(true);
                if (list.length === 0) setOpen(false);
            } catch (err) {
                console.error("my-acceptances load failed:", err);
            }
        },
        [setItems]
    );

    // on login / first load of the page
    useEffect(() => {
        if (!enabled || !userKey) return;
        load(true);
    }, [enabled, userKey, load]);

    // a new allocation can arrive while the tab is open: look again when the
    // employee comes back to the tab (never interrupts an open popup)
    useEffect(() => {
        if (!enabled || !userKey) return;
        const onVisible = () => {
            if (document.visibilityState === "visible" && !open) load(true);
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [enabled, userKey, open, load]);

    // Esc = decide later
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !busy) setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, busy]);

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
            if (left.length === 0) setOpen(false);
        } catch (err) {
            console.error("respond failed:", err);
            setError("Could not save your answer. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    const accept = (i: AcceptanceItem) => send([{ kind: i.kind, id: i.id, action: "ACCEPT" }]);
    const decline = (i: AcceptanceItem) => {
        const reason = reasonByKey[keyOf(i)];
        if (!reason) return;
        send([{ kind: i.kind, id: i.id, action: "DECLINE", reason }]);
    };
    const acceptAll = () =>
        send(items.map((i) => ({ kind: i.kind, id: i.id, action: "ACCEPT" as const })));

    const totalUnits = useMemo(() => items.reduce((s, i) => s + (i.quantity || 1), 0), [items]);

    if (!enabled || items.length === 0) return null;

    // small pill to bring the popup back after "Decide later"
    if (!open) {
        return (
            <button type="button" style={S.pill} onClick={() => setOpen(true)}>
                {items.length} allocation{items.length > 1 ? "s" : ""} waiting for your answer
            </button>
        );
    }

    return (
        <div style={S.overlay}>
            <div style={S.card} role="dialog" aria-modal="true" aria-label="New allocations">
                <div style={S.head}>
                    <div>
                        <h3 style={S.title}>New work allocated to you</h3>
                        <p style={S.sub}>
                            {totalUnits} case{totalUnits > 1 ? "s" : ""} in {items.length}{" "}
                            allocation
                            {items.length > 1 ? "s" : ""}. Please accept each one, or decline it
                            with a reason.
                        </p>
                    </div>
                </div>

                <div style={S.tableWrap}>
                    <table style={S.table}>
                        <thead>
                            <tr>
                                {[
                                    "Service",
                                    "Client",
                                    "Cases",
                                    "Allocated by",
                                    "When",
                                    "Your answer",
                                ].map((h) => (
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
                                return (
                                    <tr key={k}>
                                        <td style={S.td}>{i.productName || "—"}</td>
                                        <td style={S.td}>
                                            {i.clientName || "—"}
                                            {i.subclientName ? (
                                                <div style={S.muted}>{i.subclientName}</div>
                                            ) : null}
                                        </td>
                                        <td style={S.td}>
                                            {i.kind === "CASE" ? (
                                                <strong>{i.caseNumber || "—"}</strong>
                                            ) : (
                                                <>
                                                    <strong>
                                                        {i.quantity} case{i.quantity > 1 ? "s" : ""}
                                                    </strong>
                                                    <div style={S.muted}>
                                                        case numbers not added yet
                                                    </div>
                                                </>
                                            )}
                                        </td>
                                        <td style={S.td}>{i.allocatedByName || "—"}</td>
                                        <td style={S.td}>{fmtWhen(i.allocatedAt)}</td>
                                        <td style={{ ...S.td, minWidth: 330 }}>
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
                                                        opacity: !reason || busy ? 0.45 : 1,
                                                        cursor:
                                                            !reason || busy
                                                                ? "not-allowed"
                                                                : "pointer",
                                                    }}
                                                    disabled={!reason || busy}
                                                    title={reason ? "" : "Pick a reason first"}
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
                    <button
                        type="button"
                        style={S.laterBtn}
                        disabled={busy}
                        onClick={() => setOpen(false)}
                    >
                        Decide later
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
        width: "min(1040px, 100%)",
        maxHeight: "88vh",
        overflowY: "auto",
        padding: 22,
    },
    head: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 },
    title: { margin: 0, fontSize: fontSize["2xl"], fontWeight: fontWeight.bold, color: "#1e2a4a" },
    sub: { margin: "6px 0 0", fontSize: fontSize.base, color: "#6b7690", lineHeight: 1.5 },
    tableWrap: { overflowX: "auto", border: "1px solid #eef1f6", borderRadius: radius.md },
    table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
    th: {
        textAlign: "left",
        padding: "10px 12px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
    },
    td: {
        padding: "12px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
        verticalAlign: "middle",
    },
    muted: { fontSize: fontSize.xs, color: "#9CA3AF", marginTop: 2 },
    answerRow: { display: "flex", gap: 8, alignItems: "center" },
    select: {
        flex: 1,
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fafafa",
        fontSize: fontSize.sm,
    },
    declineBtn: {
        padding: "8px 14px",
        borderRadius: radius.sm,
        border: `1px solid ${RED}`,
        background: "#fff",
        color: RED,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
    },
    acceptBtn: {
        padding: "8px 16px",
        borderRadius: radius.sm,
        border: "none",
        background: GREEN,
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    footer: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
    laterBtn: {
        padding: "10px 18px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ec",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    acceptAllBtn: {
        padding: "10px 20px",
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
    pill: {
        position: "fixed",
        left: 24,
        bottom: 24,
        zIndex: 390,
        padding: "10px 16px",
        borderRadius: 999,
        border: "none",
        background: "#D97706",
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
        cursor: "pointer",
    },
};
