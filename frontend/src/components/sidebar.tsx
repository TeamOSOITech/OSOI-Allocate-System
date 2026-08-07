import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

type MenuItem = {
    label: string;
    icon: string;
    path: string;
    roles: string[];
};

// Role groups replacing the old ADMIN/MANAGER/EMPLOYEE checks — mirrors
// ADMIN_TIER_ROLES / ADMIN_AND_VERTICAL_HEAD_ROLES in App.jsx and the
// permission matrix in the backend's src/config/permissions.js.
const ADMIN_TIER = ["SUPER_ADMIN", "OPS_MANAGER", "AUDIT_MANAGER", "PROCESS_LEAD"];
const ADMIN_AND_VERTICAL_HEAD = [...ADMIN_TIER, "VERTICAL_HEAD"];
const EVERYONE = [...ADMIN_AND_VERTICAL_HEAD, "TEAM_MEMBER"];
// NEW: Super-Admin-only tabs — Dashboard, Daily Work, Today's Allocation,
// Production Reports, History, Billing, Quality Scores, and Profile are
// now restricted to SUPER_ADMIN alone (previously visible to some mix of
// ADMIN_TIER / ADMIN_AND_VERTICAL_HEAD / EVERYONE).
const SUPER_ADMIN_ONLY = ["SUPER_ADMIN"];

const menuItems: MenuItem[] = [
    // /dashboard route is gated to ADMIN_TIER_ROLES in App.jsx, so this
    // link uses the same role list to avoid showing it to someone who'd
    // just hit a 403 clicking through.
    {
        label: "Dashboard",
        icon: "ti ti-layout-dashboard",
        path: "/dashboard",
        roles: SUPER_ADMIN_ONLY,
    },
    // Role-based access Phase 1: Normal User's own landing page. Points
    // at /report (open to any logged-in user, no requiredRole in
    // App.jsx) rather than /dashboard, which is the admin-tier metrics
    // dashboard. Shown only to TEAM_MEMBER — admin-tier roles already
    // have "Dashboard" above.
    {
        label: "User Dashboard",
        icon: "ti ti-smart-home",
        path: "/report",
        roles: ["TEAM_MEMBER"],
    },
    // Matches backend's "users.onboard" permission exactly (SUPER_ADMIN +
    // PROCESS_LEAD only) — see backend src/config/permissions.js. Was
    // previously shown to the full ADMIN_TIER group, so Ops Manager/Audit
    // Manager saw this link, clicked through, and hit a confusing 403.
    {
        label: "Add User",
        icon: "ti ti-user-plus",
        path: "/admin/add-user",
        roles: ["SUPER_ADMIN", "PROCESS_LEAD"],
    },
    {
        label: "Services",
        icon: "ti ti-package",
        path: "/products",
        // Role-based access Phase 2: Normal User now sees this again,
        // alongside admin-tier + Vertical Head.
        roles: [...ADMIN_AND_VERTICAL_HEAD, "TEAM_MEMBER"],
    },
    {
        label: "Clients Preview",
        icon: "ti ti-users",
        path: "/clients",
        roles: [...ADMIN_AND_VERTICAL_HEAD, "TEAM_MEMBER"],
    },
    {
        label: "Employee Preview",
        icon: "ti ti-eye",
        path: "/employees",
        roles: [...ADMIN_AND_VERTICAL_HEAD, "TEAM_MEMBER"],
    },
    {
        label: "Daily Work",
        icon: "ti ti-clipboard-plus",
        path: "/daily-work",
        roles: SUPER_ADMIN_ONLY,
    },
    // REMOVED: standalone Attendance nav link — leave-marking now lives
    // inline inside Manual/Smart Allocation instead of a separate page.

    {
        label: "Today's Allocation",
        icon: "ti ti-hand-stop",
        path: "/today's-allocation",
        roles: SUPER_ADMIN_ONLY,
    },
    {
        label: "Production Reports",
        icon: "ti ti-file-analytics",
        path: "/production-reports",
        roles: SUPER_ADMIN_ONLY,
    },
    {
        label: "History",
        icon: "ti ti-history",
        path: "/history",
        roles: SUPER_ADMIN_ONLY,
    },
    { label: "Billing", icon: "ti ti-receipt", path: "/billing", roles: SUPER_ADMIN_ONLY },
    {
        label: "Quality Scores",
        icon: "ti ti-star",
        path: "/quality-scores",
        roles: SUPER_ADMIN_ONLY,
    },
    {
        label: "Profile",
        icon: "ti ti-settings",
        path: "/profile",
        roles: SUPER_ADMIN_ONLY,
    },
];

const pathToLabel: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/report": "User Dashboard",
    "/products": "Services",
    "/daily-work": "Daily Work",
    "/production-reports": "Production Reports",
    "/today's-allocation": "Today's Allocation",
    "/clients": "Clients Preview",
    "/employees": "Employee Preview",
    "/admin/add-user": "Add User",
    "/history": "History",
    "/billing": "Billing",
    "/quality-scores": "Quality Scores",
    "/profile": "Profile",
};

// ---- Brand palette ----
const COLORS = {
    blue: "#204297", // primary
    lightBlue: "#08A1CE", // secondary / accent
    green: "#2EBBA8", // accent / status
    blueTint: "#EAF0FB", // light tint of primary blue, used for hover backgrounds
};

const SIDEBAR_WIDTH = 176;
// Slightly wider on mobile so it's comfortable to tap as a drawer.
const SIDEBAR_WIDTH_MOBILE = 220;
// Below this viewport width, the sidebar becomes an off-canvas drawer
// instead of a permanent flex column. Kept in one place so the inline
// styles and the injected <style> media queries below never drift apart.
const MOBILE_BREAKPOINT = 768;

interface SidebarProps {
    active?: string;
    setActive?: (label: string) => void;
    onLogout?: () => void;
}

const Sidebar = ({ onLogout }: SidebarProps) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
    // Only matters below MOBILE_BREAKPOINT — on desktop the CSS below
    // ignores this entirely and the sidebar stays permanently visible,
    // exactly like before.
    const [isOpen, setIsOpen] = useState(false);

    const normalizedPath =
        location.pathname.length > 1 && location.pathname.endsWith("/")
            ? location.pathname.slice(0, -1)
            : location.pathname;
    const activeLabel = pathToLabel[normalizedPath] || "";

    const userStr = localStorage.getItem("user");
    const user = userStr ? JSON.parse(userStr) : null;
    const role = user?.role || "TEAM_MEMBER";

    const visibleItems = menuItems.filter((item) => item.roles.includes(role));

    const handleLogout = () => {
        setIsOpen(false);
        if (onLogout) {
            onLogout();
        } else {
            localStorage.clear();
            window.location.href = "/login";
        }
    };

    const handleClick = (item: MenuItem) => {
        // Close the drawer on mobile after navigating — nobody wants it
        // still hanging open over the page they just chose.
        setIsOpen(false);
        navigate(item.path);
    };

    return (
        <>
            {/*
              Mobile-only styling lives in a real CSS media query rather than
              a JS resize listener. That means: no flash-of-wrong-layout on
              first paint, no listener to leak/clean up, and it keeps working
              correctly through devtools rotation / resizing without a
              re-render being triggered by React state.

              Desktop (min-width) rules explicitly re-hide the toggle/overlay
              in case this component is ever server-rendered or the class
              names briefly apply before layout settles.
            */}
            <style>{`
                .app-sidebar-toggle {
                    display: none;
                }
                .app-sidebar-overlay {
                    display: none;
                }
                @media (max-width: ${MOBILE_BREAKPOINT}px) {
                    .app-sidebar {
                        position: fixed !important;
                        top: 0;
                        left: 0;
                        height: 100dvh !important;
                        width: ${SIDEBAR_WIDTH_MOBILE}px !important;
                        transform: translateX(-100%);
                        transition: transform 0.22s ease;
                        z-index: 1000;
                        box-shadow: 2px 0 16px rgba(0,0,0,0.18);
                    }
                    .app-sidebar.open {
                        transform: translateX(0);
                    }
                    .app-sidebar-toggle {
                        display: flex;
                    }
                    .app-sidebar-overlay.open {
                        display: block;
                    }
                }
            `}</style>

            {/* Hamburger toggle — only rendered visibly on mobile via CSS above.
                Fixed so it stays reachable regardless of scroll position. */}
            <button
                className="app-sidebar-toggle"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-label={isOpen ? "Close menu" : "Open menu"}
                aria-expanded={isOpen}
                style={{
                    position: "fixed",
                    top: "14px",
                    left: "14px",
                    zIndex: 1100,
                    width: "38px",
                    height: "38px",
                    borderRadius: radius.md,
                    border: "none",
                    background: COLORS.blue,
                    color: "#fff",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                }}
            >
                <i
                    className={isOpen ? "ti ti-x" : "ti ti-menu-2"}
                    style={{ fontSize: fontSize["2xl"] }}
                    aria-hidden="true"
                />
            </button>

            {/* Backdrop — click-away to close. Only shown (via CSS) on mobile
                while the drawer is open. */}
            <div
                className={`app-sidebar-overlay${isOpen ? " open" : ""}`}
                onClick={() => setIsOpen(false)}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.4)",
                    zIndex: 999,
                }}
            />

            <aside
                className={`app-sidebar${isOpen ? " open" : ""}`}
                style={{
                    width: `${SIDEBAR_WIDTH}px`,
                    background: "#fff",
                    padding: "20px 14px",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    borderRight: "1px solid #eee",
                    overflow: "hidden",
                    flexShrink: 0,
                    fontFamily: fontFamily.base,
                }}
            >
                {/* Logo */}

                {/* Nav items wrapper: clips instead of scrolling if content overflows */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        overflow: "hidden",
                        minHeight: 0,
                    }}
                >
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
                                        ? `linear-gradient(135deg, ${COLORS.lightBlue}, ${COLORS.blue})`
                                        : isHovered
                                          ? COLORS.blueTint
                                          : "transparent",
                                    color: isActive ? "#fff" : isHovered ? COLORS.blue : "#6b6280",
                                    borderRadius: radius.xl,
                                    padding: "10px 14px",
                                    fontSize: fontSize.base,
                                    fontWeight: isActive ? fontWeight.semibold : fontWeight.regular,
                                    cursor: "pointer",
                                    boxShadow: isActive
                                        ? `0 4px 12px rgba(32,66,151,0.35)`
                                        : "none",
                                    transition: "all 0.15s",
                                    flexShrink: 0,
                                }}
                            >
                                {isToday ? (
                                    <>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: "8px",
                                                    height: "8px",
                                                    borderRadius: radius.circle,
                                                    background: isActive ? "#fff" : COLORS.green,
                                                    flexShrink: 0,
                                                }}
                                            />
                                            <span>{item.label}</span>
                                        </div>
                                        <i
                                            className="ti ti-alert-triangle"
                                            style={{
                                                fontSize: fontSize.lg,
                                                color: isActive ? "#fff" : COLORS.lightBlue,
                                            }}
                                            aria-hidden="true"
                                        />
                                    </>
                                ) : (
                                    <>
                                        <i
                                            className={item.icon}
                                            style={{
                                                fontSize: fontSize.lg,
                                                color: isActive
                                                    ? "#fff"
                                                    : isHovered
                                                      ? COLORS.blue
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
                </div>

                {/* Sign off */}
                <div
                    onClick={handleLogout}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        background: "transparent",
                        color: "#6b6280",
                        borderRadius: radius.xl,
                        padding: "10px 14px",
                        fontSize: fontSize.base,
                        fontWeight: fontWeight.regular,
                        cursor: "pointer",
                        marginTop: 6,
                        flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = COLORS.blueTint;
                        e.currentTarget.style.color = COLORS.blue;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "#6b6280";
                    }}
                >
                    <i
                        className="ti ti-logout-2"
                        style={{ fontSize: fontSize.lg, color: "inherit" }}
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
                        marginTop: "12px",
                        alignSelf: "flex-end",
                        opacity: 0.95,
                        pointerEvents: "none",
                        flexShrink: 0,
                    }}
                >
                    <ellipse cx="50" cy="82" rx="38" ry="6" fill={COLORS.blueTint} />
                    <rect x="30" y="55" width="40" height="30" rx="6" fill={COLORS.lightBlue} />
                    <path
                        d="M50 55 C 30 40, 30 15, 50 5 C 70 15, 70 40, 50 55 Z"
                        fill={COLORS.green}
                    />
                    <path
                        d="M50 55 C 38 45, 38 25, 50 15 C 62 25, 62 45, 50 55 Z"
                        fill={COLORS.blue}
                    />
                </svg>
            </aside>
        </>
    );
};

export default Sidebar;

/*
Usage: wrap routed page content in Layout.tsx (provided alongside this file):

  <Layout>
    <YourRoutedPageContent />
  </Layout>

Layout.tsx locks the OUTER shell to exactly 100vh with overflow: hidden, so
the shell itself can never scroll. Sidebar is a plain flex child (no fixed/
sticky) on desktop, so it can't be knocked out of place by an ancestor's
transform/filter/will-change. Only the <main> content pane has
overflowY: auto, so it scrolls independently and only shows a scrollbar when
its content overflows.

RESPONSIVE BEHAVIOR: below 768px viewport width, the sidebar switches
to an off-canvas drawer:
  - A fixed hamburger button (top-left) toggles it open/closed.
  - The <aside> becomes position: fixed and slides in/out via transform.
  - A semi-transparent backdrop appears behind it; clicking the backdrop,
    clicking a nav item, or logging out all close the drawer.
  - Desktop layout (>= 768px) is completely unchanged from before.
*/
