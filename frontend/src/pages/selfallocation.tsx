import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../utils/authFetch";
import { getCurrentUser } from "../utils/auth";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

function withAlpha(hex: string, alpha: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Guards against the classic "Unexpected token '<' ... not valid JSON"
// crash when a route 404s and the server sends back an HTML page
// instead of JSON.
async function safeJson(res: Response) {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(
            text.trim().startsWith("<")
                ? `Server returned an HTML page instead of data (status ${res.status}).`
                : `Unexpected response from server (status ${res.status}).`
        );
    }
    return res.json();
}

// ---- minimal inline icons (no external icon library) ----
type IconProps = { size?: number; color?: string; style?: CSSProperties };
const iconBase = (size: number) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
});
function Zap({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}
function CheckCircle2({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}

function EmptyStateIcon() {
    return (
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="28" fill={withAlpha(BRAND.blue, 0.06)} />
            <rect x="14" y="24" width="28" height="16" rx="3" fill={withAlpha(BRAND.blue, 0.12)} />
            <path
                d="M14 28h8l2 4h8l2-4h8"
                stroke={withAlpha(BRAND.blue, 0.35)}
                strokeWidth="2"
                fill="none"
            />
            <circle cx="20" cy="20" r="2" fill="#FBBF24" />
            <circle cx="38" cy="18" r="1.6" fill="#FBBF24" />
        </svg>
    );
}

// ---------------- types ----------------
type ServiceOption = {
    id: string;
    product_name: string;
    teams?: string[] | null;
};

type SelfAllocCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName?: string | null;
    subclientName?: string | null;
    workDate: string;
};

export default function SelfAllocation() {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const currentUser = getCurrentUser();
    const myId = currentUser?.id || "";

    // ---- which service(s) THIS user is aligned to. The only alignment
    // concept this app has: the employee's own team (from /api/employees/:id)
    // vs. the teams tagged on each service (service_master.teams). Loaded
    // immediately on mount — not gated behind any extra click — so the
    // page (and its Service dropdown) is ready the moment you land here. ----
    const [myTeam, setMyTeam] = useState("");
    const [services, setServices] = useState<ServiceOption[]>([]);
    const [servicesLoading, setServicesLoading] = useState(true);
    const [servicesError, setServicesError] = useState("");

    const [serviceId, setServiceId] = useState("");
    const [cases, setCases] = useState<SelfAllocCase[]>([]);
    const [casesLoading, setCasesLoading] = useState(false);
    const [casesError, setCasesError] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState("");
    const [successCount, setSuccessCount] = useState<number | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // ---- load my team + every service aligned to it, in parallel, as
    // soon as the page mounts ----
    const loadServices = useCallback(async () => {
        setServicesLoading(true);
        setServicesError("");
        try {
            const [employeeRes, productsRes] = await Promise.all([
                myId ? authFetch(`${API_BASE}/api/employees/${myId}`) : Promise.resolve(null),
                authFetch(`${API_BASE}/api/products`),
            ]);

            let team = "";
            if (employeeRes) {
                const emp = await safeJson(employeeRes);
                if (employeeRes.ok) {
                    team = ((emp as any)?.team ?? (emp as any)?.workedInTeams ?? "")
                        .toString()
                        .trim();
                }
            }
            setMyTeam(team);

            const productsJson = await safeJson(productsRes);
            if (!productsRes.ok || productsJson.success === false) {
                throw new Error(productsJson.message || "Failed to load services");
            }
            const all: ServiceOption[] = (
                Array.isArray(productsJson) ? productsJson : productsJson.data || []
            ).map((p: any) => ({
                id: String(p.id),
                product_name: p.product_name,
                teams: p.teams || [],
            }));

            const teamLower = team.toLowerCase();
            const aligned = teamLower
                ? all.filter((s) =>
                      (s.teams || []).some(
                          (t) => (t || "").toString().trim().toLowerCase() === teamLower
                      )
                  )
                : [];
            setServices(aligned);
        } catch (err: any) {
            setServicesError(err.message || "Failed to load services");
            setServices([]);
        } finally {
            setServicesLoading(false);
        }
    }, [myId]);

    useEffect(() => {
        loadServices();
    }, [loadServices]);

    // ---- once a service is picked, load every still-PENDING case on
    // it (today's, plus any earlier-dated backlog that never got taken) ----
    const loadCases = useCallback(async (pickedServiceId: string) => {
        setServiceId(pickedServiceId);
        setCases([]);
        setSelectedIds(new Set());
        setCasesError("");
        if (!pickedServiceId) return;
        setCasesLoading(true);
        try {
            const params = new URLSearchParams({
                productId: pickedServiceId,
                allocationStatus: "PENDING",
                workDate: todayStr(),
                includeBacklog: "true",
                pageSize: "500",
            });
            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to load pending cases");
            }
            setCases(json.data || []);
        } catch (err: any) {
            setCasesError(err.message || "Failed to load pending cases");
        } finally {
            setCasesLoading(false);
        }
    }, []);

    const toggleCase = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds((prev) =>
            prev.size === cases.length ? new Set() : new Set(cases.map((c) => c.id))
        );
    };

    // ---- allocate the selected case(s) to myself, then show a success
    // popup before moving on to the Profile page, where the newly
    // allocated case(s) show up under Today's Allocation ----
    const handleAllocate = async () => {
        const caseIds = Array.from(selectedIds);
        if (caseIds.length === 0) {
            showToast("Select at least one case number first.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/self-allocate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ caseIds }),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to allocate");
            }
            setSuccessCount(json.data?.allocatedCount ?? caseIds.length);
        } catch (err: any) {
            showToast(err.message || "Something went wrong");
        } finally {
            setSubmitting(false);
        }
    };

    const goToProfile = () => {
        navigate("/profile");
    };

    const allSelected = cases.length > 0 && selectedIds.size === cases.length;
    const styles = useMemo(() => getStyles(isMobile), [isMobile]);

    return (
        <div style={styles.root}>
            {/* ---- header ---- */}
            <div style={styles.headerRow}>
                <div>
                    <h2 style={styles.pageTitle}>Self Allocation</h2>
                    <p style={styles.headerSubtext}>
                        Pick a service, then pick up pending cases for yourself — only services
                        aligned to your team ({myTeam || "no team set"}) show up here.
                    </p>
                </div>
            </div>

            {servicesError && <p style={styles.errorText}>{servicesError}</p>}

            {/* ---- service select ---- */}
            <div style={styles.card}>
                <label style={styles.smallLabel}>Service</label>
                {servicesLoading ? (
                    <p style={styles.smallMuted}>Loading services…</p>
                ) : !myTeam ? (
                    <p style={styles.smallMuted}>
                        You don't have a team set on your profile, so no service can be matched to
                        you. Ask your manager to set your team.
                    </p>
                ) : services.length === 0 ? (
                    <p style={styles.smallMuted}>
                        No services are aligned to your team ({myTeam}) yet.
                    </p>
                ) : (
                    <select
                        style={styles.select}
                        value={serviceId}
                        onChange={(e) => loadCases(e.target.value)}
                    >
                        <option value="">Select a service…</option>
                        {services.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.product_name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* ---- pending cases for the picked service ---- */}
            {serviceId && (
                <div style={styles.card}>
                    {casesLoading ? (
                        <div style={styles.loadingBox}>Loading pending cases…</div>
                    ) : casesError ? (
                        <p style={styles.errorText}>{casesError}</p>
                    ) : cases.length === 0 ? (
                        <div style={styles.emptyState}>
                            <EmptyStateIcon />
                            <p style={styles.emptyTitle}>No pending cases on this service</p>
                            <p style={styles.emptySubtext}>
                                Everything on this service is already allocated — check back once
                                more cases are logged.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div style={styles.caseListHeader}>
                                <label style={styles.selectAllLabel}>
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleSelectAll}
                                    />
                                    Select all ({cases.length} pending)
                                </label>
                                <span style={styles.selectedCount}>
                                    {selectedIds.size} selected
                                </span>
                            </div>

                            <div style={styles.caseGrid}>
                                {cases.map((c) => {
                                    const checked = selectedIds.has(c.id);
                                    return (
                                        <label
                                            key={c.id}
                                            style={{
                                                ...styles.caseRow,
                                                ...(checked ? styles.caseRowChecked : {}),
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleCase(c.id)}
                                            />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <p style={styles.caseNumber}>{c.caseNumber}</p>
                                                <p style={styles.caseMeta}>
                                                    {[c.clientName, c.subclientName]
                                                        .filter(Boolean)
                                                        .join(" · ") || "—"}
                                                </p>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>

                            <button
                                type="button"
                                style={{
                                    ...styles.primaryBtn,
                                    opacity: submitting || selectedIds.size === 0 ? 0.7 : 1,
                                    cursor:
                                        submitting || selectedIds.size === 0
                                            ? "not-allowed"
                                            : "pointer",
                                }}
                                disabled={submitting || selectedIds.size === 0}
                                onClick={handleAllocate}
                            >
                                <Zap size={14} color="#fff" />
                                {submitting
                                    ? "Allocating…"
                                    : `Allocate${
                                          selectedIds.size > 0 ? ` (${selectedIds.size})` : ""
                                      }`}
                            </button>
                        </>
                    )}
                </div>
            )}

            {toast && <div style={styles.toast}>{toast}</div>}

            {/* ---- success popup — confirms the allocation, then hands
            off to the Profile page where the allocated case(s) now show
            under Today's Allocation ---- */}
            {successCount !== null && (
                <div style={styles.overlay}>
                    <div style={styles.popup}>
                        <div style={styles.successIconWrap}>
                            <CheckCircle2 size={28} color={BRAND.green} />
                        </div>
                        <h3 style={styles.popupTitle}>Allocated!</h3>
                        <p style={styles.popupSubtext}>
                            {successCount} case{successCount === 1 ? "" : "s"} allocated to
                            yourself. You'll find {successCount === 1 ? "it" : "them"} on your
                            profile page, ready to submit.
                        </p>
                        <button type="button" style={styles.popupBtn} onClick={goToProfile}>
                            Go to Profile
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function getStyles(isMobile: boolean): Record<string, CSSProperties> {
    return {
        root: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            background: "#EAF3FC",
            fontFamily: fontFamily.base,
            padding: isMobile ? "16px" : "24px 28px",
            boxSizing: "border-box",
            gap: 16,
        },
        headerRow: {
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: 12,
        },
        pageTitle: {
            margin: 0,
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        headerSubtext: {
            margin: "4px 0 0",
            fontSize: fontSize.base,
            color: "#767F92",
        },
        errorText: {
            color: BRAND.red,
            fontSize: fontSize.base,
            fontWeight: fontWeight.medium,
            margin: 0,
        },
        card: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        },
        smallLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        smallMuted: {
            margin: 0,
            fontSize: fontSize.sm,
            color: "#767F92",
        },
        select: {
            width: "100%",
            border: "1px solid #ececf5",
            borderRadius: radius.sm,
            padding: "10px 12px",
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
            color: "#17181C",
            background: "#fafafa",
            outline: "none",
            boxSizing: "border-box",
        },
        loadingBox: {
            padding: 24,
            textAlign: "center",
            color: "#767F92",
            fontSize: fontSize.base,
        },
        emptyState: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "40px 20px",
            textAlign: "center",
        },
        emptyTitle: {
            margin: "8px 0 0",
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        emptySubtext: {
            margin: 0,
            fontSize: fontSize.sm,
            color: "#767F92",
            maxWidth: 340,
        },
        caseListHeader: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
        },
        selectAllLabel: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#17181C",
            cursor: "pointer",
        },
        selectedCount: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
        },
        caseGrid: {
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 10,
            maxHeight: 420,
            overflowY: "auto",
            paddingRight: 2,
        },
        caseRow: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid #ececf5",
            borderRadius: radius.sm,
            padding: "10px 12px",
            cursor: "pointer",
            background: "#fafafa",
        },
        caseRowChecked: {
            borderColor: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.05),
        },
        caseNumber: {
            margin: 0,
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        caseMeta: {
            margin: "2px 0 0",
            fontSize: fontSize.xs,
            color: "#767F92",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        primaryBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: isMobile ? "100%" : "auto",
            alignSelf: isMobile ? "stretch" : "flex-end",
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.sm,
            padding: "10px 20px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            whiteSpace: "nowrap",
        },
        toast: {
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#17181C",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: radius.md,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            zIndex: 60,
        },
        overlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(15,17,23,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 80,
            padding: 16,
        },
        popup: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: "28px 24px",
            width: "100%",
            maxWidth: 360,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 10,
            boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        },
        successIconWrap: {
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: withAlpha(BRAND.green, 0.12),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        popupTitle: {
            margin: 0,
            fontSize: fontSize.xl,
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        popupSubtext: {
            margin: 0,
            fontSize: fontSize.sm,
            color: "#767F92",
        },
        popupBtn: {
            marginTop: 6,
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.sm,
            padding: "10px 28px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
    };
}
