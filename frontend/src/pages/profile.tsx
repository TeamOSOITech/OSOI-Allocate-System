import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    red: "#DC2626",
};

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

type ProfileData = {
    first_name?: string;
    last_name?: string;
    email?: string;
    role?: string;
    department?: string;
    designation?: string;
    [key: string]: any;
};

interface ProfileProps {
    onLogout: () => void;
}

export default function Profile({ onLogout }: ProfileProps) {
    const isMobile = useIsMobile();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fallback to the cached login payload so the page still shows
    // something useful if GET /api/profile fails for any reason.
    const cachedUser = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();

    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/profile`);
                const json = await res.json();
                if (res.ok && json.success) {
                    setProfile(json.data);
                } else {
                    setError(json.message || "Could not load full profile");
                }
            } catch (err: any) {
                setError(err.message || "Could not load full profile");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const name =
        profile?.first_name || profile?.last_name
            ? `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim()
            : cachedUser?.firstName
              ? `${cachedUser.firstName} ${cachedUser.lastName || ""}`.trim()
              : cachedUser?.email || "User";

    const email = profile?.email || cachedUser?.email || "-";
    const role = profile?.role || cachedUser?.role || "-";
    const department = profile?.department || cachedUser?.department || "-";
    const designation = profile?.designation || cachedUser?.designation || "-";

    const initials = name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase())
        .join("");

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.header}>
                <h1 style={styles.title}>Profile</h1>
            </div>

            {error && (
                <div style={styles.noteWarning}>{error} — showing cached session info instead.</div>
            )}

            <div style={styles.card}>
                <div style={styles.avatarRow}>
                    <div style={styles.avatar}>{initials || "?"}</div>
                    <div>
                        <div style={styles.name}>{loading ? "Loading..." : name}</div>
                        <div style={styles.roleBadge}>{role}</div>
                    </div>
                </div>

                <div style={styles.infoGrid}>
                    <InfoRow label="Email" value={email} />
                    <InfoRow label="Department" value={department} />
                    <InfoRow label="Designation" value={designation} />
                </div>

                <button style={styles.logoutButton} onClick={onLogout}>
                    Logout
                </button>
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={styles.infoRow}>
            <span style={styles.infoLabel}>{label}</span>
            <span style={styles.infoValue}>{value}</span>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { padding: "28px 32px", maxWidth: 560 },
    rootMobile: { padding: "16px" },
    header: { marginBottom: 20 },
    title: { fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: 0 },
    noteWarning: {
        fontSize: 12,
        color: "#92400E",
        background: "rgba(245,158,11,0.1)",
        padding: "8px 12px",
        borderRadius: 6,
        marginBottom: 16,
    },
    card: {
        background: "#fff",
        borderRadius: 12,
        padding: 28,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    },
    avatarRow: { display: "flex", alignItems: "center", gap: 16, marginBottom: 24 },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: BRAND.blue,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 20,
        fontWeight: 700,
    },
    name: { fontSize: 17, fontWeight: 700, color: "#1a1a2e" },
    roleBadge: {
        display: "inline-block",
        marginTop: 4,
        fontSize: 11,
        fontWeight: 600,
        color: BRAND.lightBlue,
        background: "rgba(8,161,206,0.1)",
        padding: "2px 10px",
        borderRadius: 12,
    },
    infoGrid: { borderTop: "1px solid #f1f1f1" },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid #f1f1f1",
        fontSize: 13,
    },
    infoLabel: { color: "#6b7280" },
    infoValue: { color: "#1a1a2e", fontWeight: 500 },
    logoutButton: {
        marginTop: 24,
        width: "100%",
        padding: "12px",
        borderRadius: 8,
        border: `1px solid ${BRAND.red}`,
        background: "#fff",
        color: BRAND.red,
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
    },
};
