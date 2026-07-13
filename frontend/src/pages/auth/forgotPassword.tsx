import { useState } from "react";
import { Link } from "react-router-dom";

const ForgotPassword = () => {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const API_URL = import.meta.env.VITE_API_URL;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || "Something went wrong");
            setSent(true);
        } catch (err: any) {
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            style={{
                minHeight: "100vh",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                background: "#f5f3ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
            }}
        >
            <div
                style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "40px 32px",
                    width: "100%",
                    maxWidth: 400,
                    textAlign: "center",
                    boxShadow: "0 20px 60px rgba(109,40,217,0.15)",
                }}
            >
                <div
                    style={{
                        width: 60,
                        height: 60,
                        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 20px",
                        boxShadow: "0 8px 20px rgba(124,58,237,0.35)",
                    }}
                >
                    <i className="ti ti-lock" style={{ fontSize: 26, color: "#fff" }} />
                </div>

                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1e1b3a", marginBottom: 6 }}>
                    Forgot Password?
                </h1>
                <p style={{ color: "#9c96b8", marginBottom: 24, fontSize: 13 }}>
                    Enter your email and we'll send you a reset link. If you have multiple role
                    accounts under this email, you'll receive one link per role.
                </p>

                {sent ? (
                    <div
                        style={{
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            color: "#15803d",
                            padding: 14,
                            borderRadius: 8,
                            fontSize: 13,
                            textAlign: "left",
                        }}
                    >
                        ✓ If an account exists for this email, a reset link has been sent. Please
                        check your inbox.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {error && (
                            <div
                                style={{
                                    background: "#fef2f2",
                                    border: "1px solid #fecaca",
                                    color: "#dc2626",
                                    padding: 10,
                                    borderRadius: 8,
                                    fontSize: 13,
                                    marginBottom: 16,
                                    textAlign: "left",
                                }}
                            >
                                ⚠️ {error}
                            </div>
                        )}
                        <div style={{ textAlign: "left", marginBottom: 24 }}>
                            <label
                                style={{
                                    display: "block",
                                    marginBottom: 6,
                                    color: "#4b4560",
                                    fontSize: 12,
                                    fontWeight: 600,
                                }}
                            >
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="e.g. john.doe@email.com"
                                style={{
                                    width: "100%",
                                    padding: "12px 14px",
                                    background: "#fafafa",
                                    border: "1px solid #ececf5",
                                    borderRadius: 8,
                                    fontSize: 14,
                                    outline: "none",
                                    boxSizing: "border-box",
                                    color: "#1e1b3a",
                                }}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: "100%",
                                padding: 14,
                                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                                color: "#fff",
                                border: "none",
                                borderRadius: 24,
                                fontSize: 15,
                                fontWeight: 700,
                                cursor: loading ? "not-allowed" : "pointer",
                                boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
                            }}
                        >
                            {loading ? "Sending..." : "Send Reset Link"}
                        </button>
                    </form>
                )}

                <Link
                    to="/login"
                    style={{
                        display: "block",
                        marginTop: 20,
                        fontSize: 13,
                        color: "#6d28d9",
                        textDecoration: "none",
                        fontWeight: 600,
                    }}
                >
                    ← Back to Login
                </Link>
            </div>
        </div>
    );
};

export default ForgotPassword;
