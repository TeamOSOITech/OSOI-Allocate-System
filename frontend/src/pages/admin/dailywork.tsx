import { useState, useEffect, useMemo } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";
import * as XLSX from "xlsx";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
// NEW: second tab on this page — "Case Register". Completely separate
// component/file/backend module; nothing below this import touches the
// existing Daily Work logic or JSX.
import ServiceCases from "./servicecases";

const MOBILE_BREAKPOINT = 768;
const PAGE_SIZE = 7;

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

// Hover state for the page-level tab bar (Daily Work / Case Register)
// — same treatment as the Client/Subclient tab buttons on clients.tsx.
const MAIN_TAB_CSS = `
.dw-tab-btn:hover { border-color: #cfe0f5; color: var(--brand-blue); }
`;

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

    // NEW: tab switcher for this page — "daily" (default, 100% unchanged
    // original behavior below) vs "cases" (new Case Register tab). Kept
    // as the very first piece of state so it's obvious at a glance that
    // nothing else on this page was touched to add it.
    const [mainTab, setMainTab] = useState<"daily" | "cases">("daily");

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
    const [searchQuery, setSearchQuery] = useState("");

    // Bulk-upload state — lets someone log today's quantity for many
    // services (100+) in one Excel upload instead of one dropdown
    // submission per service.
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState("");
    const [bulkResult, setBulkResult] = useState<{
        totalRows: number;
        createdCount: number;
        failedCount: number;
        results: { identifier: string; row: number; success: boolean; message?: string }[];
    } | null>(null);

    // Edit / delete a logged batch — added so an accidental wrong entry
    // (wrong product, mistyped quantity, etc.) can be fixed or removed
    // directly from the Today's Production table.
    const [editingBatch, setEditingBatch] = useState<DailyWorkBatch | null>(null);
    const [editWorkDate, setEditWorkDate] = useState("");
    const [editProductId, setEditProductId] = useState("");
    const [editTotalQty, setEditTotalQty] = useState("");
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState("");
    const [deletingId, setDeletingId] = useState<string | null>(null);
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

    const filteredBatches = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return batches;
        return batches.filter((b) => {
            const dateDisplay = formatDisplayDate(b.workDate).toLowerCase();
            const product = (b.productName || "").toLowerCase();
            const total = String(b.totalQty ?? "");
            const allocated = String(b.allocatedQty ?? "");
            const pending = String(b.pendingQty ?? "");
            return (
                dateDisplay.includes(q) ||
                b.workDate.toLowerCase().includes(q) ||
                product.includes(q) ||
                total.includes(q) ||
                allocated.includes(q) ||
                pending.includes(q)
            );
        });
    }, [batches, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredBatches.length / PAGE_SIZE));
    const pagedBatches = filteredBatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    useEffect(() => {
        setPage(1);
    }, [searchQuery]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [totalPages]); // eslint-disable-line react-hooks/exhaustive-deps // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");

        if (!workDate || !productId || !totalQty) {
            setFormError("Date, service, and total quantity are all required.");
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

    // Sample sheet: "Service Name" + "Quantity" only, as requested — uses
    // a real service name (if any exist yet) so the example row is
    // immediately recognizable as valid, not a placeholder that would
    // itself come back "not listed".
    const downloadBulkTemplate = () => {
        const sampleServiceName = products[0]?.product_name || "Example Service";
        const templateData = [{ "Service Name": sampleServiceName, Quantity: 100 }];
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Work");
        XLSX.writeFile(workbook, "daily_work_bulk_upload_template.xlsx");
    };

    const closeBulkModal = () => {
        setShowBulkModal(false);
        setBulkFile(null);
        setBulkResult(null);
        setBulkError("");
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) {
            setBulkError("Please select an Excel file first.");
            return;
        }
        if (!workDate) {
            setBulkError("Pick a date above first — the bulk upload logs against that date.");
            return;
        }

        setBulkError("");
        setBulkSubmitting(true);
        setBulkResult(null);

        try {
            const arrayBuffer = await bulkFile.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const sheetRows: any[] = XLSX.utils.sheet_to_json(sheet);

            if (sheetRows.length === 0) {
                setBulkError("The Excel file is empty.");
                setBulkSubmitting(false);
                return;
            }

            const rows = sheetRows.map((r) => ({
                serviceName: r["Service Name"] || "",
                quantity: r["Quantity"],
            }));

            const res = await authFetch(`${API_BASE}/api/daily-work/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workDate, rows }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

            setBulkResult(json.data);
            fetchBatches();
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong reading the file.");
        } finally {
            setBulkSubmitting(false);
        }
    };

    const openEditModal = (batch: DailyWorkBatch) => {
        setEditingBatch(batch);
        setEditWorkDate(batch.workDate);
        setEditProductId(batch.productId);
        setEditTotalQty(String(batch.totalQty));
        setEditError("");
    };

    const closeEditModal = () => {
        setEditingBatch(null);
        setEditError("");
    };

    const handleUpdateBatch = async (e: FormEvent) => {
        e.preventDefault();
        if (!editingBatch) return;

        if (!editWorkDate || !editProductId || !editTotalQty) {
            setEditError("Date, service, and total quantity are all required.");
            return;
        }
        const qty = Number(editTotalQty);
        if (!Number.isFinite(qty) || qty <= 0) {
            setEditError("Total quantity must be a positive number.");
            return;
        }

        setEditSubmitting(true);
        setEditError("");
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work/${editingBatch.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workDate: editWorkDate,
                    productId: editProductId,
                    totalQty: qty,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

            closeEditModal();
            fetchBatches();
        } catch (err: any) {
            setEditError(err?.message || "Failed to update this entry.");
        } finally {
            setEditSubmitting(false);
        }
    };

    // Native confirm() is used deliberately here instead of a custom
    // modal — it can't be dismissed by an accidental outside click the
    // way a custom overlay can, and delete is destructive enough that a
    // blocking, unmissable confirmation is the right amount of friction.
    const handleDeleteBatch = async (batch: DailyWorkBatch) => {
        const confirmed = window.confirm(
            `Delete the ${formatDisplayDate(batch.workDate)} entry for "${
                batch.productName || "this service"
            }" (qty ${batch.totalQty})? This can't be undone.`
        );
        if (!confirmed) return;

        setDeletingId(batch.id);
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work/${batch.id}`, {
                method: "DELETE",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            fetchBatches();
        } catch (err: any) {
            alert(err?.message || "Failed to delete this entry.");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <>
            <style>{MAIN_TAB_CSS}</style>
            {/* Tab bar — Tab 1 is the exact original Daily Work page
                (nothing inside it was changed), Tab 2 is the new Case
                Register. Styled as real pill buttons (border + hover +
                gradient when active), same as the Client/Subclient tabs
                on the Clients page, so they're unmistakably clickable. */}
            <div style={styles.mainTabBar}>
                <button
                    type="button"
                    className="dw-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "daily" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("daily")}
                >
                    <i className="ti ti-clipboard-plus" style={{ fontSize: fontSize.md }} />
                    Daily Work
                </button>
                <button
                    type="button"
                    className="dw-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "cases" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("cases")}
                >
                    <i className="ti ti-list-numbers" style={{ fontSize: fontSize.md }} />
                    Case Register
                </button>
            </div>

            {mainTab === "cases" ? (
                <ServiceCases />
            ) : (
                <div style={isMobile ? styles.rootMobile : styles.root}>
                    {/* Top gradient accent bar */}
                    <div style={styles.topBar} />

                    <div style={styles.contentBody}>
                        {/* Header row: icon + title + breadcrumb */}
                        <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                            <div style={styles.headerLeft}>
                                <div>
                                    <h1 style={styles.pageTitle}>Daily Work</h1>
                                    <p style={styles.headerSubtext}>
                                        Log today's total quantity received per service — this is
                                        the pool that Smart Auto Allocation and Manual Allocation
                                        split across present employees.
                                    </p>
                                </div>
                            </div>

                            {!isMobile && (
                                <div style={styles.breadcrumb}>
                                    <i className="ti ti-home" style={{ fontSize: fontSize.md }} />
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
                                iconBg="linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))"
                                label="Services"
                                value={products.length}
                                footer="Total Services"
                                dotColor="var(--brand-blue)"
                            />
                            <KpiCard
                                icon="ti ti-users"
                                iconBg="linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))"
                                label="Allocated"
                                value={totalAllocated}
                                footer="Total Allocated"
                                dotColor="var(--brand-light-blue)"
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
                                    <i className="ti ti-edit" style={{ fontSize: fontSize.xl }} />
                                    <span style={{ flex: 1 }}>Log Production</span>
                                    {/* Bulk upload: log many services' quantity for the same
                                date in one Excel file instead of one dropdown submit
                                per service — useful once there are 50-100+ services. */}
                                    <button
                                        type="button"
                                        onClick={downloadBulkTemplate}
                                        style={styles.headerGhostBtn}
                                        title="Sample sheet for bulk upload (.xlsx)"
                                    >
                                        <i
                                            className="ti ti-file-spreadsheet"
                                            style={{ fontSize: fontSize.base }}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowBulkModal(true)}
                                        style={styles.headerGhostBtn}
                                        title="Bulk upload quantities from Excel"
                                    >
                                        <i
                                            className="ti ti-upload"
                                            style={{ fontSize: fontSize.base }}
                                        />
                                    </button>
                                </div>

                                <form onSubmit={handleSubmit} style={styles.form}>
                                    <label style={styles.label}>
                                        <span style={styles.labelText}>
                                            <i
                                                className="ti ti-calendar"
                                                style={styles.labelIcon}
                                            />
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
                                            Service
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
                                                    ? "Loading services..."
                                                    : "Select a service"}
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
                                            <i
                                                className="ti ti-alert-triangle"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            {formError}
                                        </div>
                                    )}
                                    {formSuccess && (
                                        <div style={styles.formSuccess}>
                                            <i
                                                className="ti ti-circle-check"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            {formSuccess}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        style={styles.submitBtn}
                                        disabled={submitting}
                                    >
                                        <i
                                            className="ti ti-device-floppy"
                                            style={{ fontSize: fontSize.lg }}
                                        />
                                        {submitting ? "Saving..." : "Save Daily Work"}
                                    </button>
                                </form>
                            </div>

                            {/* Table panel */}
                            <div style={styles.listPanel}>
                                <div style={styles.listPanelHeader}>
                                    <div style={styles.listPanelTitle}>
                                        <i
                                            className="ti ti-chart-bar"
                                            style={{ fontSize: fontSize.xl }}
                                        />
                                        <span>Today's Production</span>
                                    </div>
                                    <div style={styles.listPanelHeaderRight}>
                                        <div style={styles.searchBox}>
                                            <i
                                                className="ti ti-search"
                                                style={{ fontSize: fontSize.sm, color: "#94a3b8" }}
                                            />
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                placeholder="Search service, date, qty..."
                                                style={styles.searchInput}
                                            />
                                        </div>
                                        <div style={styles.dateBadge}>
                                            <i
                                                className="ti ti-calendar"
                                                style={{ fontSize: fontSize.sm }}
                                            />
                                            {formatDisplayDate(todayStr())}
                                        </div>
                                    </div>
                                </div>

                                <div style={styles.tableScroll}>
                                    <div style={styles.tableHead}>
                                        <span style={{ ...styles.tableHeadLabel, flex: 1.1 }}>
                                            Date
                                        </span>
                                        <span style={{ ...styles.tableHeadLabel, flex: 1.6 }}>
                                            Service
                                        </span>
                                        <span style={styles.tableHeadLabel}>Total</span>
                                        <span style={styles.tableHeadLabel}>Allocated</span>
                                        <span style={styles.tableHeadLabel}>Pending</span>
                                        <span
                                            style={{
                                                ...styles.tableHeadLabel,
                                                flex: 0.8,
                                                textAlign: "right",
                                            }}
                                        >
                                            Actions
                                        </span>
                                    </div>

                                    <div style={styles.tableBody}>
                                        {batchesLoading ? (
                                            <div style={styles.emptyState}>
                                                Loading daily work...
                                            </div>
                                        ) : batchesError ? (
                                            <div style={styles.emptyState}>{batchesError}</div>
                                        ) : pagedBatches.length === 0 ? (
                                            <div style={styles.emptyState}>
                                                {searchQuery
                                                    ? "No matching records found."
                                                    : "No daily work logged yet."}
                                            </div>
                                        ) : (
                                            pagedBatches.map((b, idx) => (
                                                <div
                                                    key={b.id}
                                                    style={{
                                                        ...styles.tableRow,
                                                        background:
                                                            idx % 2 === 0 ? "#fff" : "#fafaff",
                                                    }}
                                                >
                                                    <span style={{ flex: 1.1 }}>
                                                        {formatDisplayDate(b.workDate)}
                                                    </span>
                                                    <span
                                                        style={{
                                                            flex: 1.6,
                                                            fontWeight: fontWeight.medium,
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
                                                            tone={
                                                                b.pendingQty > 0 ? "amber" : "teal"
                                                            }
                                                        />
                                                    </span>
                                                    <span
                                                        style={{
                                                            flex: 0.8,
                                                            display: "flex",
                                                            justifyContent: "flex-end",
                                                            gap: "6px",
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => openEditModal(b)}
                                                            style={styles.rowActionBtn}
                                                            title="Edit this entry"
                                                        >
                                                            <i
                                                                className="ti ti-pencil"
                                                                style={{ fontSize: fontSize.sm }}
                                                            />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteBatch(b)}
                                                            disabled={deletingId === b.id}
                                                            style={styles.rowActionBtnDanger}
                                                            title="Delete this entry"
                                                        >
                                                            <i
                                                                className="ti ti-trash"
                                                                style={{ fontSize: fontSize.sm }}
                                                            />
                                                        </button>
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div style={styles.tableFooter}>
                                    <span style={styles.tableFooterText}>
                                        <i
                                            className="ti ti-info-circle"
                                            style={{ fontSize: fontSize.base }}
                                        />
                                        {filteredBatches.length === 0
                                            ? "No entries found"
                                            : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                                                  page * PAGE_SIZE,
                                                  filteredBatches.length
                                              )} of ${filteredBatches.length} entries`}
                                    </span>

                                    <div style={styles.pagination}>
                                        <button
                                            style={styles.pageBtn}
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                        >
                                            <i
                                                className="ti ti-chevron-left"
                                                style={{ fontSize: fontSize.md }}
                                            />
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
                                            onClick={() =>
                                                setPage((p) => Math.min(totalPages, p + 1))
                                            }
                                            disabled={page >= totalPages}
                                        >
                                            <i
                                                className="ti ti-chevron-right"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {showBulkModal && (
                        // NOTE: overlay intentionally has no onClick-to-close — an
                        // accidental click on the backdrop while filling this out
                        // shouldn't discard the file/results. Only the ✕ button
                        // (closeBulkModal) closes it, per the same rule applied to
                        // every other add/edit/delete popup in the app.
                        <div style={styles.overlay}>
                            <div style={styles.bulkModal}>
                                <div style={styles.bulkModalHeader}>
                                    <h3 style={styles.bulkModalTitle}>Bulk Add Daily Work</h3>
                                    <p style={styles.bulkModalSubtitle}>
                                        Upload an Excel file to log quantities for many services at
                                        once, for {formatDisplayDate(workDate)}
                                    </p>
                                    <button
                                        style={styles.closeBtn}
                                        onClick={closeBulkModal}
                                        type="button"
                                        aria-label="Close"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div style={styles.bulkInfoBox}>
                                    <span style={styles.bulkInfoLabel}>Required columns</span>
                                    <p style={styles.bulkInfoText}>
                                        Service Name, Quantity. Each Service Name must match a
                                        service that's already listed — anything that doesn't match
                                        comes back as "not listed" instead of being created.
                                    </p>
                                </div>

                                <div style={styles.bulkUploadRow}>
                                    <label style={styles.fileInputWrapper}>
                                        <input
                                            type="file"
                                            accept=".xlsx,.xls"
                                            onChange={(e) =>
                                                setBulkFile(e.target.files?.[0] || null)
                                            }
                                            style={styles.fileInputHidden}
                                        />
                                        <span style={styles.fileInputButton}>Choose File</span>
                                        <span style={styles.fileInputName}>
                                            {bulkFile ? bulkFile.name : "No file chosen"}
                                        </span>
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleBulkUpload}
                                        disabled={bulkSubmitting}
                                        style={{
                                            ...styles.bulkUploadBtn,
                                            opacity: bulkSubmitting ? 0.7 : 1,
                                            cursor: bulkSubmitting ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        {bulkSubmitting ? "Uploading…" : "Upload & Log Quantities"}
                                    </button>
                                </div>

                                {bulkError && <p style={styles.formError}>{bulkError}</p>}

                                {bulkResult && (
                                    <div style={styles.resultsSection}>
                                        <div style={styles.resultsSummary}>
                                            <span style={styles.resultsSummaryText}>
                                                <strong>{bulkResult.totalRows}</strong> total rows
                                                {" · "}
                                                <strong style={{ color: "#16a34a" }}>
                                                    {bulkResult.createdCount}
                                                </strong>{" "}
                                                created
                                                {bulkResult.failedCount > 0 && (
                                                    <>
                                                        {" · "}
                                                        <strong style={{ color: "#dc2626" }}>
                                                            {bulkResult.failedCount}
                                                        </strong>{" "}
                                                        failed
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <div style={styles.resultsList}>
                                            {bulkResult.results.map((r, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        fontSize: fontSize.sm,
                                                        color: r.success ? "#16a34a" : "#dc2626",
                                                        padding: "4px 0",
                                                    }}
                                                >
                                                    {r.identifier}:{" "}
                                                    {r.success ? "Created" : r.message}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {editingBatch && (
                        // Same rule as the bulk modal above — overlay has no
                        // onClick-to-close, only the ✕ / Cancel button does.
                        <div style={styles.overlay}>
                            <div style={styles.editModal}>
                                <div style={styles.bulkModalHeader}>
                                    <h3 style={styles.bulkModalTitle}>Edit Daily Work Entry</h3>
                                    <p style={styles.bulkModalSubtitle}>
                                        {editingBatch.productName || "This service"} —{" "}
                                        {formatDisplayDate(editingBatch.workDate)}
                                    </p>
                                    <button
                                        style={styles.closeBtn}
                                        onClick={closeEditModal}
                                        type="button"
                                        aria-label="Close"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <form onSubmit={handleUpdateBatch} style={styles.form}>
                                    <label style={styles.label}>
                                        <span style={styles.labelText}>
                                            <i
                                                className="ti ti-calendar"
                                                style={styles.labelIcon}
                                            />
                                            Date
                                        </span>
                                        <input
                                            type="date"
                                            value={editWorkDate}
                                            onChange={(e) => setEditWorkDate(e.target.value)}
                                            style={styles.input}
                                            required
                                        />
                                    </label>

                                    <label style={styles.label}>
                                        <span style={styles.labelText}>
                                            <i className="ti ti-package" style={styles.labelIcon} />
                                            Service
                                        </span>
                                        <select
                                            value={editProductId}
                                            onChange={(e) => setEditProductId(e.target.value)}
                                            style={styles.input}
                                            required
                                        >
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
                                            value={editTotalQty}
                                            onChange={(e) => setEditTotalQty(e.target.value)}
                                            style={styles.input}
                                            required
                                        />
                                        {editingBatch.allocatedQty > 0 && (
                                            <span
                                                style={{ fontSize: fontSize.xs, color: "#94a3b8" }}
                                            >
                                                {editingBatch.allocatedQty} already allocated —
                                                quantity can't go below that.
                                            </span>
                                        )}
                                    </label>

                                    {editError && (
                                        <div style={styles.formError}>
                                            <i
                                                className="ti ti-alert-triangle"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            {editError}
                                        </div>
                                    )}

                                    <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                                        <button
                                            type="button"
                                            onClick={closeEditModal}
                                            style={styles.editCancelBtn}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            style={{ ...styles.submitBtn, flex: 1, marginTop: 0 }}
                                            disabled={editSubmitting}
                                        >
                                            <i
                                                className="ti ti-device-floppy"
                                                style={{ fontSize: fontSize.lg }}
                                            />
                                            {editSubmitting ? "Saving..." : "Save Changes"}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
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
                    <i className={icon} style={{ fontSize: fontSize["3xl"], color: "#fff" }} />
                </div>
                <div>
                    <div style={styles.kpiLabel}>{label}</div>
                    <div style={styles.kpiValue}>{value}</div>
                </div>
            </div>
            <div style={styles.kpiFooter}>
                <span>{footer}</span>
                <span style={{ ...styles.kpiDot, background: dotColor }}>
                    <i
                        className="ti ti-arrow-right"
                        style={{ fontSize: fontSize.xxs, color: "#fff" }}
                    />
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
                borderRadius: radius.pill,
                background: t.bg,
                color: t.fg,
                fontSize: fontSize.sm,
                fontWeight: fontWeight.semibold,
            }}
        >
            {value}
        </span>
    );
}

const styles: Record<string, CSSProperties> = {
    // Page-level tab bar (Daily Work / Case Register) — same pill-button
    // look as the Client/Subclient tabs on clients.tsx: a real bordered
    // button with a hover state and a gradient + shadow when active,
    // instead of a flat underline tab. Easier to see and to hit.
    mainTabBar: {
        display: "flex",
        gap: 8,
        padding: "14px 28px",
        background: "#f4f5fb",
        flexWrap: "wrap",
    },
    mainTabBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#3b4a63",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "10px 18px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        transition: "border-color .15s ease, color .15s ease",
    },
    mainTabBtnActive: {
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
    },
    root: {
        width: "100%",
        minHeight: "100%",
        background: "#f4f5fb",
        fontFamily: fontFamily.base,
    },
    rootMobile: {
        width: "100%",
        minHeight: "100%",
        background: "#f0f0f5",
        fontFamily: fontFamily.base,
    },
    topBar: {
        height: "4px",
        width: "100%",
        background: "linear-gradient(90deg, var(--brand-blue), var(--brand-light-blue), #2EBBA8)",
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

        textAlign: "left",
    },

    breadcrumb: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: fontSize.sm,
        color: "#64748b",
        marginTop: "6px",
    },
    breadcrumbSep: { color: "#c7cbe0" },
    breadcrumbItem: { color: "#64748b" },
    breadcrumbActive: { color: "var(--brand-blue)", fontWeight: fontWeight.semibold },

    kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" },
    kpiRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    kpiCard: {
        background: "#fff",
        borderRadius: radius.lg,
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
        borderRadius: radius.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    kpiLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: "var(--brand-blue)" },
    kpiValue: { fontSize: fontSize["4xl"], fontWeight: fontWeight.bold, color: "#1e1b4b" },
    kpiFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: fontSize.xs,
        color: "#94a3b8",
        borderTop: "1px solid #f1f1f7",
        paddingTop: "10px",
    },
    kpiDot: {
        width: 18,
        height: 18,
        borderRadius: radius.circle,
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
        borderRadius: radius.lg,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    formPanelHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "14px 18px",
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
    },
    form: { display: "flex", flexDirection: "column", gap: "14px", padding: "18px" },
    label: { display: "flex", flexDirection: "column", gap: "6px" },
    labelText: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
    },
    labelIcon: { fontSize: fontSize.base, color: "var(--brand-blue)" },
    input: {
        border: "1px solid #e2e4f0",
        borderRadius: radius.sm,
        padding: "9px 12px",
        fontSize: fontSize.base,
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
        fontSize: fontSize.sm,
        padding: "9px 10px",
        borderRadius: radius.sm,
    },
    formSuccess: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#eaf7ec",
        color: "#1f7a34",
        fontSize: fontSize.sm,
        padding: "9px 10px",
        borderRadius: radius.sm,
    },
    submitBtn: {
        marginTop: "4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "11px 14px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },

    listPanel: {
        background: "#fff",
        borderRadius: radius.lg,
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
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#1e1b4b",
    },
    dateBadge: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#eef2ff",
        color: "var(--brand-blue)",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "5px 10px",
        borderRadius: radius.pill,
    },

    listPanelHeaderRight: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
    },
    searchBox: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#fafaff",
        border: "1px solid #e2e4f0",
        borderRadius: radius.pill,
        padding: "6px 12px",
        minWidth: 200,
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.sm,
        color: "#1e1b4b",
        width: "100%",
        fontFamily: "inherit",
    },
    tableScroll: { overflowY: "visible" },
    tableHead: {
        display: "flex",
        padding: "10px 18px",
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        gap: "8px",
    },
    tableHeadLabel: {
        flex: 1,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#e0e7ff",
    },
    tableBody: { flex: 1 },
    tableRow: {
        display: "flex",
        alignItems: "center",
        padding: "10px 18px",
        borderBottom: "1px solid #f1f1f7",
        fontSize: fontSize.base,
        color: "#374151",
        gap: "8px",
    },
    emptyState: { padding: "24px", textAlign: "center", color: "#999", fontSize: fontSize.sm },

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
        fontSize: fontSize.xs,
        color: "#94a3b8",
    },
    pagination: { display: "flex", gap: "6px" },
    pageBtn: {
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    pageBtnActive: {
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
    },

    // ---- Bulk upload (Daily Work) ----
    headerGhostBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        border: "1px solid rgba(255,255,255,0.5)",
        background: "rgba(255,255,255,0.12)",
        color: "#fff",
        cursor: "pointer",
    },
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
    },
    bulkModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 560,
        maxWidth: "92vw",
        maxHeight: "88vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    bulkModalHeader: {
        position: "relative",
        textAlign: "center",
        padding: "24px 28px 16px",
        borderBottom: "1px solid #f0f0f0",
    },
    bulkModalTitle: {
        margin: 0,
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
    },
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },
    closeBtn: {
        position: "absolute",
        top: 20,
        right: 24,
        border: "none",
        background: "#f3f4f6",
        borderRadius: radius.circle,
        width: 28,
        height: 28,
        fontSize: fontSize.md,
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "rgba(8,161,206,0.08)",
        borderLeft: "3px solid var(--brand-light-blue)",
        borderRadius: radius.xs,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 4,
    },
    bulkInfoText: { margin: 0, fontSize: fontSize.base, color: "#6b7280", lineHeight: 1.6 },
    bulkUploadRow: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        margin: "0 28px 24px",
    },
    fileInputWrapper: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid #e5e7eb",
        borderRadius: radius.sm,
        padding: "8px 12px",
        cursor: "pointer",
        flex: 1,
        minWidth: 200,
        background: "#fafafa",
    },
    fileInputHidden: { display: "none" },
    fileInputButton: {
        background: "var(--brand-blue)",
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        padding: "6px 12px",
        borderRadius: radius.xs,
        whiteSpace: "nowrap",
    },
    fileInputName: {
        fontSize: fontSize.base,
        color: "#6b7280",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    bulkUploadBtn: {
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "10px 20px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    },
    resultsSection: { borderTop: "1px solid #f0f0f0", padding: "20px 28px 28px" },
    resultsSummary: { marginBottom: 12 },
    resultsSummaryText: { fontSize: fontSize.md, color: "#17181C" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        maxHeight: 260,
        overflowY: "auto",
    },

    // ---- Row edit/delete actions ----
    rowActionBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "var(--brand-blue)",
        cursor: "pointer",
    },
    rowActionBtnDanger: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: radius.sm,
        border: "1px solid #fecaca",
        background: "#fff",
        color: "#dc2626",
        cursor: "pointer",
    },
    editModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 420,
        maxWidth: "92vw",
        maxHeight: "88vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    editCancelBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "11px 18px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },
};
