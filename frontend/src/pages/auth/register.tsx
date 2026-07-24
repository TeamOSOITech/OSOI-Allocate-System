import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// Landed on from the Razorpay checkout flow in Landing.tsx:
// /register?token=<signup_token>
//
// Reuses the same lp- class names as Landing.tsx (nav, gradient, card
// styles) so it feels like one flow rather than two different designs.

const Register = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token") || "";
    const API_URL = import.meta.env.VITE_API_URL;

    const [checking, setChecking] = useState(true);
    const [tokenValid, setTokenValid] = useState(false);
    const [email, setEmail] = useState("");
    const [plan, setPlan] = useState("");

    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    // Confirm the token is real, unused, and not expired before
    // showing the account-creation form.
    useEffect(() => {
        const checkToken = async () => {
            if (!token) {
                setChecking(false);
                return;
            }
            try {
                const res = await fetch(`${API_URL}/api/billing/signup-status?token=${token}`);
                const data = await res.json();
                if (res.ok && data.success) {
                    setTokenValid(true);
                    setEmail(data.data.email);
                    setPlan(data.data.plan);
                } else {
                    setError(data.message || "Invalid or expired signup link.");
                }
            } catch {
                setError("Could not verify your signup link. Please try again.");
            } finally {
                setChecking(false);
            }
        };
        checkToken();
    }, [token, API_URL]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/register-with-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Could not create your account.");
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            // Same role-redirect logic as Landing.tsx / pages/auth/login.tsx
            switch (data.data.user.role) {
                case "SUPER_ADMIN":
                case "OPS_MANAGER":
                case "AUDIT_MANAGER":
                case "PROCESS_LEAD":
                    navigate("/dashboard");
                    break;
                case "VERTICAL_HEAD":
                    navigate("/workinprogress");
                    break;
                case "TEAM_MEMBER":
                    navigate("/report");
                    break;
                default:
                    navigate("/login");
            }
        } catch (err: any) {
            setError(err.message || "Could not create your account.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="reg-page">
            <style>{`
                .reg-page {
                    --lp-blue: #204297;
                    --lp-cyan: #08A1CE;
                    --lp-green: #2EBBA8;
                    --lp-gradient: linear-gradient(135deg, #204297 0%, #08A1CE 55%, #2EBBA8 100%);
                    --lp-text: #101828;
                    --lp-muted: #5B6B85;
                    --lp-border: #E3E9F3;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #EAF7FB 0%, #EDF9F6 100%);
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    padding: 20px;
                }
                .reg-card {
                    width: 100%;
                    max-width: 440px;
                    background: #fff;
                    border-radius: 18px;
                    padding: clamp(24px, 4vw, 34px);
                    box-shadow: 0 16px 46px rgba(15,30,70,0.1);
                }
                .reg-plan-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #fff;
                    background: var(--lp-gradient);
                    padding: 5px 12px;
                    border-radius: 999px;
                    margin-bottom: 14px;
                    text-transform: capitalize;
                }
                .reg-title { font-size: 20px; font-weight: 800; margin: 0 0 6px; color: var(--lp-text); }
                .reg-subtitle { font-size: 13.5px; color: var(--lp-muted); margin-bottom: 20px; }
                .reg-error { background: #FEF2F2; color: #DC2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
                .reg-input {
                    border: 1px solid #CBD5E1;
                    border-radius: 9px;
                    padding: 12px 14px;
                    font-size: 14px;
                    outline: none;
                    font-family: inherit;
                    width: 100%;
                    box-sizing: border-box;
                    margin-bottom: 12px;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                }
                .reg-input:focus { border-color: var(--lp-cyan); box-shadow: 0 0 0 3px rgba(8,161,206,0.15); }
                .reg-input:disabled { background: #F1F5F9; color: var(--lp-muted); }
                .reg-submit {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 9px;
                    padding: 13px 0;
                    font-weight: 700;
                    cursor: pointer;
                    font-size: 14.5px;
                    width: 100%;
                    font-family: inherit;
                }
                .reg-submit:disabled { opacity: 0.7; cursor: not-allowed; }
                .reg-center { text-align: center; color: var(--lp-muted); font-size: 14px; }
            `}</style>

            <div className="reg-card">
                {checking ? (
                    <p className="reg-center">Verifying your payment…</p>
                ) : !tokenValid ? (
                    <>
                        <h2 className="reg-title">Link Invalid</h2>
                        <p className="reg-subtitle">
                            {error || "This signup link is invalid or has expired."} If you already
                            paid, check your email for the correct link or contact support.
                        </p>
                        <button className="reg-submit" onClick={() => navigate("/")}>
                            Back to Home
                        </button>
                    </>
                ) : (
                    <>
                        <span className="reg-plan-pill">{plan} Plan</span>
                        <h2 className="reg-title">Create Your Account</h2>
                        <p className="reg-subtitle">
                            Payment confirmed for {email}. Set up your login to get started.
                        </p>

                        {error && <div className="reg-error">{error}</div>}

                        <form onSubmit={handleSubmit}>
                            <input className="reg-input" type="email" value={email} disabled />
                            <input
                                className="reg-input"
                                type="text"
                                placeholder="Your full name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                            <input
                                className="reg-input"
                                type="password"
                                placeholder="Create a password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <input
                                className="reg-input"
                                type="password"
                                placeholder="Confirm password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                            <button className="reg-submit" type="submit" disabled={submitting}>
                                {submitting ? "Creating account…" : "Create Account"}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

export default Register;
