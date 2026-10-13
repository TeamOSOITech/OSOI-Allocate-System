import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";

// In-app notification bell (header). Shows e.g. the "you received more than
// 8 hours of work today" alert that used to be sent by mail.
// Backend: GET /api/notifications, PATCH /api/notifications/read
const API_BASE = import.meta.env.VITE_API_URL;
const POLL_MS = 60_000;

interface NotificationItem {
    id: string;
    type: string;
    title: string;
    message: string;
    work_date: string | null;
    is_read: boolean;
    created_at: string;
}

interface Props {
    buttonStyle: CSSProperties;
    badgeStyle: CSSProperties;
    isMobile?: boolean;
}

// Browser push (works even when logged out / browser closed)
const pushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

function urlBase64ToUint8Array(base64: string) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// The VAPID PUBLIC key is not a secret. If it is set as VITE_VAPID_PUBLIC_KEY
// (frontend .env / Vercel env) we skip the extra backend call — which matters
// a lot when the backend is "asleep" (Render free tier cold start).
const ENV_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error(message)), ms);
        p.then(
            (v) => {
                window.clearTimeout(t);
                resolve(v);
            },
            (e) => {
                window.clearTimeout(t);
                reject(e);
            }
        );
    });
}

async function getPublicKey(): Promise<string> {
    if (ENV_PUBLIC_KEY) return ENV_PUBLIC_KEY;
    const keyRes = await authFetch(`${API_BASE}/api/notifications/push-key`);
    const keyJson = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok || !keyJson.success) {
        throw new Error(
            "Alerts are not set up on the server yet (VAPID keys missing). Please tell your admin."
        );
    }
    return keyJson.data.publicKey;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
    if (!a) return false;
    const x = new Uint8Array(a);
    return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function registerPush(): Promise<boolean> {
    // key lookup and service-worker start run in PARALLEL (was one after another)
    const [publicKey, reg] = await Promise.all([
        getPublicKey(),
        navigator.serviceWorker.register("/sw.js").then(async (r) => {
            await navigator.serviceWorker.ready;
            return r;
        }),
    ]);
    const appKey = urlBase64ToUint8Array(publicKey);

    let sub = await reg.pushManager.getSubscription();
    // a subscription made with a DIFFERENT key (e.g. old/local keys) can never
    // receive pushes from this server — drop it and subscribe again
    if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
        await sub.unsubscribe();
        sub = null;
    }
    if (!sub) {
        sub = await withTimeout(
            reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }),
            20000,
            "Your browser could not reach its notification service. Check the internet / firewall and try again."
        );
    }
    const res = await authFetch(`${API_BASE}/api/notifications/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) throw new Error("Could not save this device on the server. Please try again.");
    return true;
}

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return new Date(iso).toLocaleDateString();
}

export default function NotificationBell({ buttonStyle, badgeStyle, isMobile = false }: Props) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [unread, setUnread] = useState(0);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [permission, setPermission] = useState<NotificationPermission>(
        pushSupported ? Notification.permission : "denied"
    );
    const [enabling, setEnabling] = useState(false);
    const [pushError, setPushError] = useState("");

    // On every app open / refresh:
    //  - already allowed  -> quietly (re)link this device to the logged-in user
    //  - not asked yet    -> show the browser's "Allow notifications?" popup
    //                        automatically (no button click needed)
    //  - blocked          -> nothing (only the user can unblock it in browser settings)
    // Safari/iPhone and Firefox only show the popup after a click; for them the
    // "Turn on alerts" button in the bell stays as the fallback.
    useEffect(() => {
        if (!pushSupported) return;
        const fail = (e: any) => setPushError(e?.message || "Could not turn on alerts.");
        if (Notification.permission === "granted") {
            registerPush().catch(fail);
        } else if (Notification.permission === "default") {
            Notification.requestPermission()
                .then((result) => {
                    setPermission(result);
                    if (result === "granted") return registerPush();
                })
                .catch(fail);
        }
    }, []);

    const enablePush = async () => {
        setEnabling(true);
        setPushError("");
        try {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result === "granted") await registerPush();
        } catch (e: any) {
            setPushError(e?.message || "Could not turn on alerts.");
        } finally {
            setEnabling(false);
        }
    };

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/notifications`);
            const json = await res.json();
            if (res.ok && json.success) {
                setItems(json.data?.items || []);
                setUnread(json.data?.unreadCount || 0);
            }
        } catch {
            // a failed poll must never bother the user
        }
    }, []);

    useEffect(() => {
        void load();
        const t = window.setInterval(() => void load(), POLL_MS);
        const onFocus = () => void load();
        window.addEventListener("focus", onFocus);
        return () => {
            window.clearInterval(t);
            window.removeEventListener("focus", onFocus);
        };
    }, [load]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onEsc);
        };
    }, [open]);

    const markAllRead = async () => {
        if (unread === 0) return;
        setUnread(0);
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
        try {
            await authFetch(`${API_BASE}/api/notifications/read`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
        } catch {
            void load();
        }
    };

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next) {
            void load();
            void markAllRead();
        }
    };

    return (
        <div style={{ position: "relative" }} ref={wrapRef}>
            <button
                type="button"
                style={buttonStyle}
                onClick={toggle}
                aria-label="Notifications"
                aria-expanded={open}
                title="Notifications"
            >
                <i className="ti ti-bell" />
                {unread > 0 && <span style={badgeStyle}>{unread > 9 ? "9+" : unread}</span>}
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 10px)",
                        right: isMobile ? -40 : 0,
                        width: isMobile ? "min(320px, 92vw)" : 340,
                        maxHeight: 420,
                        overflowY: "auto",
                        background: "#ffffff",
                        color: "#1e2a4a",
                        borderRadius: radius.md,
                        boxShadow: "0 12px 40px rgba(32,66,151,0.22)",
                        border: "1px solid #e3e8f4",
                        zIndex: 300,
                    }}
                >
                    <div
                        style={{
                            padding: "12px 14px",
                            fontSize: fontSize.md,
                            fontWeight: fontWeight.bold,
                            borderBottom: "1px solid #eef0f5",
                        }}
                    >
                        Notifications
                    </div>

                    {pushSupported && (permission !== "granted" || pushError) && (
                        <div
                            style={{
                                padding: "10px 14px",
                                background: "#fff8e6",
                                borderBottom: "1px solid #f3e3b5",
                                fontSize: fontSize.sm,
                                color: "#6b5200",
                                lineHeight: 1.5,
                            }}
                        >
                            {permission === "denied" ? (
                                "Alerts are blocked in this browser. Allow notifications for this site in browser settings to get alerts even when logged out."
                            ) : pushError ? (
                                <>
                                    <span style={{ color: "#b42318" }}>{pushError}</span>
                                    <div style={{ marginTop: 6 }}>
                                        <button
                                            type="button"
                                            onClick={enablePush}
                                            disabled={enabling}
                                            style={{
                                                background: "#204297",
                                                color: "#fff",
                                                border: "none",
                                                borderRadius: radius.md,
                                                padding: "6px 12px",
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.semibold,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {enabling ? "Trying..." : "Try again"}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    Get alerts on this device even when you are logged out.
                                    <div style={{ marginTop: 6 }}>
                                        <button
                                            type="button"
                                            onClick={enablePush}
                                            disabled={enabling}
                                            style={{
                                                background: "#204297",
                                                color: "#fff",
                                                border: "none",
                                                borderRadius: radius.md,
                                                padding: "6px 12px",
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.semibold,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {enabling ? "Enabling..." : "Turn on alerts"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {items.length === 0 ? (
                        <div
                            style={{
                                padding: "28px 14px",
                                textAlign: "center",
                                fontSize: fontSize.sm,
                                color: "#6b7690",
                            }}
                        >
                            No notifications yet.
                        </div>
                    ) : (
                        items.map((n) => (
                            <div
                                key={n.id}
                                style={{
                                    padding: "11px 14px",
                                    borderBottom: "1px solid #f1f3f9",
                                    background: n.is_read ? "#ffffff" : "#f2f7ff",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        fontSize: fontSize.base,
                                        fontWeight: fontWeight.semibold,
                                    }}
                                >
                                    <span>{n.title}</span>
                                    <span
                                        style={{
                                            fontSize: fontSize.xs,
                                            fontWeight: fontWeight.medium,
                                            color: "#9aa3b5",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {timeAgo(n.created_at)}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        marginTop: 3,
                                        fontSize: fontSize.sm,
                                        lineHeight: 1.5,
                                        color: "#4a5570",
                                    }}
                                >
                                    {n.message}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
