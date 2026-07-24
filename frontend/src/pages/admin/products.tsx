import { useState, useEffect, useMemo } from "react";
import { authFetch } from "../../utils/authFetch";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";

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

// Backend base URL. Hardcoded rather than read from process.env because
// that lookup doesn't resolve to anything meaningful in the browser bundle
// unless your build tool is specifically configured to inline it.
// Change this if your backend runs on a different host/port.
const API_BASE = import.meta.env.VITE_API_URL;
const ENDPOINT = `${API_BASE}/api/products`;

type Product = {
    id: string;
    product_name: string;
    time_taken: string;
    time_unit: string;
    client: string;
    subclient: string;
    created_at?: string;
    updated_at?: string;
};

type ProductForm = {
    product_name: string;
    time_taken: string;
    time_unit: string;
    client: string;
    subclient: string;
};

const emptyForm: ProductForm = {
    product_name: "",
    time_taken: "",
    time_unit: "",
    client: "",
    subclient: "",
};

type DeleteTarget = { id: string; name: string };

type BulkResult = {
    totalRows: number;
    created: Record<string, number>;
    rowErrors: { row: number; message: string }[];
};

const AVATAR_PALETTE = [
    { from: "#5b7fee", to: "#2b4fd8", solid: "#2b4fd8" },
    { from: "#2dd4bf", to: "#0ca678", solid: "#0ca678" },
    { from: "#fb923c", to: "#ea580c", solid: "#ea580c" },
    { from: "#a855f7", to: "#7c3aed", solid: "#7c3aed" },
    { from: "#f472b6", to: "#db2777", solid: "#db2777" },
    { from: "#38bdf8", to: "#0284c7", solid: "#0284c7" },
    { from: "#34d399", to: "#059669", solid: "#059669" },
    { from: "#fbbf24", to: "#d97706", solid: "#d97706" },
];

function getInitials(name: string) {
    const trimmed = (name || "").trim();
    if (!trimmed) return "?";
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarColors(name: string) {
    let hash = 0;
    const key = name || "";
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// Formats a time value with its unit for display, e.g. "20 min" / "2 hr".
// Falls back to "—" when either piece is missing.
function formatTimeTaken(value?: string | number | null, unit?: string | null) {
    if (value === null || value === undefined || value === "") return "—";
    const unitLabel = unit === "hours" ? "hr" : unit === "minutes" ? "min" : "";
    return unitLabel ? `${value} ${unitLabel}` : `${value}`;
}

// Injected once — inline style objects can't express :hover/:focus, so the
// handful of interactive/motion rules live here instead of duplicating them
// as onMouseEnter/onMouseLeave handlers everywhere. Mirrors the Clients page
// one-for-one so both entities read as the same product.
const GLOBAL_CSS = `
.pr-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.pr-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(32,66,151,.12);
  border-color: #cfe0f5;
}
.pr-row:nth-child(even) { background: #fbfcfe; }
.pr-row { box-shadow: inset 3px 0 0 0 transparent; }
.pr-row:hover { background: #f0f6fd; box-shadow: inset 3px 0 0 0 #08A1CE; }
.pr-view-btn:hover { text-decoration: underline; }
.pr-view-btn-filled:hover { filter: brightness(1.06); transform: translateY(-1px); }
.pr-icon-btn:hover { background: #eef4fb; border-color: #cfe0f5; color: #204297; transform: translateY(-1px); }
.pr-icon-btn-danger:hover { background: #fee2e2; border-color: #fecaca; transform: translateY(-1px); }
.pr-table thead th:first-child { border-top-left-radius: 16px; }
.pr-table thead th:last-child { border-top-right-radius: 16px; }

/* Tooltip used on the Sample Sheet / Bulk Upload buttons so hover clearly
   communicates the download/upload is an Excel (.xlsx) file. Colors match
   this page's blue brand gradient (tabs, Add button, filled View button). */
.pr-tooltip-wrap { position: relative; display: inline-flex; }
.pr-tooltip-wrap .pr-tooltip-bubble {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: linear-gradient(135deg, #08A1CE, #204297);
  color: #fff;
  font-size: 11.5px;
  font-weight: 600;
  padding: 7px 10px;
  border-radius: 8px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
  z-index: 20;
  box-shadow: 0 8px 20px rgba(32,66,151,.35);
}
.pr-tooltip-wrap .pr-tooltip-bubble::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: #08A1CE;
}
.pr-tooltip-wrap:hover .pr-tooltip-bubble {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

/* Custom slim scrollbar for the list/grid area so it reads as a native
   overflow container rather than the page itself growing. */
.pr-scroll-area::-webkit-scrollbar { width: 8px; }
.pr-scroll-area::-webkit-scrollbar-track { background: transparent; }
.pr-scroll-area::-webkit-scrollbar-thumb { background: #cfd9ea; border-radius: 8px; }
.pr-scroll-area::-webkit-scrollbar-thumb:hover { background: #b7c4dc; }
`;

// Columns required in the bulk-upload sheet, shown in the modal's info
// callout and used to build the downloadable sample sheet client-side.
const BULK_REQUIRED_COLUMNS_TEXT = "Product Name, Time Taken, Client, Subclient";

const Products = () => {
    const isMobile = useIsMobile();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
    const [clientFilter, setClientFilter] = useState("All");
    const [subclientFilter, setSubclientFilter] = useState("All");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    const [viewDetails, setViewDetails] = useState<Product | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState<ProductForm>({ ...emptyForm });
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState("");

    const [editTarget, setEditTarget] = useState<Product | null>(null);
    const [editForm, setEditForm] = useState<ProductForm>({ ...emptyForm });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState("");

    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    // ---- Bulk upload state ----
    // Bulk upload now lives inside its own modal (opened via the "Bulk
    // Upload" button) instead of firing immediately off a hidden file
    // input, matching the Add User page's "Bulk Add Users" modal pattern:
    // required-columns callout -> Choose File -> explicit Upload button.
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkUploading, setBulkUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
    const [bulkError, setBulkError] = useState("");

    const fetchProducts = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(ENDPOINT, {
                headers: { "Content-Type": "application/json" },
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to load products");
            }
            setProducts(json.data || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const clientOptions = useMemo(
        () => Array.from(new Set(products.map((p) => p.client).filter(Boolean))).sort(),
        [products]
    );

    const subclientOptions = useMemo(
        () => Array.from(new Set(products.map((p) => p.subclient).filter(Boolean))).sort(),
        [products]
    );

    const filteredProducts = useMemo(
        () =>
            products.filter((p) => {
                const matchesSearch = (p.product_name || "")
                    .toLowerCase()
                    .includes(search.trim().toLowerCase());
                const matchesClient = clientFilter === "All" || p.client === clientFilter;
                const matchesSubclient =
                    subclientFilter === "All" || p.subclient === subclientFilter;
                return matchesSearch && matchesClient && matchesSubclient;
            }),
        [products, search, clientFilter, subclientFilter]
    );

    // ---- Add handlers ----

    const openAddModal = () => {
        setAddForm({ ...emptyForm });
        setAddError("");
        setShowAddModal(true);
    };

    const closeAddModal = () => {
        setShowAddModal(false);
        setAddError("");
    };

    const handleAddSubmit = async () => {
        setAddError("");
        if (!addForm.product_name.trim()) {
            setAddError("Product name is required.");
            return;
        }
        if (!addForm.time_unit) {
            setAddError("Please select a unit (Minutes or Hours) for Time Taken.");
            return;
        }

        setAddSubmitting(true);
        try {
            const res = await authFetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(addForm),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to create product");
            }
            await fetchProducts();
            setShowAddModal(false);
        } catch (err: any) {
            setAddError(err.message || "Something went wrong.");
        } finally {
            setAddSubmitting(false);
        }
    };

    // ---- Edit handlers ----

    const openEditModal = (product: Product) => {
        setEditError("");
        setEditForm({
            product_name: product.product_name || "",
            time_taken: product.time_taken || "",
            time_unit: product.time_unit || "",
            client: product.client || "",
            subclient: product.subclient || "",
        });
        setEditTarget(product);
    };

    const closeEditModal = () => {
        setEditTarget(null);
        setEditError("");
    };

    const handleEditSubmit = async () => {
        if (!editTarget) return;
        setEditError("");
        if (!editForm.product_name.trim()) {
            setEditError("Product name is required.");
            return;
        }
        if (!editForm.time_unit) {
            setEditError("Please select a unit (Minutes or Hours) for Time Taken.");
            return;
        }

        setEditSubmitting(true);
        try {
            const res = await authFetch(`${ENDPOINT}/${editTarget.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editForm),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to update product");
            }
            await fetchProducts();
            setEditTarget(null);
        } catch (err: any) {
            setEditError(err.message || "Something went wrong.");
        } finally {
            setEditSubmitting(false);
        }
    };

    // ---- Delete handlers ----

    const openDeleteConfirm = (id: string, name: string) => {
        setDeleteError("");
        setDeleteTarget({ id, name });
    };

    const closeDeleteConfirm = () => {
        setDeleteTarget(null);
        setDeleteError("");
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        setDeleteError("");
        try {
            const res = await authFetch(`${ENDPOINT}/${deleteTarget.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to delete product");
            }
            setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
            setDeleteTarget(null);
        } catch (err: any) {
            setDeleteError(err.message || "Something went wrong.");
        } finally {
            setDeleting(false);
        }
    };

    // ---- Bulk upload handlers ----

    // FIX: the sample sheet button previously called
    // `${ENDPOINT}/bulk/template?format=xlsx`, which 404s ("Cannot GET
    // /api/products/bulk/template") because that route doesn't exist on
    // the backend. Rather than depend on a backend endpoint, the template
    // is now generated entirely client-side with the `xlsx` package —
    // same approach already used by the Add User page's "Sample Sheet"
    // button — so the download works with zero backend changes.
    const handleDownloadTemplate = () => {
        const templateData = [
            {
                "Product Name": "Inventory Sync",
                "Time Taken": "2 hours",
                Client: "Acme Corp",
                Subclient: "Barret and Co",
            },
        ];

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        XLSX.writeFile(workbook, "bulk_add_products_template.xlsx");
    };

    // Bulk upload now lives in its own modal (matching the Add User page's
    // "Bulk Add Users" modal) instead of firing immediately off a hidden
    // file input: choosing a file just stages it, and the actual POST only
    // happens once "Upload & Create Products" is clicked.
    const openBulkModal = () => {
        setBulkFile(null);
        setBulkResult(null);
        setBulkError("");
        setShowBulkModal(true);
    };

    const closeBulkModal = () => {
        setShowBulkModal(false);
        setBulkFile(null);
        setBulkResult(null);
        setBulkError("");
    };

    const handleBulkFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setBulkFile(file);
        setBulkResult(null);
        setBulkError("");
    };

    const handleBulkUploadSubmit = async () => {
        if (!bulkFile) {
            setBulkError("Please select an Excel file first.");
            return;
        }

        setBulkUploading(true);
        setBulkError("");
        setBulkResult(null);

        try {
            const formData = new FormData();
            formData.append("file", bulkFile);

            const response = await authFetch(`${ENDPOINT}/bulk/upload`, {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(data?.message || "Bulk upload failed");
            }

            setBulkResult(data as BulkResult);
            await fetchProducts();
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong during bulk upload.");
        } finally {
            setBulkUploading(false);
        }
    };

    // Shared form fieldset used by both Add and Edit modals so the two
    // never drift out of parity.
    const renderProductFieldset = (
        formState: ProductForm,
        setFormState: (updater: (prev: ProductForm) => ProductForm) => void
    ) => (
        <>
            <div>
                <label style={styles.formLabel}>Product Name</label>
                <input
                    style={styles.formInput}
                    value={formState.product_name}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, product_name: e.target.value }))
                    }
                    placeholder="e.g. Inventory Sync"
                />
            </div>
            <div>
                <label style={styles.formLabel}>Time Taken</label>
                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        style={{ ...styles.formInput, flex: 1 }}
                        value={formState.time_taken}
                        onChange={(e) =>
                            setFormState((prev) => ({ ...prev, time_taken: e.target.value }))
                        }
                        placeholder="e.g. 20"
                        type="number"
                        min="0"
                    />
                    <select
                        style={{ ...styles.formInput, flex: 1 }}
                        value={formState.time_unit}
                        onChange={(e) =>
                            setFormState((prev) => ({ ...prev, time_unit: e.target.value }))
                        }
                        required
                    >
                        <option value="" disabled>
                            Select unit
                        </option>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                    </select>
                </div>
            </div>
            <div>
                <label style={styles.formLabel}>Client</label>
                <input
                    style={styles.formInput}
                    value={formState.client}
                    onChange={(e) => setFormState((prev) => ({ ...prev, client: e.target.value }))}
                    placeholder="e.g. Acme Corp"
                />
            </div>
            <div>
                <label style={styles.formLabel}>Subclient</label>
                <input
                    style={styles.formInput}
                    value={formState.subclient}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, subclient: e.target.value }))
                    }
                    placeholder="e.g. Barret and Co"
                />
            </div>
        </>
    );

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {/* Page title */}
                    {!isMobile && <h2 style={styles.pageTitle}>Products</h2>}

                    {/* Header row */}
                    {!isMobile && (
                        <div style={styles.headerRow}>
                            <p style={styles.headerSubtext}>
                                View, add, edit or remove Products from the system.
                            </p>

                            <div style={styles.headerActions}>
                                <span className="pr-tooltip-wrap">
                                    <button
                                        style={styles.secondaryBtn}
                                        type="button"
                                        onClick={handleDownloadTemplate}
                                    >
                                        <i
                                            className="ti ti-file-spreadsheet"
                                            style={{ fontSize: 14 }}
                                        />
                                        Sample Sheet
                                    </button>
                                    <span className="pr-tooltip-bubble">
                                        Sample sheet for bulk upload (.xlsx)
                                    </span>
                                </span>

                                {/* Bulk Upload now opens a modal (matching the Add User
                                    page's "Bulk Add Users" modal) instead of firing an
                                    upload the instant a file is chosen. */}
                                <span className="pr-tooltip-wrap">
                                    <button
                                        type="button"
                                        style={styles.secondaryBtn}
                                        onClick={openBulkModal}
                                    >
                                        <i className="ti ti-upload" style={{ fontSize: 14 }} />
                                        Bulk Upload
                                    </button>
                                    <span className="pr-tooltip-bubble">
                                        Upload products from an Excel (.xlsx) file
                                    </span>
                                </span>

                                <button
                                    style={styles.addBtn}
                                    type="button"
                                    onClick={openAddModal}
                                    title="Add a new product"
                                >
                                    <i className="ti ti-plus" style={{ fontSize: 14 }} />
                                    Add Product
                                </button>
                            </div>
                        </div>
                    )}

                    {isMobile && (
                        <div style={styles.headerRowMobile}>
                            <h2 style={styles.pageTitle}>Products</h2>
                            <button
                                style={styles.addBtn}
                                type="button"
                                onClick={openAddModal}
                                title="Add a new product"
                            >
                                <i className="ti ti-plus" style={{ fontSize: 14 }} />
                                Add
                            </button>
                        </div>
                    )}

                    {error && (
                        <div style={styles.errorBanner}>
                            <i className="ti ti-alert-circle" style={{ fontSize: 15 }} />
                            {error}
                        </div>
                    )}

                    {/* Filters */}
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: 15, color: "#7c8aa3" }}
                                aria-hidden="true"
                            />
                            <input
                                style={styles.searchInput}
                                placeholder="Search products..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

                        <select
                            style={styles.filterSelect}
                            value={clientFilter}
                            onChange={(e) => setClientFilter(e.target.value)}
                            aria-label="Client"
                        >
                            <option value="All">Client: All</option>
                            {clientOptions.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>

                        <select
                            style={styles.filterSelect}
                            value={subclientFilter}
                            onChange={(e) => setSubclientFilter(e.target.value)}
                            aria-label="Subclient"
                        >
                            <option value="All">Subclient: All</option>
                            {subclientOptions.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>

                        {!isMobile && (
                            <div style={styles.viewToggle}>
                                <button
                                    type="button"
                                    onClick={() => setViewMode("grid")}
                                    style={{
                                        ...styles.viewToggleBtn,
                                        ...(viewMode === "grid" ? styles.viewToggleBtnActive : {}),
                                    }}
                                    aria-label="Grid view"
                                    title="Grid view"
                                >
                                    <i className="ti ti-layout-grid" style={{ fontSize: 15 }} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode("list")}
                                    style={{
                                        ...styles.viewToggleBtn,
                                        ...(viewMode === "list" ? styles.viewToggleBtnActive : {}),
                                    }}
                                    aria-label="List view"
                                    title="List view"
                                >
                                    <i className="ti ti-list" style={{ fontSize: 15 }} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Cards / Table — scrollable area that fills remaining height.
                        The scrollbar (and scroll behavior) only kicks in once content
                        actually exceeds the available space; short lists sit flush
                        with no scrollbar at all. No pagination controls. */}
                    <div className="pr-scroll-area" style={styles.scrollArea}>
                        {loading ? (
                            <div style={styles.emptyState}>
                                <p style={styles.emptyText}>Loading…</p>
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-package"
                                    style={{ fontSize: 32, color: "#9fd6e6" }}
                                />
                                <p style={styles.emptyText}>No products match your filters.</p>
                            </div>
                        ) : viewMode === "list" ? (
                            <div style={styles.tableWrap}>
                                <table className="pr-table" style={styles.table}>
                                    <colgroup>
                                        <col style={{ width: "26%" }} />
                                        <col style={{ width: "16%" }} />
                                        <col style={{ width: "22%" }} />
                                        <col style={{ width: "20%" }} />
                                        <col style={{ width: "16%" }} />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th style={styles.th}>Product</th>
                                            <th style={styles.th}>Time Taken</th>
                                            <th style={styles.th}>Client</th>
                                            <th style={styles.th}>Subclient</th>
                                            <th style={{ ...styles.th, textAlign: "left" }}>
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredProducts.map((p) => {
                                            const avatar = getAvatarColors(p.product_name);
                                            return (
                                                <tr
                                                    key={p.id}
                                                    className="pr-row"
                                                    style={{
                                                        ...styles.tr,
                                                        boxShadow: `inset 3px 0 0 0 ${avatar.solid}`,
                                                    }}
                                                >
                                                    <td style={styles.td}>
                                                        <span style={styles.tdNameText}>
                                                            {p.product_name}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdContactLine}>
                                                            <i
                                                                className="ti ti-clock"
                                                                style={{ fontSize: 12 }}
                                                            />
                                                            {formatTimeTaken(
                                                                p.time_taken,
                                                                p.time_unit
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {p.client || "—"}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {p.subclient || "—"}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <div style={styles.tdActions}>
                                                            <button
                                                                type="button"
                                                                className="pr-view-btn"
                                                                style={styles.viewDetailsBtn}
                                                                onClick={() => setViewDetails(p)}
                                                                title="View details"
                                                            >
                                                                View
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="pr-icon-btn"
                                                                style={styles.iconBtn}
                                                                aria-label="Edit"
                                                                title="Edit product"
                                                                onClick={() => openEditModal(p)}
                                                            >
                                                                <i
                                                                    className="ti ti-pencil"
                                                                    style={{ fontSize: 13 }}
                                                                />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="pr-icon-btn-danger"
                                                                style={styles.iconBtnDanger}
                                                                aria-label="Delete"
                                                                title="Delete product"
                                                                onClick={() =>
                                                                    openDeleteConfirm(
                                                                        p.id,
                                                                        p.product_name
                                                                    )
                                                                }
                                                            >
                                                                <i
                                                                    className="ti ti-trash"
                                                                    style={{ fontSize: 13 }}
                                                                />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div style={isMobile ? styles.cardGridMobile : styles.cardGrid}>
                                {filteredProducts.map((p) => {
                                    const avatar = getAvatarColors(p.product_name);
                                    return (
                                        <div
                                            key={p.id}
                                            className="pr-card"
                                            style={{
                                                ...styles.card,
                                                border: `1px solid ${avatar.solid}40`,
                                                borderTop: `3px solid ${avatar.solid}`,
                                            }}
                                        >
                                            <div style={styles.cardHeaderSimple}>
                                                <div
                                                    style={{
                                                        ...styles.avatar,
                                                        background: `linear-gradient(135deg, ${avatar.from}, ${avatar.to})`,
                                                        color: "#fff",
                                                    }}
                                                >
                                                    {getInitials(p.product_name)}
                                                </div>
                                                <div style={styles.cardNameBlockSimple}>
                                                    <span style={styles.cardName}>
                                                        {p.product_name}
                                                    </span>
                                                    <span
                                                        style={{
                                                            ...styles.cardCountBadge,
                                                            background: `${avatar.solid}1A`,
                                                            color: avatar.solid,
                                                        }}
                                                    >
                                                        {p.client || "No client"}
                                                    </span>
                                                </div>
                                            </div>

                                            <div style={styles.cardSimpleInfoRows}>
                                                <div style={styles.cardSimpleInfoRow}>
                                                    <i
                                                        className="ti ti-clock"
                                                        style={styles.cardInfoIcon}
                                                    />
                                                    <span style={styles.cardSimpleInfoValue}>
                                                        {formatTimeTaken(p.time_taken, p.time_unit)}
                                                    </span>
                                                </div>
                                                <div style={styles.cardSimpleInfoRow}>
                                                    <i
                                                        className="ti ti-building"
                                                        style={styles.cardInfoIcon}
                                                    />
                                                    <span style={styles.cardSimpleInfoValue}>
                                                        {p.client || "—"}
                                                    </span>
                                                </div>
                                                <div style={styles.cardSimpleInfoRow}>
                                                    <i
                                                        className="ti ti-sitemap"
                                                        style={styles.cardInfoIcon}
                                                    />
                                                    <span style={styles.cardSimpleInfoValue}>
                                                        {p.subclient || "—"}
                                                    </span>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                className="pr-view-btn-filled"
                                                style={{
                                                    ...styles.viewDetailsBtnFilled,
                                                    background: `${avatar.solid}14`,
                                                    color: avatar.solid,
                                                    boxShadow: "none",
                                                }}
                                                onClick={() => setViewDetails(p)}
                                            >
                                                <i className="ti ti-eye" style={{ fontSize: 14 }} />
                                                View Details
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* View Details modal */}
            {viewDetails && (
                <div style={styles.overlay} onClick={() => setViewDetails(null)}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>{viewDetails.product_name}</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={() => setViewDetails(null)}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Time Taken</span>
                                <span style={styles.detailsValue}>
                                    {formatTimeTaken(viewDetails.time_taken, viewDetails.time_unit)}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Client</span>
                                <span style={styles.detailsValue}>{viewDetails.client || "—"}</span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Subclient</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.subclient || "—"}
                                </span>
                            </div>

                            <div style={styles.detailsModalFooter}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={() => {
                                        const target = viewDetails;
                                        setViewDetails(null);
                                        if (target) openEditModal(target);
                                    }}
                                >
                                    <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.addSubmitBtn,
                                        flex: 1,
                                        background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                                        boxShadow: "0 6px 16px rgba(220,38,38,0.3)",
                                    }}
                                    onClick={() => {
                                        const target = viewDetails;
                                        setViewDetails(null);
                                        if (target) {
                                            openDeleteConfirm(target.id, target.product_name);
                                        }
                                    }}
                                >
                                    <i className="ti ti-trash" style={{ fontSize: 13 }} />
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add modal */}
            {showAddModal && (
                <div style={styles.overlay} onClick={closeAddModal}>
                    <div style={styles.addModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Add Product</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={closeAddModal}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.addBody}>
                            {renderProductFieldset(addForm, setAddForm)}

                            {addError && <p style={styles.formError}>{addError}</p>}

                            <button
                                type="button"
                                style={{
                                    ...styles.addSubmitBtn,
                                    opacity: addSubmitting ? 0.7 : 1,
                                    cursor: addSubmitting ? "not-allowed" : "pointer",
                                }}
                                onClick={handleAddSubmit}
                                disabled={addSubmitting}
                            >
                                {addSubmitting ? "Saving..." : "Add Product"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit modal */}
            {editTarget && (
                <div style={styles.overlay} onClick={closeEditModal}>
                    <div style={styles.addModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Edit Product</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={closeEditModal}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.addBody}>
                            {renderProductFieldset(editForm, setEditForm)}

                            {editError && <p style={styles.formError}>{editError}</p>}

                            <button
                                type="button"
                                style={{
                                    ...styles.addSubmitBtn,
                                    opacity: editSubmitting ? 0.7 : 1,
                                    cursor: editSubmitting ? "not-allowed" : "pointer",
                                }}
                                onClick={handleEditSubmit}
                                disabled={editSubmitting}
                            >
                                {editSubmitting ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation modal */}
            {deleteTarget && (
                <div style={styles.overlay} onClick={closeDeleteConfirm}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Delete {deleteTarget.name}?</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={closeDeleteConfirm}
                                type="button"
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <p style={{ margin: 0, fontSize: 13, color: "#3b4a63" }}>
                                This action can't be undone. Are you sure you want to delete this
                                product?
                            </p>

                            {deleteError && <p style={styles.formError}>{deleteError}</p>}

                            <div style={{ display: "flex", gap: 10 }}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.secondaryBtn,
                                        flex: 1,
                                        justifyContent: "center",
                                    }}
                                    onClick={closeDeleteConfirm}
                                    disabled={deleting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.addSubmitBtn,
                                        flex: 1,
                                        background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                                        boxShadow: "0 6px 16px rgba(220,38,38,0.3)",
                                        opacity: deleting ? 0.7 : 1,
                                        cursor: deleting ? "not-allowed" : "pointer",
                                    }}
                                    onClick={handleDeleteConfirm}
                                    disabled={deleting}
                                >
                                    {deleting ? "Deleting..." : "Delete"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Upload modal — mirrors the "Bulk Add Users" modal on the
                Add User page: title/subtitle, required-columns callout,
                Choose File row, and an explicit Upload button, with
                results/errors rendered inline below once a file is
                submitted. */}
            {showBulkModal && (
                <div style={styles.overlay} onClick={closeBulkModal}>
                    <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.bulkModalHeader}>
                            <h3 style={styles.bulkModalTitle}>Bulk Add Products</h3>
                            <p style={styles.bulkModalSubtitle}>
                                Upload an Excel file to create multiple products at once
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
                            <p style={styles.bulkInfoText}>{BULK_REQUIRED_COLUMNS_TEXT}</p>
                        </div>

                        <div style={styles.bulkUploadRow}>
                            <label style={styles.fileInputWrapper}>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={handleBulkFileSelect}
                                    style={styles.fileInputHidden}
                                    disabled={bulkUploading}
                                />
                                <span style={styles.fileInputButton}>Choose File</span>
                                <span style={styles.fileInputName}>
                                    {bulkFile ? bulkFile.name : "No file chosen"}
                                </span>
                            </label>
                            <button
                                type="button"
                                onClick={handleBulkUploadSubmit}
                                disabled={bulkUploading}
                                style={{
                                    ...styles.bulkUploadBtn,
                                    opacity: bulkUploading ? 0.7 : 1,
                                    cursor: bulkUploading ? "not-allowed" : "pointer",
                                }}
                            >
                                {bulkUploading ? "Uploading…" : "Upload & Create Products"}
                            </button>
                        </div>

                        {bulkError && (
                            <p style={{ ...styles.formError, margin: "0 28px 20px" }}>
                                {bulkError}
                            </p>
                        )}

                        {bulkResult && (
                            <div style={styles.resultsSection}>
                                <div style={styles.resultsSummary}>
                                    <span style={styles.resultsSummaryText}>
                                        <strong>{bulkResult.totalRows}</strong> total rows
                                    </span>
                                </div>

                                {bulkResult.created &&
                                    Object.entries(bulkResult.created).map(([key, val]) => (
                                        <div style={styles.detailsRow} key={key}>
                                            <span style={styles.detailsLabel}>
                                                Created {key.charAt(0).toUpperCase() + key.slice(1)}
                                            </span>
                                            <span style={styles.detailsValue}>{val}</span>
                                        </div>
                                    ))}

                                {bulkResult.rowErrors && bulkResult.rowErrors.length > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                        <p
                                            style={{
                                                ...styles.detailsLabel,
                                                marginBottom: 8,
                                                display: "block",
                                            }}
                                        >
                                            Errors ({bulkResult.rowErrors.length})
                                        </p>
                                        <div style={styles.resultsList}>
                                            {bulkResult.rowErrors.map((re, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{ fontSize: 12, color: "#dc2626" }}
                                                >
                                                    Row {re.row}: {re.message}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Products;

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        width: "100%",
        height: "100vh",
        flex: 1,
        minHeight: 0,
        background: "#f4f7fb",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100vh",
        minHeight: 0,
        width: "100%",
        background: "#f4f7fb",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
        overflow: "hidden",
    },

    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },

    contentCol: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
    },
    contentColMobile: { flex: 1, display: "flex", flexDirection: "column" },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px",
        flex: 1,
        minHeight: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        gap: 14,
    },

    pageTitle: {
        margin: 0,
        fontSize: 20,
        fontWeight: 800,
        color: "#16233c",
        flexShrink: 0,
    },

    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        flexShrink: 0,
    },
    headerRowMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexShrink: 0,
    },
    headerSubtext: { margin: 0, fontSize: 13, color: "#7c8aa3" },
    headerActions: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    secondaryBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#204297",
        border: "1px solid #cfe0f5",
        borderRadius: 10,
        padding: "11px 16px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    addBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "11px 20px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(32,66,151,0.28)",
        whiteSpace: "nowrap",
    },

    errorBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fdecea",
        color: "#c0392b",
        padding: "10px 14px",
        borderRadius: "10px",
        fontSize: "13px",
        flexShrink: 0,
    },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
        flexShrink: 0,
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
        flexShrink: 0,
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        borderRadius: 10,
        padding: "9px 12px",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: 13,
        color: "#16233c",
        width: "100%",
    },
    filterSelect: {
        border: "1px solid #e4e9f2",
        background: "#fafbfc",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 13,
        color: "#3b4a63",
        outline: "none",
        cursor: "pointer",
        minWidth: 120,
    },
    viewToggle: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        borderRadius: 10,
        padding: 4,
        flexShrink: 0,
    },
    viewToggleBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: "none",
        background: "transparent",
        borderRadius: 7,
        color: "#7c8aa3",
        cursor: "pointer",
    },
    viewToggleBtnActive: {
        background: "#e7ecf8",
        color: "#204297",
    },

    // Scrollable: fills remaining vertical space in contentBody and only
    // scrolls (shows a scrollbar) once the rendered cards/rows exceed that
    // height. When there's little content, this behaves like a normal
    // block with no scroll affordance.
    scrollArea: {
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
    },

    cardGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 14,
    },
    cardGridMobile: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 12,
    },

    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 0",
    },
    emptyText: { margin: 0, fontSize: 13, color: "#7c8aa3" },

    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: 14,
        padding: 13,
        boxShadow: "0 4px 14px rgba(0,0,0,.04)",
        gap: 9,
    },
    cardHeaderSimple: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
    },
    cardNameBlockSimple: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
        minWidth: 0,
    },
    cardCountBadge: {
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 20,
        whiteSpace: "nowrap",
        width: "fit-content",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    cardSimpleInfoRows: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    cardSimpleInfoRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
    },
    cardSimpleInfoValue: {
        fontSize: 12.5,
        color: "#3b4a63",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardInfoIcon: { fontSize: 12, color: "#a7b3c8", flexShrink: 0 },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: "50%",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
    },
    cardName: {
        fontSize: 13,
        fontWeight: 700,
        color: "#16233c",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },

    viewDetailsBtn: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        color: "#204297",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        padding: 0,
    },
    viewDetailsBtnFilled: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flex: 1,
        border: "none",
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        fontSize: 12.5,
        fontWeight: 700,
        borderRadius: 10,
        padding: "11px 16px",
        cursor: "pointer",
        boxShadow: "0 6px 14px rgba(32,66,151,0.25)",
    },
    iconBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "1px solid #d8e3fa",
        background: "#eef2fc",
        color: "#3454ad",
        cursor: "pointer",
        transition: "background .15s ease, border-color .15s ease, color .15s ease",
    },
    iconBtnDanger: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "1px solid #fee2e2",
        background: "#fef2f2",
        color: "#dc2626",
        cursor: "pointer",
        transition: "background .15s ease, border-color .15s ease",
    },

    // ---- Table (list view) ----
    tableWrap: {
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: 16,
        boxShadow: "0 6px 20px rgba(16,38,89,.06)",
        overflowX: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        fontSize: 13,
        tableLayout: "fixed",
    },
    th: {
        textAlign: "left",
        padding: "15px 18px",
        boxSizing: "border-box",
        fontSize: 11,
        fontWeight: 800,
        color: "#204297",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        borderBottom: "2px solid #e1e9f7",
        background: "linear-gradient(180deg, #f3f7fd, #eef3fb)",
        position: "sticky",
        top: 0,
        zIndex: 1,
    },
    tr: {
        borderBottom: "1px solid #eef2f9",
        transition: "background .12s ease",
    },
    td: {
        padding: "14px 18px",
        boxSizing: "border-box",
        verticalAlign: "middle",
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    tdNameText: {
        fontSize: 13,
        fontWeight: 700,
        color: "#16233c",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    tdMuted: {
        fontSize: 12.5,
        color: "#5a6c85",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    tdContactLine: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 6,
        fontSize: 12,
        color: "#3b4a63",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    tdActions: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8 },

    detailsModal: {
        background: "#fff",
        borderRadius: 16,
        width: 480,
        maxWidth: "94vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    addModal: {
        background: "#fff",
        borderRadius: 16,
        width: 560,
        maxWidth: "94vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    detailsHeader: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "22px 28px 16px",
        borderBottom: "1px solid #f0f0f0",
    },
    detailsTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "#16233c" },
    closeBtn: {
        position: "absolute",
        top: 18,
        right: 20,
        border: "none",
        background: "#f3f4f6",
        borderRadius: "50%",
        width: 28,
        height: 28,
        fontSize: 14,
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    detailsBody: { padding: "20px 28px 28px", display: "flex", flexDirection: "column", gap: 14 },
    detailsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    detailsLabel: { fontSize: 12, color: "#7c8aa3", fontWeight: 600 },
    detailsValue: { fontSize: 13, color: "#16233c", fontWeight: 600 },
    detailsModalFooter: {
        display: "flex",
        gap: 10,
        marginTop: 6,
        paddingTop: 16,
        borderTop: "1px solid #f0f0f0",
    },

    addBody: {
        padding: "20px 28px 28px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "14px 16px",
    },
    formLabel: {
        display: "block",
        marginBottom: 6,
        color: "#3b4a63",
        fontSize: 12,
        fontWeight: 600,
    },
    formInput: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        outline: "none",
        fontSize: 13,
        borderRadius: 8,
        boxSizing: "border-box",
        color: "#16233c",
    },
    formError: { color: "#dc2626", margin: 0, fontWeight: 600, fontSize: 12, gridColumn: "1 / -1" },
    addSubmitBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "12px 20px",
        fontSize: 13,
        fontWeight: 700,
        boxShadow: "0 6px 16px rgba(32,66,151,0.28)",
        gridColumn: "1 / -1",
    },

    // ---- Bulk Upload modal (matches Add User's "Bulk Add Users" modal,
    // recolored to this page's blue #08A1CE -> #204297 brand gradient) ----
    bulkModal: {
        background: "#fff",
        borderRadius: 16,
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
    bulkModalTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: "#204297" },
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: 13, color: "#7c8aa3" },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "#eaf6fb",
        borderLeft: "3px solid #08A1CE",
        borderRadius: 6,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#204297",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 4,
    },
    bulkInfoText: { margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.6 },
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
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
        flex: 1,
        minWidth: 200,
        background: "#fafafa",
    },
    fileInputHidden: { display: "none" },
    fileInputButton: {
        background: "#204297",
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 12px",
        borderRadius: 6,
        whiteSpace: "nowrap",
    },
    fileInputName: {
        fontSize: 13,
        color: "#6b7280",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    bulkUploadBtn: {
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
    },
    resultsSection: { borderTop: "1px solid #f0f0f0", padding: "20px 28px 28px" },
    resultsSummary: { marginBottom: 12 },
    resultsSummaryText: { fontSize: 14, color: "#16233c" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 260,
        overflowY: "auto",
    },
};
