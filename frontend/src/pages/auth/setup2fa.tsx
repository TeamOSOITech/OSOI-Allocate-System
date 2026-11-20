// src/pages/auth/setup2fa.tsx
//
// Full-page "set up two-step verification" screen. Brand panel on the left
// (a live-looking authenticator code instead of paragraphs), the task on the
// right. A user whose 2FA is compulsory but not yet on lands here after login
// (and via authFetch on MFA_SETUP_REQUIRED). The server refuses everything
// else until they finish, so this page only needs the 2FA endpoints + logout.
import { useEffect, useState } from "react";
import TwoFactorSetup from "../../components/mfasetupcard";

const API_BASE = import.meta.env.VITE_API_URL;

function readUser(): { role?: string; firstName?: string } | null {
    try {
        return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return null;
    }
}

function useIsMobile(breakpoint = 860) {
    const [w, setW] = useState(typeof window === "undefined" ? 1200 : window.innerWidth);
    useEffect(() => {
        const on = () => setW(window.innerWidth);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return w < breakpoint;
}

const CHIPS = [
    { icon: "ti-shield-lock", label: "Stops stolen passwords" },
    { icon: "ti-device-mobile", label: "Code stays on your phone" },
    { icon: "ti-clock-hour-4", label: "Takes 1 minute" },
];

// Decorative, NO numbers: password -> phone code -> access.
function Flow() {
    const node = (path: string, label: string) => (
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <div
                style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    background: "rgba(255,255,255,.14)",
                    border: "1px solid rgba(255,255,255,.26)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d={path} />
                </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.85)" }}>
                {label}
            </span>
        </div>
    );
    const line = (
        <span
            style={{
                flex: 1,
                height: 2,
                margin: "0 8px 20px",
                borderRadius: 2,
                background: "rgba(255,255,255,.3)",
            }}
        />
    );
    return (
        <div aria-hidden style={{ display: "flex", alignItems: "center", maxWidth: 340 }}>
            {node("M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z", "Password")}
            {line}
            {node(
                "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
                "Phone code"
            )}
            {line}
            {node("M5 12.5l4.5 4.5L19 7.5", "Access")}
        </div>
    );
}

export default function Setup2FA() {
    const user = readUser();
    const isMobile = useIsMobile();

    // not logged in -> nothing to set up
    useEffect(() => {
        if (!user) window.location.href = "/login";
    }, [user]);

    const goHome = () => {
        window.location.href = user?.role === "CLIENT" ? "/client-dashboard" : "/profile";
    };

    const logout = async () => {
        try {
            await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
        } catch {
            /* leaving anyway */
        }
        try {
            localStorage.removeItem("user");
        } catch {
            /* ignore */
        }
        window.location.href = "/login";
    };

    if (!user) return null;

    const logoutBtn = (
        <button
            type="button"
            onClick={logout}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#F4F8FD",
                border: "1px solid #DCE6F2",
                borderRadius: 999,
                padding: "6px 12px",
                color: "#2A2F8F",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
            }}
        >
            <i className="ti ti-logout" />
            Log out
        </button>
    );

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg,#EAF3FC 0%,#E1EEF9 45%,#D8E8F7 100%)",
                fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
                padding: isMobile ? "20px 12px" : "32px 16px",
                boxSizing: "border-box",
            }}
        >
            <style>{`
                @keyframes s2faDrift { 0%{transform:translate(0,0)} 50%{transform:translate(-14px,10px)} 100%{transform:translate(0,0)} }
                .s2fa-orb { animation: s2faDrift 9s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) { .s2fa-orb { animation: none !important; } }
                *, *::before, *::after { box-sizing: border-box; }
            `}</style>

            <div
                style={{
                    width: "100%",
                    maxWidth: isMobile ? 460 : 1020,
                    background: "#fff",
                    borderRadius: isMobile ? 18 : 30,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    boxShadow: "0 25px 60px rgba(42,47,143,.15)",
                    minHeight: isMobile ? "auto" : 620,
                }}
            >
                {/* LEFT: brand panel */}
                <div
                    style={{
                        flex: isMobile ? "none" : 1,
                        position: "relative",
                        padding: isMobile ? "24px" : "44px 40px",
                        background:
                            "radial-gradient(120% 140% at 15% 10%,#2BAADD 0%,#2A2F8F 45%,#181A38 100%)",
                        color: "#fff",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            backgroundImage:
                                "linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)",
                            backgroundSize: "28px 28px",
                            maskImage: "radial-gradient(circle at 30% 30%,#000 0%,transparent 75%)",
                            pointerEvents: "none",
                        }}
                    />
                    <div
                        className="s2fa-orb"
                        style={{
                            position: "absolute",
                            width: isMobile ? 140 : 240,
                            height: isMobile ? 140 : 240,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,.14)",
                            filter: "blur(6px)",
                            top: isMobile ? -60 : -50,
                            right: -40,
                            pointerEvents: "none",
                        }}
                    />

                    {/* same as the login page: mobile = white-chip logo on the brand panel,
                        desktop = logo in the top-right corner of the form panel */}
                    {isMobile && (
                        <div
                            style={{
                                position: "relative",
                                zIndex: 1,
                                display: "flex",
                                alignSelf: "flex-start",
                            }}
                        >
                            <div
                                style={{
                                    display: "inline-flex",
                                    lineHeight: 0,
                                    background: "#fff",
                                    borderRadius: 14,
                                    padding: "8px 14px",
                                    boxShadow: "0 8px 24px rgba(10,12,50,.28)",
                                }}
                            >
                                <img
                                    src="/Logo.png"
                                    alt="Alookate"
                                    draggable={false}
                                    style={{ height: 26, width: "auto" }}
                                />
                            </div>
                        </div>
                    )}

                    <div
                        style={{
                            position: "relative",
                            zIndex: 1,
                            marginTop: isMobile ? 20 : "auto",
                            marginBottom: isMobile ? 0 : "auto",
                            paddingTop: isMobile ? 0 : 24,
                            display: "grid",
                            gap: isMobile ? 0 : 22,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <div
                                style={{
                                    width: 50,
                                    height: 50,
                                    borderRadius: 16,
                                    background: "rgba(255,255,255,.16)",
                                    border: "1px solid rgba(255,255,255,.28)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <i className="ti ti-shield-check" style={{ fontSize: 26 }} />
                            </div>
                            <h1
                                style={{
                                    margin: 0,
                                    color: "#fff", // index.css gives every h1 a dark colour
                                    fontSize: isMobile ? 24 : 32,
                                    lineHeight: 1.1,
                                    fontWeight: 800,
                                    letterSpacing: "-0.5px",
                                }}
                            >
                                Secure your account
                            </h1>
                        </div>

                        {/* phone-sized screens keep the task near the top */}
                        {!isMobile && <Flow />}

                        {!isMobile && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {CHIPS.map((c) => (
                                    <span
                                        key={c.label}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 7,
                                            padding: "7px 12px",
                                            borderRadius: 999,
                                            background: "rgba(255,255,255,.12)",
                                            border: "1px solid rgba(255,255,255,.2)",
                                            fontSize: 13,
                                            fontWeight: 600,
                                        }}
                                    >
                                        <i className={`ti ${c.icon}`} style={{ fontSize: 16 }} />
                                        {c.label}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: the task */}
                <div
                    style={{
                        flex: 1,
                        position: "relative", // pins the logo to this panel's corner
                        padding: isMobile ? "22px 20px 24px" : "32px 44px 36px",
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                    }}
                >
                    {!isMobile && (
                        <img
                            src="/Allookate.png"
                            alt="Alookate"
                            draggable={false}
                            style={{
                                position: "absolute",
                                top: 28,
                                right: 32,
                                height: 34,
                                width: "auto",
                                display: "block",
                            }}
                        />
                    )}
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <span style={{ color: "#767F92", fontSize: 14, fontWeight: 600 }}>
                            {user.firstName ? `Hi ${user.firstName} 👋` : "Welcome 👋"}
                        </span>
                        {isMobile && logoutBtn}
                    </div>

                    <div
                        style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            width: "100%",
                            maxWidth: 420,
                            margin: "0 auto",
                            paddingTop: 12,
                        }}
                    >
                        <h2
                            style={{
                                margin: "0 0 18px",
                                color: "#17181C",
                                fontSize: isMobile ? 22 : 26,
                                fontWeight: 800,
                                letterSpacing: "-0.3px",
                            }}
                        >
                            Set up 2-step verification
                        </h2>
                        <TwoFactorSetup onEnabled={goHome} plain />
                        {!isMobile && <div style={{ marginTop: 18 }}>{logoutBtn}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
