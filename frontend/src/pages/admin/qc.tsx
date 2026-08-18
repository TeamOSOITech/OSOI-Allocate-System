import { useState, useEffect, useMemo } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

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

// ---- minimal inline icons (no external icon library, same set used
// elsewhere in this app e.g. selfallocation.tsx) ----
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
function ShieldCheck({ size = 22, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
function CheckCircle2({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
function XCircle({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
        </svg>
    );
}
function Gauge({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M12 12 16 8" />
            <path d="M4.6 15a9 9 0 1 1 14.8 0" />
        </svg>
    );
}

type Employee = { id: string; name: string; employeeCode: string | null };
type Product = { id: string; product_name: string };
type QcCheck = {
    id: string;
    employeeId: string;
    employeeName: string | null;
    employeeCode: string | null;
    productId: string;
    productName: string | null;
    passQty: number;
    failQty: number;
    qualityScore: number;
    createdAt: string;
};

function scoreColor(score: number) {
    if (score >= 85) return BRAND.green;
    if (score >= 60) return BRAND.amber;
    return BRAND.red;
}

export default function QC() {
    const isMobile = useIsMobile();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [checks, setChecks] = useState<QcCheck[]>([]);
    const [loading, setLoading] = useState(true);

    const [employeeId, setEmployeeId] = useState("");
    const [productId, setProductId] = useState("");
    const [passQty, setPassQty] = useState("");
    const [failQty, setFailQty] = useState("");
    const [qualityScore, setQualityScore] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [empRes, prodRes, qcRes] = await Promise.all([
                authFetch(`${API_BASE}/api/employees`),
                authFetch(`${API_BASE}/api/products`),
                authFetch(`${API_BASE}/api/qc`),
            ]);
            const empJson = await empRes.json();
            const prodJson = await prodRes.json();
            const qcJson = await qcRes.json();

            setEmployees(Array.isArray(empJson) ? empJson : empJson.data || []);
            setProducts(Array.isArray(prodJson) ? prodJson : prodJson.data || []);
            if (qcRes.ok && qcJson.success) setChecks(qcJson.data || []);
        } catch (err: any) {
            setError(err.message || "Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!employeeId || !productId) {
            setError("Select both employee and service");
            return;
        }
        const pass = Number(passQty) || 0;
        const fail = Number(failQty) || 0;
        if (pass === 0 && fail === 0) {
            setError("Enter a Pass or Fail quantity greater than 0");
            return;
        }
        const score = Number(qualityScore);
        if (qualityScore === "" || !Number.isFinite(score) || score < 0 || score > 100) {
            setError("Enter a Quality Score between 0 and 100");
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/qc`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeId,
                    productId,
                    passQty: pass,
                    failQty: fail,
                    qualityScore: score,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to save QC check");
            setSuccess("QC result saved.");
            setEmployeeId("");
            setProductId("");
            setPassQty("");
            setFailQty("");
            setQualityScore("");
            loadAll();
        } catch (err: any) {
            setError(err.message || "Failed to save QC check");
        } finally {
            setSubmitting(false);
        }
    };

    // ---- summary strip: totals across everything currently loaded ----
    const summary = useMemo(() => {
        const totalPass = checks.reduce((s, c) => s + (c.passQty || 0), 0);
        const totalFail = checks.reduce((s, c) => s + (c.failQty || 0), 0);
        const totalUnits = totalPass + totalFail;
        const passRate = totalUnits > 0 ? Math.round((totalPass / totalUnits) * 100) : 0;
        const avgScore =
            checks.length > 0
                ? Math.round(
                      (checks.reduce((s, c) => s + (c.qualityScore || 0), 0) / checks.length) * 10
                  ) / 10
                : 0;
        return { totalPass, totalFail, passRate, avgScore, checksCount: checks.length };
    }, [checks]);

    const styles = getStyles(isMobile);

    return (
        <div style={styles.root}>
            {/* ---- header ---- */}
            <div style={styles.headerRow}>
                <div>
                    <h1 style={styles.title}>Quality Scores</h1>
                    <p style={styles.subtitle}>
                        Record pass/fail counts and a quality score per employee and service.
                    </p>
                </div>
            </div>

            {/* ---- KPI summary strip ---- */}
            <div style={styles.summaryRow}>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Checks logged</span>
                    <span style={{ ...styles.summaryValue, color: BRAND.blue }}>
                        {summary.checksCount}
                    </span>
                </div>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Pass rate</span>
                    <span style={{ ...styles.summaryValue, color: BRAND.green }}>
                        {summary.passRate}%
                    </span>
                </div>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Units failed</span>
                    <span style={{ ...styles.summaryValue, color: BRAND.red }}>
                        {summary.totalFail}
                    </span>
                </div>
                <div style={styles.summaryCard}>
                    <span style={styles.summaryLabel}>Avg quality score</span>
                    <span
                        style={{
                            ...styles.summaryValue,
                            color: scoreColor(summary.avgScore),
                        }}
                    >
                        {summary.avgScore}
                    </span>
                </div>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}
            {success && <div style={styles.successBanner}>{success}</div>}

            {/* ---- entry form ---- */}
            <form style={styles.card} onSubmit={handleSubmit}>
                <p style={styles.cardHeading}>Log a QC result</p>
                <div style={styles.formGrid}>
                    <div>
                        <label style={styles.label}>Employee</label>
                        <select
                            style={styles.select}
                            value={employeeId}
                            onChange={(e) => setEmployeeId(e.target.value)}
                            disabled={loading}
                        >
                            <option value="">-- Select employee --</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.name} {emp.employeeCode ? `(${emp.employeeCode})` : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={styles.label}>Service</label>
                        <select
                            style={styles.select}
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                            disabled={loading}
                        >
                            <option value="">-- Select service --</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={styles.label}>Pass Qty</label>
                        <input
                            style={styles.input}
                            type="number"
                            min={0}
                            value={passQty}
                            onChange={(e) => setPassQty(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                    <div>
                        <label style={styles.label}>Fail Qty</label>
                        <input
                            style={styles.input}
                            type="number"
                            min={0}
                            value={failQty}
                            onChange={(e) => setFailQty(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                    <div>
                        <label style={styles.label}>Quality Score (0-100)</label>
                        <input
                            style={styles.input}
                            type="number"
                            min={0}
                            max={100}
                            value={qualityScore}
                            onChange={(e) => setQualityScore(e.target.value)}
                            placeholder="e.g. 92"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    style={{ ...styles.button, opacity: submitting ? 0.6 : 1 }}
                    disabled={submitting}
                >
                    {submitting ? "Saving..." : "Save QC Result"}
                </button>
            </form>

            {/* ---- recent checks table ---- */}
            <h3 style={styles.sectionTitle}>Recent QC Checks</h3>
            <div style={styles.tableCard}>
                <div style={styles.tableHeadRow}>
                    <span style={{ flex: 1.4 }}>Employee</span>
                    <span style={{ flex: 1.2 }}>Service</span>
                    <span style={{ width: 90, textAlign: "right" }}>Pass</span>
                    <span style={{ width: 90, textAlign: "right" }}>Fail</span>
                    <span style={{ width: 140, textAlign: "right" }}>Quality Score</span>
                </div>
                {loading ? (
                    <div style={styles.emptyNote}>Loading…</div>
                ) : checks.length === 0 ? (
                    <div style={styles.emptyNote}>No QC checks recorded yet.</div>
                ) : (
                    checks.map((c) => (
                        <div key={c.id} style={styles.tableRow}>
                            <span style={{ flex: 1.4, fontSize: fontSize.base, minWidth: 0 }}>
                                {c.employeeName || c.employeeId}
                                {c.employeeCode && (
                                    <span style={styles.tableSubtext}> ({c.employeeCode})</span>
                                )}
                            </span>
                            <span style={{ flex: 1.2, fontSize: fontSize.base }}>
                                {c.productName || "-"}
                            </span>
                            <span style={{ width: 90, textAlign: "right" }}>
                                <span style={styles.passPill}>
                                    <CheckCircle2 size={12} /> {c.passQty}
                                </span>
                            </span>
                            <span style={{ width: 90, textAlign: "right" }}>
                                <span style={styles.failPill}>
                                    <XCircle size={12} /> {c.failQty}
                                </span>
                            </span>
                            <span style={{ width: 140, textAlign: "right" }}>
                                <span
                                    style={{
                                        ...styles.scorePill,
                                        color: scoreColor(c.qualityScore),
                                        background: withAlpha(scoreColor(c.qualityScore), 0.1),
                                    }}
                                >
                                    <Gauge size={12} /> {c.qualityScore}
                                </span>
                            </span>
                        </div>
                    ))
                )}
            </div>
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
            width: "100%",
        },
        headerRow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
        },
        title: {
            margin: 0,
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            textAlign: "left",
        },
        subtitle: {
            margin: "4px 0 0",
            fontSize: fontSize.base,
            color: "#767F92",
            textAlign: "left",
        },
        summaryRow: {
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
        },
        summaryCard: {
            flex: "1 1 180px",
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
        errorBanner: {
            background: "#FEF2F2",
            color: BRAND.red,
            border: "1px solid #FECACA",
            borderRadius: radius.sm,
            padding: "10px 14px",
            fontSize: fontSize.base,
        },
        successBanner: {
            background: "rgba(46,187,168,0.1)",
            color: BRAND.green,
            border: `1px solid ${BRAND.green}`,
            borderRadius: radius.sm,
            padding: "10px 14px",
            fontSize: fontSize.base,
        },
        card: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 22,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        },
        cardHeading: {
            margin: "0 0 14px",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        formGrid: {
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
            gap: 16,
        },
        label: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#374151",
            display: "block",
            marginBottom: 6,
        },
        select: {
            width: "100%",
            padding: "10px 12px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.base,
            background: "#fafafa",
            boxSizing: "border-box",
        },
        input: {
            width: "100%",
            padding: "10px 12px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.base,
            background: "#fafafa",
            boxSizing: "border-box",
        },
        button: {
            marginTop: 18,
            padding: "11px 26px",
            borderRadius: radius["2xl"],
            border: "none",
            background: GRADIENT,
            color: "#fff",
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.md,
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.3)}`,
            cursor: "pointer",
        },
        sectionTitle: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            margin: "4px 0 0",
        },
        tableCard: {
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
            overflow: "hidden",
        },
        tableHeadRow: {
            display: "flex",
            padding: "12px 18px",
            background: "#F4F8FD",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
        },
        tableRow: {
            display: "flex",
            padding: "12px 18px",
            borderTop: "1px solid #f1f1f1",
            alignItems: "center",
            gap: 8,
        },
        tableSubtext: {
            color: "#9ca3af",
            fontSize: fontSize.xs,
        },
        passPill: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: BRAND.green,
        },
        failPill: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: BRAND.red,
        },
        scorePill: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            padding: "3px 10px",
            borderRadius: radius.xl,
        },
        emptyNote: {
            padding: "24px",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: fontSize.base,
        },
    };
}
