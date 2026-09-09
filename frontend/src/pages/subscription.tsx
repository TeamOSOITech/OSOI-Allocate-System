// src/pages/subscription.tsx
//
// In-app "Upgrade Plan" page — reached via the Sidebar's Upgrade link.
// Unlike the pre-signup checkout on the public Landing page (which uses
// the dummy-card /api/billing/mock-checkout path because there's no
// account yet to attach a real charge to), this page is for an ALREADY
// LOGGED-IN organization and drives REAL Razorpay Checkout:
//
//   1. GET  /api/billing/subscription        -> what plan are we on now
//   2. GET  /api/billing/plans                -> live prices for Basic/Professional
//   3. POST /api/billing/upgrade/create-order -> real Razorpay order for the org
//   4. Razorpay Checkout.js widget opens, user pays with a real card/UPI
//   5. POST /api/billing/upgrade/verify-payment -> signature is verified
//      server-side and, if valid, THIS organization's existing
//      subscription row is updated to the new plan (never a new
//      account/tenant — that's the whole difference from the landing
//      page flow).
//
// Requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to be set in the
// backend's environment — see billing.service.js. If they're missing,
// step 3 above fails with a clear error message instead of silently
// falling back to a mock/dummy payment.

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
    interface Window {
        Razorpay?: any;
    }
}

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    red: "#DC2626",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

// Static display info for the two ends of the ladder that never go
// through Razorpay — Free is the default (nothing to buy), Enterprise
// is a sales conversation. Basic/Professional prices come from the API
// (PLAN_CONFIG on the backend) so this page never drifts out of sync
// with what actually gets charged.
const PLAN_ORDER = ["free", "basic", "professional", "enterprise"];
const STATIC_PLANS: Record<string, { label: string; features: string[]; priceDisplay?: string }> = {
    free: {
        label: "Free",
        priceDisplay: "₹0",
        features: ["Up to 5 Users", "Basic Allocation", "Project Tracking", "Standard Reports"],
    },
    basic: {
        label: "Basic",
        features: ["Up to 25 Users", "Advanced Allocation", "Team Management", "Custom Reports"],
    },
    professional: {
        label: "Professional",
        features: [
            "Up to 100 Users",
            "AI-powered Suggestions",
            "Advanced Reports",
            "Priority Support",
        ],
    },
    enterprise: {
        label: "Enterprise",
        priceDisplay: "Custom Pricing",
        features: ["Unlimited Users", "Custom Features", "Dedicated Support", "SLA & Onboarding"],
    },
};

function loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
        if (window.Razorpay) {
            resolve(true);
            return;
        }
        const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
        if (existing) {
            existing.addEventListener("load", () => resolve(true));
            existing.addEventListener("error", () => resolve(false));
            return;
        }
        const script = document.createElement("script");
        script.src = RAZORPAY_SCRIPT_SRC;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    } catch {
        return "—";
    }
}

export default function Subscription() {
    const [currentPlan, setCurrentPlan] = useState<string>("free");
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [planPrices, setPlanPrices] = useState<Record<string, { amount: number; label: string }>>(
        {}
    );
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [processingPlan, setProcessingPlan] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState("");

    const user = JSON.parse(localStorage.getItem("user") || "null");

    const loadData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [subRes, plansRes] = await Promise.all([
                authFetch(`${API_BASE}/api/billing/subscription`),
                authFetch(`${API_BASE}/api/billing/plans`),
            ]);
            const subJson = await subRes.json();
            const plansJson = await plansRes.json();
            if (!subRes.ok || !subJson.success) {
                throw new Error(subJson?.message || "Failed to load your subscription.");
            }
            if (!plansRes.ok || !plansJson.success) {
                throw new Error(plansJson?.message || "Failed to load plan pricing.");
            }
            setCurrentPlan((subJson.data.plan || "free").toLowerCase());
            setCurrentPeriodEnd(subJson.data.currentPeriodEnd || null);
            setPlanPrices(plansJson.data || {});
        } catch (err: any) {
            setError(err?.message || "Something went wrong loading your plan.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleUpgrade = async (planKey: string) => {
        setError("");
        setSuccessMsg("");
        setProcessingPlan(planKey);
        try {
            const scriptOk = await loadRazorpayScript();
            if (!scriptOk || !window.Razorpay) {
                throw new Error(
                    "Couldn't load the Razorpay checkout script. Check your connection and try again."
                );
            }

            const orderRes = await authFetch(`${API_BASE}/api/billing/upgrade/create-order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: planKey }),
            });
            const orderJson = await orderRes.json();
            if (!orderRes.ok || !orderJson.success) {
                throw new Error(orderJson?.message || "Could not start checkout.");
            }
            const { orderId, amount, currency, keyId } = orderJson.data;

            if (!keyId) {
                throw new Error(
                    "Razorpay isn't configured on the server yet (missing RAZORPAY_KEY_ID). Ask an admin to add the Razorpay keys in the backend environment."
                );
            }

            const razorpay = new window.Razorpay({
                key: keyId,
                amount,
                currency,
                order_id: orderId,
                name: "OSOI Allocate",
                description: `Upgrade to ${STATIC_PLANS[planKey]?.label || planKey} plan`,
                prefill: { email: user?.email || "" },
                theme: { color: "#204297" },
                handler: async (response: any) => {
                    try {
                        const verifyRes = await authFetch(
                            `${API_BASE}/api/billing/upgrade/verify-payment`,
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_signature: response.razorpay_signature,
                                    plan: planKey,
                                }),
                            }
                        );
                        const verifyJson = await verifyRes.json();
                        if (!verifyRes.ok || !verifyJson.success) {
                            throw new Error(verifyJson?.message || "Payment verification failed.");
                        }
                        setCurrentPlan(verifyJson.data.plan);
                        setCurrentPeriodEnd(verifyJson.data.currentPeriodEnd);
                        setSuccessMsg(
                            `You're now on the ${STATIC_PLANS[planKey]?.label || planKey} plan.`
                        );
                    } catch (err: any) {
                        setError(err?.message || "Payment verification failed.");
                    } finally {
                        setProcessingPlan(null);
                    }
                },
                modal: {
                    // User closed the Razorpay widget without paying —
                    // not an error, just stop showing the spinner.
                    ondismiss: () => setProcessingPlan(null),
                },
            });

            razorpay.on("payment.failed", (resp: any) => {
                setError(resp?.error?.description || "Payment failed. Please try again.");
                setProcessingPlan(null);
            });

            razorpay.open();
        } catch (err: any) {
            setError(err?.message || "Something went wrong. Please try again.");
            setProcessingPlan(null);
        }
    };

    const currentIndex = PLAN_ORDER.indexOf(currentPlan);

    return (
        <div style={styles.root}>
            <div style={styles.contentBody}>
                <div>
                    <h2 style={styles.pageTitle}>Subscription</h2>
                    <p style={styles.headerSubtext}>
                        Manage your organization's plan and payment. Upgrading takes effect
                        immediately.
                    </p>
                </div>

                {loading ? (
                    <p style={styles.mutedText}>Loading your plan…</p>
                ) : (
                    <>
                        <div style={styles.currentCard}>
                            <div>
                                <div style={styles.currentLabel}>Current Plan</div>
                                <div style={styles.currentPlanName}>
                                    {STATIC_PLANS[currentPlan]?.label || currentPlan}
                                </div>
                            </div>
                            {currentPeriodEnd && (
                                <div style={styles.renewalBlock}>
                                    <div style={styles.currentLabel}>Renews / Expires</div>
                                    <div style={styles.renewalDate}>
                                        {formatDate(currentPeriodEnd)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {error && <p style={styles.errorText}>{error}</p>}
                        {successMsg && <p style={styles.successText}>{successMsg}</p>}

                        <div style={styles.plansGrid}>
                            {PLAN_ORDER.map((planKey, idx) => {
                                const info = STATIC_PLANS[planKey];
                                const priceInfo = planPrices[planKey];
                                const priceDisplay =
                                    info.priceDisplay ||
                                    (priceInfo
                                        ? `₹${(priceInfo.amount / 100).toLocaleString()}`
                                        : "—");
                                const isCurrent = planKey === currentPlan;
                                const isUpgradable =
                                    (planKey === "basic" || planKey === "professional") &&
                                    idx > currentIndex;
                                const isEnterprise = planKey === "enterprise";
                                const isBusy = processingPlan === planKey;

                                return (
                                    <div
                                        key={planKey}
                                        style={{
                                            ...styles.planCard,
                                            ...(isCurrent ? styles.planCardCurrent : {}),
                                        }}
                                    >
                                        {isCurrent && (
                                            <div style={styles.currentBadge}>Current Plan</div>
                                        )}
                                        <div style={styles.planName}>{info.label}</div>
                                        <div style={styles.planPrice}>
                                            {priceDisplay}
                                            {!info.priceDisplay && (
                                                <span style={styles.planPricePeriod}>
                                                    {" "}
                                                    / user / month
                                                </span>
                                            )}
                                        </div>
                                        <ul style={styles.featureList}>
                                            {info.features.map((f) => (
                                                <li key={f} style={styles.featureItem}>
                                                    <i
                                                        className="ti ti-check"
                                                        style={{ color: BRAND.green }}
                                                    />
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>

                                        {isCurrent ? (
                                            <button style={styles.btnDisabled} disabled>
                                                Current Plan
                                            </button>
                                        ) : isEnterprise ? (
                                            <a
                                                href="mailto:contact@osoitech.com?subject=Enterprise%20Plan%20Inquiry"
                                                style={styles.btnSecondary}
                                            >
                                                Contact Sales
                                            </a>
                                        ) : isUpgradable ? (
                                            <button
                                                style={styles.btnPrimary}
                                                disabled={!!processingPlan}
                                                onClick={() => handleUpgrade(planKey)}
                                            >
                                                {isBusy ? "Processing…" : "Upgrade"}
                                            </button>
                                        ) : (
                                            <button style={styles.btnDisabled} disabled>
                                                Included below
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    root: { width: "100%", minHeight: "100%" },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "20px 24px",
        maxWidth: 1080,
    },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },
    headerSubtext: { margin: "6px 0 0", fontSize: fontSize.base, color: "#767F92" },
    mutedText: { fontSize: fontSize.base, color: "#767F92" },
    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },
    successText: {
        color: BRAND.green,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },

    currentCard: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "18px 22px",
    },
    currentLabel: {
        fontSize: fontSize.xs,
        color: "#9ca3af",
        fontWeight: fontWeight.medium,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    currentPlanName: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, color: "#17181C" },
    renewalBlock: { textAlign: "right" },
    renewalDate: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: "#17181C" },

    plansGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
    },
    planCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        border: "2px solid transparent",
    },
    planCardCurrent: { border: `2px solid ${BRAND.blue}` },
    currentBadge: {
        position: "absolute",
        top: -10,
        right: 16,
        background: GRADIENT,
        color: "#fff",
        fontSize: fontSize.xxs,
        fontWeight: fontWeight.semibold,
        padding: "4px 10px",
        borderRadius: radius.pill,
    },
    planName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: "#17181C" },
    planPrice: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, color: BRAND.blue },
    planPricePeriod: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, color: "#9ca3af" },
    featureList: {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flex: 1,
    },
    featureItem: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.sm,
        color: "#4B5563",
    },
    btnPrimary: {
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: radius.pill,
        padding: "10px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    btnSecondary: {
        display: "inline-block",
        textAlign: "center",
        background: "#fff",
        color: BRAND.blue,
        border: `1.5px solid ${BRAND.blue}`,
        borderRadius: radius.pill,
        padding: "10px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        textDecoration: "none",
    },
    btnDisabled: {
        background: "#F3F4F6",
        color: "#9ca3af",
        border: "none",
        borderRadius: radius.pill,
        padding: "10px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "not-allowed",
    },
};
