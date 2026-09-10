// src/pages/subscription.tsx
//
// In-app "Upgrade Plan" page — reached via the Sidebar's Upgrade link.
//
// DEMO/DUMMY PAYMENT PATH: this project has no live Razorpay keys
// configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET), so instead of
// opening real Razorpay Checkout, clicking "Upgrade" opens an in-app
// card modal (dummy card fields, prefilled with a standard test-card
// number) and submits straight to POST /api/billing/upgrade/mock,
// which never talks to Razorpay and never charges anything — it just
// moves THIS organization onto the new plan directly. See
// billing.controller.js's mockUpgradeHandler for the backend side.
//
// To go live with real payments later: swap handleConfirmUpgrade to
// call POST /api/billing/upgrade/create-order, open real Razorpay
// Checkout with the returned order, and verify via
// POST /api/billing/upgrade/verify-payment instead — see
// createUpgradeOrderHandler / verifyUpgradePaymentHandler on the backend.

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";

const API_BASE = import.meta.env.VITE_API_URL;

// Static display info for the two ends of the ladder that never go
// through checkout — Free is the default (nothing to buy), Enterprise
// is a sales conversation. Basic/Professional prices come from the API
// (PLAN_CONFIG on the backend) so this page never drifts out of sync
// with what actually gets charged.
const PLAN_ORDER = ["free", "basic", "professional", "enterprise"];
const STATIC_PLANS: Record<
    string,
    { label: string; features: string[]; priceDisplay?: string; icon: string }
> = {
    free: {
        label: "Free",
        priceDisplay: "₹0",
        icon: "ti-user",
        features: ["Up to 5 Users", "Basic Allocation", "Project Tracking", "Standard Reports"],
    },
    basic: {
        label: "Basic",
        icon: "ti-rocket",
        features: ["Up to 25 Users", "Advanced Allocation", "Team Management", "Custom Reports"],
    },
    professional: {
        label: "Professional",
        icon: "ti-crown",
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
        icon: "ti-building-skyscraper",
        features: ["Unlimited Users", "Custom Features", "Dedicated Support", "SLA & Onboarding"],
    },
};

// Bottom trust strip — small reassurance points under the plan grid.
const TRUST_POINTS: { icon: string; label: string }[] = [
    { icon: "ti-shield-lock", label: "Secure payments" },
    { icon: "ti-refresh", label: "Cancel anytime" },
    { icon: "ti-bolt", label: "Instant activation" },
    { icon: "ti-headset", label: "24/7 support" },
];

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

// ---- dummy-card input helpers (display formatting only, nothing here
// is validated as a real card or sent anywhere but our own mock endpoint) ----
function formatCardNumber(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 19);
    return digits.replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function Subscription() {
    // Colors follow the organization's active theme (Settings -> theme
    // color) instead of a hardcoded brand blue — same pattern dashboard.tsx
    // and other pages use, so this page re-themes along with the rest of
    // the app.
    const { colors: themeColors } = useTheme();
    const BRAND = {
        blue: themeColors.blue,
        lightBlue: themeColors.lightBlue,
        green: themeColors.green,
        red: "#DC2626",
    };
    const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;
    const CARD_GRADIENT = `linear-gradient(135deg, #2B2F77 0%, ${BRAND.blue} 45%, ${BRAND.lightBlue} 100%)`;
    const styles = getStyles(BRAND, GRADIENT, CARD_GRADIENT);

    const [currentPlan, setCurrentPlan] = useState<string>("free");
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [planPrices, setPlanPrices] = useState<Record<string, { amount: number; label: string }>>(
        {}
    );
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    // NEW: Super Admin and Ops Manager can actually change the plan;
    // every other role can still open this page and see the current
    // plan + pricing, but in read-only "view mode" — Upgrade buttons are
    // swapped for a disabled "View only" pill and the checkout modal
    // never opens for them. Same localStorage-read pattern already used
    // by clients.tsx/employees.tsx/products.tsx (AuthContext isn't wired
    // into App.jsx yet — see authcontext.tsx's header comment).
    const currentUser = JSON.parse(localStorage.getItem("user") || "null");
    const canManagePlan =
        currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "OPS_MANAGER";

    // ---------- dummy-card checkout modal ----------
    const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
    const [cardName, setCardName] = useState("");
    const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
    const [cardExpiry, setCardExpiry] = useState("12/29");
    const [cardCvv, setCardCvv] = useState("123");
    const [checkoutError, setCheckoutError] = useState("");
    const [checkoutLoading, setCheckoutLoading] = useState(false);

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

    // Clicking "Upgrade" just opens the dummy-card modal for that plan —
    // no network call yet, nothing is charged until "Pay & Upgrade".
    // Guarded here too (not just by swapping the button out above) so a
    // view-only role can never trigger checkout even via a stray click
    // or devtools call.
    const handleUpgrade = (planKey: string) => {
        if (!canManagePlan) return;
        setError("");
        setSuccessMsg("");
        setCheckoutError("");
        setCardName("");
        setCheckoutPlan(planKey);
    };

    const closeCheckout = () => {
        if (checkoutLoading) return;
        setCheckoutPlan(null);
        setCheckoutError("");
    };

    const handleConfirmUpgrade = async () => {
        if (!canManagePlan || !checkoutPlan) return;
        if (!cardName.trim()) {
            setCheckoutError("Enter the name on the card.");
            return;
        }
        if (!/^\d{4}\s?\d{4}\s?\d{4}\s?\d{1,4}$/.test(cardNumber.trim())) {
            setCheckoutError("Enter a valid card number.");
            return;
        }
        if (!/^\d{2}\/\d{2}$/.test(cardExpiry.trim())) {
            setCheckoutError("Enter the expiry as MM/YY.");
            return;
        }
        if (!/^\d{3,4}$/.test(cardCvv.trim())) {
            setCheckoutError("Enter a valid CVV.");
            return;
        }

        setCheckoutError("");
        setCheckoutLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/billing/upgrade/mock`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: checkoutPlan, cardNumber }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data?.message || "Payment failed. Please try again.");
            }
            setCurrentPlan(data.data.plan);
            setCurrentPeriodEnd(data.data.currentPeriodEnd);
            setSuccessMsg(
                `You're now on the ${STATIC_PLANS[checkoutPlan]?.label || checkoutPlan} plan.`
            );
            setCheckoutPlan(null);
        } catch (err: any) {
            setCheckoutError(err?.message || "Something went wrong. Please try again.");
        } finally {
            setCheckoutLoading(false);
        }
    };

    const currentIndex = PLAN_ORDER.indexOf(currentPlan);
    const checkoutInfo = checkoutPlan ? STATIC_PLANS[checkoutPlan] : null;
    const checkoutPriceInfo = checkoutPlan ? planPrices[checkoutPlan] : null;
    const checkoutPriceDisplay =
        checkoutInfo?.priceDisplay ||
        (checkoutPriceInfo ? `₹${(checkoutPriceInfo.amount / 100).toLocaleString()}` : "—");

    const currentInfo = STATIC_PLANS[currentPlan];

    return (
        <div style={styles.root}>
            {/* decorative background blobs — purely visual, sit behind everything */}
            <div style={styles.blobTopLeft} />
            <div style={styles.blobBottomRight} />

            <div style={styles.contentBody}>
                <div style={styles.headerBlock}>
                    <h2 style={styles.pageTitle}>
                        <span style={styles.titleDash}>—</span> Subscription{" "}
                        <span style={styles.titleDash}>—</span>
                    </h2>
                    <p style={styles.headerSubtext}>
                        Manage your organization's plan and payment. Upgrading takes effect
                        immediately.
                    </p>
                    {/* NEW: view-only notice for every role except Super Admin /
                        Ops Manager — they can see plans and pricing here but
                        can't actually change anything (Upgrade buttons are
                        swapped for a disabled "View only" pill below). */}
                    {!canManagePlan && (
                        <p style={styles.viewOnlyNotice}>
                            <i className="ti ti-eye" /> View only — ask your Super Admin or Ops
                            Manager to change the plan.
                        </p>
                    )}
                </div>

                {loading ? (
                    <p style={styles.mutedText}>Loading your plan…</p>
                ) : (
                    <>
                        <div style={styles.currentCard}>
                            <div style={styles.currentCardLeft}>
                                <div style={styles.currentIconBox}>
                                    <i className={`ti ${currentInfo?.icon || "ti-user"}`} />
                                </div>
                                <div>
                                    <div style={styles.currentLabel}>Current Plan</div>
                                    <div style={styles.currentPlanName}>
                                        {currentInfo?.label || currentPlan}
                                    </div>
                                </div>
                            </div>
                            {currentPeriodEnd && (
                                <div style={styles.renewalBlock}>
                                    <div style={styles.currentLabel}>
                                        <i className="ti ti-calendar-event" /> Renews / Expires
                                    </div>
                                    <div style={styles.renewalDate}>
                                        {formatDate(currentPeriodEnd)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {error && <p style={styles.errorText}>{error}</p>}
                        {successMsg && (
                            <div style={styles.successPill}>
                                <i className="ti ti-circle-check-filled" />
                                {successMsg}
                            </div>
                        )}

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

                                return (
                                    <div
                                        key={planKey}
                                        style={{
                                            ...styles.planCard,
                                            ...(isCurrent ? styles.planCardCurrent : {}),
                                        }}
                                    >
                                        {isCurrent && (
                                            <div style={styles.currentBadge}>
                                                <i className="ti ti-check" /> Current Plan
                                            </div>
                                        )}
                                        <div
                                            style={{
                                                ...styles.planIconBox,
                                                ...(isCurrent ? styles.planIconBoxCurrent : {}),
                                            }}
                                        >
                                            <i className={`ti ${info.icon}`} />
                                        </div>
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
                                        <div style={styles.planDivider} />
                                        <ul style={styles.featureList}>
                                            {info.features.map((f) => (
                                                <li key={f} style={styles.featureItem}>
                                                    <i
                                                        className="ti ti-check"
                                                        style={{ color: BRAND.lightBlue }}
                                                    />
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>

                                        {isCurrent ? (
                                            <button style={styles.btnCurrentActive} disabled>
                                                Current Plan
                                            </button>
                                        ) : isEnterprise ? (
                                            canManagePlan ? (
                                                <a
                                                    href="mailto:contact@osoitech.com?subject=Enterprise%20Plan%20Inquiry"
                                                    style={styles.btnSecondary}
                                                >
                                                    Contact Sales
                                                </a>
                                            ) : (
                                                <button style={styles.btnDisabled} disabled>
                                                    View only
                                                </button>
                                            )
                                        ) : isUpgradable ? (
                                            canManagePlan ? (
                                                <button
                                                    style={styles.btnPrimary}
                                                    onClick={() => handleUpgrade(planKey)}
                                                >
                                                    Upgrade
                                                </button>
                                            ) : (
                                                <button style={styles.btnDisabled} disabled>
                                                    View only
                                                </button>
                                            )
                                        ) : (
                                            <button style={styles.btnDisabled} disabled>
                                                Included below
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Relatable trust footer */}
                        <div style={styles.trustFooter}>
                            {TRUST_POINTS.map((point) => (
                                <div key={point.label} style={styles.trustItem}>
                                    <i className={`ti ${point.icon}`} style={styles.trustIcon} />
                                    <span>{point.label}</span>
                                </div>
                            ))}
                        </div>
                        <p style={styles.footnote}>
                            Prices are per user / month, billed monthly. You can upgrade, downgrade,
                            or cancel your plan at any time — changes take effect immediately.
                        </p>
                    </>
                )}
            </div>

            {checkoutPlan && checkoutInfo && (
                <div style={styles.modalOverlay} onClick={closeCheckout}>
                    <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                        <button
                            style={styles.modalClose}
                            onClick={closeCheckout}
                            aria-label="Close"
                            disabled={checkoutLoading}
                        >
                            <i className="ti ti-x" />
                        </button>

                        <div style={styles.modalHeader}>
                            <div style={styles.modalEyebrow}>Upgrade to</div>
                            <div style={styles.modalPlanName}>{checkoutInfo.label}</div>
                            <div style={styles.modalPlanPrice}>
                                {checkoutPriceDisplay}
                                <span style={styles.planPricePeriod}> / user / month</span>
                            </div>
                        </div>

                        {/* Live card preview */}
                        <div style={styles.cardPreview}>
                            <div style={styles.cardPreviewTopRow}>
                                <i className="ti ti-credit-card" style={styles.cardPreviewIcon} />
                                <span style={styles.cardPreviewBrand}>OSOI Pay</span>
                            </div>
                            <div style={styles.cardPreviewNumber}>
                                {cardNumber || "•••• •••• •••• ••••"}
                            </div>
                            <div style={styles.cardPreviewBottomRow}>
                                <div>
                                    <div style={styles.cardPreviewLabel}>Card Holder</div>
                                    <div style={styles.cardPreviewValue}>
                                        {cardName.trim() || "YOUR NAME"}
                                    </div>
                                </div>
                                <div>
                                    <div style={styles.cardPreviewLabel}>Expires</div>
                                    <div style={styles.cardPreviewValue}>
                                        {cardExpiry || "MM/YY"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.formLabel}>Name on Card</label>
                            <input
                                style={styles.formInput}
                                type="text"
                                placeholder="e.g. Aamir Khan"
                                value={cardName}
                                onChange={(e) => setCardName(e.target.value)}
                                disabled={checkoutLoading}
                            />
                        </div>

                        <div style={styles.formGroup}>
                            <label style={styles.formLabel}>Card Number</label>
                            <input
                                style={styles.formInput}
                                type="text"
                                inputMode="numeric"
                                placeholder="0000 0000 0000 0000"
                                value={cardNumber}
                                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                                disabled={checkoutLoading}
                            />
                        </div>

                        <div style={styles.formRow}>
                            <div style={{ ...styles.formGroup, flex: 1 }}>
                                <label style={styles.formLabel}>Expiry (MM/YY)</label>
                                <input
                                    style={styles.formInput}
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="MM/YY"
                                    value={cardExpiry}
                                    onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                                    disabled={checkoutLoading}
                                />
                            </div>
                            <div style={{ ...styles.formGroup, flex: 1 }}>
                                <label style={styles.formLabel}>CVV</label>
                                <input
                                    style={styles.formInput}
                                    type="password"
                                    inputMode="numeric"
                                    placeholder="123"
                                    maxLength={4}
                                    value={cardCvv}
                                    onChange={(e) =>
                                        setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))
                                    }
                                    disabled={checkoutLoading}
                                />
                            </div>
                        </div>

                        <p style={styles.modalDisclaimer}>
                            <i className="ti ti-lock" /> This is a test payment screen — no real
                            card is charged. Any 16-digit number works.
                        </p>

                        {checkoutError && <p style={styles.errorText}>{checkoutError}</p>}

                        <div style={styles.modalActions}>
                            <button
                                style={{ ...styles.btnSecondary, flex: 1 }}
                                onClick={closeCheckout}
                                disabled={checkoutLoading}
                            >
                                Cancel
                            </button>
                            <button
                                style={{
                                    ...styles.btnPrimary,
                                    flex: 1.4,
                                    ...(checkoutLoading ? styles.btnPrimaryBusy : {}),
                                }}
                                onClick={handleConfirmUpgrade}
                                disabled={checkoutLoading}
                            >
                                {checkoutLoading
                                    ? "Processing…"
                                    : `Pay ${checkoutPriceDisplay} & Upgrade`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function getStyles(
    BRAND: { blue: string; lightBlue: string; green: string; red: string },
    GRADIENT: string,
    CARD_GRADIENT: string
): Record<string, React.CSSProperties> {
    return {
        // Explicit opaque background (+ flex:1 so it always fills the
        // full available height, not just its own content height) so
        // the page never shows the OS/browser's dark <html> background
        // (see index.css's `prefers-color-scheme: dark` rule) bleeding
        // through below the content on short pages — matches
        // billing.tsx / productionreports.tsx / employees.tsx.
        root: {
            width: "100%",
            flex: 1,
            minHeight: "100%",
            position: "relative",
            overflow: "hidden",
            background: "linear-gradient(180deg, #F7F8FC 0%, #F1F2FA 100%)",
        },
        blobTopLeft: {
            position: "absolute",
            top: -120,
            left: -120,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${BRAND.lightBlue}22 0%, transparent 70%)`,
            pointerEvents: "none",
        },
        blobBottomRight: {
            position: "absolute",
            bottom: -140,
            right: -140,
            width: 380,
            height: 380,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${BRAND.blue}1f 0%, transparent 70%)`,
            pointerEvents: "none",
        },
        contentBody: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 22,
            padding: "28px 24px 40px",
            maxWidth: 1080,
            margin: "0 auto",
        },
        headerBlock: { textAlign: "center" },
        pageTitle: {
            margin: 0,
            fontSize: fontSize["5xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
        },
        titleDash: { color: BRAND.lightBlue, fontWeight: fontWeight.regular },
        headerSubtext: { margin: "6px 0 0", fontSize: fontSize.base, color: "#767F92" },
        viewOnlyNotice: {
            margin: "10px 0 0",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: radius.pill,
            background: "#FEF3E2",
            color: "#B45309",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
        },
        mutedText: { fontSize: fontSize.base, color: "#767F92", textAlign: "center" },
        errorText: {
            color: BRAND.red,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            margin: 0,
        },
        successPill: {
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#E9FBF6",
            color: "#0F9D77",
            border: "1px solid #BFF0DF",
            borderRadius: radius.pill,
            padding: "8px 18px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
        },

        currentCard: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(6px)",
            borderRadius: radius.xl,
            boxShadow: "0 10px 28px rgba(32, 66, 151, 0.08)",
            border: "1px solid rgba(255,255,255,0.6)",
            padding: "16px 20px 16px 16px",
        },
        currentCardLeft: { display: "flex", alignItems: "center", gap: 10 },
        currentIconBox: {
            width: 46,
            height: 46,
            borderRadius: radius.md,
            background: `${BRAND.lightBlue}1a`,
            color: BRAND.blue,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
        },
        currentLabel: {
            fontSize: fontSize.xs,
            color: "#9ca3af",
            fontWeight: fontWeight.medium,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            display: "flex",
            alignItems: "center",
            gap: 4,
            justifyContent: "flex-end",
        },
        currentPlanName: {
            fontSize: fontSize["3xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        renewalBlock: { textAlign: "right" },
        renewalDate: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: "#17181C" },

        plansGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 18,
        },
        planCard: {
            background: "#fff",
            borderRadius: radius.xl,
            boxShadow: "0 8px 24px rgba(32, 66, 151, 0.06)",
            padding: "22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "relative",
            border: "2px solid transparent",
            transition: "box-shadow 0.2s ease, transform 0.2s ease",
        },
        planCardCurrent: {
            border: `2px solid ${BRAND.blue}`,
            boxShadow: "0 14px 32px rgba(32, 66, 151, 0.18)",
            transform: "translateY(-2px)",
        },
        currentBadge: {
            position: "absolute",
            top: -14,
            right: 18,
            background: GRADIENT,
            color: "#fff",
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.semibold,
            padding: "5px 14px",
            borderRadius: radius.pill,
            boxShadow: "0 6px 14px rgba(32, 66, 151, 0.35)",
            display: "flex",
            alignItems: "center",
            gap: 4,
        },
        planIconBox: {
            width: 44,
            height: 44,
            borderRadius: radius.md,
            background: "#F1F2FA",
            color: BRAND.blue,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
        },
        planIconBoxCurrent: { background: `${BRAND.lightBlue}22`, color: BRAND.blue },
        planName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: "#17181C" },
        planPrice: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, color: BRAND.blue },
        planPricePeriod: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.regular,
            color: "#9ca3af",
        },
        planDivider: { height: 1, background: "#EEF0F6", margin: "2px 0" },
        featureList: {
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
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
            boxShadow: "0 8px 18px rgba(32, 66, 151, 0.25)",
        },
        btnPrimaryBusy: { opacity: 0.75, cursor: "wait" },
        btnCurrentActive: {
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.pill,
            padding: "10px 16px",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            cursor: "default",
            boxShadow: "0 8px 18px rgba(32, 66, 151, 0.25)",
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

        // ---- relatable trust footer, sits under the plan grid ----
        trustFooter: {
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "10px 32px",
            borderTop: "1px solid #E5E7EF",
            paddingTop: 22,
            marginTop: 6,
        },
        trustItem: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#5B6478",
        },
        trustIcon: { color: BRAND.lightBlue, fontSize: 16 },
        footnote: {
            textAlign: "center",
            fontSize: fontSize.xs,
            color: "#9ca3af",
            margin: 0,
            maxWidth: 560,
            alignSelf: "center",
            lineHeight: 1.5,
        },

        // ---- payment modal ----
        modalOverlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(17, 20, 33, 0.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
        },
        modalCard: {
            position: "relative",
            background: "#fff",
            borderRadius: radius.xl,
            boxShadow: "0 24px 60px rgba(16, 24, 64, 0.25)",
            padding: "28px",
            width: "100%",
            maxWidth: 420,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxHeight: "92vh",
            overflowY: "auto",
        },
        modalClose: {
            position: "absolute",
            top: 14,
            right: 14,
            background: "#F3F4F6",
            border: "none",
            borderRadius: radius.circle,
            width: 30,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#6B7280",
            fontSize: fontSize.md,
        },
        modalHeader: { textAlign: "center", marginBottom: 4 },
        modalEyebrow: {
            fontSize: fontSize.xs,
            color: "#9ca3af",
            fontWeight: fontWeight.medium,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
        },
        modalPlanName: {
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            marginTop: 2,
        },
        modalPlanPrice: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
        },

        cardPreview: {
            background: CARD_GRADIENT,
            borderRadius: radius.lg,
            padding: "18px 20px",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            boxShadow: "0 12px 24px rgba(32, 66, 151, 0.3)",
        },
        cardPreviewTopRow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
        },
        cardPreviewIcon: { fontSize: 24, opacity: 0.9 },
        cardPreviewBrand: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            letterSpacing: "0.06em",
            opacity: 0.9,
        },
        cardPreviewNumber: {
            fontSize: fontSize["2xl"],
            fontWeight: fontWeight.medium,
            letterSpacing: "0.08em",
            fontFamily: "ui-monospace, Consolas, monospace",
        },
        cardPreviewBottomRow: { display: "flex", justifyContent: "space-between", gap: 12 },
        cardPreviewLabel: {
            fontSize: fontSize.xxs,
            opacity: 0.75,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
        },
        cardPreviewValue: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            marginTop: 2,
            textTransform: "uppercase",
        },

        formGroup: { display: "flex", flexDirection: "column", gap: 6 },
        formRow: { display: "flex", gap: 12 },
        formLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#4B5563" },
        formInput: {
            border: "1.5px solid #E5E7EB",
            borderRadius: radius.sm,
            padding: "10px 12px",
            fontSize: fontSize.base,
            color: "#17181C",
            outline: "none",
            fontFamily: "inherit",
        },
        modalDisclaimer: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.xs,
            color: "#9ca3af",
            margin: 0,
        },
        modalActions: { display: "flex", gap: 10, marginTop: 4 },
    };
}
