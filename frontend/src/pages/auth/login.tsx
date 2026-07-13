import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

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

const Login = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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
            localStorage.setItem("user", JSON.stringify(data.data.user));

            const userRole = data.data.user.role;

            switch (userRole) {
                case "ADMIN":
                    window.location.href = "/dashboard";
                    break;

                case "MANAGER":
                    window.location.href = "/workinprogress";
                    break;

                case "EMPLOYEE":
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

    return (
        <>
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg,#F5F3FF 0%,#EEE7FF 45%,#E6DBFF 100%)",
                    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                {/* Background Blur Circle */}
                <div
                    style={{
                        position: "absolute",
                        width: 450,
                        height: 450,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#8B5CF6,#6D28D9)",
                        opacity: 0.12,
                        top: -120,
                        left: -120,
                        filter: "blur(30px)",
                    }}
                />

                <div
                    style={{
                        position: "absolute",
                        width: 350,
                        height: 350,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#A78BFA,#7C3AED)",
                        opacity: 0.1,
                        bottom: -80,
                        right: -80,
                        filter: "blur(25px)",
                    }}
                />

                {/* Main Card */}
                <div
                    style={{
                        width: "100%",
                        maxWidth: 1080,
                        minHeight: 620,
                        background: "#fff",
                        borderRadius: 30,
                        overflow: "hidden",
                        display: "flex",
                        boxShadow: "0 25px 60px rgba(124,58,237,.15)",
                        position: "relative",
                        zIndex: 2,
                    }}
                >
                    {/* LEFT SIDE */}
                    <div
                        style={{
                            flex: 1,
                            background: "linear-gradient(135deg,#8B5CF6,#6D28D9)",
                            color: "#fff",
                            padding: 60,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            position: "relative",
                        }}
                    >
                        <div
                            style={{
                                width: 85,
                                height: 85,
                                borderRadius: "50%",
                                background: "rgba(255,255,255,.15)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: 30,
                                backdropFilter: "blur(10px)",
                            }}
                        >
                            <i
                                className="ti ti-layout-dashboard"
                                style={{
                                    fontSize: 42,
                                    color: "#fff",
                                }}
                            />
                        </div>

                        <h1
                            style={{
                                margin: 0,
                                fontSize: 42,
                                fontWeight: 800,
                                lineHeight: 1.2,
                            }}
                        >
                            Daily Work
                            <br />
                            Allocation
                        </h1>

                        <p
                            style={{
                                marginTop: 20,
                                color: "rgba(255,255,255,.85)",
                                lineHeight: 1.8,
                                fontSize: 16,
                                maxWidth: 420,
                            }}
                        >
                            Welcome back to the allocation portal. Manage reports, users, tasks and
                            daily work efficiently using one centralized dashboard.
                        </p>

                        <div
                            style={{
                                marginTop: 40,
                                display: "flex",
                                gap: 15,
                            }}
                        >
                            <div
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: "50%",
                                    background: "#fff",
                                }}
                            />
                            <div
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: "50%",
                                    background: "rgba(255,255,255,.5)",
                                }}
                            />
                            <div
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: "50%",
                                    background: "rgba(255,255,255,.3)",
                                }}
                            />
                        </div>
                    </div>

                    {/* RIGHT SIDE */}
                    <div
                        style={{
                            width: 430,
                            padding: "60px 50px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                        }}
                    >
                        <div
                            style={{
                                width: 72,
                                height: 72,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg,#8B5CF6,#6D28D9)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                margin: "0 auto 20px",
                                boxShadow: "0 12px 30px rgba(124,58,237,.30)",
                            }}
                        >
                            <i
                                className="ti ti-shield-lock"
                                style={{
                                    color: "#fff",
                                    fontSize: 34,
                                }}
                            />
                        </div>

                        <h2
                            style={{
                                margin: 0,
                                textAlign: "center",
                                color: "#1E1B3A",
                                fontSize: 30,
                                fontWeight: 800,
                            }}
                        >
                            Welcome Back
                        </h2>

                        <p
                            style={{
                                marginTop: 10,
                                marginBottom: 35,
                                textAlign: "center",
                                color: "#8B82A7",
                                fontSize: 15,
                            }}
                        >
                            Sign in to continue to your dashboard
                        </p>

                        {error && (
                            <div
                                style={{
                                    background: "#F8F5FF",
                                    border: "1px solid #DDD6FE",
                                    color: "#6D28D9",
                                    padding: "12px 16px",
                                    borderRadius: 12,
                                    marginBottom: 22,
                                    fontSize: 14,
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
                                    marginBottom: 8,
                                    color: "#4B4560",
                                    fontWeight: 600,
                                    fontSize: 13,
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
                                    padding: "14px 16px",
                                    border: "1px solid #DDD6FE",
                                    borderRadius: 12,
                                    background: "#FAF8FF",
                                    outline: "none",
                                    fontSize: 14,
                                    marginBottom: 20,
                                    boxSizing: "border-box",
                                }}
                            />

                            <label
                                style={{
                                    display: "block",
                                    marginBottom: 8,
                                    color: "#4B4560",
                                    fontWeight: 600,
                                    fontSize: 13,
                                }}
                            >
                                Password
                            </label>

                            <div
                                style={{
                                    position: "relative",
                                    marginBottom: 28,
                                }}
                            >
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    style={{
                                        width: "100%",
                                        padding: "14px 50px 14px 16px",
                                        border: "1px solid #DDD6FE",
                                        borderRadius: 12,
                                        background: "#FAF8FF",
                                        outline: "none",
                                        fontSize: 14,
                                        boxSizing: "border-box",
                                    }}
                                />

                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: "absolute",
                                        right: 14,
                                        top: "50%",
                                        transform: "translateY(-50%)",
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        color: "#6D28D9",
                                        fontSize: 18,
                                    }}
                                >
                                    <i className={showPassword ? "ti ti-eye-off" : "ti ti-eye"} />
                                </button>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    width: "100%",
                                    padding: "15px",
                                    border: "none",
                                    borderRadius: 14,
                                    cursor: "pointer",
                                    color: "#fff",
                                    fontWeight: 700,
                                    fontSize: 15,
                                    background: "linear-gradient(135deg,#8B5CF6,#6D28D9)",
                                    boxShadow: "0 10px 24px rgba(124,58,237,.28)",
                                }}
                            >
                                {loading ? "Signing In..." : "Sign In"}
                            </button>
                        </form>

                        <Link
                            to="/forgot-password"
                            style={{
                                marginTop: 22,
                                textAlign: "center",
                                textDecoration: "none",
                                color: "#6D28D9",
                                fontWeight: 700,
                                fontSize: 14,
                            }}
                        >
                            Forgot Password?
                        </Link>

                        <p
                            style={{
                                marginTop: 40,
                                textAlign: "center",
                                color: "#9CA3AF",
                                fontSize: 12,
                            }}
                        >
                            © 2026 Daily Work Allocation System
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Login;
