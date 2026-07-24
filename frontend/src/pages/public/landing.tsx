import { useState } from "react";
import { useNavigate } from "react-router-dom";

// Public marketing/landing page — this is now what "/" shows before
// login, per the reference design. The "Existing User? Login Here"
// panel at the bottom is a REAL, working login form (calls the same
// /api/auth/login endpoint and role-redirect logic as pages/auth/login.tsx),
// not a mockup — so returning users never have to click through to a
// separate page first.

const FEATURES = [
    {
        icon: "ti-adjustments",
        title: "Optimize Resources",
        desc: "Allocate the right people to the right projects based on skills, availability, and workload.",
    },
    {
        icon: "ti-trending-up",
        title: "Increase Productivity",
        desc: "Reduce idle time and improve team productivity with intelligent allocation.",
    },
    {
        icon: "ti-shield-check",
        title: "Secure & Compliant",
        desc: "Enterprise-grade security to keep your data safe, always.",
    },
    {
        icon: "ti-plug",
        title: "Easy Integration",
        desc: "Seamlessly integrate with your existing tools and workflows for a smooth experience.",
    },
];

const PLANS = [
    {
        name: "Free",
        price: "₹0",
        period: "/ user / month",
        desc: "Ideal for small teams just getting started.",
        features: ["Up to 5 Users", "Basic Allocation", "Project Tracking", "Standard Reports"],
        cta: "Get Started",
        highlighted: false,
    },
    {
        name: "Basic",
        price: "₹149",
        period: "/ user / month",
        desc: "Perfect for growing teams and small businesses.",
        features: ["Up to 25 Users", "Advanced Allocation", "Team Management", "Custom Reports"],
        cta: "Choose Plan",
        highlighted: false,
    },
    {
        name: "Professional",
        price: "₹199",
        period: "/ user / month",
        desc: "Advanced features for scaling teams and complex projects.",
        features: [
            "Up to 100 Users",
            "AI-powered Suggestions",
            "Advanced Reports",
            "Priority Support",
        ],
        cta: "Choose Plan",
        highlighted: true,
        badge: "Most Popular",
    },
    {
        name: "Enterprise",
        price: "Custom Pricing",
        period: "",
        desc: "Custom solutions for large organizations with unique needs.",
        features: ["Unlimited Users", "Custom Features", "Dedicated Support", "SLA & Onboarding"],
        cta: "Contact Sales",
        highlighted: false,
    },
];

const Landing = () => {
    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_API_URL;

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);

    // ---------- Razorpay checkout (Basic / Professional plans) ----------
    const [checkoutPlan, setCheckoutPlan] = useState<{
        key: string;
        name: string;
        price: string;
    } | null>(null);
    const [checkoutEmail, setCheckoutEmail] = useState("");
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [checkoutError, setCheckoutError] = useState("");

    const loadRazorpayScript = () =>
        new Promise<boolean>((resolve) => {
            if ((window as any).Razorpay) return resolve(true);
            const script = document.createElement("script");
            script.src = "https://checkout.razorpay.com/v1/checkout.js";
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.body.appendChild(script);
        });

    // Free -> straight to login/signup. Enterprise -> Contact Sales.
    // Basic / Professional -> open the email-collection modal, which
    // then kicks off Razorpay Checkout.
    const handlePlanSelect = (planName: string) => {
        if (planName === "Free") {
            navigate("/login");
            return;
        }
        if (planName === "Enterprise") {
            window.location.href =
                "mailto:contact@osoitech.com?subject=Enterprise%20Plan%20Inquiry";
            return;
        }
        const plan = PLANS.find((p) => p.name === planName);
        if (!plan) return;
        setCheckoutError("");
        setCheckoutEmail("");
        setCheckoutPlan({ key: planName.toLowerCase(), name: planName, price: plan.price });
    };

    const handleConfirmCheckout = async () => {
        if (!checkoutPlan) return;
        if (!checkoutEmail || !/\S+@\S+\.\S+/.test(checkoutEmail)) {
            setCheckoutError("Enter a valid email address.");
            return;
        }
        setCheckoutError("");
        setCheckoutLoading(true);

        try {
            const scriptLoaded = await loadRazorpayScript();
            if (!scriptLoaded) {
                throw new Error("Could not load Razorpay. Check your connection and try again.");
            }

            const orderRes = await fetch(`${API_URL}/api/billing/create-order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: checkoutPlan.key }),
            });
            const orderData = await orderRes.json();
            if (!orderRes.ok || !orderData.success) {
                throw new Error(orderData.message || "Could not start checkout.");
            }

            const { orderId, amount, currency, keyId } = orderData.data;

            const razorpay = new (window as any).Razorpay({
                key: keyId,
                order_id: orderId,
                amount,
                currency,
                name: "Workforce Alookate",
                description: `${checkoutPlan.name} Plan Subscription`,
                prefill: { email: checkoutEmail },
                theme: { color: "#08A1CE" },
                handler: async (response: any) => {
                    try {
                        const verifyRes = await fetch(`${API_URL}/api/billing/verify-payment`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                plan: checkoutPlan.key,
                                email: checkoutEmail,
                            }),
                        });
                        const verifyData = await verifyRes.json();
                        if (!verifyRes.ok || !verifyData.success) {
                            throw new Error(verifyData.message || "Payment verification failed.");
                        }
                        setCheckoutPlan(null);
                        navigate(`/register?token=${verifyData.data.signupToken}`);
                    } catch (err: any) {
                        setCheckoutError(err.message || "Payment verification failed.");
                    } finally {
                        setCheckoutLoading(false);
                    }
                },
                modal: {
                    ondismiss: () => setCheckoutLoading(false),
                },
            });

            razorpay.open();
        } catch (err: any) {
            setCheckoutError(err.message || "Something went wrong.");
            setCheckoutLoading(false);
        }
    };

    // Same login + role-redirect logic as pages/auth/login.tsx — kept in
    // sync manually since these are two separate entry points (this
    // inline panel, and the dedicated /login page linked from the navbar).
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Login failed");
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

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
                    setError("Invalid role");
            }
        } catch (err: any) {
            setError(err.message || "Login failed.");
        } finally {
            setLoading(false);
        }
    };

    const scrollTo = (id: string) => {
        setMenuOpen(false);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    };

    return (
        <div className="lp-page">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

                .lp-page {
                    --lp-blue: #204297;
                    --lp-cyan: #08A1CE;
                    --lp-green: #2EBBA8;
                    --lp-gradient: linear-gradient(135deg, #204297 0%, #08A1CE 55%, #2EBBA8 100%);
                    --lp-ink: #0A1224;
                    --lp-ink-soft: #101B34;
                    --lp-text: #101828;
                    --lp-muted: #5B6B85;
                    --lp-bg: #F6F9FC;
                    --lp-border: #E3E9F3;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    color: var(--lp-text);
                    background: #fff;
                    overflow-x: hidden;
                }
                .lp-page h1, .lp-page h2, .lp-page h3 {
                    font-family: 'Sora', 'Inter', sans-serif;
                }
                .lp-topline {
                    height: 4px;
                    width: 100%;
                    background: var(--lp-gradient);
                    background-size: 200% 100%;
                    animation: lp-flow 6s linear infinite;
                }
                @keyframes lp-flow {
                    0% { background-position: 0% 0; }
                    100% { background-position: 200% 0; }
                }
                @keyframes lp-fade-up {
                    from { opacity: 0; transform: translateY(14px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes lp-float-particle {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(6px, -14px); }
                    100% { transform: translate(0, 0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .lp-hero-left, .lp-hero-right { animation: none !important; }
                    .lp-particle { animation: none !important; }
                }

                .lp-particle {
                    position: absolute;
                    border-radius: 50%;
                    pointer-events: none;
                    z-index: 0;
                    animation: lp-float-particle 7s ease-in-out infinite;
                }
                .lp-particle.p1 { width: 6px; height: 6px; background: var(--lp-cyan); opacity: 0.55; top: 14%; right: 30%; animation-duration: 6s; }
                .lp-particle.p2 { width: 4px; height: 4px; background: var(--lp-green); opacity: 0.5; bottom: 12%; right: 8%; animation-duration: 8s; animation-delay: 0.6s; }
                .lp-particle.p3 { width: 5px; height: 5px; background: #fff; opacity: 0.3; top: 20%; left: 4%; animation-duration: 9s; animation-delay: 1.2s; }
                .lp-particle.p4 { width: 4px; height: 4px; background: var(--lp-cyan); opacity: 0.4; bottom: 22%; left: 3%; animation-duration: 7s; animation-delay: 0.3s; }

                /* ---------- Nav ---------- */
                .lp-nav {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px clamp(20px, 5vw, 56px);
                    background: var(--lp-ink);
                    position: sticky;
                    top: 0;
                    z-index: 30;
                }
                .lp-nav-brand {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    color: #fff;
                    font-family: 'Sora', sans-serif;
                    font-weight: 700;
                    font-size: 16px;
                    white-space: nowrap;
                }
                .lp-nav-brand .lp-icon-badge {
                    width: 32px;
                    height: 32px;
                    border-radius: 9px;
                    background: var(--lp-gradient);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 15px;
                    color: #fff;
                    flex-shrink: 0;
                    box-shadow: 0 4px 14px rgba(8,161,206,0.35);
                }
                .lp-nav-links {
                    display: flex;
                    gap: 30px;
                }
                .lp-nav-link {
                    color: #B9C4DA;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 500;
                    transition: color 0.15s ease;
                }
                .lp-nav-link:hover { color: #fff; }
                .lp-nav-login-btn {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    padding: 9px 22px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 14px;
                    font-family: inherit;
                    transition: filter 0.15s ease, transform 0.15s ease;
                    flex-shrink: 0;
                }
                .lp-nav-login-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .lp-burger {
                    display: none;
                    background: none;
                    border: 1px solid #26314F;
                    border-radius: 8px;
                    width: 38px;
                    height: 38px;
                    color: #fff;
                    font-size: 18px;
                    cursor: pointer;
                    align-items: center;
                    justify-content: center;
                }
                .lp-mobile-panel {
                    display: none;
                    flex-direction: column;
                    background: var(--lp-ink-soft);
                    padding: 14px clamp(20px, 5vw, 56px) 20px;
                }
                .lp-mobile-panel a {
                    color: #DCE4F2;
                    text-decoration: none;
                    padding: 12px 0;
                    font-size: 14.5px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }

                /* ---------- Hero ---------- */
                .lp-hero {
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    gap: 48px;
                    align-items: center;
                    flex-wrap: wrap;
                    background: linear-gradient(160deg, var(--lp-ink) 0%, var(--lp-ink-soft) 55%, #142146 100%);
                    color: #fff;
                    padding: clamp(48px, 8vw, 84px) clamp(20px, 5vw, 56px);
                }
                .lp-hero-glow {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(80px);
                    pointer-events: none;
                    z-index: 0;
                }
                .lp-hero-glow.g1 { width: 440px; height: 440px; background: #08A1CE; opacity: 0.30; top: -160px; right: -100px; }
                .lp-hero-glow.g2 { width: 380px; height: 380px; background: #2EBBA8; opacity: 0.22; bottom: -160px; left: -120px; }
                .lp-hero-glow.g3 { width: 320px; height: 320px; background: #204297; opacity: 0.35; top: 35%; left: 38%; }
                .lp-hero-left { flex: 1 1 420px; min-width: 280px; position: relative; z-index: 1; animation: lp-fade-up 0.7s ease both; }
                .lp-hero-icon-badge {
                    width: 38px;
                    height: 38px;
                    border-radius: 11px;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.14);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 16px;
                }
                .lp-hero-icon-badge i { font-size: 17px; color: var(--lp-cyan); }
                .lp-eyebrow {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12.5px;
                    font-weight: 600;
                    letter-spacing: 0.04em;
                    color: #A9D9EA;
                    background: rgba(8,161,206,0.12);
                    border: 1px solid rgba(8,161,206,0.35);
                    padding: 6px 14px;
                    border-radius: 999px;
                    margin-bottom: 20px;
                }
                .lp-hero-title {
                    font-size: clamp(30px, 5.2vw, 46px);
                    font-weight: 800;
                    line-height: 1.14;
                    margin: 0 0 20px;
                    color: #fff;
                }
                .lp-hero-title span {
                    background: linear-gradient(90deg, #08A1CE, #2EBBA8);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }
                .lp-hero-subtitle {
                    font-size: clamp(14.5px, 1.6vw, 16px);
                    color: #9FB0CC;
                    line-height: 1.65;
                    max-width: 480px;
                    margin: 0 0 28px;
                }
                .lp-hero-ctas { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
                .lp-btn-primary {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 9px;
                    padding: 13px 26px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 15px;
                    font-family: inherit;
                    box-shadow: 0 10px 28px rgba(8,161,206,0.25);
                    transition: filter 0.15s ease, transform 0.15s ease;
                }
                .lp-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .lp-btn-secondary {
                    background: transparent;
                    color: #fff;
                    border: 1px solid #33415F;
                    border-radius: 9px;
                    padding: 13px 26px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 15px;
                    font-family: inherit;
                    transition: border-color 0.15s ease, background 0.15s ease;
                }
                .lp-btn-secondary:hover { border-color: #08A1CE; background: rgba(8,161,206,0.08); }
                .lp-hero-pills { display: flex; gap: 10px; flex-wrap: wrap; }
                .lp-hero-pill {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    font-size: 12.5px;
                    color: #CBD7ED;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.13);
                    backdrop-filter: blur(4px);
                    padding: 8px 16px;
                    border-radius: 999px;
                }
                .lp-hero-pill i { color: var(--lp-cyan); font-size: 14.5px; }

                .lp-hero-right {
                    flex: 1 1 380px;
                    min-width: 260px;
                    display: flex;
                    justify-content: center;
                    z-index: 1;
                    animation: lp-fade-up 0.7s ease 0.1s both;
                }
                .lp-mock-wrap {
                    position: relative;
                    width: 100%;
                    max-width: 420px;
                }
                .lp-mock-card {
                    width: 100%;
                    background: #111C33;
                    border-radius: 18px;
                    border: 1px solid #22304F;
                    padding: 22px;
                    box-shadow: 0 24px 70px rgba(0,0,0,0.45);
                    position: relative;
                    z-index: 1;
                }
                .lp-mock-header { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
                .lp-mock-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lp-gradient); }
                .lp-mock-stats-row { display: flex; gap: 10px; margin-bottom: 20px; }
                .lp-mock-stat {
                    flex: 1;
                    background: #0D1526;
                    border-radius: 11px;
                    padding: 14px 8px;
                    text-align: center;
                    border: 1px solid #1B2740;
                }
                .lp-mock-stat-num {
                    font-size: 21px;
                    font-weight: 800;
                    font-family: 'Sora', sans-serif;
                    background: linear-gradient(90deg, #fff, #C7E4F0);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }
                .lp-mock-stat-label { font-size: 10px; color: #7C8AA5; margin-top: 4px; }
                .lp-mock-bars { display: flex; align-items: flex-end; gap: 8px; height: 90px; }
                .lp-mock-bar { flex: 1; background: var(--lp-gradient); border-radius: 5px 5px 2px 2px; }

                .lp-float-card {
                    position: absolute;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #fff;
                    color: var(--lp-text);
                    border-radius: 10px;
                    padding: 8px 12px;
                    font-size: 11.5px;
                    font-weight: 600;
                    box-shadow: 0 14px 30px rgba(0,0,0,0.3);
                    z-index: 2;
                    white-space: nowrap;
                }
                .lp-float-card i { font-size: 13px; }
                .lp-float-card.fc1 { top: -20px; right: -14px; transform: rotate(-6deg); }
                .lp-float-card.fc1 i { color: var(--lp-green); }
                .lp-float-card.fc2 { bottom: -18px; left: -14px; transform: rotate(4deg); }
                .lp-float-card .lp-avatar-dot {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: var(--lp-gradient);
                    flex-shrink: 0;
                }

                /* ---------- Sections ---------- */
                .lp-section { padding: clamp(48px, 8vw, 84px) clamp(20px, 5vw, 56px); text-align: center; }
                .lp-section-title { font-size: clamp(24px, 4vw, 30px); font-weight: 800; margin: 0 0 8px; color: var(--lp-text); }
                .lp-section-subtitle { color: var(--lp-muted); margin-bottom: 40px; font-size: 15px; }

                .lp-feature-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 22px;
                    max-width: 1100px;
                    margin: 40px auto 0;
                    text-align: left;
                }
                .lp-feature-card {
                    background: #fff;
                    border: 1px solid var(--lp-border);
                    border-radius: 14px;
                    padding: 26px;
                    transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
                }
                .lp-feature-card:hover {
                    box-shadow: 0 14px 34px rgba(32,66,151,0.12);
                    transform: translateY(-4px);
                    border-color: #C9DCF7;
                }
                .lp-feature-icon {
                    width: 44px;
                    height: 44px;
                    border-radius: 11px;
                    background: var(--lp-gradient);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    color: #fff;
                    margin-bottom: 16px;
                }
                .lp-feature-title { font-weight: 700; font-size: 16px; margin-bottom: 8px; font-family: 'Sora', sans-serif; }
                .lp-feature-desc { font-size: 13.5px; color: var(--lp-muted); line-height: 1.55; }

                /* ---------- Pricing ---------- */
                .lp-pricing-section { background: var(--lp-bg); }
                .lp-pricing-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
                    gap: 20px;
                    max-width: 1150px;
                    margin: 0 auto;
                    text-align: left;
                }
                .lp-price-card {
                    background: #fff;
                    border: 1px solid var(--lp-border);
                    border-radius: 16px;
                    padding: 26px;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    transition: box-shadow 0.2s ease, transform 0.2s ease;
                }
                .lp-price-card.lp-highlighted {
                    border: 2px solid var(--lp-blue);
                    box-shadow: 0 16px 40px rgba(32,66,151,0.18);
                }
                .lp-price-badge {
                    position: absolute;
                    top: -13px;
                    left: 22px;
                    background: var(--lp-gradient);
                    color: #fff;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 5px 12px;
                    border-radius: 999px;
                }
                .lp-price-name { font-weight: 700; font-size: 16px; margin-bottom: 8px; font-family: 'Sora', sans-serif; }
                .lp-price-value { font-size: 30px; font-weight: 800; margin-bottom: 4px; font-family: 'Sora', sans-serif; color: var(--lp-text); }
                .lp-price-period { font-size: 13px; font-weight: 400; color: var(--lp-muted); }
                .lp-price-desc { font-size: 13px; color: var(--lp-muted); margin-bottom: 18px; min-height: 36px; }
                .lp-price-features { list-style: none; padding: 0; margin: 0 0 22px; font-size: 13.5px; display: flex; flex-direction: column; gap: 9px; }
                .lp-price-features li { display: flex; align-items: center; gap: 8px; }
                .lp-price-features i { color: var(--lp-green); font-size: 15px; flex-shrink: 0; }
                .lp-price-btn {
                    border: none;
                    border-radius: 9px;
                    padding: 11px 0;
                    font-weight: 600;
                    cursor: pointer;
                    margin-top: auto;
                    font-family: inherit;
                    font-size: 14px;
                    transition: filter 0.15s ease, transform 0.15s ease;
                }
                .lp-price-btn.primary { background: var(--lp-gradient); color: #fff; }
                .lp-price-btn.secondary { background: #fff; color: var(--lp-text); border: 1px solid #CBD5E1; }
                .lp-price-btn:hover { filter: brightness(1.06); transform: translateY(-1px); }

                /* ---------- Login ---------- */
                .lp-login-section {
                    display: flex;
                    gap: 48px;
                    align-items: center;
                    justify-content: center;
                    flex-wrap: wrap;
                    padding: clamp(48px, 8vw, 84px) clamp(20px, 5vw, 56px);
                    background: linear-gradient(135deg, #EAF7FB 0%, #EDF9F6 100%);
                }
                .lp-login-illustration {
                    flex: 0 1 260px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 160px;
                }
                .lp-login-illustration .lp-blob {
                    width: 150px;
                    height: 150px;
                    border-radius: 32px;
                    background: var(--lp-gradient);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transform: rotate(-8deg);
                    box-shadow: 0 20px 50px rgba(32,66,151,0.25);
                }
                .lp-login-illustration i { color: #fff; font-size: 68px; transform: rotate(8deg); }
                .lp-login-card {
                    flex: 1 1 420px;
                    max-width: 460px;
                    background: #fff;
                    border-radius: 18px;
                    padding: clamp(24px, 4vw, 34px);
                    box-shadow: 0 16px 46px rgba(15,30,70,0.1);
                }
                .lp-login-title { font-size: 20px; font-weight: 800; margin: 0 0 6px; font-family: 'Sora', sans-serif; }
                .lp-login-subtitle { font-size: 13.5px; color: var(--lp-muted); margin-bottom: 20px; }
                .lp-login-error { background: #FEF2F2; color: #DC2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
                .lp-login-input {
                    border: 1px solid #CBD5E1;
                    border-radius: 9px;
                    padding: 12px 14px;
                    font-size: 14px;
                    outline: none;
                    font-family: inherit;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                    width: 100%;
                    box-sizing: border-box;
                }
                .lp-login-input:focus { border-color: var(--lp-cyan); box-shadow: 0 0 0 3px rgba(8,161,206,0.15); }
                .lp-login-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; flex-wrap: wrap; gap: 8px; }
                .lp-login-remember { display: flex; align-items: center; gap: 6px; color: #475569; }
                .lp-login-forgot { background: none; border: none; color: var(--lp-blue); cursor: pointer; font-size: 13px; padding: 0; font-family: inherit; font-weight: 600; }
                .lp-login-submit {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 9px;
                    padding: 13px 0;
                    font-weight: 700;
                    cursor: pointer;
                    font-size: 14.5px;
                    margin-top: 6px;
                    font-family: inherit;
                    transition: filter 0.15s ease;
                }
                .lp-login-submit:hover { filter: brightness(1.08); }
                .lp-login-submit:disabled { opacity: 0.7; cursor: not-allowed; }
                .lp-login-footer-note { font-size: 12.5px; color: var(--lp-muted); margin-top: 18px; text-align: center; }
                .lp-login-footer-note a { color: var(--lp-blue); font-weight: 600; text-decoration: none; }

                /* ---------- Footer ---------- */
                .lp-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 22px clamp(20px, 5vw, 56px);
                    background: var(--lp-ink);
                    color: #8FA3C4;
                    font-size: 12.5px;
                    flex-wrap: wrap;
                    gap: 12px;
                }
                .lp-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
                .lp-footer a { color: #8FA3C4; text-decoration: none; }
                .lp-footer a:hover { color: #fff; }

                /* ---------- Checkout modal ---------- */
                .lp-checkout-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(10, 18, 36, 0.6);
                    backdrop-filter: blur(3px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                    padding: 20px;
                }
                .lp-checkout-modal {
                    position: relative;
                    width: 100%;
                    max-width: 400px;
                    background: #fff;
                    border-radius: 18px;
                    padding: 28px;
                    box-shadow: 0 24px 60px rgba(0,0,0,0.35);
                }
                .lp-checkout-close {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    width: 30px;
                    height: 30px;
                    border-radius: 8px;
                    border: 1px solid var(--lp-border);
                    background: #fff;
                    color: var(--lp-muted);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .lp-checkout-close:hover { color: var(--lp-text); }

                /* ---------- Responsive ---------- */
                @media (max-width: 900px) {
                    .lp-nav-links { display: none; }
                    .lp-burger { display: flex; }
                    .lp-mobile-panel.open { display: flex; }
                }
                @media (max-width: 720px) {
                    .lp-hero, .lp-login-section { flex-direction: column; text-align: center; }
                    .lp-hero-left { text-align: center; }
                    .lp-hero-left .lp-hero-icon-badge { margin-left: auto; margin-right: auto; }
                    .lp-hero-subtitle { margin-left: auto; margin-right: auto; }
                    .lp-hero-ctas, .lp-hero-pills { justify-content: center; }
                    .lp-float-card { display: none; }
                    .lp-login-card { width: 100%; }
                    .lp-price-card.lp-highlighted { order: -1; }
                }
                @media (max-width: 480px) {
                    .lp-mock-stats-row { flex-wrap: wrap; }
                    .lp-mock-stat { flex: 1 1 40%; }
                    .lp-footer { justify-content: center; text-align: center; }
                }
            `}</style>

            <div className="lp-topline" />

            {/* ---------- Nav ---------- */}
            <header className="lp-nav">
                <div className="lp-nav-brand">
                    <span className="lp-icon-badge">
                        <i className="ti ti-hexagon" />
                    </span>
                    <span>Workforce Alookate</span>
                </div>
                <nav className="lp-nav-links">
                    <a
                        href="#overview"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("overview");
                        }}
                    >
                        Overview
                    </a>
                    <a
                        href="#features"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("features");
                        }}
                    >
                        Features
                    </a>
                    <a
                        href="#pricing"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("pricing");
                        }}
                    >
                        Plans &amp; Pricing
                    </a>
                    <a
                        href="#login"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("login");
                        }}
                    >
                        About Us
                    </a>
                    <a
                        href="#login"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("login");
                        }}
                    >
                        Contact
                    </a>
                </nav>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button className="lp-nav-login-btn" onClick={() => navigate("/login")}>
                        Login
                    </button>
                    <button
                        className="lp-burger"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label="Toggle menu"
                    >
                        <i className={`ti ${menuOpen ? "ti-x" : "ti-menu-2"}`} />
                    </button>
                </div>
            </header>
            <div className={`lp-mobile-panel${menuOpen ? " open" : ""}`}>
                <a
                    href="#overview"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("overview");
                    }}
                >
                    Overview
                </a>
                <a
                    href="#features"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("features");
                    }}
                >
                    Features
                </a>
                <a
                    href="#pricing"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("pricing");
                    }}
                >
                    Plans &amp; Pricing
                </a>
                <a
                    href="#login"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("login");
                    }}
                >
                    About Us
                </a>
                <a
                    href="#login"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("login");
                    }}
                >
                    Contact
                </a>
            </div>

            {/* ---------- Hero ---------- */}
            <section id="overview" className="lp-hero">
                <div className="lp-hero-glow g1" />
                <div className="lp-hero-glow g2" />
                <div className="lp-hero-glow g3" />

                <span className="lp-particle p1" />
                <span className="lp-particle p2" />
                <span className="lp-particle p3" />
                <span className="lp-particle p4" />

                <div className="lp-hero-left">
                    <div className="lp-hero-icon-badge">
                        <i className="ti ti-layout-grid" />
                    </div>
                    <span className="lp-eyebrow">
                        <i className="ti ti-bolt" /> Built for real-time allocation
                    </span>
                    <h1 className="lp-hero-title">
                        Smart Workforce.
                        <br />
                        <span>Better Allocation.</span>
                    </h1>
                    <p className="lp-hero-subtitle">
                        ALLOOKATE is a custom business solution designed to simplify the daily
                        allocation and tracking of tasks for handlers. This application allows
                        Admins, Vertical Heads, and Process Heads to assign tasks based on dynamic
                        criteria, such as the time of day and the vertical (department or process)
                        the task belongs to.
                    </p>
                    <div className="lp-hero-ctas">
                        <button className="lp-btn-primary" onClick={() => scrollTo("pricing")}>
                            Get Started
                        </button>
                        <button className="lp-btn-secondary" onClick={() => scrollTo("pricing")}>
                            View Plans
                        </button>
                    </div>
                    <div className="lp-hero-pills">
                        <span className="lp-hero-pill">
                            <i className="ti ti-shield-check" /> Secure &amp; Reliable
                        </span>
                        <span className="lp-hero-pill">
                            <i className="ti ti-chart-arrows" /> Scalable for Growth
                        </span>
                        <span className="lp-hero-pill">
                            <i className="ti ti-mood-smile" /> Easy to Use
                        </span>
                    </div>
                </div>

                <div className="lp-hero-right">
                    <div className="lp-mock-wrap">
                        <div className="lp-float-card fc1">
                            <i className="ti ti-check" /> Task Completed
                        </div>

                        <div className="lp-mock-card">
                            <div className="lp-mock-header">
                                <span className="lp-mock-dot" />
                                <span style={{ fontSize: 12, opacity: 0.7 }}>Dashboard</span>
                            </div>
                            <div className="lp-mock-stats-row">
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">24</div>
                                    <div className="lp-mock-stat-label">Active Employees</div>
                                </div>
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">128</div>
                                    <div className="lp-mock-stat-label">Tasks Assigned</div>
                                </div>
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">16</div>
                                    <div className="lp-mock-stat-label">Projects</div>
                                </div>
                            </div>
                            <div className="lp-mock-bars">
                                {[60, 90, 40, 75, 55, 100, 35].map((h, i) => (
                                    <div
                                        key={i}
                                        className="lp-mock-bar"
                                        style={{ height: `${h}%` }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="lp-float-card fc2">
                            <span className="lp-avatar-dot" /> Team Synced
                        </div>
                    </div>
                </div>
            </section>

            {/* ---------- Why choose ---------- */}
            <section id="features" className="lp-section">
                <h2 className="lp-section-title">Why Choose Workforce Allocation?</h2>
                <div className="lp-feature-grid">
                    {FEATURES.map((f) => (
                        <div key={f.title} className="lp-feature-card">
                            <div className="lp-feature-icon">
                                <i className={`ti ${f.icon}`} />
                            </div>
                            <div className="lp-feature-title">{f.title}</div>
                            <div className="lp-feature-desc">{f.desc}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ---------- Pricing ---------- */}
            <section id="pricing" className="lp-section lp-pricing-section">
                <h2 className="lp-section-title">Plans &amp; Pricing</h2>
                <p className="lp-section-subtitle">
                    Choose the perfect plan for your team. All plans are billed per user.
                </p>
                <div className="lp-pricing-grid">
                    {PLANS.map((p) => (
                        <div
                            key={p.name}
                            className={`lp-price-card${p.highlighted ? " lp-highlighted" : ""}`}
                        >
                            {p.badge && <div className="lp-price-badge">{p.badge}</div>}
                            <div className="lp-price-name">{p.name}</div>
                            <div className="lp-price-value">
                                {p.price}
                                {p.period && <span className="lp-price-period"> {p.period}</span>}
                            </div>
                            <div className="lp-price-desc">{p.desc}</div>
                            <ul className="lp-price-features">
                                {p.features.map((f) => (
                                    <li key={f}>
                                        <i className="ti ti-check" />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            <button
                                className={`lp-price-btn ${p.highlighted ? "primary" : "secondary"}`}
                                onClick={() => handlePlanSelect(p.name)}
                            >
                                {p.cta}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            {/* ---------- Existing user login ---------- */}
            <section id="login" className="lp-login-section">
                <div className="lp-login-illustration">
                    <div className="lp-blob">
                        <i className="ti ti-device-laptop" />
                    </div>
                </div>
                <div className="lp-login-card">
                    <h3 className="lp-login-title">Existing User? Login Here</h3>
                    <p className="lp-login-subtitle">
                        Access your workspace and continue managing your workforce efficiently.
                    </p>

                    {error && <div className="lp-login-error">{error}</div>}

                    <form
                        onSubmit={handleLogin}
                        style={{ display: "flex", flexDirection: "column", gap: 12 }}
                    >
                        <input
                            type="email"
                            placeholder="Enter your email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="lp-login-input"
                        />
                        <input
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="lp-login-input"
                        />
                        <div className="lp-login-row">
                            <label className="lp-login-remember">
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={(e) => setRemember(e.target.checked)}
                                />
                                Remember me
                            </label>
                            <button
                                type="button"
                                className="lp-login-forgot"
                                onClick={() => navigate("/login")}
                            >
                                Forgot Password?
                            </button>
                        </div>
                        <button type="submit" disabled={loading} className="lp-login-submit">
                            {loading ? "Logging in…" : "Login"}
                        </button>
                    </form>

                    <p className="lp-login-footer-note">
                        Don't have an organization?{" "}
                        <a href="mailto:contact@osoitech.com">Sign up your organization</a>
                    </p>
                </div>
            </section>

            <footer className="lp-footer">
                <span>© {new Date().getFullYear()} Workforce Allocation. All rights reserved.</span>
                <div className="lp-footer-links">
                    <a href="#">Privacy Policy</a>
                    <a href="#">Terms of Use</a>
                    <a href="#">Contact Us</a>
                </div>
            </footer>

            {/* ---------- Checkout email modal (Basic / Professional) ---------- */}
            {checkoutPlan && (
                <div
                    className="lp-checkout-overlay"
                    onClick={() => !checkoutLoading && setCheckoutPlan(null)}
                >
                    <div className="lp-checkout-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="lp-checkout-close"
                            onClick={() => setCheckoutPlan(null)}
                            aria-label="Close"
                            disabled={checkoutLoading}
                        >
                            <i className="ti ti-x" />
                        </button>
                        <h3 className="lp-login-title">{checkoutPlan.name} Plan</h3>
                        <p className="lp-login-subtitle">
                            {checkoutPlan.price} / user / month — enter your email to continue to
                            secure payment via Razorpay.
                        </p>
                        {checkoutError && <div className="lp-login-error">{checkoutError}</div>}
                        <input
                            type="email"
                            placeholder="Enter your email"
                            value={checkoutEmail}
                            onChange={(e) => setCheckoutEmail(e.target.value)}
                            className="lp-login-input"
                            style={{ marginBottom: 14 }}
                        />
                        <button
                            className="lp-login-submit"
                            onClick={handleConfirmCheckout}
                            disabled={checkoutLoading}
                        >
                            {checkoutLoading ? "Opening secure checkout…" : "Continue to Payment"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Landing;
