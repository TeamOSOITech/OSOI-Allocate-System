import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { authFetch } from "./utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

const BRAND = {
    blue: "#204297",
    lightBlue: "#08A1CE",
    green: "#2EBBA8",
    amber: "#F59E0B",
    red: "#DC2626",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

const REASON_OPTIONS = [
    "Completed as planned",
    "Extra work assigned",
    "Technical issue",
    "Resource / data unavailable",
    "Other",
];

// Small injected stylesheet so buttons/rows/cards get real :hover states
// (inline style objects can't express :hover on their own).
const HOVER_CSS = `
.pf-card-hover { transition: box-shadow .18s ease, transform .18s ease; }
.pf-card-hover:hover { box-shadow: 0 8px 24px rgba(32,66,151,0.10); transform: translateY(-1px); }
.pf-btn { transition: background .15s ease, box-shadow .15s ease, border-color .15s ease; }
.pf-btn-outline:hover { background: rgba(32,66,151,0.06); }
.pf-btn-solid:hover { filter: brightness(1.06); box-shadow: 0 6px 18px rgba(32,66,151,0.25); }
.pf-btn-danger:hover { background: rgba(220,38,38,0.06); }
.pf-tab:hover { color: #204297; }
.pf-row:hover { background: #FAFBFF; }
.pf-avatar-edit:hover { filter: brightness(1.1); }
`;

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

type Allocation = {
    id: string;
    daily_work_id: string;
    employee_id: string;
    allocated_qty: number;
    status: string;
    submitted_qty: number | null;
    submission_reason: string | null;
    submitted_at: string | null;
    workDate: string | null;
    productName: string | null;
    description?: string | null;
    team?: string | null;
    allocatedByName?: string | null;
    created_at: string;
};

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
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [employee, setEmployee] = useState<EmployeeData | null>(null);
    const [allocations, setAllocations] = useState<Allocation[]>([]);
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
    const [teamFilter, setTeamFilter] = useState("all");
    const [search, setSearch] = useState("");

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [submitQty, setSubmitQty] = useState("");
    const [submitReason, setSubmitReason] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

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
            const [profileRes, employeeRes, allocRes] = await Promise.all([
                authFetch(`${API_BASE}/api/profile`),
                myId ? authFetch(`${API_BASE}/api/employees/${myId}`) : Promise.resolve(null),
                myId
                    ? authFetch(`${API_BASE}/api/allocations?employeeId=${myId}`)
                    : Promise.resolve(null),
            ]);

            if (profileRes) {
                const json = await safeJson(profileRes);
                if (profileRes.ok && json.success) setProfile(json.data);
            }
            if (employeeRes) {
                const emp = await safeJson(employeeRes);
                if (employeeRes.ok) setEmployee(emp);
            }
            if (allocRes) {
                const json = await safeJson(allocRes);
                if (allocRes.ok && json.success) setAllocations(json.data || []);
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

    const { todaysAllocations, pastAllocations } = useMemo(() => {
        const today = todayStr();
        const sorted = [...allocations].sort((a, b) =>
            (b.workDate || "").localeCompare(a.workDate || "")
        );
        return {
            todaysAllocations: sorted.filter((a) => a.workDate === today),
            pastAllocations: sorted.filter((a) => a.workDate !== today),
        };
    }, [allocations]);

    const products = useMemo(
        () =>
            Array.from(new Set(allocations.map((a) => a.productName).filter(Boolean))) as string[],
        [allocations]
    );
    const teams = useMemo(
        () => Array.from(new Set(allocations.map((a) => a.team).filter(Boolean))) as string[],
        [allocations]
    );

    const baseRows = activeTab === "today" ? todaysAllocations : pastAllocations;

    const filteredRows = useMemo(() => {
        return baseRows.filter((a) => {
            if (dateFilter && a.workDate !== dateFilter) return false;
            if (productFilter !== "all" && a.productName !== productFilter) return false;
            if (teamFilter !== "all" && a.team !== teamFilter) return false;
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                const hay =
                    `${a.productName || ""} ${a.team || ""} ${a.status || ""} ${a.allocatedByName || ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [baseRows, dateFilter, productFilter, teamFilter, search]);

    const stats = useMemo(() => {
        const totalAllocated = todaysAllocations.reduce((s, a) => s + (a.allocated_qty || 0), 0);
        const submittedQty = todaysAllocations.reduce((s, a) => s + (a.submitted_qty ?? 0), 0);
        const pendingCount = todaysAllocations.filter(
            (a) => a.submitted_qty === null || a.submitted_qty === undefined
        ).length;
        const remaining = Math.max(totalAllocated - submittedQty, 0);
        return { totalAllocated, submittedQty, pendingCount, remaining };
    }, [todaysAllocations]);

    const selected = allocations.find((a) => a.id === selectedId) || null;
    const submitDifference = selected ? Number(submitQty || 0) - selected.allocated_qty : 0;

    useEffect(() => {
        if (selected) {
            setSubmitQty(
                selected.submitted_qty !== null && selected.submitted_qty !== undefined
                    ? String(selected.submitted_qty)
                    : String(selected.allocated_qty)
            );
            setSubmitReason("");
            setSubmitError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    const handlePickForSubmit = (a: Allocation) => {
        setSelectedId(a.id);
        setTimeout(
            () => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
            50
        );
    };

    const handleSubmitWork = async () => {
        if (!selected) return;
        const qtyNum = Number(submitQty);
        setSubmitError(null);

        if (Number.isNaN(qtyNum) || qtyNum < 0) {
            setSubmitError("Enter a valid quantity.");
            return;
        }
        const differs = qtyNum !== selected.allocated_qty;
        if (differs && !submitReason.trim()) {
            setSubmitError("Please select a reason for the difference.");
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/allocations/${selected.id}/submit`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    submittedQty: qtyNum,
                    reason: differs ? submitReason.trim() : undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Failed to submit work");
            setSelectedId(null);
            await loadAll();
        } catch (err: any) {
            setSubmitError(err?.message || "Failed to submit work");
        } finally {
            setSubmitting(false);
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
        const header = [
            "#",
            "Product",
            "Description",
            "Team",
            "Allocated By",
            "Allocated Qty",
            "Status",
        ];
        const rows = filteredRows.map((a, i) => [
            i + 1,
            a.productName || "-",
            a.description || "-",
            a.team || "-",
            a.allocatedByName || "-",
            a.allocated_qty,
            a.submitted_qty != null ? "Submitted" : "Pending",
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

            <style>{HOVER_CSS}</style>

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
                            <span style={styles.roleBadge}>
                                {(role || "-").toString().toUpperCase()}
                            </span>
                            {uploadingPhoto && (
                                <div style={styles.smallMuted}>Uploading photo…</div>
                            )}
                            {photoError && <p style={styles.rowError}>{photoError}</p>}
                        </div>
                    </div>

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

                <div style={isMobile ? styles.identityGridMobile : styles.identityGrid}>
                    <div style={styles.identityColumn}>
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
                        <InfoIconRow icon={<TeamIcon />} label="Team" value={team} />
                        <InfoIconRow icon={<DeptIcon />} label="Department" value={department} />
                        <InfoIconRow icon={<UserIcon />} label="Manager" value={manager} />
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

                {editingProfile && (
                    <button
                        type="button"
                        className="pf-btn pf-btn-outline"
                        style={styles.cancelEditBtn}
                        onClick={cancelEditProfile}
                    >
                        Cancel
                    </button>
                )}

                <div style={styles.logoutRow}>
                    <button
                        className="pf-btn pf-btn-danger"
                        style={styles.logoutButton}
                        onClick={onLogout}
                    >
                        Logout
                    </button>
                </div>
            </div>

            {/* ---- Stats ---- */}
            <div style={isMobile ? styles.statsGridMobile : styles.statsGrid}>
                <StatCard
                    icon={<BoxIcon />}
                    tint={BRAND.blue}
                    value={stats.totalAllocated}
                    label="Total Allocation"
                    sub="Total tasks allocated today"
                />
                <StatCard
                    icon={<CheckIcon />}
                    tint={BRAND.green}
                    value={stats.submittedQty}
                    label="Submitted"
                    sub="Completed & submitted"
                />
                <StatCard
                    icon={<ClockIcon />}
                    tint={BRAND.lightBlue}
                    value={stats.pendingCount}
                    label="Pending"
                    sub="Awaiting submission"
                />
                <StatCard
                    icon={<AlertIcon />}
                    tint={BRAND.amber}
                    value={stats.remaining}
                    label="Remaining"
                    sub="Yet to submit"
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
                <button
                    type="button"
                    className="pf-btn pf-btn-outline"
                    style={styles.exportBtn}
                    onClick={exportCsv}
                >
                    <DownloadIcon /> Export
                </button>
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
                    <label style={styles.smallLabel}>Product</label>
                    <select
                        style={styles.textInput}
                        value={productFilter}
                        onChange={(e) => setProductFilter(e.target.value)}
                    >
                        <option value="all">All Products</option>
                        {products.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={styles.filterField}>
                    <label style={styles.smallLabel}>Team</label>
                    <select
                        style={styles.textInput}
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                    >
                        <option value="all">All Teams</option>
                        {teams.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={{ ...styles.filterField, flex: 1 }}>
                    <label style={styles.smallLabel}>Search</label>
                    <input
                        style={styles.textInput}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by product, team or status…"
                    />
                </div>
            </div>

            {/* ---- Table / mobile list ---- */}
            <div className="pf-card-hover" style={styles.tableCard}>
                {loading ? (
                    <EmptyState text="Loading…" />
                ) : filteredRows.length === 0 ? (
                    <EmptyState
                        text={
                            activeTab === "today"
                                ? "No allocation found for today."
                                : "No past allocations found."
                        }
                    />
                ) : isMobile ? (
                    <div style={styles.allocList}>
                        {filteredRows.map((a, i) => (
                            <MobileRow
                                key={a.id}
                                index={i + 1}
                                a={a}
                                onSubmit={() => handlePickForSubmit(a)}
                            />
                        ))}
                    </div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th}>#</th>
                                <th style={styles.th}>Task / Product</th>
                                <th style={styles.th}>Description</th>
                                <th style={styles.th}>Team</th>
                                <th style={styles.th}>Allocated By</th>
                                <th style={styles.th}>Allocated Qty</th>
                                <th style={styles.th}>Status</th>
                                <th style={styles.th}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRows.map((a, i) => {
                                const submitted =
                                    a.submitted_qty !== null && a.submitted_qty !== undefined;
                                return (
                                    <tr key={a.id} className="pf-row" style={styles.tr}>
                                        <td style={styles.td}>{i + 1}</td>
                                        <td style={{ ...styles.td, fontWeight: 700 }}>
                                            {a.productName || "-"}
                                        </td>
                                        <td style={styles.td}>{a.description || "-"}</td>
                                        <td style={styles.td}>{a.team || "-"}</td>
                                        <td style={styles.td}>{a.allocatedByName || "-"}</td>
                                        <td style={styles.td}>{a.allocated_qty}</td>
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
                                                    {a.submitted_qty} submitted
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    style={styles.rowSubmitBtn}
                                                    onClick={() => handlePickForSubmit(a)}
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
                        ? `Submit your progress for "${selected.productName || "this task"}"`
                        : "Select a task from the table above to submit your work."}
                </div>

                {selected && (
                    <div style={isMobile ? styles.submitGridMobile : styles.submitGrid}>
                        <div style={styles.filterField}>
                            <label style={styles.smallLabel}>Total Allocated Qty</label>
                            <input
                                style={{ ...styles.textInput, background: "#f5f5fa" }}
                                value={selected.allocated_qty}
                                disabled
                            />
                        </div>
                        <div style={styles.filterField}>
                            <label style={styles.smallLabel}>Submitted Qty *</label>
                            <input
                                type="number"
                                min={0}
                                style={styles.textInput}
                                value={submitQty}
                                onChange={(e) => setSubmitQty(e.target.value)}
                                placeholder="Enter submitted quantity"
                            />
                        </div>
                        <div style={styles.filterField}>
                            <label style={styles.smallLabel}>Difference</label>
                            <input
                                style={{ ...styles.textInput, background: "#f5f5fa" }}
                                value={
                                    submitDifference > 0 ? `+${submitDifference}` : submitDifference
                                }
                                disabled
                            />
                        </div>
                        {submitDifference !== 0 && (
                            <div style={{ ...styles.filterField, flex: 1, minWidth: 180 }}>
                                <label style={styles.smallLabel}>Reason *</label>
                                <select
                                    style={styles.textInput}
                                    value={submitReason}
                                    onChange={(e) => setSubmitReason(e.target.value)}
                                >
                                    <option value="">Select reason</option>
                                    {REASON_OPTIONS.map((r) => (
                                        <option key={r} value={r}>
                                            {r}
                                        </option>
                                    ))}
                                </select>
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
                            If you submit less or more than the allocated quantity, please select a
                            reason for the difference.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    className="pf-btn pf-btn-solid"
                    style={{
                        ...styles.submitBtn,
                        opacity: !selected || submitting ? 0.6 : 1,
                        cursor: !selected || submitting ? "not-allowed" : "pointer",
                    }}
                    disabled={!selected || submitting}
                    onClick={handleSubmitWork}
                >
                    {submitting ? "Submitting…" : "Submit Work"}
                </button>
            </div>
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Small presentational subcomponents                                     */
/* ---------------------------------------------------------------------- */

function InfoIconRow({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div style={styles.infoIconRow}>
            <span style={styles.contactIcon}>{icon}</span>
            <div style={styles.infoTextWrap}>
                <span style={styles.infoLabel}>{label}</span>
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
}: {
    icon: React.ReactNode;
    tint: string;
    value: number;
    label: string;
    sub: string;
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

function EmptyState({ text }: { text: string }) {
    return <div style={styles.emptyState}>{text}</div>;
}

function MobileRow({ index, a, onSubmit }: { index: number; a: Allocation; onSubmit: () => void }) {
    const submitted = a.submitted_qty !== null && a.submitted_qty !== undefined;
    return (
        <div style={styles.mobileCard}>
            <div style={styles.mobileCardTop}>
                <span style={styles.mobileIndex}>#{index}</span>
                <span style={styles.mobileProduct}>{a.productName || "-"}</span>
                <span style={submitted ? styles.statusDone : styles.statusPending}>
                    {submitted ? "Submitted" : "Pending"}
                </span>
            </div>
            <div style={styles.mobileMetaRow}>
                <span>{formatDisplayDate(a.workDate)}</span>
                <span>{a.team || "-"}</span>
                <span>Qty: {a.allocated_qty}</span>
            </div>
            {submitted ? (
                <div style={styles.smallMuted}>{a.submitted_qty} submitted</div>
            ) : (
                <button type="button" style={styles.rowSubmitBtn} onClick={onSubmit}>
                    Submit
                </button>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Styles — width/padding/gap now match the Dashboard & Products pages   */
/*  (full-width container, same padding scale, same card radius/shadow). */
/*  All content below is unchanged from what's currently running.         */
/* ---------------------------------------------------------------------- */

const styles: Record<string, CSSProperties> = {
    topBar: {
        height: "4px",
        width: "100%",
        borderRadius: 4,
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
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    rootMobile: {
        width: "100%",
        boxSizing: "border-box",
        padding: "14px 14px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },

    pageHeaderRow: {},
    pageTitleBlock: {},
    pageTitle: { margin: 0, fontSize: 24, fontWeight: 800, color: "#17181C" },
    pageSubtitle: { margin: "4px 0 0", fontSize: 13, color: "#767F92" },

    noteWarning: {
        fontSize: 12,
        color: "#92400E",
        background: "rgba(245,158,11,0.1)",
        padding: "8px 12px",
        borderRadius: 6,
    },

    /* Identity card */
    identityCard: {
        background: "#fff",
        borderRadius: 16,
        padding: 12,
        border: "1px solid #F0F1F7",
        boxShadow: "0 4px 20px rgba(32,66,151,.06)",
    },
    identityTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 10,
    },
    identityTopMobile: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 },
    avatarBlock: { display: "flex", alignItems: "center", gap: 12 },
    avatarWrap: { position: "relative", flexShrink: 0 },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: GRADIENT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        fontWeight: 700,
        boxShadow: `0 0 0 4px rgba(32,66,151,0.08)`,
    },
    avatarImg: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        objectFit: "cover",
        boxShadow: `0 0 0 4px rgba(32,66,151,0.08)`,
    },
    avatarEditBtn: {
        position: "absolute",
        right: -2,
        bottom: -2,
        width: 24,
        height: 24,
        borderRadius: "50%",
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
    name: { fontSize: 18, fontWeight: 700, color: "#17181C" },
    activePill: {
        fontSize: 10.5,
        fontWeight: 700,
        color: BRAND.green,
        background: "rgba(46,187,168,0.12)",
        padding: "2px 9px",
        borderRadius: 12,
    },
    roleBadge: {
        display: "inline-block",
        marginTop: 4,
        fontSize: 11,
        fontWeight: 700,
        color: "#fff",
        background: GRADIENT,
        padding: "3px 10px",
        borderRadius: 999,
        letterSpacing: 0.3,
    },
    editProfileBtn: {
        border: `1px solid ${BRAND.blue}`,
        background: "#fff",
        color: BRAND.blue,
        fontWeight: 700,
        fontSize: 13,
        padding: "9px 18px",
        borderRadius: 8,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    cancelEditBtn: {
        border: "1px solid #e5e7eb",
        background: "#fff",
        color: "#767F92",
        fontWeight: 600,
        fontSize: 12.5,
        padding: "7px 14px",
        borderRadius: 8,
        cursor: "pointer",
        marginTop: 8,
        marginRight: 10,
    },

    identityGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1.2fr",
        gap: 10,
        borderTop: "1px solid #f1f1f1",
        paddingTop: 9,
    },
    identityGridMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderTop: "1px solid #f1f1f1",
        paddingTop: 8,
    },
    identityColumn: { display: "flex", flexDirection: "column", gap: 7 },
    contactRow: { display: "flex", alignItems: "center", gap: 10 },
    contactIcon: { color: BRAND.lightBlue, flexShrink: 0, display: "flex" },
    contactValue: { fontSize: 13.5, color: "#3D4459", fontWeight: 500 },
    infoIconRow: { display: "flex", alignItems: "flex-start", gap: 10 },
    infoTextWrap: { display: "flex", flexDirection: "column", gap: 2 },
    infoLabel: { fontSize: 11, color: "#9099AC" },
    infoValue: { fontSize: 13.5, color: "#17181C", fontWeight: 600 },
    aboutBox: {
        background: "#EEF1FB",
        borderRadius: 12,
        padding: 10,
        borderLeft: `3px solid ${BRAND.blue}`,
    },
    aboutTitle: { fontSize: 12.5, fontWeight: 700, color: BRAND.blue, marginBottom: 6 },
    aboutText: { margin: 0, fontSize: 13, color: "#3D4459", lineHeight: 1.5 },
    aboutTextarea: {
        width: "100%",
        border: "1px solid #dbe1f5",
        borderRadius: 8,
        padding: 10,
        fontSize: 13,
        fontFamily: "inherit",
        color: "#17181C",
        resize: "vertical",
        boxSizing: "border-box",
    },
    editField: { display: "flex", flexDirection: "column", gap: 4 },
    logoutRow: {
        display: "flex",
        justifyContent: "flex-end",
        marginTop: 18,
    },
    logoutButton: {
        padding: "10px 18px",
        borderRadius: 8,
        border: `1px solid ${BRAND.red}`,
        background: "#fff",
        color: BRAND.red,
        fontWeight: 600,
        fontSize: 13,
        cursor: "pointer",
    },

    /* Stats */
    statsGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
    },
    statsGridMobile: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
    statCard: {
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 18px rgba(32,66,151,.06)",
    },
    statIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    statValue: { fontSize: 20, fontWeight: 800, lineHeight: 1.1 },
    statLabel: { fontSize: 12.5, fontWeight: 700, color: "#17181C", marginTop: 2 },
    statSub: { fontSize: 10.5, color: "#9099AC", marginTop: 1 },

    /* Tabs */
    tabsRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
    },
    tabsGroup: { display: "flex", gap: 8, background: "#EEF1FB", padding: 4, borderRadius: 10 },
    tab: {
        border: "none",
        background: "transparent",
        color: "#767F92",
        fontWeight: 600,
        fontSize: 13,
        padding: "8px 16px",
        borderRadius: 8,
        cursor: "pointer",
    },
    tabActive: {
        border: "none",
        background: BRAND.blue,
        color: "#fff",
        fontWeight: 700,
        fontSize: 13,
        padding: "8px 16px",
        borderRadius: 8,
        cursor: "pointer",
    },
    exportBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid #e5e7eb",
        background: "#fff",
        color: "#3D4459",
        fontWeight: 600,
        fontSize: 12.5,
        padding: "9px 14px",
        borderRadius: 8,
        cursor: "pointer",
    },

    /* Filters */
    filterRow: {
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 4px 18px rgba(32,66,151,.06)",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: 14,
        padding: 14,
        boxShadow: "0 4px 18px rgba(32,66,151,.06)",
    },
    filterField: { display: "flex", flexDirection: "column", gap: 4, minWidth: 150 },
    smallLabel: { fontSize: 11, fontWeight: 600, color: "#3D4459" },
    textInput: {
        padding: "9px 10px",
        background: "#fafafa",
        border: "1px solid #ececf5",
        outline: "none",
        fontSize: 13,
        borderRadius: 8,
        boxSizing: "border-box",
        color: "#17181C",
        fontFamily: "inherit",
    },

    /* Table */
    tableCard: {
        background: "#fff",
        borderRadius: 14,
        padding: 6,
        boxShadow: "0 4px 18px rgba(32,66,151,.06)",
        overflowX: "auto",
    },
    table: { width: "100%", borderCollapse: "collapse", minWidth: 720 },
    th: {
        textAlign: "left",
        fontSize: 11.5,
        color: "#9099AC",
        fontWeight: 700,
        padding: "12px 14px",
        borderBottom: "1px solid #f1f1f1",
        whiteSpace: "nowrap",
    },
    tr: {},
    td: { fontSize: 13, color: "#3D4459", padding: "12px 14px", borderBottom: "1px solid #f6f6f9" },
    statusDone: {
        fontSize: 11,
        fontWeight: 700,
        color: BRAND.green,
        background: "rgba(46,187,168,0.12)",
        padding: "3px 10px",
        borderRadius: 999,
    },
    statusPending: {
        fontSize: 11,
        fontWeight: 700,
        color: BRAND.amber,
        background: "rgba(245,158,11,0.12)",
        padding: "3px 10px",
        borderRadius: 999,
    },
    rowSubmitBtn: {
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: 7,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
    },

    emptyState: { padding: "36px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13 },

    /* Mobile list */
    allocList: { display: "flex", flexDirection: "column", gap: 10, padding: 8 },
    mobileCard: {
        background: "#fafafa",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    mobileCardTop: { display: "flex", alignItems: "center", gap: 8 },
    mobileIndex: { fontSize: 11, color: "#9099AC", fontWeight: 700 },
    mobileProduct: { fontSize: 13.5, fontWeight: 700, color: "#17181C", flex: 1 },
    mobileMetaRow: { display: "flex", gap: 12, fontSize: 12, color: "#767F92", flexWrap: "wrap" },

    /* Submit panel */
    submitPanel: {
        background: "#fff",
        borderRadius: 16,
        padding: 22,
        boxShadow: "0 4px 18px rgba(32,66,151,.06)",
    },
    submitPanelTitle: { fontSize: 15.5, fontWeight: 800, color: BRAND.blue },
    submitPanelSub: { fontSize: 12.5, color: "#767F92", marginTop: 3, marginBottom: 16 },
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
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 12,
        color: "#3D4459",
        marginBottom: 16,
    },
    infoBoxIcon: { color: BRAND.blue, flexShrink: 0, marginTop: 1 },
    submitBtn: {
        width: "100%",
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "13px",
        fontSize: 14,
        fontWeight: 700,
    },
    rowError: { margin: "6px 0 0", fontSize: 12, color: BRAND.red, fontWeight: 600 },
    smallMuted: { fontSize: 11.5, color: "#9099AC" },
};
