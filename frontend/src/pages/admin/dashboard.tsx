import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import Sidebar from "../../components/sidebar";
import VerticalsTab from "../../components/verticalstab";
import AdminTab from "../../components/admintab";
import TeamTab from "../../components/teamtab";

interface User {
    name: string;
    role: string;
}

interface DashboardProps {
    user: User;
    onLogout: () => void;
}

type Tab = "Verticals" | "Admin" | "Team" | "Client" | "Sub Client" | "Role";

const TABS: Tab[] = ["Verticals", "Admin", "Team", "Client", "Sub Client", "Role"];

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

export default function Dashboard({ user, onLogout }: DashboardProps) {
    const [activeNav, setActiveNav] = useState<string>("Admin");
    const [activeTab, setActiveTab] = useState<Tab>("Verticals");
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const isMobile = useIsMobile();

    const handleSetActiveNav = (label: string) => {
        setActiveNav(label);
        if (isMobile) setSidebarOpen(false);
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            {isMobile && (
                <div style={styles.mobileTopbar}>
                    <button
                        onClick={() => setSidebarOpen((v) => !v)}
                        style={styles.hamburgerBtn}
                        aria-label="Toggle menu"
                    >
                        <span style={styles.hamburgerIcon}>
                            {sidebarOpen ? "\u2715" : "\u2630"}
                        </span>
                    </button>
                    <span style={styles.mobileTitle}>CMS System</span>
                    <div style={styles.avatarSmall}>A</div>
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
                        <Sidebar
                            active={activeNav}
                            setActive={handleSetActiveNav}
                            onLogout={onLogout}
                        />
                    </div>
                </>
            ) : (
                <Sidebar active={activeNav} setActive={setActiveNav} onLogout={onLogout} />
            )}

            <div style={isMobile ? styles.mainMobile : styles.main}>
                {!isMobile && (
                    <div style={styles.header}>
                        <div>
                            <span style={styles.welcomeLabel}>Welcome,</span>{" "}
                            <span style={styles.welcomeName}>{user.name || user.role}</span>
                        </div>
                        <div style={styles.userBadge}>
                            <div style={styles.avatar}>A</div>
                            <div>
                                <div style={styles.userName}>{user.name}</div>
                                <div style={styles.userRole}>{user.role}</div>
                            </div>
                        </div>
                    </div>
                )}

                <div style={isMobile ? styles.tabBarMobile : styles.tabBar}>
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            style={{
                                ...(isMobile ? styles.tabMobile : styles.tab),
                                ...(activeTab === tab ? styles.tabActive : {}),
                            }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div style={isMobile ? styles.contentMobile : styles.content}>
                    {activeTab === "Verticals" && <VerticalsTab />}
                    {activeTab === "Admin" && <AdminTab />}
                    {activeTab === "Team" && <TeamTab />}
                    {(["Client", "Sub Client", "Role"] as Tab[]).includes(activeTab) && (
                        <div style={styles.placeholder}>
                            <div style={styles.placeholderIcon}>{"\uD83D\uDEA7"}</div>
                            <h3 style={styles.placeholderTitle}>{activeTab} Management</h3>
                            <p style={styles.placeholderText}>This section is under development.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        minHeight: "100%",
        width: "100%",
        background: "#ececec",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        width: "100%",
        background: "#ececec",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
    },
    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        position: "sticky",
        top: 0,
        zIndex: 30,
    },
    hamburgerBtn: { border: "none", background: "transparent", cursor: "pointer", padding: 4 },
    hamburgerIcon: { fontSize: 22, color: "#1a1a2e" },
    mobileTitle: { fontSize: 15, fontWeight: 700, color: "#1a1a2e" },
    avatarSmall: {
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #e53935, #c62828)",
        color: "#fff",
        fontWeight: 700,
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 },
    sidebarDrawer: {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: "240px",
        maxWidth: "80vw",
        zIndex: 50,
        transition: "transform 0.25s ease",
        boxShadow: "2px 0 12px rgba(0,0,0,0.15)",
    },
    main: {
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
    },
    mainMobile: {
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
    },

    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px",
        background: "#ececec",
        marginBottom: "12px",
    },
    welcomeLabel: { fontSize: 16, color: "#6b7280" },
    welcomeName: { fontSize: 16, fontWeight: 700, color: "#1a1a2e" },
    userBadge: { display: "flex", alignItems: "center", gap: 10 },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #e53935, #c62828)",
        color: "#fff",
        fontWeight: 700,
        fontSize: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    userName: { fontSize: 13, fontWeight: 600, color: "#1a1a2e" },
    userRole: { fontSize: 11, color: "#6b7280" },
    tabBar: {
        display: "flex",
        gap: "8px",
        padding: "0 16px 12px",
        background: "#ececec",
        borderBottom: "none",
    },
    tabBarMobile: {
        display: "flex",
        gap: "8px",
        padding: "0 16px 12px",
        background: "#ececec",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
    },
    tab: {
        padding: "10px 18px",
        border: "none",
        borderRadius: "8px",
        background: "#fff",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: 600,
        color: "#444",
        transition: "0.2s",
        whiteSpace: "nowrap",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    },
    tabMobile: {
        padding: "8px 14px",
        border: "none",
        borderRadius: 20,
        background: "#f3f4f6",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        color: "#6b7280",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    tabActive: { background: "linear-gradient(135deg, #e53935, #c62828)", color: "#fff" },
    content: { flex: 1, padding: "24px 28px", overflowY: "auto" },
    contentMobile: { flex: 1, padding: "16px", overflowY: "auto" },
    placeholder: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        gap: 12,
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
    },
    placeholderIcon: { fontSize: 48 },
    placeholderTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a2e" },
    placeholderText: { margin: 0, color: "#6b7280", fontSize: 14 },
};
