import { useState, useEffect } from "react";
import type { CSSProperties } from "react";

interface HeaderProps {
    userName?: string;
    logoSrc?: string;
    onRefresh?: () => void;
    onHelp?: () => void;
    onNotificationsClick?: () => void;
    onProfileClick?: () => void;
    notificationCount?: number;
}

const MOBILE_BREAKPOINT = 768;
const SMALL_MOBILE_BREAKPOINT = 400;

// ---- Brand palette ----
const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
};

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

function getInitials(name: string) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Header({
    userName,
    onRefresh,
    onHelp,
    onNotificationsClick,
    onProfileClick,
    notificationCount = 0,
}: HeaderProps) {
    const { isMobile, isSmallMobile } = useBreakpoint();
    const displayName = userName || "Administrator";
    const firstName = displayName.split(" ")[0];

    return (
        <header style={isMobile ? styles.headerMobile : styles.header}>
            {/* Signature: a thin three-color brand rail along the bottom edge —
                the one deliberate accent, everything else stays quiet. */}
            <div style={styles.brandRail} />

            {/* LEFT */}
            <div style={isMobile ? styles.leftMobile : styles.left}>
                <div style={styles.logoBlock}>
                    <img
                        src="/Logo.jpg"
                        alt="Logo"
                        style={{
                            width: isMobile ? 30 : 125,
                            height: isMobile ? 30 : 125,
                            objectFit: "contain",
                            borderRadius: 8,
                            flexShrink: 0,
                        }}
                    />
                </div>

                {!isMobile && (
                    <div style={styles.welcomeBlock}>
                        <span style={styles.welcome}>
                            Welcome back, <strong style={styles.welcomeName}>{displayName}</strong>
                        </span>
                        <span style={styles.dot} aria-hidden="true" />
                    </div>
                )}

                {isMobile && (
                    <span style={styles.welcomeMobile}>
                        Hi, <strong>{firstName}</strong>
                    </span>
                )}
            </div>

            {/* RIGHT */}
            <div style={isMobile ? styles.rightMobile : styles.right}>
                {!isSmallMobile && (
                    <>
                        <button
                            style={styles.iconBtn}
                            onClick={onHelp}
                            aria-label="Help"
                            title="Help"
                        >
                            <i className="ti ti-question-mark" />
                        </button>
                        <button
                            style={styles.iconBtn}
                            onClick={onNotificationsClick}
                            aria-label="Notifications"
                            title="Notifications"
                        >
                            <i className="ti ti-bell" />
                            {notificationCount > 0 && (
                                <span style={styles.notifBadge}>
                                    {notificationCount > 9 ? "9+" : notificationCount}
                                </span>
                            )}
                        </button>
                    </>
                )}

                {isSmallMobile && (
                    <button
                        style={styles.iconBtnSmall}
                        onClick={onNotificationsClick}
                        aria-label="Notifications"
                        title="Notifications"
                    >
                        <i className="ti ti-bell" style={{ fontSize: 15 }} />
                        {notificationCount > 0 && (
                            <span style={styles.notifDot} aria-hidden="true" />
                        )}
                    </button>
                )}

                <button
                    style={isMobile ? styles.avatarMobile : styles.avatar}
                    onClick={onProfileClick}
                    aria-label="Profile"
                    title={displayName}
                    type="button"
                >
                    {getInitials(displayName)}
                </button>
            </div>
        </header>
    );
}

const styles: Record<string, CSSProperties> = {
    header: {
        position: "relative",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 28px",
        height: "64px",
        flexShrink: 0,
        borderBottom: "1px solid #eef1f7",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        gap: 16,
    },
    headerMobile: {
        position: "relative",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        // FIX: Sidebar renders a fixed hamburger button at top:14px,
        // left:14px, 38px square. This header previously started at
        // padding-left:12px, so its logo/title sat directly under that
        // button on mobile. Left padding now clears it.
        padding: "8px 12px 8px 60px",
        minHeight: "56px",
        borderBottom: "1px solid #eef1f7",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        gap: "8px",
    },

    // The one signature flourish: a 3px gradient rail spanning all three
    // brand colors, sitting right on the header's bottom edge.
    brandRail: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 3,
        background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
    },

    left: { display: "flex", alignItems: "center", gap: 20, minWidth: 0, flex: 1 },
    leftMobile: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },

    logoBlock: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        flexShrink: 0,
    },

    welcomeBlock: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        overflow: "hidden",
        paddingLeft: 20,
        borderLeft: "1px solid #eef1f7",
    },
    welcome: {
        fontSize: 13.5,
        color: "#5a6c85",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    welcomeName: { color: "#16233c" },
    welcomeMobile: {
        fontSize: 12.5,
        color: "#5a6c85",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    dot: { width: 6, height: 6, borderRadius: "50%", background: BRAND.green, flexShrink: 0 },

    right: { display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
    rightMobile: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 },

    iconBtn: {
        position: "relative",
        width: "34px",
        height: "34px",
        borderRadius: "10px",
        border: `1px solid ${BRAND.lightBlue}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: BRAND.lightBlue,
        background: `${BRAND.lightBlue}0F`,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        fontSize: 15,
        transition: "background .15s ease, border-color .15s ease, transform .15s ease",
    },
    iconBtnSmall: {
        position: "relative",
        width: "28px",
        height: "28px",
        borderRadius: "8px",
        border: `1px solid ${BRAND.lightBlue}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: BRAND.lightBlue,
        background: `${BRAND.lightBlue}0F`,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
    },

    notifBadge: {
        position: "absolute",
        top: -4,
        right: -4,
        minWidth: 16,
        height: 16,
        padding: "0 3px",
        borderRadius: 8,
        background: BRAND.green,
        color: "#fff",
        fontSize: 9,
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "2px solid #fff",
        boxSizing: "content-box",
    },
    notifDot: {
        position: "absolute",
        top: -1,
        right: -1,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: BRAND.green,
        border: "2px solid #fff",
    },

    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: "none",
        background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
        color: "#fff",
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
        flexShrink: 0,
    },
    avatarMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "none",
        background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
        color: "#fff",
        fontSize: 10.5,
        fontWeight: 800,
        cursor: "pointer",
        flexShrink: 0,
    },

    refreshBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
        color: "#fff",
        border: "none",
        borderRadius: "10px",
        padding: "8px 16px",
        fontSize: "12px",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        boxShadow: `0 6px 14px ${BRAND.blue}29`,
    },
    refreshBtnMobile: {
        background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
        color: "#fff",
        border: "none",
        borderRadius: "50%",
        width: "30px",
        height: "30px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        flexShrink: 0,
        boxShadow: `0 4px 10px ${BRAND.blue}29`,
    },
};
