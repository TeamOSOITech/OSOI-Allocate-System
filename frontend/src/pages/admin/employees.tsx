import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
  box-shadow: 0 14px 30px rgba(109,40,217,.14);
  border-color: #d8ceff;
}
.emp-card:focus-visible {
  outline: 2px solid #7c3aed;
  outline-offset: 2px;
}
.emp-expand-btn:hover { background: #ede9fe; color: #6d28d9; }
.emp-search-input::placeholder { color: #b7b2cf; }
.emp-search-wrap:focus-within {
  border-color: #c4b5fd;
  box-shadow: 0 0 0 3px rgba(124,58,237,.10);
}
.emp-clear-btn:hover { background: #ece7fb; }
.emp-select:hover { border-color: #d8ceff; }
.emp-drawer-close:hover { background: rgba(255,255,255,.32); }
.emp-drawer { animation: empDrawerIn .28s ease both; }
`;

export default function Employees() {
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [search, setSearch] = useState("");
    const [departmentFilter, setDepartmentFilter] = useState("All");

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

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

    const openProfile = (employee: Employee) => {
        setSelectedEmployee(employee);
    };

    const closeProfile = () => {
        setSelectedEmployee(null);
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

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{GLOBAL_CSS}</style>

            {isMobile && (
                <div style={styles.mobileTopbar}>
                    <button
                        style={styles.hamburgerBtn}
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        type="button"
                    >
                        ☰
                    </button>
                    <span style={styles.mobileTitle}>Employees</span>
                    <div style={{ width: 32 }} />
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
                                style={{ fontSize: 15, color: "#9c96b8" }}
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
                                        style={{ fontSize: 26, color: "#a78bfa" }}
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
                                    const isActive = emp.status !== "Inactive";
                                    return (
                                        <div
                                            key={emp.id}
                                            className="emp-card"
                                            style={{
                                                ...styles.card,
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
                                                    <span
                                                        title={emp.status}
                                                        style={{
                                                            ...styles.statusDot,
                                                            background: isActive
                                                                ? "#22c55e"
                                                                : "#c9c4de",
                                                        }}
                                                    />
                                                </div>
                                                <div style={styles.cardNameBlock}>
                                                    <div style={styles.cardNameRow}>
                                                        <span style={styles.cardName}>
                                                            {emp.name}
                                                        </span>

                                                        <button
                                                            type="button"
                                                            className="emp-expand-btn"
                                                            style={styles.expandBtn}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openProfile(emp);
                                                            }}
                                                            aria-label={`Open ${emp.name}'s profile`}
                                                        >
                                                            <i className="ti ti-maximize" />
                                                        </button>
                                                    </div>

                                                    <span style={styles.cardDesignation}>
                                                        {emp.designation}
                                                    </span>
                                                </div>
                                            </div>

                                            <div style={styles.cardInfoRows}>
                                                <div style={styles.cardInfoLine}>
                                                    <span style={styles.cardInfoLabel}>
                                                        Department
                                                    </span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.department}
                                                    </span>
                                                </div>
                                                <div style={styles.cardInfoLine}>
                                                    <span style={styles.cardInfoLabel}>
                                                        Location
                                                    </span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.location || "—"}
                                                    </span>
                                                </div>
                                                <div style={styles.cardInfoLine}>
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
            {selectedEmployee && (
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
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.drawerBody}>
                            <div style={styles.drawerProfileRow}>
                                <div style={styles.avatarWrap}>
                                    {selectedEmployee.photoUrl ? (
                                        <img
                                            src={selectedEmployee.photoUrl}
                                            alt={selectedEmployee.name}
                                            style={styles.drawerAvatarImg}
                                        />
                                    ) : (
                                        <div
                                            style={{
                                                ...styles.drawerAvatar,
                                                background: getAvatarColors(selectedEmployee.name)
                                                    .bg,
                                                color: getAvatarColors(selectedEmployee.name).text,
                                            }}
                                        >
                                            {getInitials(selectedEmployee.name)}
                                        </div>
                                    )}
                                    <span
                                        style={{
                                            ...styles.statusDotLarge,
                                            background:
                                                selectedEmployee.status !== "Inactive"
                                                    ? "#22c55e"
                                                    : "#c9c4de",
                                        }}
                                    />
                                </div>
                                <div>
                                    <h3 style={styles.drawerName}>{selectedEmployee.name}</h3>
                                    <p style={styles.drawerDesignation}>
                                        {selectedEmployee.designation}
                                    </p>
                                    <span
                                        style={{
                                            ...styles.statusPill,
                                            color:
                                                selectedEmployee.status !== "Inactive"
                                                    ? "#15803d"
                                                    : "#6b7280",
                                            background:
                                                selectedEmployee.status !== "Inactive"
                                                    ? "#dcfce7"
                                                    : "#f1f0f5",
                                        }}
                                    >
                                        {selectedEmployee.status}
                                    </span>
                                </div>
                            </div>

                            <div style={styles.drawerStatsRow}>
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>{selectedEmployee.status}</span>
                                    <span style={styles.statLabel}>Status</span>
                                </div>
                                <div style={styles.drawerStatDivider} />
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>
                                        {selectedEmployee.department}
                                    </span>
                                    <span style={styles.statLabel}>Department</span>
                                </div>
                                <div style={styles.drawerStatDivider} />
                                <div style={styles.drawerStatBlock}>
                                    <span style={styles.statValue}>
                                        {formatDateShort(selectedEmployee.joiningDate)}
                                    </span>
                                    <span style={styles.statLabel}>Joined</span>
                                </div>
                            </div>

                            <div style={styles.drawerSection}>
                                <h4 style={styles.drawerSectionTitle}>Details</h4>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Employee ID</span>
                                    <span style={styles.detailsValue}>
                                        {selectedEmployee.employeeCode}
                                    </span>
                                </div>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Department</span>
                                    <span style={styles.detailsValue}>
                                        {selectedEmployee.department}
                                    </span>
                                </div>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Location</span>
                                    <span style={styles.detailsValue}>
                                        {selectedEmployee.location || "—"}
                                    </span>
                                </div>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Reporting Manager</span>
                                    <span style={styles.detailsValue}>
                                        {selectedEmployee.reportingManager || "—"}
                                    </span>
                                </div>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Joining Date</span>
                                    <span style={styles.detailsValue}>
                                        {formatDate(selectedEmployee.joiningDate)}
                                    </span>
                                </div>
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Email</span>
                                    <span style={styles.detailsValue}>
                                        {selectedEmployee.email}
                                    </span>
                                </div>
                            </div>
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
        background: "#f5f3ff",
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
        background: "#f5f3ff",
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
    mobileTitle: { fontSize: "16px", fontWeight: 700, color: "#1e1b3a" },

    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(30,27,58,0.45)",
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
    pageTitle: { margin: 0, fontSize: 21, fontWeight: 800, color: "#1e1b3a", letterSpacing: -0.3 },
    pageTitleCount: { fontSize: 14, fontWeight: 600, color: "#9c96b8" },
    headerSubtext: { margin: "4px 0 0", fontSize: 13, color: "#9c96b8" },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(109,40,217,.05)",
        border: "1px solid #f0ecff",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(109,40,217,.05)",
        border: "1px solid #f0ecff",
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#fafafd",
        border: "1px solid #ececf5",
        borderRadius: 10,
        padding: "9px 12px",
        transition: "border-color .15s ease, box-shadow .15s ease",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: 13,
        color: "#1e1b3a",
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
        color: "#8b85a8",
        fontSize: 10,
        cursor: "pointer",
        flexShrink: 0,
    },
    filterSelect: {
        border: "1px solid #ececf5",
        background: "#fafafd",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 13,
        color: "#4b4560",
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
        background: "#f5f2ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
    emptyTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: "#2d2a45" },
    emptyText: { margin: 0, fontSize: 13, color: "#9c96b8", maxWidth: 320 },
    retryBtn: {
        marginTop: 10,
        border: "1px solid #ddd4fb",
        background: "#fff",
        color: "#6d28d9",
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
        border: "1px solid #ede9fe",
        borderRadius: 16,
        padding: 14,
        gap: 12,
        cursor: "pointer",
        transition: "transform .18s ease, box-shadow .18s ease, border-color .18s ease",
        boxShadow: "0 2px 10px rgba(30,27,58,.04)",
    },
    skeletonCard: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #ede9fe",
        borderRadius: 16,
        padding: 14,
        gap: 8,
    },
    skeletonAvatar: {
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: "#ece7fb",
        flexShrink: 0,
    },
    skeletonLineWide: {
        height: 10,
        borderRadius: 5,
        background: "#ece7fb",
        width: "85%",
        marginBottom: 8,
    },
    skeletonLineNarrow: {
        height: 10,
        borderRadius: 5,
        background: "#ece7fb",
        width: "50%",
    },

    cardTop: {
        display: "flex",
        alignItems: "center",
        gap: 12,
    },
    avatarWrap: {
        position: "relative",
        flexShrink: 0,
    },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 52,
        height: 52,
        borderRadius: "50%",
        fontSize: 16,
        fontWeight: 700,
        flexShrink: 0,
    },
    avatarImg: {
        width: 52,
        height: 52,
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
        gap: 3,
        minWidth: 0,
        flex: 1,
    },
    cardNameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" },
    cardName: {
        fontSize: 15,
        fontWeight: 700,
        color: "#1e1b3a",
        textAlign: "left",
    },
    cardDesignation: {
        fontSize: 12.5,
        color: "#7c7895",
        marginTop: 2,
        textAlign: "left",
        alignSelf: "flex-start",
        width: "100%",
    },
    expandBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 7,
        border: "none",
        background: "transparent",
        color: "#b7b2cf",
        cursor: "pointer",
        marginLeft: "auto",
        fontSize: 12,
        transition: "background .15s ease, color .15s ease",
    },
    cardInfoRows: {
        display: "flex",
        flexDirection: "column",
        gap: 7,
        borderTop: "1px solid #f3f0ff",
        paddingTop: 12,
    },
    cardInfoLine: {
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        minWidth: 0,
    },
    cardInfoLabel: {
        fontSize: 12.5,
        color: "#6d28d9",
        fontWeight: 600,
        flexShrink: 0,
    },
    cardInfoColon: {
        fontSize: 12.5,
        color: "#6d28d9",
        fontWeight: 600,
        flexShrink: 0,
    },
    cardInfoValue: {
        fontSize: 12.5,
        fontWeight: 500,
        color: "#2d2a45",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
    },

    statLabel: { fontSize: 11, color: "#9c96b8" },
    statValue: {
        fontSize: 14,
        fontWeight: 700,
        color: "#1e1b3a",
        maxWidth: 120,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    resultsCount: {
        fontSize: 12,
        color: "#9c96b8",
        padding: "0 2px",
    },

    // ---- Right side profile drawer ----
    drawerOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(30,27,58,0.45)",
        zIndex: 60,
        display: "flex",
        justifyContent: "flex-end",
        backdropFilter: "blur(2px)",
    },
    drawer: {
        width: 440,
        maxWidth: "92vw",
        height: "100%",
        background: "#fff",
        boxShadow: "-24px 0 60px rgba(30,27,58,0.25)",
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
        background: "linear-gradient(135deg, #a78bfa, #6d28d9)",
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
    drawerName: { margin: "10px 0 2px", fontSize: 18, fontWeight: 800, color: "#1e1b3a" },
    drawerDesignation: { margin: "0 0 8px", fontSize: 13, color: "#9c96b8" },
    statusPill: {
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 10px",
    },

    drawerStatsRow: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#faf9ff",
        border: "1px solid #f0ecff",
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
        background: "#ece7fb",
    },

    drawerSection: { display: "flex", flexDirection: "column", gap: 10 },
    drawerSectionTitle: {
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        color: "#1e1b3a",
        borderBottom: "1px solid #f0f0f0",
        paddingBottom: 8,
    },

    detailsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    detailsLabel: { fontSize: 12, color: "#9c96b8", fontWeight: 600 },
    detailsValue: { fontSize: 13, color: "#1e1b3a", fontWeight: 600, textAlign: "right" },
};
