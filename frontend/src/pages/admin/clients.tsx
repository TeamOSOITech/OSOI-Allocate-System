import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import Sidebar from "../../components/sidebar";

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

type Client = {
    id: number;
    name: string;
    country: string | null;
    status: EntityStatus;
    subclients: number;
    branches: number;
    users: number;
};

type SubclientRow = {
    id: number;
    name: string;
    clientId: number;
    clientName: string;
    status: EntityStatus;
    branches: number;
    users: number;
};

type BranchRow = {
    id: number;
    name: string;
    subclientId: number;
    subclientName: string;
    clientId: number;
    clientName: string;
    status: EntityStatus;
};

const AVATAR_PALETTE = [
    { bg: "#e0e7ff", text: "#4338ca" },
    { bg: "#ede9fe", text: "#7c3aed" },
    { bg: "#ffe4d6", text: "#c2410c" },
    { bg: "#d3f3ea", text: "#0f766e" },
    { bg: "#fef3c7", text: "#b45309" },
    { bg: "#dbeafe", text: "#1d4ed8" },
    { bg: "#dcfce7", text: "#15803d" },
    { bg: "#f0e6ff", text: "#7c3aed" },
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

type TabKey = "client" | "subclient" | "branch";

type ViewDetailsTarget =
    | { type: "client"; data: Client }
    | { type: "subclient"; data: SubclientRow }
    | { type: "branch"; data: BranchRow };

type BulkResult = {
    totalRows: number;
    created: Record<string, number>;
    rowErrors: { row: number; message: string }[];
};

// Maps the active tab to the corresponding API resource path used by the
// bulk template/upload endpoints on the backend.
const BULK_ENDPOINT_MAP: Record<TabKey, string> = {
    client: "clients",
    subclient: "subclients",
    branch: "branches",
};

export default function Clients() {
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [activeTab, setActiveTab] = useState<TabKey>("client");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [countryFilter, setCountryFilter] = useState("All");
    const [activeFilter, setActiveFilter] = useState("All");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(8);

    const [clients, setClients] = useState<Client[]>([]);
    const [subclients, setSubclients] = useState<SubclientRow[]>([]);
    const [branches, setBranches] = useState<BranchRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [viewDetails, setViewDetails] = useState<ViewDetailsTarget | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState({
        name: "",
        country: "",
        status: "Active" as EntityStatus,
        clientId: "",
        subclientId: "",
    });
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState("");

    // ---- Bulk upload state ----
    const [bulkUploading, setBulkUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
    const [bulkError, setBulkError] = useState("");

    const apiBase = import.meta.env.VITE_API_URL;

    const fetchAll = async () => {
        setLoading(true);
        setError("");
        try {
            const [clientsRes, subclientsRes, branchesRes] = await Promise.all([
                fetch(`${apiBase}/api/clients`, { cache: "no-store" }),
                fetch(`${apiBase}/api/subclients`, { cache: "no-store" }),
                fetch(`${apiBase}/api/branches`, { cache: "no-store" }),
            ]);

            if (!clientsRes.ok) throw new Error("Failed to load clients");
            if (!subclientsRes.ok) throw new Error("Failed to load subclients");
            if (!branchesRes.ok) throw new Error("Failed to load branches");

            setClients(await clientsRes.json());
            setSubclients(await subclientsRes.json());
            setBranches(await branchesRes.json());
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

    // Reset paging/filters when switching tabs so stale page numbers or
    // country selections from one dataset don't carry into another.
    useEffect(() => {
        setPage(1);
        setSearch("");
        setStatusFilter("All");
        setCountryFilter("All");
        setActiveFilter("All");
    }, [activeTab]);

    const countries = useMemo(
        () => Array.from(new Set(clients.map((c) => c.country).filter(Boolean) as string[])).sort(),
        [clients]
    );

    const matchesCommonFilters = (name: string, status: EntityStatus) => {
        const matchesSearch = name.toLowerCase().includes(search.trim().toLowerCase());
        const matchesStatus = statusFilter === "All" || status === statusFilter;
        const matchesActive =
            activeFilter === "All" ||
            (activeFilter === "Active" && status === "Active") ||
            (activeFilter === "Inactive" && status === "Inactive");
        return matchesSearch && matchesStatus && matchesActive;
    };

    const filteredClients = useMemo(
        () =>
            clients.filter((c) => {
                const matchesCountry = countryFilter === "All" || c.country === countryFilter;
                return matchesCommonFilters(c.name, c.status) && matchesCountry;
            }),
        [clients, search, statusFilter, countryFilter, activeFilter]
    );

    const filteredSubclients = useMemo(
        () => subclients.filter((s) => matchesCommonFilters(s.name, s.status)),
        [subclients, search, statusFilter, activeFilter]
    );

    const filteredBranches = useMemo(
        () => branches.filter((b) => matchesCommonFilters(b.name, b.status)),
        [branches, search, statusFilter, activeFilter]
    );

    const currentFilteredLength =
        activeTab === "client"
            ? filteredClients.length
            : activeTab === "subclient"
              ? filteredSubclients.length
              : filteredBranches.length;

    const totalPages = Math.max(1, Math.ceil(currentFilteredLength / perPage));
    const currentPage = Math.min(page, totalPages);
    const pageStart = (currentPage - 1) * perPage;

    const pageClients = filteredClients.slice(pageStart, pageStart + perPage);
    const pageSubclients = filteredSubclients.slice(pageStart, pageStart + perPage);
    const pageBranches = filteredBranches.slice(pageStart, pageStart + perPage);

    const resetToPageOne = () => setPage(1);

    const tabCounts: Record<TabKey, number> = {
        client: clients.length,
        subclient: subclients.length,
        branch: branches.length,
    };

    const tabLabel =
        activeTab === "client" ? "Client" : activeTab === "subclient" ? "Subclient" : "Branch";

    // Subclients belonging to whichever client is picked in the Add
    // Branch form, so the subclient dropdown narrows correctly.
    const subclientsForSelectedClient = useMemo(
        () => subclients.filter((s) => String(s.clientId) === addForm.clientId),
        [subclients, addForm.clientId]
    );

    const openAddModal = () => {
        setAddForm({ name: "", country: "", status: "Active", clientId: "", subclientId: "" });
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
        if (activeTab === "branch" && !addForm.subclientId) {
            setAddError("Subclient is required.");
            return;
        }

        setAddSubmitting(true);
        try {
            let url = "";
            let body: Record<string, unknown> = {
                name: addForm.name.trim(),
                status: addForm.status,
            };

            if (activeTab === "client") {
                url = `${apiBase}/api/clients`;
                body.country = addForm.country || null;
            } else if (activeTab === "subclient") {
                url = `${apiBase}/api/subclients`;
                body.clientId = Number(addForm.clientId);
            } else {
                url = `${apiBase}/api/branches`;
                body.clientId = Number(addForm.clientId);
                body.subclientId = Number(addForm.subclientId);
            }

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.message || `Failed to create ${tabLabel.toLowerCase()}`);
            }

            await fetchAll();
            setShowAddModal(false);
        } catch (err: any) {
            setAddError(err?.message || "Something went wrong.");
        } finally {
            setAddSubmitting(false);
        }
    };

    // ---- Bulk upload handlers (tied to whichever tab is active) ----

    const handleDownloadTemplate = () => {
        const endpoint = BULK_ENDPOINT_MAP[activeTab];
        window.open(`${apiBase}/api/${endpoint}/bulk/template`, "_blank");
    };

    const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setBulkUploading(true);
        setBulkError("");
        setBulkResult(null);

        try {
            const endpoint = BULK_ENDPOINT_MAP[activeTab];
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch(`${apiBase}/api/${endpoint}/bulk/upload`, {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(data?.message || "Bulk upload failed");
            }

            setBulkResult(data as BulkResult);
            await fetchAll();
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong during bulk upload.");
        } finally {
            setBulkUploading(false);
            e.target.value = "";
        }
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            {isMobile && (
                <div style={styles.mobileTopbar}>
                    <button
                        style={styles.hamburgerBtn}
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        type="button"
                    >
                        ☰
                    </button>
                    <span style={styles.mobileTitle}>Clients</span>

                    <div style={styles.mobileActionGroup}>
                        <button
                            style={styles.iconOnlyBtnMobile}
                            type="button"
                            aria-label="Download Template"
                            onClick={handleDownloadTemplate}
                        >
                            <i className="ti ti-download" style={{ fontSize: 14 }} />
                        </button>

                        <label style={styles.iconOnlyBtnMobile} aria-label="Bulk Upload">
                            <i className="ti ti-upload" style={{ fontSize: 14 }} />
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                hidden
                                onChange={handleBulkFileChange}
                                disabled={bulkUploading}
                            />
                        </label>

                        <button
                            style={styles.addBtnMobile}
                            type="button"
                            aria-label="Add"
                            onClick={openAddModal}
                        >
                            <i className="ti ti-plus" style={{ fontSize: 14 }} />
                        </button>
                    </div>
                </div>
            )}

            {isMobile ? (
                <>
                    {sidebarOpen && (
                        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
                    )}
                    <div
                        style={{
                            ...styles.sidebarDrawer,
                            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                        }}
                    >
                        <Sidebar />
                    </div>
                </>
            ) : (
                <Sidebar />
            )}

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {/* Tabs */}
                    <div style={styles.tabRow}>
                        <button
                            type="button"
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
                            onClick={() => setActiveTab("subclient")}
                            style={{
                                ...styles.tabBtn,
                                ...(activeTab === "subclient" ? styles.tabBtnActive : {}),
                            }}
                        >
                            Subclient ({tabCounts.subclient})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("branch")}
                            style={{
                                ...styles.tabBtn,
                                ...(activeTab === "branch" ? styles.tabBtnActive : {}),
                            }}
                        >
                            Branch ({tabCounts.branch})
                        </button>
                    </div>

                    {/* Header row */}
                    {!isMobile && (
                        <div style={styles.headerRow}>
                            <p style={styles.headerSubtext}>
                                View, add, edit or remove{" "}
                                {activeTab === "client"
                                    ? "Clients"
                                    : activeTab === "subclient"
                                      ? "Subclients"
                                      : "Branches"}{" "}
                                from the system.
                            </p>

                            <div style={styles.headerActions}>
                                <button
                                    style={styles.secondaryBtn}
                                    type="button"
                                    onClick={handleDownloadTemplate}
                                >
                                    <i className="ti ti-download" style={{ fontSize: 14 }} />
                                    Template
                                </button>

                                <label style={styles.secondaryBtn}>
                                    <i className="ti ti-upload" style={{ fontSize: 14 }} />
                                    {bulkUploading ? "Uploading..." : "Bulk Upload"}
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls"
                                        hidden
                                        onChange={handleBulkFileChange}
                                        disabled={bulkUploading}
                                    />
                                </label>

                                <button style={styles.addBtn} type="button" onClick={openAddModal}>
                                    <i className="ti ti-plus" style={{ fontSize: 14 }} />
                                    Add {tabLabel}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Filters */}
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: 15, color: "#9c96b8" }}
                                aria-hidden="true"
                            />
                            <input
                                style={styles.searchInput}
                                placeholder={`Search ${activeTab}s...`}
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    resetToPageOne();
                                }}
                            />
                        </div>

                        <select
                            style={styles.filterSelect}
                            value={statusFilter}
                            onChange={(e) => {
                                setStatusFilter(e.target.value);
                                resetToPageOne();
                            }}
                            aria-label="Status"
                        >
                            <option value="All">Status: All</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>

                        {activeTab === "client" && (
                            <select
                                style={styles.filterSelect}
                                value={countryFilter}
                                onChange={(e) => {
                                    setCountryFilter(e.target.value);
                                    resetToPageOne();
                                }}
                                aria-label="Country"
                            >
                                <option value="All">Country: All</option>
                                {countries.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        )}

                        <select
                            style={styles.filterSelect}
                            value={activeFilter}
                            onChange={(e) => {
                                setActiveFilter(e.target.value);
                                resetToPageOne();
                            }}
                            aria-label="Active"
                        >
                            <option value="All">Active: All</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
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
                                >
                                    <i className="ti ti-list" style={{ fontSize: 15 }} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Cards */}
                    <div style={styles.scrollArea}>
                        {loading ? (
                            <div style={styles.emptyState}>
                                <p style={styles.emptyText}>Loading…</p>
                            </div>
                        ) : error ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-alert-circle"
                                    style={{ fontSize: 32, color: "#dc2626" }}
                                />
                                <p style={{ ...styles.emptyText, color: "#dc2626" }}>{error}</p>
                            </div>
                        ) : currentFilteredLength === 0 ? (
                            <div style={styles.emptyState}>
                                <i
                                    className="ti ti-users"
                                    style={{ fontSize: 32, color: "#c4b5fd" }}
                                />
                                <p style={styles.emptyText}>No {activeTab}s match your filters.</p>
                            </div>
                        ) : (
                            <div style={isMobile ? styles.cardGridMobile : styles.cardGrid}>
                                {activeTab === "client" &&
                                    pageClients.map((client) => {
                                        const avatar = getAvatarColors(client.name);
                                        return (
                                            <div key={client.id} style={styles.card}>
                                                <div style={styles.cardTop}>
                                                    <div
                                                        style={{
                                                            ...styles.avatar,
                                                            background: avatar.bg,
                                                            color: avatar.text,
                                                        }}
                                                    >
                                                        {getInitials(client.name)}
                                                    </div>
                                                    <div style={styles.cardNameBlock}>
                                                        <div style={styles.cardNameRow}>
                                                            <span style={styles.cardName}>
                                                                {client.name}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    ...styles.statusPill,
                                                                    ...(client.status === "Active"
                                                                        ? styles.statusPillActive
                                                                        : styles.statusPillInactive),
                                                                }}
                                                            >
                                                                {client.status}
                                                            </span>
                                                        </div>
                                                        <span style={styles.cardCountry}>
                                                            {client.country || "—"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.statsRow}>
                                                    <div style={styles.statBlock}>
                                                        <span style={styles.statLabel}>
                                                            Subclients
                                                        </span>
                                                        <span style={styles.statValue}>
                                                            {client.subclients}
                                                        </span>
                                                    </div>
                                                    <div style={styles.statBlock}>
                                                        <span style={styles.statLabel}>
                                                            Branches
                                                        </span>
                                                        <span style={styles.statValue}>
                                                            {client.branches}
                                                        </span>
                                                    </div>
                                                    <div style={styles.statBlock}>
                                                        <span style={styles.statLabel}>Users</span>
                                                        <span style={styles.statValue}>
                                                            {client.users}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.cardFooter}>
                                                    <button
                                                        type="button"
                                                        style={styles.viewDetailsBtn}
                                                        onClick={() =>
                                                            setViewDetails({
                                                                type: "client",
                                                                data: client,
                                                            })
                                                        }
                                                    >
                                                        View Details
                                                        <i
                                                            className="ti ti-chevron-right"
                                                            style={{ fontSize: 13 }}
                                                        />
                                                    </button>
                                                    <div style={styles.cardActions}>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtn}
                                                            aria-label="Edit"
                                                        >
                                                            <i
                                                                className="ti ti-pencil"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtnDanger}
                                                            aria-label="Delete"
                                                        >
                                                            <i
                                                                className="ti ti-trash"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                {activeTab === "subclient" &&
                                    pageSubclients.map((sub) => {
                                        const avatar = getAvatarColors(sub.name);
                                        return (
                                            <div key={sub.id} style={styles.card}>
                                                <div style={styles.cardTop}>
                                                    <div
                                                        style={{
                                                            ...styles.avatar,
                                                            background: avatar.bg,
                                                            color: avatar.text,
                                                        }}
                                                    >
                                                        {getInitials(sub.name)}
                                                    </div>
                                                    <div style={styles.cardNameBlock}>
                                                        <div style={styles.cardNameRow}>
                                                            <span style={styles.cardName}>
                                                                {sub.name}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    ...styles.statusPill,
                                                                    ...(sub.status === "Active"
                                                                        ? styles.statusPillActive
                                                                        : styles.statusPillInactive),
                                                                }}
                                                            >
                                                                {sub.status}
                                                            </span>
                                                        </div>
                                                        <span style={styles.cardLookup}>
                                                            <i
                                                                className="ti ti-building"
                                                                style={{ fontSize: 11 }}
                                                            />
                                                            {sub.clientName}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.statsRow}>
                                                    <div style={styles.statBlock}>
                                                        <span style={styles.statLabel}>
                                                            Branches
                                                        </span>
                                                        <span style={styles.statValue}>
                                                            {sub.branches}
                                                        </span>
                                                    </div>
                                                    <div style={styles.statBlock}>
                                                        <span style={styles.statLabel}>Users</span>
                                                        <span style={styles.statValue}>
                                                            {sub.users}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.cardFooter}>
                                                    <button
                                                        type="button"
                                                        style={styles.viewDetailsBtn}
                                                        onClick={() =>
                                                            setViewDetails({
                                                                type: "subclient",
                                                                data: sub,
                                                            })
                                                        }
                                                    >
                                                        View Details
                                                        <i
                                                            className="ti ti-chevron-right"
                                                            style={{ fontSize: 13 }}
                                                        />
                                                    </button>
                                                    <div style={styles.cardActions}>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtn}
                                                            aria-label="Edit"
                                                        >
                                                            <i
                                                                className="ti ti-pencil"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtnDanger}
                                                            aria-label="Delete"
                                                        >
                                                            <i
                                                                className="ti ti-trash"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                {activeTab === "branch" &&
                                    pageBranches.map((branch) => {
                                        const avatar = getAvatarColors(branch.name);
                                        return (
                                            <div key={branch.id} style={styles.card}>
                                                <div style={styles.cardTop}>
                                                    <div
                                                        style={{
                                                            ...styles.avatar,
                                                            background: avatar.bg,
                                                            color: avatar.text,
                                                        }}
                                                    >
                                                        {getInitials(branch.name)}
                                                    </div>
                                                    <div style={styles.cardNameBlock}>
                                                        <div style={styles.cardNameRow}>
                                                            <span style={styles.cardName}>
                                                                {branch.name}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    ...styles.statusPill,
                                                                    ...(branch.status === "Active"
                                                                        ? styles.statusPillActive
                                                                        : styles.statusPillInactive),
                                                                }}
                                                            >
                                                                {branch.status}
                                                            </span>
                                                        </div>
                                                        <span style={styles.cardLookup}>
                                                            <i
                                                                className="ti ti-sitemap"
                                                                style={{ fontSize: 11 }}
                                                            />
                                                            {branch.subclientName}
                                                        </span>
                                                        <span style={styles.cardLookup}>
                                                            <i
                                                                className="ti ti-building"
                                                                style={{ fontSize: 11 }}
                                                            />
                                                            {branch.clientName}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={styles.cardFooter}>
                                                    <button
                                                        type="button"
                                                        style={styles.viewDetailsBtn}
                                                        onClick={() =>
                                                            setViewDetails({
                                                                type: "branch",
                                                                data: branch,
                                                            })
                                                        }
                                                    >
                                                        View Details
                                                        <i
                                                            className="ti ti-chevron-right"
                                                            style={{ fontSize: 13 }}
                                                        />
                                                    </button>
                                                    <div style={styles.cardActions}>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtn}
                                                            aria-label="Edit"
                                                        >
                                                            <i
                                                                className="ti ti-pencil"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            style={styles.iconBtnDanger}
                                                            aria-label="Delete"
                                                        >
                                                            <i
                                                                className="ti ti-trash"
                                                                style={{ fontSize: 13 }}
                                                            />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>

                    {/* Pagination */}
                    {!loading && !error && (
                        <div style={isMobile ? styles.paginationRowMobile : styles.paginationRow}>
                            <span style={styles.paginationText}>
                                Showing {currentFilteredLength === 0 ? 0 : pageStart + 1} to{" "}
                                {Math.min(pageStart + perPage, currentFilteredLength)} of{" "}
                                {currentFilteredLength} {activeTab}s
                            </span>

                            <div style={styles.paginationControls}>
                                <button
                                    type="button"
                                    style={styles.pageArrowBtn}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    aria-label="Previous page"
                                >
                                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
                                </button>

                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPage(p)}
                                        style={{
                                            ...styles.pageNumBtn,
                                            ...(p === currentPage ? styles.pageNumBtnActive : {}),
                                        }}
                                    >
                                        {p}
                                    </button>
                                ))}

                                <button
                                    type="button"
                                    style={styles.pageArrowBtn}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    aria-label="Next page"
                                >
                                    <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                                </button>

                                <select
                                    style={styles.perPageSelect}
                                    value={perPage}
                                    onChange={(e) => {
                                        setPerPage(Number(e.target.value));
                                        resetToPageOne();
                                    }}
                                    aria-label="Results per page"
                                >
                                    <option value={8}>8 / page</option>
                                    <option value={10}>10 / page</option>
                                    <option value={20}>20 / page</option>
                                    <option value={50}>50 / page</option>
                                </select>
                            </div>
                        </div>
                    )}
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

                            {viewDetails.type === "client" && (
                                <>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Country</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.country || "—"}
                                        </span>
                                    </div>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Subclients</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.subclients}
                                        </span>
                                    </div>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Branches</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.branches}
                                        </span>
                                    </div>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Users</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.users}
                                        </span>
                                    </div>
                                </>
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
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Users</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.users}
                                        </span>
                                    </div>
                                </>
                            )}

                            {viewDetails.type === "branch" && (
                                <>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Subclient</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.subclientName}
                                        </span>
                                    </div>
                                    <div style={styles.detailsRow}>
                                        <span style={styles.detailsLabel}>Client</span>
                                        <span style={styles.detailsValue}>
                                            {viewDetails.data.clientName}
                                        </span>
                                    </div>
                                </>
                            )}
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
                                        activeTab === "client"
                                            ? "Acme Corp"
                                            : activeTab === "subclient"
                                              ? "Barret and Co"
                                              : "Main Branch"
                                    }`}
                                />
                            </div>

                            {activeTab === "client" && (
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
                            )}

                            {/* Client lookup — required for both Subclient and Branch */}
                            {(activeTab === "subclient" || activeTab === "branch") && (
                                <div>
                                    <label style={styles.formLabel}>Client</label>
                                    <select
                                        style={styles.formInput}
                                        value={addForm.clientId}
                                        onChange={(e) =>
                                            setAddForm({
                                                ...addForm,
                                                clientId: e.target.value,
                                                subclientId: "",
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

                            {/* Subclient lookup — required only for Branch, narrowed by
                                the selected client above */}
                            {activeTab === "branch" && (
                                <div>
                                    <label style={styles.formLabel}>Subclient</label>
                                    <select
                                        style={styles.formInput}
                                        value={addForm.subclientId}
                                        onChange={(e) =>
                                            setAddForm({
                                                ...addForm,
                                                subclientId: e.target.value,
                                            })
                                        }
                                        disabled={!addForm.clientId}
                                    >
                                        <option value="">
                                            {addForm.clientId
                                                ? "Select Subclient"
                                                : "Select a client first"}
                                        </option>
                                        {subclientsForSelectedClient.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
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

            {/* Bulk upload result modal */}
            {bulkResult && (
                <div style={styles.overlay} onClick={() => setBulkResult(null)}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Bulk Upload Result</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={() => setBulkResult(null)}
                                type="button"
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.detailsBody}>
                            <div style={styles.detailsRow}>
                                <span style={styles.detailsLabel}>Total Rows</span>
                                <span style={styles.detailsValue}>{bulkResult.totalRows}</span>
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
                                <div>
                                    <p
                                        style={{
                                            ...styles.detailsLabel,
                                            marginBottom: 8,
                                            display: "block",
                                        }}
                                    >
                                        Errors ({bulkResult.rowErrors.length})
                                    </p>
                                    <div
                                        style={{
                                            maxHeight: 220,
                                            overflowY: "auto",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 6,
                                        }}
                                    >
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
                    </div>
                </div>
            )}

            {/* Bulk upload error modal */}
            {bulkError && (
                <div style={styles.overlay} onClick={() => setBulkError("")}>
                    <div style={styles.detailsModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.detailsHeader}>
                            <h3 style={styles.detailsTitle}>Upload Failed</h3>
                            <button
                                style={styles.closeBtn}
                                onClick={() => setBulkError("")}
                                type="button"
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <div style={styles.detailsBody}>
                            <p style={styles.formError}>{bulkError}</p>
                        </div>
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
        flex: 1,
        minHeight: 0,
        background: "#f5f3ff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflowX: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "#f5f3ff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
        overflowX: "hidden",
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
        fontSize: "20px",
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: "16px", fontWeight: 700, color: "#1e1b3a" },
    mobileActionGroup: { display: "flex", alignItems: "center", gap: 6 },
    addBtnMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "none",
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        cursor: "pointer",
    },
    iconOnlyBtnMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "1px solid #ddd6fe",
        background: "#fff",
        color: "#6d28d9",
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
        overflow: "hidden",
        minHeight: 0,
    },
    contentColMobile: { flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px",
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        gap: 16,
    },

    tabRow: { display: "flex", gap: 8 },
    tabBtn: {
        display: "flex",
        alignItems: "center",
        background: "#fff",
        color: "#4b4560",
        border: "1px solid #ececf5",
        borderRadius: 10,
        padding: "10px 18px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
    },
    tabBtnActive: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
    },

    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    },
    headerSubtext: { margin: 0, fontSize: 13, color: "#9c96b8" },
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
        color: "#6d28d9",
        border: "1px solid #ddd6fe",
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
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "11px 20px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
        whiteSpace: "nowrap",
    },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#fafafa",
        border: "1px solid #ececf5",
        borderRadius: 10,
        padding: "9px 12px",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: 13,
        color: "#1e1b3a",
        width: "100%",
    },
    filterSelect: {
        border: "1px solid #ececf5",
        background: "#fafafa",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 13,
        color: "#4b4560",
        outline: "none",
        cursor: "pointer",
        minWidth: 120,
    },
    viewToggle: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fafafa",
        border: "1px solid #ececf5",
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
        color: "#9c96b8",
        cursor: "pointer",
    },
    viewToggleBtnActive: {
        background: "#ede9fe",
        color: "#6d28d9",
    },

    scrollArea: { flex: 1, minHeight: 0 },

    cardGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 16,
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
    emptyText: { margin: 0, fontSize: 13, color: "#9c96b8" },

    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #f0ecff",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
        gap: 14,
    },
    cardTop: { display: "flex", alignItems: "flex-start", gap: 12 },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 42,
        height: 42,
        borderRadius: "50%",
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
    },
    cardNameBlock: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
    cardNameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    cardName: { fontSize: 14, fontWeight: 700, color: "#1e1b3a" },
    cardCountry: { fontSize: 12, color: "#9c96b8" },
    cardLookup: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "#7c3aed",
        fontWeight: 600,
    },

    statusPill: {
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 9px",
        borderRadius: 20,
        whiteSpace: "nowrap",
    },
    statusPillActive: { background: "#dcfce7", color: "#15803d" },
    statusPillInactive: { background: "#fee2e2", color: "#dc2626" },

    statsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: "1px solid #f5f3ff",
        borderBottom: "1px solid #f5f3ff",
        padding: "12px 0",
    },
    statBlock: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 },
    statLabel: { fontSize: 11, color: "#9c96b8" },
    statValue: { fontSize: 15, fontWeight: 700, color: "#1e1b3a" },

    cardFooter: { display: "flex", alignItems: "center", justifyContent: "space-between" },
    viewDetailsBtn: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        color: "#6d28d9",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        padding: 0,
    },
    cardActions: { display: "flex", alignItems: "center", gap: 8 },
    iconBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#4b4560",
        cursor: "pointer",
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
    },

    paginationRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    paginationRowMobile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    paginationText: { fontSize: 12, color: "#9c96b8" },
    paginationControls: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
    pageArrowBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 8,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#4b4560",
        cursor: "pointer",
    },
    pageNumBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 28,
        borderRadius: 8,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#4b4560",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        padding: "0 6px",
    },
    pageNumBtnActive: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "1px solid transparent",
    },
    perPageSelect: {
        border: "1px solid #ececf5",
        background: "#fff",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        color: "#4b4560",
        outline: "none",
        cursor: "pointer",
        marginLeft: 6,
    },

    detailsModal: {
        background: "#fff",
        borderRadius: 16,
        width: 420,
        maxWidth: "92vw",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    addModal: {
        background: "#fff",
        borderRadius: 16,
        width: 420,
        maxWidth: "92vw",
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
    detailsTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "#1e1b3a" },
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
    detailsLabel: { fontSize: 12, color: "#9c96b8", fontWeight: 600 },
    detailsValue: { fontSize: 13, color: "#1e1b3a", fontWeight: 600 },

    addBody: { padding: "20px 28px 28px", display: "flex", flexDirection: "column", gap: 14 },
    formLabel: {
        display: "block",
        marginBottom: 6,
        color: "#4b4560",
        fontSize: 12,
        fontWeight: 600,
    },
    formInput: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafafa",
        border: "1px solid #ececf5",
        outline: "none",
        fontSize: 13,
        borderRadius: 8,
        boxSizing: "border-box",
        color: "#1e1b3a",
    },
    formError: { color: "#dc2626", margin: 0, fontWeight: 600, fontSize: 12 },
    addSubmitBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "12px 20px",
        fontSize: 13,
        fontWeight: 700,
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
    },
};
