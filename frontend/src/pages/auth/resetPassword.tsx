import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../config/supabaseClient";

const ResetPassword = () => {
    const navigate = useNavigate();
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        // Supabase automatically parses the recovery token from the URL
        // and fires this event once the recovery session is established.
        const { data: listener } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") {
                setReady(true);
            }
        });
        return () => listener.subscription.unsubscribe();
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            setError(error.message);
        } else {
            setSuccess(true);
            setTimeout(() => navigate("/login"), 2500);
        }
        setLoading(false);
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
                    <i className="ti ti-key" style={{ fontSize: 26, color: "#fff" }} />
                </div>

                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1e1b3a", marginBottom: 6 }}>
                    Set New Password
                </h1>

                {success ? (
                    <div
                        style={{
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            color: "#15803d",
                            padding: 14,
                            borderRadius: 8,
                            fontSize: 13,
                        }}
                    >
                        ✓ Password updated! Redirecting to login...
                    </div>
                ) : !ready ? (
                    <p style={{ color: "#9c96b8", fontSize: 13 }}>Verifying your reset link...</p>
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
                                New Password
                            </label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter new password"
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
                            {loading ? "Updating..." : "Update Password"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ResetPassword;
