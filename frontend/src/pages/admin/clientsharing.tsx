// src/pages/admin/clientsharing.tsx
//
// Client Sharing — staff pick a client, tick cases, and Share / Remove them.
// Whatever is shared shows up on that client's Client Dashboard, nothing else.
// Super Admin / Ops Manager can also turn an existing login into that
// client's login ("Link client login").

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser } from "../../utils/auth";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

type ClientOpt = { id: string; name: string };
type Row = {
    id: string;
    caseNumber: string;
    service: string | null;
    subclient: string | null;
    workDate: string | null;
    status: string;
    shared: boolean;
};

const input = {
    padding: "8px 12px",
    border: "1px solid #D9DEEE",
    borderRadius: radius.lg,
    fontSize: fontSize.base,
    fontFamily: fontFamily.base,
    background: "#fff",
} as const;

const btn = (bg: string, disabled = false) =>
    ({
        background: disabled ? "#C9CEDD" : bg,
        color: "#fff",
        border: "none",
        borderRadius: radius.lg,
        padding: "9px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        fontFamily: fontFamily.base,
        cursor: disabled ? "not-allowed" : "pointer",
    }) as const;

const ClientSharing = () => {
    const user = getCurrentUser();
    const canLink = user?.role === "SUPER_ADMIN" || user?.role === "OPS_MANAGER";

    const [clients, setClients] = useState<ClientOpt[]>([]);
    const [clientId, setClientId] = useState("");
    const [workDate, setWorkDate] = useState("");
    const [q, setQ] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [email, setEmail] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/clients`, { cache: "no-store" });
                const json = await res.json();
                const list = Array.isArray(json) ? json : json?.data || [];
                setClients(list.map((c: any) => ({ id: c.id, name: c.name })));
            } catch {
                setMsg({ ok: false, text: "Could not load clients." });
            }
        })();
    }, []);

    const load = useCallback(async () => {
        if (!clientId) {
            setRows([]);
            return;
        }
        setLoading(true);
        setPicked(new Set());
        try {
            const p = new URLSearchParams();
            if (workDate) p.set("workDate", workDate);
            if (q.trim()) p.set("q", q.trim());
            const res = await authFetch(
                `${API_BASE}/api/client-portal/clients/${clientId}/cases?${p.toString()}`,
                { cache: "no-store" }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not load cases.");
            setRows(json.data || []);
        } catch (e: any) {
            setMsg({ ok: false, text: e?.message || "Could not load cases." });
        } finally {
            setLoading(false);
        }
    }, [clientId, workDate, q]);

    useEffect(() => {
        load();
    }, [clientId, workDate]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = (id: string) =>
        setPicked((prev) => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));

    const act = async (path: "share" | "unshare") => {
        if (!clientId || picked.size === 0) return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await authFetch(`${API_BASE}/api/client-portal/${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId, caseIds: [...picked] }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Action failed.");
            setMsg({ ok: true, text: json.message });
            await load();
        } catch (e: any) {
            setMsg({ ok: false, text: e?.message || "Action failed." });
        } finally {
            setBusy(false);
        }
    };

    const link = async () => {
        if (!clientId || !email.trim()) return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await authFetch(`${API_BASE}/api/client-portal/link-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId, email: email.trim() }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not link user.");
            setMsg({ ok: true, text: json.message });
            setEmail("");
        } catch (e: any) {
            setMsg({ ok: false, text: e?.message || "Could not link user." });
        } finally {
            setBusy(false);
        }
    };

    const cell = {
        padding: "10px 14px",
        fontSize: fontSize.base,
        borderBottom: "1px solid #EEF1F8",
        color: "#2b2a3a",
    } as const;
    const head = {
        ...cell,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#6b6280",
        background: "#F6F8FD",
        textTransform: "uppercase",
        textAlign: "left",
    } as const;

    return (
        <div style={{ padding: "24px 28px", fontFamily: fontFamily.base }}>
            <h2 style={{ margin: 0, fontSize: fontSize["3xl"], color: "#2b2a3a" }}>
                Client Sharing
            </h2>
            <p style={{ color: "#6b6280", fontSize: fontSize.base, marginTop: 4 }}>
                Choose what a client can see on their Client Dashboard. Only ticked-and-shared cases
                are visible to them.
            </p>

            {msg && (
                <div
                    role="status"
                    style={{
                        margin: "12px 0",
                        padding: "10px 14px",
                        borderRadius: radius.lg,
                        background: msg.ok ? "#E8F7EE" : "#FFF1F1",
                        color: msg.ok ? "#1B7F46" : "#A32020",
                        fontSize: fontSize.base,
                    }}
                >
                    {msg.text}
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    margin: "16px 0",
                    alignItems: "center",
                }}
            >
                <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    style={{ ...input, minWidth: 220 }}
                    aria-label="Client"
                >
                    <option value="">Select client…</option>
                    {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <input
                    type="date"
                    value={workDate}
                    onChange={(e) => setWorkDate(e.target.value)}
                    style={input}
                    aria-label="Work date"
                />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && load()}
                    placeholder="Search case number"
                    style={input}
                    aria-label="Search case number"
                />
                <button
                    onClick={load}
                    style={btn("var(--brand-blue)", !clientId)}
                    disabled={!clientId}
                >
                    Search
                </button>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button
                        onClick={() => act("share")}
                        disabled={busy || picked.size === 0}
                        style={btn("#1B7F46", busy || picked.size === 0)}
                    >
                        Share selected ({picked.size})
                    </button>
                    <button
                        onClick={() => act("unshare")}
                        disabled={busy || picked.size === 0}
                        style={btn("#C0392B", busy || picked.size === 0)}
                    >
                        Remove selected
                    </button>
                </div>
            </div>

            <div
                style={{
                    background: "#fff",
                    border: "1px solid #E7EBF5",
                    borderRadius: radius.xl,
                    overflow: "hidden",
                }}
            >
                {!clientId ? (
                    <div style={{ padding: 36, textAlign: "center", color: "#8a8fa3" }}>
                        Select a client to see their cases.
                    </div>
                ) : loading ? (
                    <div style={{ padding: 36, textAlign: "center", color: "#8a8fa3" }}>
                        Loading…
                    </div>
                ) : rows.length === 0 ? (
                    <div style={{ padding: 36, textAlign: "center", color: "#8a8fa3" }}>
                        No cases found for this client.
                    </div>
                ) : (
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr>
                                    <th style={{ ...head, width: 40 }}>
                                        <input
                                            type="checkbox"
                                            checked={allPicked}
                                            onChange={() =>
                                                setPicked(
                                                    allPicked
                                                        ? new Set()
                                                        : new Set(rows.map((r) => r.id))
                                                )
                                            }
                                            aria-label="Select all"
                                        />
                                    </th>
                                    <th style={head}>Case No.</th>
                                    <th style={head}>Service</th>
                                    <th style={head}>Subclient</th>
                                    <th style={head}>Work date</th>
                                    <th style={head}>Client sees</th>
                                    <th style={head}>Shared?</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id}>
                                        <td style={cell}>
                                            <input
                                                type="checkbox"
                                                checked={picked.has(r.id)}
                                                onChange={() => toggle(r.id)}
                                                aria-label={`Select ${r.caseNumber}`}
                                            />
                                        </td>
                                        <td style={{ ...cell, fontWeight: fontWeight.semibold }}>
                                            {r.caseNumber}
                                        </td>
                                        <td style={cell}>{r.service || "—"}</td>
                                        <td style={cell}>{r.subclient || "—"}</td>
                                        <td style={cell}>{r.workDate || "—"}</td>
                                        <td style={cell}>{r.status}</td>
                                        <td style={cell}>
                                            <span
                                                style={{
                                                    color: r.shared ? "#1B7F46" : "#8a8fa3",
                                                    fontWeight: fontWeight.semibold,
                                                }}
                                            >
                                                {r.shared ? "Shared" : "Not shared"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {rows.length >= 500 && (
                <div style={{ color: "#8a8fa3", fontSize: fontSize.sm, marginTop: 8 }}>
                    Showing the latest 500 — narrow with a date or search.
                </div>
            )}

            {canLink && (
                <div
                    style={{
                        marginTop: 28,
                        background: "#fff",
                        border: "1px solid #E7EBF5",
                        borderRadius: radius.xl,
                        padding: 18,
                    }}
                >
                    <div
                        style={{
                            fontWeight: fontWeight.semibold,
                            fontSize: fontSize.lg,
                            color: "#2b2a3a",
                        }}
                    >
                        Link client login
                    </div>
                    <p style={{ color: "#6b6280", fontSize: fontSize.sm, margin: "4px 0 12px" }}>
                        First create the person in Add User (as Team Member), then enter their email
                        here to make it a login for the client selected above.
                    </p>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="client@company.com"
                            style={{ ...input, minWidth: 260 }}
                            aria-label="Client login email"
                        />
                        <button
                            onClick={link}
                            disabled={busy || !clientId || !email.trim()}
                            style={btn("var(--brand-blue)", busy || !clientId || !email.trim())}
                        >
                            Link to selected client
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClientSharing;
