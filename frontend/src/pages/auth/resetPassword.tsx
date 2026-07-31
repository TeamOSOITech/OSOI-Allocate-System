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
    const [verifyError, setVerifyError] = useState("");

    useEffect(() => {
        let settled = false;

        const markReady = () => {
            if (!settled) {
                settled = true;
                setReady(true);
            }
        };

        // Case 1: implicit flow — Supabase parses #access_token=...&type=recovery
        // from the URL automatically and fires this event.
        const { data: listener } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") {
                markReady();
            }
        });

        // Case 2: PKCE flow — the link redirects with ?code=... instead of a
        // hash, and there's no automatic PASSWORD_RECOVERY event. We have to
        // manually exchange the code for a session.
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
            supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
                if (error) {
                    console.error("exchangeCodeForSession failed:", error);
                    if (!settled) {
                        settled = true;
                        setVerifyError(
                            "This reset link is invalid or has expired. Please request a new one."
                        );
                    }
                } else {
                    markReady();
                }
            });
        }

        // Case 3: session might already exist by the time this effect runs
        // (detectSessionInUrl can resolve before the listener attaches).
        supabase.auth.getSession().then(({ data }) => {
            if (data?.session) {
                markReady();
            }
        });

        // Fallback: if nothing happened within 8s, stop showing an infinite
        // "Verifying..." state and tell the user instead of hanging forever.
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                setVerifyError(
                    "This reset link is invalid or has expired. Please request a new one."
                );
            }
        }, 8000);

        return () => {
            listener.subscription.unsubscribe();
            clearTimeout(timeout);
        };
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
                background: "#eef6fb",
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
                    boxShadow: "0 20px 60px rgba(32,66,151,0.15)",
                }}
            >
                <div
                    style={{
                        width: 60,
                        height: 60,
                        background: "linear-gradient(135deg, #08A1CE, #204297)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 20px",
                        boxShadow: "0 8px 20px rgba(32,66,151,0.35)",
                    }}
                >
                    <i className="ti ti-key" style={{ fontSize: 26, color: "#fff" }} />
                </div>

                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1e2a4a", marginBottom: 6 }}>
                    Set New Password
                </h1>

                {success ? (
                    <div
                        style={{
                            background: "#eafaf7",
                            border: "1px solid #b7ece2",
                            color: "#1f8f7d",
                            padding: 14,
                            borderRadius: 8,
                            fontSize: 13,
                        }}
                    >
                        ✓ Password updated! Redirecting to login...
                    </div>
                ) : verifyError ? (
                    <div
                        style={{
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            color: "#dc2626",
                            padding: 14,
                            borderRadius: 8,
                            fontSize: 13,
                        }}
                    >
                        ⚠️ {verifyError}
                    </div>
                ) : !ready ? (
                    <p style={{ color: "#8a93a8", fontSize: 13 }}>Verifying your reset link...</p>
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
                                    color: "#374361",
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
                                    background: "#fafbfc",
                                    border: "1px solid #dde6f0",
                                    borderRadius: 8,
                                    fontSize: 14,
                                    outline: "none",
                                    boxSizing: "border-box",
                                    color: "#1e2a4a",
                                }}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: "100%",
                                padding: 14,
                                background: "linear-gradient(135deg, #08A1CE, #204297)",
                                color: "#fff",
                                border: "none",
                                borderRadius: 24,
                                fontSize: 15,
                                fontWeight: 700,
                                cursor: loading ? "not-allowed" : "pointer",
                                boxShadow: "0 6px 16px rgba(32,66,151,0.3)",
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
