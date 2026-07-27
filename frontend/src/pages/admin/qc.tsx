import { useState, useEffect } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
};

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

type Employee = { id: string; name: string; employeeCode: string | null };
type Product = { id: string; product_name: string };
type QcCheck = {
    id: string;
    employeeId: string;
    productId: string;
    productName: string | null;
    passQty: number;
    failQty: number;
    createdAt: string;
};

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
            setError("Select both employee and product");
            return;
        }
        const pass = Number(passQty) || 0;
        const fail = Number(failQty) || 0;
        if (pass === 0 && fail === 0) {
            setError("Enter a Pass or Fail quantity greater than 0");
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/qc`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ employeeId, productId, passQty: pass, failQty: fail }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to save QC check");
            setSuccess("QC result saved.");
            setEmployeeId("");
            setProductId("");
            setPassQty("");
            setFailQty("");
            loadAll();
        } catch (err: any) {
            setError(err.message || "Failed to save QC check");
        } finally {
            setSubmitting(false);
        }
    };

    const employeeName = (id: string) => employees.find((e) => e.id === id)?.name || id;

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.header}>
                <h1 style={styles.title}>Quality Check</h1>
                <p style={styles.subtitle}>Record pass/fail counts per employee and product.</p>
            </div>

            {error && <div style={styles.errorBanner}>{error}</div>}
            {success && <div style={styles.successBanner}>{success}</div>}

            <form style={styles.card} onSubmit={handleSubmit}>
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
                        <label style={styles.label}>Product</label>
                        <select
                            style={styles.select}
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                            disabled={loading}
                        >
                            <option value="">-- Select product --</option>
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
                </div>

                <button
                    type="submit"
                    style={{ ...styles.button, opacity: submitting ? 0.6 : 1 }}
                    disabled={submitting}
                >
                    {submitting ? "Saving..." : "Save QC Result"}
                </button>
            </form>

            <h3 style={styles.sectionTitle}>Recent QC Checks</h3>
            <div style={styles.tableCard}>
                <div style={styles.tableHeadRow}>
                    <span style={{ flex: 1.4 }}>Employee</span>
                    <span style={{ flex: 1.2 }}>Product</span>
                    <span style={{ width: 70, textAlign: "right" }}>Pass</span>
                    <span style={{ width: 70, textAlign: "right" }}>Fail</span>
                </div>
                {checks.length === 0 ? (
                    <div style={styles.emptyNote}>No QC checks recorded yet.</div>
                ) : (
                    checks.map((c) => (
                        <div key={c.id} style={styles.tableRow}>
                            <span style={{ flex: 1.4, fontSize: 13 }}>
                                {employeeName(c.employeeId)}
                            </span>
                            <span style={{ flex: 1.2, fontSize: 13 }}>{c.productName || "-"}</span>
                            <span
                                style={{
                                    width: 70,
                                    textAlign: "right",
                                    color: BRAND.green,
                                    fontWeight: 600,
                                }}
                            >
                                {c.passQty}
                            </span>
                            <span
                                style={{
                                    width: 70,
                                    textAlign: "right",
                                    color: BRAND.red,
                                    fontWeight: 600,
                                }}
                            >
                                {c.failQty}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { padding: "28px 32px", maxWidth: 860 },
    rootMobile: { padding: "16px" },
    header: { marginBottom: 20 },
    title: { fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: 0 },
    subtitle: { fontSize: 13, color: "#6b7280", marginTop: 6 },
    errorBanner: {
        background: "#FEF2F2",
        color: BRAND.red,
        border: "1px solid #FECACA",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 16,
    },
    successBanner: {
        background: "rgba(46,187,168,0.1)",
        color: BRAND.green,
        border: `1px solid ${BRAND.green}`,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 16,
    },
    card: {
        background: "#fff",
        borderRadius: 12,
        padding: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    },
    formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
    label: { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 },
    select: {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #d1d5db",
        fontSize: 13,
    },
    input: {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #d1d5db",
        fontSize: 13,
    },
    button: {
        marginTop: 18,
        padding: "10px 24px",
        borderRadius: 8,
        border: "none",
        background: BRAND.blue,
        color: "#fff",
        fontWeight: 600,
        fontSize: 14,
    },
    sectionTitle: { fontSize: 15, fontWeight: 700, color: "#1a1a2e", margin: "24px 0 10px" },
    tableCard: {
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        overflow: "hidden",
    },
    tableHeadRow: {
        display: "flex",
        padding: "10px 16px",
        background: "#f9fafb",
        fontSize: 11,
        fontWeight: 600,
        color: "#6b7280",
        textTransform: "uppercase",
    },
    tableRow: {
        display: "flex",
        padding: "10px 16px",
        borderTop: "1px solid #f1f1f1",
        alignItems: "center",
    },
    emptyNote: { padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: 13 },
};
