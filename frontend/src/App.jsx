import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/header";
import Sidebar from "./components/sidebar";
import { ThemeProvider } from "./context/themecontext";
import { authFetch } from "./utils/authFetch";

// FIX (loading time): every page below was imported eagerly, so a user
// landing on /login downloaded the JS for every admin page too —
// including recharts (ReportDashboard) and xlsx (AddUser/Clients/
// Employees bulk-upload), none of which they need yet. React.lazy()
// splits each into its own chunk that only downloads when that route
// is actually visited. This is the single biggest first-load win
// available without touching the backend or the tech stack at all.
const Login = lazy(() => import("./pages/auth/login"));
const Landing = lazy(() => import("./pages/public/landing"));
const Register = lazy(() => import("./pages/auth/register"));
const ForgotPassword = lazy(() => import("./pages/auth/forgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/resetPassword"));
//const ReportDashboard = lazy(() => import("./pages/admin/reportdashboard"));
const Dashboard = lazy(() => import("./pages/admin/dashboard"));
const Products = lazy(() => import("./pages/admin/products"));
const DailyWork = lazy(() => import("./pages/admin/dailywork"));
const AddUser = lazy(() => import("./pages/admin/adduser"));
const Clients = lazy(() => import("./pages/admin/clients"));
const Employees = lazy(() => import("./pages/admin/employees"));
const ManualAllocation = lazy(() => import("./pages/admin/manualallocation"));
// NEW: redesigned self-service allocation for Team Member / Vertical
// Head — same route as ManualAllocation, different component (see
// "Today's Allocation" route below, which picks between them by role).
const SelfAllocation = lazy(() => import("./pages/selfallocation"));
// Attendance is no longer a standalone page — leave-marking lives inside
// manualallocation.tsx instead.
const QC = lazy(() => import("./pages/admin/qc"));
// REMOVED: separate QcAudit page/route (pages/admin/Qcaudit.tsx, was
// "/qc-audit") — QC and Audit are now both on this same Quality Check
// page (see the QC Queue / Audit Queue toggle inside qc.tsx). The old
// file is left in place, just no longer imported/routed.
const Profile = lazy(() => import("./pages/profile"));
const ProductionReports = lazy(() => import("./pages/admin/productionreports"));
const History = lazy(() => import("./pages/admin/history"));
const Billing = lazy(() => import("./pages/admin/billing"));
//import VoiceAssistant from "./components/voiceAssistant";

// Backend base URL, same source every other page uses for API calls.
const API_URL = import.meta.env.VITE_API_URL;

// ---------------------------------------------------------------------
// ROLE-BASED ACCESS — Phase 1
// ---------------------------------------------------------------------
// Two roles are explicitly managed at this stage:
//   - Tenant / Super Admin ("SUPER_ADMIN"): full access, unrestricted —
//     already true today, since SUPER_ADMIN is included in every
//     ADMIN_TIER_ROLES / ADMIN_AND_VERTICAL_HEAD_ROLES gate below.
//   - Normal User ("TEAM_MEMBER"): capped to exactly these pages,
//     regardless of what requiredRole an individual route also declares.
// Every other existing role (OPS_MANAGER, AUDIT_MANAGER, PROCESS_LEAD,
// VERTICAL_HEAD) keeps whatever access it already had — this phase only
// tightens TEAM_MEMBER. Add more paths here as Normal User's access
// expands later; nothing else about the routing needs to change.
const NORMAL_USER_ALLOWED_PATHS = [
    "/report",
    "/history",
    "/daily-work",
    "/profile",
    // Role-based access Phase 2: Normal User can now also reach Services,
    // Clients Preview, and Employee Preview.
    "/products",
    "/clients",
    "/employees",
    // NEW: Team Member can now reach Today's Allocation — but only ever
    // sees the self-allocation view (see the route below), never the
    // admin-tier bulk allocation grid.
    "/today's-allocation",
];
const NORMAL_USER_HOME = "/report";

// COOKIE-AUTH: accessToken/refreshToken now live in httpOnly cookies the
// browser attaches automatically — this component's JS can no longer read
// them (that's the whole point of httpOnly), so "am I logged in?" can't be
// answered by checking localStorage.getItem("accessToken") anymore; that
// key is never written now and this would ALWAYS bounce straight back to
// /login even with a perfectly valid session.
//
// Instead we treat the presence of the (non-sensitive) cached `user`
// profile as the "looks logged in" signal for routing purposes only. This
// is a UX gate, not a security boundary — the real enforcement is still
// the backend rejecting requests with an invalid/missing/expired cookie
// (401), which authFetch.ts catches and redirects to /login for. A user
// who tampers with localStorage to fake a `user` object just lands on a
// page that immediately 401s on its first data fetch and gets bounced
// right back out — no protected data or action is actually reachable
// without a valid cookie.
const PrivateRoute = ({ children, requiredRole = null }) => {
    const location = useLocation();
    const user = JSON.parse(localStorage.getItem("user") || "null");
    if (!user) return <Navigate to="/login" replace />;

    // Role-based access, Phase 1: Normal User can only ever reach the
    // allow-listed paths above, full stop — checked first, before the
    // per-route requiredRole below, so a stray/incomplete requiredRole
    // list on some route can never accidentally leave a gap for this
    // role. Typing any other URL directly bounces them back to /report.
    if (user?.role === "TEAM_MEMBER" && !NORMAL_USER_ALLOWED_PATHS.includes(location.pathname)) {
        return <Navigate to={NORMAL_USER_HOME} replace />;
    }

    // FIX: requiredRole can now be a single role (string) or a list of
    // allowed roles (array) — needed since Quality Scores allows both    // ADMIN and MANAGER, not just one role.
    if (requiredRole) {
        const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!allowedRoles.includes(user?.role)) {
            // FIX: was checking for "EMPLOYEE"/"MANAGER" — those roles no
            // longer exist after migrating to the 6-tier system, so these
            // fallbacks never matched and everyone got bounced to /login.
            if (user?.role === "TEAM_MEMBER") return <Navigate to={NORMAL_USER_HOME} replace />;
            if (user?.role === "VERTICAL_HEAD") return <Navigate to="/workinprogress" replace />;
            return <Navigate to="/login" replace />;
        }
    }
    return children;
};

// Role groups replacing the old flat ADMIN/MANAGER/EMPLOYEE checks —
// see src/config/permissions.js on the backend for the canonical matrix.
// "Admin-tier" = the 4 roles that had full ADMIN-equivalent access to
// these pages before the migration to the 6-role system.
const ADMIN_TIER_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "AUDIT_MANAGER", "PROCESS_LEAD"];
const ADMIN_AND_VERTICAL_HEAD_ROLES = [...ADMIN_TIER_ROLES, "VERTICAL_HEAD"];

const AppLayout = ({ children, onLogout }) => {
    const handleRefresh = () => window.location.reload();
    const user = JSON.parse(localStorage.getItem("user") || "null");

    // The login response doesn't include a profile photo — that only
    // lives on the employee record (user_master.photo_url). Fetch it
    // once here so the header's avatar can show the logged-in user's
    // actual picture instead of always falling back to initials.
    const [photoUrl, setPhotoUrl] = useState(null);
    useEffect(() => {
        const myId = user?.id || user?.userId;
        if (!myId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/employees/${myId}`);
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) setPhotoUrl(data?.photoUrl || null);
            } catch {
                // no photo yet, or request failed — header just falls
                // back to initials, nothing further to do here.
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, user?.userId]);

    return (
        // Outer shell locked to exactly the viewport height, with overflow
        // hidden — the shell itself can NEVER scroll, no matter what.
        // Uses `dvh` (dynamic viewport height), not `vh`: on mobile, `100vh`
        // is measured as if the browser's address bar were hidden, so the
        // real available space is often a bit less — that mismatch is
        // exactly what causes a few stray pixels of whole-page scroll on
        // phones. `dvh` tracks the actual visible viewport as the address
        // bar shows/hides, so the shell height stays correct.
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100dvh",
                overflow: "hidden",
            }}
        >
            <div style={{ position: "relative", zIndex: 100, flexShrink: 0 }}>
                <Header
                    onRefresh={handleRefresh}
                    userName={
                        user?.firstName
                            ? `${user.firstName} ${user.lastName || ""}`.trim()
                            : user?.email || ""
                    }
                    photoUrl={photoUrl}
                    onLogout={onLogout}
                />
            </div>

            {/*
              NOTE: removed `transform: "translateZ(0)"` that was here before.
              A transform on an ancestor creates a new containing block for any
              `position: fixed` descendant, so fixed elements pin to THIS div
              instead of the viewport — that was the root cause of the sidebar
              appearing to scroll with the page.
            */}
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    minHeight: 0, // required so the child below can be 100% height and still scroll
                    overflow: "hidden",
                }}
            >
                {/* Sidebar now lives here ONCE, not duplicated per-page.
                    It's a plain flex child — no fixed/sticky positioning needed,
                    since this whole shell is already height-locked. */}
                <Sidebar onLogout={onLogout} />

                <main
                    style={{
                        flex: 1,
                        minWidth: 0,
                        height: "100%",
                        overflowY: "auto", // ONLY this scrolls
                        overflowX: "hidden",
                    }}
                >
                    {children}
                </main>
            </div>
        </div>
    );
};

function App() {
    const user = JSON.parse(localStorage.getItem("user") || "null");

    // COOKIE-AUTH: logging out now has to tell the SERVER to clear the
    // httpOnly accessToken/refreshToken/csrfToken cookies — clearing only
    // localStorage (as before) left those cookies alive, so the very next
    // request would still authenticate successfully against the "logged
    // out" account. Fire the backend call first (with credentials so the
    // cookies actually go along with it), then clear local state and
    // redirect regardless of whether that call succeeds — we don't want a
    // flaky network request to trap someone on a "logged in" screen they
    // explicitly asked to leave.
    const handleLogout = async () => {
        try {
            await fetch(`${API_URL}/api/auth/logout`, {
                method: "POST",
                credentials: "include",
            });
        } catch {
            // Ignore — we're logging out locally either way below.
        }
        localStorage.removeItem("user");
        window.location.href = "/login";
    };

    return (
        <ThemeProvider>
            <BrowserRouter>
                <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
                    <Routes>
                        <Route path="/login" element={<Login />} />

                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />

                        <Route
                            path="/clients"
                            element={
                                <PrivateRoute requiredRole={[...ADMIN_TIER_ROLES, "TEAM_MEMBER"]}>
                                    <AppLayout onLogout={handleLogout}>
                                        <Clients user={user} onLogout={handleLogout} />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        <Route
                            path="/dashboard"
                            element={
                                <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                    <AppLayout onLogout={handleLogout}>
                                        <Dashboard user={user} onLogout={handleLogout} />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* NEW: Daily Work — Page 2, feeds Smart Auto / Manual Allocation.
Gated the same as Clients Preview: admin-tier + Vertical Head,
since creating a batch requires tasks.allocate.team/org on the
backend anyway (Vertical Head = own team, others = org-wide).
TEAM_MEMBER (Normal User) is also allowed in as of role-based
access Phase 1 — this is their "Daily Assigned Work" page. */}
                        <Route
                            path="/daily-work"
                            element={
                                <PrivateRoute
                                    requiredRole={[...ADMIN_AND_VERTICAL_HEAD_ROLES, "TEAM_MEMBER"]}
                                >
                                    <AppLayout onLogout={handleLogout}>
                                        <DailyWork />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* "Today's Allocation" — Page 4. Same route for everyone, but a
                    different experience by role:
                      - Admin-tier (Super Admin / Ops Manager / Audit Manager /
                        Process Lead): the existing full manager view — Smart
                        Auto + Manual allocation across every employee,
                        unchanged.
                      - Team Member / Vertical Head: the redesigned
                        self-service view — they can only ever allocate
                        PENDING work to THEMSELVES, and only while pending
                        actually remains on that task (see
                        pages/selfallocation.tsx + POST /api/allocations/self
                        on the backend, which hard-codes employee_id to the
                        caller's own id regardless of anything in the
                        request body). */}
                        <Route
                            path="/today's-allocation"
                            element={
                                <PrivateRoute
                                    requiredRole={[...ADMIN_AND_VERTICAL_HEAD_ROLES, "TEAM_MEMBER"]}
                                >
                                    <AppLayout onLogout={handleLogout}>
                                        {user?.role === "TEAM_MEMBER" ||
                                        user?.role === "VERTICAL_HEAD" ? (
                                            <SelfAllocation />
                                        ) : (
                                            <ManualAllocation />
                                        )}
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* REMOVED: standalone /attendance route. Leave-marking now
                    lives inline inside Manual/Smart Allocation (manualallocation.tsx)
                    instead of a separate page — one place instead of two. */}

                        {/* NEW: Production Reports — Page 8. Open to everyone, same as
                    Report/History — read-only view over Daily Work data. */}
                        <Route
                            path="/production-reports"
                            element={
                                <PrivateRoute>
                                    <AppLayout onLogout={handleLogout}>
                                        <ProductionReports />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* NEW: Products — replaces the old Task Progress sidebar link */}
                        <Route
                            path="/products"
                            element={
                                <PrivateRoute>
                                    <AppLayout onLogout={handleLogout}>
                                        <Products user={user} onLogout={handleLogout} />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        <Route
                            path="/admin/add-user"
                            element={
                                <PrivateRoute
                                    requiredRole={["SUPER_ADMIN", "PROCESS_LEAD", "OPS_MANAGER"]}
                                >
                                    <AppLayout onLogout={handleLogout}>
                                        <AddUser />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* Billing — Admin only. Real page: client-wise
                        service pricing, read-only, sourced from GET /api/clients. */}
                        <Route
                            path="/billing"
                            element={
                                <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                    <AppLayout onLogout={handleLogout}>
                                        <Billing />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* Quality Scores — Admin and Manager only. Real QC page
                    (Page 7). */}
                        <Route
                            path="/quality-scores"
                            element={
                                <PrivateRoute requiredRole={ADMIN_AND_VERTICAL_HEAD_ROLES}>
                                    <AppLayout onLogout={handleLogout}>
                                        <QC />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        {/* REMOVED: /qc-audit route (QcAudit component) —
                    QC + Audit now both live on /quality-scores instead. */}

                        {/* REMOVED: /workinprogress, /admin, /tasks routes — they
                    pointed at pages/workinprogress.tsx, which has been
                    deleted, and none of them are linked from the sidebar
                    anymore either. /billing below still is, so that one
                    keeps a lightweight inline placeholder. History is now
                    a real page — see pages/admin/history.tsx — filterable
                    by employee/service/client/subclient/date/status,
                    backed by GET /api/allocations/history. */}
                        <Route
                            path="/history"
                            element={
                                <PrivateRoute requiredRole="SUPER_ADMIN">
                                    <AppLayout onLogout={handleLogout}>
                                        <History />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />
                        {/* Real Profile page (Page 9) — photo, role, team, department,
                    manager, today's + past allocations, and the Submit Work flow. */}
                        <Route
                            path="/profile"
                            element={
                                <PrivateRoute>
                                    <AppLayout onLogout={handleLogout}>
                                        <Profile onLogout={handleLogout} />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        <Route
                            path="/employees"
                            element={
                                <PrivateRoute>
                                    <AppLayout onLogout={handleLogout}>
                                        <Employees />
                                    </AppLayout>
                                </PrivateRoute>
                            }
                        />

                        <Route path="/register" element={<Register />} />

                        <Route path="/" element={<Landing />} />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
