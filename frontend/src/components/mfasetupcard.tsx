// src/components/mfasetupcard.tsx
//
// "Two-step verification" card (Settings -> Security).
//   OFF -> [Turn on] -> scan QR with Google Authenticator / Authy -> type the
//          first 6-digit code -> ON
//   ON  -> [Turn off] -> type a current code -> OFF
//
// All real work happens on the backend (/api/auth/mfa/*, Supabase TOTP MFA).
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { setCsrfToken } from "../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;

type Status = "loading" | "on" | "off" | "error";
type Setup = { factorId: string; qrCode: string; secret: string };

const card: CSSProperties = {
    border: "1px solid #DCE6F2",
    borderRadius: 14,
    padding: 18,
    background: "#fff",
    maxWidth: 440,
};
const primaryBtn: CSSProperties = {
    border: "none",
    borderRadius: 10,
    padding: "9px 16px",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
};
const ghostBtn: CSSProperties = {
    border: "1px solid #C7D9F0",
    borderRadius: 10,
    padding: "9px 16px",
    color: "#2A2F8F",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    background: "#fff",
};
const codeInput: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #C7D9F0",
    borderRadius: 10,
    background: "#F4F8FD",
    color: "#17181C",
    colorScheme: "light",
    fontSize: 20,
    letterSpacing: 6,
    textAlign: "center",
    outline: "none",
};

// The QR from Supabase can arrive in different shapes depending on the
// version: a `data:image/svg+xml;utf-8,<svg ...>` string with the SVG text NOT
// url-encoded (its colors contain "#", which a browser treats as a URL
// fragment, so the picture breaks), a base64 data URL, or a bare "<svg ...>".
// Normalise every shape into a proper, encoded data URL.
function qrSrc(qr: string): string {
    if (!qr) return "";
    let svg = qr.trim();
    if (svg.startsWith("data:")) {
        const i = svg.indexOf(",");
        const head = svg.slice(0, i);
        const body = svg.slice(i + 1);
        if (/;base64/i.test(head)) return `data:image/svg+xml;base64,${body}`;
        svg = decodeURIComponentSafe(body).trim();
    }
    if (!svg.startsWith("<")) return qr;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function decodeURIComponentSafe(v: string): string {
    try {
        return decodeURIComponent(v);
    } catch {
        return v;
    }
}

async function post(path: string, body?: unknown) {
    const res = await authFetch(`${API_BASE}/api/auth/mfa/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.message || "Something went wrong.");
    return json;
}

export default function TwoFactorSetup({
    onEnabled,
    plain = false,
}: {
    onEnabled?: () => void;
    // plain = no border / padding (used inside a page that already has its own card)
    plain?: boolean;
}) {
    const [status, setStatus] = useState<Status>("loading");
    const [required, setRequired] = useState(false);
    const [setup, setSetup] = useState<Setup | null>(null);
    const [disabling, setDisabling] = useState(false);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [qrFailed, setQrFailed] = useState(false);
    const [showKey, setShowKey] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/auth/mfa/status`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error();
            setStatus(json.data.enabled ? "on" : "off");
            setRequired(!!json.data.required);
        } catch {
            setStatus("error");
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const reset = () => {
        setSetup(null);
        setDisabling(false);
        setCode("");
        setError("");
    };

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await fn();
        } catch (e: any) {
            setError(e?.message || "Something went wrong.");
        } finally {
            setBusy(false);
        }
    };

    const start = () =>
        run(async () => {
            setNotice("");
            const json = await post("enroll");
            setSetup(json.data);
            setQrFailed(false);
            setShowKey(false);
            setCode("");
        });

    const confirm = () =>
        run(async () => {
            const json = await post("enroll/verify", { factorId: setup?.factorId, code });
            // the session was upgraded: new cookies + a new CSRF token
            if (json.data?.csrfToken) setCsrfToken(json.data.csrfToken);
            reset();
            setStatus("on");
            setNotice("Two-step verification is now on.");
            onEnabled?.();
        });

    const turnOff = () =>
        run(async () => {
            await post("disable", { code });
            reset();
            setStatus("off");
            setNotice("Two-step verification is now off.");
        });

    const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

    return (
        <div style={plain ? { ...card, border: "none", padding: 0, maxWidth: "none" } : card}>
            {status === "loading" && <div style={{ color: "#767F92" }}>Loading…</div>}

            {status === "error" && (
                <div style={{ color: "#B42318", fontSize: 13 }}>
                    Could not load two-step verification. Please try again later.
                </div>
            )}

            {plain && status === "off" && !setup && !disabling && (
                <>
                    {error && <p style={{ color: "#B42318", fontSize: 13 }}>{error}</p>}
                    <button style={primaryBtn} disabled={busy} onClick={start}>
                        {busy ? "Please wait…" : "Turn on"}
                    </button>
                </>
            )}

            {!(plain && status === "off") &&
                (status === "on" || status === "off") &&
                !setup &&
                !disabling && (
                    <>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                                style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "50%",
                                    background: status === "on" ? "#16A34A" : "#9CA3AF",
                                }}
                            />
                            <strong style={{ color: "#17181C" }}>
                                {status === "on" ? "On" : "Off"}
                            </strong>
                        </div>
                        <p style={{ color: "#767F92", fontSize: 13, margin: "8px 0 14px" }}>
                            {status === "on"
                                ? "Your account asks for a code from your authenticator app every time you sign in."
                                : "Add a second step to sign-in using an authenticator app (Google Authenticator, Authy, Microsoft Authenticator)."}
                        </p>
                        {required && status === "off" && (
                            <p style={{ color: "#B54708", fontSize: 13, margin: "0 0 12px" }}>
                                Your role requires two-step verification. Please turn it on.
                            </p>
                        )}
                        {notice && (
                            <p style={{ color: "#15803D", fontSize: 13, margin: "0 0 12px" }}>
                                {notice}
                            </p>
                        )}
                        {error && <p style={{ color: "#B42318", fontSize: 13 }}>{error}</p>}
                        {status === "off" ? (
                            <button style={primaryBtn} disabled={busy} onClick={start}>
                                {busy ? "Please wait…" : "Turn on"}
                            </button>
                        ) : !required ? (
                            <button
                                style={ghostBtn}
                                onClick={() => {
                                    setNotice("");
                                    setDisabling(true);
                                }}
                            >
                                Turn off
                            </button>
                        ) : null}
                    </>
                )}

            {setup && (
                <>
                    {!plain && (
                        <strong style={{ color: "#17181C" }}>Set up your authenticator</strong>
                    )}
                    <div
                        style={{
                            display: "grid",
                            gap: 8,
                            margin: plain ? "0 0 14px" : "10px 0 12px",
                        }}
                    >
                        {[
                            "Open your authenticator app and tap “+”.",
                            "Scan this QR code.",
                            "Type the 6-digit code it shows.",
                        ].map((t, i) => (
                            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span
                                    style={{
                                        flex: "0 0 22px",
                                        width: 22,
                                        height: 22,
                                        borderRadius: "50%",
                                        background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                        color: "#fff",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {i + 1}
                                </span>
                                <span style={{ color: "#3D4459", fontSize: 13 }}>{t}</span>
                            </div>
                        ))}
                    </div>

                    <div style={{ textAlign: "center", margin: "4px 0 6px" }}>
                        {qrFailed ? (
                            <div
                                style={{
                                    padding: 12,
                                    border: "1px dashed #C7D9F0",
                                    borderRadius: 10,
                                    color: "#B54708",
                                    fontSize: 13,
                                }}
                            >
                                The QR image could not be shown. Use the setup key below.
                            </div>
                        ) : (
                            <img
                                src={qrSrc(setup.qrCode)}
                                alt="Scan this QR code with your authenticator app"
                                onError={() => setQrFailed(true)}
                                style={{
                                    width: 150,
                                    height: 150,
                                    background: "#fff",
                                    border: "1px solid #E3ECF6",
                                    borderRadius: 12,
                                    padding: 6,
                                }}
                            />
                        )}
                    </div>

                    <div style={{ textAlign: "center", marginBottom: 12 }}>
                        <button
                            type="button"
                            onClick={() => setShowKey((v) => !v || qrFailed)}
                            style={{
                                background: "none",
                                border: "none",
                                color: "#2A2F8F",
                                fontWeight: 600,
                                fontSize: 12,
                                cursor: "pointer",
                                padding: 0,
                            }}
                        >
                            {showKey || qrFailed ? "Hide setup key" : "Can’t scan? Use a setup key"}
                        </button>
                        {(showKey || qrFailed) && (
                            <div style={{ marginTop: 8, fontSize: 12, color: "#767F92" }}>
                                In the app choose “Enter a setup key” (Time based) and paste:
                                <div
                                    style={{
                                        fontFamily: "monospace",
                                        color: "#17181C",
                                        wordBreak: "break-all",
                                        marginTop: 4,
                                        userSelect: "all",
                                    }}
                                >
                                    {setup.secret}
                                </div>
                            </div>
                        )}
                    </div>

                    <input
                        style={codeInput}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(digits(e.target.value))}
                    />
                    {error && <p style={{ color: "#B42318", fontSize: 13 }}>{error}</p>}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button
                            style={primaryBtn}
                            disabled={busy || code.length !== 6}
                            onClick={confirm}
                        >
                            {busy ? "Checking…" : "Confirm & turn on"}
                        </button>
                        <button style={ghostBtn} disabled={busy} onClick={reset}>
                            Cancel
                        </button>
                    </div>
                </>
            )}

            {disabling && (
                <>
                    <strong style={{ color: "#17181C" }}>Turn off two-step verification</strong>
                    <p style={{ color: "#767F92", fontSize: 13, margin: "6px 0 10px" }}>
                        Enter the current 6-digit code from your authenticator app to confirm.
                    </p>
                    <input
                        style={codeInput}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(digits(e.target.value))}
                    />
                    {error && <p style={{ color: "#B42318", fontSize: 13 }}>{error}</p>}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button
                            style={primaryBtn}
                            disabled={busy || code.length !== 6}
                            onClick={turnOff}
                        >
                            {busy ? "Checking…" : "Turn off"}
                        </button>
                        <button style={ghostBtn} disabled={busy} onClick={reset}>
                            Cancel
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
