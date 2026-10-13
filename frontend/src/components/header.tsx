import { useState, useEffect, useRef } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme, THEMES } from "../context/themecontext";
import type { ThemeName } from "../context/themecontext";

interface HeaderProps {
    userName?: string;
    photoUrl?: string | null;
    logoSrc?: string;
    // Org-branded logo (falls back to the default /Alookate.png when unset).
    // canEditLogo/onLogoChange are only passed in from AppLayout on the
    // home page, and only for SUPER_ADMIN — everywhere/everyone else the
    // logo is shown but not editable.
    logoUrl?: string | null;
    canEditLogo?: boolean;
    onLogoChange?: (file: File) => void | Promise<void>;
    logoUploading?: boolean;
    onRefresh?: () => void;
    onHelp?: () => void;
    onNotificationsClick?: () => void;
    onProfileClick?: () => void; // called when "My Profile" is chosen from the menu
    onChangePassword?: () => void;
    onLogout?: () => void;
    notificationCount?: number;
}

// Small camera icon for the "change logo" overlay button — same style
// as the one used for the profile-photo editor.
function CameraIcon() {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
            <circle cx="12" cy="13" r="4" />
        </svg>
    );
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
    logoUrl,
    canEditLogo = false,
    onLogoChange,
    logoUploading = false,
    onRefresh,
    onHelp,
    onNotificationsClick,
    onProfileClick,
    onChangePassword,
    onLogout,
    notificationCount = 0,
}: HeaderProps) {
    // NOTE: isSmallMobile no longer used here — it only gated the bell
    // icon's small-screen variant, which was removed below.
    const { isMobile } = useBreakpoint();
    const { colors: BRAND, themeName, setThemeName } = useTheme();
    const navigate = useNavigate();
    // ON/OFF for the "work allocated" employee mails. Saved in
    // localStorage ("allocNotifyEnabled"); the allocation page reads the
    // same key right before it sends a mail.
    const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => {
        try {
            return localStorage.getItem("allocNotifyEnabled") !== "false";
        } catch {
            return true;
        }
    });
    const toggleNotify = () => {
        const next = !notifyEnabled;
        setNotifyEnabled(next);
        try {
            localStorage.setItem("allocNotifyEnabled", String(next));
        } catch {
            /* ignore storage errors */
        }
    };

    // Bell panel: list of recent notifications written by the allocation
    // page (localStorage "allocNotifyLog"). The red count = entries newer
    // than the last time the panel was opened ("allocNotifySeen").
    type NotifyItem = { id: number; text: string; kind: "ok" | "off" | "fail"; time: number };
    const readLog = (): NotifyItem[] => {
        try {
            const v = JSON.parse(localStorage.getItem("allocNotifyLog") || "[]");
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    };
    const readSeen = (): number => {
        try {
            return Number(localStorage.getItem("allocNotifySeen") || 0);
        } catch {
            return 0;
        }
    };
    const [notifyLog, setNotifyLog] = useState<NotifyItem[]>(readLog);
    const [notifySeen, setNotifySeen] = useState<number>(readSeen);
    const [bellOpen, setBellOpen] = useState(false);
    const bellRef = useRef<HTMLDivElement>(null);
    const unreadCount = notifyLog.filter((n) => n.time > notifySeen).length;

    useEffect(() => {
        const refresh = () => setNotifyLog(readLog());
        window.addEventListener("allocNotifyLogChanged", refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener("allocNotifyLogChanged", refresh);
            window.removeEventListener("storage", refresh);
        };
    }, []);

    const markNotifySeen = () => {
        const now = Date.now();
        setNotifySeen(now);
        try {
            localStorage.setItem("allocNotifySeen", String(now));
        } catch {
            /* ignore storage errors */
        }
    };
    const toggleBell = () => {
        setBellOpen((v) => !v);
        markNotifySeen();
    };
    const clearNotifyLog = () => {
        setNotifyLog([]);
        try {
            localStorage.removeItem("allocNotifyLog");
        } catch {
            /* ignore storage errors */
        }
    };

    useEffect(() => {
        if (!bellOpen) return;
        const onClickOutside = (e: MouseEvent) => {
            if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
                setBellOpen(false);
                markNotifySeen();
            }
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setBellOpen(false);
                markNotifySeen();
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onClickOutside);
            document.removeEventListener("keydown", onEsc);
        };
    }, [bellOpen]);

    const formatNotifyTime = (t: number) =>
        new Date(t).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        });
    const displayName = userName || "Administrator";
    const firstName = displayName.split(" ")[0];

    // Logo change (SUPER_ADMIN, home page only — gated by the canEditLogo
    // prop passed in from AppLayout, not decided here).
    const logoFileInputRef = useRef<HTMLInputElement>(null);
    const handleLogoEditClick = () => logoFileInputRef.current?.click();
    const handleLogoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onLogoChange?.(file);
        if (logoFileInputRef.current) logoFileInputRef.current.value = "";
    };

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
                <div
                    style={
                        isMobile
                            ? styles.logoBlock
                            : { ...styles.logoBlock, width: 148, justifyContent: "center" }
                    }
                >
                    {/* Wrapper only exists to anchor the edit badge — the
                    <img> itself keeps its exact same size/oval shape
                    (borderRadius) whether or not editing is available.
                    Only the `src` changes when an org logo is set. */}
                    <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                        <img
                            src="/Allookate.png"
                            alt="Logo"
                            role="link"
                            tabIndex={0}
                            title="Home"
                            onClick={() => navigate("/report")}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") navigate("/report");
                            }}
                            style={{
                                cursor: "pointer",
                                width: isMobile ? 30 : 125,
                                height: isMobile ? 9 : 38,
                                objectFit: "contain",
                                borderRadius: isMobile ? 4.5 : 19,
                                paddingLeft: 10,
                                paddingRight: 10,
                                backgroundColor: "#fff",
                                flexShrink: 0,
                                opacity: logoUploading ? 0.5 : 1,
                            }}
                        />
                        {canEditLogo && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleLogoEditClick}
                                    disabled={logoUploading}
                                    title="Change logo"
                                    aria-label="Change logo"
                                    style={styles.logoEditBtn}
                                >
                                    <CameraIcon />
                                </button>
                                <input
                                    ref={logoFileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onChange={handleLogoFileChange}
                                />
                            </>
                        )}
                    </div>
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
                {/* Notification bell: opens a panel with the recent
                    notifications and the ON/OFF switch for allocation mails */}
                <div style={{ position: "relative" }} ref={bellRef}>
                    <button
                        type="button"
                        style={{
                            ...(isMobile ? styles.iconBtnSmall : styles.iconBtn),
                            opacity: notifyEnabled ? 1 : 0.65,
                        }}
                        onClick={toggleBell}
                        aria-label="Notifications"
                        aria-expanded={bellOpen}
                        title={notifyEnabled ? "Notifications (ON)" : "Notifications (OFF)"}
                    >
                        <i className={notifyEnabled ? "ti ti-bell" : "ti ti-bell-off"} />
                        {unreadCount > 0 && (
                            <span style={styles.notifBadge}>
                                {unreadCount > 9 ? "9+" : unreadCount}
                            </span>
                        )}
                    </button>

                    {bellOpen && (
                        <div
                            style={{
                                ...styles.menu,
                                width: isMobile ? 280 : 320,
                                padding: 0,
                                overflow: "hidden",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    padding: "12px 14px",
                                    borderBottom: "1px solid #eef1f7",
                                }}
                            >
                                <div>
                                    <div
                                        style={{ fontWeight: 700, color: "#16233c", fontSize: 14 }}
                                    >
                                        Notifications
                                    </div>
                                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                                        {notifyEnabled
                                            ? "Employees get a mail when work is allocated"
                                            : "Turned OFF. No mails will be sent"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={notifyEnabled}
                                    aria-label="Turn notifications on or off"
                                    onClick={toggleNotify}
                                    style={{
                                        width: 42,
                                        height: 24,
                                        borderRadius: 999,
                                        border: "none",
                                        padding: 2,
                                        cursor: "pointer",
                                        flexShrink: 0,
                                        background: notifyEnabled ? "#2EBBA8" : "#d1d5db",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: notifyEnabled ? "flex-end" : "flex-start",
                                        transition: "background .15s",
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 20,
                                            height: 20,
                                            borderRadius: "50%",
                                            background: "#fff",
                                            boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                                        }}
                                    />
                                </button>
                            </div>

                            <div style={{ maxHeight: 280, overflowY: "auto" }}>
                                {notifyLog.length === 0 ? (
                                    <div
                                        style={{
                                            padding: "22px 14px",
                                            textAlign: "center",
                                            color: "#6b7280",
                                            fontSize: 13,
                                        }}
                                    >
                                        No notifications yet
                                    </div>
                                ) : (
                                    notifyLog.map((n) => (
                                        <div
                                            key={n.id}
                                            style={{
                                                display: "flex",
                                                gap: 10,
                                                padding: "10px 14px",
                                                borderBottom: "1px solid #f3f4f6",
                                            }}
                                        >
                                            <i
                                                className={
                                                    n.kind === "ok"
                                                        ? "ti ti-circle-check"
                                                        : n.kind === "off"
                                                          ? "ti ti-bell-off"
                                                          : "ti ti-alert-circle"
                                                }
                                                style={{
                                                    fontSize: 18,
                                                    marginTop: 1,
                                                    color:
                                                        n.kind === "ok"
                                                            ? "#2EBBA8"
                                                            : n.kind === "off"
                                                              ? "#6b7280"
                                                              : "#DC2626",
                                                }}
                                            />
                                            <div>
                                                <div style={{ fontSize: 13, color: "#16233c" }}>
                                                    {n.text}
                                                </div>
                                                <div style={{ fontSize: 11, color: "#9ca3af" }}>
                                                    {formatNotifyTime(n.time)}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {notifyLog.length > 0 && (
                                <button
                                    type="button"
                                    onClick={clearNotifyLog}
                                    style={{
                                        width: "100%",
                                        padding: "10px 14px",
                                        border: "none",
                                        borderTop: "1px solid #eef1f7",
                                        background: "#fafbfd",
                                        color: "#6b7280",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    )}
                </div>

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
                                                <div key={key} style={styles.swatchCell}>
                                                    <button
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
                                                                style={{
                                                                    color: "#fff",
                                                                    fontSize: fontSize.md,
                                                                }}
                                                            />
                                                        )}
                                                    </button>
                                                    <span style={styles.swatchLabel}>
                                                        {palette.label}
                                                    </span>
                                                </div>
                                            );
                                        })}
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
            <i className={`ti ${icon}`} style={{ fontSize: fontSize.xl }} />
            <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
            {check && <i className="ti ti-check" style={{ fontSize: fontSize.lg }} />}
            {chevron && (
                <i
                    className="ti ti-chevron-right"
                    style={{ fontSize: fontSize.md, opacity: 0.5 }}
                />
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

        logoEditBtn: {
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 20,
            height: 20,
            borderRadius: radius.circle,
            background: BRAND.blue,
            color: "#fff",
            border: "2px solid #fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
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
            fontSize: fontSize.md,
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
            fontSize: fontSize.md,
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
            fontSize: fontSize.base,
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
            padding: "4px 10px 6px",
        },
        // Each color + its name now live in the same grid cell (stacked
        // vertically), so the label is always directly under its own
        // swatch — no matter how many colors there are or how the grid
        // wraps, instead of two separate grids that could drift apart.
        swatchCell: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6 - 2,
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
        swatchLabel: {
            fontSize: fontSize.xxs,
            color: "#5a6c85",
            textAlign: "center",
        },
    };
}
