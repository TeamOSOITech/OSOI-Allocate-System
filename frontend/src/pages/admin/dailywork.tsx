import { useState, useEffect, useMemo } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";

const MOBILE_BREAKPOINT = 768;
const PAGE_SIZE = 5;

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

const API_BASE = import.meta.env.VITE_API_URL;

type Product = {
    id: string;
    product_name: string;
};

type DailyWorkBatch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
    status: string;
    createdAt?: string;
};

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso: string) {
    // "2026-07-27" -> "27-07-2026"
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

export default function DailyWork() {
    const isMobile = useIsMobile();

    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);

    const [batches, setBatches] = useState<DailyWorkBatch[]>([]);
    const [batchesLoading, setBatchesLoading] = useState(true);
    const [batchesError, setBatchesError] = useState("");

    const [employeeCount, setEmployeeCount] = useState<number | null>(null);

    const [workDate, setWorkDate] = useState(todayStr());
    const [productId, setProductId] = useState("");
    const [totalQty, setTotalQty] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const [formSuccess, setFormSuccess] = useState("");

    const [page, setPage] = useState(1);

    const fetchProducts = async () => {
        setProductsLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setProducts(json.data || []);
        } catch (err: any) {
            console.error("Failed to fetch products:", err);
        } finally {
            setProductsLoading(false);
        }
    };

    const fetchBatches = async () => {
        setBatchesLoading(true);
        setBatchesError("");
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setBatches(json.data || []);
        } catch (err: any) {
            console.error("Failed to fetch daily work batches:", err);
            setBatchesError(err?.message || "Failed to load daily work batches.");
        } finally {
            setBatchesLoading(false);
        }
    };

    const fetchEmployeeCount = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employees`);
            const json = await res.json();
            if (!res.ok) return;
            // employees endpoint returns a plain array, not { data: [...] }
            const list = Array.isArray(json) ? json : json.data || [];
            setEmployeeCount(list.length);
        } catch (err) {
            console.error("Failed to fetch employee count:", err);
        }
    };

    useEffect(() => {
        fetchProducts();
        fetchBatches();
        fetchEmployeeCount();
    }, []);

    const todayBatches = useMemo(
        () => batches.filter((b) => b.workDate === workDate || b.workDate === todayStr()),
        [batches]
    );

    const totalAllocated = useMemo(
        () => batches.reduce((sum, b) => sum + (b.allocatedQty || 0), 0),
        [batches]
    );
    const totalPending = useMemo(
        () => batches.reduce((sum, b) => sum + (b.pendingQty || 0), 0),
        [batches]
    );

    const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
    const pagedBatches = batches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");

        if (!workDate || !productId || !totalQty) {
            setFormError("Date, product, and total quantity are all required.");
            return;
        }
        const qty = Number(totalQty);
        if (!Number.isFinite(qty) || qty <= 0) {
            setFormError("Total quantity must be a positive number.");
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workDate, productId, totalQty: qty }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

            setFormSuccess("Daily work batch logged.");
            setTotalQty("");
            setProductId("");
            setPage(1);
            fetchBatches();
        } catch (err: any) {
            setFormError(err?.message || "Failed to log daily work.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            {/* Top gradient accent bar */}
            <div style={styles.topBar} />

            <div style={styles.contentBody}>
                {/* Header row: icon + title + breadcrumb */}
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div style={styles.headerIcon}>
                            <i className="ti ti-clipboard-plus" style={{ fontSize: 22 }} />
                        </div>
                        <div>
                            <h1 style={styles.pageTitle}>Daily Work</h1>
                            <p style={styles.pageSubtitle}>
                                Log today's total quantity received per product — this is the pool
                                that Smart Auto Allocation and Manual Allocation split across
                                present employees.
                            </p>
                        </div>
                    </div>

                    {!isMobile && (
                        <div style={styles.breadcrumb}>
                            <i className="ti ti-home" style={{ fontSize: 14 }} />
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbItem}>Dashboard</span>
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbActive}>Daily Work</span>
                        </div>
                    )}
                </div>

                {/* KPI cards */}
                <div style={isMobile ? styles.kpiRowMobile : styles.kpiRow}>
                    <KpiCard
                        icon="ti ti-package"
                        iconBg="linear-gradient(135deg, #6366f1, #4338ca)"
                        label="Products"
                        value={products.length}
                        footer="Total Products"
                        dotColor="#4338ca"
                    />
                    <KpiCard
                        icon="ti ti-users"
                        iconBg="linear-gradient(135deg, #38bdf8, #2563eb)"
                        label="Allocated"
                        value={totalAllocated}
                        footer="Total Allocated"
                        dotColor="#2563eb"
                    />
                    <KpiCard
                        icon="ti ti-check"
                        iconBg="linear-gradient(135deg, #34d399, #059669)"
                        label="Pending"
                        value={totalPending}
                        footer="Total Pending"
                        dotColor="#059669"
                    />
                    <KpiCard
                        icon="ti ti-users-group"
                        iconBg="linear-gradient(135deg, #c084fc, #9333ea)"
                        label="Employees"
                        value={employeeCount ?? "-"}
                        footer="Total Employees"
                        dotColor="#9333ea"
                    />
                </div>

                <div style={isMobile ? styles.contentRowMobile : styles.contentRow}>
                    {/* Form panel */}
                    <div style={styles.formPanel}>
                        <div style={styles.formPanelHeader}>
                            <i className="ti ti-edit" style={{ fontSize: 16 }} />
                            <span>Log Production</span>
                        </div>

                        <form onSubmit={handleSubmit} style={styles.form}>
                            <label style={styles.label}>
                                <span style={styles.labelText}>
                                    <i className="ti ti-calendar" style={styles.labelIcon} />
                                    Date
                                </span>
                                <input
                                    type="date"
                                    value={workDate}
                                    onChange={(e) => setWorkDate(e.target.value)}
                                    style={styles.input}
                                    required
                                />
                            </label>

                            <label style={styles.label}>
                                <span style={styles.labelText}>
                                    <i className="ti ti-package" style={styles.labelIcon} />
                                    Product
                                </span>
                                <select
                                    value={productId}
                                    onChange={(e) => setProductId(e.target.value)}
                                    style={styles.input}
                                    required
                                    disabled={productsLoading}
                                >
                                    <option value="">
                                        {productsLoading
                                            ? "Loading products..."
                                            : "Select a product"}
                                    </option>
                                    {products.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.product_name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label style={styles.label}>
                                <span style={styles.labelText}>
                                    <i className="ti ti-hash" style={styles.labelIcon} />
                                    Total Quantity
                                </span>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={totalQty}
                                    onChange={(e) => setTotalQty(e.target.value)}
                                    style={styles.input}
                                    placeholder="e.g. 500"
                                    required
                                />
                            </label>

                            {formError && (
                                <div style={styles.formError}>
                                    <i className="ti ti-alert-triangle" style={{ fontSize: 14 }} />
                                    {formError}
                                </div>
                            )}
                            {formSuccess && (
                                <div style={styles.formSuccess}>
                                    <i className="ti ti-circle-check" style={{ fontSize: 14 }} />
                                    {formSuccess}
                                </div>
                            )}

                            <button type="submit" style={styles.submitBtn} disabled={submitting}>
                                <i className="ti ti-device-floppy" style={{ fontSize: 15 }} />
                                {submitting ? "Saving..." : "Save Daily Work"}
                            </button>
                        </form>
                    </div>

                    {/* Table panel */}
                    <div style={styles.listPanel}>
                        <div style={styles.listPanelHeader}>
                            <div style={styles.listPanelTitle}>
                                <i className="ti ti-chart-bar" style={{ fontSize: 16 }} />
                                <span>Today's Production</span>
                            </div>
                            <div style={styles.dateBadge}>
                                <i className="ti ti-calendar" style={{ fontSize: 12 }} />
                                {formatDisplayDate(todayStr())}
                            </div>
                        </div>

                        <div style={styles.tableScroll}>
                            <div style={styles.tableHead}>
                                <span style={{ ...styles.tableHeadLabel, flex: 1.1 }}>Date</span>
                                <span style={{ ...styles.tableHeadLabel, flex: 1.6 }}>Product</span>
                                <span style={styles.tableHeadLabel}>Total</span>
                                <span style={styles.tableHeadLabel}>Allocated</span>
                                <span style={styles.tableHeadLabel}>Pending</span>
                            </div>

                            <div style={styles.tableBody}>
                                {batchesLoading ? (
                                    <div style={styles.emptyState}>Loading daily work...</div>
                                ) : batchesError ? (
                                    <div style={styles.emptyState}>{batchesError}</div>
                                ) : pagedBatches.length === 0 ? (
                                    <div style={styles.emptyState}>No daily work logged yet.</div>
                                ) : (
                                    pagedBatches.map((b, idx) => (
                                        <div
                                            key={b.id}
                                            style={{
                                                ...styles.tableRow,
                                                background: idx % 2 === 0 ? "#fff" : "#fafaff",
                                            }}
                                        >
                                            <span style={{ flex: 1.1 }}>
                                                {formatDisplayDate(b.workDate)}
                                            </span>
                                            <span
                                                style={{
                                                    flex: 1.6,
                                                    fontWeight: 600,
                                                    color: "#312e81",
                                                }}
                                            >
                                                {b.productName || "-"}
                                            </span>
                                            <span style={{ flex: 1 }}>
                                                <Pill value={b.totalQty} tone="blue" />
                                            </span>
                                            <span style={{ flex: 1 }}>
                                                <Pill value={b.allocatedQty} tone="green" />
                                            </span>
                                            <span style={{ flex: 1 }}>
                                                <Pill
                                                    value={b.pendingQty}
                                                    tone={b.pendingQty > 0 ? "amber" : "teal"}
                                                />
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div style={styles.tableFooter}>
                            <span style={styles.tableFooterText}>
                                <i className="ti ti-info-circle" style={{ fontSize: 13 }} />
                                {batches.length === 0
                                    ? "No entries yet"
                                    : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                                          page * PAGE_SIZE,
                                          batches.length
                                      )} of ${batches.length} entries`}
                            </span>

                            <div style={styles.pagination}>
                                <button
                                    style={styles.pageBtn}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                >
                                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
                                </button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .slice(0, 4)
                                    .map((n) => (
                                        <button
                                            key={n}
                                            style={{
                                                ...styles.pageBtn,
                                                ...(n === page ? styles.pageBtnActive : {}),
                                            }}
                                            onClick={() => setPage(n)}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                <button
                                    style={styles.pageBtn}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                >
                                    <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function KpiCard({
    icon,
    iconBg,
    label,
    value,
    footer,
    dotColor,
}: {
    icon: string;
    iconBg: string;
    label: string;
    value: number | string;
    footer: string;
    dotColor: string;
}) {
    return (
        <div style={styles.kpiCard}>
            <div style={styles.kpiTop}>
                <div style={{ ...styles.kpiIcon, background: iconBg }}>
                    <i className={icon} style={{ fontSize: 20, color: "#fff" }} />
                </div>
                <div>
                    <div style={styles.kpiLabel}>{label}</div>
                    <div style={styles.kpiValue}>{value}</div>
                </div>
            </div>
            <div style={styles.kpiFooter}>
                <span>{footer}</span>
                <span style={{ ...styles.kpiDot, background: dotColor }}>
                    <i className="ti ti-arrow-right" style={{ fontSize: 10, color: "#fff" }} />
                </span>
            </div>
        </div>
    );
}

const PILL_TONES: Record<string, { bg: string; fg: string }> = {
    blue: { bg: "#dbeafe", fg: "#1d4ed8" },
    green: { bg: "#dcfce7", fg: "#15803d" },
    amber: { bg: "#fef3c7", fg: "#b45309" },
    teal: { bg: "#ccfbf1", fg: "#0f766e" },
};

function Pill({ value, tone }: { value: number; tone: keyof typeof PILL_TONES }) {
    const t = PILL_TONES[tone];
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 28,
                padding: "3px 9px",
                borderRadius: "999px",
                background: t.bg,
                color: t.fg,
                fontSize: "12px",
                fontWeight: 700,
            }}
        >
            {value}
        </span>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        width: "100%",
        minHeight: "100%",
        background: "#f4f5fb",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    rootMobile: {
        width: "100%",
        minHeight: "100%",
        background: "#f0f0f5",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    topBar: {
        height: "4px",
        width: "100%",
        background: "linear-gradient(90deg, #6d28d9, #4338ca, #0ea5a4, #10b981)",
    },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "20px 24px 28px",
    },

    headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
    headerRowMobile: { display: "flex", flexDirection: "column", gap: "10px" },
    headerLeft: { display: "flex", gap: "14px", alignItems: "flex-start" },
    headerIcon: {
        width: 42,
        height: 42,
        borderRadius: "10px",
        background: "linear-gradient(135deg, #6366f1, #4338ca)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    pageTitle: { fontSize: "20px", fontWeight: 800, color: "#1e1b4b", margin: 0 },
    pageSubtitle: {
        fontSize: "12px",
        color: "#64748b",
        margin: "4px 0 0",
        maxWidth: 520,
        lineHeight: 1.5,
    },
    breadcrumb: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "#64748b",
        marginTop: "6px",
    },
    breadcrumbSep: { color: "#c7cbe0" },
    breadcrumbItem: { color: "#64748b" },
    breadcrumbActive: { color: "#4338ca", fontWeight: 700 },

    kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" },
    kpiRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    kpiCard: {
        background: "#fff",
        borderRadius: "14px",
        padding: "16px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    kpiTop: { display: "flex", alignItems: "center", gap: "12px" },
    kpiIcon: {
        width: 44,
        height: 44,
        borderRadius: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    kpiLabel: { fontSize: "12px", fontWeight: 600, color: "#4338ca" },
    kpiValue: { fontSize: "22px", fontWeight: 800, color: "#1e1b4b" },
    kpiFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "11px",
        color: "#94a3b8",
        borderTop: "1px solid #f1f1f7",
        paddingTop: "10px",
    },
    kpiDot: {
        width: 18,
        height: 18,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },

    contentRow: {
        display: "grid",
        gridTemplateColumns: "0.85fr 1.6fr",
        gap: "16px",
        alignItems: "start",
    },
    contentRowMobile: { display: "flex", flexDirection: "column", gap: "16px" },

    formPanel: {
        background: "#fff",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    formPanelHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "14px 18px",
        background: "linear-gradient(90deg, #4338ca, #2563eb)",
        color: "#fff",
        fontSize: "14px",
        fontWeight: 700,
    },
    form: { display: "flex", flexDirection: "column", gap: "14px", padding: "18px" },
    label: { display: "flex", flexDirection: "column", gap: "6px" },
    labelText: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#374151",
    },
    labelIcon: { fontSize: 13, color: "#6366f1" },
    input: {
        border: "1px solid #e2e4f0",
        borderRadius: "8px",
        padding: "9px 12px",
        fontSize: "13px",
        color: "#1e1b4b",
        outline: "none",
        fontFamily: "inherit",
        background: "#fafaff",
    },
    formError: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#fef3e2",
        border: "1px solid #fde3b0",
        color: "#b45309",
        fontSize: "12px",
        padding: "9px 10px",
        borderRadius: "8px",
    },
    formSuccess: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#eaf7ec",
        color: "#1f7a34",
        fontSize: "12px",
        padding: "9px 10px",
        borderRadius: "8px",
    },
    submitBtn: {
        marginTop: "4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        background: "linear-gradient(90deg, #4338ca, #2563eb)",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        padding: "11px 14px",
        fontSize: "13px",
        fontWeight: 700,
        cursor: "pointer",
    },

    listPanel: {
        background: "#fff",
        borderRadius: "14px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    listPanelHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 18px",
    },
    listPanelTitle: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "14px",
        fontWeight: 700,
        color: "#1e1b4b",
    },
    dateBadge: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#eef2ff",
        color: "#4338ca",
        fontSize: "11px",
        fontWeight: 700,
        padding: "5px 10px",
        borderRadius: "999px",
    },
    tableScroll: { maxHeight: 340, overflowY: "auto" },
    tableHead: {
        display: "flex",
        padding: "10px 18px",
        background: "linear-gradient(90deg, #4338ca, #2563eb)",
        gap: "8px",
    },
    tableHeadLabel: { flex: 1, fontSize: "11.5px", fontWeight: 700, color: "#e0e7ff" },
    tableBody: { flex: 1 },
    tableRow: {
        display: "flex",
        alignItems: "center",
        padding: "10px 18px",
        borderBottom: "1px solid #f1f1f7",
        fontSize: "13px",
        color: "#374151",
        gap: "8px",
    },
    emptyState: { padding: "24px", textAlign: "center", color: "#999", fontSize: "12px" },

    tableFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 18px",
        borderTop: "1px solid #f1f1f7",
        flexWrap: "wrap",
        gap: "10px",
    },
    tableFooterText: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11.5px",
        color: "#94a3b8",
    },
    pagination: { display: "flex", gap: "6px" },
    pageBtn: {
        width: 28,
        height: 28,
        borderRadius: "7px",
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "#4338ca",
        fontSize: "12px",
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    pageBtnActive: {
        background: "linear-gradient(90deg, #4338ca, #2563eb)",
        color: "#fff",
        border: "none",
    },
};
