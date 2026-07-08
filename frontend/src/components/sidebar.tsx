import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

type MenuItem = {
  label: string;
  icon: string;
  path: string;
  roles: string[];
};

const menuItems: MenuItem[] = [
  { label: "Add User", icon: "ti ti-user-plus", path: "/admin/add-user", roles: ["ADMIN"] },
  { label: "Today's Task", icon: "ti ti-clipboard-list", path: "/tasks", roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { label: "Team Preview", icon: "ti ti-users", path: "/team", roles: ["MANAGER", "ADMIN"] },
  { label: "View Employee", icon: "ti ti-eye", path: "/employees", roles: ["MANAGER", "ADMIN"] },
  { label: "Task Progress", icon: "ti ti-file-description", path: "/task-progress", roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { label: "Report", icon: "ti ti-chart-line", path: "/report", roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { label: "History", icon: "ti ti-history", path: "/history", roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { label: "Admin", icon: "ti ti-user", path: "/admin", roles: ["ADMIN"] },
  { label: "Profile", icon: "ti ti-settings", path: "/profile", roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
];

// Map route path → sidebar label
const pathToLabel: Record<string, string> = {
  "/tasks": "Today's Task",
  "/task-progress": "Task Progress",
  "/dashboard": "Task Progress",
  "/report": "Report",
  "/reportdashboard": "Report",
  "/team": "Team Preview",
  "/employees": "View Employee",
 "/admin/add-user": "Add User",
  "/history": "History",
  "/admin": "Admin",
  "/profile": "Profile",
};

interface SidebarProps {
  active?: string;
  setActive?: (label: string) => void;
  onLogout?: () => void;
}

const Sidebar = ({ onLogout }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active label from current URL — always in sync
  const activeLabel = pathToLabel[location.pathname] || "";

  const userStr = localStorage.getItem("user");
  const user = userStr ? JSON.parse(userStr) : null;
  const role = user?.role || "EMPLOYEE";

  const visibleItems = menuItems.filter((item) => item.roles.includes(role));

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      localStorage.clear();
      window.location.href = "/login";
    }
  };

const handleClick = (item: MenuItem) => {
  if (item.label === "Add User") {
    navigate("/admin/add-user");
  } else if (item.label === "Task Progress") {
    navigate("/dashboard");
  } else if (item.label === "Report") {
    navigate("/report");
  } else {
    navigate("/workinprogress");
  }
};

  return (
    <aside
      style={{
        width: "210px",
        background: "#e7e7e7",
        padding: "18px 12px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {visibleItems.map((item) => {
        const isToday = item.label === "Today's Task";
        const isActive = activeLabel === item.label;

        return (
          <div
            key={item.label}
            onClick={() => handleClick(item)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: isToday ? "space-between" : "flex-start",
              gap: "10px",

              background: isActive ? "#f4a93c" : "#fff",
              color: isActive ? "#3a2200" : "#3b3b8f",

              borderRadius: "24px",
              padding: "11px 18px",
              fontSize: "13px",
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              border: isActive && !isToday ? "1.5px solid #FAC775" : "1.5px solid transparent",
              transition: "all 0.15s",
            }}
          >
            {isToday ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#d6362e",
                      flexShrink: 0,
                    }}
                  />
                  <span>{item.label}</span>
                </div>
                <i
                  className="ti ti-alert-triangle"
                  style={{ fontSize: "15px", color: "#3a2200" }}
                  aria-hidden="true"
                />
              </>
            ) : (
              <>
                <i
                  className={item.icon}
                  style={{
                    fontSize: "16px",
                    color: isActive ? "#854F0B" : "#3b3b8f",
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </>
            )}
          </div>
        );
      })}

      {/* Sign off */}
      <div
        onClick={handleLogout}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "#fff",
          color: "#3b3b8f",
          borderRadius: "24px",
          padding: "11px 18px",
          fontSize: "13px",
          fontWeight: 500,
          cursor: "pointer",
          border: "1.5px solid transparent",
          transition: "all 0.15s",
        }}
      >
        <i className="ti ti-logout-2" style={{ fontSize: "16px", color: "#3b3b8f" }} aria-hidden="true" />
        Sign off
      </div>
    </aside>
  );
};

export default Sidebar;
