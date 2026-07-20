import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/auth/login";
import ForgotPassword from "./pages/auth/forgotPassword";
import ResetPassword from "./pages/auth/resetPassword";
import ReportDashboard from "./pages/admin/reportdashboard";
import Dashboard from "./pages/admin/dashboard";
import Header from "./components/header";
import Sidebar from "./components/sidebar";
import AddUser from "./pages/admin/adduser";
import Clients from "./pages/admin/clients";
import Employees from "./pages/admin/employees";
import WorkInProgress from "./pages/workinprogress";
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
            if (user?.role === "EMPLOYEE") return <Navigate to="/report" replace />;
            if (user?.role === "MANAGER") return <Navigate to="/workinprogress" replace />;
            return <Navigate to="/login" replace />;
        }
    }
    return children;
};

const AppLayout = ({ children, onLogout }) => {
    const handleRefresh = () => window.location.reload();
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return (
        // Outer shell locked to exactly the viewport height, with overflow
        // hidden — the shell itself can NEVER scroll, no matter what.
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
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
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                <Route
                    path="/reportdashboard"
                    element={
                        <PrivateRoute requiredRole="ADMIN">
                            <AppLayout onLogout={handleLogout}>
                                <ReportDashboard user={user} onLogout={handleLogout} />
                            </AppLayout>
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/clients"
                    element={
                        <PrivateRoute requiredRole="ADMIN">
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
                        <PrivateRoute requiredRole="ADMIN">
                            <AppLayout onLogout={handleLogout}>
                                <Dashboard user={user} onLogout={handleLogout} />
                            </AppLayout>
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/admin/add-user"
                    element={
                        <PrivateRoute requiredRole="ADMIN">
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
                        <PrivateRoute requiredRole="ADMIN">
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
                        <PrivateRoute requiredRole={["ADMIN", "MANAGER"]}>
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

                <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
