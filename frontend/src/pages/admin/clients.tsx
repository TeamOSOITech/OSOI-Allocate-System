import { useState, useEffect, useMemo } from "react";
import { authFetch } from "../../utils/authFetch";
import type { CSSProperties } from "react";
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

type EntityStatus = "Active" | "Inactive";

// REVERSED MAPPING: the rate for a linked product is per Client/Subclient,
// not fixed on the product itself — same product can cost differently for
// a different client.
type ProductRate = {
    productId: number;
    amount: number | string | null;
    currency: string;
};

const CURRENCY_OPTIONS = ["USD", "GBP", "INR", "EUR", "AUD", "CAD"];

type Client = {
    id: number;
    name: string;
    country: string | null;
    status: EntityStatus;
    subclients: number;
    branches: number;
    users: number;
    website: string | null;
    mainEmail: string | null;
    mainPhone: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
    secondaryContactName: string | null;
    secondaryContactEmail: string | null;
    secondaryContactPhone: string | null;
    // REVERSED MAPPING: which Products this Client is linked to, via the
    // client_products junction table — each with its own amount/currency.
    productRates?: ProductRate[];
    products?: { id: number; product_name: string }[];
};

// Subclients now carry the same Primary/Secondary contact fields as Clients
// so both entities are viewable, editable, and exportable with parity.
type SubclientRow = {
    id: number;
    name: string;
    clientId: number;
    clientName: string;
    country: string | null;
    status: EntityStatus;
    branches: number;
    users: number;
    website: string | null;
    mainEmail: string | null;
    mainPhone: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
    secondaryContactName: string | null;
    secondaryContactEmail: string | null;
    secondaryContactPhone: string | null;
    // REVERSED MAPPING: which Products this Subclient is linked to, via the
    // subclient_products junction table — each with its own amount/currency.
    productRates?: ProductRate[];
    products?: { id: number; product_name: string }[];
};

// A Product is now a standalone catalog entry (see products.tsx) — Clients
// and Subclients each pick which ones they use.
type ProductOption = {
    id: number;
    product_name: string;
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
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarColors(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// Normalizes a raw website value (e.g. "acme.com" or "www.acme.com") into a
// safe, absolute href so it always opens correctly in a new tab, regardless
// of whether the user typed a protocol when entering it in the form.
function toSafeHref(raw: string) {
    const trimmed = raw.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

// Small reusable clickable-website renderer used in both the card view and
// the details modal. Falls back to a plain "—" when no website is set, and
// never throws on malformed input — worst case it just builds a best-effort
// https:// link.
function WebsiteLink({ website, style }: { website: string | null; style?: CSSProperties }) {
    if (!website || !website.trim()) {
        return <span style={style}>—</span>;
    }
    return (
        <a
            href={toSafeHref(website)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...style, color: "var(--brand-light-blue)", textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
            title={website}
        >
            {website}
        </a>
    );
}

type TabKey = "client" | "subclient";

type ViewDetailsTarget =
    { type: "client"; data: Client } | { type: "subclient"; data: SubclientRow };

// Row-level bulk result, one entry per row in the uploaded sheet — whether
// that row succeeded or failed — so the modal can render a full list
// exactly like the "Bulk Add Users" page does.
type BulkRowResult = {
    row: number;
    identifier: string;
    status: "created" | "failed";
    message?: string;
};

type BulkResult = {
    totalRows: number;
    createdCount: number;
    failedCount: number;
    results: BulkRowResult[];
};

type DeleteTarget = {
    type: TabKey;
    id: number;
    name: string;
};

// Maps the active tab to the corresponding API resource path used by the
// bulk template/upload endpoints on the backend.
const BULK_ENDPOINT_MAP: Record<TabKey, string> = {
    client: "clients",
    subclient: "subclients",
};

// Injected once — inline style objects can't express :hover/:focus, so the
// handful of interactive/motion rules live here instead of duplicating them
// as onMouseEnter/onMouseLeave handlers everywhere.
//
// All brand colors below reference the CSS custom properties set on
// <html> by ThemeProvider (--brand-blue / --brand-light-blue / --brand-green
// / their *-rgb counterparts for rgba() shadows), so this entire page — the
// tabs, table hover state, tooltips, and the Sample Sheet / Bulk Upload
// affordances — automatically follows whichever theme color is selected
// from the header's "Theme color" picker, instead of being pinned to one
// fixed palette.
const GLOBAL_CSS = `
.cl-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.cl-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(var(--brand-blue-rgb), .12);
  border-color: #cfe0f5;
}
.cl-row:nth-child(even) { background: #fbfcfe; }
.cl-row { box-shadow: inset 3px 0 0 0 transparent; }
.cl-row:hover { background: #f0f6fd; box-shadow: inset 3px 0 0 0 var(--brand-light-blue); }
.cl-view-btn:hover { text-decoration: underline; }
.cl-view-btn-filled:hover { filter: brightness(1.06); transform: translateY(-1px); }
.cl-icon-btn:hover { background: #eef4fb; border-color: #cfe0f5; color: var(--brand-blue); transform: translateY(-1px); }
.cl-icon-btn-danger:hover { background: #fee2e2; border-color: #fecaca; transform: translateY(-1px); }
.cl-tab-btn:hover { border-color: #cfe0f5; color: var(--brand-blue); }
.cl-table thead th:first-child { border-top-left-radius: 16px; }
.cl-table thead th:last-child { border-top-right-radius: 16px; }

/* Tooltip used on the Sample Sheet button so hover clearly communicates
   that the download is an Excel (.xlsx) template for bulk upload. Colors
   follow the active theme gradient (same one used on tabs, Add button, and
   the filled View Details button), rather than a fixed palette. */
.cl-tooltip-wrap { position: relative; display: inline-flex; }
.cl-tooltip-wrap .cl-tooltip-bubble {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue));
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
  box-shadow: 0 8px 20px rgba(var(--brand-blue-rgb), .35);
}
.cl-tooltip-wrap .cl-tooltip-bubble::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: var(--brand-light-blue);
}
.cl-tooltip-wrap:hover .cl-tooltip-bubble {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

/* Custom slim scrollbar for the list/grid area so it reads as a native
   overflow container rather than the page itself growing. */
.cl-scroll-area::-webkit-scrollbar { width: 8px; }
.cl-scroll-area::-webkit-scrollbar-track { background: transparent; }
.cl-scroll-area::-webkit-scrollbar-thumb { background: #cfd9ea; border-radius: 8px; }
.cl-scroll-area::-webkit-scrollbar-thumb:hover { background: #b7c4dc; }

/* Bulk upload results list scrollbar (Bulk Add Users style) */
.cl-results-list::-webkit-scrollbar { width: 8px; }
.cl-results-list::-webkit-scrollbar-track { background: transparent; }
.cl-results-list::-webkit-scrollbar-thumb { background: #cfd9ea; border-radius: 8px; }
.cl-results-list::-webkit-scrollbar-thumb:hover { background: #b7c4dc; }

/* Tabs wrap onto a second line instead of getting clipped by the page's
   overflow:hidden shell on narrow phone widths — this is what was hiding
   the "Subclient" tab on mobile before. */
@media (max-width: 480px) {
  .cl-tab-btn { padding: 9px 14px !important; font-size: 13px !important; }
}
`;

export default function Clients() {
    const isMobile = useIsMobile();

    // Matches backend's authorize("SUPER_ADMIN") gate on POST/bulk-upload
    // for both /api/clients and /api/subclients — hide the buttons for
    // anyone who'd just get a 403 from clicking them (Phase 5: hide
    // create actions from every role except the ones actually allowed).
    let currentUser: { role?: string } | null = null;
    try {
        const userStr = localStorage.getItem("user");
        currentUser = userStr ? JSON.parse(userStr) : null;
    } catch {
        currentUser = null;
    }
    const canManage = ["SUPER_ADMIN", "OPS_MANAGER", "AUDIT_MANAGER", "PROCESS_LEAD"].includes(
        (currentUser?.role || "").toUpperCase()
    );

    const [activeTab, setActiveTab] = useState<TabKey>("client");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [countryFilter, setCountryFilter] = useState("All");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    const [clients, setClients] = useState<Client[]>([]);
    const [subclients, setSubclients] = useState<SubclientRow[]>([]);
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [viewDetails, setViewDetails] = useState<ViewDetailsTarget | null>(null);

    // Shared shape for both Client and Subclient Add/Edit forms so both
    // entities can carry Country / Website / Main Email / Main Phone /
    // Primary Contact / Secondary Contact fields identically.
    const emptyForm = {
        name: "",
        country: "",
        status: "Active" as EntityStatus,
        clientId: "",
        website: "",
        mainEmail: "",
        mainPhone: "",
        primaryContactName: "",
        primaryContactEmail: "",
        primaryContactPhone: "",
        secondaryContactName: "",
        secondaryContactEmail: "",
        secondaryContactPhone: "",
        // REVERSED MAPPING: [{ productId, amount, currency }] for each
        // Product this Client/Subclient uses, at this client/subclient's
        // own rate.
        productRates: [] as ProductRate[],
    };

    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState({ ...emptyForm });
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState("");

    // NEW: shown as a dismissible banner when a create/edit/delete came
    // back 202 (Process Lead's request went to their reporting manager
    // for approval instead of applying immediately) — see approvalGate.js.
    const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

    // ---- Edit state ----
    const [editTarget, setEditTarget] = useState<ViewDetailsTarget | null>(null);
    const [editForm, setEditForm] = useState({ ...emptyForm });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState("");

    // ---- Delete state ----
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    // ---- Bulk upload state ----
    // Bulk upload now lives inside its own modal (opened via the "Bulk
    // Upload" button) instead of firing immediately off a hidden file
    // input, matching the Add User page's "Bulk Add Users" modal pattern:
    // required-columns callout -> Choose File -> explicit Upload button ->
    // full created/failed row-by-row results list.
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkUploading, setBulkUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
    const [bulkError, setBulkError] = useState("");

    const apiBase = import.meta.env.VITE_API_URL;

    const fetchAll = async () => {
        setLoading(true);
        setError("");
        try {
            const [clientsRes, subclientsRes, productsRes] = await Promise.all([
                authFetch(`${apiBase}/api/clients`, { cache: "no-store" }),
                authFetch(`${apiBase}/api/subclients`, { cache: "no-store" }),
                authFetch(`${apiBase}/api/products`, { cache: "no-store" }),
            ]);

            if (!clientsRes.ok) throw new Error("Failed to load clients");
            if (!subclientsRes.ok) throw new Error("Failed to load subclients");

            setClients(await clientsRes.json());
            setSubclients(await subclientsRes.json());

            // Products endpoint isn't critical to render this page, so a
            // failure here shouldn't block Clients/Subclients from showing —
            // it would just mean the "Products" picker in Add/Edit is empty.
            if (productsRes.ok) {
                const productsJson = await productsRes.json();
                setProducts(productsJson?.data || []);
            }
        } catch (err: any) {
            setError(err?.message || "Something went wrong loading data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiBase]);

    // Reset filters when switching tabs so stale country selections from one
    // dataset don't carry into another.
    useEffect(() => {
        setSearch("");
        setStatusFilter("All");
        setCountryFilter("All");
    }, [activeTab]);

    // Country filter options now come from whichever dataset is active, since
    // Subclients carry their own Country field too (same as Clients).
    const countries = useMemo(() => {
        const source = activeTab === "client" ? clients : subclients;
        return Array.from(new Set(source.map((c) => c.country).filter(Boolean) as string[])).sort();
    }, [clients, subclients, activeTab]);

    const matchesCommonFilters = (name: string, status: EntityStatus) => {
        const matchesSearch = name.toLowerCase().includes(search.trim().toLowerCase());
        const matchesStatus = statusFilter === "All" || status === statusFilter;
        return matchesSearch && matchesStatus;
    };

    const filteredClients = useMemo(
        () =>
            clients.filter((c) => {
                const matchesCountry = countryFilter === "All" || c.country === countryFilter;
                return matchesCommonFilters(c.name, c.status) && matchesCountry;
            }),
        [clients, search, statusFilter, countryFilter]
    );

    const filteredSubclients = useMemo(
        () =>
            subclients.filter((s) => {
                const matchesCountry = countryFilter === "All" || s.country === countryFilter;
                return matchesCommonFilters(s.name, s.status) && matchesCountry;
            }),
        [subclients, search, statusFilter, countryFilter]
    );

    const currentFilteredLength =
        activeTab === "client" ? filteredClients.length : filteredSubclients.length;

    // No pagination anymore — the full filtered set renders inside a
    // scrollable container. The container only shows a scrollbar (and
    // scrolls) when the content actually overflows its available height;
    // short lists sit flush with no scroll affordance at all.
    const pageClients = filteredClients;
    const pageSubclients = filteredSubclients;

    const tabCounts: Record<TabKey, number> = {
        client: clients.length,
        subclient: subclients.length,
    };

    const tabLabel = activeTab === "client" ? "Client" : "Subclient";

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

        if (!addForm.name.trim()) {
            setAddError(`${tabLabel} name is required.`);
            return;
        }
        if (activeTab !== "client" && !addForm.clientId) {
            setAddError("Client is required.");
            return;
        }

        setAddSubmitting(true);
        try {
            let url = "";
            let body: Record<string, unknown> = {
                name: addForm.name.trim(),
                status: addForm.status,
                country: addForm.country || null,
                website: addForm.website || null,
                mainEmail: addForm.mainEmail || null,
                mainPhone: addForm.mainPhone || null,
                primaryContactName: addForm.primaryContactName || null,
                primaryContactEmail: addForm.primaryContactEmail || null,
                primaryContactPhone: addForm.primaryContactPhone || null,
                secondaryContactName: addForm.secondaryContactName || null,
                secondaryContactEmail: addForm.secondaryContactEmail || null,
                secondaryContactPhone: addForm.secondaryContactPhone || null,
                // REVERSED MAPPING: this Client/Subclient links to these
                // existing Products (picked in the form below).
                productRates: addForm.productRates,
            };

            if (activeTab === "client") {
                url = `${apiBase}/api/clients`;
            } else {
                url = `${apiBase}/api/subclients`;
                body.clientId = Number(addForm.clientId);
            }

            const response = await authFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                const base = data?.message || `Failed to create ${tabLabel.toLowerCase()}`;
                throw new Error(data?.detail ? `${base}: ${data.detail}` : base);
            }

            // NEW: 202 = a Process Lead's request went to their reporting
            // manager for approval instead of being created immediately —
            // see approvalGate.js. Surface that clearly instead of letting
            // it look like a normal, already-applied create.
            if (response.status === 202) {
                const data = await response.json().catch(() => null);
                setApprovalNotice(
                    data?.message || "Submitted for approval — waiting on your reporting manager."
                );
            } else {
                setApprovalNotice(null);
            }

            await fetchAll();
            setShowAddModal(false);
        } catch (err: any) {
            setAddError(err?.message || "Something went wrong.");
        } finally {
            setAddSubmitting(false);
        }
    };

    // ---- Edit handlers ----

    // FIX: this used to populate the Edit form straight from `target.data`
    // — whatever was already sitting in the `clients`/`subclients` list
    // state. If that list snapshot was even slightly stale (e.g. taken
    // right after a product was linked elsewhere, or before this page's
    // last fetchAll landed), the Products picker would render with
    // nothing checked even though the link genuinely exists in the DB.
    // Now it re-fetches that single record fresh from the backend first,
    // so the Edit form — including productRates — always reflects exactly
    // what's in the database at the moment you open it. Falls back to the
    // list data only if that fetch fails, so Edit still opens.
    const buildEditForm = (data: Client | SubclientRow, type: "client" | "subclient") => ({
        name: data.name,
        country: data.country || "",
        status: data.status,
        clientId: type === "client" ? "" : String((data as SubclientRow).clientId),
        website: data.website || "",
        mainEmail: data.mainEmail || "",
        mainPhone: data.mainPhone || "",
        primaryContactName: data.primaryContactName || "",
        primaryContactEmail: data.primaryContactEmail || "",
        primaryContactPhone: data.primaryContactPhone || "",
        secondaryContactName: data.secondaryContactName || "",
        secondaryContactEmail: data.secondaryContactEmail || "",
        secondaryContactPhone: data.secondaryContactPhone || "",
        productRates: data.productRates || [],
    });

    const openEditModal = async (target: ViewDetailsTarget) => {
        setEditError("");
        // Open immediately with whatever we already have, so the modal
        // doesn't sit blank while the fresh fetch is in flight...
        setEditForm(buildEditForm(target.data, target.type));
        setEditTarget(target);

        // ...then swap in the freshly-fetched record as soon as it lands.
        try {
            const endpoint =
                target.type === "client"
                    ? `${apiBase}/api/clients/${target.data.id}`
                    : `${apiBase}/api/subclients/${target.data.id}`;
            const res = await authFetch(endpoint, { cache: "no-store" });
            if (!res.ok) return; // keep the fallback data already set above
            const fresh = await res.json();
            setEditForm(buildEditForm(fresh, target.type));
        } catch {
            // Network hiccup — the fallback data set above is still valid.
        }
    };

    const closeEditModal = () => {
        setEditTarget(null);
        setEditError("");
    };

    const handleEditSubmit = async () => {
        if (!editTarget) return;
        setEditError("");

        const editTabLabel = editTarget.type === "client" ? "Client" : "Subclient";

        if (!editForm.name.trim()) {
            setEditError(`${editTabLabel} name is required.`);
            return;
        }
        if (editTarget.type !== "client" && !editForm.clientId) {
            setEditError("Client is required.");
            return;
        }

        setEditSubmitting(true);
        try {
            let url = "";
            let body: Record<string, unknown> = {
                name: editForm.name.trim(),
                status: editForm.status,
                country: editForm.country || null,
                website: editForm.website || null,
                mainEmail: editForm.mainEmail || null,
                mainPhone: editForm.mainPhone || null,
                primaryContactName: editForm.primaryContactName || null,
                primaryContactEmail: editForm.primaryContactEmail || null,
                primaryContactPhone: editForm.primaryContactPhone || null,
                secondaryContactName: editForm.secondaryContactName || null,
                secondaryContactEmail: editForm.secondaryContactEmail || null,
                secondaryContactPhone: editForm.secondaryContactPhone || null,
                productRates: editForm.productRates,
            };

            if (editTarget.type === "client") {
                url = `${apiBase}/api/clients/${editTarget.data.id}`;
            } else {
                url = `${apiBase}/api/subclients/${editTarget.data.id}`;
                body.clientId = Number(editForm.clientId);
            }

            const response = await authFetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                const base = data?.message || `Failed to update ${editTabLabel.toLowerCase()}`;
                throw new Error(data?.detail ? `${base}: ${data.detail}` : base);
            }

            // NEW: 202 = this edit went to the reporting manager for
            // approval instead of applying immediately — see approvalGate.js.
            if (response.status === 202) {
                const data = await response.json().catch(() => null);
                setApprovalNotice(
                    data?.message || "Submitted for approval — waiting on your reporting manager."
                );
            } else {
                setApprovalNotice(null);
            }

            await fetchAll();
            setEditTarget(null);
        } catch (err: any) {
            setEditError(err?.message || "Something went wrong.");
        } finally {
            setEditSubmitting(false);
        }
    };

    // ---- Delete handlers ----

    const openDeleteConfirm = (type: TabKey, id: number, name: string) => {
        setDeleteError("");
        setDeleteTarget({ type, id, name });
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
            const endpoint = BULK_ENDPOINT_MAP[deleteTarget.type];
            const response = await authFetch(`${apiBase}/api/${endpoint}/${deleteTarget.id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.message || "Failed to delete");
            }

            // NEW: 202 = this delete went to the reporting manager for
            // approval instead of applying immediately — see approvalGate.js.
            if (response.status === 202) {
                const data = await response.json().catch(() => null);
                setApprovalNotice(
                    data?.message || "Submitted for approval — waiting on your reporting manager."
                );
            } else {
                setApprovalNotice(null);
            }

            await fetchAll();
            setDeleteTarget(null);
        } catch (err: any) {
            setDeleteError(err?.message || "Something went wrong.");
        } finally {
            setDeleting(false);
        }
    };

    // ---- Bulk upload handlers (tied to whichever tab is active) ----
    // Template is always served/generated as an .xlsx workbook by the backend.
    // NOTE: the Subclient template's header row must mirror the Client
    // template's header row (Name, Country, Status, Website, Main Email,
    // Main Phone, Primary/Secondary Contact fields) plus the Subclient-only
    // Client lookup column. That parity lives in the backend template
    // generator for /api/subclients/bulk/template — not in this file.

    // FIX: window.open() was hitting this endpoint as a bare, unauthenticated
    // browser navigation, so the backend saw no Authorization header and
    // rejected it with "No token provided" — even though every other call on
    // this page correctly goes through authFetch. Downloading via authFetch
    // (blob response) attaches the same auth token as everything else, then
    // we trigger the save manually via a temporary <a download> link.
    const handleDownloadTemplate = async () => {
        const endpoint = BULK_ENDPOINT_MAP[activeTab];
        try {
            const res = await authFetch(`${apiBase}/api/${endpoint}/bulk/template?format=xlsx`, {
                method: "GET",
            });
            if (!res.ok) throw new Error("Failed to download template");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${tabLabel}_bulk_upload_template.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert("Could not download the sample sheet. Please try again.");
        }
    };

    // Required-columns copy shown inside the Bulk Upload modal, mirroring
    // the info callout on the Add User page's "Bulk Add Users" modal.
    // Subclients carry one extra lookup column (Client) that Clients don't.
    const bulkRequiredColumnsText =
        activeTab === "client"
            ? "Name, Country, Status, Website, Main Email, Main Phone, Primary Contact Name, Primary Contact Email, Primary Contact Phone, Secondary Contact Name, Secondary Contact Email, Secondary Contact Phone"
            : "Name, Client, Country, Status, Website, Main Email, Main Phone, Primary Contact Name, Primary Contact Email, Primary Contact Phone, Secondary Contact Name, Secondary Contact Email, Secondary Contact Phone";

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
            const endpoint = BULK_ENDPOINT_MAP[activeTab];
            const formData = new FormData();
            formData.append("file", bulkFile);

            const response = await authFetch(`${apiBase}/api/${endpoint}/bulk/upload`, {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(data?.message || "Bulk upload failed");
            }

            // Backend is expected to return: { totalRows, createdCount,
            // failedCount, results: [{ row, identifier, status, message? }] }
            // so every row — created AND failed — can be listed in the UI,
            // matching the "Bulk Add Users" results list.
            setBulkResult(data as BulkResult);
            await fetchAll();
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong during bulk upload.");
        } finally {
            setBulkUploading(false);
        }
    };

    // REVERSED MAPPING: shared "which Products does this Client/Subclient
    // use, and at what rate" picker, used by both Add and Edit forms, for
    // both tabs. The rate (amount + currency) lives on the link, not on
    // the product, since the same product can cost differently per client.
    //
    // FIX: Supabase/PostgREST doesn't always return a bigint id as the
    // same JS type in every response (e.g. plain `number` from
    // /api/products vs a value that round-tripped through JSON as a
    // `string` from the client/subclient detail endpoint). A strict `===`
    // then silently never matches, so a previously-saved product shows as
    // unchecked even though the link genuinely exists in the DB. Comparing
    // via Number(...) on both sides makes the match type-independent.
    const toggleProductId = (
        formState: typeof emptyForm,
        setFormState: (updater: (prev: typeof emptyForm) => typeof emptyForm) => void,
        productId: number
    ) => {
        setFormState((prev) => {
            const has = prev.productRates.some((r) => Number(r.productId) === Number(productId));
            return {
                ...prev,
                productRates: has
                    ? prev.productRates.filter((r) => Number(r.productId) !== Number(productId))
                    : [...prev.productRates, { productId, amount: "", currency: "USD" }],
            };
        });
    };

    const updateProductRate = (
        formState: typeof emptyForm,
        setFormState: (updater: (prev: typeof emptyForm) => typeof emptyForm) => void,
        productId: number,
        field: "amount" | "currency",
        value: string
    ) => {
        setFormState((prev) => ({
            ...prev,
            productRates: prev.productRates.map((r) =>
                Number(r.productId) === Number(productId) ? { ...r, [field]: value } : r
            ),
        }));
    };

    const renderProductPicker = (
        formState: typeof emptyForm,
        setFormState: (updater: (prev: typeof emptyForm) => typeof emptyForm) => void
    ) => (
        <div style={{ gridColumn: "1 / -1" }}>
            <label style={styles.formLabel}>Products</label>
            {products.length === 0 ? (
                <p style={{ fontSize: fontSize.sm, color: "#7c8aa3", margin: "4px 0 0" }}>
                    No products yet — add one from the Products page first.
                </p>
            ) : (
                <div
                    className="cl-scroll-area"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        maxHeight: 220,
                        overflowY: "auto",
                        border: "1px solid #e4e9f2",
                        borderRadius: radius.sm,
                        padding: "10px 12px",
                        background: "#fafbfc",
                    }}
                >
                    {products.map((p) => {
                        const rate = formState.productRates.find(
                            (r) => Number(r.productId) === Number(p.id)
                        );
                        const checked = !!rate;
                        return (
                            <div
                                key={p.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                }}
                            >
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: fontSize.sm,
                                        color: "#16233c",
                                        cursor: "pointer",
                                        minWidth: 160,
                                        flex: "1 1 160px",
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                            toggleProductId(formState, setFormState, p.id)
                                        }
                                    />
                                    {p.product_name}
                                </label>
                                {checked && (
                                    <>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            placeholder="Amount"
                                            value={rate?.amount ?? ""}
                                            onChange={(e) =>
                                                updateProductRate(
                                                    formState,
                                                    setFormState,
                                                    p.id,
                                                    "amount",
                                                    e.target.value
                                                )
                                            }
                                            style={{
                                                ...styles.formInput,
                                                width: 110,
                                                padding: "6px 8px",
                                            }}
                                        />
                                        <select
                                            value={rate?.currency || "USD"}
                                            onChange={(e) =>
                                                updateProductRate(
                                                    formState,
                                                    setFormState,
                                                    p.id,
                                                    "currency",
                                                    e.target.value
                                                )
                                            }
                                            style={{
                                                ...styles.formInput,
                                                width: 90,
                                                padding: "6px 8px",
                                            }}
                                        >
                                            {CURRENCY_OPTIONS.map((c) => (
                                                <option key={c} value={c}>
                                                    {c}
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const editTabLabel = editTarget?.type === "client" ? "Client" : "Subclient";

    // Shared Company Info + Primary/Secondary Contact fieldset renderer used by
    // both the Add and Edit forms, and for both Client and Subclient tabs, so
    // the two entity types never drift out of parity again.
    const renderContactFieldset = (
        formState: typeof emptyForm,
        setFormState: (updater: (prev: typeof emptyForm) => typeof emptyForm) => void
    ) => (
        <>
            <div style={styles.formSectionLabel}>Company Information</div>
            <div>
                <label style={styles.formLabel}>Website</label>
                <input
                    style={styles.formInput}
                    value={formState.website}
                    onChange={(e) => setFormState((prev) => ({ ...prev, website: e.target.value }))}
                    placeholder="e.g. https://acme.com"
                />
            </div>
            <div>
                <label style={styles.formLabel}>Main Email</label>
                <input
                    style={styles.formInput}
                    type="email"
                    value={formState.mainEmail}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, mainEmail: e.target.value }))
                    }
                    placeholder="e.g. hello@acme.com"
                />
            </div>
            <div>
                <label style={styles.formLabel}>Main Contact Number</label>
                <input
                    style={styles.formInput}
                    value={formState.mainPhone}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, mainPhone: e.target.value }))
                    }
                    placeholder="e.g. +91 98765 43210"
                />
            </div>

            <div style={styles.formSectionLabel}>Primary Contact Person</div>
            <div>
                <label style={styles.formLabel}>Name</label>
                <input
                    style={styles.formInput}
                    value={formState.primaryContactName}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, primaryContactName: e.target.value }))
                    }
                />
            </div>
            <div>
                <label style={styles.formLabel}>Email</label>
                <input
                    style={styles.formInput}
                    type="email"
                    value={formState.primaryContactEmail}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, primaryContactEmail: e.target.value }))
                    }
                />
            </div>
            <div>
                <label style={styles.formLabel}>Phone Number</label>
                <input
                    style={styles.formInput}
                    value={formState.primaryContactPhone}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, primaryContactPhone: e.target.value }))
                    }
                />
            </div>

            <div style={styles.formSectionLabel}>Secondary Contact Person</div>
            <div>
                <label style={styles.formLabel}>Name</label>
                <input
                    style={styles.formInput}
                    value={formState.secondaryContactName}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, secondaryContactName: e.target.value }))
                    }
                />
            </div>
            <div>
                <label style={styles.formLabel}>Email</label>
                <input
                    style={styles.formInput}
                    type="email"
                    value={formState.secondaryContactEmail}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, secondaryContactEmail: e.target.value }))
                    }
                />
            </div>
            <div>
                <label style={styles.formLabel}>Phone Number</label>
                <input
                    style={styles.formInput}
                    value={formState.secondaryContactPhone}
                    onChange={(e) =>
                        setFormState((prev) => ({ ...prev, secondaryContactPhone: e.target.value }))
                    }
                />
            </div>
        </>
    );

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {/* NEW: shown when a Process Lead's create/edit/delete came back
                        202 — it went to their reporting manager for approval instead
                        of applying immediately. See approvalGate.js. */}
                    {approvalNotice && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                background: "#eaf6fb",
                                color: "#204297",
                                padding: "10px 16px",
                                borderRadius: radius.md,
                                fontSize: fontSize.base,
                                fontWeight: fontWeight.medium,
                                margin: "0 0 12px",
                            }}
                        >
                            <span>{approvalNotice}</span>
                            <button
                                type="button"
                                onClick={() => setApprovalNotice(null)}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    color: "#204297",
                                }}
                                aria-label="Dismiss"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    {/* Tabs — flexWrap so on very narrow phones "Subclient" wraps to
                        its own line instead of being clipped by the mobile shell's
                        overflow:hidden, and stays reachable/tappable either way. */}
                    <div style={isMobile ? styles.tabRowMobile : styles.tabRow}>
                        <button
                            type="button"
                            className="cl-tab-btn"
                            onClick={() => setActiveTab("client")}
                            style={{
                                ...styles.tabBtn,
                                ...(activeTab === "client" ? styles.tabBtnActive : {}),
                            }}
                        >
                            Client ({tabCounts.client})
                        </button>
                        <button
                            type="button"
                            className="cl-tab-btn"
                            onClick={() => setActiveTab("subclient")}
                            style={{
                                ...styles.tabBtn,
                                ...(activeTab === "subclient" ? styles.tabBtnActive : {}),
                            }}
                        >
                            Subclient ({tabCounts.subclient})
                        </button>
                    </div>

                    {/* Header row */}
                    {!isMobile && (
                        <div style={styles.headerRow}>
                            <p style={styles.headerSubtext}>
                                View, add, edit or remove{" "}
                                {activeTab === "client" ? "Clients" : "Subclients"} from the system.
                            </p>

                            <div style={styles.headerActions}>
                                {/* Sample sheet download — tooltip on hover makes it explicit
                                    this is an Excel (.xlsx) template for bulk upload. */}
                                <span className="cl-tooltip-wrap">
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
                                    <span className="cl-tooltip-bubble">
                                        Sample sheet for bulk upload (.xlsx)
                                    </span>
                                </span>

                                {/* Bulk Upload now opens a modal (matching the Add User
                                    page's "Bulk Add Users" modal) instead of firing an
                                    upload the instant a file is chosen. */}
                                {canManage && (
                                    <span className="cl-tooltip-wrap">
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
                                        <span className="cl-tooltip-bubble">
                                            Upload {tabLabel.toLowerCase()}s from an Excel (.xlsx)
                                            file
                                        </span>
                                    </span>
                                )}

                                {canManage && (
                                    <button
                                        style={styles.addBtn}
                                        type="button"
                                        onClick={openAddModal}
                                        title={`Add a new ${tabLabel.toLowerCase()}`}
                                    >
                                        <i
                                            className="ti ti-plus"
                                            style={{ fontSize: fontSize.md }}
                                        />
                                        Add {tabLabel}
                                    </button>
                                )}
                            </div>
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
                                placeholder={`Search ${activeTab}s...`}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

                        <select
                            style={styles.filterSelect}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            aria-label="Status"
                        >
                            <option value="All">Status: All</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>

                        {/* Country filter now applies to both tabs since Subclients
                            carry a Country field too, same as Clients. */}
                        <select
                            style={styles.filterSelect}
                            value={countryFilter}
                            onChange={(e) => setCountryFilter(e.target.value)}
                            aria-label="Country"
                        >
                            <option value="All">Country: All</option>
                            {countries.map((c) => (
                                <option key={c} value={c}>
                                    {c}
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
                        with no scrollbar at all. No pagination controls anymore. */}
                    <div className="cl-scroll-area" style={styles.scrollArea}>
                        {loading ? (
                            <div style={styles.emptyState}>
                                <p style={styles.emptyText}>Loading…</p>
                            </div>
                        ) : error ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-alert-circle"
                                    style={{ fontSize: fontSize["7xl"], color: "#dc2626" }}
                                />
                                <p style={{ ...styles.emptyText, color: "#dc2626" }}>{error}</p>
                            </div>
                        ) : currentFilteredLength === 0 ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-users"
                                    style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                                />
                                <p style={styles.emptyText}>No {activeTab}s match your filters.</p>
                            </div>
                        ) : viewMode === "list" ? (
                            <div style={styles.tableWrap}>
                                {/* Column layout is identical for Client and Subclient: only
                                    the 2nd column header/value differs (Country vs Client). This
                                    keeps both tables visually and structurally aligned. */}
                                <table className="cl-table" style={styles.table}>
                                    <colgroup>
                                        <col style={{ width: "15%" }} />
                                        <col style={{ width: "11%" }} />
                                        <col style={{ width: "9%" }} />
                                        <col style={{ width: "9%" }} />
                                        <col style={{ width: "16%" }} />
                                        <col style={{ width: "13%" }} />
                                        <col style={{ width: "15%" }} />
                                        <col style={{ width: "12%" }} />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th style={styles.th}>
                                                {activeTab === "client" ? "Client" : "Subclient"}
                                            </th>
                                            <th style={styles.th}>
                                                {activeTab === "client" ? "Country" : "Client"}
                                            </th>
                                            <th style={styles.th}>Status</th>
                                            <th style={{ ...styles.th, textAlign: "center" }}>
                                                {activeTab === "client" ? "Subclients" : "Branches"}
                                            </th>
                                            <th style={styles.th}>
                                                {activeTab === "client"
                                                    ? "Client Email"
                                                    : "Subclient Email"}
                                            </th>
                                            <th style={styles.th}>Contact Number</th>
                                            <th style={styles.th}>Primary Contact Person</th>
                                            <th style={{ ...styles.th, textAlign: "left" }}>
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeTab === "client" &&
                                            pageClients.map((client) => {
                                                const avatar = getAvatarColors(client.name);
                                                return (
                                                    <tr
                                                        key={client.id}
                                                        className="cl-row"
                                                        style={{
                                                            ...styles.tr,
                                                            boxShadow: `inset 3px 0 0 0 ${avatar.solid}`,
                                                        }}
                                                    >
                                                        <td style={styles.td}>
                                                            <span style={styles.tdNameText}>
                                                                {client.name}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdMuted}>
                                                                {client.country || "—"}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span
                                                                style={{
                                                                    ...styles.statusPill,
                                                                    ...(client.status === "Active"
                                                                        ? styles.statusPillActive
                                                                        : styles.statusPillInactive),
                                                                }}
                                                            >
                                                                <span style={styles.statusDot} />
                                                                {client.status}
                                                            </span>
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                textAlign: "center",
                                                                fontWeight: fontWeight.semibold,
                                                                color: "#16233c",
                                                            }}
                                                        >
                                                            {client.subclients}
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                <i
                                                                    className="ti ti-mail"
                                                                    style={{
                                                                        fontSize: fontSize.sm,
                                                                    }}
                                                                />
                                                                {client.mainEmail || "—"}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                <i
                                                                    className="ti ti-phone"
                                                                    style={{
                                                                        fontSize: fontSize.sm,
                                                                    }}
                                                                />
                                                                {client.mainPhone || "—"}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                {client.primaryContactName ? (
                                                                    <>
                                                                        <i
                                                                            className="ti ti-user"
                                                                            style={{
                                                                                fontSize:
                                                                                    fontSize.sm,
                                                                            }}
                                                                        />
                                                                        {client.primaryContactName}
                                                                    </>
                                                                ) : (
                                                                    <span style={styles.tdMuted}>
                                                                        —
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <div style={styles.tdActions}>
                                                                <button
                                                                    type="button"
                                                                    className="cl-view-btn"
                                                                    style={styles.viewDetailsBtn}
                                                                    onClick={() =>
                                                                        setViewDetails({
                                                                            type: "client",
                                                                            data: client,
                                                                        })
                                                                    }
                                                                    title="View details"
                                                                >
                                                                    View
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="cl-icon-btn"
                                                                    style={styles.iconBtn}
                                                                    aria-label="Edit"
                                                                    title="Edit client"
                                                                    onClick={() =>
                                                                        openEditModal({
                                                                            type: "client",
                                                                            data: client,
                                                                        })
                                                                    }
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
                                                                    className="cl-icon-btn-danger"
                                                                    style={styles.iconBtnDanger}
                                                                    aria-label="Delete"
                                                                    title="Delete client"
                                                                    onClick={() =>
                                                                        openDeleteConfirm(
                                                                            "client",
                                                                            client.id,
                                                                            client.name
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

                                        {activeTab === "subclient" &&
                                            pageSubclients.map((sub) => {
                                                const avatar = getAvatarColors(sub.name);
                                                return (
                                                    <tr
                                                        key={sub.id}
                                                        className="cl-row"
                                                        style={{
                                                            ...styles.tr,
                                                            boxShadow: `inset 3px 0 0 0 ${avatar.solid}`,
                                                        }}
                                                    >
                                                        <td style={styles.td}>
                                                            <span style={styles.tdNameText}>
                                                                {sub.name}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdMuted}>
                                                                {sub.clientName}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span
                                                                style={{
                                                                    ...styles.statusPill,
                                                                    ...(sub.status === "Active"
                                                                        ? styles.statusPillActive
                                                                        : styles.statusPillInactive),
                                                                }}
                                                            >
                                                                <span style={styles.statusDot} />
                                                                {sub.status}
                                                            </span>
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                textAlign: "center",
                                                                fontWeight: fontWeight.semibold,
                                                                color: "#16233c",
                                                            }}
                                                        >
                                                            {sub.branches}
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                <i
                                                                    className="ti ti-mail"
                                                                    style={{
                                                                        fontSize: fontSize.sm,
                                                                    }}
                                                                />
                                                                {sub.mainEmail || "—"}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                <i
                                                                    className="ti ti-phone"
                                                                    style={{
                                                                        fontSize: fontSize.sm,
                                                                    }}
                                                                />
                                                                {sub.mainPhone || "—"}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <span style={styles.tdContactLine}>
                                                                {sub.primaryContactName ? (
                                                                    <>
                                                                        <i
                                                                            className="ti ti-user"
                                                                            style={{
                                                                                fontSize:
                                                                                    fontSize.sm,
                                                                            }}
                                                                        />
                                                                        {sub.primaryContactName}
                                                                    </>
                                                                ) : (
                                                                    <span style={styles.tdMuted}>
                                                                        —
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <div style={styles.tdActions}>
                                                                <button
                                                                    type="button"
                                                                    className="cl-view-btn"
                                                                    style={styles.viewDetailsBtn}
                                                                    onClick={() =>
                                                                        setViewDetails({
                                                                            type: "subclient",
                                                                            data: sub,
                                                                        })
                                                                    }
                                                                    title="View details"
                                                                >
                                                                    View
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="cl-icon-btn"
                                                                    style={styles.iconBtn}
                                                                    aria-label="Edit"
                                                                    title="Edit subclient"
                                                                    onClick={() =>
                                                                        openEditModal({
                                                                            type: "subclient",
                                                                            data: sub,
                                                                        })
                                                                    }
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
                                                                    className="cl-icon-btn-danger"
                                                                    style={styles.iconBtnDanger}
                                                                    aria-label="Delete"
                                                                    title="Delete subclient"
                                                                    onClick={() =>
                                                                        openDeleteConfirm(
                                                                            "subclient",
                                                                            sub.id,
                                                                            sub.name
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
                                {activeTab === "client" &&
                                    pageClients.map((client) => {
                                        const avatar = getAvatarColors(client.name);
                                        return (
                                            <div
                                                key={client.id}
                                                className="cl-card"
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
                                                        {getInitials(client.name)}
                                                    </div>
                                                    <div style={styles.cardNameBlockSimple}>
                                                        <span style={styles.cardName}>
                                                            {client.name}
                                                        </span>
                                                        <span
                                                            style={{
                                                                ...styles.cardCountBadge,
                                                                background: `${avatar.solid}1A`,
                                                                color: avatar.solid,
                                                            }}
                                                        >
                                                            {client.subclients} Subclients
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.cardSimpleInfoRows}>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-world"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <WebsiteLink
                                                            website={client.website}
                                                            style={styles.cardSimpleInfoValue}
                                                        />
                                                    </div>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-mail"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <span style={styles.cardSimpleInfoValue}>
                                                            {client.mainEmail || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-phone"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <span style={styles.cardSimpleInfoValue}>
                                                            {client.mainPhone || "—"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="cl-view-btn-filled"
                                                    style={{
                                                        ...styles.viewDetailsBtnFilled,
                                                        background: `${avatar.solid}14`,
                                                        color: avatar.solid,
                                                        boxShadow: "none",
                                                    }}
                                                    onClick={() =>
                                                        setViewDetails({
                                                            type: "client",
                                                            data: client,
                                                        })
                                                    }
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

                                {activeTab === "subclient" &&
                                    pageSubclients.map((sub) => {
                                        const avatar = getAvatarColors(sub.name);
                                        return (
                                            <div
                                                key={sub.id}
                                                className="cl-card"
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
                                                        {getInitials(sub.name)}
                                                    </div>
                                                    <div style={styles.cardNameBlockSimple}>
                                                        <span style={styles.cardName}>
                                                            {sub.name}
                                                        </span>
                                                        <span
                                                            style={{
                                                                ...styles.cardCountBadge,
                                                                background: `${avatar.solid}1A`,
                                                                color: avatar.solid,
                                                            }}
                                                        >
                                                            {sub.branches} Branches
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.cardSimpleInfoRows}>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-world"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <WebsiteLink
                                                            website={sub.website}
                                                            style={styles.cardSimpleInfoValue}
                                                        />
                                                    </div>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-mail"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <span style={styles.cardSimpleInfoValue}>
                                                            {sub.mainEmail || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.cardSimpleInfoRow}>
                                                        <i
                                                            className="ti ti-phone"
                                                            style={styles.cardInfoIcon}
                                                        />
                                                        <span style={styles.cardSimpleInfoValue}>
                                                            {sub.mainPhone || "—"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="cl-view-btn-filled"
                                                    style={{
                                                        ...styles.viewDetailsBtnFilled,
                                                        background: `${avatar.solid}14`,
                                                        color: avatar.solid,
                                                        boxShadow: "none",
                                                    }}
                                                    onClick={() =>
                                                        setViewDetails({
                                                            type: "subclient",
                                                            data: sub,
                                                        })
                                                    }
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
                            <h3 style={styles.detailsTitle}>{viewDetails.data.name}</h3>
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
                                <span style={styles.detailsLabel}>Status</span>
                                <span
                                    style={{
                                        ...styles.statusPill,
                                        ...(viewDetails.data.status === "Active"
                                            ? styles.statusPillActive
                                            : styles.statusPillInactive),
                                    }}
                                >
                                    {viewDetails.data.status}
                                </span>
                            </div>

                            {/* Country now shown for both Client and Subclient details. */}
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Country</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.country || "—"}
                                </span>
                            </div>

                            {viewDetails.type === "client" && (
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Subclients</span>
                                    <span style={styles.detailsValue}>
                                        {viewDetails.data.subclients}
                                    </span>
                                </div>
                            )}
                            {viewDetails.type === "subclient" && (
                                <>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Client</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.clientName}
                                        </span>
                                    </div>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Branches</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.branches}
                                        </span>
                                    </div>
                                </>
                            )}

                            {/* REVERSED MAPPING: Products linked to this Client/Subclient */}
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Products</span>
                                <span style={{ ...styles.detailsValue, textAlign: "right" }}>
                                    {viewDetails.data.products && viewDetails.data.products.length
                                        ? viewDetails.data.products
                                              .map((p) => p.product_name)
                                              .join(", ")
                                        : "—"}
                                </span>
                            </div>

                            {/* Company Info + Primary/Secondary Contact are identical for
                                both Client and Subclient view modals. */}
                            <div style={styles.detailsSectionLabel}>Company Information</div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Website</span>
                                <WebsiteLink
                                    website={viewDetails.data.website}
                                    style={styles.detailsValue}
                                />
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Email</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.mainEmail || "—"}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Contact Number</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.mainPhone || "—"}
                                </span>
                            </div>

                            <div style={styles.detailsSectionLabel}>Primary Contact</div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Name</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.primaryContactName || "—"}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Email</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.primaryContactEmail || "—"}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Phone</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.primaryContactPhone || "—"}
                                </span>
                            </div>

                            <div style={styles.detailsSectionLabel}>Secondary Contact</div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Name</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.secondaryContactName || "—"}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Email</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.secondaryContactEmail || "—"}
                                </span>
                            </div>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Phone</span>
                                <span style={styles.detailsValue}>
                                    {viewDetails.data.secondaryContactPhone || "—"}
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
                                            openDeleteConfirm(
                                                target.type,
                                                target.data.id,
                                                target.data.name
                                            );
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
                            <h3 style={styles.detailsTitle}>Add {tabLabel}</h3>
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
                            <div>
                                <label style={styles.formLabel}>Name</label>
                                <input
                                    style={styles.formInput}
                                    value={addForm.name}
                                    onChange={(e) =>
                                        setAddForm({ ...addForm, name: e.target.value })
                                    }
                                    placeholder={`e.g. ${
                                        activeTab === "client" ? "Acme Corp" : "Barret and Co"
                                    }`}
                                />
                            </div>

                            {/* Country now shown for both Client and Subclient forms. */}
                            <div>
                                <label style={styles.formLabel}>Country</label>
                                <input
                                    style={styles.formInput}
                                    value={addForm.country}
                                    onChange={(e) =>
                                        setAddForm({ ...addForm, country: e.target.value })
                                    }
                                    placeholder="e.g. India"
                                />
                            </div>

                            {/* Client lookup — required for Subclient */}
                            {activeTab === "subclient" && (
                                <div>
                                    <label style={styles.formLabel}>Client</label>
                                    <select
                                        style={styles.formInput}
                                        value={addForm.clientId}
                                        onChange={(e) =>
                                            setAddForm({
                                                ...addForm,
                                                clientId: e.target.value,
                                            })
                                        }
                                    >
                                        <option value="">Select Client</option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label style={styles.formLabel}>Status</label>
                                <select
                                    style={styles.formInput}
                                    value={addForm.status}
                                    onChange={(e) =>
                                        setAddForm({
                                            ...addForm,
                                            status: e.target.value as EntityStatus,
                                        })
                                    }
                                >
                                    <option value="Active">Active</option>
                                    <option value="Inactive">Inactive</option>
                                </select>
                            </div>

                            {/* REVERSED MAPPING: pick which existing Products this
                                Client/Subclient uses */}
                            {renderProductPicker(addForm, setAddForm)}

                            {/* Same fieldset for both Client and Subclient */}
                            {renderContactFieldset(addForm, setAddForm)}

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
                                {addSubmitting ? "Saving..." : `Add ${tabLabel}`}
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
                            <h3 style={styles.detailsTitle}>Edit {editTabLabel}</h3>
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
                            <div>
                                <label style={styles.formLabel}>Name</label>
                                <input
                                    style={styles.formInput}
                                    value={editForm.name}
                                    onChange={(e) =>
                                        setEditForm({ ...editForm, name: e.target.value })
                                    }
                                />
                            </div>

                            {/* Country now shown for both Client and Subclient forms. */}
                            <div>
                                <label style={styles.formLabel}>Country</label>
                                <input
                                    style={styles.formInput}
                                    value={editForm.country}
                                    onChange={(e) =>
                                        setEditForm({ ...editForm, country: e.target.value })
                                    }
                                    placeholder="e.g. India"
                                />
                            </div>

                            {editTarget.type === "subclient" && (
                                <div>
                                    <label style={styles.formLabel}>Client</label>
                                    <select
                                        style={styles.formInput}
                                        value={editForm.clientId}
                                        onChange={(e) =>
                                            setEditForm({
                                                ...editForm,
                                                clientId: e.target.value,
                                            })
                                        }
                                    >
                                        <option value="">Select Client</option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label style={styles.formLabel}>Status</label>
                                <select
                                    style={styles.formInput}
                                    value={editForm.status}
                                    onChange={(e) =>
                                        setEditForm({
                                            ...editForm,
                                            status: e.target.value as EntityStatus,
                                        })
                                    }
                                >
                                    <option value="Active">Active</option>
                                    <option value="Inactive">Inactive</option>
                                </select>
                            </div>

                            {/* REVERSED MAPPING: pick which existing Products this
                                Client/Subclient uses */}
                            {renderProductPicker(editForm, setEditForm)}

                            {/* Same fieldset for both Client and Subclient */}
                            {renderContactFieldset(editForm, setEditForm)}

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
                                Are you sure you want to remove this {deleteTarget.type}? Once
                                deleted, it can't be recovered.
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

            {/* Bulk Upload modal — mirrors the "Bulk Add Users" modal layout
                (title/subtitle, required-columns callout, Choose File row with
                an explicit Upload button, then a "X created · Y failed"
                summary followed by a full scrollable list of EVERY row) but
                now themed with the app's brand palette (var(--brand-blue) /
                var(--brand-light-blue)) instead of the old fixed purple, so it
                matches whichever theme color is selected. Sample Sheet's
                tooltip (in the header actions above) uses the same variables. */}
            {showBulkModal && (
                <div style={styles.overlay} onClick={closeBulkModal}>
                    <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.bulkModalHeader}>
                            <h3 style={styles.bulkModalTitle}>
                                Bulk {activeTab === "client" ? "Add Clients" : "Add Subclients"}
                            </h3>
                            <p style={styles.bulkModalSubtitle}>
                                Upload an Excel file to create multiple {activeTab}s at once
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
                            <p style={styles.bulkInfoText}>{bulkRequiredColumnsText}</p>
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
                                {bulkUploading
                                    ? "Uploading…"
                                    : `Upload & Create ${
                                          activeTab === "client" ? "Clients" : "Subclients"
                                      }`}
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
                                        <strong style={{ color: "#16233c" }}>
                                            {bulkResult.createdCount}
                                        </strong>{" "}
                                        created
                                        {" · "}
                                        <strong
                                            style={{
                                                color:
                                                    bulkResult.failedCount > 0
                                                        ? "#dc2626"
                                                        : "#16233c",
                                            }}
                                        >
                                            {bulkResult.failedCount}
                                        </strong>{" "}
                                        failed
                                    </span>
                                </div>

                                <div className="cl-results-list" style={styles.resultsList}>
                                    {bulkResult.results.map((r) => (
                                        <div key={r.row} style={styles.resultRow}>
                                            <div style={styles.resultRowLeft}>
                                                <span style={styles.resultRowIdentifier}>
                                                    {r.identifier}
                                                </span>
                                                {r.status === "failed" && r.message && (
                                                    <span style={styles.resultRowSubtext}>
                                                        {r.message}
                                                    </span>
                                                )}
                                            </div>
                                            {r.status === "created" ? (
                                                <span
                                                    style={{
                                                        ...styles.resultPill,
                                                        ...styles.resultPillCreated,
                                                    }}
                                                >
                                                    Created
                                                </span>
                                            ) : (
                                                <span
                                                    style={{
                                                        ...styles.resultPill,
                                                        ...styles.resultPillFailed,
                                                    }}
                                                >
                                                    ✕ Failed
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

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

    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "1px solid #eee",
        position: "sticky",
        top: 0,
        zIndex: 30,
        boxSizing: "border-box",
        width: "100%",
    },
    hamburgerBtn: {
        border: "none",
        background: "transparent",
        fontSize: fontSize["3xl"],
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: "#16233c" },
    mobileActionGroup: { display: "flex", alignItems: "center", gap: 6 },
    addBtnMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: radius.circle,
        border: "none",
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        cursor: "pointer",
    },
    iconOnlyBtnMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: radius.circle,
        border: "1px solid #cfe0f5",
        background: "#fff",
        color: "var(--brand-blue)",
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
    },
    sidebarDrawer: {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: "230px",
        maxWidth: "80vw",
        zIndex: 50,
        transition: "transform 0.25s ease",
        boxShadow: "2px 0 12px rgba(0,0,0,0.15)",
        overflowY: "auto",
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

    tabRow: { display: "flex", gap: 8, flexShrink: 0 },
    // Mobile: wraps to a second line and tightens padding on very narrow
    // screens (see the @media rule in GLOBAL_CSS) instead of overflowing
    // past the right edge, which is what was hiding the Subclient tab.
    tabRowMobile: { display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" },
    tabBtn: {
        display: "flex",
        alignItems: "center",
        background: "#fff",
        color: "#3b4a63",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "10px 18px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        transition: "border-color .15s ease, color .15s ease",
    },
    tabBtnActive: {
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
    },

    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
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
        color: "var(--brand-blue)",
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
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
        whiteSpace: "nowrap",
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
        color: "var(--brand-blue)",
    },

    // Scrollable: fills remaining vertical space in contentBody and only
    // scrolls (shows a scrollbar) once the rendered cards/rows exceed that
    // height. When there's little content, this behaves like a normal
    // block with no scroll affordance at all.
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
    cardTop: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        gap: 10,
        minHeight: 40,
    },
    // Simplified card header used in the original design: avatar, name, and
    // a small tinted count badge underneath — no status pill, no icon actions.
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
    cardNameBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        minWidth: 0,
        flex: "0 1 auto",
        textAlign: "left",
    },
    cardNameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", minWidth: 0 },
    cardName: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    cardCountry: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: fontSize.sm,
        color: "#7c8aa3",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    cardLookup: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: fontSize.xs,
        color: "var(--brand-light-blue)",
        fontWeight: fontWeight.medium,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    cardTopActions: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        marginLeft: "auto",
    },
    subclientsBox: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#eef1fb",
        borderRadius: radius.md,
        padding: "10px 14px",
    },
    subclientsBoxLeft: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
    },
    cardContactRow: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 0 0",
        borderTop: "1px solid #eef2f9",
    },
    cardContactItem: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.sm,
        color: "#3b4a63",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardInfoRows: {
        display: "flex",
        flexDirection: "column",
        gap: 7,
        paddingTop: 9,
        borderTop: "1px solid #eef2f9",
    },
    cardInfoRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 6,
        minWidth: 0,
    },
    cardInfoIcon: { fontSize: fontSize.sm, color: "#a7b3c8", flexShrink: 0 },
    cardInfoLabel: {
        fontSize: fontSize.xs,
        color: "#8592a8",
        fontWeight: fontWeight.regular,
        flexShrink: 0,
        whiteSpace: "nowrap",
    },
    cardInfoColon: { fontSize: fontSize.xs, color: "#8592a8", flexShrink: 0 },
    cardInfoValue: {
        fontSize: fontSize.sm,
        color: "#26314a",
        fontWeight: fontWeight.medium,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardInfoValueTruncate: {
        fontSize: fontSize.sm,
        color: "#26314a",
        fontWeight: fontWeight.medium,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        flex: 1,
    },

    statusPill: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: fontSize.xxs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
        width: "fit-content",
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: radius.circle,
        background: "currentColor",
        flexShrink: 0,
    },
    statusPillActive: { background: "#e1f7f3", color: "#0f8a78" },
    statusPillInactive: { background: "#fee2e2", color: "#dc2626" },

    statsRow: {
        display: "flex",
        alignItems: "center",
        borderTop: "1px solid #eef2f9",
        borderBottom: "1px solid #eef2f9",
        padding: "12px 0",
    },
    statBlock: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 },
    statDivider: { width: 1, alignSelf: "stretch", background: "#eef2f9" },
    statLabel: { fontSize: fontSize.xs, color: "#7c8aa3" },
    statValue: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: "#16233c" },

    cardFooter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 2,
        marginTop: "auto",
    },
    viewDetailsBtn: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        color: "var(--brand-blue)",
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
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        borderRadius: radius.md,
        padding: "11px 16px",
        cursor: "pointer",
        boxShadow: "0 6px 14px rgba(var(--brand-blue-rgb), 0.25)",
    },
    cardActions: { display: "flex", alignItems: "center", gap: 8 },
    iconBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        border: "1px solid #d8e3fa",
        background: "#eef2fc",
        color: "var(--brand-blue)",
        cursor: "pointer",
        transition: "background .15s ease, border-color .15s ease, color .15s ease",
    },
    iconBtnGhost: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: radius.xs,
        border: "1px solid #e4e9f2",
        background: "#fafbfc",
        color: "#7c8aa3",
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
    iconBtnDangerGhost: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: radius.xs,
        border: "1px solid #f8d7d7",
        background: "#fdf4f4",
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
        color: "var(--brand-blue)",
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
    tdNameCell: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        minWidth: 0,
    },
    avatarSm: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: radius.circle,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
        border: "2px solid #fff",
        boxShadow: "0 0 0 1px #e5edf7",
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
    tdContactStack: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
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
        width: 560,
        maxWidth: "94vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    addModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 640,
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
    detailsSectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginTop: 6,
        paddingTop: 10,
        borderTop: "1px solid #e5edf7",
    },
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
    formSectionLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginTop: 4,
        paddingTop: 10,
        borderTop: "1px solid #e5edf7",
        gridColumn: "1 / -1",
    },
    addSubmitBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "12px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
        gridColumn: "1 / -1",
    },

    // ---- Bulk Upload modal — now themed to match the rest of the page
    // (brand blue/teal) instead of a fixed purple, so it follows whichever
    // color the person picks from the header's theme switcher. ----
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
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#7c8aa3" },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "color-mix(in srgb, var(--brand-light-blue) 10%, white)",
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
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
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
    resultsSummary: { marginBottom: 14, textAlign: "center" },
    resultsSummaryText: { fontSize: fontSize.md, color: "#16233c" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 320,
        overflowY: "auto",
    },
    resultRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: radius.sm,
        padding: "10px 14px",
    },
    resultRowLeft: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
    },
    resultRowIdentifier: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        color: "#16233c",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    resultRowSubtext: { fontSize: fontSize.sm, color: "#9ca3af" },
    resultPill: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "4px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    resultPillCreated: { background: "#e1f7f3", color: "#0f8a78" },
    resultPillFailed: { background: "#fee2e2", color: "#dc2626" },
};
