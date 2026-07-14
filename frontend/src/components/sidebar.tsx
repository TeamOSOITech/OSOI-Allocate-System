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
    {
        label: "Today's Task",
        icon: "ti ti-clipboard-list",
        path: "/tasks",
        roles: ["EMPLOYEE", "MANAGER", "ADMIN"],
    },
    {
        label: "Clients Preview",
        icon: "ti ti-users",
        path: "/clients",
        roles: ["MANAGER", "ADMIN"],
    },
    { label: "View Employee", icon: "ti ti-eye", path: "/employees", roles: ["MANAGER", "ADMIN"] },
    {
        label: "Task Progress",
        icon: "ti ti-file-description",
        path: "/task-progress",
        roles: ["EMPLOYEE", "MANAGER", "ADMIN"],
    },
    {
        label: "Report",
        icon: "ti ti-chart-line",
        path: "/report",
        roles: ["EMPLOYEE", "MANAGER", "ADMIN"],
    },
    {
        label: "History",
        icon: "ti ti-history",
        path: "/history",
        roles: ["EMPLOYEE", "MANAGER", "ADMIN"],
    },
    { label: "Admin", icon: "ti ti-user", path: "/admin", roles: ["ADMIN"] },
    { label: "Billing", icon: "ti ti-receipt", path: "/billing", roles: ["ADMIN"] },
    {
        label: "Quality Scores",
        icon: "ti ti-star",
        path: "/quality-scores",
        roles: ["ADMIN", "MANAGER"],
    },
    {
        label: "Profile",
        icon: "ti ti-settings",
        path: "/profile",
        roles: ["EMPLOYEE", "MANAGER", "ADMIN"],
    },
];

const pathToLabel: Record<string, string> = {
    "/tasks": "Today's Task",
    "/task-progress": "Task Progress",
    "/dashboard": "Task Progress",
    "/report": "Report",
    "/reportdashboard": "Report",
    "/clients": "Clients Preview",
    "/employees": "View Employee",
    "/admin/add-user": "Add User",
    "/history": "History",
    "/admin": "Admin",
    "/billing": "Billing",
    "/quality-scores": "Quality Scores",
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
    const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

    const normalizedPath =
        location.pathname.length > 1 && location.pathname.endsWith("/")
            ? location.pathname.slice(0, -1)
            : location.pathname;
    const activeLabel = pathToLabel[normalizedPath] || "";

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
        } else if (item.label === "Clients Preview") {
            navigate("/clients");
        } else if (item.label === "Task Progress") {
            navigate("/dashboard");
        } else if (item.label === "Report") {
            navigate("/report");
        } else if (item.label === "Billing") {
            navigate("/billing");
        } else if (item.label === "Quality Scores") {
            navigate("/quality-scores");
        } else {
            navigate("/workinprogress");
        }
    };

    return (
        <aside
            style={{
                width: "220px",
                background: "#fff",
                padding: "20px 14px",
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                position: "relative",
                borderRight: "1px solid #eee",
                overflowY: "auto",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
        >
            {/* Logo */}

            {visibleItems.map((item) => {
                const isToday = item.label === "Today's Task";
                const isActive = activeLabel === item.label;
                const isHovered = hoveredLabel === item.label;

                return (
                    <div
                        key={item.label}
                        onClick={() => handleClick(item)}
                        onMouseEnter={() => setHoveredLabel(item.label)}
                        onMouseLeave={() => setHoveredLabel(null)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: isToday ? "space-between" : "flex-start",
                            gap: "10px",
                            background: isActive
                                ? "linear-gradient(135deg, #8b5cf6, #6d28d9)"
                                : isHovered
                                  ? "#ede9fe"
                                  : "transparent",
                            color: isActive ? "#fff" : isHovered ? "#6d28d9" : "#6b6280",
                            borderRadius: "20px",
                            padding: "10px 14px",
                            fontSize: "13px",
                            fontWeight: isActive ? 700 : 500,
                            cursor: "pointer",
                            boxShadow: isActive ? "0 4px 12px rgba(124,58,237,0.35)" : "none",
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
                                            background: isActive ? "#fff" : "#d6362e",
                                            flexShrink: 0,
                                        }}
                                    />
                                    <span>{item.label}</span>
                                </div>
                                <i
                                    className="ti ti-alert-triangle"
                                    style={{
                                        fontSize: "15px",
                                        color: isActive ? "#fff" : "#f59e0b",
                                    }}
                                    aria-hidden="true"
                                />
                            </>
                        ) : (
                            <>
                                <i
                                    className={item.icon}
                                    style={{
                                        fontSize: "15px",
                                        color: isActive
                                            ? "#fff"
                                            : isHovered
                                              ? "#6d28d9"
                                              : "#6b6280",
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
                    background: "transparent",
                    color: "#6b6280",
                    borderRadius: "20px",
                    padding: "10px 14px",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: "pointer",
                    marginTop: 6,
                }}
            >
                <i
                    className="ti ti-logout-2"
                    style={{ fontSize: "15px", color: "#6b6280" }}
                    aria-hidden="true"
                />
                Sign off
            </div>

            {/* Decorative plant illustration */}
            <svg
                width="130"
                height="120"
                viewBox="0 0 100 90"
                style={{
                    marginTop: "auto",
                    alignSelf: "flex-end",
                    opacity: 0.95,
                    pointerEvents: "none",
                    flexShrink: 0,
                }}
            >
                <ellipse cx="50" cy="82" rx="38" ry="6" fill="#ede9fe" />
                <rect x="30" y="55" width="40" height="30" rx="6" fill="#ddd6fe" />
                <path d="M50 55 C 30 40, 30 15, 50 5 C 70 15, 70 40, 50 55 Z" fill="#c4b5fd" />
                <path d="M50 55 C 38 45, 38 25, 50 15 C 62 25, 62 45, 50 55 Z" fill="#a78bfa" />
            </svg>
        </aside>
    );
};

export default Sidebar;
