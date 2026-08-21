import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { authFetch } from "../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

// THEME: blue/lightBlue/green now come from the active theme color (see
// useTheme() in the component below) instead of being hardcoded here, so
// this page repaints with the rest of the app when the user switches
// theme color. amber/red stay as fixed constants — they're pending/error
// status colors, not brand colors, and the theme palette doesn't define
// them.
const STATUS_AMBER = "#F59E0B";
const STATUS_RED = "#DC2626";

function withAlpha(hex: string, alpha: number) {
    const clean = hex.replace("#", "");
    const n = parseInt(clean, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Small injected stylesheet so buttons/rows/cards get real :hover states
// (inline style objects can't express :hover on their own). Built from the
// active theme color instead of a hardcoded navy, so hover tints track
// whatever theme color is picked.
function getHoverCss(BRAND: { blue: string }) {
    return `
.pf-card-hover { transition: box-shadow .18s ease, transform .18s ease; }
.pf-card-hover:hover { box-shadow: 0 8px 24px ${withAlpha(BRAND.blue, 0.1)}; transform: translateY(-1px); }
.pf-btn { transition: background .15s ease, box-shadow .15s ease, border-color .15s ease; }
.pf-btn-outline:hover { background: ${withAlpha(BRAND.blue, 0.06)}; }
.pf-btn-solid:hover { filter: brightness(1.06); box-shadow: 0 6px 18px ${withAlpha(BRAND.blue, 0.25)}; }
.pf-btn-danger:hover { background: rgba(220,38,38,0.06); }
.pf-tab:hover { color: ${BRAND.blue}; }
.pf-row:hover { background: #FAFBFF; }
.pf-avatar-edit:hover { filter: brightness(1.1); }
`;
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
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

function formatDisplayDate(iso: string | null) {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

// Guards against the classic "Unexpected token '<', ... is not valid JSON"
// crash — that happens when the API URL is wrong or the route 404s and the
// server sends back an HTML error page instead of JSON. Instead of trying
// to JSON.parse HTML, this gives a clear, actionable error message.
async function safeJson(res: Response) {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const text = await res.text();
        const looksLikeHtml = text.trim().startsWith("<");
        throw new Error(
            looksLikeHtml
                ? `Server returned an HTML page instead of data (status ${res.status}). Check that VITE_API_URL points to the right backend and that this route exists.`
                : `Unexpected response from server (status ${res.status}).`
        );
    }
    return res.json();
}

/* ---------------------------------------------------------------------- */
/*  Types                                                                  */
/* ---------------------------------------------------------------------- */

type ProfileData = {
    first_name?: string;
    last_name?: string;
    email?: string;
    role?: string;
    department?: string;
    designation?: string;
    phone?: string;
    bio?: string;
    [key: string]: any;
};

type EmployeeData = {
    id: string;
    name: string;
    email: string | null;
    role: string | null;
    designation: string | null;
    department: string | null;
    reportingManager: string | null;
    workedInTeams: string | null;
    photoUrl: string | null;
    phone?: string | null;
    bio?: string | null;
};

type CaseRow = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    workDate: string;
    profile: string;
    allocationStatus: string;
    submissionStatus: "PENDING" | "SUBMITTED";
    submissionType: "COMPLETED" | "DONE_BY_TEAM" | "QUERY" | null;
    queryText: string;
    submittedAt: string | null;
};

function isSubmitted(c: CaseRow) {
    return c.submissionStatus === "SUBMITTED";
}

interface ProfileProps {
    onLogout: () => void;
}

/* ---------------------------------------------------------------------- */
/*  Tiny inline icons (no external icon library required)                  */
/* ---------------------------------------------------------------------- */

const Icon = ({ children, size = 15 }: { children: React.ReactNode; size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        {children}
    </svg>
);
const MailIcon = () => (
    <Icon>
        <path d="M4 4h16v16H4z" />
        <path d="M22 6 12 13 2 6" />
    </Icon>
);
const PhoneIcon = () => (
    <Icon>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 2 2.3Z" />
    </Icon>
);
const TeamIcon = () => (
    <Icon>
        <circle cx="9" cy="7" r="4" />
        <path d="M17 11a4 4 0 1 0 0-8" />
        <path d="M1 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </Icon>
);
const DeptIcon = () => (
    <Icon>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Icon>
);
const UserIcon = () => (
    <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </Icon>
);
const ShieldIcon = () => (
    <Icon>
        <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5Z" />
    </Icon>
);
const CameraIcon = () => (
    <Icon size={13}>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
        <circle cx="12" cy="13" r="4" />
    </Icon>
);
const BoxIcon = () => (
    <Icon>
        <path d="m21 8-9-5-9 5 9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
    </Icon>
);
const CheckIcon = () => (
    <Icon>
        <path d="M20 6 9 17l-5-5" />
    </Icon>
);
const ClockIcon = () => (
    <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
    </Icon>
);
const AlertIcon = () => (
    <Icon>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
    </Icon>
);
const DownloadIcon = () => (
    <Icon size={13}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
    </Icon>
);
const InfoIcon = () => (
    <Icon size={14}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
    </Icon>
);

/* ---------------------------------------------------------------------- */
/*  Main component                                                         */
/* ---------------------------------------------------------------------- */

export default function Profile({ onLogout }: ProfileProps) {
    const isMobile = useIsMobile();
    const { colors: themeColors } = useTheme();
    // amber/red are fixed status colors (not part of the theme palette),
    // appended onto the active blue/lightBlue/green from useTheme().
    const BRAND = {
        blue: themeColors.blue,
        lightBlue: themeColors.lightBlue,
        green: themeColors.green,
        amber: STATUS_AMBER,
        red: STATUS_RED,
    };
    const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;
    const styles = getStyles(BRAND, GRADIENT);
    const hoverCss = getHoverCss(BRAND);

    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [employee, setEmployee] = useState<EmployeeData | null>(null);
    const [cases, setCases] = useState<CaseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [editingProfile, setEditingProfile] = useState(false);
    const [profileDraft, setProfileDraft] = useState({ phone: "", bio: "" });
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileSaveError, setProfileSaveError] = useState<string | null>(null);

    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [activeTab, setActiveTab] = useState<"today" | "past">("today");
    const [dateFilter, setDateFilter] = useState("");
    const [productFilter, setProductFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "PENDING" | "SUBMITTED">("all");
    const [search, setSearch] = useState("");

    const [selectedId, setSelectedId] = useState<string | null>(null);
    // What the employee is reporting for the selected case — mandatory
    // before "Submit Work" is enabled. "QUERY" additionally requires
    // submitQueryText to be filled in.
    const [submitType, setSubmitType] = useState<"" | "COMPLETED" | "DONE_BY_TEAM" | "QUERY">("");
    const [submitQueryText, setSubmitQueryText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // ---- Bulk Submit (every pending case for today, in one click) ----
    const [showBulkModal, setShowBulkModal] = useState(false);
    // Per-row outcome + query text for the bulk modal — both mandatory
    // (a row with "Query" selected also needs its text filled) before
    // "Submit All" is enabled.
    const [bulkTypeById, setBulkTypeById] = useState<
        Record<string, "" | "COMPLETED" | "DONE_BY_TEAM" | "QUERY">
    >({});
    const [bulkQueryById, setBulkQueryById] = useState<Record<string, string>>({});
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState<string | null>(null);

    const cachedUser = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();
    const myId: string | null = cachedUser?.id || cachedUser?.userId || null;

    const loadAll = async () => {
        setLoading(true);
        setError(null);
        try {
            // NOTE: the cases fetch does NOT depend on myId. GET
            // /api/service-cases?mine=true already resolves "who is
            // asking" server-side from the auth token (req.user.userId)
            // — it never needed a client-supplied id. Gating it on myId
            // (read from localStorage) was a bug: right after a fresh
            // login/logout, that localStorage value can momentarily be
            // stale or missing, which silently skipped this request
            // entirely and left the table empty — looking exactly like
            // "my cases disappeared", even though nothing was ever
            // deleted server-side.
            const [profileRes, employeeRes, casesRes] = await Promise.all([
                authFetch(`${API_BASE}/api/profile`),
                myId ? authFetch(`${API_BASE}/api/employees/${myId}`) : Promise.resolve(null),
                authFetch(`${API_BASE}/api/service-cases?mine=true&pageSize=2000`),
            ]);

            if (profileRes) {
                const json = await safeJson(profileRes);
                if (profileRes.ok && json.success) setProfile(json.data);
            }
            if (employeeRes) {
                const emp = await safeJson(employeeRes);
                if (employeeRes.ok) setEmployee(emp);
            }
            const casesJson = await safeJson(casesRes);
            if (casesRes.ok && casesJson.success) {
                setCases(casesJson.data || []);
            } else {
                console.error("Failed to load my cases:", casesJson?.message);
            }
        } catch (err: any) {
            setError(err?.message || "Could not load your profile");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!editingProfile) {
            setProfileDraft({
                phone: employee?.phone || profile?.phone || "",
                bio: employee?.bio || profile?.bio || "",
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employee, profile]);

    const name =
        profile?.first_name || profile?.last_name
            ? `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim()
            : employee?.name ||
              (cachedUser?.firstName
                  ? `${cachedUser.firstName} ${cachedUser.lastName || ""}`.trim()
                  : cachedUser?.email || "User");

    const email = profile?.email || employee?.email || cachedUser?.email || "-";
    const role = profile?.role || employee?.role || cachedUser?.role || "-";
    const department = profile?.department || employee?.department || "-";
    const team = employee?.workedInTeams || "-";
    const manager = employee?.reportingManager || "-";
    const phone = employee?.phone || profile?.phone || "-";
    const bio = employee?.bio || profile?.bio || "";
    const photoUrl = photoPreview || employee?.photoUrl || null;

    const initials = name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase())
        .join("");

    const { todaysCases, pastCases } = useMemo(() => {
        const today = todayStr();
        const sorted = [...cases].sort(
            (a, b) =>
                (b.workDate || "").localeCompare(a.workDate || "") ||
                (b.caseNumber || "").localeCompare(a.caseNumber || "")
        );
        return {
            todaysCases: sorted.filter((c) => c.workDate === today),
            pastCases: sorted.filter((c) => c.workDate !== today),
        };
    }, [cases]);

    const products = useMemo(
        () => Array.from(new Set(cases.map((c) => c.productName).filter(Boolean))) as string[],
        [cases]
    );

    const baseRows = activeTab === "today" ? todaysCases : pastCases;

    const filteredRows = useMemo(() => {
        return baseRows.filter((c) => {
            if (dateFilter && c.workDate !== dateFilter) return false;
            if (productFilter !== "all" && c.productName !== productFilter) return false;
            if (statusFilter !== "all" && c.submissionStatus !== statusFilter) return false;
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                const hay =
                    `${c.caseNumber || ""} ${c.productName || ""} ${c.profile || ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [baseRows, dateFilter, productFilter, statusFilter, search]);

    const stats = useMemo(() => {
        const total = todaysCases.length;
        const submittedCount = todaysCases.filter(isSubmitted).length;
        const pendingCount = total - submittedCount;
        return { total, submittedCount, pendingCount };
    }, [todaysCases]);

    const selected = cases.find((c) => c.id === selectedId) || null;

    useEffect(() => {
        if (selected) {
            setSubmitType("");
            setSubmitQueryText("");
            setSubmitError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    const handlePickForSubmit = (c: CaseRow) => {
        setSelectedId(c.id);
        setTimeout(
            () => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
            50
        );
    };

    // "Submit Work" only lights up once a status is picked, and — if
    // that status is "Query" — the query text is filled in too.
    const canSubmitSingle =
        !!selected && !!submitType && (submitType !== "QUERY" || submitQueryText.trim() !== "");

    const handleSubmitWork = async () => {
        if (!selected || !canSubmitSingle) return;
        setSubmitError(null);
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${selected.id}/submit`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    submissionType: submitType,
                    queryText: submitType === "QUERY" ? submitQueryText.trim() : undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Failed to submit work");
            setSelectedId(null);
            setSubmitType("");
            setSubmitQueryText("");
            await loadAll();
        } catch (err: any) {
            setSubmitError(err?.message || "Failed to submit work");
        } finally {
            setSubmitting(false);
        }
    };

    // ---- Bulk Submit: every still-pending case for TODAY (the KPI
    // cards above and this button both scope to "today" — pending work
    // from past dates is handled per-row on the Past Allocation tab). ----
    const pendingTodayCases = useMemo(
        () => todaysCases.filter((c) => !isSubmitted(c)),
        [todaysCases]
    );

    const openBulkModal = () => {
        const initialType: Record<string, "" | "COMPLETED" | "DONE_BY_TEAM" | "QUERY"> = {};
        const initialQuery: Record<string, string> = {};
        pendingTodayCases.forEach((c) => {
            initialType[c.id] = "";
            initialQuery[c.id] = "";
        });
        setBulkTypeById(initialType);
        setBulkQueryById(initialQuery);
        setBulkError(null);
        setShowBulkModal(true);
    };

    const closeBulkModal = () => {
        setShowBulkModal(false);
        setBulkTypeById({});
        setBulkQueryById({});
        setBulkError(null);
    };

    const setBulkType = (id: string, value: "" | "COMPLETED" | "DONE_BY_TEAM" | "QUERY") => {
        setBulkTypeById((prev) => ({ ...prev, [id]: value }));
        // Switching away from "Query" clears any half-typed text so it
        // doesn't get silently sent for a row that's no longer a query.
        if (value !== "QUERY") {
            setBulkQueryById((prev) => ({ ...prev, [id]: "" }));
        }
    };

    const setBulkQuery = (id: string, value: string) => {
        setBulkQueryById((prev) => ({ ...prev, [id]: value }));
    };

    // Every pending row needs a status, and every "Query" row needs its
    // text filled in, before Submit All unlocks.
    const bulkAllReady = useMemo(
        () =>
            pendingTodayCases.length > 0 &&
            pendingTodayCases.every((c) => {
                const type = bulkTypeById[c.id];
                if (!type) return false;
                if (type === "QUERY" && !(bulkQueryById[c.id] || "").trim()) return false;
                return true;
            }),
        [pendingTodayCases, bulkTypeById, bulkQueryById]
    );

    const handleBulkSubmit = async () => {
        setBulkError(null);
        if (pendingTodayCases.length === 0) return;

        for (const c of pendingTodayCases) {
            const type = bulkTypeById[c.id];
            if (!type) {
                setBulkError(`Pick a status for ${c.caseNumber} before submitting.`);
                return;
            }
            if (type === "QUERY" && !(bulkQueryById[c.id] || "").trim()) {
                setBulkError(`Enter the query text for ${c.caseNumber} before submitting.`);
                return;
            }
        }

        const items = pendingTodayCases.map((c) => ({
            id: c.id,
            submissionType: bulkTypeById[c.id],
            queryText:
                bulkTypeById[c.id] === "QUERY" ? (bulkQueryById[c.id] || "").trim() : undefined,
        }));

        setBulkSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/bulk-submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items }),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Bulk submit failed");
            }
            closeBulkModal();
            await loadAll();
        } catch (err: any) {
            setBulkError(err?.message || "Bulk submit failed");
        } finally {
            setBulkSubmitting(false);
        }
    };

    const handleSaveProfile = async () => {
        setSavingProfile(true);
        setProfileSaveError(null);
        try {
            const res = await authFetch(`${API_BASE}/api/profile`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: profileDraft.phone, bio: profileDraft.bio }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to save changes");
            setEditingProfile(false);
            await loadAll();
        } catch (err: any) {
            setProfileSaveError(err?.message || "Failed to save changes");
        } finally {
            setSavingProfile(false);
        }
    };

    const cancelEditProfile = () => {
        setEditingProfile(false);
        setProfileSaveError(null);
        setProfileDraft({
            phone: employee?.phone || profile?.phone || "",
            bio: employee?.bio || profile?.bio || "",
        });
    };

    const handlePhotoClick = () => fileInputRef.current?.click();

    const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoError(null);

        if (!file.type.startsWith("image/")) {
            setPhotoError("Please choose an image file.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setPhotoError("Image must be under 5MB.");
            return;
        }

        const localUrl = URL.createObjectURL(file);
        setPhotoPreview(localUrl);
        setUploadingPhoto(true);
        try {
            const formData = new FormData();
            formData.append("photo", file);
            const res = await authFetch(`${API_BASE}/api/profile/photo`, {
                method: "PATCH",
                body: formData,
            });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to upload photo");
            await loadAll();
        } catch (err: any) {
            setPhotoError(err?.message || "Failed to upload photo");
        } finally {
            setUploadingPhoto(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const exportCsv = () => {
        const header = ["#", "Case No.", "Service", "Date", "Profile", "Status"];
        const rows = filteredRows.map((c, i) => [
            i + 1,
            c.caseNumber,
            c.productName || "-",
            c.workDate,
            c.profile || "-",
            isSubmitted(c) ? "Submitted" : "Pending",
        ]);
        const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `allocations-${activeTab}-${todayStr()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            {/* Same signature gradient rail used on Dashboard/Products pages */}
            <div style={styles.topBar} />

            <style>{hoverCss}</style>

            {error && <div style={styles.noteWarning}>{error}</div>}

            {/* ---- Identity card ---- */}
            <div className="pf-card-hover" style={styles.identityCard}>
                <div style={isMobile ? styles.identityTopMobile : styles.identityTop}>
                    <div style={styles.avatarBlock}>
                        <div style={styles.avatarWrap}>
                            {photoUrl ? (
                                <img src={photoUrl} alt={name} style={styles.avatarImg} />
                            ) : (
                                <div style={styles.avatar}>{initials || "?"}</div>
                            )}
                            <button
                                type="button"
                                style={styles.avatarEditBtn}
                                className="pf-avatar-edit"
                                onClick={handlePhotoClick}
                                disabled={uploadingPhoto}
                                title="Change photo"
                            >
                                <CameraIcon />
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={handlePhotoChange}
                            />
                        </div>
                        <div>
                            <div style={styles.nameRow}>
                                <span style={styles.name}>{loading ? "Loading..." : name}</span>
                                <span style={styles.activePill}>Active</span>
                            </div>
                            {uploadingPhoto && (
                                <div style={styles.smallMuted}>Uploading photo…</div>
                            )}
                            {photoError && <p style={styles.rowError}>{photoError}</p>}
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {editingProfile && (
                            <button
                                type="button"
                                className="pf-btn pf-btn-outline"
                                style={styles.cancelEditBtn}
                                disabled={savingProfile}
                                onClick={cancelEditProfile}
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="button"
                            style={styles.editProfileBtn}
                            className="pf-btn pf-btn-outline"
                            disabled={savingProfile}
                            onClick={() =>
                                editingProfile ? handleSaveProfile() : setEditingProfile(true)
                            }
                        >
                            {editingProfile ? (savingProfile ? "Saving…" : "Save") : "Edit Profile"}
                        </button>
                    </div>
                </div>

                <div style={isMobile ? styles.identityGridMobile : styles.identityGrid}>
                    <div style={styles.identityColumn}>
                        <InfoIconRow
                            icon={<ShieldIcon />}
                            label="Role"
                            value={(role || "-").toString().toUpperCase()}
                            styles={styles}
                        />
                        <div style={styles.contactRow}>
                            <span style={styles.contactIcon}>
                                <MailIcon />
                            </span>
                            <span style={styles.contactValue}>{email}</span>
                        </div>
                        {editingProfile ? (
                            <div style={styles.editField}>
                                <label style={styles.smallLabel}>Phone</label>
                                <input
                                    style={styles.textInput}
                                    value={profileDraft.phone}
                                    onChange={(e) =>
                                        setProfileDraft((p) => ({ ...p, phone: e.target.value }))
                                    }
                                    placeholder="Phone number"
                                />
                            </div>
                        ) : (
                            <div style={styles.contactRow}>
                                <span style={styles.contactIcon}>
                                    <PhoneIcon />
                                </span>
                                <span style={styles.contactValue}>{phone}</span>
                            </div>
                        )}
                    </div>

                    <div style={styles.identityColumn}>
                        <InfoIconRow
                            icon={<TeamIcon />}
                            label="Team"
                            value={team}
                            styles={styles}
                        />
                        <InfoIconRow
                            icon={<DeptIcon />}
                            label="Department"
                            value={department}
                            styles={styles}
                        />
                        <InfoIconRow
                            icon={<UserIcon />}
                            label="Manager"
                            value={manager}
                            styles={styles}
                        />
                    </div>

                    <div style={styles.aboutBox}>
                        <div style={styles.aboutTitle}>About Me</div>
                        {editingProfile ? (
                            <textarea
                                style={styles.aboutTextarea}
                                rows={4}
                                value={profileDraft.bio}
                                onChange={(e) =>
                                    setProfileDraft((p) => ({ ...p, bio: e.target.value }))
                                }
                                placeholder="Tell your team a bit about yourself…"
                            />
                        ) : (
                            <p style={styles.aboutText}>{bio || "No bio added yet."}</p>
                        )}
                    </div>
                </div>

                {profileSaveError && <p style={styles.rowError}>{profileSaveError}</p>}
            </div>

            {/* ---- Stats ---- */}
            <div style={isMobile ? styles.statsGridMobile : styles.statsGrid}>
                <StatCard
                    icon={<BoxIcon />}
                    tint={BRAND.blue}
                    value={stats.total}
                    label="Total Cases"
                    sub="Cases allocated today"
                    styles={styles}
                />
                <StatCard
                    icon={<CheckIcon />}
                    tint={BRAND.green}
                    value={stats.submittedCount}
                    label="Submitted"
                    sub="Completed & submitted"
                    styles={styles}
                />
                <StatCard
                    icon={<ClockIcon />}
                    tint={BRAND.amber}
                    value={stats.pendingCount}
                    label="Pending"
                    sub="Awaiting submission"
                    styles={styles}
                />
            </div>

            {/* ---- Tabs + Export ---- */}
            <div style={styles.tabsRow}>
                <div style={styles.tabsGroup}>
                    <button
                        style={activeTab === "today" ? styles.tabActive : styles.tab}
                        className="pf-tab"
                        onClick={() => setActiveTab("today")}
                    >
                        Today's Allocation
                    </button>
                    <button
                        style={activeTab === "past" ? styles.tabActive : styles.tab}
                        className="pf-tab"
                        onClick={() => setActiveTab("past")}
                    >
                        Past Allocation
                    </button>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                    <button
                        type="button"
                        className="pf-btn pf-btn-solid"
                        style={{
                            ...styles.exportBtn,
                            background: GRADIENT,
                            color: "#fff",
                            border: "none",
                            opacity: stats.pendingCount > 0 ? 1 : 0.5,
                            cursor: stats.pendingCount > 0 ? "pointer" : "not-allowed",
                        }}
                        onClick={openBulkModal}
                        disabled={stats.pendingCount === 0}
                    >
                        <CheckIcon /> Bulk Submit
                        {stats.pendingCount > 0 ? ` (${stats.pendingCount})` : ""}
                    </button>
                    <button
                        type="button"
                        className="pf-btn pf-btn-outline"
                        style={styles.exportBtn}
                        onClick={exportCsv}
                    >
                        <DownloadIcon /> Export
                    </button>
                </div>
            </div>

            {/* ---- Filters ---- */}
            <div style={isMobile ? styles.filterRowMobile : styles.filterRow}>
                <div style={styles.filterField}>
                    <label style={styles.smallLabel}>Date</label>
                    <input
                        type="date"
                        style={styles.textInput}
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                    />
                </div>
                <div style={styles.filterField}>
                    <label style={styles.smallLabel}>Service</label>
                    <select
                        style={styles.textInput}
                        value={productFilter}
                        onChange={(e) => setProductFilter(e.target.value)}
                    >
                        <option value="all">All Services</option>
                        {products.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={styles.filterField}>
                    <label style={styles.smallLabel}>Status</label>
                    <select
                        style={styles.textInput}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                        <option value="all">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="SUBMITTED">Submitted</option>
                    </select>
                </div>
                <div style={{ ...styles.filterField, flex: 1 }}>
                    <label style={styles.smallLabel}>Search</label>
                    <input
                        style={styles.textInput}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by case number, service or profile…"
                    />
                </div>
            </div>

            {/* ---- Table / mobile list ---- */}
            <div className="pf-card-hover" style={styles.tableCard}>
                {loading ? (
                    <EmptyState text="Loading…" styles={styles} />
                ) : filteredRows.length === 0 ? (
                    <EmptyState
                        text={
                            activeTab === "today"
                                ? "No allocation found for today."
                                : "No past allocations found."
                        }
                        styles={styles}
                    />
                ) : isMobile ? (
                    <div style={styles.allocList}>
                        {filteredRows.map((c, i) => (
                            <MobileRow
                                key={c.id}
                                index={i + 1}
                                c={c}
                                onSubmit={() => handlePickForSubmit(c)}
                                styles={styles}
                            />
                        ))}
                    </div>
                ) : (
                    <table style={styles.table}>
                        <colgroup>
                            <col style={{ width: "4%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "20%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "14%" }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={styles.th}>#</th>
                                <th style={styles.th}>Case No.</th>
                                <th style={styles.th}>Service</th>
                                <th style={styles.th}>Date</th>
                                <th style={styles.th}>Profile</th>
                                <th style={styles.th}>Status</th>
                                <th style={styles.th}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRows.map((c, i) => {
                                const submitted = isSubmitted(c);
                                return (
                                    <tr key={c.id} className="pf-row" style={styles.tr}>
                                        <td style={styles.td}>{i + 1}</td>
                                        <td style={{ ...styles.td, fontWeight: fontWeight.bold }}>
                                            {c.caseNumber}
                                        </td>
                                        <td style={styles.td}>{c.productName || "-"}</td>
                                        <td style={styles.td}>{formatDisplayDate(c.workDate)}</td>
                                        <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                            {c.profile || <span style={styles.smallMuted}>—</span>}
                                        </td>
                                        <td style={styles.td}>
                                            <span
                                                style={
                                                    submitted
                                                        ? styles.statusDone
                                                        : styles.statusPending
                                                }
                                            >
                                                {submitted ? "Submitted" : "Pending"}
                                            </span>
                                        </td>
                                        <td style={styles.td}>
                                            {submitted ? (
                                                <span style={styles.smallMuted}>
                                                    {formatDisplayDate(
                                                        c.submittedAt
                                                            ? c.submittedAt.slice(0, 10)
                                                            : null
                                                    )}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    style={styles.rowSubmitBtn}
                                                    onClick={() => handlePickForSubmit(c)}
                                                >
                                                    Submit
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ---- Submit Your Work ---- */}
            <div ref={panelRef} className="pf-card-hover" style={styles.submitPanel}>
                <div style={styles.submitPanelTitle}>Submit Your Work</div>
                <div style={styles.submitPanelSub}>
                    {selected
                        ? `Confirm submission for case "${selected.caseNumber}"`
                        : "Select a case from the table above to submit your work."}
                </div>

                {selected && (
                    <div style={isMobile ? styles.submitGridMobile : styles.submitGrid}>
                        <div style={styles.filterField}>
                            <label style={styles.smallLabel}>Case No.</label>
                            <input
                                style={{ ...styles.textInput, background: "#f5f5fa" }}
                                value={selected.caseNumber}
                                disabled
                            />
                        </div>
                        <div style={styles.filterField}>
                            <label style={styles.smallLabel}>Service</label>
                            <input
                                style={{ ...styles.textInput, background: "#f5f5fa" }}
                                value={selected.productName || "-"}
                                disabled
                            />
                        </div>
                        <div style={{ ...styles.filterField, flex: 1, minWidth: 180 }}>
                            <label style={styles.smallLabel}>Status *</label>
                            <select
                                style={styles.textInput}
                                value={submitType}
                                onChange={(e) => {
                                    const v = e.target.value as
                                        "" | "COMPLETED" | "DONE_BY_TEAM" | "QUERY";
                                    setSubmitType(v);
                                    if (v !== "QUERY") setSubmitQueryText("");
                                }}
                            >
                                <option value="">Select status</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="DONE_BY_TEAM">Done by Team</option>
                                <option value="QUERY">Query</option>
                            </select>
                        </div>
                        {submitType === "QUERY" && (
                            <div style={{ ...styles.filterField, flex: 1, minWidth: 220 }}>
                                <label style={styles.smallLabel}>Query *</label>
                                <input
                                    style={styles.textInput}
                                    value={submitQueryText}
                                    onChange={(e) => setSubmitQueryText(e.target.value)}
                                    placeholder="Describe the query…"
                                />
                            </div>
                        )}
                    </div>
                )}

                {submitError && <p style={styles.rowError}>{submitError}</p>}

                <div style={styles.infoBox}>
                    <span style={styles.infoBoxIcon}>
                        <InfoIcon />
                    </span>
                    <div>
                        <strong>How it works?</strong>
                        <p style={{ margin: "4px 0 0" }}>
                            Pick a case from the table above, choose whether it's completed or has a
                            query, and submit. "Query" needs a short note on what the query is. Use
                            "Bulk Submit" up top to submit every pending case for today in one
                            click.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    className="pf-btn pf-btn-solid"
                    style={{
                        ...styles.submitBtn,
                        opacity: !canSubmitSingle || submitting ? 0.6 : 1,
                        cursor: !canSubmitSingle || submitting ? "not-allowed" : "pointer",
                    }}
                    disabled={!canSubmitSingle || submitting}
                    onClick={handleSubmitWork}
                >
                    {submitting ? "Submitting…" : "Submit Work"}
                </button>
            </div>

            {/* ---- Bulk Submit modal ---- */}
            {showBulkModal && (
                <div style={styles.bulkOverlay} onClick={closeBulkModal}>
                    <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.bulkModalHeader}>
                            <div>
                                <h3 style={styles.bulkModalTitle}>
                                    Bulk Submit — Today's Pending Cases
                                </h3>
                                <p style={styles.bulkModalSubtitle}>
                                    Every case below is still pending. Pick a status for each — a
                                    "Query" row also needs its text — then confirm to submit all of
                                    them at once.
                                </p>
                            </div>
                            <button
                                type="button"
                                style={styles.closeBtn}
                                onClick={closeBulkModal}
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.bulkTableWrap}>
                            <table style={styles.bulkTable}>
                                <colgroup>
                                    <col style={{ width: "16%" }} />
                                    <col style={{ width: "24%" }} />
                                    <col style={{ width: "26%" }} />
                                    <col style={{ width: "34%" }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Case No.</th>
                                        <th style={styles.th}>Service</th>
                                        <th style={styles.th}>Status *</th>
                                        <th style={styles.th}>Query</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingTodayCases.map((c) => {
                                        const type = bulkTypeById[c.id] ?? "";
                                        const queryMissing =
                                            type === "QUERY" && !(bulkQueryById[c.id] || "").trim();
                                        return (
                                            <tr key={c.id} style={styles.tr}>
                                                <td
                                                    style={{
                                                        ...styles.td,
                                                        fontWeight: fontWeight.bold,
                                                    }}
                                                >
                                                    {c.caseNumber}
                                                </td>
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    {c.productName || "-"}
                                                </td>
                                                <td style={styles.td}>
                                                    <select
                                                        style={{
                                                            ...styles.textInput,
                                                            width: "100%",
                                                        }}
                                                        value={type}
                                                        onChange={(e) =>
                                                            setBulkType(
                                                                c.id,
                                                                e.target.value as
                                                                    | ""
                                                                    | "COMPLETED"
                                                                    | "DONE_BY_TEAM"
                                                                    | "QUERY"
                                                            )
                                                        }
                                                    >
                                                        <option value="">Select status</option>
                                                        <option value="COMPLETED">Completed</option>
                                                        <option value="DONE_BY_TEAM">
                                                            Done by Team
                                                        </option>
                                                        <option value="QUERY">Query</option>
                                                    </select>
                                                </td>
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    {type === "QUERY" ? (
                                                        <input
                                                            style={{
                                                                ...styles.textInput,
                                                                width: "100%",
                                                                border: queryMissing
                                                                    ? `1px solid ${BRAND.red || "#e04b4b"}`
                                                                    : styles.textInput.border,
                                                            }}
                                                            value={bulkQueryById[c.id] ?? ""}
                                                            onChange={(e) =>
                                                                setBulkQuery(c.id, e.target.value)
                                                            }
                                                            placeholder="Describe the query…"
                                                        />
                                                    ) : (
                                                        <span style={styles.smallMuted}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {bulkError && <p style={styles.rowError}>{bulkError}</p>}

                        <div style={styles.bulkModalFooter}>
                            <button
                                type="button"
                                className="pf-btn pf-btn-outline"
                                style={styles.bulkCancelBtn}
                                onClick={closeBulkModal}
                                disabled={bulkSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="pf-btn pf-btn-solid"
                                style={{
                                    ...styles.submitBtn,
                                    width: "auto",
                                    flex: 1,
                                    opacity: bulkSubmitting || !bulkAllReady ? 0.6 : 1,
                                    cursor:
                                        bulkSubmitting || !bulkAllReady ? "not-allowed" : "pointer",
                                }}
                                onClick={handleBulkSubmit}
                                disabled={bulkSubmitting || !bulkAllReady}
                                title={
                                    !bulkAllReady
                                        ? "Pick a status (and query text where needed) for every case first"
                                        : undefined
                                }
                            >
                                {bulkSubmitting
                                    ? "Submitting…"
                                    : `Submit All (${pendingTodayCases.length})`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Small presentational subcomponents                                     */
/*  (take `styles` as a prop since it's now built per-render from the      */
/*  active theme, instead of a module-level constant.)                     */
/* ---------------------------------------------------------------------- */

function InfoIconRow({
    icon,
    label,
    value,
    styles,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    styles: Record<string, CSSProperties>;
}) {
    return (
        <div style={styles.infoIconRow}>
            <span style={styles.contactIcon}>{icon}</span>
            <div style={styles.infoTextWrap}>
                <span style={styles.infoLabel}>{label}:</span>
                <span style={styles.infoValue}>{value}</span>
            </div>
        </div>
    );
}

function StatCard({
    icon,
    tint,
    value,
    label,
    sub,
    styles,
}: {
    icon: React.ReactNode;
    tint: string;
    value: number;
    label: string;
    sub: string;
    styles: Record<string, CSSProperties>;
}) {
    return (
        <div className="pf-card-hover" style={styles.statCard}>
            <div style={{ ...styles.statIconWrap, background: `${tint}1A`, color: tint }}>
                {icon}
            </div>
            <div>
                <div style={{ ...styles.statValue, color: tint }}>{value}</div>
                <div style={styles.statLabel}>{label}</div>
                <div style={styles.statSub}>{sub}</div>
            </div>
        </div>
    );
}

function EmptyState({ text, styles }: { text: string; styles: Record<string, CSSProperties> }) {
    return <div style={styles.emptyState}>{text}</div>;
}

function MobileRow({
    index,
    c,
    onSubmit,
    styles,
}: {
    index: number;
    c: CaseRow;
    onSubmit: () => void;
    styles: Record<string, CSSProperties>;
}) {
    const submitted = isSubmitted(c);
    return (
        <div style={styles.mobileCard}>
            <div style={styles.mobileCardTop}>
                <span style={styles.mobileIndex}>#{index}</span>
                <span style={styles.mobileProduct}>{c.caseNumber}</span>
                <span style={submitted ? styles.statusDone : styles.statusPending}>
                    {submitted ? "Submitted" : "Pending"}
                </span>
            </div>
            <div style={styles.mobileMetaRow}>
                <span>{c.productName || "-"}</span>
                <span>{formatDisplayDate(c.workDate)}</span>
                {c.profile && <span>Profile: {c.profile}</span>}
            </div>
            {submitted ? (
                <div style={styles.smallMuted}>Submitted</div>
            ) : (
                <button type="button" style={styles.rowSubmitBtn} onClick={onSubmit}>
                    Submit
                </button>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Styles — now a function of the active theme color (BRAND/GRADIENT)     */
/*  instead of a module-level constant, so every gradient/tinted shadow/   */
/*  border on this page repaints when the user switches theme color.       */
/*  Same recipes as before: Add User's outline button (white bg + tinted   */
/*  border + brand text), filled button (brand gradient + tinted shadow),  */
/*  input recipe (background #fafafa, border #ececf5), neutral card        */
/*  shadow ("0 10px 30px rgba(0,0,0,.06)"), and theme.ts tokens            */
/*  (fontFamily, fontWeight, radius).                                      */
/* ---------------------------------------------------------------------- */

const CARD_SHADOW = "0 10px 30px rgba(0,0,0,.06)";

function getStyles(
    BRAND: { blue: string; lightBlue: string; green: string; amber: string; red: string },
    GRADIENT: string
): Record<string, CSSProperties> {
    return {
        topBar: {
            height: "4px",
            width: "100%",
            borderRadius: radius.xs,
            marginBottom: 4,
            background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
        },
        root: {
            width: "100%",
            boxSizing: "border-box",
            padding: "20px 24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            background: "#EAF3FC",
            fontFamily: fontFamily.base,
        },
        rootMobile: {
            width: "100%",
            boxSizing: "border-box",
            padding: "14px 14px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            background: "#EAF3FC",
            fontFamily: fontFamily.base,
        },

        pageHeaderRow: {},
        pageTitleBlock: {},
        pageTitle: {
            margin: 0,
            fontSize: fontSize["5xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        pageSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },

        noteWarning: {
            fontSize: fontSize.sm,
            color: "#92400E",
            background: "rgba(245,158,11,0.1)",
            padding: "8px 12px",
            borderRadius: radius.sm,
        },

        /* Identity card */
        identityCard: {
            background: "#fff",
            borderRadius: radius.xl,
            padding: 24,
            border: "1px solid #F0F1F7",
            boxShadow: CARD_SHADOW,
        },
        identityTop: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 20,
        },
        identityTopMobile: { display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 },
        avatarBlock: { display: "flex", alignItems: "center", gap: 16 },
        avatarWrap: { position: "relative", flexShrink: 0 },
        avatar: {
            width: 64,
            height: 64,
            borderRadius: radius.circle,
            background: GRADIENT,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize["2xl"],
            fontWeight: fontWeight.semibold,
            boxShadow: `0 0 0 4px ${withAlpha(BRAND.blue, 0.08)}`,
        },
        avatarImg: {
            width: 64,
            height: 64,
            borderRadius: radius.circle,
            objectFit: "cover",
            boxShadow: `0 0 0 4px ${withAlpha(BRAND.blue, 0.08)}`,
        },
        avatarEditBtn: {
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 24,
            height: 24,
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
        nameRow: { display: "flex", alignItems: "center", gap: 8 },
        name: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: "#17181C" },
        activePill: {
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.semibold,
            color: BRAND.green,
            background: withAlpha(BRAND.green, 0.12),
            padding: "2px 9px",
            borderRadius: radius.pill,
        },
        // Matches Add User's `styles.templateBtn` — white bg, brand text,
        // tinted border, semibold weight, pill-ish radius.
        editProfileBtn: {
            border: `1px solid ${withAlpha(BRAND.blue, 0.25)}`,
            background: "#fff",
            color: BRAND.blue,
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.base,
            padding: "9px 18px",
            borderRadius: radius["2xl"],
            cursor: "pointer",
            whiteSpace: "nowrap",
        },
        cancelEditBtn: {
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#767F92",
            fontWeight: fontWeight.medium,
            fontSize: fontSize.sm,
            padding: "9px 16px",
            borderRadius: radius["2xl"],
            cursor: "pointer",
        },

        identityGrid: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1.2fr",
            gap: 20,
            borderTop: "1px solid #f1f1f1",
            paddingTop: 18,
        },
        identityGridMobile: {
            display: "flex",
            flexDirection: "column",
            gap: 16,
            borderTop: "1px solid #f1f1f1",
            paddingTop: 16,
        },
        identityColumn: { display: "flex", flexDirection: "column", gap: 14 },
        contactRow: { display: "flex", alignItems: "center", gap: 10 },
        contactIcon: { color: BRAND.lightBlue, flexShrink: 0, display: "flex" },
        contactValue: { fontSize: fontSize.base, color: "#3D4459", fontWeight: fontWeight.regular },
        infoIconRow: { display: "flex", alignItems: "center", gap: 10 },
        infoTextWrap: { display: "flex", flexDirection: "row", alignItems: "baseline", gap: 5 },
        infoLabel: { fontSize: fontSize.xs, color: "#9099AC" },
        infoValue: { fontSize: fontSize.base, color: "#17181C", fontWeight: fontWeight.medium },
        aboutBox: {
            background: "#EEF1FB",
            borderRadius: radius.lg,
            padding: 16,
            borderLeft: `3px solid ${BRAND.blue}`,
        },
        aboutTitle: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            marginBottom: 6,
        },
        aboutText: { margin: 0, fontSize: fontSize.base, color: "#3D4459", lineHeight: 1.5 },
        aboutTextarea: {
            width: "100%",
            border: "1px solid #ececf5",
            borderRadius: radius.sm,
            padding: 10,
            fontSize: fontSize.base,
            fontFamily: "inherit",
            color: "#17181C",
            resize: "vertical",
            boxSizing: "border-box",
            background: "#fafafa",
        },
        editField: { display: "flex", flexDirection: "column", gap: 4 },
        logoutRow: {
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 18,
        },
        logoutButton: {
            padding: "10px 18px",
            borderRadius: radius.sm,
            border: `1px solid ${BRAND.red}`,
            background: "#fff",
            color: BRAND.red,
            fontWeight: fontWeight.medium,
            fontSize: fontSize.base,
            cursor: "pointer",
        },

        /* Stats */
        statsGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
        },
        statsGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 12 },
        statCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: CARD_SHADOW,
        },
        statIconWrap: {
            width: 40,
            height: 40,
            borderRadius: radius.md,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        statValue: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, lineHeight: 1.1 },
        statLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            marginTop: 2,
        },
        statSub: { fontSize: fontSize.xxs, color: "#9099AC", marginTop: 1 },

        /* Tabs */
        tabsRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
        },
        tabsGroup: {
            display: "flex",
            gap: 8,
            background: "#EEF1FB",
            padding: 4,
            borderRadius: radius.md,
        },
        tab: {
            border: "none",
            background: "transparent",
            color: "#767F92",
            fontWeight: fontWeight.medium,
            fontSize: fontSize.base,
            padding: "8px 16px",
            borderRadius: radius.sm,
            cursor: "pointer",
        },
        tabActive: {
            border: "none",
            background: BRAND.blue,
            color: "#fff",
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.base,
            padding: "8px 16px",
            borderRadius: radius.sm,
            cursor: "pointer",
        },
        // Matches Add User's outline button recipe.
        exportBtn: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${withAlpha(BRAND.blue, 0.25)}`,
            background: "#fff",
            color: BRAND.blue,
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.sm,
            padding: "9px 14px",
            borderRadius: radius["2xl"],
            cursor: "pointer",
        },

        /* Filters */
        filterRow: {
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            background: "#fff",
            borderRadius: radius.lg,
            padding: 16,
            boxShadow: CARD_SHADOW,
        },
        filterRowMobile: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "#fff",
            borderRadius: radius.lg,
            padding: 14,
            boxShadow: CARD_SHADOW,
        },
        filterField: { display: "flex", flexDirection: "column", gap: 4, minWidth: 150 },
        smallLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#3D4459" },
        // Matches Add User's `styles.input` recipe exactly.
        textInput: {
            padding: "10px 12px",
            background: "#fafafa",
            border: "1px solid #ececf5",
            outline: "none",
            fontSize: fontSize.base,
            borderRadius: radius.sm,
            boxSizing: "border-box",
            color: "#17181C",
            fontFamily: "inherit",
        },

        /* Table */
        tableCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 6,
            boxShadow: CARD_SHADOW,
            overflowX: "auto",
        },
        table: { width: "100%", borderCollapse: "collapse", minWidth: 720, tableLayout: "fixed" },
        th: {
            textAlign: "left",
            fontSize: fontSize.xs,
            color: "#9099AC",
            fontWeight: fontWeight.semibold,
            padding: "12px 14px",
            borderBottom: "1px solid #f1f1f1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        tr: {},
        td: {
            textAlign: "left",
            fontSize: fontSize.base,
            color: "#3D4459",
            padding: "12px 14px",
            borderBottom: "1px solid #f6f6f9",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        statusDone: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.green,
            background: withAlpha(BRAND.green, 0.12),
            padding: "3px 10px",
            borderRadius: radius.pill,
        },
        statusPending: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.amber,
            background: withAlpha(BRAND.amber, 0.12),
            padding: "3px 10px",
            borderRadius: radius.pill,
        },
        // Matches Add User's filled button recipe — brand gradient + tinted
        // shadow.
        rowSubmitBtn: {
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.sm,
            padding: "6px 14px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            boxShadow: `0 4px 12px ${withAlpha(BRAND.blue, 0.25)}`,
        },

        emptyState: {
            padding: "36px 20px",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: fontSize.base,
        },

        /* Mobile list */
        allocList: { display: "flex", flexDirection: "column", gap: 10, padding: 8 },
        mobileCard: {
            background: "#fafafa",
            borderRadius: radius.md,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
        },
        mobileCardTop: { display: "flex", alignItems: "center", gap: 8 },
        mobileIndex: { fontSize: fontSize.xs, color: "#9099AC", fontWeight: fontWeight.semibold },
        mobileProduct: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            flex: 1,
        },
        mobileMetaRow: {
            display: "flex",
            gap: 12,
            fontSize: fontSize.sm,
            color: "#767F92",
            flexWrap: "wrap",
        },

        /* Submit panel */
        submitPanel: {
            background: "#fff",
            borderRadius: radius.xl,
            padding: 22,
            boxShadow: CARD_SHADOW,
        },
        submitPanelTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: BRAND.blue },
        submitPanelSub: { fontSize: fontSize.sm, color: "#767F92", marginTop: 3, marginBottom: 16 },
        submitGrid: {
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 14,
        },
        submitGridMobile: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 },
        infoBox: {
            display: "flex",
            gap: 10,
            background: "#EEF1FB",
            borderRadius: radius.md,
            padding: "12px 14px",
            fontSize: fontSize.sm,
            color: "#3D4459",
            marginBottom: 16,
        },
        infoBoxIcon: { color: BRAND.blue, flexShrink: 0, marginTop: 1 },
        // Matches Add User's filled `registerButton` recipe — gradient,
        // tinted shadow, semibold weight.
        submitBtn: {
            width: "100%",
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: radius.md,
            padding: "13px",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.3)}`,
        },
        rowError: {
            margin: "6px 0 0",
            fontSize: fontSize.xs,
            color: BRAND.red,
            fontWeight: fontWeight.medium,
        },
        smallMuted: { fontSize: fontSize.xs, color: "#9099AC" },

        // ---- Bulk Submit modal ----
        bulkOverlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 16,
        },
        bulkModal: {
            background: "#fff",
            borderRadius: radius.lg,
            width: 820,
            maxWidth: "100%",
            maxHeight: "88vh",
            overflowY: "auto",
            boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
            padding: 24,
            boxSizing: "border-box",
        },
        bulkModalHeader: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 16,
        },
        bulkModalTitle: {
            margin: 0,
            fontSize: fontSize.xl,
            fontWeight: fontWeight.bold,
            color: BRAND.blue,
        },
        bulkModalSubtitle: {
            margin: "4px 0 0",
            fontSize: fontSize.sm,
            color: "#767F92",
        },
        closeBtn: {
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: radius.circle,
            border: "none",
            background: "#f1f5f9",
            color: "#475569",
            cursor: "pointer",
            fontSize: fontSize.md,
        },
        bulkTableWrap: {
            border: "1px solid #f1f1f5",
            borderRadius: radius.md,
            overflowX: "auto",
            overflowY: "hidden",
            marginBottom: 16,
        },
        bulkTable: {
            width: "100%",
            minWidth: 640,
            borderCollapse: "collapse",
            tableLayout: "fixed",
        },
        bulkModalFooter: {
            display: "flex",
            gap: 10,
            marginTop: 16,
        },
        bulkCancelBtn: {
            flex: 1,
            background: "#fff",
            color: BRAND.blue,
            border: `1px solid ${withAlpha(BRAND.blue, 0.3)}`,
            borderRadius: radius.md,
            padding: "13px",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
        },
    };
}
