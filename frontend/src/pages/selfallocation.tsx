import { useState, useEffect, useMemo, useCallback } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../utils/authFetch";
import { getCurrentUser } from "../utils/auth";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

function withAlpha(hex: string, alpha: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// ---- minimal inline icons (matches manualallocation.tsx's icon set —
// no external icon library) ----
type IconProps = { size?: number; color?: string; style?: CSSProperties };
const iconBase = (size: number) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
});
function Zap({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}
function Edit3({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}
function CheckCircle2({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
function Box({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
    );
}
function Calendar({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}

function EmptyStateIcon() {
    return (
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="28" fill={withAlpha(BRAND.blue, 0.06)} />
            <rect x="14" y="24" width="28" height="16" rx="3" fill={withAlpha(BRAND.blue, 0.12)} />
            <path
                d="M14 28h8l2 4h8l2-4h8"
                stroke={withAlpha(BRAND.blue, 0.35)}
                strokeWidth="2"
                fill="none"
            />
            <circle cx="20" cy="20" r="2" fill="#FBBF24" />
            <circle cx="38" cy="18" r="1.6" fill="#FBBF24" />
        </svg>
    );
}

// ---------------- types ----------------
type DailyWorkBatch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
};

type SelfAllocationRow = {
    daily_work_id: string;
    allocated_qty: number;
    status: string;
};

export default function SelfAllocation() {
    const isMobile = useIsMobile();
    const currentUser = getCurrentUser();
    const myId = currentUser?.id || "";

    const [date, setDate] = useState(todayStr());
    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [myAllocations, setMyAllocations] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");

    // Per-batch UI state: which mode (smart/manual) is active, the
    // manual qty being typed, and whether a submit is in flight — keyed
    // by daily_work_id so every card is independent.
    const [modeByBatch, setModeByBatch] = useState<Record<string, "smart" | "manual">>({});
    const [manualQtyByBatch, setManualQtyByBatch] = useState<Record<string, string>>({});
    const [submittingBatch, setSubmittingBatch] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // ---- load today's (or selected date's) batches + my own allocations
    // against them ----
    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [batchesRes, allocRes] = await Promise.all([
                authFetch(`${API_BASE}/api/daily-work?date=${date}`),
                myId
                    ? authFetch(`${API_BASE}/api/allocations?employeeId=${myId}`)
                    : Promise.resolve(null),
            ]);

            const batchesJson = await batchesRes.json();
            if (!batchesRes.ok || !batchesJson.success) {
                throw new Error(batchesJson.message || "Failed to load today's work");
            }
            setBatches(batchesJson.data || []);

            if (allocRes) {
                const allocJson = await allocRes.json();
                if (allocRes.ok && allocJson.success) {
                    const mine: Record<string, number> = {};
                    (allocJson.data || [])
                        .filter((a: any) => a.workDate === date)
                        .forEach((a: SelfAllocationRow) => {
                            mine[a.daily_work_id] = (mine[a.daily_work_id] || 0) + a.allocated_qty;
                        });
                    setMyAllocations(mine);
                }
            }
        } catch (err: any) {
            setError(err.message || "Failed to load today's allocation");
            setBatches([]);
        } finally {
            setLoading(false);
        }
    }, [date, myId]);

    useEffect(() => {
        load();
    }, [load]);

    const setMode = (batchId: string, mode: "smart" | "manual") => {
        setModeByBatch((prev) => ({ ...prev, [batchId]: mode }));
    };

    const setManualQty = (batchId: string, value: string) => {
        setManualQtyByBatch((prev) => ({ ...prev, [batchId]: value }));
    };

    // ---- shared submit: qty is always capped/validated against the
    // batch's live pendingQty, and always allocates to the caller's own
    // employee id (the backend re-derives this from the auth token
    // regardless of anything sent here, but we mirror the same cap
    // client-side for a fast, clear error before the request even goes
    // out) ----
    const submitAllocation = async (batch: DailyWorkBatch, qty: number) => {
        if (batch.pendingQty <= 0) {
            showToast("Nothing pending on this task.");
            return;
        }
        if (!qty || qty <= 0) {
            showToast("Enter a quantity greater than 0.");
            return;
        }
        if (qty > batch.pendingQty) {
            showToast(`Only ${batch.pendingQty} unit(s) pending — can't take ${qty}.`);
            return;
        }

        setSubmittingBatch(batch.id);
        try {
            const res = await authFetch(`${API_BASE}/api/allocations/self`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dailyWorkId: batch.id, qty }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to allocate");
            }
            showToast(`Allocated ${qty} unit(s) to yourself.`);
            setManualQty(batch.id, "");
            await load();
        } catch (err: any) {
            showToast(err.message || "Something went wrong");
        } finally {
            setSubmittingBatch(null);
        }
    };

    const handleSmartAllocate = (batch: DailyWorkBatch) => {
        // "Smart" here means one click, no typing: take everything that's
        // still pending on this task, right now.
        submitAllocation(batch, batch.pendingQty);
    };

    const handleManualAllocate = (batch: DailyWorkBatch) => {
        const raw = manualQtyByBatch[batch.id] || "";
        const qty = parseInt(raw, 10);
        submitAllocation(batch, Number.isFinite(qty) ? qty : 0);
    };

    const totalPendingAcrossBatches = useMemo(
        () => batches.reduce((sum, b) => sum + Math.max(0, b.pendingQty), 0),
        [batches]
    );
    const myTotalToday = useMemo(
        () => Object.values(myAllocations).reduce((sum, q) => sum + q, 0),
        [myAllocations]
    );

    const styles = getStyles(isMobile);

    return (
        <div style={styles.root}>
            {/* ---- header ---- */}
            <div style={styles.headerRow}>
                <div>
                    <h2 style={styles.pageTitle}>Today's Allocation</h2>
                    <p style={styles.headerSubtext}>
                        Pick up pending work for yourself — you can only allocate to your own name.
                    </p>
                </div>
                <div style={styles.dateWrap}>
                    <Calendar size={15} color={BRAND.blue} />
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        style={styles.dateInput}
                    />
                </div>
            </div>

            {/* ---- summary strip ---- */}
            <div style={styles.summaryRow}>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Pending across all tasks</span>
                    <span style={{ ...styles.summaryValue, color: BRAND.amber }}>
                        {totalPendingAcrossBatches}
                    </span>
                </div>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Allocated to you today</span>
                    <span style={{ ...styles.summaryValue, color: BRAND.green }}>
                        {myTotalToday}
                    </span>
                </div>
            </div>

            {error && <p style={styles.errorText}>{error}</p>}

            {/* ---- task cards ---- */}
            {loading ? (
                <div style={styles.loadingBox}>Loading today's work…</div>
            ) : batches.length === 0 ? (
                <div style={styles.emptyState}>
                    <EmptyStateIcon />
                    <p style={styles.emptyTitle}>No work logged for this date</p>
                    <p style={styles.emptySubtext}>
                        Once a batch is added for this date, it'll show up here for you to pick up
                        pending units.
                    </p>
                </div>
            ) : (
                <div style={styles.cardGrid}>
                    {batches.map((batch) => {
                        const mode = modeByBatch[batch.id] || "smart";
                        const myQty = myAllocations[batch.id] || 0;
                        const hasPending = batch.pendingQty > 0;
                        const isSubmitting = submittingBatch === batch.id;
                        const progressPct = batch.totalQty
                            ? Math.min(100, Math.round((batch.allocatedQty / batch.totalQty) * 100))
                            : 0;

                        return (
                            <div key={batch.id} style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div style={styles.cardIcon}>
                                        <Box size={18} color={BRAND.blue} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={styles.cardTitle}>
                                            {batch.productName || "Unnamed service"}
                                        </p>
                                        <p style={styles.cardMeta}>
                                            Total {batch.totalQty} · Allocated {batch.allocatedQty}
                                        </p>
                                    </div>
                                    {!hasPending && (
                                        <span style={styles.doneBadge}>
                                            <CheckCircle2 size={13} color={BRAND.green} /> Fully
                                            Allocated
                                        </span>
                                    )}
                                </div>

                                <div style={styles.progressTrack}>
                                    <div
                                        style={{
                                            ...styles.progressFill,
                                            width: `${progressPct}%`,
                                        }}
                                    />
                                </div>

                                <div style={styles.pendingRow}>
                                    <span style={styles.pendingLabel}>Pending</span>
                                    <span
                                        style={{
                                            ...styles.pendingValue,
                                            color: hasPending ? BRAND.amber : BRAND.grey,
                                        }}
                                    >
                                        {Math.max(0, batch.pendingQty)}
                                    </span>
                                </div>

                                {myQty > 0 && (
                                    <p style={styles.myQtyNote}>
                                        You already have <strong>{myQty}</strong> unit(s) allocated
                                        to you on this task today.
                                    </p>
                                )}

                                {hasPending ? (
                                    <>
                                        <div style={styles.modeToggle}>
                                            <button
                                                type="button"
                                                style={{
                                                    ...styles.modeBtn,
                                                    ...(mode === "smart"
                                                        ? styles.modeBtnActive
                                                        : {}),
                                                }}
                                                onClick={() => setMode(batch.id, "smart")}
                                            >
                                                <Zap size={12} /> Smart
                                            </button>
                                            <button
                                                type="button"
                                                style={{
                                                    ...styles.modeBtn,
                                                    ...(mode === "manual"
                                                        ? styles.modeBtnActive
                                                        : {}),
                                                }}
                                                onClick={() => setMode(batch.id, "manual")}
                                            >
                                                <Edit3 size={12} /> Manual
                                            </button>
                                        </div>

                                        {mode === "smart" ? (
                                            <button
                                                type="button"
                                                style={{
                                                    ...styles.primaryBtn,
                                                    opacity: isSubmitting ? 0.7 : 1,
                                                    cursor: isSubmitting
                                                        ? "not-allowed"
                                                        : "pointer",
                                                }}
                                                disabled={isSubmitting}
                                                onClick={() => handleSmartAllocate(batch)}
                                            >
                                                <Zap size={14} color="#fff" />
                                                {isSubmitting
                                                    ? "Allocating…"
                                                    : `Take all pending (${batch.pendingQty})`}
                                            </button>
                                        ) : (
                                            <div style={styles.manualRow}>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={batch.pendingQty}
                                                    placeholder={`Up to ${batch.pendingQty}`}
                                                    value={manualQtyByBatch[batch.id] || ""}
                                                    onChange={(e) =>
                                                        setManualQty(batch.id, e.target.value)
                                                    }
                                                    style={styles.manualInput}
                                                />
                                                <button
                                                    type="button"
                                                    style={{
                                                        ...styles.primaryBtn,
                                                        width: "auto",
                                                        opacity: isSubmitting ? 0.7 : 1,
                                                        cursor: isSubmitting
                                                            ? "not-allowed"
                                                            : "pointer",
                                                    }}
                                                    disabled={isSubmitting}
                                                    onClick={() => handleManualAllocate(batch)}
                                                >
                                                    {isSubmitting ? "Saving…" : "Allocate to me"}
                                                </button>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p style={styles.noPendingNote}>
                                        Nothing left pending on this task — check back once more
                                        work is logged.
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

function getStyles(isMobile: boolean): Record<string, CSSProperties> {
    return {
        root: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            background: "#EAF3FC",
            fontFamily: fontFamily.base,
            padding: isMobile ? "16px" : "24px 28px",
            boxSizing: "border-box",
            gap: 16,
        },
        headerRow: {
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: 12,
        },
        pageTitle: {
            margin: 0,
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        headerSubtext: {
            margin: "4px 0 0",
            fontSize: fontSize.base,
            color: "#767F92",
        },
        dateWrap: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#fff",
            border: "1px solid #ececf5",
            borderRadius: radius.md,
            padding: "8px 14px",
        },
        dateInput: {
            border: "none",
            outline: "none",
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
            color: "#17181C",
            background: "transparent",
        },
        summaryRow: {
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
        },
        summaryCard: {
            flex: "1 1 200px",
            background: "#fff",
            borderRadius: radius.lg,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        },
        summaryLabel: {
            fontSize: fontSize.sm,
            color: "#767F92",
            fontWeight: fontWeight.medium,
        },
        summaryValue: {
            fontSize: fontSize["6xl"],
            fontWeight: fontWeight.bold,
        },
        errorText: {
            color: BRAND.red,
            fontSize: fontSize.base,
            fontWeight: fontWeight.medium,
            margin: 0,
        },
        loadingBox: {
            padding: 40,
            textAlign: "center",
            color: "#767F92",
            fontSize: fontSize.base,
        },
        emptyState: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "48px 20px",
            background: "#fff",
            borderRadius: radius.lg,
            textAlign: "center",
        },
        emptyTitle: {
            margin: "8px 0 0",
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        emptySubtext: {
            margin: 0,
            fontSize: fontSize.sm,
            color: "#767F92",
            maxWidth: 340,
        },
        cardGrid: {
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
        },
        card: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        },
        cardHeader: {
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
        },
        cardIcon: {
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            background: withAlpha(BRAND.blue, 0.08),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        cardTitle: {
            margin: 0,
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        cardMeta: {
            margin: "2px 0 0",
            fontSize: fontSize.xs,
            color: "#767F92",
        },
        doneBadge: {
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.semibold,
            color: BRAND.green,
            background: withAlpha(BRAND.green, 0.1),
            borderRadius: radius.xl,
            padding: "4px 8px",
            whiteSpace: "nowrap",
        },
        progressTrack: {
            height: 6,
            borderRadius: radius.xl,
            background: "#F0F2F7",
            overflow: "hidden",
        },
        progressFill: {
            height: "100%",
            background: GRADIENT,
            borderRadius: radius.xl,
            transition: "width 0.3s ease",
        },
        pendingRow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
        },
        pendingLabel: {
            fontSize: fontSize.sm,
            color: "#767F92",
            fontWeight: fontWeight.medium,
        },
        pendingValue: {
            fontSize: fontSize["2xl"],
            fontWeight: fontWeight.bold,
        },
        myQtyNote: {
            margin: 0,
            fontSize: fontSize.xs,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.06),
            borderRadius: radius.xs,
            padding: "6px 10px",
        },
        modeToggle: {
            display: "flex",
            gap: 6,
            background: "#F4F6FA",
            borderRadius: radius.sm,
            padding: 3,
        },
        modeBtn: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            border: "none",
            background: "transparent",
            borderRadius: radius.xs,
            padding: "6px 10px",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            cursor: "pointer",
        },
        modeBtnActive: {
            background: "#fff",
            color: BRAND.blue,
            boxShadow: "0 2px 6px rgba(0,0,0,.08)",
        },
        primaryBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.sm,
            padding: "10px 14px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            whiteSpace: "nowrap",
        },
        manualRow: {
            display: "flex",
            gap: 8,
        },
        manualInput: {
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            border: "1px solid #ececf5",
            borderRadius: radius.sm,
            fontSize: fontSize.base,
            outline: "none",
            background: "#fafafa",
            color: "#17181C",
        },
        noPendingNote: {
            margin: 0,
            fontSize: fontSize.xs,
            color: "#767F92",
            background: "#F7F8FA",
            borderRadius: radius.xs,
            padding: "8px 10px",
        },
        toast: {
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#17181C",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: radius.md,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            zIndex: 60,
        },
    };
}
