import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/header";
import Sidebar from "./components/sidebar";

// FIX (loading time): every page below was imported eagerly, so a user
// landing on /login downloaded the JS for every admin page too —
// including recharts (ReportDashboard) and xlsx (AddUser/Clients/
// Employees bulk-upload), none of which they need yet. React.lazy()
// splits each into its own chunk that only downloads when that route
// is actually visited. This is the single biggest first-load win
// available without touching the backend or the tech stack at all.
const Login = lazy(() => import("./pages/auth/login"));
const Landing = lazy(() => import("./pages/public/landing"));
const ForgotPassword = lazy(() => import("./pages/auth/forgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/resetPassword"));
const ReportDashboard = lazy(() => import("./pages/admin/reportdashboard"));
const Dashboard = lazy(() => import("./pages/admin/dashboard"));
const Products = lazy(() => import("./pages/admin/products"));
const AddUser = lazy(() => import("./pages/admin/adduser"));
const Clients = lazy(() => import("./pages/admin/clients"));
const Employees = lazy(() => import("./pages/admin/employees"));
const WorkInProgress = lazy(() => import("./pages/workinprogress"));
//import VoiceAssistant from "./components/voiceAssistant";

const PrivateRoute = ({ children, requiredRole = null }) => {
    const token = localStorage.getItem("accessToken");
    const user = JSON.parse(localStorage.getItem("user") || "null");
    if (!token) return <Navigate to="/login" replace />;

    // FIX: requiredRole can now be a single role (string) or a list of
    // allowed roles (array) — needed since Quality Scores allows both    // ADMIN and MANAGER, not just one role.
    if (requiredRole) {
        const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!allowedRoles.includes(user?.role)) {
            // FIX: was checking for "EMPLOYEE"/"MANAGER" — those roles no
            // longer exist after migrating to the 6-tier system, so these
            // fallbacks never matched and everyone got bounced to /login.
            if (user?.role === "TEAM_MEMBER") return <Navigate to="/report" replace />;
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

    const handleLogout = () => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("user");
        window.location.href = "/login";
    };

    return (
        <BrowserRouter>
            <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
                <Routes>
                    <Route path="/login" element={<Login />} />

                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    <Route
                        path="/reportdashboard"
                        element={
                            <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <ReportDashboard user={user} onLogout={handleLogout} />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    <Route
                        path="/clients"
                        element={
                            <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <Clients user={user} onLogout={handleLogout} />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    <Route
                        path="/report"
                        element={
                            <PrivateRoute>
                                <AppLayout onLogout={handleLogout}>
                                    <ReportDashboard user={user} onLogout={handleLogout} />
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
                            <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <AddUser />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    {/* NEW: Billing — Admin only */}
                    <Route
                        path="/billing"
                        element={
                            <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    {/* NEW: Quality Scores — Admin and Manager only */}
                    <Route
                        path="/quality-scores"
                        element={
                            <PrivateRoute requiredRole={ADMIN_AND_VERTICAL_HEAD_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    <Route
                        path="/workinprogress"
                        element={
                            <PrivateRoute>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />

                    {/* FIX: sidebar.tsx links to /admin, /history, /profile, and
                    /tasks, but none of these had a matching route or page
                    component — clicking them dead-ended. None of these
                    pages are built yet, so point them at the existing
                    WorkInProgress placeholder for now instead of leaving a
                    broken link; swap in the real page component as each
                    one gets built. */}
                    <Route
                        path="/admin"
                        element={
                            <PrivateRoute requiredRole={ADMIN_TIER_ROLES}>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/history"
                        element={
                            <PrivateRoute>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/profile"
                        element={
                            <PrivateRoute>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
                                </AppLayout>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/tasks"
                        element={
                            <PrivateRoute>
                                <AppLayout onLogout={handleLogout}>
                                    <WorkInProgress />
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

                    <Route path="/" element={<Landing />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
