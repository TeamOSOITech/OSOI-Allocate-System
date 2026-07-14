import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/auth/login";
import ForgotPassword from "./pages/auth/forgotPassword";
import ResetPassword from "./pages/auth/resetPassword";
import ReportDashboard from "./pages/admin/reportdashboard";
import Dashboard from "./pages/admin/dashboard";
import Header from "./components/header";
import AddUser from "./pages/admin/adduser";
import Clients from "./pages/admin/clients";
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
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <div style={{ position: "relative", zIndex: 100 }}>
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
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    position: "relative",
                    transform: "translateZ(0)",
                    minHeight: 0,
                }}
            >
                {children}
            </div>
            {/* 👇 Add this */}
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
                <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
