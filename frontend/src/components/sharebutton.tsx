// src/components/sharebutton.tsx
//
// Reusable "Share" button (Google-Docs style). Drop it into any page header:
//
//   <ShareButton pageKey="production-reports" title="Production Report" />
//
// Flow: pick a client -> its saved contacts (Primary / Secondary / Main email)
// appear in a dropdown with Primary preselected, plus "+ Add another email"
// which reveals a free-text email box. Click Share -> the person gets
// read-only access on their Client Dashboard. Staff roles only — renders
// nothing for anyone else. The page key must also be registered on the
// backend (PAGE_KEYS in clientportal.controller.js).

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../utils/authFetch";
import { getCurrentUser } from "../utils/auth";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const SHARE_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"];
const OTHER = "__other__";

type Grantee = {
    userId: string;
    email: string | null;
    name: string | null;
    permission: "VIEW" | "EDIT";
    sharedAt: string;
};

type ClientOpt = { id: string; name: string };
type Contact = { label: string; name: string | null; email: string };
type Props = { pageKey: string; title: string };

const selectStyle = {
    width: "100%",
    marginBottom: 8,
    padding: "9px 12px",
    border: "1px solid #D9DEEE",
    borderRadius: radius.lg,
    fontSize: fontSize.base,
    fontFamily: fontFamily.base,
    background: "#fff",
} as const;

const ShareButton = ({ pageKey, title }: Props) => {
    const role = getCurrentUser()?.role || "";
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [permission, setPermission] = useState<"VIEW" | "EDIT">("VIEW");
    const [clients, setClients] = useState<ClientOpt[]>([]);
    const [clientId, setClientId] = useState("");
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [picked, setPicked] = useState(""); // a contact email, or OTHER
    const [domains, setDomains] = useState<string[]>([]); // client's company domains
    const [list, setList] = useState<Grantee[]>([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(
                `${API_BASE}/api/client-portal/page-shares?pageKey=${encodeURIComponent(pageKey)}`,
                { cache: "no-store" }
            );
            const json = await res.json().catch(() => ({}));
            if (res.ok && json.success !== false) setList(json.data || []);
        } catch {
            /* list just stays empty */
        }
    }, [pageKey]);

    useEffect(() => {
        if (!open) return;
        load();
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/clients`, { cache: "no-store" });
                const json = await res.json().catch(() => []);
                const arr = Array.isArray(json) ? json : json?.data || [];
                setClients(arr.map((c: any) => ({ id: String(c.id), name: c.name })));
            } catch {
                /* dropdown stays empty */
            }
        })();
    }, [open, load]);

    // When the client changes, load its saved contacts. Primary is preselected.
    // (Must stay above the early return below so hook order never changes.)
    useEffect(() => {
        setContacts([]);
        setDomains([]);
        setPicked("");
        setEmail("");
        if (!clientId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(
                    `${API_BASE}/api/client-portal/clients/${clientId}/contacts`,
                    { cache: "no-store" }
                );
                const json = await res.json().catch(() => ({}));
                const arr: Contact[] = res.ok && json.success !== false ? json.data || [] : [];
                if (cancelled) return;
                setContacts(arr);
                setDomains(Array.isArray(json.domains) ? json.domains : []);
                setPicked(arr[0]?.email || OTHER);
            } catch {
                if (!cancelled) setPicked(OTHER);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [clientId]);

    if (!SHARE_ROLES.includes(role)) return null;

    const effectiveEmail = (picked === OTHER ? email : picked).trim();
    const cannotShare = busy || !effectiveEmail || !clientId;

    // Same rule the server enforces: a saved contact, or the client's own domain.
    const emailAllowedLocally = (value: string) => {
        const e = value.trim().toLowerCase();
        if (contacts.some((c) => c.email.toLowerCase() === e)) return true;
        const d = e.split("@")[1] || "";
        return domains.some((x) => d === x || d.endsWith("." + x));
    };

    const share = async () => {
        if (!effectiveEmail || !clientId) return;
        if (picked === OTHER && !emailAllowedLocally(effectiveEmail)) {
            setMsg({
                ok: false,
                text: domains.length
                    ? `Use an email from this client's domain (${domains
                          .map((d) => "@" + d)
                          .join(", ")}) or pick one of their saved contacts.`
                    : "No company email domain is on file for this client, so only its saved contacts can be used.",
            });
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            const res = await authFetch(`${API_BASE}/api/client-portal/page-shares`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageKey, email: effectiveEmail, clientId, permission }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not share.");
            setMsg({ ok: true, text: json.message });
            setEmail("");
            await load();
        } catch (e: any) {
            setMsg({ ok: false, text: e?.message || "Could not share." });
        } finally {
            setBusy(false);
        }
    };

    const remove = async (userId: string) => {
        setBusy(true);
        setMsg(null);
        try {
            const res = await authFetch(`${API_BASE}/api/client-portal/page-shares/remove`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageKey, userId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Could not remove.");
            await load();
        } catch (e: any) {
            setMsg({ ok: false, text: e?.message || "Could not remove." });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setMsg(null);
                    setOpen(true);
                }}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 18px",
                    borderRadius: radius.md,
                    border: "1px solid var(--brand-blue)",
                    background: "#fff",
                    color: "var(--brand-blue)",
                    fontSize: fontSize.base,
                    fontWeight: fontWeight.semibold,
                    fontFamily: fontFamily.base,
                    cursor: "pointer",
                }}
            >
                <i className="ti ti-share" aria-hidden="true" />
                Share
            </button>

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(10,15,40,0.45)",
                        zIndex: 2000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                    }}
                >
                    <div
                        role="dialog"
                        aria-label={`Share ${title}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 520,
                            background: "#fff",
                            borderRadius: radius.xl,
                            padding: 22,
                            fontFamily: fontFamily.base,
                            boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
                            maxHeight: "90dvh",
                            overflowY: "auto",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <div
                                style={{
                                    fontSize: fontSize["2xl"],
                                    fontWeight: fontWeight.semibold,
                                    color: "#17181C",
                                }}
                            >
                                Share "{title}"
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    fontSize: 20,
                                    cursor: "pointer",
                                    color: "#6b6280",
                                }}
                            >
                                <i className="ti ti-x" aria-hidden="true" />
                            </button>
                        </div>
                        <p
                            style={{
                                color: "#6b6280",
                                fontSize: fontSize.sm,
                                margin: "6px 0 14px",
                            }}
                        >
                            Pick a client, then choose one of its contacts (or add another email).
                            If the person has no login yet, an invite is sent to that address. They
                            see a read-only version of this page on their Client Dashboard, limited
                            to their own client's data.
                        </p>

                        <select
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            aria-label="Client"
                            style={selectStyle}
                        >
                            <option value="">Which client is this person from?</option>
                            {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>

                        {clientId && (
                            <select
                                value={picked}
                                onChange={(e) => setPicked(e.target.value)}
                                aria-label="Contact"
                                style={selectStyle}
                            >
                                {contacts.map((c) => (
                                    <option key={c.email} value={c.email}>
                                        {c.label}
                                        {c.name ? ` — ${c.name}` : ""} ({c.email})
                                    </option>
                                ))}
                                <option value={OTHER}>+ Add another email</option>
                            </select>
                        )}

                        {clientId && picked === OTHER && (
                            <div
                                style={{
                                    fontSize: fontSize.sm,
                                    color: "#6b6280",
                                    marginBottom: 8,
                                }}
                            >
                                {domains.length
                                    ? `Only ${domains.map((d) => "@" + d).join(", ")} addresses are allowed.`
                                    : "No company domain on file — only saved contacts can be used."}
                            </div>
                        )}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {picked === OTHER && (
                                <input
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && share()}
                                    placeholder="Email address"
                                    aria-label="Email"
                                    style={{
                                        flex: 1,
                                        minWidth: 200,
                                        padding: "9px 12px",
                                        border: "1px solid #D9DEEE",
                                        borderRadius: radius.lg,
                                        fontSize: fontSize.base,
                                        fontFamily: fontFamily.base,
                                    }}
                                />
                            )}
                            <select
                                value={permission}
                                onChange={(e) => setPermission(e.target.value as "VIEW" | "EDIT")}
                                aria-label="Permission"
                                style={{
                                    padding: "9px 12px",
                                    border: "1px solid #D9DEEE",
                                    borderRadius: radius.lg,
                                    fontSize: fontSize.base,
                                    fontFamily: fontFamily.base,
                                    background: "#fff",
                                }}
                            >
                                <option value="VIEW">Can view</option>
                                <option value="EDIT" disabled>
                                    Can edit (coming soon)
                                </option>
                            </select>
                            <button
                                onClick={share}
                                disabled={cannotShare}
                                style={{
                                    padding: "9px 18px",
                                    border: "none",
                                    borderRadius: radius.lg,
                                    background: cannotShare ? "#C9CEDD" : "var(--brand-blue)",
                                    color: "#fff",
                                    fontSize: fontSize.base,
                                    fontWeight: fontWeight.semibold,
                                    fontFamily: fontFamily.base,
                                    cursor: cannotShare ? "not-allowed" : "pointer",
                                }}
                            >
                                Share
                            </button>
                        </div>

                        {msg && (
                            <div
                                role="status"
                                style={{
                                    marginTop: 12,
                                    padding: "9px 12px",
                                    borderRadius: radius.lg,
                                    background: msg.ok ? "#E8F7EE" : "#FFF1F1",
                                    color: msg.ok ? "#1B7F46" : "#A32020",
                                    fontSize: fontSize.sm,
                                }}
                            >
                                {msg.text}
                            </div>
                        )}

                        <div
                            style={{
                                marginTop: 18,
                                fontSize: fontSize.sm,
                                fontWeight: fontWeight.semibold,
                                color: "#6b6280",
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                            }}
                        >
                            People with access
                        </div>
                        {list.length === 0 ? (
                            <div
                                style={{
                                    color: "#8a8fa3",
                                    fontSize: fontSize.base,
                                    padding: "10px 0",
                                }}
                            >
                                Not shared with anyone yet.
                            </div>
                        ) : (
                            list.map((g) => (
                                <div
                                    key={g.userId}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "10px 0",
                                        borderBottom: "1px solid #EEF1F8",
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: fontSize.base,
                                                color: "#2b2a3a",
                                                fontWeight: fontWeight.medium,
                                            }}
                                        >
                                            {g.name || g.email}
                                        </div>
                                        {g.name && (
                                            <div
                                                style={{ fontSize: fontSize.sm, color: "#8a8fa3" }}
                                            >
                                                {g.email}
                                            </div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: fontSize.sm, color: "#6b6280" }}>
                                        {g.permission === "VIEW" ? "Can view" : "Can edit"}
                                    </span>
                                    <button
                                        onClick={() => remove(g.userId)}
                                        disabled={busy}
                                        style={{
                                            border: "none",
                                            background: "transparent",
                                            color: "#C0392B",
                                            cursor: "pointer",
                                            fontSize: fontSize.sm,
                                            fontFamily: fontFamily.base,
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default ShareButton;
