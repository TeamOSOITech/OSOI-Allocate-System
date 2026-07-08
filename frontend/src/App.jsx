import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/auth/login";
import ReportDashboard from "./pages/admin/reportdashboard";
import Dashboard from "./pages/admin/dashboard";
import Header from "./components/header";
import AddUser from "./pages/admin/adduser";
import WorkInProgress from "./pages/workinprogress";

const PrivateRoute = ({ children, requiredRole = null }) => {
  const token = localStorage.getItem("accessToken");
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if (!token) return <Navigate to="/login" replace />;
  // FIX: requiredRole is now actually enforced on the routes below.
  // Unauthorized users get bounced to their own safe default page
  // instead of falling through to the admin page they hit directly.
  if (requiredRole && user?.role !== requiredRole) {
    if (user?.role === "EMPLOYEE") return <Navigate to="/report" replace />;
    if (user?.role === "MANAGER") return <Navigate to="/workinprogress" replace />;
    return <Navigate to="/login" replace />;
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
          userName={user?.name || user?.email || ""}
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

        {/* FIX: added requiredRole="ADMIN" — this route was previously
            reachable by any logged-in user regardless of role. */}
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

        {/* Employee-facing report page — open to any authenticated user */}
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

        {/* FIX: added requiredRole="ADMIN" — this is the main Admin dashboard */}
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

        {/* FIX: added requiredRole="ADMIN" — only admins should create users */}
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

        {/* Manager placeholder landing page — open to any authenticated user */}
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