import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 10;
const MOBILE_BREAKPOINT = 768;

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

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

function withBrandAlpha(varName: "blue" | "lightBlue" | "green", alpha: number) {
    const rgbVar =
        varName === "blue"
            ? "--brand-blue-rgb"
            : varName === "lightBlue"
              ? "--brand-light-blue-rgb"
              : "--brand-green-rgb";
    return `rgba(var(${rgbVar}), ${alpha})`;
}

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

type Product = { id: string; product_name: string };
type Client = { id: string; name: string };
type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientId: string | null;
    clientName: string | null;
    workDate: string;
    sequenceNumber: number;
    createdAt: string;
};

export default function ServiceCases() {
    const isMobile = useIsMobile();
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    // NEW: Case Register — Client column. Fetched once, same list the
    // Clients page uses, just for the inline dropdown here.
    const [clients, setClients] = useState<Client[]>([]);

    // ---- left side: same shape as Daily Work's form (service + qty) ----
    const [workDate, setWorkDate] = useState(todayStr());
    const [productId, setProductId] = useState("");
    // NEW: pick the Client at creation time too — still editable later
    // from the table, this just saves that extra edit for the common case.
    const [formClientId, setFormClientId] = useState("");
    const [quantity, setQuantity] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const [formSuccess, setFormSuccess] = useState("");

    // ---- NEW: "Auto-generate" (original quantity-based flow, untouched
    // above) vs "Upload" — for orgs that already have their own case
    // numbering (e.g. a client-provided case ID) and want to bring in
    // custom/random case numbers via an Excel sheet instead of the
    // auto-generated CASEB001-style numbers. Service + Date still come
    // from the same dropdown/date picker either way — only the case
    // numbers themselves come from the sheet in Upload mode.
    const [formMode, setFormMode] = useState<"auto" | "upload">("auto");
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadResult, setUploadResult] = useState<{
        createdCount: number;
        skippedCount: number;
        totalRows: number;
    } | null>(null);

    // ---- right side: individual case rows, filterable + paginated ----
    const [cases, setCases] = useState<ServiceCase[]>([]);
    const [casesLoading, setCasesLoading] = useState(true);
    const [casesError, setCasesError] = useState("");
    const [filterProductId, setFilterProductId] = useState("");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCases, setTotalCases] = useState(0);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState("");
    // NEW: Case Register — inline Client edit. Tracks which row's
    // dropdown is mid-save so it can be disabled/greyed while saving.
    const [savingClientId, setSavingClientId] = useState<string | null>(null);
    const [clientEditError, setClientEditError] = useState("");

    const fetchProducts = useCallback(async () => {
        setProductsLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setProducts(json.data || []);
        } catch (err) {
            console.error("Failed to fetch products:", err);
        } finally {
            setProductsLoading(false);
        }
    }, []);

    // NEW: Case Register — Client column dropdown options.
    const fetchClients = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/clients`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // NOTE: /api/clients returns a raw array (no {success, data}
            // envelope), same as clients.tsx already assumes.
            const json = await res.json();
            const list = Array.isArray(json) ? json : json?.data || [];
            setClients(list.map((c: any) => ({ id: c.id, name: c.name })));
        } catch (err) {
            console.error("Failed to fetch clients:", err);
        }
    }, []);

    const fetchCases = useCallback(async () => {
        setCasesLoading(true);
        setCasesError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("pageSize", String(PAGE_SIZE));
            if (filterProductId) params.set("productId", filterProductId);

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setCases(json.data || []);
            setTotalPages(json.pagination?.totalPages || 1);
            setTotalCases(json.pagination?.total || 0);
        } catch (err: any) {
            console.error("Failed to fetch service cases:", err);
            setCasesError(err?.message || "Failed to load cases.");
        } finally {
            setCasesLoading(false);
        }
    }, [page, filterProductId]);

    useEffect(() => {
        fetchProducts();
        fetchClients();
    }, [fetchProducts, fetchClients]);

    // FIX: previously defaulted to "All services", which mixed every
    // service's cases together in one list (Billings and TC rows
    // interleaved on the same page). Services must stay fully separate,
    // so as soon as the product list loads, auto-select the first
    // service — the filter dropdown below no longer offers an "All
    // services" option at all.
    useEffect(() => {
        if (!filterProductId && products.length > 0) {
            setFilterProductId(products[0].id);
        }
    }, [products, filterProductId]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    // Filter change should always jump back to page 1 — staying on page 4
    // of an unfiltered list while filtering down to a service with only 1
    // page of results would just show an empty page.
    useEffect(() => {
        setPage(1);
    }, [filterProductId]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");

        if (!productId) {
            setFormError("Select a service.");
            return;
        }
        const qty = parseInt(quantity, 10);
        if (!Number.isFinite(qty) || qty <= 0) {
            setFormError("Enter a quantity greater than 0.");
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId,
                    quantity: qty,
                    workDate,
                    clientId: formClientId || null,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to create cases");
            setFormSuccess(json.message || "Cases created.");
            setQuantity("");
            // Switch the filter to the service just logged, so the newly
            // created cases are immediately visible (services are always
            // shown separately now, never mixed together).
            setFilterProductId(productId);
            setPage(1);
            fetchCases();
        } catch (err: any) {
            setFormError(err?.message || "Something went wrong.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleUploadSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");
        setUploadResult(null);

        if (!productId) {
            setFormError("Select a service.");
            return;
        }
        if (!uploadFile) {
            setFormError("Choose a file to upload.");
            return;
        }

        setSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("file", uploadFile);
            formData.append("productId", productId);
            formData.append("workDate", workDate);
            if (formClientId) formData.append("clientId", formClientId);

            const res = await authFetch(`${API_BASE}/api/service-cases/upload`, {
                method: "POST",
                body: formData,
            });
            // The server can 404/500 with an HTML error page instead of
            // JSON (e.g. if this endpoint isn't deployed on the backend
            // yet) — res.json() would throw a confusing raw parse error
            // in that case, so check the content-type first and surface
            // a clear message instead.
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(
                    res.status === 404
                        ? "Upload endpoint not found (HTTP 404) — the backend may not have this feature deployed yet."
                        : `Server returned an unexpected response (HTTP ${res.status}).`
                );
            }
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to upload cases");
            setFormSuccess(json.message || "Cases uploaded.");
            setUploadResult(json.data || null);
            setUploadFile(null);
            setFilterProductId(productId);
            setPage(1);
            fetchCases();
        } catch (err: any) {
            setFormError(err?.message || "Something went wrong.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (c: ServiceCase) => {
        if (!window.confirm(`Delete ${c.caseNumber}? This can't be undone.`)) return;
        setDeleteError("");
        setDeletingId(c.id);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to delete");
            // If this was the only row on the current page (and we're not
            // on page 1), step back a page so we don't land on an empty one.
            if (cases.length === 1 && page > 1) {
                setPage((p) => p - 1);
            } else {
                fetchCases();
            }
        } catch (err: any) {
            setDeleteError(err?.message || "Failed to delete case");
        } finally {
            setDeletingId(null);
        }
    };

    // NEW: Case Register — inline Client edit. Only this column is
    // editable in the table; case number/service/date stay read-only.
    const handleClientChange = async (c: ServiceCase, newClientId: string) => {
        setClientEditError("");
        setSavingClientId(c.id);
        // Optimistic update so the dropdown reflects the choice immediately.
        const prevClientId = c.clientId;
        const prevClientName = c.clientName;
        const newClientName = clients.find((cl) => cl.id === newClientId)?.name || null;
        setCases((prev) =>
            prev.map((row) =>
                row.id === c.id
                    ? { ...row, clientId: newClientId || null, clientName: newClientName }
                    : row
            )
        );
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}/client`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: newClientId || null }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to update client");
        } catch (err: any) {
            // Roll back on failure.
            setCases((prev) =>
                prev.map((row) =>
                    row.id === c.id
                        ? { ...row, clientId: prevClientId, clientName: prevClientName }
                        : row
                )
            );
            setClientEditError(err?.message || "Failed to update client");
        } finally {
            setSavingClientId(null);
        }
    };

    const styles = getStyles(isMobile);

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                {/* ---- header ---- */}
                <div style={styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div style={styles.headerIcon}>
                            <i
                                className="ti ti-list-numbers"
                                style={{ fontSize: fontSize["4xl"] }}
                            />
                        </div>
                        <div>
                            <h1 style={styles.pageTitle}>Case Register</h1>
                            <p style={styles.headerSubtext}>
                                Log a service and quantity — one case number is generated per unit,
                                continuing the running count for that service.
                            </p>
                        </div>
                    </div>
                </div>

                <div style={styles.layout}>
                    {/* ---- LEFT: add form (same shape as Daily Work) ---- */}
                    <form
                        style={styles.formCard}
                        onSubmit={formMode === "auto" ? handleSubmit : handleUploadSubmit}
                    >
                        <p style={styles.cardHeading}>Log Cases</p>

                        {/* Mode toggle — Auto-generate (original quantity-based
                            flow, unchanged) vs Upload (custom case numbers from
                            an Excel/CSV sheet, for orgs with their own numbering). */}
                        <div style={styles.modeToggleRow}>
                            <button
                                type="button"
                                style={{
                                    ...styles.modeToggleBtn,
                                    ...(formMode === "auto" ? styles.modeToggleBtnActive : {}),
                                }}
                                onClick={() => {
                                    setFormMode("auto");
                                    setFormError("");
                                    setFormSuccess("");
                                    setUploadResult(null);
                                }}
                            >
                                Auto-generate
                            </button>
                            <button
                                type="button"
                                style={{
                                    ...styles.modeToggleBtn,
                                    ...(formMode === "upload" ? styles.modeToggleBtnActive : {}),
                                }}
                                onClick={() => {
                                    setFormMode("upload");
                                    setFormError("");
                                    setFormSuccess("");
                                    setUploadResult(null);
                                }}
                            >
                                Upload Case Numbers
                            </button>
                        </div>

                        <label style={styles.label}>Date</label>
                        <input
                            type="date"
                            style={styles.input}
                            value={workDate}
                            onChange={(e) => setWorkDate(e.target.value)}
                        />

                        <label style={styles.label}>Service</label>
                        <select
                            style={styles.input}
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                            disabled={productsLoading}
                        >
                            <option value="">-- Select service --</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>

                        <label style={styles.label}>Client</label>
                        <select
                            style={styles.input}
                            value={formClientId}
                            onChange={(e) => setFormClientId(e.target.value)}
                        >
                            <option value="">-- Select client --</option>
                            {clients.map((cl) => (
                                <option key={cl.id} value={cl.id}>
                                    {cl.name}
                                </option>
                            ))}
                        </select>
                        <p style={styles.helperNote}>
                            Optional — can be set or changed later from the table too.
                        </p>

                        {formMode === "auto" ? (
                            <>
                                <label style={styles.label}>Quantity</label>
                                <input
                                    type="number"
                                    min={1}
                                    style={styles.input}
                                    value={quantity}
                                    onChange={(e) => setQuantity(e.target.value)}
                                    placeholder="e.g. 10"
                                />
                                <p style={styles.helperNote}>
                                    One case number is created per unit — entering 10 here creates
                                    10 individual case rows.
                                </p>
                            </>
                        ) : (
                            <>
                                <label style={styles.label}>Case Numbers File</label>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    style={styles.input}
                                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                />
                                <p style={styles.helperNote}>
                                    Upload a .xlsx/.xls/.csv file with a "Case Number" column — any
                                    values, in any order. One case row is created per value, under
                                    the Service and Date picked above. Case numbers that already
                                    exist, or repeat in the file, are skipped and reported below.
                                </p>
                            </>
                        )}

                        {formError && <p style={styles.errorText}>{formError}</p>}
                        {formSuccess && <p style={styles.successText}>{formSuccess}</p>}
                        {uploadResult && uploadResult.skippedCount > 0 && (
                            <p style={styles.helperNote}>
                                {uploadResult.createdCount} created, {uploadResult.skippedCount}{" "}
                                skipped out of {uploadResult.totalRows} row(s).
                            </p>
                        )}

                        <button
                            type="submit"
                            style={{ ...styles.submitBtn, opacity: submitting ? 0.6 : 1 }}
                            disabled={submitting}
                        >
                            <i className="ti ti-plus" style={{ fontSize: fontSize.md }} />
                            {submitting
                                ? formMode === "auto"
                                    ? "Creating..."
                                    : "Uploading..."
                                : formMode === "auto"
                                  ? "Create Cases"
                                  : "Upload Cases"}
                        </button>
                    </form>

                    {/* ---- RIGHT: case list — filter + pagination ---- */}
                    <div style={styles.tableCard}>
                        <div style={styles.tableToolbar}>
                            <p style={styles.cardHeading}>
                                Cases{" "}
                                {totalCases > 0 && (
                                    <span style={styles.countBadge}>{totalCases}</span>
                                )}
                            </p>
                            <select
                                style={styles.filterSelect}
                                value={filterProductId}
                                onChange={(e) => setFilterProductId(e.target.value)}
                            >
                                {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.product_name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div style={styles.tableHeadRow}>
                            <span style={styles.colCaseNo}>Case No.</span>
                            <span style={styles.colClient}>Client</span>
                            <span style={styles.colService}>Service</span>
                            <span style={styles.colDate}>Date</span>
                            <span style={styles.colAction}></span>
                        </div>

                        {casesLoading ? (
                            <div style={styles.emptyNote}>Loading…</div>
                        ) : casesError ? (
                            <div style={{ ...styles.emptyNote, color: BRAND.red }}>
                                {casesError}
                            </div>
                        ) : cases.length === 0 ? (
                            <div style={styles.emptyNote}>No cases logged yet.</div>
                        ) : (
                            cases.map((c) => (
                                <div key={c.id} style={styles.tableRow}>
                                    <span
                                        style={{
                                            ...styles.colCaseNo,
                                            fontWeight: fontWeight.semibold,
                                        }}
                                    >
                                        {c.caseNumber}
                                    </span>
                                    {/* Only editable cell in the table — case number,
                                        service, and date all stay read-only. */}
                                    <span style={styles.colClient}>
                                        <select
                                            style={{
                                                ...styles.clientSelect,
                                                opacity: savingClientId === c.id ? 0.6 : 1,
                                            }}
                                            value={c.clientId || ""}
                                            disabled={savingClientId === c.id}
                                            onChange={(e) => handleClientChange(c, e.target.value)}
                                        >
                                            <option value="">-- Select client --</option>
                                            {clients.map((cl) => (
                                                <option key={cl.id} value={cl.id}>
                                                    {cl.name}
                                                </option>
                                            ))}
                                        </select>
                                    </span>
                                    <span style={styles.colService}>{c.productName || "-"}</span>
                                    <span style={{ ...styles.colDate, color: "#767F92" }}>
                                        {formatDisplayDate(c.workDate)}
                                    </span>
                                    <span style={styles.colAction}>
                                        <button
                                            type="button"
                                            style={{
                                                ...styles.deleteBtn,
                                                opacity: deletingId === c.id ? 0.5 : 1,
                                                cursor:
                                                    deletingId === c.id ? "not-allowed" : "pointer",
                                            }}
                                            disabled={deletingId === c.id}
                                            onClick={() => handleDelete(c)}
                                            aria-label={`Delete ${c.caseNumber}`}
                                            title="Delete case"
                                        >
                                            <i
                                                className="ti ti-trash"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                        </button>
                                    </span>
                                </div>
                            ))
                        )}

                        {clientEditError && <p style={styles.deleteErrorText}>{clientEditError}</p>}
                        {deleteError && <p style={styles.deleteErrorText}>{deleteError}</p>}

                        {/* ---- pagination ---- */}
                        {!casesLoading && !casesError && totalPages > 1 && (
                            <div style={styles.paginationRow}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.pageBtn,
                                        opacity: page <= 1 ? 0.5 : 1,
                                        cursor: page <= 1 ? "not-allowed" : "pointer",
                                    }}
                                    disabled={page <= 1}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    <i className="ti ti-chevron-left" />
                                </button>
                                <span style={styles.pageIndicator}>
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.pageBtn,
                                        opacity: page >= totalPages ? 0.5 : 1,
                                        cursor: page >= totalPages ? "not-allowed" : "pointer",
                                    }}
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                >
                                    <i className="ti ti-chevron-right" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function getStyles(isMobile: boolean): Record<string, CSSProperties> {
    return {
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            flex: 1,
            minHeight: 0,
            background: "#f4f7fb",
            fontFamily: fontFamily.base,
            overflow: "hidden",
        },
        topBar: {
            height: 4,
            width: "100%",
            background: GRADIENT,
            flexShrink: 0,
        },
        contentBody: {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "24px 28px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 18,
        },
        headerRow: {
            display: "flex",
            alignItems: "center",
        },
        headerLeft: {
            display: "flex",
            alignItems: "center",
            gap: 14,
        },
        headerIcon: {
            width: 48,
            height: 48,
            borderRadius: radius.md,
            background: withBrandAlpha("blue", 0.08),
            color: BRAND.blue,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        pageTitle: {
            margin: 0,
            fontSize: fontSize["5xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            textAlign: "left",
        },
        headerSubtext: {
            margin: "4px 0 0",
            fontSize: fontSize.base,
            color: "#767F92",
            maxWidth: 560,
        },
        layout: {
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "340px 1fr",
            gap: 20,
            alignItems: "start",
            flex: 1,
            minHeight: 0,
        },
        formCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 20,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
        },
        cardHeading: {
            margin: "0 0 10px",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
        // Auto-generate / Upload Case Numbers mode toggle — same pill-button
        // look as the other tab bars in this app (border + hover + gradient
        // when active).
        modeToggleRow: {
            display: "flex",
            gap: 8,
            margin: "0 0 12px",
            flexWrap: "wrap",
        },
        modeToggleBtn: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            color: "#3b4a63",
            border: "1px solid #e4e9f2",
            borderRadius: radius.md,
            padding: "9px 12px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            transition: "border-color .15s ease, color .15s ease",
            whiteSpace: "nowrap",
        },
        modeToggleBtnActive: {
            background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
        },
        label: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#374151",
            margin: "8px 0 6px",
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
        helperNote: {
            margin: "6px 0 0",
            fontSize: fontSize.xs,
            color: "#9ca3af",
        },
        errorText: {
            margin: "10px 0 0",
            fontSize: fontSize.sm,
            color: BRAND.red,
            fontWeight: fontWeight.medium,
        },
        successText: {
            margin: "10px 0 0",
            fontSize: fontSize.sm,
            color: BRAND.green,
            fontWeight: fontWeight.medium,
        },
        submitBtn: {
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "11px 18px",
            borderRadius: radius["2xl"],
            border: "none",
            background: GRADIENT,
            color: "#fff",
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.md,
            boxShadow: `0 6px 16px ${withBrandAlpha("blue", 0.3)}`,
            cursor: "pointer",
        },
        tableCard: {
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
        },
        tableToolbar: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px 8px",
        },
        countBadge: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withBrandAlpha("blue", 0.08),
            borderRadius: radius.xl,
            padding: "2px 9px",
        },
        filterSelect: {
            padding: "8px 12px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.sm,
            background: "#fafafa",
            minWidth: 180,
        },
        tableHeadRow: {
            display: "flex",
            alignItems: "center",
            padding: "10px 20px",
            background: "#F4F8FD",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
        },
        tableRow: {
            display: "flex",
            alignItems: "center",
            padding: "12px 20px",
            borderTop: "1px solid #f1f1f1",
            fontSize: fontSize.base,
            color: "#17181C",
        },
        // NEW: fixed pixel widths shared between header and rows —
        // flex-ratio columns could drift out of alignment depending on
        // content length; explicit widths guarantee the header label
        // always sits directly above its column's data.
        colCaseNo: {
            width: 140,
            flexShrink: 0,
        },
        // NEW: Client column — sits right after Case No. so the two stay
        // visually aligned, per the requested layout.
        colClient: {
            width: 190,
            flexShrink: 0,
            paddingRight: 12,
            boxSizing: "border-box",
        },
        clientSelect: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.sm,
            background: "#fafafa",
            boxSizing: "border-box",
            color: "#17181C",
        },
        colService: {
            flex: 1,
            minWidth: 0,
            paddingRight: 12,
        },
        colDate: {
            width: 110,
            flexShrink: 0,
            textAlign: "right",
        },
        colAction: {
            width: 48,
            flexShrink: 0,
            textAlign: "right",
        },
        deleteBtn: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: BRAND.red,
        },
        deleteErrorText: {
            margin: "10px 20px",
            fontSize: fontSize.sm,
            color: BRAND.red,
            fontWeight: fontWeight.medium,
        },
        emptyNote: {
            padding: "28px 20px",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: fontSize.base,
        },
        paginationRow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "14px 20px",
            borderTop: "1px solid #f1f1f1",
        },
        pageBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            background: "#fff",
            color: "#374151",
        },
        pageIndicator: {
            fontSize: fontSize.sm,
            color: "#374151",
            fontWeight: fontWeight.medium,
        },
    };
}
