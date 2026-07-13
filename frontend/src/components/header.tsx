import { useState, useEffect } from "react";
import type { CSSProperties } from "react";

interface HeaderProps {
    userName?: string;
    logoSrc?: string;
    onRefresh?: () => void;
    onHelp?: () => void;
    onNotificationsClick?: () => void;
    onProfileClick?: () => void;
}

const MOBILE_BREAKPOINT = 768;
const SMALL_MOBILE_BREAKPOINT = 400;

function useBreakpoint() {
    const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return {
        isMobile: width < MOBILE_BREAKPOINT,
        isSmallMobile: width < SMALL_MOBILE_BREAKPOINT,
    };
}

export default function Header({
    userName,
    onRefresh,
    onHelp,
    onNotificationsClick,
    onProfileClick,
}: HeaderProps) {
    const { isMobile, isSmallMobile } = useBreakpoint();

    return (
        <header style={isMobile ? styles.headerMobile : styles.header}>
            {/* LEFT */}
            <div style={isMobile ? styles.leftMobile : styles.left}>
                {/* Logo */}
                <div style={styles.logoBlock}>
                    <img
                        src="/logo.png"
                        alt="Logo"
                        style={{
                            width: isMobile ? 26 : 38,
                            height: isMobile ? 26 : 38,
                            objectFit: "contain",
                            flexShrink: 0,
                        }}
                    />
                    <div style={{ minWidth: 0 }}>
                        <div style={isMobile ? styles.brandNameMobile : styles.brandName}>
                            Alokate
                        </div>
                        {!isSmallMobile && (
                            <div style={isMobile ? styles.brandSubMobile : styles.brandSub}>
                                Workforce Platform
                            </div>
                        )}
                    </div>
                </div>

                {/* Welcome */}
                {!isMobile && (
                    <div style={styles.welcomeBlock}>
                        <span style={styles.welcome}>
                            Welcome, <strong>{userName || "Administrator"}</strong>
                        </span>
                        <span style={styles.dot} />
                    </div>
                )}
            </div>

            {/* RIGHT */}
            <div style={isMobile ? styles.rightMobile : styles.right}>
                {!isSmallMobile && (
                    <>
                        <button style={styles.iconBtn} onClick={onHelp} aria-label="Help">
                            <i className="ti ti-question-mark" />
                        </button>
                        <button
                            style={styles.iconBtn}
                            onClick={onNotificationsClick}
                            aria-label="Notifications"
                        >
                            <i className="ti ti-bell" />
                        </button>
                    </>
                )}

                {!isMobile && (
                    <div style={styles.avatarNameOnly} onClick={onProfileClick}>
                        {userName || "Administrator"}
                    </div>
                )}

                <button
                    style={isMobile ? styles.refreshBtnMobile : styles.refreshBtn}
                    onClick={onRefresh}
                    aria-label="Refresh"
                >
                    {isMobile ? "↻" : "Refresh"}
                </button>
            </div>
        </header>
    );
}

const styles: Record<string, CSSProperties> = {
    header: {
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 28px",
        height: "64px",
        flexShrink: 0,
        borderBottom: "1px solid #eee",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        gap: 16,
    },
    headerMobile: {
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        minHeight: "56px",
        borderBottom: "1px solid #eee",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        gap: "8px",
    },

    left: { display: "flex", alignItems: "center", gap: 28, minWidth: 0, flex: 1 },
    leftMobile: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },

    logoBlock: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        flexShrink: 1,
    },
    brandName: {
        fontSize: 18,
        fontWeight: 800,
        color: "#1F1D4D",
        lineHeight: 1,
        whiteSpace: "nowrap",
    },
    brandNameMobile: {
        fontSize: 14,
        fontWeight: 800,
        color: "#1F1D4D",
        lineHeight: 1,
        whiteSpace: "nowrap",
    },
    brandSub: { fontSize: 11, color: "#8A8FA8", marginTop: 2, whiteSpace: "nowrap" },
    brandSubMobile: { fontSize: 9, color: "#8A8FA8", marginTop: 1, whiteSpace: "nowrap" },

    welcomeBlock: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        overflow: "hidden",
    },
    welcome: {
        fontSize: "14px",
        color: "#1e1b3a",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    dot: { width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 },

    right: { display: "flex", alignItems: "center", gap: "14px", flexShrink: 0 },
    rightMobile: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 },

    iconBtn: {
        width: "30px",
        height: "30px",
        borderRadius: "50%",
        border: "1px solid #e5e0ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#7c3aed",
        background: "#faf9ff",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
    },

    avatarNameOnly: {
        fontSize: 13,
        fontWeight: 700,
        color: "#1e1b3a",
        cursor: "pointer",
        whiteSpace: "nowrap",
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    refreshBtn: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        padding: "8px 16px",
        fontSize: "12px",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    refreshBtnMobile: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: "50%",
        width: "30px",
        height: "30px",
        fontSize: "15px",
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        flexShrink: 0,
    },
};
