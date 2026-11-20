// src/pages/auth/setup2fa.tsx
//
// Full-page "set up two-step verification" screen, styled like the login page
// (brand panel on the left, the task on the right). A user whose 2FA is
// compulsory but not yet on is sent here after login (and by authFetch when
// the server answers MFA_SETUP_REQUIRED). The server refuses everything else
// until they finish, so this page only needs the 2FA endpoints + logout.
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

const POINTS: { icon: string; title: string; text: string }[] = [
    {
        icon: "ti-shield-lock",
        title: "Stops stolen passwords",
        text: "A password alone can no longer open your account.",
    },
    {
        icon: "ti-device-mobile",
        title: "Code stays on your phone",
        text: "Your authenticator app makes a new 6-digit code every 30 seconds.",
    },
    {
        icon: "ti-clock-hour-4",
        title: "One minute, one time",
        text: "Set it up once. After that, sign-in only takes one extra code.",
    },
];

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
                    minHeight: isMobile ? "auto" : 600,
                }}
            >
                {/* LEFT: brand panel */}
                <div
                    style={{
                        flex: isMobile ? "none" : 1,
                        position: "relative",
                        padding: isMobile ? "28px 24px" : "44px 40px",
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
                            right: isMobile ? -40 : -40,
                            pointerEvents: "none",
                        }}
                    />

                    <div style={{ position: "relative", zIndex: 1 }}>
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
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
                                style={{ height: 26, width: "auto", display: "block" }}
                            />
                        </div>
                    </div>

                    <div
                        style={{
                            position: "relative",
                            zIndex: 1,
                            marginTop: isMobile ? 22 : "auto",
                            marginBottom: isMobile ? 0 : "auto",
                            paddingTop: isMobile ? 0 : 24,
                        }}
                    >
                        <div
                            style={{
                                width: isMobile ? 44 : 54,
                                height: isMobile ? 44 : 54,
                                borderRadius: 16,
                                background: "rgba(255,255,255,.16)",
                                border: "1px solid rgba(255,255,255,.28)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: isMobile ? 12 : 18,
                            }}
                        >
                            <i
                                className="ti ti-shield-check"
                                style={{ fontSize: 28, color: "#fff" }}
                            />
                        </div>
                        <h1
                            style={{
                                margin: 0,
                                fontSize: isMobile ? 26 : 34,
                                lineHeight: 1.15,
                                fontWeight: 800,
                                letterSpacing: "-0.5px",
                            }}
                        >
                            Secure your
                            <br />
                            account
                        </h1>
                        <p
                            style={{
                                margin: "12px 0 0",
                                fontSize: 15,
                                lineHeight: 1.55,
                                color: "rgba(255,255,255,.82)",
                                maxWidth: 360,
                            }}
                        >
                            Two-step verification adds a second lock to your sign-in.
                        </p>

                        {/* on a phone the task itself must stay near the top, so the
                            three reassurance points are desktop-only */}
                        <div
                            style={{
                                marginTop: 28,
                                display: isMobile ? "none" : "grid",
                                gap: 14,
                            }}
                        >
                            {POINTS.map((p) => (
                                <div key={p.title} style={{ display: "flex", gap: 12 }}>
                                    <div
                                        style={{
                                            flex: "0 0 34px",
                                            width: 34,
                                            height: 34,
                                            borderRadius: 10,
                                            background: "rgba(255,255,255,.14)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        <i className={`ti ${p.icon}`} style={{ fontSize: 18 }} />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                                            {p.title}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                color: "rgba(255,255,255,.72)",
                                                lineHeight: 1.45,
                                            }}
                                        >
                                            {p.text}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* RIGHT: the task */}
                <div
                    style={{
                        flex: 1,
                        padding: isMobile ? "26px 20px 24px" : "44px 44px 32px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        minWidth: 0,
                    }}
                >
                    <div style={{ color: "#767F92", fontSize: 14, fontWeight: 600 }}>
                        {user.firstName ? `Hi ${user.firstName},` : "Welcome,"}
                    </div>
                    <h2
                        style={{
                            margin: "4px 0 6px",
                            color: "#17181C",
                            fontSize: isMobile ? 22 : 26,
                            fontWeight: 800,
                            letterSpacing: "-0.3px",
                        }}
                    >
                        Set up two-step verification
                    </h2>
                    <p
                        style={{
                            margin: "0 0 22px",
                            color: "#767F92",
                            fontSize: 14,
                            lineHeight: 1.5,
                        }}
                    >
                        Use an authenticator app such as Google Authenticator.
                    </p>

                    <TwoFactorSetup onEnabled={goHome} plain />

                    <button
                        type="button"
                        onClick={logout}
                        style={{
                            marginTop: 18,
                            alignSelf: "flex-start",
                            background: "none",
                            border: "none",
                            color: "#2A2F8F",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: "pointer",
                            padding: 0,
                        }}
                    >
                        <i className="ti ti-logout" style={{ marginRight: 6 }} />
                        Log out
                    </button>
                </div>
            </div>
        </div>
    );
}
