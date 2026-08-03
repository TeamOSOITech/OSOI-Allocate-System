import { useState, useEffect, useMemo } from "react";
import { authFetch } from "../../utils/authFetch";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

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
// FIX: this was hardcoded to "http://localhost:3001", so the DEPLOYED
// (Vercel) frontend was trying to call the user's OWN machine's
// localhost instead of the real deployed backend — which obviously
// never connects, and looks exactly like a network/cold-start failure.
// Every other page uses import.meta.env.VITE_API_URL; this one just
// never got updated to match.
const API_BASE = import.meta.env.VITE_API_URL;
const ENDPOINT = `${API_BASE}/api/products`;

// REVERSED MAPPING: a Product is now a standalone catalog entry. It no
// longer carries a client/subclient on itself — Clients and Subclients
// each pick which Products they use (see the Clients page instead).
type Product = {
    id: string;
    product_name: string;
    time_taken: string;
    time_unit: string;
    created_at?: string;
    updated_at?: string;
};

type ProductForm = {
    product_name: string;
    time_taken: string;
    time_unit: string;
};

const emptyForm: ProductForm = {
    product_name: "",
    time_taken: "",
    time_unit: "",
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
const BULK_REQUIRED_COLUMNS_TEXT = "Product Name, Time Taken";

const Products = () => {
    // Matches backend's authorize("SUPER_ADMIN") gate on POST/bulk-upload
    // for /api/products — hide the buttons for anyone who'd just get a
    // 403 from clicking them (Phase 5: hide create actions from every
    // role except the ones actually allowed).
    let currentUser: { role?: string } | null = null;
    try {
        const userStr = localStorage.getItem("user");
        currentUser = userStr ? JSON.parse(userStr) : null;
    } catch {
        currentUser = null;
    }
    const canManage = (currentUser?.role || "").toUpperCase() === "SUPER_ADMIN";

    const isMobile = useIsMobile();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
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
                throw new Error(json.message || "Failed to load services");
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

    const filteredProducts = useMemo(
        () =>
            products.filter((p) =>
                (p.product_name || "").toLowerCase().includes(search.trim().toLowerCase())
            ),
        [products, search]
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
            setAddError("Service name is required.");
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
                throw new Error(json.message || "Failed to create service");
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
            setEditError("Service name is required.");
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
                throw new Error(json.message || "Failed to update service");
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
                throw new Error(json.message || "Failed to delete service");
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
                <label style={styles.formLabel}>Service Name</label>
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
        </>
    );

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {/* Page title */}
                    {!isMobile && <h2 style={styles.pageTitle}>Services</h2>}

                    {/* Header row */}
                    {!isMobile && (
                        <div style={styles.headerRow}>
                            <p style={styles.headerSubtext}>
                                View, add, edit or remove Services from the system.
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
                                            style={{ fontSize: fontSize.md }}
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
                                {canManage && (
                                    <span className="pr-tooltip-wrap">
                                        <button
                                            type="button"
                                            style={styles.secondaryBtn}
                                            onClick={openBulkModal}
                                        >
                                            <i
                                                className="ti ti-upload"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            Bulk Upload
                                        </button>
                                        <span className="pr-tooltip-bubble">
                                            Upload services from an Excel (.xlsx) file
                                        </span>
                                    </span>
                                )}

                                {canManage && (
                                    <button
                                        style={styles.addBtn}
                                        type="button"
                                        onClick={openAddModal}
                                        title="Add a new service"
                                    >
                                        <i
                                            className="ti ti-plus"
                                            style={{ fontSize: fontSize.md }}
                                        />
                                        Add Service
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {isMobile && (
                        <div style={styles.headerRowMobile}>
                            <h2 style={styles.pageTitle}>Services</h2>
                            {canManage && (
                                <button
                                    style={styles.addBtn}
                                    type="button"
                                    onClick={openAddModal}
                                    title="Add a new service"
                                >
                                    <i className="ti ti-plus" style={{ fontSize: fontSize.md }} />
                                    Add
                                </button>
                            )}
                        </div>
                    )}

                    {error && (
                        <div style={styles.errorBanner}>
                            <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                            {error}
                        </div>
                    )}

                    {/* Filters */}
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: fontSize.lg, color: "#7c8aa3" }}
                                aria-hidden="true"
                            />
                            <input
                                style={styles.searchInput}
                                placeholder="Search services..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

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
                                    <i
                                        className="ti ti-layout-grid"
                                        style={{ fontSize: fontSize.lg }}
                                    />
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
                                    <i className="ti ti-list" style={{ fontSize: fontSize.lg }} />
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
                                    style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                                />
                                <p style={styles.emptyText}>No services match your filters.</p>
                            </div>
                        ) : viewMode === "list" ? (
                            <div style={styles.tableWrap}>
                                <table className="pr-table" style={styles.table}>
                                    <colgroup>
                                        <col style={{ width: "40%" }} />
                                        <col style={{ width: "30%" }} />
                                        <col style={{ width: "30%" }} />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th style={styles.th}>Service</th>
                                            <th style={styles.th}>Time Taken</th>
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
                                                                style={{ fontSize: fontSize.sm }}
                                                            />
                                                            {formatTimeTaken(
                                                                p.time_taken,
                                                                p.time_unit
                                                            )}
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
                                                                title="Edit service"
                                                                onClick={() => openEditModal(p)}
                                                            >
                                                                <i
                                                                    className="ti ti-pencil"
                                                                    style={{
                                                                        fontSize: fontSize.base,
                                                                    }}
                                                                />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="pr-icon-btn-danger"
                                                                style={styles.iconBtnDanger}
                                                                aria-label="Delete"
                                                                title="Delete service"
                                                                onClick={() =>
                                                                    openDeleteConfirm(
                                                                        p.id,
                                                                        p.product_name
                                                                    )
                                                                }
                                                            >
                                                                <i
                                                                    className="ti ti-trash"
                                                                    style={{
                                                                        fontSize: fontSize.base,
                                                                    }}
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
                                                        {p.time_unit === "hours"
                                                            ? "Hourly"
                                                            : "Per minute"}
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
                                                <i
                                                    className="ti ti-eye"
                                                    style={{ fontSize: fontSize.md }}
                                                />
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
                                    <i
                                        className="ti ti-pencil"
                                        style={{ fontSize: fontSize.base }}
                                    />
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
                                    <i
                                        className="ti ti-trash"
                                        style={{ fontSize: fontSize.base }}
                                    />
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
                            <h3 style={styles.detailsTitle}>Add Service</h3>
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
                                {addSubmitting ? "Saving..." : "Add Service"}
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
                            <h3 style={styles.detailsTitle}>Edit Service</h3>
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
                            <p style={{ margin: 0, fontSize: fontSize.base, color: "#3b4a63" }}>
                                This action can't be undone. Are you sure you want to delete this
                                service?
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
                            <h3 style={styles.bulkModalTitle}>Bulk Add Services</h3>
                            <p style={styles.bulkModalSubtitle}>
                                Upload an Excel file to create multiple services at once
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
                                {bulkUploading ? "Uploading…" : "Upload & Create Services"}
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
                                                    style={{
                                                        fontSize: fontSize.sm,
                                                        color: "#dc2626",
                                                    }}
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
        fontFamily: fontFamily.base,
        overflow: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100dvh",
        minHeight: 0,
        width: "100%",
        background: "#f4f7fb",
        fontFamily: fontFamily.base,
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
    contentColMobile: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
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
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        flexShrink: 0,
        textAlign: "left",
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
    headerSubtext: { margin: 0, fontSize: fontSize.base, color: "#7c8aa3" },
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
        borderRadius: radius.md,
        padding: "11px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
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
        borderRadius: radius.md,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
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
        borderRadius: radius.md,
        fontSize: fontSize.base,
        flexShrink: 0,
    },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
        flexShrink: 0,
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: radius.lg,
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
        borderRadius: radius.md,
        padding: "9px 12px",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.base,
        color: "#16233c",
        width: "100%",
    },
    filterSelect: {
        border: "1px solid #e4e9f2",
        background: "#fafbfc",
        borderRadius: radius.md,
        padding: "9px 12px",
        fontSize: fontSize.base,
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
        borderRadius: radius.md,
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
        borderRadius: radius.sm,
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
    emptyText: { margin: 0, fontSize: fontSize.base, color: "#7c8aa3" },

    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: radius.lg,
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
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
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
        fontSize: fontSize.sm,
        color: "#3b4a63",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardInfoIcon: { fontSize: fontSize.sm, color: "#a7b3c8", flexShrink: 0 },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: radius.circle,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    cardName: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
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
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
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
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        borderRadius: radius.md,
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
        borderRadius: radius.sm,
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
        borderRadius: radius.sm,
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
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(16,38,89,.06)",
        overflowX: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        fontSize: fontSize.base,
        tableLayout: "fixed",
    },
    th: {
        textAlign: "left",
        padding: "15px 18px",
        boxSizing: "border-box",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.bold,
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
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    tdMuted: {
        fontSize: fontSize.sm,
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
        fontSize: fontSize.sm,
        color: "#3b4a63",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    tdActions: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8 },

    detailsModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 480,
        maxWidth: "94vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    addModal: {
        background: "#fff",
        borderRadius: radius.lg,
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
    detailsTitle: {
        margin: 0,
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.semibold,
        color: "#16233c",
    },
    closeBtn: {
        position: "absolute",
        top: 18,
        right: 20,
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
    detailsBody: { padding: "20px 28px 28px", display: "flex", flexDirection: "column", gap: 14 },
    detailsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    detailsLabel: { fontSize: fontSize.sm, color: "#7c8aa3", fontWeight: fontWeight.medium },
    detailsValue: { fontSize: fontSize.base, color: "#16233c", fontWeight: fontWeight.medium },
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
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
    },
    formInput: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        outline: "none",
        fontSize: fontSize.base,
        borderRadius: radius.sm,
        boxSizing: "border-box",
        color: "#16233c",
    },
    formError: {
        color: "#dc2626",
        margin: 0,
        fontWeight: fontWeight.medium,
        fontSize: fontSize.sm,
        gridColumn: "1 / -1",
    },
    addSubmitBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #08A1CE, #204297)",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "12px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 16px rgba(32,66,151,0.28)",
        gridColumn: "1 / -1",
    },

    // ---- Bulk Upload modal (matches Add User's "Bulk Add Users" modal,
    // recolored to this page's blue #08A1CE -> #204297 brand gradient) ----
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
        color: "#204297",
    },
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#7c8aa3" },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "#eaf6fb",
        borderLeft: "3px solid #08A1CE",
        borderRadius: radius.xs,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#204297",
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
        background: "#204297",
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
        background: "linear-gradient(135deg, #08A1CE, #204297)",
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
    resultsSummaryText: { fontSize: fontSize.md, color: "#16233c" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 260,
        overflowY: "auto",
    },
};
