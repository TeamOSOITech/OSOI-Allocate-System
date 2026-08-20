import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
import { authFetch } from "../../utils/authFetch";
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
    // Shown on the card in place of Location, and included in search.
    team?: string | null;
    // NEW: role code from user_master (e.g. "SUPER_ADMIN", "TEAM_MEMBER").
    // Editable only by a Super Admin — see Role field in the drawer below.
    role?: string | null;
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

// Shape returned by GET /api/teams — same shape used on the Products page's
// Teams dropdown.
type Team = { id: string; name: string };

// The app's fixed 6-tier role codes — see backend src/config/permissions.js.
// Only a Super Admin can change this field (enforced both here and on the
// backend), so unlike Department/Team this list is NOT fetched dynamically.
const ROLE_OPTIONS: { value: string; label: string }[] = [
    { value: "SUPER_ADMIN", label: "Super Admin" },
    { value: "OPS_MANAGER", label: "Ops Manager" },
    { value: "AUDIT_MANAGER", label: "Audit Manager" },
    { value: "PROCESS_LEAD", label: "Process Lead" },
    { value: "VERTICAL_HEAD", label: "Vertical Head" },
    { value: "TEAM_MEMBER", label: "Team Member" },
];

function formatRoleLabel(roleCode?: string | null) {
    if (!roleCode) return "—";
    return ROLE_OPTIONS.find((r) => r.value === roleCode)?.label || roleCode;
}

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
// as onMouseEnter/onMouseLeave handlers everywhere. Brand colors below use
// the CSS custom properties ThemeProvider sets on <html> (see
// context/themecontext.tsx) so the header's "Theme color" picker also
// updates this page's hover/focus accents, instead of them staying pinned
// to the fixed default blue/teal.
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
  box-shadow: 0 14px 30px rgba(var(--brand-blue-rgb), .16);
}
.emp-card:focus-visible {
  outline: 2px solid var(--brand-light-blue);
  outline-offset: 2px;
}
.emp-search-input::placeholder { color: #9bb0c2; }
.emp-search-wrap:focus-within {
  border-color: #7fc9e2;
  box-shadow: 0 0 0 3px rgba(var(--brand-light-blue-rgb),.14);
}
.emp-clear-btn:hover { background: #dee9f4; }
.emp-select:hover { border-color: #9ecfe8; }
.emp-drawer-close:hover { background: rgba(255,255,255,.32); }
.emp-drawer { animation: empDrawerIn .28s ease both; }

.emp-icon-btn-sm:hover { filter: brightness(0.95); }
.emp-drawer-input:focus, .emp-drawer-select:focus {
  border-color: #7fc9e2;
  box-shadow: 0 0 0 3px rgba(var(--brand-light-blue-rgb),.14);
  outline: none;
}
`;

export default function Employees() {
    const isMobile = useIsMobile();
    //const [sidebarOpen, setSidebarOpen] = useState(false);

    // ---- Role gating ----
    // Only roles holding the "employees.manage" permission can see and use
    // the edit/delete controls (matches employees.routes.js on the
    // backend — Ops Manager / Super Admin). Everyone else gets a
    // read-only view. Role values are the new 6-tier codes — see
    // backend src/config/permissions.js.
    let currentUser: { role?: string } | null = null;
    try {
        const userStr = localStorage.getItem("user");
        currentUser = userStr ? JSON.parse(userStr) : null;
    } catch {
        currentUser = null;
    }
    const role = (currentUser?.role || "TEAM_MEMBER").toUpperCase();
    const canManage = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"].includes(role);
    // FIX: canManage alone was global ("can this user edit employees at
    // all") and didn't consider WHO the target employee is. That let an
    // Ops Manager/Process Lead open the edit drawer for a Super Admin's
    // record and see every field as an editable input (Department,
    // Designation, Reporting Manager, Joining Date, Email...) with an
    // enabled Save button — even though the backend now rejects the
    // PATCH with a 403. The UI shouldn't offer an editing experience
    // that's guaranteed to fail. Use this wherever a specific employee
    // row/record's editability is being decided; canManage stays as-is
    // for section-level checks (e.g. "does this role see the Edit
    // affordance at all").
    //
    // FIX #2: the previous version only special-cased "target is SUPER_
    // ADMIN" and returned true for every other target — so an Ops
    // Manager editing ANOTHER Ops Manager (or Process Lead editing
    // another Process Lead, or itself) still got a fully-editable drawer
    // that the backend would then 403 on Save. Mirrors backend's
    // EDITABLE_TARGET_ROLES in src/config/permissions.js exactly instead
    // of special-casing one role: Super Admin -> everyone, Ops Manager ->
    // Process Lead/Vertical Head/Team Member only, Process Lead ->
    // Vertical Head/Team Member only. No self-edit exception either —
    // matches backend, which has none.
    const EDITABLE_TARGET_ROLES: Record<string, string[]> = {
        SUPER_ADMIN: [
            "TEAM_MEMBER",
            "VERTICAL_HEAD",
            "PROCESS_LEAD",
            "OPS_MANAGER",
            "AUDIT_MANAGER",
            "SUPER_ADMIN",
        ],
        OPS_MANAGER: ["PROCESS_LEAD", "VERTICAL_HEAD", "TEAM_MEMBER"],
        PROCESS_LEAD: ["VERTICAL_HEAD", "TEAM_MEMBER"],
    };
    const canEditEmployee = (employee: Employee | null | undefined) => {
        if (!canManage) return false;
        const allowed = EDITABLE_TARGET_ROLES[role] || [];
        return allowed.includes(employee?.role || "");
    };
    // NEW: Delete is narrower than Edit — only Super Admin and Ops
    // Manager can delete an employee record; Process Lead can create/edit
    // but never delete (matches DELETABLE_TARGET_ROLES in the backend's
    // src/config/permissions.js). Ops Manager can delete Process Lead /
    // Vertical Head / Team Member records, but not another Ops Manager,
    // Audit Manager, or Super Admin.
    const canDeleteEmployee = (employee: Employee | null | undefined) => {
        if (role === "SUPER_ADMIN") return true;
        if (role === "OPS_MANAGER") {
            return ["PROCESS_LEAD", "VERTICAL_HEAD", "TEAM_MEMBER"].includes(employee?.role || "");
        }
        return false;
    };
    // NEW: Role field is special — Ops Manager can edit everything else
    // about an employee, but only a Super Admin can change someone's
    // role (prevents a lower admin tier from granting/removing Super
    // Admin access). Everyone else always sees Role read-only, even in
    // edit mode.
    const canEditRole = role === "SUPER_ADMIN";

    const [search, setSearch] = useState("");
    const [departmentFilter, setDepartmentFilter] = useState("All");
    // Grid/list toggle — same pattern as the Clients and Products (Services)
    // pages, so switching between admin pages feels consistent.
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Teams for the drawer's Team dropdown (edit mode). Same source as the
    // Products page's Teams dropdown — GET /api/teams.
    const [teamsList, setTeamsList] = useState<Team[]>([]);

    // NEW: Departments for the drawer's Department dropdown (edit mode).
    // Same authoritative list used on the Add User page's Department
    // field — GET /api/options. This is the org's configured department
    // list, not just whatever departments happen to already be assigned
    // to an employee (that's the separate, narrower `departments` list
    // below, used only for this page's filter dropdown).
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);

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

    // NEW: multi-select bulk delete — same pattern as Clients/Products.
    // Selection is a plain Set<number> of employee ids. Only ids the
    // current role is actually allowed to delete (canDeleteEmployee) are
    // ever added, so "Select all" never tries to check a box the row
    // doesn't even render.
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkDeleteError, setBulkDeleteError] = useState("");
    // NEW: checkboxes for bulk delete stay hidden until "Select" is
    // switched on, instead of sitting on every row/card all the time.
    const [isSelectMode, setIsSelectMode] = useState(false);

    const apiBase = import.meta.env.VITE_API_URL;

    // COOKIE-AUTH: this page used to build its own Authorization header
    // from localStorage.getItem("accessToken") on every call below. That
    // key is never written anymore (tokens live in httpOnly cookies now —
    // see authFetch.ts), so every request here was silently going out
    // with NO credentials at all and 401ing. Switched every fetch() call
    // in this file to authFetch(), which attaches the auth cookie + CSRF
    // header automatically and handles token refresh, exactly like every
    // other page (Clients, Products, etc.) already does.
    const fetchEmployees = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(`${apiBase}/api/employees`, { cache: "no-store" });
            if (!res.ok) throw new Error("Failed to load employees");
            setEmployees(await res.json());
        } catch (err: any) {
            setError(err?.message || "Something went wrong loading employees.");
        } finally {
            setLoading(false);
        }
    };

    // Non-critical: if this fails, the Team field in edit mode just falls
    // back to a plain text input further down (see drawer body).
    const fetchTeams = async () => {
        try {
            const res = await authFetch(`${apiBase}/api/teams`, { cache: "no-store" });
            if (!res.ok) return;
            const json = await res.json();
            setTeamsList(json?.data || []);
        } catch {
            // silent — non-critical
        }
    };

    // NEW: Non-critical, same reasoning as fetchTeams — if this fails, the
    // Department field in edit mode falls back to a plain text input.
    const fetchDepartmentOptions = async () => {
        try {
            const res = await authFetch(`${apiBase}/api/options`, { cache: "no-store" });
            if (!res.ok) return;
            const json = await res.json();
            setDepartmentOptions(json?.departments || []);
        } catch {
            // silent — non-critical
        }
    };

    useEffect(() => {
        fetchEmployees();
        fetchTeams();
        fetchDepartmentOptions();
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
        if (!canEditEmployee(employee)) return;
        setSelectedEmployee(employee);
        setEditForm({ ...employee });
        setIsEditingDrawer(true);
    };

    // Switches an already-open (read-only) drawer into edit mode.
    const startEditingDrawer = () => {
        if (!canEditEmployee(selectedEmployee) || !selectedEmployee) return;
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
        // Defense in depth: the pencil/Edit affordances are already hidden
        // via canEditEmployee() above, but guard the actual save action
        // too in case editForm/selectedEmployee got out of sync.
        if (!canEditEmployee(selectedEmployee)) {
            alert("You don't have permission to edit this employee.");
            return;
        }
        setSaving(true);
        try {
            // Guard on the frontend too: even though the Role <select> is
            // hidden from non-Super-Admins in the UI, editForm still
            // carries whatever role the originally-selected employee had.
            // Explicitly stripping it here (rather than trusting the UI
            // never having changed it) means a non-Super-Admin's save
            // request never includes a role field at all — the backend
            // enforces this too, but this avoids relying on that alone.
            const payload: Record<string, any> = { ...editForm };
            if (!canEditRole) delete payload.role;

            const res = await authFetch(`${apiBase}/api/employees/${editForm.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => null);
                throw new Error(errBody?.error || "Update failed");
            }

            // FIX: backend response might be sparse, differently-cased, or
            // return null/"" for fields it doesn't actually persist (e.g. a
            // column that doesn't exist yet). Blindly spreading that response
            // over the previous record was wiping out fields the user just
            // typed. editForm (what the user submitted) is now the source of
            // truth; only non-empty values from the response get merged on
            // top of it.
            let updated: Record<string, any> = {};
            try {
                updated = await res.json();
            } catch {
                updated = {};
            }
            const cleanUpdated = Object.fromEntries(
                Object.entries(updated).filter(([, v]) => v !== null && v !== undefined && v !== "")
            );

            const merged: Employee = { ...editForm, ...cleanUpdated };

            setEmployees((prev) => prev.map((e) => (e.id === merged.id ? merged : e)));
            // Close the drawer entirely on save — takes the user back to the
            // main list instead of leaving it open in read-only view.
            setSelectedEmployee(null);
            setIsEditingDrawer(false);
            setEditForm(null);
        } catch (err: any) {
            console.error(err);
            alert(err?.message || "Unable to save changes.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (employee: Employee) => {
        if (!canEditEmployee(employee)) return;
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
            const response = await authFetch(`${apiBase}/api/employees/${employeeToDelete.id}`, {
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

    // ---- Multi-select delete handlers ----
    // Reuses the exact same DELETE /api/employees/:id endpoint as the
    // single-row delete above — no new backend route needed — just fired
    // once per selected id.

    const toggleSelected = (id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // "Select all" toggles every row CURRENTLY VISIBLE (i.e. matching the
    // active search/department filters) — not the whole unfiltered
    // dataset — and only rows this role is actually allowed to delete.
    const toggleSelectAllVisible = (visibleIds: number[]) => {
        setSelectedIds((prev) => {
            const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
            if (allSelected) {
                const next = new Set(prev);
                visibleIds.forEach((id) => next.delete(id));
                return next;
            }
            return new Set([...prev, ...visibleIds]);
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    // Toggles select-mode on/off. Always clears any existing selection so
    // turning it off (or back on) starts from a clean slate.
    const toggleSelectMode = () => {
        setIsSelectMode((prev) => !prev);
        setSelectedIds(new Set());
    };

    const openBulkDeleteConfirm = () => {
        setBulkDeleteError("");
        setBulkDeleteOpen(true);
    };

    const closeBulkDeleteConfirm = () => {
        if (bulkDeleting) return;
        setBulkDeleteOpen(false);
        setBulkDeleteError("");
    };

    const handleBulkDeleteConfirm = async () => {
        if (selectedIds.size === 0) return;
        setBulkDeleting(true);
        setBulkDeleteError("");

        const ids = Array.from(selectedIds);
        const failures: string[] = [];

        // Sequential, not Promise.all — a burst of simultaneous deletes
        // against the same org's rows is more likely to trip rate limits
        // or row-lock contention than a few hundred ms of extra time is
        // worth here. Each failure is collected (by id) instead of
        // aborting the whole batch, so one bad row doesn't block the
        // rest from being deleted.
        for (const id of ids) {
            try {
                const response = await authFetch(`${apiBase}/api/employees/${id}`, {
                    method: "DELETE",
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => null);
                    failures.push(`#${id}: ${data?.message || "Failed to delete"}`);
                }
            } catch (err: any) {
                failures.push(`#${id}: ${err?.message || "Something went wrong"}`);
            }
        }

        await fetchEmployees();
        setSelectedIds(new Set());
        setBulkDeleting(false);

        if (failures.length > 0) {
            setBulkDeleteError(
                `${ids.length - failures.length} of ${ids.length} deleted. ` +
                    `${failures.length} failed:\n${failures.join("\n")}`
            );
        } else {
            setBulkDeleteOpen(false);
            setIsSelectMode(false);
        }
    };

    const departments = useMemo(
        () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(),
        [employees]
    );

    // Reporting Manager dropdown options — built from the employees
    // already loaded on this page rather than a separate fetch. Value is
    // the manager's email (matches how reportingManager is already stored
    // — see the Add User page's Reporting Manager field), label shows
    // name + email so two people with the same name are distinguishable.
    // The employee currently open in the drawer is excluded so they can't
    // be set as their own manager.
    const reportingManagerOptions = useMemo(
        () =>
            employees
                .filter((e) => e.email && e.id !== editForm?.id)
                .map((e) => ({ value: e.email, label: `${e.name} (${e.email})` }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [employees, editForm?.id]
    );

    // Department dropdown options for the drawer — merges the curated
    // /api/options list (departmentOptions) with whatever department
    // values already exist on real employee records (departments,
    // computed below). Covers the case where nobody has added anything
    // via the Add User page's "+" control yet and the curated table is
    // still empty — the dropdown still has real options instead of
    // silently falling back to a plain text box.
    const departmentDropdownOptions = useMemo(
        () => Array.from(new Set([...departmentOptions, ...departments])).sort(),
        [departmentOptions, departments]
    );

    // FIX: previously called `.toLowerCase()` directly on `e.name`,
    // `e.designation`, `e.employeeCode` without guarding against
    // null/undefined values coming back from the API. A single record
    // missing one of those fields threw a TypeError inside this useMemo
    // (which runs on every render, including the very first one right
    // after navigating to this page) — an uncaught error during render
    // with no Error Boundary above it unmounts the whole tree, which is
    // why the page went white on navigation.
    //
    // Search now matches on Name, Team, and Department (Location has been
    // dropped from both the card display and the search, per the Team
    // field replacing it below).
    const filteredEmployees = useMemo(() => {
        const q = search.trim().toLowerCase();
        return employees.filter((e) => {
            const matchesSearch =
                (e.name || "").toLowerCase().includes(q) ||
                (e.team || "").toLowerCase().includes(q) ||
                (e.department || "").toLowerCase().includes(q);
            const matchesDepartment =
                departmentFilter === "All" || e.department === departmentFilter;
            return matchesSearch && matchesDepartment;
        });
    }, [employees, search, departmentFilter]);

    // Ids eligible for bulk selection: currently visible (matches
    // search/department filters) AND this role is actually allowed to
    // delete them. Used to drive the header/bulk-bar "select all".
    const selectableVisibleIds = useMemo(
        () => filteredEmployees.filter((e) => canDeleteEmployee(e)).map((e) => e.id),
        [filteredEmployees, role]
    );
    const allVisibleSelected =
        selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedIds.has(id));

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
                                    Browse your organization by department and team.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Filters */}
                    <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                        <div className="emp-search-wrap" style={styles.searchWrap}>
                            <i
                                className="ti ti-search"
                                style={{ fontSize: fontSize.lg, color: "#7d90a6" }}
                                aria-hidden="true"
                            />
                            <input
                                className="emp-search-input"
                                style={styles.searchInput}
                                placeholder="Search by name, team, or department..."
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

                        {/* NEW: "Select" toggle — checkboxes for bulk delete only show
                            once this is switched on, instead of sitting on every
                            row/card all the time. Tapping it again exits select mode
                            and clears whatever was checked. */}
                        {selectableVisibleIds.length > 0 && (
                            <button
                                type="button"
                                onClick={toggleSelectMode}
                                style={{
                                    ...styles.selectModeBtn,
                                    ...(isSelectMode ? styles.selectModeBtnActive : {}),
                                }}
                            >
                                <i
                                    className={isSelectMode ? "ti ti-x" : "ti ti-checkbox"}
                                    style={{ fontSize: fontSize.md }}
                                />
                                {isSelectMode ? "Cancel" : "Select"}
                            </button>
                        )}

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

                    {!loading && !error && (
                        <span style={styles.resultsCount}>
                            {filteredEmployees.length} of {employees.length} employee
                            {employees.length === 1 ? "" : "s"}
                        </span>
                    )}

                    {/* NEW: bulk-select action bar — appears as soon as at least
                        one row is checked, so with a long list you only ever
                        have to check one box before "Select all" is right
                        there instead of clicking through every row. */}
                    {!loading && !error && isSelectMode && selectedIds.size > 0 && (
                        <div style={styles.bulkBar}>
                            <span style={styles.bulkBarText}>
                                {selectedIds.size} employee
                                {selectedIds.size > 1 ? "s" : ""} selected
                            </span>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {!allVisibleSelected && selectableVisibleIds.length > 1 && (
                                    <button
                                        type="button"
                                        style={styles.bulkBarClearBtn}
                                        onClick={() => toggleSelectAllVisible(selectableVisibleIds)}
                                    >
                                        Select all {selectableVisibleIds.length}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    style={styles.bulkBarClearBtn}
                                    onClick={clearSelection}
                                >
                                    Clear
                                </button>
                                <button
                                    type="button"
                                    style={styles.bulkBarDeleteBtn}
                                    onClick={openBulkDeleteConfirm}
                                >
                                    <i
                                        className="ti ti-trash"
                                        style={{ fontSize: fontSize.base }}
                                    />
                                    Delete Selected
                                </button>
                            </div>
                        </div>
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
                                        style={{ fontSize: fontSize["6xl"], color: "#dc2626" }}
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
                                        style={{
                                            fontSize: fontSize["6xl"],
                                            color: "var(--brand-light-blue)",
                                        }}
                                    />
                                </div>
                                <p style={styles.emptyTitle}>No employees match your filters</p>
                                <p style={styles.emptyText}>
                                    Try a different name, team, or department.
                                </p>
                            </div>
                        ) : viewMode === "list" && !isMobile ? (
                            // ---- List view — same table pattern/alignment as
                            // Clients and Products (Services): sticky header,
                            // fixed column widths via <colgroup>, one row per
                            // record, right-aligned action icons.
                            <div style={styles.tableWrap}>
                                <table className="cl-table" style={styles.table}>
                                    <colgroup>
                                        {isSelectMode && selectableVisibleIds.length > 0 && (
                                            <col style={{ width: "36px" }} />
                                        )}
                                        <col style={{ width: "22%" }} />
                                        <col style={{ width: "11%" }} />
                                        <col style={{ width: "13%" }} />
                                        <col style={{ width: "11%" }} />
                                        <col style={{ width: "13%" }} />
                                        <col style={{ width: "9%" }} />
                                        <col style={{ width: "13%" }} />
                                        <col style={{ width: "8%" }} />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            {isSelectMode && selectableVisibleIds.length > 0 && (
                                                <th style={{ ...styles.th, width: 36 }}>
                                                    <input
                                                        type="checkbox"
                                                        aria-label="Select all"
                                                        checked={allVisibleSelected}
                                                        onChange={() =>
                                                            toggleSelectAllVisible(
                                                                selectableVisibleIds
                                                            )
                                                        }
                                                    />
                                                </th>
                                            )}
                                            <th style={styles.th}>Employee</th>
                                            <th style={styles.th}>Emp Code</th>
                                            <th style={styles.th}>Department</th>
                                            <th style={styles.th}>Team</th>
                                            <th style={styles.th}>Role</th>
                                            <th style={styles.th}>Status</th>
                                            <th style={styles.th}>Email</th>
                                            <th style={{ ...styles.th, textAlign: "left" }}>
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredEmployees.map((emp) => {
                                            const avatar = getAvatarColors(emp.name);
                                            return (
                                                <tr
                                                    key={emp.id}
                                                    className="cl-row"
                                                    style={{
                                                        ...styles.tr,
                                                        boxShadow: `inset 3px 0 0 0 ${avatar.accent}`,
                                                    }}
                                                >
                                                    {isSelectMode &&
                                                        selectableVisibleIds.length > 0 && (
                                                            <td
                                                                style={styles.td}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {canDeleteEmployee(emp) && (
                                                                    <input
                                                                        type="checkbox"
                                                                        aria-label={`Select ${emp.name}`}
                                                                        checked={selectedIds.has(
                                                                            emp.id
                                                                        )}
                                                                        onChange={() =>
                                                                            toggleSelected(emp.id)
                                                                        }
                                                                    />
                                                                )}
                                                            </td>
                                                        )}
                                                    <td style={styles.td}>
                                                        <div style={styles.tdNameCell}>
                                                            {emp.photoUrl ? (
                                                                <img
                                                                    src={emp.photoUrl}
                                                                    alt={emp.name}
                                                                    style={styles.avatarSm}
                                                                />
                                                            ) : (
                                                                <div
                                                                    style={{
                                                                        ...styles.avatarSm,
                                                                        background: avatar.bg,
                                                                        color: avatar.text,
                                                                    }}
                                                                >
                                                                    {getInitials(emp.name)}
                                                                </div>
                                                            )}
                                                            <div
                                                                style={{
                                                                    display: "flex",
                                                                    flexDirection: "column",
                                                                    minWidth: 0,
                                                                }}
                                                            >
                                                                <span style={styles.tdNameText}>
                                                                    {emp.name}
                                                                </span>
                                                                <span style={styles.tdMuted}>
                                                                    {emp.designation}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {emp.employeeCode || "—"}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {emp.department || "—"}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {emp.team || "—"}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdMuted}>
                                                            {formatRoleLabel(emp.role)}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span
                                                            style={{
                                                                ...styles.statusPillTable,
                                                                color:
                                                                    emp.status !== "Inactive"
                                                                        ? "#0f8a78"
                                                                        : "#6b7280",
                                                                background:
                                                                    emp.status !== "Inactive"
                                                                        ? "#e1f7f3"
                                                                        : "#f1f0f5",
                                                            }}
                                                        >
                                                            <span style={styles.statusDotTable} />
                                                            {emp.status}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <span style={styles.tdContactLine}>
                                                            <i
                                                                className="ti ti-mail"
                                                                style={{ fontSize: fontSize.sm }}
                                                            />
                                                            {emp.email}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        <div style={styles.tdActions}>
                                                            <button
                                                                type="button"
                                                                className="cl-view-btn"
                                                                style={styles.viewDetailsBtnTable}
                                                                onClick={() => openProfile(emp)}
                                                                title="View profile"
                                                            >
                                                                View
                                                            </button>
                                                            {canEditEmployee(emp) && (
                                                                <button
                                                                    type="button"
                                                                    className="cl-icon-btn"
                                                                    style={styles.iconBtnTable}
                                                                    aria-label={`Edit ${emp.name}`}
                                                                    title="Edit employee"
                                                                    onClick={() => handleEdit(emp)}
                                                                >
                                                                    <i
                                                                        className="ti ti-pencil"
                                                                        style={{
                                                                            fontSize: fontSize.base,
                                                                        }}
                                                                    />
                                                                </button>
                                                            )}
                                                            {canDeleteEmployee(emp) && (
                                                                <button
                                                                    type="button"
                                                                    className="cl-icon-btn-danger"
                                                                    style={
                                                                        styles.iconBtnDangerTable
                                                                    }
                                                                    aria-label={`Delete ${emp.name}`}
                                                                    title="Delete employee"
                                                                    onClick={() =>
                                                                        handleDelete(emp)
                                                                    }
                                                                >
                                                                    <i
                                                                        className="ti ti-trash"
                                                                        style={{
                                                                            fontSize: fontSize.base,
                                                                        }}
                                                                    />
                                                                </button>
                                                            )}
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
                                {filteredEmployees.map((emp, idx) => {
                                    const avatar = getAvatarColors(emp.name);
                                    return (
                                        <div
                                            key={emp.id}
                                            className="emp-card"
                                            style={{
                                                ...styles.card,
                                                position: "relative",
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
                                                        {isSelectMode && canDeleteEmployee(emp) && (
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`Select ${emp.name}`}
                                                                checked={selectedIds.has(emp.id)}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={() =>
                                                                    toggleSelected(emp.id)
                                                                }
                                                                style={styles.cardCheckboxInline}
                                                            />
                                                        )}
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

                                                        {canEditEmployee(emp) && (
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
                                                        )}

                                                        {canDeleteEmployee(emp) && (
                                                            <button
                                                                type="button"
                                                                className="emp-icon-btn-sm emp-icon-btn-sm-delete"
                                                                style={styles.deleteIconBtnSmall}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(emp);
                                                                }}
                                                                aria-label={`Delete ${emp.name}`}
                                                            >
                                                                <i className="ti ti-trash" />
                                                            </button>
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
                                                {/* Team replaces Location here per new requirement */}
                                                <div style={styles.cardInfoLine}>
                                                    <i
                                                        className="ti ti-users-group"
                                                        style={styles.cardInfoIcon}
                                                        aria-hidden="true"
                                                    />
                                                    <span style={styles.cardInfoLabel}>Team</span>
                                                    <span style={styles.cardInfoColon}>:</span>
                                                    <span style={styles.cardInfoValue}>
                                                        {emp.team || "—"}
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
                <div style={styles.drawerOverlay}>
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
                                <div style={{ ...styles.avatarWrap, flexShrink: 0 }}>
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
                                                    ? "var(--brand-green)"
                                                    : "#c2cedb",
                                        }}
                                    />
                                </div>
                                <div style={{ minWidth: 0, paddingTop: 30 }}>
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

                                        {!isEditingDrawer && canEditEmployee(selectedEmployee) && (
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

                                {/* NEW: Role — always visible, but only editable when
                                    the logged-in user is themselves a Super Admin. Ops
                                    Manager (or anyone else who reaches edit mode) sees
                                    it read-only even though they can edit every other
                                    field on this card. */}
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Role</span>
                                    {isEditingDrawer && canEditRole ? (
                                        <select
                                            className="emp-drawer-select"
                                            style={styles.detailsInput}
                                            value={drawerData.role || ""}
                                            onChange={(e) =>
                                                updateEditField("role", e.target.value)
                                            }
                                        >
                                            <option value="">Select role</option>
                                            {ROLE_OPTIONS.map((r) => (
                                                <option key={r.value} value={r.value}>
                                                    {r.label}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {formatRoleLabel(drawerData.role)}
                                        </span>
                                    )}
                                </div>

                                {/* Department — dropdown merging the curated /api/options
                                    list with whatever department values already exist on
                                    real employees (see departmentDropdownOptions above),
                                    so it's populated even before anyone's used the "+ Add"
                                    control on the Add User page. Falls back to plain text
                                    only if there are truly zero department values anywhere
                                    yet, so editing never gets blocked. */}
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Department</span>
                                    {isEditingDrawer ? (
                                        departmentDropdownOptions.length > 0 ? (
                                            <select
                                                className="emp-drawer-select"
                                                style={styles.detailsInput}
                                                value={drawerData.department || ""}
                                                onChange={(e) =>
                                                    updateEditField("department", e.target.value)
                                                }
                                            >
                                                <option value="">Select department</option>
                                                {/* Keep the existing value selectable even if
                                                    it isn't in the merged list, so saving
                                                    without touching this field never
                                                    silently blanks it out. */}
                                                {drawerData.department &&
                                                    !departmentDropdownOptions.includes(
                                                        drawerData.department
                                                    ) && (
                                                        <option value={drawerData.department}>
                                                            {drawerData.department}
                                                        </option>
                                                    )}
                                                {departmentDropdownOptions.map((d) => (
                                                    <option key={d} value={d}>
                                                        {d}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                className="emp-drawer-input"
                                                style={styles.detailsInput}
                                                value={drawerData.department}
                                                onChange={(e) =>
                                                    updateEditField("department", e.target.value)
                                                }
                                            />
                                        )
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {drawerData.department || "—"}
                                        </span>
                                    )}
                                </div>

                                {/* Team replaces Location in the drawer details too.
                                    Edit mode is now a dropdown sourced from GET
                                    /api/teams (same list used on the Products page),
                                    instead of a free-text input — falls back to a
                                    plain text input if the teams list couldn't be
                                    loaded, so editing never gets blocked. */}
                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Team</span>
                                    {isEditingDrawer ? (
                                        teamsList.length > 0 ? (
                                            <select
                                                className="emp-drawer-select"
                                                style={styles.detailsInput}
                                                value={drawerData.team || ""}
                                                onChange={(e) =>
                                                    updateEditField("team", e.target.value || null)
                                                }
                                            >
                                                <option value="">Select team</option>
                                                {teamsList.map((t) => (
                                                    <option key={t.id} value={t.name}>
                                                        {t.name}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                className="emp-drawer-input"
                                                style={styles.detailsInput}
                                                value={drawerData.team || ""}
                                                onChange={(e) =>
                                                    updateEditField("team", e.target.value)
                                                }
                                            />
                                        )
                                    ) : (
                                        <span style={styles.detailsValue}>
                                            {drawerData.team || "—"}
                                        </span>
                                    )}
                                </div>

                                <div style={styles.detailsRow}>
                                    <span style={styles.detailsLabel}>Reporting Manager</span>
                                    {isEditingDrawer ? (
                                        // NEW: dropdown instead of free text — sourced from
                                        // the employees already loaded on this page (no
                                        // extra fetch needed), same pattern as the Team and
                                        // Department dropdowns just above. Excludes the
                                        // employee currently being edited so nobody can be
                                        // set as their own manager. Falls back to a plain
                                        // text input if the list is empty (still loading),
                                        // so editing never gets blocked.
                                        reportingManagerOptions.length > 0 ? (
                                            <select
                                                className="emp-drawer-select"
                                                style={styles.detailsInput}
                                                value={drawerData.reportingManager || ""}
                                                onChange={(e) =>
                                                    updateEditField(
                                                        "reportingManager",
                                                        e.target.value
                                                    )
                                                }
                                            >
                                                <option value="">Select manager</option>
                                                {/* Keep the existing value selectable even if
                                                    it doesn't match any current employee
                                                    (e.g. a manager who has since left), so
                                                    saving without touching this field doesn't
                                                    silently blank it out. */}
                                                {drawerData.reportingManager &&
                                                    !reportingManagerOptions.some(
                                                        (m) =>
                                                            m.value === drawerData.reportingManager
                                                    ) && (
                                                        <option value={drawerData.reportingManager}>
                                                            {drawerData.reportingManager}
                                                        </option>
                                                    )}
                                                {reportingManagerOptions.map((m) => (
                                                    <option key={m.value} value={m.value}>
                                                        {m.label}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                className="emp-drawer-input"
                                                style={styles.detailsInput}
                                                value={drawerData.reportingManager || ""}
                                                onChange={(e) =>
                                                    updateEditField(
                                                        "reportingManager",
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        )
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
                <div style={styles.modalOverlay}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalIcon}>
                            <i className="ti ti-trash" />
                        </div>
                        <h3
                            style={{
                                margin: "0 0 6px",
                                fontSize: fontSize.xl,
                                fontWeight: fontWeight.bold,
                                color: "#16233a",
                            }}
                        >
                            Delete {employeeToDelete.name}?
                        </h3>
                        <p style={{ margin: 0, fontSize: fontSize.base, color: "#7d90a6" }}>
                            Are you sure you want to remove this employee? Once deleted, their
                            record can't be recovered.
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

            {/* Bulk delete confirmation modal */}
            {bulkDeleteOpen && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalIcon}>
                            <i className="ti ti-trash" />
                        </div>
                        <h3
                            style={{
                                margin: "0 0 6px",
                                fontSize: fontSize.xl,
                                fontWeight: fontWeight.bold,
                                color: "#16233a",
                            }}
                        >
                            Delete {selectedIds.size} employee
                            {selectedIds.size > 1 ? "s" : ""}?
                        </h3>
                        <p style={{ margin: 0, fontSize: fontSize.base, color: "#7d90a6" }}>
                            Are you sure you want to remove {selectedIds.size} selected employee
                            {selectedIds.size > 1 ? "s" : ""}? Once deleted, their records can't be
                            recovered.
                        </p>
                        {bulkDeleteError && (
                            <p
                                style={{
                                    margin: "10px 0 0",
                                    fontSize: fontSize.sm,
                                    color: "#b91c1c",
                                    whiteSpace: "pre-line",
                                    textAlign: "left",
                                }}
                            >
                                {bulkDeleteError}
                            </p>
                        )}
                        <div style={styles.modalButtons}>
                            <button
                                type="button"
                                style={styles.cancelButton}
                                onClick={closeBulkDeleteConfirm}
                                disabled={bulkDeleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={{
                                    ...styles.deleteButton,
                                    opacity: bulkDeleting ? 0.7 : 1,
                                    cursor: bulkDeleting ? "not-allowed" : "pointer",
                                }}
                                onClick={handleBulkDeleteConfirm}
                                disabled={bulkDeleting}
                            >
                                {bulkDeleting ? "Deleting..." : `Delete ${selectedIds.size}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Decorative footer wave — same treatment as Production Reports:
                visible only when there's no data to show, hidden as soon as
                the list/grid has rows to fill the space instead. */}
            {!loading && !error && filteredEmployees.length === 0 && (
                <svg
                    style={styles.wave}
                    viewBox="0 0 1440 160"
                    preserveAspectRatio="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M0,96 C240,32 480,144 720,96 C960,48 1200,128 1440,80 L1440,160 L0,160 Z"
                        fill="url(#emp-waveGradient)"
                        opacity="0.35"
                    />
                    <path
                        d="M0,128 C240,80 480,160 720,120 C960,80 1200,150 1440,110 L1440,160 L0,160 Z"
                        fill="url(#emp-waveGradient)"
                    />
                    <defs>
                        <linearGradient id="emp-waveGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="var(--brand-blue)" />
                            <stop offset="100%" stopColor="var(--brand-light-blue)" />
                        </linearGradient>
                    </defs>
                </svg>
            )}
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    // NEW: multi-select bulk-delete bar + card checkbox.
    bulkBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
        background: "#FEF2F2",
        border: "1px solid #FECACA",
        borderRadius: 10,
        padding: "10px 16px",
        margin: "10px 0 0",
    },
    bulkBarText: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#991B1B",
    },
    bulkBarClearBtn: {
        background: "#fff",
        color: "#6b7280",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "7px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },
    bulkBarDeleteBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#DC2626",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "7px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    cardCheckboxInline: {
        width: 15,
        height: 15,
        cursor: "pointer",
        marginRight: 2,
    },
    root: {
        display: "flex",
        width: "100%",
        // Was 100vh, which is the FULL device viewport — but this root
        // renders inside AppLayout's <main>, which only gets the leftover
        // space below the header. Claiming 100vh made the root taller
        // than the space actually visible, so the last ~header-height
        // sliver (where the empty-state footer wave sits) needed a
        // scroll to reach even when nothing was really overflowing.
        // 100% fits exactly inside <main> instead.
        height: "100%",
        flex: 1,
        minHeight: 0,
        background: "#eff4fa",
        fontFamily: fontFamily.base,
        position: "relative",
        overflow: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100%",
        minHeight: 0,
        width: "100%",
        background: "#eff4fa",
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
    mobileTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: "#16233a" },

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
        position: "relative",
        zIndex: 1,
    },
    contentColMobile: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        position: "relative",
        zIndex: 1,
    },
    // Decorative footer wave — only rendered when the list is empty (see
    // JSX), so it doesn't compete with a populated table/grid for space.
    wave: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: 140,
        zIndex: 0,
        pointerEvents: "none",
    },
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
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "left",
    },
    pageTitleCount: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: "#7d90a6" },
    headerSubtext: {
        margin: "4px 0 0",
        fontSize: fontSize.base,
        color: "#767F92",
        textAlign: "left",
    },

    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(var(--brand-blue-rgb),.06)",
        border: "1px solid #dfeaf5",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(var(--brand-blue-rgb),.06)",
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
        borderRadius: radius.md,
        padding: "9px 12px",
        transition: "border-color .15s ease, box-shadow .15s ease",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.base,
        color: "#16233a",
        width: "100%",
    },
    clearBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: radius.circle,
        border: "none",
        background: "#f1eefc",
        color: "#6f8299",
        fontSize: fontSize.xxs,
        cursor: "pointer",
        flexShrink: 0,
    },
    filterSelect: {
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: radius.md,
        padding: "9px 12px",
        fontSize: fontSize.base,
        color: "#374a63",
        outline: "none",
        cursor: "pointer",
        minWidth: 130,
        transition: "border-color .15s ease",
    },

    viewToggle: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fafbfc",
        border: "1px solid #dbe6f0",
        borderRadius: radius.md,
        padding: 4,
        flexShrink: 0,
    },
    // NEW: "Select" toggle button — switches bulk-select mode on/off so the
    // per-row/card checkboxes aren't shown all the time by default.
    selectModeBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fafbfc",
        border: "1px solid #dbe6f0",
        borderRadius: radius.md,
        padding: "8px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#3b4a63",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    selectModeBtnActive: {
        background: "#e7ecf8",
        color: "var(--brand-blue)",
        border: "1px solid var(--brand-blue)",
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
        color: "#7d90a6",
        cursor: "pointer",
    },
    viewToggleBtnActive: {
        background: "#e7ecf8",
        color: "var(--brand-blue)",
    },

    scrollArea: { flex: 1, minHeight: 0 },

    // ---- Table (list view) — mirrors the Clients/Products table styling
    // so switching between admin pages stays visually aligned. ----
    tableWrap: {
        background: "#fff",
        border: "1px solid #dfeaf5",
        borderRadius: radius.lg,
        boxShadow: "0 4px 16px rgba(var(--brand-blue-rgb),.06)",
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
        borderBottom: "2px solid #dfeaf5",
        background: "linear-gradient(180deg, #f3f7fd, #eef3fb)",
        position: "sticky",
        top: 0,
        zIndex: 1,
    },
    tr: {
        borderBottom: "1px solid #eef3f8",
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
        objectFit: "cover",
        border: "2px solid #fff",
        boxShadow: "0 0 0 1px #e5edf7",
    },
    tdNameText: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
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
    statusPillTable: {
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
    statusDotTable: {
        width: 6,
        height: 6,
        borderRadius: radius.circle,
        background: "currentColor",
        flexShrink: 0,
    },
    viewDetailsBtnTable: {
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
    iconBtnTable: {
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
    iconBtnDangerTable: {
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
        borderRadius: radius.circle,
        background: "#e9f5fa",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
    emptyTitle: {
        margin: 0,
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#233245",
    },
    emptyText: { margin: 0, fontSize: fontSize.base, color: "#7d90a6", maxWidth: 320 },
    retryBtn: {
        marginTop: 10,
        border: "1px solid #b9d9ec",
        background: "#fff",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        borderRadius: radius.sm,
        padding: "7px 14px",
        cursor: "pointer",
    },

    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #e7edf5",
        borderTop: "3px solid transparent",
        borderRadius: radius.lg,
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
        borderRadius: radius.lg,
        padding: 16,
        gap: 8,
    },
    skeletonAvatar: {
        width: 44,
        height: 44,
        borderRadius: radius.circle,
        background: "#dee9f4",
        flexShrink: 0,
    },
    skeletonLineWide: {
        height: 10,
        borderRadius: radius.xs,
        background: "#dee9f4",
        width: "85%",
        marginBottom: 8,
    },
    skeletonLineNarrow: {
        height: 10,
        borderRadius: radius.xs,
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
        borderRadius: radius.circle,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    avatarImg: {
        width: 38,
        height: 38,
        borderRadius: radius.circle,
        objectFit: "cover",
        flexShrink: 0,
    },
    statusDot: {
        position: "absolute",
        bottom: 1,
        right: 1,
        width: 11,
        height: 11,
        borderRadius: radius.circle,
        border: "2px solid #fff",
    },
    statusDotLarge: {
        position: "absolute",
        bottom: 3,
        right: 3,
        width: 14,
        height: 14,
        borderRadius: radius.circle,
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
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
        textAlign: "left",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    cardDesignation: {
        fontSize: fontSize.sm,
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
        borderRadius: radius.sm,
        border: "none",
        background: "transparent",
        color: "#9bb0c2",
        cursor: "pointer",
        fontSize: fontSize.base,
        transition: "background .15s ease, color .15s ease",
    },
    editIconBtnSmall: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: radius.sm,
        border: "none",
        background: "#eef1fb",
        color: "#4a5fc7",
        cursor: "pointer",
        fontSize: fontSize.sm,
        transition: "filter .15s ease",
    },
    deleteIconBtnSmall: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: radius.sm,
        border: "none",
        background: "#fdeaea",
        color: "#dc2626",
        cursor: "pointer",
        fontSize: fontSize.sm,
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
        fontSize: fontSize.sm,
        color: "#9bb0c2",
        flexShrink: 0,
        position: "relative",
        top: 1,
    },
    cardInfoLabel: {
        fontSize: fontSize.sm,
        color: "#8496ab",
        fontWeight: fontWeight.medium,
        letterSpacing: 0.2,
        flexShrink: 0,
    },
    cardInfoColon: {
        fontSize: fontSize.sm,
        color: "#b7c3d1",
        fontWeight: fontWeight.medium,
        flexShrink: 0,
    },
    cardInfoValue: {
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#16233a",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
    },

    statLabel: { fontSize: fontSize.xs, color: "#7d90a6" },
    statValue: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
        maxWidth: 120,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    resultsCount: {
        fontSize: fontSize.sm,
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
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
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
        borderRadius: radius.circle,
        width: 28,
        height: 28,
        fontSize: fontSize.md,
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
        position: "relative",
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
        borderRadius: radius.circle,
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
        border: "4px solid #fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    },
    drawerAvatarImg: {
        width: 64,
        height: 64,
        borderRadius: radius.circle,
        objectFit: "cover",
        flexShrink: 0,
        border: "4px solid #fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    },
    drawerName: {
        margin: "10px 0 2px",
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.bold,
        color: "#16233a",
    },
    drawerDesignation: { margin: "0 0 8px", fontSize: fontSize.base, color: "#7d90a6" },
    statusPill: {
        display: "inline-block",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        borderRadius: radius.pill,
        padding: "3px 10px",
    },
    drawerEditBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
        background: "#eef1fb",
        border: "none",
        borderRadius: radius.sm,
        padding: "5px 10px",
        cursor: "pointer",
    },
    drawerInput: {
        width: "100%",
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: radius.sm,
        padding: "6px 9px",
        fontSize: fontSize.base,
        color: "#16233a",
        boxSizing: "border-box",
        textAlign: "left",
    },
    drawerStatusSelect: {
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: radius.sm,
        padding: "5px 9px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
        cursor: "pointer",
    },

    drawerStatsRow: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#faf9ff",
        border: "1px solid #dfeaf5",
        borderRadius: radius.md,
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
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
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
    detailsLabel: {
        fontSize: fontSize.sm,
        color: "#7d90a6",
        fontWeight: fontWeight.medium,
        flexShrink: 0,
    },
    detailsValue: {
        fontSize: fontSize.base,
        color: "#16233a",
        fontWeight: fontWeight.medium,
        textAlign: "right",
    },
    detailsInput: {
        flex: 1,
        maxWidth: 220,
        border: "1px solid #dbe6f0",
        background: "#f7fafc",
        borderRadius: radius.sm,
        padding: "6px 9px",
        fontSize: fontSize.base,
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
        borderRadius: radius.sm,
        cursor: "pointer",
        background: "var(--brand-blue)",
        color: "#fff",
        fontWeight: fontWeight.medium,
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
        borderRadius: radius.lg,
        padding: 30,
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,.2)",
    },

    modalIcon: {
        width: 70,
        height: 70,
        margin: "0 auto 15px",
        borderRadius: radius.circle,
        background: "#FEE2E2",
        color: "#DC2626",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontSize: fontSize["7xl"],
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
        borderRadius: radius.sm,
        cursor: "pointer",
        background: "#E5E7EB",
        fontWeight: fontWeight.medium,
    },

    deleteButton: {
        padding: "10px 22px",
        border: "none",
        borderRadius: radius.sm,
        cursor: "pointer",
        background: "#DC2626",
        color: "#fff",
        fontWeight: fontWeight.medium,
    },
};
