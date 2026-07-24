import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 860;
const COMPACT_BREAKPOINT = 640;

function useViewport() {
    const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return {
        isMobile: width < MOBILE_BREAKPOINT,
        isCompact: width < COMPACT_BREAKPOINT,
    };
}

const FEATURES = [
    { icon: "ti-clipboard-list", label: "Tasks" },
    { icon: "ti-chart-bar", label: "Reports" },
    { icon: "ti-users", label: "Team" },
];

const Login = () => {
    const { isMobile, isCompact } = useViewport();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [resetSending, setResetSending] = useState(false);
    const [view, setView] = useState<"login" | "forgot" | "sent">("login");

    const API_URL = import.meta.env.VITE_API_URL;

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: username,
                    password,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Login failed");
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            const userRole = data.data.user.role;

            // FIX: this switch only knew the OLD roles (ADMIN/MANAGER/
            // EMPLOYEE). After migrating user_master."Role" to the new
            // 6-tier system, every login fell through to "Invalid role"
            // below — nobody could actually get in, even with a correct
            // password, because the role string never matched a case.
            switch (userRole) {
                case "SUPER_ADMIN":
                case "OPS_MANAGER":
                case "AUDIT_MANAGER":
                case "PROCESS_LEAD":
                    window.location.href = "/dashboard";
                    break;

                case "VERTICAL_HEAD":
                    window.location.href = "/workinprogress";
                    break;

                case "TEAM_MEMBER":
                    window.location.href = "/report";
                    break;

                default:
                    setError("Invalid role");
            }
        } catch (err: any) {
            setError(err.message || "Login failed.");
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPasswordClick = () => {
        if (!username.trim()) {
            setError("Enter your email address first, then tap Forgot password.");
            return;
        }
        setError("");
        setView("forgot");
    };

    const handleSendResetLink = async () => {
        setResetSending(true);
        setError("");

        try {
            const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email: username.trim() }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Something went wrong. Try again.");
            }

            setView("sent");
        } catch (err: any) {
            setError(err.message || "Something went wrong. Try again.");
        } finally {
            setResetSending(false);
        }
    };

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
                overflowX: "hidden",
                width: "100%",
            }}
        >
            <style>{`
                @keyframes dwaFloat {
                    0%   { transform: translateY(0px) rotate(var(--r,0deg)); }
                    50%  { transform: translateY(-10px) rotate(var(--r,0deg)); }
                    100% { transform: translateY(0px) rotate(var(--r,0deg)); }
                }
                @keyframes dwaPulse {
                    0%   { box-shadow: 0 0 0 0 rgba(255,255,255,.35); }
                    100% { box-shadow: 0 0 0 18px rgba(255,255,255,0); }
                }
                @keyframes dwaDrift {
                    0%   { transform: translate(0,0); }
                    50%  { transform: translate(-14px,10px); }
                    100% { transform: translate(0,0); }
                }
                .dwa-card {
                    animation: dwaFloat 5s ease-in-out infinite;
                }
                .dwa-orb {
                    animation: dwaDrift 9s ease-in-out infinite;
                }
                @media (prefers-reduced-motion: reduce) {
                    .dwa-card, .dwa-orb, .dwa-pulse { animation: none !important; }
                }
                *, *::before, *::after { box-sizing: border-box; }
            `}</style>

            <div
                style={{
                    width: "100%",
                    maxWidth: isMobile ? 420 : 1100,
                    background: "#fff",
                    borderRadius: isMobile ? 18 : 30,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    boxShadow: isMobile
                        ? "0 12px 32px rgba(42,47,143,.18)"
                        : "0 25px 60px rgba(42,47,143,.15)",
                    minHeight: isMobile ? "auto" : 620,
                }}
            >
                {/* LEFT — brand panel */}
                <div
                    style={{
                        flex: isMobile ? "none" : 1,
                        position: "relative",
                        padding: isCompact ? "28px 20px 24px" : isMobile ? "36px 28px" : 40,
                        background:
                            "radial-gradient(120% 140% at 15% 10%,#2BAADD 0%,#2A2F8F 45%,#181A38 100%)",
                        color: "#fff",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        overflow: "hidden",
                        minHeight: isMobile ? (isCompact ? 210 : 260) : "auto",
                    }}
                >
                    {/* subtle grid texture */}
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

                    {/* drifting glow orbs */}
                    <div
                        className="dwa-orb"
                        style={{
                            position: "absolute",
                            width: isMobile ? 140 : 220,
                            height: isMobile ? 140 : 220,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,.16)",
                            filter: "blur(6px)",
                            top: isMobile ? -60 : -40,
                            right: isMobile ? -40 : -30,
                            pointerEvents: "none",
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            width: isMobile ? 120 : 180,
                            height: isMobile ? 120 : 180,
                            borderRadius: "50%",
                            background: "rgba(0,181,160,.45)",
                            filter: "blur(10px)",
                            bottom: -50,
                            left: -30,
                            pointerEvents: "none",
                        }}
                    />

                    {/* floating task-card mini illustration, desktop/tablet only */}
                    {!isCompact && (
                        <div
                            style={{
                                position: "absolute",
                                right: isMobile ? 18 : -10,
                                top: isMobile ? 10 : "50%",
                                transform: isMobile ? "none" : "translateY(-50%)",
                                width: isMobile ? 120 : 190,
                                height: isMobile ? 100 : 190,
                                pointerEvents: "none",
                                opacity: isMobile ? 0.35 : 1,
                            }}
                        >
                            <div
                                className="dwa-card"
                                style={
                                    {
                                        "--r": "-8deg",
                                        position: "absolute",
                                        top: 0,
                                        left: 10,
                                        width: isMobile ? 84 : 132,
                                        borderRadius: 12,
                                        background: "rgba(255,255,255,.14)",
                                        border: "1px solid rgba(255,255,255,.35)",
                                        backdropFilter: "blur(6px)",
                                        padding: isMobile ? "8px 10px" : "12px 14px",
                                        transform: "rotate(-8deg)",
                                        boxShadow: "0 14px 30px rgba(20,22,60,.35)",
                                    } as React.CSSProperties
                                }
                            >
                                <i
                                    className="ti ti-checkbox"
                                    style={{ fontSize: isMobile ? 14 : 18, opacity: 0.9 }}
                                />
                                <div
                                    style={{
                                        marginTop: 6,
                                        height: 5,
                                        borderRadius: 3,
                                        background: "rgba(255,255,255,.55)",
                                        width: "80%",
                                    }}
                                />
                                <div
                                    style={{
                                        marginTop: 5,
                                        height: 5,
                                        borderRadius: 3,
                                        background: "rgba(255,255,255,.3)",
                                        width: "55%",
                                    }}
                                />
                            </div>

                            <div
                                className="dwa-card"
                                style={
                                    {
                                        "--r": "6deg",
                                        animationDelay: "1.2s",
                                        position: "absolute",
                                        top: isMobile ? 34 : 66,
                                        left: isMobile ? 26 : 46,
                                        width: isMobile ? 90 : 140,
                                        borderRadius: 12,
                                        background: "rgba(255,255,255,.95)",
                                        padding: isMobile ? "8px 10px" : "12px 14px",
                                        transform: "rotate(6deg)",
                                        boxShadow: "0 18px 34px rgba(20,22,60,.45)",
                                    } as React.CSSProperties
                                }
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div
                                        style={{
                                            width: isMobile ? 16 : 20,
                                            height: isMobile ? 16 : 20,
                                            borderRadius: "50%",
                                            background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                        }}
                                    />
                                    <div
                                        style={{
                                            height: 5,
                                            borderRadius: 3,
                                            background: "#C7D9F0",
                                            flex: 1,
                                        }}
                                    />
                                </div>
                                <div
                                    style={{
                                        marginTop: 8,
                                        height: 4,
                                        borderRadius: 3,
                                        background: "#EAF3FC",
                                        width: "100%",
                                    }}
                                />
                                <div
                                    style={{
                                        marginTop: 5,
                                        height: 4,
                                        borderRadius: 3,
                                        background: "#EAF3FC",
                                        width: "70%",
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div style={{ position: "relative", zIndex: 1 }}>
                        <div
                            className="dwa-pulse"
                            style={{
                                width: isCompact ? 40 : 46,
                                height: isCompact ? 40 : 46,
                                borderRadius: "50%",
                                background: "rgba(255,255,255,.18)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: 14,
                                backdropFilter: "blur(10px)",
                                border: "1px solid rgba(255,255,255,.3)",
                                animation: "dwaPulse 2.6s ease-out infinite",
                            }}
                        >
                            <i
                                className="ti ti-layout-dashboard"
                                style={{ fontSize: isCompact ? 20 : 26, color: "#fff" }}
                            />
                        </div>

                        <h1
                            style={{
                                margin: 0,
                                fontSize: isCompact ? 19 : isMobile ? 22 : 26,
                                fontWeight: 800,
                                lineHeight: 1.2,
                                letterSpacing: "-0.01em",
                            }}
                        >
                            Daily Work
                            <br />
                            Allocation
                        </h1>

                        {!isCompact && (
                            <p
                                style={{
                                    marginTop: 8,
                                    color: "rgba(255,255,255,.85)",
                                    lineHeight: 1.5,
                                    fontSize: isMobile ? 14 : 15,
                                    maxWidth: 340,
                                }}
                            >
                                Welcome back to the allocation portal. Manage reports, users, tasks
                                and daily work efficiently using one centralized dashboard.
                            </p>
                        )}

                        {!isMobile && (
                            <div
                                style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}
                            >
                                {FEATURES.map((f) => (
                                    <div
                                        key={f.label}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "6px 12px",
                                            borderRadius: 999,
                                            background: "rgba(255,255,255,.12)",
                                            border: "1px solid rgba(255,255,255,.25)",
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}
                                    >
                                        <i className={`ti ${f.icon}`} style={{ fontSize: 13 }} />
                                        {f.label}
                                    </div>
                                ))}
                            </div>
                        )}

                        {!isCompact && (
                            <div
                                style={{ marginTop: isMobile ? 12 : 18, display: "flex", gap: 10 }}
                            >
                                <div
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: "50%",
                                        background: "#fff",
                                    }}
                                />
                                <div
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: "50%",
                                        background: "rgba(255,255,255,.5)",
                                    }}
                                />
                                <div
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: "50%",
                                        background: "rgba(255,255,255,.3)",
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT — form panel */}
                <div
                    style={{
                        flex: 1,
                        width: "100%",
                        padding: isCompact ? "28px 20px 40px" : isMobile ? "28px 20px" : "48px",
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        overflowY: "auto",
                    }}
                >
                    {view === "sent" ? (
                        <>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    margin: "0 auto 12px",
                                    boxShadow: "0 8px 20px rgba(42,47,143,.28)",
                                }}
                            >
                                <i
                                    className="ti ti-check"
                                    style={{ color: "#fff", fontSize: 18 }}
                                />
                            </div>

                            <h2
                                style={{
                                    margin: 0,
                                    textAlign: "center",
                                    color: "#17181C",
                                    fontSize: 16,
                                    fontWeight: 700,
                                }}
                            >
                                Check your email
                            </h2>

                            <p
                                style={{
                                    marginTop: 4,
                                    marginBottom: 10,
                                    textAlign: "center",
                                    color: "#767F92",
                                    fontSize: 12.5,
                                    lineHeight: 1.5,
                                }}
                            >
                                If an account exists for{" "}
                                <strong style={{ color: "#17181C" }}>{username}</strong>, a reset
                                link is on its way. It may take a minute to arrive.
                            </p>

                            <button
                                type="button"
                                onClick={() => setView("login")}
                                style={{
                                    marginTop: 6,
                                    textAlign: "center",
                                    color: "#2A2F8F",
                                    fontWeight: 700,
                                    fontSize: 12.5,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    display: "block",
                                    width: "100%",
                                }}
                            >
                                ← Back to Login
                            </button>
                        </>
                    ) : view === "forgot" ? (
                        <>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    margin: "0 auto 12px",
                                    boxShadow: "0 8px 20px rgba(42,47,143,.28)",
                                }}
                            >
                                <i className="ti ti-lock" style={{ color: "#fff", fontSize: 18 }} />
                            </div>

                            <h2
                                style={{
                                    margin: 0,
                                    textAlign: "center",
                                    color: "#17181C",
                                    fontSize: 16,
                                    fontWeight: 700,
                                }}
                            >
                                Reset Password
                            </h2>

                            <p
                                style={{
                                    marginTop: 4,
                                    marginBottom: 10,
                                    textAlign: "center",
                                    color: "#767F92",
                                    fontSize: 12.5,
                                }}
                            >
                                We'll send a reset link to the email below.
                            </p>

                            <label
                                style={{
                                    display: "block",
                                    marginBottom: 4,
                                    color: "#3D4459",
                                    fontWeight: 600,
                                    fontSize: 11.5,
                                }}
                            >
                                Email Address
                            </label>

                            <input
                                type="email"
                                value={username}
                                disabled
                                readOnly
                                style={{
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "1px solid #C7D9F0",
                                    borderRadius: 12,
                                    background: "#EDF3FB",
                                    color: "#2A2F8F",
                                    outline: "none",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    marginBottom: 12,
                                    boxSizing: "border-box",
                                    cursor: "not-allowed",
                                }}
                            />

                            {error && (
                                <div
                                    style={{
                                        background: "#EEF4FB",
                                        border: "1px solid #C7D9F0",
                                        color: "#2A2F8F",
                                        padding: "8px 12px",
                                        borderRadius: 10,
                                        marginBottom: 12,
                                        fontSize: 12.5,
                                        fontWeight: 600,
                                    }}
                                >
                                    {error}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={handleSendResetLink}
                                disabled={resetSending}
                                style={{
                                    width: "100%",
                                    padding: "9px",
                                    border: "none",
                                    borderRadius: 10,
                                    cursor: resetSending ? "default" : "pointer",
                                    color: "#fff",
                                    fontWeight: 700,
                                    fontSize: 13.5,
                                    background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                    boxShadow: "0 10px 24px rgba(42,47,143,.28)",
                                    marginBottom: 22,
                                }}
                            >
                                {resetSending ? "Sending..." : "Send Reset Link"}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setError("");
                                    setView("login");
                                }}
                                style={{
                                    textAlign: "center",
                                    color: "#2A2F8F",
                                    fontWeight: 700,
                                    fontSize: 12.5,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    display: "block",
                                    width: "100%",
                                }}
                            >
                                ← Back to Login
                            </button>
                        </>
                    ) : (
                        <>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    margin: "0 auto 12px",
                                    boxShadow: "0 8px 20px rgba(42,47,143,.28)",
                                }}
                            >
                                <i
                                    className="ti ti-shield-lock"
                                    style={{ color: "#fff", fontSize: 18 }}
                                />
                            </div>

                            <h2
                                style={{
                                    margin: 0,
                                    textAlign: "center",
                                    color: "#17181C",
                                    fontSize: 16,
                                    fontWeight: 700,
                                }}
                            >
                                Welcome Back
                            </h2>

                            <p
                                style={{
                                    marginTop: 4,
                                    marginBottom: 10,
                                    textAlign: "center",
                                    color: "#767F92",
                                    fontSize: 12.5,
                                }}
                            >
                                Sign in to continue to your dashboard
                            </p>

                            {error && (
                                <div
                                    style={{
                                        background: "#EEF4FB",
                                        border: "1px solid #C7D9F0",
                                        color: "#2A2F8F",
                                        padding: "8px 12px",
                                        borderRadius: 10,
                                        marginBottom: 12,
                                        fontSize: 12.5,
                                        fontWeight: 600,
                                    }}
                                >
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleLogin}>
                                <label
                                    style={{
                                        display: "block",
                                        marginBottom: 4,
                                        color: "#3D4459",
                                        fontWeight: 600,
                                        fontSize: 11.5,
                                        width: "100%",
                                        maxWidth: 380,
                                        margin: "0 auto",
                                    }}
                                >
                                    Email Address
                                </label>

                                <input
                                    type="email"
                                    placeholder="Enter your email"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    style={{
                                        width: "100%",
                                        padding: isMobile ? "14px 16px" : "12px 14px",
                                        border: "1px solid #C7D9F0",
                                        borderRadius: 12,
                                        background: "#F4F8FD",
                                        outline: "none",
                                        fontSize: isMobile ? 16 : 13,
                                        marginBottom: 10,
                                        boxSizing: "border-box",
                                    }}
                                />

                                <label
                                    style={{
                                        display: "block",
                                        marginBottom: 4,
                                        color: "#3D4459",
                                        fontWeight: 600,
                                        fontSize: 11.5,
                                    }}
                                >
                                    Password
                                </label>

                                <div style={{ position: "relative", marginBottom: 10 }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Enter your password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        style={{
                                            width: "100%",
                                            padding: isMobile
                                                ? "14px 44px 14px 16px"
                                                : "8px 40px 8px 12px",
                                            border: "1px solid #C7D9F0",
                                            borderRadius: 12,
                                            background: "#F4F8FD",
                                            outline: "none",
                                            fontSize: isMobile ? 16 : 13,
                                            boxSizing: "border-box",
                                        }}
                                    />

                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        aria-label={
                                            showPassword ? "Hide password" : "Show password"
                                        }
                                        style={{
                                            position: "absolute",
                                            right: 12,
                                            top: "50%",
                                            transform: "translateY(-50%)",
                                            border: "none",
                                            background: "transparent",
                                            cursor: "pointer",
                                            color: "#2A2F8F",
                                            fontSize: 16,
                                        }}
                                    >
                                        <i
                                            className={showPassword ? "ti ti-eye-off" : "ti ti-eye"}
                                        />
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        width: "100%",
                                        padding: isMobile ? "13px" : "9px",
                                        border: "none",
                                        borderRadius: 10,
                                        cursor: loading ? "default" : "pointer",
                                        color: "#fff",
                                        fontWeight: 700,
                                        fontSize: 13.5,
                                        background: "linear-gradient(135deg,#2BAADD,#2A2F8F)",
                                        boxShadow: "0 10px 24px rgba(42,47,143,.28)",
                                    }}
                                >
                                    {loading ? "Signing In..." : "Sign In"}
                                </button>
                            </form>

                            <button
                                type="button"
                                onClick={handleForgotPasswordClick}
                                style={{
                                    marginTop: 8,
                                    textAlign: "center",
                                    color: "#2A2F8F",
                                    fontWeight: 700,
                                    fontSize: 12.5,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    display: "block",
                                    width: "100%",
                                }}
                            >
                                Reset Password?
                            </button>

                            <p
                                style={{
                                    marginTop: 8,
                                    textAlign: "center",
                                    color: "#9CA3AF",
                                    fontSize: 10.5,
                                }}
                            >
                                © 2026 Daily Work Allocation System
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Login;
