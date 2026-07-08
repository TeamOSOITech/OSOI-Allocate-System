import { useState } from "react";

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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: username, password }),
            });

            const data = await res.json();
            console.log("LOGIN RESPONSE:", data);

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Login failed");
            }

            // Save token and user to localStorage
            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

             // Get role from backend
        const userRole = data.data.user.role;

        console.log("User Role:", userRole);

            // Role-based navigation — role comes from the backend response,
            // not from anything the user picked on screen.
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
        <div style={{
            minHeight: "100vh",
            fontFamily: "sans-serif",
            position: "relative",
            overflowX: "hidden",
        }}>

            {/* Background image with dark overlay */}
            <div style={{
                position: "fixed",
                inset: 0,
                backgroundImage: `url('https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                zIndex: 0,
                pointerEvents: "none",
            }} />

            {/* Dark red overlay */}
            <div style={{
                position: "fixed",
                inset: 0,
                background: "linear-gradient(135deg, rgba(127,29,29,0.85) 0%, rgba(153,27,27,0.75) 40%, rgba(31,41,55,0.85) 100%)",
                zIndex: 1,
                pointerEvents: "none",
            }} />

            {/* Content Container */}
            <div style={{
                position: "relative",
                zIndex: 2,
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
                boxSizing: "border-box"
            }}>

                <div style={{
                    background: "rgba(240,240,240,0.96)",
                    borderRadius: "20px",
                    padding: "40px 24px",
                    width: "100%",
                    maxWidth: "400px",
                    textAlign: "center",
                    boxSizing: "border-box",
                    animation: "fadeIn 0.4s ease",
                }}>

                    {/* Icon */}
                    <div style={{
                        width: "70px",
                        height: "70px",
                        background: "#be123c",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "32px",
                        margin: "0 auto 16px",
                    }}>
                        🔐
                    </div>

                    <h1 style={{
                        fontSize: "22px",
                        fontWeight: "700",
                        color: "#111",
                        marginBottom: "6px",
                    }}>
                        Daily Work Allocation Task
                    </h1>
                    <p style={{ color: "#888", marginBottom: "26px", fontSize: "13px" }}>
                        Sign in to continue
                    </p>

                    {error && (
                        <div style={{
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            color: "#dc2626",
                            padding: "10px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            marginBottom: "16px",
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin}>
                        {/* Username */}
                        <input
                            type="text"
                            placeholder="User Name"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            style={{
                                width: "100%",
                                padding: "14px 16px",
                                border: "2px solid #e5e7eb",
                                borderRadius: "10px",
                                fontSize: "14px",
                                marginBottom: "16px",
                                outline: "none",
                                boxSizing: "border-box",
                                background: "#fff",
                                color: "#111",
                            }}
                        />

                        {/* Password */}
                        <div style={{ position: "relative", marginBottom: "24px" }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="Password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                style={{
                                    width: "100%",
                                    padding: "14px 46px 14px 16px",
                                    border: "2px solid #e5e7eb",
                                    borderRadius: "10px",
                                    fontSize: "14px",
                                    outline: "none",
                                    boxSizing: "border-box",
                                    background: "#fff",
                                }}
                            />
                            <span
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: "absolute",
                                    right: "14px",
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    cursor: "pointer",
                                    fontSize: "18px",
                                    color: "#6b21a8",
                                    userSelect: "none",
                                }}
                            >
                                {showPassword ? "🙈" : "👁️"}
                            </span>
                        </div>

                        {/* Login button */}
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: "100%",
                                padding: "14px",
                                background: loading ? "#f43f6e" : "#be123c",
                                color: "#fff",
                                border: "none",
                                borderRadius: "10px",
                                fontSize: "16px",
                                fontWeight: "600",
                                cursor: loading ? "not-allowed" : "pointer",
                                transition: "background 0.2s ease",
                            }}
                        >
                            {loading ? "Logging in..." : "Log in"}
                        </button>
                    </form>
                </div>
            </div>

            {/* CSS animations */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};

export default Login;