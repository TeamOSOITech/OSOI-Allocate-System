import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme, THEMES } from "../context/themecontext";
import type { ThemeName } from "../context/themecontext";

interface HeaderProps {
    userName?: string;
    photoUrl?: string | null;
    logoSrc?: string;
    onRefresh?: () => void;
    onHelp?: () => void;
    onNotificationsClick?: () => void;
    onProfileClick?: () => void; // called when "My Profile" is chosen from the menu
    onChangePassword?: () => void;
    onLogout?: () => void;
    notificationCount?: number;
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

function getInitials(name: string) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Header({
    userName,
    photoUrl,
    onRefresh,
    onHelp,
    onNotificationsClick,
    onProfileClick,
    onChangePassword,
    onLogout,
    notificationCount = 0,
}: HeaderProps) {
    const { isMobile, isSmallMobile } = useBreakpoint();
    const { colors: BRAND, themeName, setThemeName } = useTheme();
    const navigate = useNavigate();
    const displayName = userName || "Administrator";
    const firstName = displayName.split(" ")[0];

    const [menuOpen, setMenuOpen] = useState(false);
    // Only "theme" is left as a sub-panel now — Display mode was removed,
    // so this no longer needs to track a "display" state.
    const [subPanel, setSubPanel] = useState<"none" | "theme">("none");
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
                setSubPanel("none");
            }
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setMenuOpen(false);
                setSubPanel("none");
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onClickOutside);
            document.removeEventListener("keydown", onEsc);
        };
    }, [menuOpen]);

    const closeMenu = () => {
        setMenuOpen(false);
        setSubPanel("none");
    };

    const styles = getStyles(BRAND);

    return (
        <header style={isMobile ? styles.headerMobile : styles.header}>
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
                            borderRadius: radius.sm,
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
                        <i className="ti ti-bell" style={{ fontSize: fontSize.lg }} />
                        {notificationCount > 0 && (
                            <span style={styles.notifDot} aria-hidden="true" />
                        )}
                    </button>
                )}

                {/* Avatar + dropdown menu */}
                <div style={{ position: "relative" }} ref={menuRef}>
                    <button
                        style={isMobile ? styles.avatarMobile : styles.avatar}
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label="Profile menu"
                        aria-expanded={menuOpen}
                        title={displayName}
                        type="button"
                    >
                        {photoUrl ? (
                            <img src={photoUrl} alt={displayName} style={styles.avatarImg} />
                        ) : (
                            getInitials(displayName)
                        )}
                    </button>

                    {menuOpen && (
                        <div style={styles.menu}>
                            {subPanel === "none" && (
                                <>
                                    {/* My Profile — navigates to /profile directly.
                                    Still calls onProfileClick too, in case a
                                    parent wants to react to it as well. */}
                                    <MenuItem
                                        icon="ti-user"
                                        label="My Profile"
                                        styles={styles}
                                        onClick={() => {
                                            closeMenu();
                                            navigate("/profile");
                                            onProfileClick?.();
                                        }}
                                    />
                                    <MenuItem
                                        icon="ti-palette"
                                        label="Theme color"
                                        chevron
                                        styles={styles}
                                        onClick={() => setSubPanel("theme")}
                                    />
                                    {/* Change password — opens the existing
                                    /reset-password route in a new tab, rather
                                    than navigating away from whatever the
                                    person was doing. */}
                                    <MenuItem
                                        icon="ti-key"
                                        label="Change password"
                                        styles={styles}
                                        onClick={() => {
                                            closeMenu();
                                            window.open(
                                                "/reset-password",
                                                "_blank",
                                                "noopener,noreferrer"
                                            );
                                            onChangePassword?.();
                                        }}
                                    />
                                    <div style={styles.menuDivider} />
                                    <MenuItem
                                        icon="ti-logout"
                                        label="Logout"
                                        danger
                                        styles={styles}
                                        onClick={() => {
                                            closeMenu();
                                            onLogout?.();
                                        }}
                                    />
                                </>
                            )}

                            {subPanel === "theme" && (
                                <>
                                    <button
                                        style={styles.menuBackRow}
                                        onClick={() => setSubPanel("none")}
                                        type="button"
                                    >
                                        <i className="ti ti-chevron-left" /> Theme color
                                    </button>
                                    <div style={styles.swatchGrid}>
                                        {(Object.keys(THEMES) as ThemeName[]).map((key) => {
                                            const palette = THEMES[key];
                                            const active = themeName === key;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    title={palette.label}
                                                    onClick={() => {
                                                        setThemeName(key);
                                                        closeMenu();
                                                    }}
                                                    style={{
                                                        ...styles.swatchBtn,
                                                        background: `linear-gradient(135deg, ${palette.lightBlue}, ${palette.blue})`,
                                                        boxShadow: active
                                                            ? `0 0 0 2px #fff, 0 0 0 4px ${palette.blue}`
                                                            : "none",
                                                    }}
                                                >
                                                    {active && (
                                                        <i
                                                            className="ti ti-check"
                                                            style={{ color: "#fff", fontSize: 14 }}
                                                        />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div style={styles.swatchLabels}>
                                        {(Object.keys(THEMES) as ThemeName[]).map((key) => (
                                            <span key={key} style={styles.swatchLabel}>
                                                {THEMES[key].label}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

/* ---------------------------------------------------------------------- */
/*  Menu row subcomponent                                                   */
/* ---------------------------------------------------------------------- */

function MenuItem({
    icon,
    label,
    onClick,
    styles,
    chevron,
    danger,
    check,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    styles: Record<string, CSSProperties>;
    chevron?: boolean;
    danger?: boolean;
    check?: boolean;
}) {
    return (
        <button
            type="button"
            style={danger ? styles.menuItemDanger : styles.menuItem}
            onClick={onClick}
        >
            <i className={`ti ${icon}`} style={{ fontSize: 16 }} />
            <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
            {check && <i className="ti ti-check" style={{ fontSize: 15 }} />}
            {chevron && (
                <i className="ti ti-chevron-right" style={{ fontSize: 14, opacity: 0.5 }} />
            )}
        </button>
    );
}

/* ---------------------------------------------------------------------- */
/*  Styles — built per-render from the active theme palette                */
/* ---------------------------------------------------------------------- */

function getStyles(BRAND: {
    blue: string;
    lightBlue: string;
    green: string;
}): Record<string, CSSProperties> {
    return {
        header: {
            position: "relative",
            background: `linear-gradient(90deg, ${BRAND.blue} 0%, ${BRAND.lightBlue} 55%, ${BRAND.green} 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            height: "64px",
            flexShrink: 0,
            fontFamily: fontFamily.base,
            gap: 16,
        },
        headerMobile: {
            position: "relative",
            background: `linear-gradient(90deg, ${BRAND.blue} 0%, ${BRAND.lightBlue} 55%, ${BRAND.green} 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px 8px 60px",
            minHeight: "56px",
            fontFamily: fontFamily.base,
            gap: "8px",
        },

        left: { display: "flex", alignItems: "center", gap: 20, minWidth: 0, flex: 1 },
        leftMobile: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },

        logoBlock: { display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexShrink: 0 },

        welcomeBlock: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            overflow: "hidden",
            paddingLeft: 20,
            borderLeft: "1px solid rgba(255,255,255,0.3)",
        },
        welcome: {
            fontSize: fontSize.md,
            color: "rgba(255,255,255,0.85)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        welcomeName: { color: "#ffffff" },
        welcomeMobile: {
            fontSize: fontSize.sm,
            color: "rgba(255,255,255,0.9)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
        },
        dot: {
            width: 6,
            height: 6,
            borderRadius: radius.circle,
            background: "#ffffff",
            flexShrink: 0,
        },

        right: { display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
        rightMobile: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 },

        iconBtn: {
            position: "relative",
            width: "34px",
            height: "34px",
            borderRadius: radius.md,
            border: "1px solid rgba(255,255,255,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            background: "rgba(255,255,255,0.14)",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            fontSize: fontSize.lg,
            transition: "background .15s ease, border-color .15s ease, transform .15s ease",
        },
        iconBtnSmall: {
            position: "relative",
            width: "28px",
            height: "28px",
            borderRadius: radius.sm,
            border: "1px solid rgba(255,255,255,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            background: "rgba(255,255,255,0.14)",
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
            borderRadius: radius.sm,
            background: BRAND.green,
            color: "#fff",
            fontSize: fontSize.badge,
            fontWeight: fontWeight.bold,
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
            borderRadius: radius.circle,
            background: BRAND.green,
            border: "2px solid #fff",
        },

        avatar: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            borderRadius: radius.circle,
            border: "2px solid rgba(255,255,255,0.6)",
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.bold,
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
            overflow: "hidden",
        },
        avatarImg: {
            width: "100%",
            height: "100%",
            borderRadius: radius.circle,
            objectFit: "cover",
        },
        avatarMobile: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: radius.circle,
            border: "2px solid rgba(255,255,255,0.6)",
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.bold,
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
            overflow: "hidden",
        },

        /* ---- Dropdown menu ---- */
        menu: {
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: 240,
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 12px 32px rgba(16,24,40,0.14)",
            border: "1px solid #eef1f7",
            padding: 6,
            zIndex: 1000,
        },
        menuItem: {
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "transparent",
            border: "none",
            borderRadius: radius.md,
            padding: "10px 10px",
            fontSize: 13.5,
            color: "#16233c",
            cursor: "pointer",
            textAlign: "left",
        },
        menuItemDanger: {
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "transparent",
            border: "none",
            borderRadius: radius.md,
            padding: "10px 10px",
            fontSize: 13.5,
            color: "#DC2626",
            cursor: "pointer",
            textAlign: "left",
        },
        menuDivider: { height: 1, background: "#eef1f7", margin: "6px 4px" },
        menuBackRow: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            background: "transparent",
            border: "none",
            padding: "8px 10px",
            fontSize: 12.5,
            fontWeight: fontWeight.semibold,
            color: "#5a6c85",
            cursor: "pointer",
            textAlign: "left",
            marginBottom: 4,
        },

        swatchGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            padding: "4px 10px 2px",
        },
        swatchBtn: {
            width: 36,
            height: 36,
            borderRadius: radius.circle,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        swatchLabels: {
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            padding: "4px 10px 6px",
        },
        swatchLabel: {
            fontSize: 10,
            color: "#5a6c85",
            textAlign: "center",
        },
    };
}
