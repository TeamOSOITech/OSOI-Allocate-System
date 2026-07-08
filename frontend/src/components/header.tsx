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

export default function Header({
  userName,
  logoSrc,
  onRefresh,
  onHelp,
  onNotificationsClick,
  onProfileClick,
}: HeaderProps) {
  const isMobile = useIsMobile();

  return (
    <header style={isMobile ? styles.headerMobile : styles.header}>
      <div style={styles.left}>
        <div style={isMobile ? styles.logoMobile : styles.logo}>
          {logoSrc ? (
            <img src={logoSrc} alt="Company logo" style={styles.logoImg} />
          ) : (
            <span style={isMobile ? styles.logoFallbackMobile : styles.logoFallback}>
              LOGO
            </span>
          )}
        </div>
        {!isMobile && (
          <>
            <span style={styles.welcome}>
              Welcome,{userName ? ` ${userName}` : ""}
            </span>
            <span style={styles.emoji} aria-hidden="true">🎉</span>
          </>
        )}
        {isMobile && (
          <span style={styles.welcomeMobile}>
            Welcome{userName ? `, ${userName}` : ""}
          </span>
        )}
      </div>

      <div style={isMobile ? styles.rightMobile : styles.right}>
        <button style={styles.iconBtn} aria-label="Help" onClick={onHelp}>
          <i className="ti ti-question-mark" style={{ fontSize: isMobile ? 13 : 15 }} aria-hidden="true" />
        </button>

        <button style={styles.bellBtn} aria-label="Notifications" onClick={onNotificationsClick}>
          <i className="ti ti-bell" style={{ fontSize: isMobile ? 16 : 18 }} aria-hidden="true" />
        </button>

        <button
          style={isMobile ? styles.avatarBtnMobile : styles.avatarBtn}
          aria-label="User profile"
          onClick={onProfileClick}
        />

        <button style={isMobile ? styles.refreshBtnMobile : styles.refreshBtn} onClick={onRefresh}>
          {isMobile ? "↻" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    background: "#d9d9d9",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 18px",
    height: "64px",
    flexShrink: 0,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  headerMobile: {
    background: "#d9d9d9",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 12px",
    height: "52px",
    flexShrink: 0,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  left: { display: "flex", alignItems: "center", gap: "10px" },
  logo: {
    width: "48px",
    height: "48px",
    borderRadius: "6px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  logoMobile: {
    width: "34px",
    height: "34px",
    borderRadius: "6px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  logoImg: { width: "100%", height: "100%", objectFit: "contain" },
  logoFallback: { fontWeight: 700, color: "#1a1a2e", fontSize: "11px" },
  logoFallbackMobile: { fontWeight: 700, color: "#1a1a2e", fontSize: "9px" },
  welcome: { fontSize: "15px", fontWeight: 700, color: "#1a1a2e" },
  welcomeMobile: { fontSize: "13px", fontWeight: 700, color: "#1a1a2e" },
  emoji: { fontSize: "16px" },
  right: { display: "flex", alignItems: "center", gap: "16px" },
  rightMobile: { display: "flex", alignItems: "center", gap: "10px" },
  iconBtn: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: "1.5px solid #a32d2d",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#a32d2d",
    background: "transparent",
    cursor: "pointer",
    padding: 0,
  },
  bellBtn: {
    border: "none",
    background: "transparent",
    color: "#a32d2d",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    padding: 0,
  },
  avatarBtn: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    background: "#e8e15a",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  avatarBtnMobile: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    background: "#e8e15a",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  refreshBtn: {
    background: "#a32d2d",
    color: "#fff",
    border: "none",
    borderRadius: "3px",
    padding: "5px 12px",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
  },
  refreshBtnMobile: {
    background: "#a32d2d",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: "28px",
    height: "28px",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
};
