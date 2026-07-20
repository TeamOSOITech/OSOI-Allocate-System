import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
//import Sidebar from "../../components/sidebar";

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

type Employee = {
    id: number;
    employeeCode: string;
    name: string;
    email: string;
    designation: string;
    department: string;
    status: EntityStatus;
    reportingManager: string | null;
    joiningDate: string; // ISO date
    // Not returned by the API yet (no praises table/route on the backend).
    // Left optional so the UI degrades gracefully — re-enable the
    // recognition chip/section once GET /api/employees/:id/praises exists.
    praisesCount?: number;
    location?: string | null;
    photoUrl?: string | null;
};

// Each entry pairs an avatar tint with a matching accent used for the card's
// top border, so the two read as one deliberate color per person rather than
// two unrelated random picks.
const AVATAR_PALETTE = [
    { bg: "#dce6f8", text: "#3457d5", accent: "#3457d5" }, // blue
    { bg: "#d3eef8", text: "#0b7fa1", accent: "#0ea5c4" }, // sky
    { bg: "#fde6d2", text: "#c9640b", accent: "#f0972e" }, // orange
    { bg: "#ece4fb", text: "#6d3fd6", accent: "#8b5cf6" }, // purple
    { bg: "#d2f2ec", text: "#1a8f7f", accent: "#1a8f7f" }, // teal
    { bg: "#e3ecfb", text: "#2c52ad", accent: "#3457d5" }, // indigo
    { bg: "#c9f1e6", text: "#177f6f", accent: "#177f6f" }, // green-teal
    { bg: "#f4e2f6", text: "#a12e94", accent: "#c026a3" }, // magenta
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

function formatDate(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateShort(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Converts an ISO datetime/date string into the yyyy-mm-dd shape a native
// <input type="date"> expects. Returns "" for anything unparseable so the
// input just renders empty instead of throwing.
function toDateInputValue(iso: string | null | undefined) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

// Injected once — inline style objects can't express :hover/:focus, so the
// handful of interactive/motion rules live here instead of duplicating them
// as onMouseEnter/onMouseLeave handlers everywhere.
const GLOBAL_CSS = `
@keyframes empSkeletonPulse {
  0%, 100% { opacity: .55; }
  50% { opacity: 1; }
}
@keyframes empFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes empDrawerIn {
  from { transform: translateX(24px); opacity: .6; }
  to { transform: translateX(0); opacity: 1; }
}
.emp-skel { animation: empSkeletonPulse 1.4s ease-in-out infinite; }
.emp-card { animation: empFadeIn .35s ease both; }
.emp-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(32,66,151,.16);
}
.emp-card:focus-visible {
  outline: 2px solid #08a1ce;
  outline-offset: 2px;
}
.emp-search-input::placeholder { color: #9bb0c2; }
.emp-search-wrap:focus-within {
  border-color: #7fc9e2;
  box-shadow: 0 0 0 3px rgba(8,161,206,.14);
}
.emp-clear-btn:hover { background: #dee9f4; }
.emp-select:hover { border-color: #9ecfe8; }
.emp-drawer-close:hover { background: rgba(255,255,255,.32); }
.emp-drawer { animation: empDrawerIn .28s ease both; }

.emp-icon-btn-sm:hover { filter: brightness(0.95); }
.emp-drawer-input:focus, .emp-drawer-select:focus {
  border-color: #7fc9e2;
  box-shadow: 0 0 0 3px rgba(8,161,206,.14);
  outline: none;
}
`;

export default function Employees() {
    const isMobile = useIsMobile();
    //const [sidebarOpen, setSidebarOpen] = useState(false);

    // ---- Role gating ----
    // Only admins/managers can see and use the edit/delete controls.
    // Everyone else (e.g. plain "employee" role) gets a read-only view.
    // Matches the pattern used in sidebar.tsx: the logged-in user object is
    // stored in localStorage under "user" (see login.tsx), with role values
    // like "ADMIN" / "MANAGER" / "EMPLOYEE".
    let currentUser: { role?: string } | null = null;
    try {
        const userStr = localStorage.getItem("user");
        currentUser = userStr ? JSON.parse(userStr) : null;
    } catch {
        currentUser = null;
    }
    const role = (currentUser?.role || "EMPLOYEE").toUpperCase();
    const canManage = role === "ADMIN" || role === "MANAGER";

    const [search, setSearch] = useState("");
    const [departmentFilter, setDepartmentFilter] = useState("All");

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

    // ---- Drawer edit mode ----
    // isEditingDrawer=false -> read-only view (opened via the expand icon).
    // isEditingDrawer=true  -> editable fields + Save/Cancel (opened via the
    // pencil icon, or via the "Edit" button inside the drawer itself).
    const [isEditingDrawer, setIsEditingDrawer] = useState(false);
    const [editForm, setEditForm] = useState<Employee | null>(null);
    const [saving, setSaving] = useState(false);

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
    const [deleting, setDeleting] = useState(false);

    const apiBase = import.meta.env.VITE_API_URL;

    const fetchEmployees = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${apiBase}/api/employees`, { cache: "no-store" });
            if (!res.ok) throw new Error("Failed to load employees");
            setEmployees(await res.json());
        } catch (err: any) {
            setError(err?.message || "Something went wrong loading employees.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployees();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiBase]);

    // NOTE: praise/recognition data isn't fetched here — the backend has no
    // GET /api/employees/:id/praises route yet. Wire this back up once that
    // endpoint exists (see employees.controller.js comments).

    // Opens the drawer in read-only mode (expand icon / clicking the card).
    const openProfile = (employee: Employee) => {
        setSelectedEmployee(employee);
        setIsEditingDrawer(false);
        setEditForm(null);
    };

    const closeProfile = () => {
        if (saving) return; // don't let a click-away drop an in-flight save
        setSelectedEmployee(null);
        setIsEditingDrawer(false);
        setEditForm(null);
    };

    // Opens the drawer straight into edit mode (pencil icon on the card).
    const handleEdit = (employee: Employee) => {
        if (!canManage) return;
        setSelectedEmployee(employee);
        setEditForm({ ...employee });
        setIsEditingDrawer(true);
    };

    // Switches an already-open (read-only) drawer into edit mode.
    const startEditingDrawer = () => {
        if (!canManage || !selectedEmployee) return;
        setEditForm({ ...selectedEmployee });
        setIsEditingDrawer(true);
    };

    const cancelEditingDrawer = () => {
        setIsEditingDrawer(false);
        setEditForm(null);
    };

    const updateEditField = <K extends keyof Employee>(field: K, value: Employee[K]) => {
        setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
    };

    // NOTE: assumes a PATCH /api/employees/:id route exists (or will exist)
    // on the backend, accepting a partial/full employee object and
    // returning the updated record. If it isn't wired up yet, this will hit
    // the catch block below — the UI is ready as soon as the route is.
    const handleSaveEdit = async () => {
        if (!editForm) return;
        setSaving(true);
        try {
            const res = await fetch(`${apiBase}/api/employees/${editForm.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editForm),
            });
            if (!res.ok) throw new Error("Update failed");

            const updated: Employee = await res.json().catch(() => editForm);

            setEmployees((prev) =>
                prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
            );
            setSelectedEmployee((prev) => (prev ? { ...prev, ...updated } : prev));
            setIsEditingDrawer(false);
            setEditForm(null);
        } catch (err) {
            console.error(err);
            alert("Unable to save changes.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (employee: Employee) => {
        if (!canManage) return;
        setEmployeeToDelete(employee);
        setShowDeleteModal(true);
    };

    const closeDeleteModal = () => {
        if (deleting) return; // don't let them dismiss mid-request
        setShowDeleteModal(false);
        setEmployeeToDelete(null);
    };

    const confirmDelete = async () => {
        if (!employeeToDelete) return;
        setDeleting(true);

        try {
            const response = await fetch(`${apiBase}/api/employees/${employeeToDelete.id}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Delete failed");

            setEmployees((prev) => prev.filter((emp) => emp.id !== employeeToDelete.id));

            setShowDeleteModal(false);
            setEmployeeToDelete(null);

            // If the deleted employee's profile drawer happens to be open, close it.
            setSelectedEmployee((prev) => (prev?.id === employeeToDelete.id ? null : prev));
        } catch (error) {
            console.error(error);
            alert("Unable to delete employee.");
        } finally {
            setDeleting(false);
        }
    };

    const departments = useMemo(
        () => Array.from(new Set(employees.map((e) => e.department))).sort(),
        [employees]
    );

    const filteredEmployees = useMemo(
        () =>
            employees.filter((e) => {
                const matchesSearch =
                    e.name.toLowerCase().includes(search.trim().toLowerCase()) ||
                    e.designation.toLowerCase().includes(search.trim().toLowerCase()) ||
                    e.employeeCode.toLowerCase().includes(search.trim().toLowerCase());
                const matchesDepartment =
                    departmentFilter === "All" || e.department === departmentFilter;
                return matchesSearch && matchesDepartment;
            }),
        [employees, search, departmentFilter]
    );

    // What the drawer should display: live edits while editing, otherwise
    // the selected employee as-is.
    const drawerData = isEditingDrawer && editForm ? editForm : selectedEmployee;

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {!isMobile && (
                        <div style={styles.headerRow}>
                            <div>
                                <h2 style={styles.pageTitle}>
                                    Employees{" "}
                                    <span style={styles.pageTitleCount}>({employees.length})</span>
                                </h2>
                                <p style={styles.headerSubtext}>
                                    Browse your organization by department and location.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Filters */}
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div className="emp-search-wrap" style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: 15, color: "#7d90a6" }}
                                aria-hidden="true"
                            />
                            <input
                                className="emp-search-input"
                                style={styles.searchInput}
                                placeholder="Search by name, title, or ID..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            {search && (
                                <button
                                    type="button"
                                    className="emp-clear-btn"
                                    style={styles.clearBtn}
                                    onClick={() => setSearch("")}
                                    aria-label="Clear search"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        <select
                            className="emp-select"
                            style={styles.filterSelect}
                            value={departmentFilter}
                            onChange={(e) => setDepartmentFilter(e.target.value)}
                            aria-label="Department"
                        >
                            <option value="All">Department: All</option>
                            {departments.map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </div>

                    {!loading && !error && (
                        <span style={styles.resultsCount}>
                            {filteredEmployees.length} of {employees.length} employee
                            {employees.length === 1 ? "" : "s"}
                        </span>
                    )}

                    {/* Cards */}
                    <div style={styles.scrollArea}>
                        {loading ? (
                            <div style={isMobile ? styles.cardGridMobile : styles.cardGrid}>
                                {Array.from({ length: 12 }, (_, i) => (
                                    <div key={i} style={styles.skeletonCard}>
                                        <div style={styles.cardTop}>
                                            <div
                                                className="emp-skel"
                                                style={styles.skeletonAvatar}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    className="emp-skel"
                                                    style={styles.skeletonLineWide}
                                                />
                                                <div
                                                    className="emp-skel"
                                                    style={styles.skeletonLineNarrow}
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className="emp-skel"
                                            style={{ ...styles.skeletonLineWide, marginTop: 18 }}
                                        />
                                        <div className="emp-skel" style={styles.skeletonLineWide} />
                                    </div>
                                ))}
                            </div>
                        ) : error ? (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIconWrap}>
                                    <i
                                        className="ti ti-alert-triangle"
                                        style={{ fontSize: 26, color: "#dc2626" }}
                                    />
                                </div>
                                <p style={{ ...styles.emptyTitle, color: "#b91c1c" }}>
                                    Couldn't load employees
                                </p>
                                <p style={styles.emptyText}>{error}</p>
                                <button
                                    type="button"
                                    style={styles.retryBtn}
                                    onClick={fetchEmployees}
                                >
                                    Try again
                                </button>
                            </div>
                        ) : filteredEmployees.length === 0 ? (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIconWrap}>
                                    <i
                                        className="ti ti-users"
                                        style={{ fontSize: 26, color: "#08a1ce" }}
                                    />
                                </div>
                                <p style={styles.emptyTitle}>No employees match your filters</p>
                                <p style={styles.emptyText}>
                                    Try a different name, title, or department.
                                </p>
                            </div>
                        ) : (
                            <div style={isMobile ? styles.cardGridMobile : styles.cardGrid}>
                                {filteredEmployees.map((emp, idx) => {
                                    const avatar = getAvatarColors(emp.name);
                                    return (
                                        <div
                                            key={emp.id}
                                            className="emp-card"
                                            style={{
                                                ...styles.card,
                                                borderTopColor: avatar.accent,
                                                animationDelay: `${Math.min(idx, 11) * 25}ms`,
                                            }}
                                            onClick={() => openProfile(emp)}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    openProfile(emp);
                                                }
                                            }}
                                        >
                                            <div style={styles.cardTop}>
                                                <div style={styles.avatarWrap}>
                                                    {emp.photoUrl ? (
                                                        <img
                                                            src={emp.photoUrl}
                                                            alt={emp.name}
                                                            style={styles.avatarImg}
                                                        />
                                                    ) : (
                                                        <div
                                                            style={{
                                                                ...styles.avatar,
                                                                background: avatar.bg,
                                                                color: avatar.text,
                                                            }}
                                                        >
                                                            {getInitials(emp.name)}
                                                        </div>
                                                    )}
                                                </div>

                                                <div style={styles.cardNameBlock}>
                                                    <span style={styles.cardName}>{emp.name}</span>
                                                    <span style={styles.cardDesignation}>
                                                        {emp.designation}
                                                    </span>
                                                </div>

                                                <div style={styles.cardTopRight}>
                                                    <div style={styles.cardTopRightIcons}>
                                                        <button
                                                            type="button"
                                                            className="emp-expand-btn"
                                                            style={styles.expandBtn}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openProfile(emp);
                                                            }}
                                                            aria-label={`View ${emp.name}'s profile`}
                                                        >
                                                            <i className="ti ti-maximize" />
                                                        </button>

                                                        {canManage && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className="emp-icon-btn-sm emp-icon-btn-sm-edit"
                                                                    style={styles.editIconBtnSmall}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleEdit(emp);
                                                                    }}
                                                                    aria-label={`Edit ${emp.name}`}
                                                                >
                                                                    <i className="ti ti-pencil" />
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    className="emp-icon-btn-sm emp-icon-btn-sm-delete"
                                                                    style={
                                                                        styles.deleteIconBtnSmall
                                                                    }
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDelete(emp);
                                                                    }}
                                                                    aria-label={`Delete ${emp.name}`}
                                                                >
                                                                    <i className="ti ti-trash" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={styles.cardInfoRows}>
                                                <div style={styles.cardInfoLine}>
                                                    <i
                                                        className="ti ti-building"
                                                        style={styles.cardInfoIcon}
                                                        aria-hidden="true"
                                                    />
                                                    <span style={styles.cardInfoLabel}>
                                                        Department
                                                    </span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.department || "—"}
                                                    </span>
                                                </div>
                                                <div style={styles.cardInfoLine}>
                                                    <i
                                                        className="ti ti-map-pin"
                                                        style={styles.cardInfoIcon}
                                                        aria-hidden="true"
                                                    />
                                                    <span style={styles.cardInfoLabel}>
                                                        Location
                                                    </span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.location || "—"}
                                                    </span>
                                                </div>
                                                <div style={styles.cardInfoLine}>
                                                    <i
                                                        className="ti ti-mail"
                                                        style={styles.cardInfoIcon}
                                                        aria-hidden="true"
                                                    />
                                                    <span style={styles.cardInfoLabel}>Email</span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.email}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right side profile drawer */}
            {selectedEmployee && drawerData && (
                <div style={styles.drawerOverlay} onClick={closeProfile}>
                    <div
                        className="emp-drawer"
                        style={isMobile ? styles.drawerMobile : styles.drawer}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={styles.drawerBanner}>
                            <button
                                className="emp-drawer-close"
                                style={styles.drawerCloseBtn}
                                onClick={closeProfile}
                                type="button"
                                aria-label="Close"
                                disabled={saving}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.drawerBody}>
                            <div style={styles.drawerProfileRow}>
                                <div style={styles.avatarWrap}>
                                    {drawerData.photoUrl ? (
                                        <img
                                            src={drawerData.photoUrl}
                                            alt={drawerData.name}
                                            style={styles.drawerAvatarImg}
                                        />
                                    ) : (
                                        <div
                                            style={{
                                                ...styles.drawerAvatar,
                                                background: getAvatarColors(drawerData.name).bg,
                                                color: getAvatarColors(drawerData.name).text,
                                            }}
                                        >
                                            {getInitials(drawerData.name)}
                                        </div>
                                    )}
                                    <span
                                        style={{
                                            ...styles.statusDotLarge,
                                            background:
                                                drawerData.status !== "Inactive"
                                                    ? "#2ebba8"
                                                    : "#c2cedb",
                                        }}
                                    />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {isEditingDrawer ? (
                                        <>
                                            <input
                                                className="emp-drawer-input"
                                                style={{ ...styles.drawerInput, marginTop: 10 }}
                                                value={drawerData.name}
                                                onChange={(e) =>
                                                    updateEditField("name", e.target.value)
                                                }
                                                placeholder="Full name"
                                            />
                                            <input
                                                className="emp-drawer-input"
                                                style={{ ...styles.drawerInput, marginTop: 6 }}
                                                value={drawerData.designation}
                                                onChange={(e) =>
                                                    updateEditField("designation", e.target.value)
                                                }
                                                placeholder="Designation"
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <h3 style={styles.drawerName}>{drawerData.name}</h3>
                                            <p style={styles.drawerDesignation}>
                                                {drawerData.designation}
                                            </p>
                                        </>
                                    )}

                                    <div style={styles.drawerHeaderRow}>
                                        {isEditingDrawer ? (
                                            <select
                                                className="emp-drawer-select"
                                                style={styles.drawerStatusSelect}
                                                value={drawerData.status}
                                                onChange={(e) =>
                                                    updateEditField(
                                                        "status",
                                                        e.target.value as EntityStatus
                                                    )
                                                }
                                            >
                                                <option value="Active">Active</option>
                                                <option value="Inactive">Inactive</option>
                                            </select>
                                        ) : (
                                            <span
                                                style={{
                                                    ...styles.statusPill,
                                                    color:
                                                        drawerData.status !== "Inactive"
                                                            ? "#12806f"
                                                            : "#6b7280",
                                                    background:
                                                        drawerData.status !== "Inactive"
                                                            ? "#d7f5f0"
                                                            : "#f1f0f5",
                                                }}
                                            >
                                                {drawerData.status}
                                            </span>
                                        )}

                                        {!isEditingDrawer && canManage && (
                                            <button
                                                type="button"
                                                style={styles.drawerEditBtn}
                                                onClick={startEditingDrawer}
                                            >
                                                <i className="ti ti-pencil" /> Edit
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={styles.drawerStatsRow}>
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>{drawerData.status}</span>
                                    <span style={styles.statLabel}>Status</span>
                                </div>
                                <div style={styles.drawerStatDivider} />
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>
                                        {drawerData.department || "—"}
                                    </span>
                                    <span style={styles.statLabel}>Department</span>
                                </div>
                                <div style={styles.drawerStatDivider} />
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>
                                        {formatDateShort(drawerData.joiningDate)}
                                    </span>
                                    <span style={styles.statLabel}>Joined</span>
                                </div>
                            </div>

                            <div style={styles.drawerSection}>
                                <h4 style={styles.drawerSectionTitle}>Details</h4>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Employee ID</span>
                                    <span style={styles.detailsValue}>
                                        {drawerData.employeeCode}
                                    </span>
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Department</span>
                                    {isEditingDrawer ? (
                                        <input
                                            className="emp-drawer-input"
                                            style={styles.detailsInput}
                                            value={drawerData.department}
                                            onChange={(e) =>
                                                updateEditField("department", e.target.value)
                                            }
                                        />
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {drawerData.department || "—"}
                                        </span>
                                    )}
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Location</span>
                                    {isEditingDrawer ? (
                                        <input
                                            className="emp-drawer-input"
                                            style={styles.detailsInput}
                                            value={drawerData.location || ""}
                                            onChange={(e) =>
                                                updateEditField("location", e.target.value)
                                            }
                                        />
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {drawerData.location || "—"}
                                        </span>
                                    )}
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Reporting Manager</span>
                                    {isEditingDrawer ? (
                                        <input
                                            className="emp-drawer-input"
                                            style={styles.detailsInput}
                                            value={drawerData.reportingManager || ""}
                                            onChange={(e) =>
                                                updateEditField("reportingManager", e.target.value)
                                            }
                                        />
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {drawerData.reportingManager || "—"}
                                        </span>
                                    )}
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Joining Date</span>
                                    {isEditingDrawer ? (
                                        <input
                                            type="date"
                                            className="emp-drawer-input"
                                            style={styles.detailsInput}
                                            value={toDateInputValue(drawerData.joiningDate)}
                                            onChange={(e) =>
                                                updateEditField("joiningDate", e.target.value)
                                            }
                                        />
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {formatDate(drawerData.joiningDate)}
                                        </span>
                                    )}
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Email</span>
                                    {isEditingDrawer ? (
                                        <input
                                            type="email"
                                            className="emp-drawer-input"
                                            style={styles.detailsInput}
                                            value={drawerData.email}
                                            onChange={(e) =>
                                                updateEditField("email", e.target.value)
                                            }
                                        />
                                    ) : (
                                        <span style={styles.detailsValue}>{drawerData.email}</span>
                                    )}
                                </div>
                            </div>

                            {isEditingDrawer && (
                                <div style={styles.drawerEditActions}>
                                    <button
                                        type="button"
                                        style={styles.cancelButton}
                                        onClick={cancelEditingDrawer}
                                        disabled={saving}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        style={{
                                            ...styles.saveButton,
                                            opacity: saving ? 0.7 : 1,
                                            cursor: saving ? "not-allowed" : "pointer",
                                        }}
                                        onClick={handleSaveEdit}
                                        disabled={saving}
                                    >
                                        {saving ? "Saving..." : "Save"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation modal */}
            {showDeleteModal && employeeToDelete && (
                <div style={styles.modalOverlay} onClick={closeDeleteModal}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalIcon}>
                            <i className="ti ti-trash" />
                        </div>
                        <h3
                            style={{
                                margin: "0 0 6px",
                                fontSize: 16,
                                fontWeight: 800,
                                color: "#16233a",
                            }}
                        >
                            Delete {employeeToDelete.name}?
                        </h3>
                        <p style={{ margin: 0, fontSize: 13, color: "#7d90a6" }}>
                            This action cannot be undone. This will permanently remove the employee
                            record.
                        </p>
                        <div style={styles.modalButtons}>
                            <button
                                type="button"
                                style={styles.cancelButton}
                                onClick={closeDeleteModal}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={{
                                    ...styles.deleteButton,
                                    opacity: deleting ? 0.7 : 1,
                                    cursor: deleting ? "not-allowed" : "pointer",
                                }}
                                onClick={confirmDelete}
                                disabled={deleting}
                            >
                                {deleting ? "Deleting..." : "Delete"}
                            </button>
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
        height: "100vh",
        flex: 1,
        minHeight: 0,
        background: "#eff4fa",
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
        background: "#eff4fa",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
        fontSize: "20px",
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: "16px", fontWeight: 700, color: "#16233a" },

    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(22,35,58,0.45)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(1px)",
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

    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    },
    pageTitle: { margin: 0, fontSize: 21, fontWeight: 800, color: "#16233a", letterSpacing: -0.3 },
    pageTitleCount: { fontSize: 14, fontWeight: 600, color: "#7d90a6" },
    headerSubtext: { margin: "4px 0 0", fontSize: 13, color: "#7d90a6" },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(32,66,151,.06)",
        border: "1px solid #dfeaf5",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(32,66,151,.06)",
        border: "1px solid #dfeaf5",
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#f7fafc",
        border: "1px solid #dbe6f0",
        borderRadius: 10,
        padding: "9px 12px",
        transition: "border-color .15s ease, box-shadow .15s ease",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: 13,
        color: "#16233a",
        width: "100%",
    },
    clearBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: "none",
        background: "#f1eefc",
        color: "#6f8299",
        fontSize: 10,
        cursor: "pointer",
        flexShrink: 0,
    },
    filterSelect: {
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 13,
        color: "#374a63",
        outline: "none",
        cursor: "pointer",
        minWidth: 130,
        transition: "border-color .15s ease",
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
        gap: 6,
        padding: "70px 20px",
        textAlign: "center",
    },
    emptyIconWrap: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#e9f5fa",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
    emptyTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: "#233245" },
    emptyText: { margin: 0, fontSize: 13, color: "#7d90a6", maxWidth: 320 },
    retryBtn: {
        marginTop: 10,
        border: "1px solid #b9d9ec",
        background: "#fff",
        color: "#204297",
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 8,
        padding: "7px 14px",
        cursor: "pointer",
    },

    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #e7edf5",
        borderTop: "3px solid transparent",
        borderRadius: 14,
        padding: 12,
        gap: 9,
        cursor: "pointer",
        transition: "transform .18s ease, box-shadow .18s ease",
        boxShadow: "0 2px 10px rgba(23,44,84,.05)",
    },
    skeletonCard: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #dbeaf5",
        borderRadius: 14,
        padding: 16,
        gap: 8,
    },
    skeletonAvatar: {
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "#dee9f4",
        flexShrink: 0,
    },
    skeletonLineWide: {
        height: 10,
        borderRadius: 5,
        background: "#dee9f4",
        width: "85%",
        marginBottom: 8,
    },
    skeletonLineNarrow: {
        height: 10,
        borderRadius: 5,
        background: "#dee9f4",
        width: "50%",
    },

    cardTop: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
    },
    avatarWrap: {
        position: "relative",
        flexShrink: 0,
    },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: "50%",
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
    },
    avatarImg: {
        width: 38,
        height: 38,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
    },
    statusDot: {
        position: "absolute",
        bottom: 1,
        right: 1,
        width: 11,
        height: 11,
        borderRadius: "50%",
        border: "2px solid #fff",
    },
    statusDotLarge: {
        position: "absolute",
        bottom: 3,
        right: 3,
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "3px solid #fff",
    },
    cardNameBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        minWidth: 0,
        flex: 1,
    },
    cardName: {
        fontSize: 14.5,
        fontWeight: 700,
        color: "#16233a",
        textAlign: "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    cardDesignation: {
        fontSize: 12,
        color: "#8496ab",
        textAlign: "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    cardTopRight: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 5,
        flexShrink: 0,
    },
    cardTopRightIcons: {
        display: "flex",
        alignItems: "center",
        gap: 2,
    },
    expandBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 7,
        border: "none",
        background: "transparent",
        color: "#9bb0c2",
        cursor: "pointer",
        fontSize: 13,
        transition: "background .15s ease, color .15s ease",
    },
    editIconBtnSmall: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 7,
        border: "none",
        background: "#eef1fb",
        color: "#4a5fc7",
        cursor: "pointer",
        fontSize: 12,
        transition: "filter .15s ease",
    },
    deleteIconBtnSmall: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 7,
        border: "none",
        background: "#fdeaea",
        color: "#dc2626",
        cursor: "pointer",
        fontSize: 12,
        transition: "filter .15s ease",
    },
    cardInfoRows: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        borderTop: "1px solid #eef3f8",
        paddingTop: 9,
    },
    cardInfoLine: {
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        minWidth: 0,
    },
    cardInfoIcon: {
        fontSize: 12.5,
        color: "#9bb0c2",
        flexShrink: 0,
        position: "relative",
        top: 1,
    },
    cardInfoLabel: {
        fontSize: 12,
        color: "#8496ab",
        fontWeight: 600,
        letterSpacing: 0.2,
        flexShrink: 0,
    },
    cardInfoColon: {
        fontSize: 12,
        color: "#b7c3d1",
        fontWeight: 600,
        flexShrink: 0,
    },
    cardInfoValue: {
        fontSize: 12.5,
        fontWeight: 600,
        color: "#16233a",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
    },

    statLabel: { fontSize: 11, color: "#7d90a6" },
    statValue: {
        fontSize: 14,
        fontWeight: 700,
        color: "#16233a",
        maxWidth: 120,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    resultsCount: {
        fontSize: 12,
        color: "#7d90a6",
        padding: "0 2px",
    },

    // ---- Right side profile drawer ----
    drawerOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(22,35,58,0.45)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
        backdropFilter: "blur(2px)",
    },
    drawer: {
        width: 440,
        maxWidth: "92vw",
        height: "100%",
        background: "#fff",
        boxShadow: "-24px 0 60px rgba(22,35,58,0.25)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
    },
    drawerMobile: {
        width: "100%",
        height: "100%",
        background: "#fff",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
    },
    drawerBanner: {
        height: 72,
        background: "linear-gradient(135deg, #08a1ce, #204297)",
        position: "relative",
        flexShrink: 0,
    },
    drawerCloseBtn: {
        position: "absolute",
        top: 16,
        right: 16,
        border: "none",
        background: "rgba(255,255,255,0.2)",
        color: "#fff",
        borderRadius: "50%",
        width: 28,
        height: 28,
        fontSize: 14,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .15s ease",
    },
    drawerBody: {
        padding: "0 28px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
    },
    drawerProfileRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        marginTop: -32,
    },
    drawerHeaderRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 8,
    },
    drawerAvatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 64,
        height: 64,
        borderRadius: "50%",
        fontSize: 20,
        fontWeight: 700,
        flexShrink: 0,
        border: "4px solid #fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    },
    drawerAvatarImg: {
        width: 64,
        height: 64,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        border: "4px solid #fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    },
    drawerName: { margin: "10px 0 2px", fontSize: 18, fontWeight: 800, color: "#16233a" },
    drawerDesignation: { margin: "0 0 8px", fontSize: 13, color: "#7d90a6" },
    statusPill: {
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 10px",
    },
    drawerEditBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 700,
        color: "#204297",
        background: "#eef1fb",
        border: "none",
        borderRadius: 8,
        padding: "5px 10px",
        cursor: "pointer",
    },
    drawerInput: {
        width: "100%",
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: 8,
        padding: "6px 9px",
        fontSize: 13,
        color: "#16233a",
        boxSizing: "border-box",
    },
    drawerStatusSelect: {
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: 8,
        padding: "5px 9px",
        fontSize: 12,
        fontWeight: 700,
        color: "#16233a",
        cursor: "pointer",
    },

    drawerStatsRow: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#faf9ff",
        border: "1px solid #dfeaf5",
        borderRadius: 12,
        padding: "14px 8px",
    },
    drawerStatBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flex: 1,
        minWidth: 0,
        padding: "0 4px",
    },
    drawerStatDivider: {
        width: 1,
        alignSelf: "stretch",
        background: "#dee9f4",
    },

    drawerSection: { display: "flex", flexDirection: "column", gap: 10 },
    drawerSectionTitle: {
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        color: "#16233a",
        borderBottom: "1px solid #f0f0f0",
        paddingBottom: 8,
    },

    detailsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    detailsLabel: { fontSize: 12, color: "#7d90a6", fontWeight: 600, flexShrink: 0 },
    detailsValue: { fontSize: 13, color: "#16233a", fontWeight: 600, textAlign: "right" },
    detailsInput: {
        flex: 1,
        maxWidth: 220,
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: 8,
        padding: "6px 9px",
        fontSize: 13,
        color: "#16233a",
        textAlign: "right",
        boxSizing: "border-box",
    },

    drawerEditActions: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 10,
        marginTop: 4,
        paddingTop: 16,
        borderTop: "1px solid #f0f0f0",
    },
    saveButton: {
        padding: "10px 22px",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        background: "#204297",
        color: "#fff",
        fontWeight: 600,
    },

    modalOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5000,
    },

    modal: {
        width: 380,
        background: "#fff",
        borderRadius: 16,
        padding: 30,
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,.2)",
    },

    modalIcon: {
        width: 70,
        height: 70,
        margin: "0 auto 15px",
        borderRadius: "50%",
        background: "#FEE2E2",
        color: "#DC2626",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontSize: 34,
    },

    modalButtons: {
        display: "flex",
        justifyContent: "center",
        gap: 12,
        marginTop: 25,
    },

    cancelButton: {
        padding: "10px 22px",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        background: "#E5E7EB",
        fontWeight: 600,
    },

    deleteButton: {
        padding: "10px 22px",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        background: "#DC2626",
        color: "#fff",
        fontWeight: 600,
    },
};
