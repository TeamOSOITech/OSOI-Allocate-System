import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { authFetch } from "../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";
import { useRoleLabels } from "../context/roleLabelsContext";
import { useOrgSettings } from "../context/orgsettings";
import { useCollarMode } from "../context/collarmode";
import BlueAllocationBlock from "./blue/allocationblock";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

// NEW: only these roles get the "Search employee" box on the Profile page
// and can open another employee's profile (read-only, except they can
// submit work / resolve queries on that employee's behalf).
const VIEW_OTHERS_ROLES = ["SUPER_ADMIN", "OPS_MANAGER"];

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
// (inline style objects can't express :hover on their own).
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
.pf-emp-pill { transition: border-color .15s ease, box-shadow .15s ease; }
.pf-emp-pill:focus-within { border-color: ${BRAND.blue} !important; box-shadow: 0 6px 20px ${withAlpha(BRAND.blue, 0.18)} !important; }
.pf-emp-item { transition: background .12s ease; }
.pf-emp-item:hover { background: ${withAlpha(BRAND.blue, 0.08)}; }
.pf-emp-go { opacity: 0; transform: translateX(-4px); transition: opacity .15s ease, transform .15s ease; }
.pf-emp-item:hover .pf-emp-go { opacity: 1; transform: translateX(0); }
@keyframes pf-today-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--brand-green-rgb), 0.35), 0 6px 18px rgba(var(--brand-green-rgb), 0.12); }
  50% { box-shadow: 0 0 0 7px rgba(var(--brand-green-rgb), 0), 0 10px 26px rgba(var(--brand-green-rgb), 0.22); }
}
@keyframes pf-today-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes pf-today-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.7); } }
.pf-today-card { animation: pf-today-glow 2.2s ease-in-out infinite, pf-today-float 3.2s ease-in-out infinite; background: linear-gradient(180deg, rgba(var(--brand-green-rgb), 0.08), #fff 40%) !important; }
.pf-today-dot { animation: pf-today-dot 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .pf-today-card, .pf-today-dot { animation: none; } }
@keyframes pf-emp-pop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
`;
}

// Scrolls ONLY the page's own scroll area (<main>). element.scrollIntoView()
// would also scroll the height-locked app shell, pushing the header up and
// leaving it hidden until a refresh.
function scrollWithinPage(el: HTMLElement | null, offset = 12) {
    if (!el) return;
    let parent: HTMLElement | null = el.parentElement;
    while (parent) {
        const oy = getComputedStyle(parent).overflowY;
        if ((oy === "auto" || oy === "scroll") && parent.scrollHeight > parent.clientHeight) break;
        parent = parent.parentElement;
    }
    if (!parent) return;
    const top =
        el.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop -
        offset;
    parent.scrollTo({ top, behavior: "smooth" });
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

// submitted_at is a full timestamp (UTC). This gives the viewer's LOCAL
// calendar date (YYYY-MM-DD).
function localDateStr(iso: string | null) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

// NEW: the day (local, YYYY-MM-DD) this work was ALLOCATED to the employee.
// Today / Past split uses this, NOT the case's workDate — so an old pending
// case that is allocated today still shows under Today's Allocation.
// Falls back to workDate when there is no allocation timestamp.
function allocDay(allocatedAt?: string | null, workDate?: string | null) {
    return localDateStr(allocatedAt || null) || workDate || "";
}

function formatDisplayDate(iso: string | null) {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

// NEW: full timestamp -> "05-10-2026, 02:30 PM" (viewer's local time)
function formatDateTime(iso: string | null | undefined) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const date = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
    )}-${d.getFullYear()}`;
    const time = d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
    return `${date}, ${time}`;
}

// NEW: milliseconds -> "3h 20m"
function formatDuration(ms: number) {
    const mins = Math.floor(Math.max(ms, 0) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// NEW: minutes -> "2h 30m"
function formatMinutes(mins: number) {
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// Guards against the classic "Unexpected token '<' ... is not valid JSON"
// crash — when the API URL is wrong or the route 404s and the server
// sends back an HTML error page instead of JSON.
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

// NEW: one entry in the employee search dropdown (Super Admin / Ops Manager).
type SearchEmp = {
    id: string;
    name: string;
    email: string;
    team?: string | null;
    department?: string | null;
    designation?: string | null;
};

// Everything an employee can report when submitting a case. The stored
// value for "Completed by Team" is still DONE_BY_TEAM (only its label was
// renamed) so older rows keep working.
type SubmissionType = "COMPLETED" | "DONE_BY_TEAM" | "DONE_BY_CLIENT" | "QUERY" | "OUT_OF_SCOPE";
// What an open Query can be turned into once it's sorted out.
type QueryResolution = Exclude<SubmissionType, "QUERY" | "OUT_OF_SCOPE">;

// Dropdown order + labels, shared by the Submit panel and the Bulk modal.
const SUBMISSION_OPTIONS: { value: SubmissionType; label: string }[] = [
    { value: "COMPLETED", label: "Completed" },
    { value: "QUERY", label: "Query" },
    { value: "DONE_BY_TEAM", label: "Completed by Team" },
    { value: "DONE_BY_CLIENT", label: "Completed by Client" },
    { value: "OUT_OF_SCOPE", label: "Out of Scope" },
];
// Same list minus "Query" — what an open query can be completed as.
// "Query" and "Out of Scope" both need a typed reason before they can be submitted.
const needsReason = (t: string | null | undefined) => t === "QUERY" || t === "OUT_OF_SCOPE";
const reasonPlaceholder = (t: string | null | undefined) =>
    t === "OUT_OF_SCOPE" ? "Why is it out of scope?" : "Describe the query…";
// Request-body fields for a typed reason (backend: queryText for Query,
// reasonText for Out of Scope).
const reasonFields = (t: string | null | undefined, text: string) => ({
    queryText: t === "QUERY" ? text.trim() : undefined,
    reasonText: t === "OUT_OF_SCOPE" ? text.trim() : undefined,
});

const RESOLUTION_OPTIONS = SUBMISSION_OPTIONS.filter(
    (o) => o.value !== "QUERY" && o.value !== "OUT_OF_SCOPE"
) as {
    value: QueryResolution;
    label: string;
}[];

type CaseRow = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    workDate: string;
    profile: string;
    allocationStatus: string;
    // NEW: when this case was allocated to me (timestamp)
    allocatedAt?: string | null;
    submissionStatus: "PENDING" | "SUBMITTED";
    submissionType: SubmissionType | null;
    queryText: string;
    submittedAt: string | null;
    clientId?: string | null;
    clientName?: string | null;
    subclientId?: string | null;
    subclientName?: string | null;
    // NEW: read-only history row — this case was allocated to the employee
    // on an earlier day, was still pending when that day ended, and has
    // since been returned to the pool. No Submit option.
    missed?: boolean;
    returnedAt?: string | null;
};

function isSubmitted(c: CaseRow) {
    return c.submissionStatus === "SUBMITTED";
}

// Turns the stored submission_type into the label shown in the
// Outcome column (and anywhere else an outcome needs to read nicely).
function outcomeLabel(type: CaseRow["submissionType"]) {
    return SUBMISSION_OPTIONS.find((o) => o.value === type)?.label ?? "-";
}

// A query that is still open — raised by the employee, not completed yet.
function isOpenQuery(c: CaseRow) {
    return isSubmitted(c) && c.submissionType === "QUERY";
}

// A query that has since been completed (backend keeps query_text on
// resolve, a normal submit clears it for non-query outcomes).
function isResolvedQuery(c: CaseRow) {
    return (
        isSubmitted(c) &&
        !!c.submissionType &&
        c.submissionType !== "QUERY" &&
        (c.queryText || "").trim() !== ""
    );
}

// NEW: pending -> "3h 20m ago" (how long since it was allocated),
// submitted -> "Done in 2h 10m" (allocation to submit).
function allocAgeLabel(c: CaseRow) {
    // missed (returned-to-pool) rows have no running timer
    if (c.missed) return "";
    if (!c.allocatedAt) return "";
    const start = new Date(c.allocatedAt).getTime();
    if (Number.isNaN(start)) return "";
    if (isSubmitted(c) && c.submittedAt) {
        return `Done in ${formatDuration(new Date(c.submittedAt).getTime() - start)}`;
    }
    return `${formatDuration(Date.now() - start)} ago`;
}

// ---- "Normal" (quantity-based) allocation — the OLDER flow, from
// Daily Work batches via /api/allocations.
type BatchRow = {
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
    carried_in_qty?: number | null;
};

function isBatchDone(b: BatchRow) {
    return (
        b.submitted_qty !== null &&
        b.submitted_qty !== undefined &&
        b.submitted_qty >= b.allocated_qty
    );
}
void isBatchDone;

// ---- Self Allocation modal — a service only shows up here if the
// LOGGED-IN EMPLOYEE'S OWN TEAM is one of the teams tagged on that service.
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

// clients / subclients for the "add client" dropdowns (ids are kept as
// strings everywhere so comparisons between <select> values and ids work).
type ClientOption = { id: string; name: string; status?: string | null };
type SubclientOption = { id: string; name: string; clientId: string; status?: string | null };

// COUNT-ONLY work ("20 cases pending", no case numbers yet).
//  - MyCountRow: units allocated to ME that still need real case numbers.
//  - AvailableCountRow: units nobody has taken yet (Self Allocate -> Counts).
type MyCountRow = {
    id: string;
    productId: string;
    productName: string | null;
    clientId: string | null;
    clientName: string | null;
    subclientId: string | null;
    subclientName: string | null;
    workDate: string;
    quantity: number;
    allocatedToMe: number;
    addedByMe: number;
    remaining: number;
    // NEW: when these units were allocated to me (timestamp)
    allocatedAt?: string | null;
    // NEW: read-only history row — these units were allocated to me on an
    // earlier day, never got their case numbers and went back to the pool.
    missed?: boolean;
    returnedAt?: string | null;
};
type AvailableCountRow = {
    id: string;
    productId: string;
    productName: string | null;
    clientId: string | null;
    clientName: string | null;
    subclientId: string | null;
    subclientName: string | null;
    workDate: string;
    quantity: number;
    unallocated: number;
    allocatedToMe: number;
};

// one row in the "Add Case Numbers" popup: case number + its own
// client / subclient + its status. Every case can have a DIFFERENT client.
// "WIP" and "PENDING" both mean "just add the case, don't submit it yet".
type AddCnRow = {
    cn: string;
    status: "WIP" | "PENDING" | SubmissionType;
    query: string;
    clientId: string;
    subclientId: string;
};

// a fresh row — if the count already has a client / subclient, start with it
// (the user can still change it per case).
const blankAddCnRow = (mc: MyCountRow | null): AddCnRow => ({
    cn: "",
    status: "WIP",
    query: "",
    clientId: mc?.clientId || "",
    subclientId: mc?.subclientId || "",
});

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
    <Icon size={17}>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
        <circle cx="12" cy="13" r="4" />
    </Icon>
);
const PencilIcon = () => (
    <Icon size={18}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
);
const BoxIcon = () => (
    <Icon>
        <path d="m21 8-9-5-9 5 9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
    </Icon>
);
const CalendarIcon = () => (
    <Icon>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
    </Icon>
);
const ChatIcon = () => (
    <Icon>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z" />
        <path d="M9 11h6M9 14h4" />
    </Icon>
);
const LayersIcon = () => (
    <Icon>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 13 9 5 9-5" />
    </Icon>
);
const ArrowRightIcon = () => (
    <Icon>
        <path d="M5 12h14M13 6l6 6-6 6" />
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
const QueryIcon = () => (
    <Icon>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
    </Icon>
);

// Bolds the part of `text` that matches what the user typed in the search box.
function HighlightMatch({ text, q, color }: { text: string; q: string; color: string }) {
    const query = q.trim();
    if (!query) return <>{text}</>;
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, i)}
            <span style={{ color, background: `${color}1A`, borderRadius: 4, padding: "0 2px" }}>
                {text.slice(i, i + query.length)}
            </span>
            {text.slice(i + query.length)}
        </>
    );
}

function empInitials(name: string) {
    return (
        name
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join("") || "?"
    );
}

/* ---------------------------------------------------------------------- */
/*  Main component                                                         */
/* ---------------------------------------------------------------------- */

export default function Profile({ onLogout }: ProfileProps) {
    void onLogout;
    const isMobile = useIsMobile();
    // Blue Collar (manpower) mode: the service-based case / allocation /
    // query sections below don't apply, so they are hidden and a simple
    // work-submission history is shown instead.
    const { mode: collarMode, isBlue: isBlueMode } = useCollarMode();
    const { colors: themeColors } = useTheme();
    const { getRoleLabel } = useRoleLabels();
    // Org setting: when OFF, count work can be completed without case numbers.
    const { caseNumberRequired } = useOrgSettings();
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
    const [batches, setBatches] = useState<BatchRow[]>([]);
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
    const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);

    const [activeTab, setActiveTab] = useState<"today" | "past">("today");
    // NEW: cases allocated to me earlier that I left pending (returned to the pool)
    const [missedCases, setMissedCases] = useState<CaseRow[]>([]);
    // Which list is open under the tabs — "Cases" or "Counts".
    const [allocView, setAllocView] = useState<"cases" | "counts">("cases");
    const [dateFilter, setDateFilter] = useState("");
    const [productFilter, setProductFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "PENDING" | "SUBMITTED">("all");
    const [search, setSearch] = useState("");
    // Which stat card's table is open (null = table hidden, like the
    // Production Report's "View Details").
    const [openCard, setOpenCard] = useState<null | "all" | "submitted" | "pending" | "pendingNo">(
        null
    );
    // Top 5 cards: "daily" = today only, "monthly" = whole current month.
    const [statPeriod, setStatPeriod] = useState<"daily" | "monthly">("daily");
    const detailRef = useRef<HTMLDivElement>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [submitType, setSubmitType] = useState<"" | SubmissionType>("");
    const [submitQueryText, setSubmitQueryText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // Row-level submit (Status dropdown inside the table, Submit button at the end)
    const [rowTypeById, setRowTypeById] = useState<Record<string, "" | SubmissionType>>({});
    const [rowQueryById, setRowQueryById] = useState<Record<string, string>>({});
    const [rowSubmittingId, setRowSubmittingId] = useState<string | null>(null);
    const [rowError, setRowError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // ---- Bulk Submit (every pending case for today, in one click) ----
    const [showBulkModal, setShowBulkModal] = useState(false);
    // Rows default to "PENDING" (shown as "WIP") — meaning "not touched,
    // don't submit this one".
    const [bulkTypeById, setBulkTypeById] = useState<Record<string, "PENDING" | SubmissionType>>(
        {}
    );
    const [bulkQueryById, setBulkQueryById] = useState<Record<string, string>>({});
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [bulkSearch, setBulkSearch] = useState("");

    // ---- All Query modal ----
    const [showQueryModal, setShowQueryModal] = useState(false);
    const [queryView, setQueryView] = useState<"OPEN" | "RESOLVED">("OPEN");
    const [querySearch, setQuerySearch] = useState("");
    const [resolveTypeById, setResolveTypeById] = useState<Record<string, QueryResolution | "">>(
        {}
    );
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [queryNotice, setQueryNotice] = useState<string | null>(null);

    // ---- Self Allocation modal ----
    const [showSelfAllocModal, setShowSelfAllocModal] = useState(false);
    const [selfAllocServices, setSelfAllocServices] = useState<ServiceOption[]>([]);
    const [selfAllocServicesLoading, setSelfAllocServicesLoading] = useState(false);
    const [selfAllocServicesError, setSelfAllocServicesError] = useState<string | null>(null);
    const [selfAllocServiceId, setSelfAllocServiceId] = useState<string>("");
    const [selfAllocCases, setSelfAllocCases] = useState<SelfAllocCase[]>([]);
    const [selfAllocCasesLoading, setSelfAllocCasesLoading] = useState(false);
    const [selfAllocCasesError, setSelfAllocCasesError] = useState<string | null>(null);
    const [selfAllocSelectedIds, setSelfAllocSelectedIds] = useState<Set<string>>(new Set());
    const [selfAllocSubmitting, setSelfAllocSubmitting] = useState(false);
    const [selfAllocSuccessCount, setSelfAllocSuccessCount] = useState<number | null>(null);
    const [selfAllocToast, setSelfAllocToast] = useState("");

    // Self Allocate can also take COUNT-ONLY work (no case number yet).
    const [selfAllocMode, setSelfAllocMode] = useState<"cases" | "counts">("cases");
    const [availableCounts, setAvailableCounts] = useState<AvailableCountRow[]>([]);
    const [availableCountsLoading, setAvailableCountsLoading] = useState(false);
    const [availableCountsError, setAvailableCountsError] = useState<string | null>(null);
    const [selfAllocQtyById, setSelfAllocQtyById] = useState<Record<string, number>>({});

    // Counts allocated to me (today AND past, including fully-added ones).
    const [myCounts, setMyCounts] = useState<MyCountRow[]>([]);
    // counts left without case numbers at day end (returned to the pool) — read-only
    const [missedCounts, setMissedCounts] = useState<MyCountRow[]>([]);
    // "Add Case Numbers" popup for one of those counts. Client / subclient
    // now live on EACH ROW (addCnRows), not as one popup-wide value.
    const [addCnCount, setAddCnCount] = useState<MyCountRow | null>(null);
    const [addCnRows, setAddCnRows] = useState<AddCnRow[]>([]);
    // Clients allowed in the popup: ONLY active clients mapped to this
    // count's service (from /api/service-cases/product-clients/:productId).
    const [addCnClients, setAddCnClients] = useState<ClientOption[]>([]);
    const [addCnClientsLoading, setAddCnClientsLoading] = useState(false);
    const [addCnSubmitting, setAddCnSubmitting] = useState(false);
    const [addCnError, setAddCnError] = useState<string | null>(null);
    // client / subclient lists + saving state for the table's client column.
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [subclients, setSubclients] = useState<SubclientOption[]>([]);
    const [savingClientCaseId, setSavingClientCaseId] = useState<string | null>(null);
    const [clientCellError, setClientCellError] = useState<string | null>(null);

    // NEW: service AMP (time per case) in MINUTES, keyed by product id.
    // Comes from /api/products (time_taken + time_unit = minutes | hours).
    const [productAmp, setProductAmp] = useState<Record<string, number>>({});
    const ampOf = (productId: string | null | undefined) =>
        productId ? productAmp[String(productId)] || 0 : 0;

    // Success toast for Submit Work / Bulk Submit / completing a query.
    const [toastMsg, setToastMsg] = useState("");
    const toastTimerRef = useRef<number | null>(null);
    const showToast = (msg: string) => {
        setToastMsg(msg);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToastMsg(""), 3500);
    };
    useEffect(
        () => () => {
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        },
        []
    );

    const cachedUser = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();
    const myId: string | null = cachedUser?.id || cachedUser?.userId || null;

    // ---------------------------------------------------------------
    // NEW: Employee search (Super Admin / Ops Manager only).
    // Picking an employee opens THEIR profile on this same page, in the
    // same format. Submit / Bulk Submit / All Query work on their behalf
    // (onBehalfOf); everything else stays read-only. viewingRef is what
    // loadAll/refreshCases read (so they always see the latest value);
    // viewingId is state so the UI re-renders.
    // ---------------------------------------------------------------
    const canViewOthers = VIEW_OTHERS_ROLES.includes(String(cachedUser?.role || "").toUpperCase());
    // NEW: "Allocated At" shows date + time + AMP time + age on the manager side;
    // everyone else sees the date only.
    const showAllocatedAt = TEAM_QUERY_ROLES.includes(String(cachedUser?.role || "").toUpperCase());
    const viewingRef = useRef<string | null>(null);
    const [viewingId, setViewingId] = useState<string | null>(null);
    const isViewingOther = !!viewingId && viewingId !== myId;
    const [empList, setEmpList] = useState<SearchEmp[]>([]);
    const [empQuery, setEmpQuery] = useState("");
    const [empDropOpen, setEmpDropOpen] = useState(false);
    const empBoxRef = useRef<HTMLDivElement>(null);

    const loadEmpList = async () => {
        if (!canViewOthers) return;
        try {
            const res = await authFetch(`${API_BASE}/api/employees?collar=${collarMode}`, {
                cache: "no-store",
            });
            if (!res.ok) return;
            const list = await res.json();
            setEmpList(
                (Array.isArray(list) ? list : list?.data || []).map((e: any) => ({
                    id: String(e.id),
                    name: e.name || "",
                    email: e.email || "",
                    team: e.team || null,
                    department: e.department || null,
                    designation: e.designation || null,
                }))
            );
        } catch (err) {
            console.error("Failed to load employees list:", err);
        }
    };

    const empMatches = useMemo(() => {
        const q = empQuery.trim().toLowerCase();
        if (!q) return [];
        return empList
            .filter(
                (e) =>
                    e.id !== String(myId) &&
                    `${e.name} ${e.email} ${e.team || ""} ${e.department || ""}`
                        .toLowerCase()
                        .includes(q)
            )
            .slice(0, 8);
    }, [empQuery, empList, myId]);

    // Close the search dropdown when clicking anywhere outside it.
    useEffect(() => {
        if (!empDropOpen) return;
        const onDown = (e: MouseEvent) => {
            if (empBoxRef.current && !empBoxRef.current.contains(e.target as Node)) {
                setEmpDropOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [empDropOpen]);

    // Alt+K focuses the employee search (only for roles that have it).
    const empInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!canViewOthers) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.altKey && e.key.toLowerCase() === "k") {
                e.preventDefault();
                empInputRef.current?.focus();
                setEmpDropOpen(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canViewOthers]);

    // Opens another employee's profile (id) or goes back to your own (null).
    const openEmployee = (id: string | null) => {
        const next = id && id !== String(myId) ? id : null;
        viewingRef.current = next;
        setViewingId(next);
        setEmpQuery("");
        setEmpDropOpen(false);
        setSelectedId(null);
        setEditingProfile(false);
        setProfileSaveError(null);
        setPhotoError(null);
        setActiveTab("today");
        setAllocView("cases");
        setDateFilter("");
        setProductFilter("all");
        setStatusFilter("all");
        setSearch("");
        setOpenCard(null);
        setShowQueryModal(false);
        setCases([]);
        setBatches([]);
        setMyCounts([]);
        setMissedCounts([]);
        setEmployee(null);
        setProfile(null);
        setPhotoPreview(null);
        loadAll();
    };

    // All counts allocated to me — every date, and also the ones whose case
    // numbers are all added already (remaining = 0), so Past Allocation can
    // show them as done.
    const loadMyCounts = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/my-counts?includeAll=true`);
            const json = await safeJson(res);
            if (res.ok && json.success) setMyCounts(json.data?.mine || []);
        } catch (err) {
            console.error("Failed to load my counts:", err);
        }
    };

    // Count units that were left without case numbers when their day ended
    // (already back in the pool) — shown read-only under Past Allocation.
    const loadMissedCounts = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/my-missed-counts`);
            const json = await safeJson(res);
            if (res.ok && json.success) {
                setMissedCounts(
                    (json.data || []).map((row: any) => ({
                        id: String(row.id),
                        productId: row.productId != null ? String(row.productId) : "",
                        productName: row.productName ?? null,
                        clientId: row.clientId != null ? String(row.clientId) : null,
                        clientName: row.clientName ?? null,
                        subclientId: row.subclientId != null ? String(row.subclientId) : null,
                        subclientName: row.subclientName ?? null,
                        workDate: row.workDate,
                        quantity: row.returnedQuantity ?? 0,
                        allocatedToMe: row.returnedQuantity ?? 0,
                        addedByMe: 0,
                        remaining: row.returnedQuantity ?? 0,
                        allocatedAt: row.allocatedAt ?? null,
                        missed: true,
                        returnedAt: row.returnedAt ?? null,
                    }))
                );
            }
        } catch (err) {
            console.error("Failed to load missed counts:", err);
        }
    };

    // client + subclient lists for the "add client / subclient" dropdowns.
    const loadClientLists = async () => {
        try {
            const [cRes, sRes] = await Promise.all([
                authFetch(`${API_BASE}/api/clients`),
                authFetch(`${API_BASE}/api/clients/all/subclients`),
            ]);
            if (cRes.ok) {
                const json = await safeJson(cRes);
                const list = Array.isArray(json) ? json : json?.data || [];
                setClients(
                    list.map((c: any) => ({ id: String(c.id), name: c.name, status: c.status }))
                );
            }
            if (sRes.ok) {
                const json = await safeJson(sRes);
                const list = Array.isArray(json) ? json : json?.data || [];
                setSubclients(
                    list.map((s: any) => ({
                        id: String(s.id),
                        name: s.name,
                        clientId: String(s.clientId),
                        status: s.status,
                    }))
                );
            }
        } catch (err) {
            console.error("Failed to load clients:", err);
        }
    };

    // NEW: loads every service's AMP (time per case, converted to minutes).
    const loadProductAmps = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            if (!res.ok) return;
            const json = await safeJson(res);
            const list = Array.isArray(json) ? json : json?.data || [];
            const map: Record<string, number> = {};
            list.forEach((p: any) => {
                const t = Number(p.time_taken);
                if (!t || Number.isNaN(t)) return;
                map[String(p.id)] = p.time_unit === "hours" ? t * 60 : t;
            });
            setProductAmp(map);
        } catch (err) {
            console.error("Failed to load service AMP:", err);
        }
    };

    // The cases URL: own cases (mine=true) or another employee's (employeeId=).
    const casesUrl = (targetId: string | null) =>
        targetId
            ? `${API_BASE}/api/service-cases?employeeId=${encodeURIComponent(targetId)}&pageSize=2000`
            : `${API_BASE}/api/service-cases?mine=true&pageSize=2000`;

    // NEW: past allocations that were left pending at day end (read-only).
    const loadMissed = async (targetId: string | null) => {
        try {
            const url = targetId
                ? `${API_BASE}/api/service-cases/my-missed?employeeId=${encodeURIComponent(targetId)}`
                : `${API_BASE}/api/service-cases/my-missed`;
            const res = await authFetch(url);
            const json = await safeJson(res);
            if (res.ok && json.success) {
                setMissedCases(
                    (json.data || []).map((row: any) => ({
                        id: String(row.id),
                        caseNumber: row.caseNumber,
                        productId: row.productId != null ? String(row.productId) : "",
                        productName: row.productName ?? null,
                        workDate: row.workDate,
                        profile: "",
                        allocationStatus: "PENDING",
                        allocatedAt: row.allocatedAt,
                        submissionStatus: "PENDING",
                        submissionType: null,
                        queryText: "",
                        submittedAt: null,
                        clientId: row.clientId != null ? String(row.clientId) : null,
                        clientName: row.clientName ?? null,
                        subclientId: row.subclientId != null ? String(row.subclientId) : null,
                        subclientName: row.subclientName ?? null,
                        missed: true,
                        returnedAt: row.returnedAt ?? null,
                    }))
                );
            }
        } catch (err) {
            console.error("Failed to load pending history:", err);
        }
    };

    const loadAll = async () => {
        setLoading(true);
        setError(null);
        try {
            // Which employee are we showing? null = me.
            const targetId =
                viewingRef.current && viewingRef.current !== String(myId)
                    ? viewingRef.current
                    : null;
            let selfId: string | null = targetId || myId;

            if (!targetId) {
                // Fetch the profile FIRST and read the user id straight off its
                // response (server-resolved from the auth token) rather than
                // from localStorage.
                const profileRes = await authFetch(`${API_BASE}/api/profile`);
                const profileJson = await safeJson(profileRes);
                if (profileRes.ok && profileJson.success) {
                    setProfile(profileJson.data);
                    selfId = profileJson.data?.user_id || selfId;
                }
            } else {
                setProfile(null);
            }

            const [employeeRes, casesRes, batchesRes] = await Promise.all([
                selfId ? authFetch(`${API_BASE}/api/employees/${selfId}`) : Promise.resolve(null),
                authFetch(casesUrl(targetId)),
                selfId
                    ? authFetch(`${API_BASE}/api/allocations?employeeId=${selfId}`)
                    : Promise.resolve(null),
            ]);

            if (employeeRes) {
                const emp = await safeJson(employeeRes);
                if (employeeRes.ok) setEmployee(emp);
            }
            const casesJson = await safeJson(casesRes);
            if (casesRes.ok && casesJson.success) {
                // ids normalized to strings so they match the client/subclient dropdowns
                setCases(
                    (casesJson.data || []).map((row: any) => ({
                        ...row,
                        productId: row.productId != null ? String(row.productId) : row.productId,
                        clientId: row.clientId != null ? String(row.clientId) : null,
                        subclientId: row.subclientId != null ? String(row.subclientId) : null,
                    }))
                );
            } else {
                console.error("Failed to load cases:", casesJson?.message);
            }
            if (batchesRes) {
                const batchesJson = await safeJson(batchesRes);
                if (batchesRes.ok && batchesJson.success) {
                    setBatches(batchesJson.data || []);
                } else {
                    console.error("Failed to load batch allocations:", batchesJson?.message);
                }
            }
            loadMissed(targetId);
            // Counts endpoint is always "me" — skip it when viewing someone else.
            if (!targetId) {
                loadMyCounts();
                loadMissedCounts();
            } else {
                setMyCounts([]);
                setMissedCounts([]);
            }
        } catch (err: any) {
            setError(err?.message || "Could not load your profile");
        } finally {
            setLoading(false);
        }
    };

    // Quietly re-reads just the cases (no full-page loading flash).
    const lastCasesRefreshRef = useRef(0);
    const refreshCases = async () => {
        lastCasesRefreshRef.current = Date.now();
        const targetId =
            viewingRef.current && viewingRef.current !== String(myId) ? viewingRef.current : null;
        try {
            loadMissed(targetId);
            const res = await authFetch(casesUrl(targetId));
            const json = await safeJson(res);
            if (res.ok && json.success) {
                setCases(
                    (json.data || []).map((row: any) => ({
                        ...row,
                        productId: row.productId != null ? String(row.productId) : row.productId,
                        clientId: row.clientId != null ? String(row.clientId) : null,
                        subclientId: row.subclientId != null ? String(row.subclientId) : null,
                    }))
                );
            }
        } catch (err) {
            console.error("Failed to refresh cases:", err);
        }
    };

    useEffect(() => {
        loadAll();
        loadClientLists();
        loadProductAmps();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // search list follows the White / Blue Collar mode
    useEffect(() => {
        loadEmpList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collarMode]);

    // While the All Query popup is open, re-check every 15s.
    useEffect(() => {
        if (!showQueryModal) return;
        const timer = window.setInterval(() => {
            // PERF: skip while the tab is hidden (it re-checks on focus anyway)
            if (!resolvingId && !document.hidden) refreshCases();
        }, 15000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showQueryModal, resolvingId]);

    // Coming back to this tab also re-checks.
    useEffect(() => {
        const onVisible = () => {
            if (
                document.visibilityState === "visible" &&
                Date.now() - lastCasesRefreshRef.current > 10000
            ) {
                refreshCases();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
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

    // Close the avatar lightbox on Escape.
    useEffect(() => {
        if (!isAvatarPreviewOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsAvatarPreviewOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isAvatarPreviewOpen]);

    // When viewing someone else, never fall back to the logged-in user's
    // own cached details (that would show YOUR email/role under THEIR name).
    const fallbackUser = isViewingOther ? null : cachedUser;

    // The employee record (user_master) is where a name edit is saved, so it
    // is the source of truth. `profiles.first_name/last_name` is only a copy
    // made at signup and goes stale after an edit - use it as a fallback.
    const profileName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    const name =
        employee?.name?.trim() ||
        profileName ||
        (fallbackUser?.firstName
            ? `${fallbackUser.firstName} ${fallbackUser.lastName || ""}`.trim()
            : fallbackUser?.email || "User");

    const email = profile?.email || employee?.email || fallbackUser?.email || "-";
    const role = profile?.role || employee?.role || fallbackUser?.role || "-";
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

    // CHANGED: Today / Past is decided by the day the case was ALLOCATED
    // (allocatedAt), not by the case's workDate. So an old pending case that
    // is allocated today shows under Today's Allocation.
    const { todaysCases, pastCases } = useMemo(() => {
        const today = todayStr();
        const sorted = [...cases].sort(
            (a, b) =>
                (b.workDate || "").localeCompare(a.workDate || "") ||
                (b.caseNumber || "").localeCompare(a.caseNumber || "")
        );
        return {
            todaysCases: sorted.filter((c) => allocDay(c.allocatedAt, c.workDate) === today),
            pastCases: sorted.filter((c) => allocDay(c.allocatedAt, c.workDate) !== today),
        };
    }, [cases]);

    // same today/past split for batch (quantity-based) allocations.
    const { todaysBatches } = useMemo(() => {
        const today = todayStr();
        const sorted = [...batches].sort((a, b) =>
            (b.workDate || "").localeCompare(a.workDate || "")
        );
        return {
            todaysBatches: sorted.filter((b) => b.workDate === today),
            pastBatches: sorted.filter((b) => b.workDate !== today),
        };
    }, [batches]);
    void todaysBatches;

    // service filter lists services from BOTH cases and counts.
    const products = useMemo(
        () =>
            Array.from(
                new Set(
                    [
                        ...cases.map((c) => c.productName),
                        ...myCounts.map((m) => m.productName),
                    ].filter(Boolean)
                )
            ) as string[],
        [cases, myCounts]
    );

    // NEW: Past Allocation = real past cases + the ones I left pending
    // (read-only history rows, newest first).
    const pastRows = useMemo(() => [...pastCases, ...missedCases], [pastCases, missedCases]);
    const baseRows = activeTab === "today" ? todaysCases : pastRows;

    const filteredRows = useMemo(() => {
        return baseRows.filter((c) => {
            // CHANGED: date filter matches the allocation day
            if (dateFilter && allocDay(c.allocatedAt, c.workDate) !== dateFilter) return false;
            if (productFilter !== "all" && c.productName !== productFilter) return false;
            if (statusFilter !== "all" && c.submissionStatus !== statusFilter) return false;
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                const hay =
                    `${c.caseNumber || ""} ${c.productName || ""} ${c.profile || ""} ${c.clientName || ""} ${c.subclientName || ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [baseRows, dateFilter, productFilter, statusFilter, search]);

    // counts for the active tab (Today / Past) — includes fully-added ones
    // (remaining = 0) so already-submitted counts still show in Past.
    // CHANGED: split by the day the count was allocated to me.
    const filteredCounts = useMemo(() => {
        const today = todayStr();
        const q = search.trim().toLowerCase();
        // returned-to-pool counts are history: Past tab only
        const source = activeTab === "today" ? myCounts : [...myCounts, ...missedCounts];
        return source
            .filter((m) =>
                activeTab === "today"
                    ? allocDay(m.allocatedAt, m.workDate) === today
                    : allocDay(m.allocatedAt, m.workDate) !== today
            )
            .filter((m) => !dateFilter || allocDay(m.allocatedAt, m.workDate) === dateFilter)
            .filter((m) => productFilter === "all" || m.productName === productFilter)
            .filter(
                (m) =>
                    !q ||
                    `${m.productName || ""} ${m.clientName || ""} ${m.subclientName || ""}`
                        .toLowerCase()
                        .includes(q)
            )
            .sort((a, b) => (b.workDate || "").localeCompare(a.workDate || ""));
    }, [myCounts, missedCounts, activeTab, dateFilter, productFilter, search]);

    // only the counts that still need case numbers (returned-to-pool ones can't be added to).
    const countsToAdd = useMemo(
        () => filteredCounts.reduce((s, m) => s + (m.missed ? 0 : m.remaining), 0),
        [filteredCounts]
    );

    const stats = useMemo(() => {
        const today = todayStr();
        const total = todaysCases.length;
        const submittedCount = todaysCases.filter(isSubmitted).length;
        const pendingCount = total - submittedCount;

        // NEW: allocated time = cases x service AMP (minutes). Cases with a
        // case number count 1 x AMP each; counts still waiting for case
        // numbers count remaining x AMP.
        const caseMins = todaysCases.reduce((s, c) => s + ampOf(c.productId), 0);
        // CHANGED: counts allocated today (by allocation day)
        const countMins = myCounts
            .filter((m) => allocDay(m.allocatedAt, m.workDate) === today)
            .reduce((s, m) => s + ampOf(m.productId) * m.remaining, 0);
        const allocatedMins = caseMins + countMins;

        // units allocated today that still wait for a case number
        const waitingToday = myCounts
            .filter((m) => allocDay(m.allocatedAt, m.workDate) === today)
            .reduce((s, m) => s + m.remaining, 0);
        // everything allocated today = cases with number + waiting counts
        const allocatedTotal = total + waitingToday;

        // NEW: utilised time = AMP of every case submitted today (an open
        // Query is not finished work, so it is not counted). It grows as the
        // employee submits cases.
        const utilisedMins = todaysCases
            .filter((c) => isSubmitted(c) && c.submissionType !== "QUERY")
            .reduce((s, c) => s + ampOf(c.productId), 0);

        return {
            total,
            submittedCount,
            pendingCount,
            // Pending shown on the cards = cases not submitted + counts
            // still waiting for a case number (pendingCount alone is kept
            // for Bulk Submit, which can only submit real cases)
            pendingTotal: pendingCount + waitingToday,
            allocatedMins,
            utilisedMins,
            waitingToday,
            allocatedTotal,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todaysCases, myCounts, productAmp]);

    // Past allocation totals (cases + counts still waiting for case numbers)
    const pastSummary = useMemo(() => {
        const today = todayStr();
        const waiting = myCounts
            .filter((m) => allocDay(m.allocatedAt, m.workDate) !== today)
            .reduce((sum, m) => sum + m.remaining, 0);
        const submitted = pastCases.filter(isSubmitted).length;
        const pending = pastCases.length - submitted + missedCases.length;
        return {
            total: pastCases.length + missedCases.length + waiting,
            withNo: pastCases.length + missedCases.length,
            waiting,
            submitted,
            pending,
        };
    }, [pastCases, missedCases, myCounts]);

    // Numbers for the 5 cards at the top, for the period picked in the
    // Daily / Monthly dropdown:
    //   daily   = only work allocated TODAY
    //   monthly = everything allocated this calendar month (a new month
    //             starts from 0)
    const topStats = useMemo(() => {
        const today = todayStr();
        const month = today.slice(0, 7);
        const inMonth = (a?: string | null, w?: string | null) => {
            const d = allocDay(a, w) || "";
            return statPeriod === "daily" ? d === today : d.slice(0, 7) === month;
        };
        const monthCases = [...todaysCases, ...pastCases].filter((c) =>
            inMonth(c.allocatedAt, c.workDate)
        );
        const submittedList = monthCases.filter(isSubmitted);
        const waitingCounts = myCounts.filter((m) => inMonth(m.allocatedAt, m.workDate));
        const waiting = waitingCounts.reduce((sum, m) => sum + m.remaining, 0);
        const allocatedMins =
            monthCases.reduce((sum, c) => sum + ampOf(c.productId), 0) +
            waitingCounts.reduce((sum, m) => sum + ampOf(m.productId) * m.remaining, 0);
        const utilisedMins = submittedList
            .filter((c) => c.submissionType !== "QUERY")
            .reduce((sum, c) => sum + ampOf(c.productId), 0);
        return {
            allocatedTotal: monthCases.length + waiting,
            withNo: monthCases.length,
            waiting,
            submittedCount: submittedList.length,
            pendingCount: monthCases.length - submittedList.length + waiting,
            pendingCases: monthCases.length - submittedList.length,
            allocatedMins,
            utilisedMins,
            monthName: new Date().toLocaleString("en-US", { month: "long" }),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todaysCases, pastCases, myCounts, productAmp, statPeriod]);

    const isDaily = statPeriod === "daily";
    const periodLabel = isDaily ? "Today" : topStats.monthName;

    // All Query: scoped to ALL of the employee's cases (every date).
    const { openQueries, resolvedQueries } = useMemo(() => {
        const newestFirst = (a: CaseRow, b: CaseRow) =>
            (b.submittedAt || "").localeCompare(a.submittedAt || "") ||
            (b.workDate || "").localeCompare(a.workDate || "");
        return {
            openQueries: cases.filter(isOpenQuery).sort(newestFirst),
            resolvedQueries: cases.filter(isResolvedQuery).sort(newestFirst),
        };
    }, [cases]);

    // ---------------------------------------------------------------
    // Open-query reminder: handled for EVERY role by <TeamQueriesPopup />
    // below (scope comes from the backend: own / team / whole org), so the
    // old "only mine" popup that lived here is gone - it would just have
    // stacked on top of it.
    // ---------------------------------------------------------------

    const visibleQueries = useMemo(() => {
        const list = queryView === "OPEN" ? openQueries : resolvedQueries;
        const q = querySearch.trim().toLowerCase();
        if (!q) return list;
        return list.filter((c) =>
            `${c.caseNumber} ${c.productName || ""} ${c.queryText || ""}`.toLowerCase().includes(q)
        );
    }, [queryView, openQueries, resolvedQueries, querySearch]);

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
        // Opens the Submit Work popup right where the user clicked.
        setSelectedId(c.id);
    };

    // Esc closes the Submit Work popup (unless a submit is in flight).
    useEffect(() => {
        if (!selectedId) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting) setSelectedId(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedId, submitting]);

    const canSubmitSingle =
        !!selected && !!submitType && (!needsReason(submitType) || submitQueryText.trim() !== "");

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
                    ...reasonFields(submitType, submitQueryText),
                    onBehalfOf: isViewingOther ? viewingId : undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Failed to submit work");
            const submittedCaseNo = selected.caseNumber;
            const submittedLabel = outcomeLabel(submitType || null);
            setSelectedId(null);
            setSubmitType("");
            setSubmitQueryText("");
            showToast(`${submittedCaseNo} submitted successfully — ${submittedLabel}.`);
            await loadAll();
        } catch (err: any) {
            setSubmitError(err?.message || "Failed to submit work");
        } finally {
            setSubmitting(false);
        }
    };

    // ---- Row submit: pick the status in the table, press Submit at the end ----
    const canSubmitRow = (c: CaseRow) => {
        const t = rowTypeById[c.id] || "";
        return !!t && (!needsReason(t) || (rowQueryById[c.id] || "").trim() !== "");
    };

    const handleRowSubmit = async (c: CaseRow) => {
        if (rowSubmittingId || !canSubmitRow(c)) return;
        const t = rowTypeById[c.id] as SubmissionType;
        setRowError(null);
        setRowSubmittingId(c.id);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}/submit`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    submissionType: t,
                    ...reasonFields(t, rowQueryById[c.id] || ""),
                    onBehalfOf: isViewingOther ? viewingId : undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || "Failed to submit work");
            setRowTypeById((prev) => {
                const next = { ...prev };
                delete next[c.id];
                return next;
            });
            setRowQueryById((prev) => {
                const next = { ...prev };
                delete next[c.id];
                return next;
            });
            showToast(`${c.caseNumber} submitted successfully — ${outcomeLabel(t)}.`);
            await loadAll();
        } catch (err: any) {
            setRowError(err?.message || "Failed to submit work");
        } finally {
            setRowSubmittingId(null);
        }
    };

    // ---- Bulk Submit: every still-pending case for TODAY ----
    const pendingTodayCases = useMemo(
        () => todaysCases.filter((c) => !isSubmitted(c)),
        [todaysCases]
    );

    // Search within the modal — matches case number, service, or status label.
    const bulkVisibleCases = useMemo(() => {
        const q = bulkSearch.trim().toLowerCase();
        if (!q) return pendingTodayCases;
        const statusLabel = (id: string) => {
            const t = bulkTypeById[id];
            const label = SUBMISSION_OPTIONS.find((o) => o.value === t)?.label;
            return label ? label.toLowerCase() : "wip";
        };
        return pendingTodayCases.filter((c) => {
            const hay =
                `${c.caseNumber} ${c.productName || ""} ${c.clientName || ""} ${c.subclientName || ""} ${statusLabel(c.id)}`.toLowerCase();
            return hay.includes(q);
        });
    }, [pendingTodayCases, bulkSearch, bulkTypeById]);

    const openBulkModal = () => {
        const initialType: Record<string, "PENDING" | SubmissionType> = {};
        const initialQuery: Record<string, string> = {};
        pendingTodayCases.forEach((c) => {
            initialType[c.id] = "PENDING";
            initialQuery[c.id] = "";
        });
        setBulkTypeById(initialType);
        setBulkQueryById(initialQuery);
        setBulkSearch("");
        setBulkError(null);
        setShowBulkModal(true);
    };

    const closeBulkModal = () => {
        setShowBulkModal(false);
        setBulkTypeById({});
        setBulkQueryById({});
        setBulkSearch("");
        setBulkError(null);
    };

    // ---- Self Allocation ----
    const myTeamRaw = ((employee as any)?.team ?? employee?.workedInTeams ?? "").toString().trim();
    const myTeamLower = myTeamRaw.toLowerCase();

    const openSelfAllocModal = async () => {
        setShowSelfAllocModal(true);
        setSelfAllocServiceId("");
        setSelfAllocCases([]);
        setSelfAllocCasesError(null);
        setSelfAllocSelectedIds(new Set());
        setSelfAllocSuccessCount(null);
        setSelfAllocMode("cases");
        setAvailableCounts([]);
        setAvailableCountsError(null);
        setSelfAllocQtyById({});
        setSelfAllocServicesError(null);
        setSelfAllocServicesLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await safeJson(res);
            if (!res.ok || json.success === false) {
                throw new Error(json.message || "Failed to load services");
            }
            const all: ServiceOption[] = (Array.isArray(json) ? json : json.data || []).map(
                (p: any) => ({
                    id: String(p.id),
                    product_name: p.product_name,
                    teams: p.teams || [],
                })
            );
            const aligned = myTeamLower
                ? all.filter((s) =>
                      (s.teams || []).some(
                          (t) => (t || "").toString().trim().toLowerCase() === myTeamLower
                      )
                  )
                : [];
            setSelfAllocServices(aligned);
        } catch (err: any) {
            setSelfAllocServicesError(err?.message || "Failed to load services");
            setSelfAllocServices([]);
        } finally {
            setSelfAllocServicesLoading(false);
        }
    };

    const closeSelfAllocModal = () => {
        setShowSelfAllocModal(false);
        setSelfAllocServiceId("");
        setSelfAllocCases([]);
        setSelfAllocSelectedIds(new Set());
        setSelfAllocCasesError(null);
        setSelfAllocSuccessCount(null);
        setSelfAllocMode("cases");
        setAvailableCounts([]);
        setAvailableCountsError(null);
        setSelfAllocQtyById({});
    };

    const loadSelfAllocCases = async (serviceId: string) => {
        setSelfAllocServiceId(serviceId);
        setSelfAllocCases([]);
        setSelfAllocSelectedIds(new Set());
        setSelfAllocCasesError(null);
        if (!serviceId) return;
        setSelfAllocCasesLoading(true);
        try {
            const params = new URLSearchParams({
                productId: serviceId,
                allocationStatus: "PENDING",
                workDate: todayStr(),
                includeBacklog: "true",
                pageSize: "500",
            });
            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to load remaining cases");
            }
            setSelfAllocCases(json.data || []);
        } catch (err: any) {
            setSelfAllocCasesError(err?.message || "Failed to load remaining cases");
        } finally {
            setSelfAllocCasesLoading(false);
        }
    };

    const showSelfAllocToast = (msg: string) => {
        setSelfAllocToast(msg);
        setTimeout(() => setSelfAllocToast(""), 3000);
    };

    const toggleSelfAllocCase = (id: string) => {
        setSelfAllocSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelfAllocSelectAll = () => {
        setSelfAllocSelectedIds((prev) =>
            prev.size === selfAllocCases.length
                ? new Set()
                : new Set(selfAllocCases.map((c) => c.id))
        );
    };

    const submitSelfAllocation = async () => {
        const caseIds = Array.from(selfAllocSelectedIds);
        if (caseIds.length === 0) {
            showSelfAllocToast("Select at least one case first.");
            return;
        }
        setSelfAllocSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/self-allocate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ caseIds, allocationDate: todayStr() }),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to allocate");
            }
            setSelfAllocSuccessCount(json.data?.allocatedCount ?? caseIds.length);
            loadAll();
        } catch (err: any) {
            showSelfAllocToast(err?.message || "Failed to allocate");
        } finally {
            setSelfAllocSubmitting(false);
        }
    };

    // ---------------------------------------------------------------
    // Self Allocate -> Counts (work that has no case number yet)
    // ---------------------------------------------------------------
    const loadAvailableCounts = async (serviceId: string) => {
        setSelfAllocServiceId(serviceId);
        setAvailableCounts([]);
        setSelfAllocQtyById({});
        setAvailableCountsError(null);
        if (!serviceId) return;
        setAvailableCountsLoading(true);
        try {
            const params = new URLSearchParams({ productId: serviceId, workDate: todayStr() });
            const res = await authFetch(
                `${API_BASE}/api/service-cases/my-counts?${params.toString()}`
            );
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to load remaining counts");
            }
            // Only the "available" list is used here. myCounts is loaded
            // separately (all dates) by loadMyCounts, so don't overwrite it
            // with this today-only response.
            setAvailableCounts(json.data?.available || []);
        } catch (err: any) {
            setAvailableCountsError(err?.message || "Failed to load remaining counts");
        } finally {
            setAvailableCountsLoading(false);
        }
    };

    const switchSelfAllocMode = (mode: "cases" | "counts") => {
        if (mode === selfAllocMode) return;
        setSelfAllocMode(mode);
        if (selfAllocServiceId) {
            if (mode === "counts") loadAvailableCounts(selfAllocServiceId);
            else loadSelfAllocCases(selfAllocServiceId);
        }
    };

    const setSelfAllocQty = (c: AvailableCountRow, raw: number) => {
        const v = Math.max(0, Math.min(c.unallocated, Math.floor(Number(raw) || 0)));
        setSelfAllocQtyById((prev) => ({ ...prev, [c.id]: v }));
    };

    const selfAllocPickedCount =
        selfAllocMode === "counts"
            ? availableCounts.reduce(
                  (s, c) => s + Math.min(selfAllocQtyById[c.id] || 0, c.unallocated),
                  0
              )
            : selfAllocSelectedIds.size;

    const submitSelfAllocCounts = async () => {
        const items = availableCounts
            .map((c) => ({
                countId: c.id,
                quantity: Math.min(selfAllocQtyById[c.id] || 0, c.unallocated),
            }))
            .filter((i) => i.quantity > 0);
        if (items.length === 0) {
            showSelfAllocToast("Enter how many cases you want to take.");
            return;
        }
        setSelfAllocSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/my-counts/self-allocate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items }),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to allocate");
            }
            setSelfAllocSuccessCount(json.data?.allocatedCount ?? selfAllocPickedCount);
            loadAll();
        } catch (err: any) {
            showSelfAllocToast(err?.message || "Failed to allocate");
        } finally {
            setSelfAllocSubmitting(false);
        }
    };

    // ---------------------------------------------------------------
    // Add the real case numbers (+ client / subclient + status) to a
    // count allocated to me. Every case can have its OWN client.
    // ---------------------------------------------------------------
    // rows that actually have a case number typed
    // When case numbers are NOT required (org setting), a row also counts
    // if it was given a submit status (e.g. Completed) with no number — it
    // gets a placeholder token that the server swaps for a generated number.
    const addCnParsed = useMemo(
        () =>
            addCnRows
                .map((r, i) => ({ r, i }))
                .filter(
                    ({ r }) =>
                        r.cn.trim() ||
                        (!caseNumberRequired && r.status !== "WIP" && r.status !== "PENDING")
                )
                .map(({ r, i }) => ({ ...r, cn: r.cn.trim() || `__AUTO__${i + 1}` })),
        [addCnRows, caseNumberRequired]
    );

    // how many of the typed case numbers will be submitted right away
    // (WIP and Pending are only added, not submitted)
    const addCnSubmitCount = addCnParsed.filter(
        (r) => r.status !== "WIP" && r.status !== "PENDING"
    ).length;

    // true if any typed case is still missing its client (client is mandatory)
    const addCnMissingClient = addCnParsed.some((r) => !r.clientId);

    const setAddCnRow = (i: number, patch: Partial<AddCnRow>) =>
        setAddCnRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    // copy row 1's client / subclient onto every row (quick fill when most
    // cases share the same client)
    const applyFirstClientToAll = () =>
        setAddCnRows((prev) =>
            prev.length === 0
                ? prev
                : prev.map((r) => ({
                      ...r,
                      clientId: prev[0].clientId,
                      subclientId: prev[0].subclientId,
                  }))
        );

    // pasting several numbers (new lines / commas) into one box fills the rows below it
    const pasteAddCnRows = (start: number, text: string) => {
        const parts = text
            .split(/[\n,\t]+/)
            .map((x) => x.trim())
            .filter(Boolean);
        if (parts.length === 0) return;
        const max = addCnCount?.remaining ?? parts.length;
        setAddCnRows((prev) => {
            const next = [...prev];
            parts.forEach((p, j) => {
                const idx = start + j;
                if (idx >= max) return;
                while (next.length <= idx) next.push(blankAddCnRow(addCnCount));
                next[idx] = { ...next[idx], cn: p };
            });
            return next;
        });
    };

    const openAddCaseNumbers = (mc: MyCountRow) => {
        setAddCnCount(mc);
        // one row per case still to add (first 10 shown, "+ Add row" for more)
        setAddCnRows(Array.from({ length: Math.min(mc.remaining, 10) }, () => blankAddCnRow(mc)));
        setAddCnError(null);

        // load the clients mapped to this service (active only)
        setAddCnClients([]);
        setAddCnClientsLoading(true);
        (async () => {
            let allowed: ClientOption[] = [];
            try {
                const res = await authFetch(
                    `${API_BASE}/api/service-cases/product-clients/${mc.productId}`
                );
                const json = await safeJson(res);
                if (res.ok) {
                    const list = Array.isArray(json) ? json : json?.data || [];
                    allowed = list.map((c: any) => ({ id: String(c.id), name: c.name }));
                } else {
                    setAddCnError(json?.message || "Failed to load clients for this service");
                }
            } catch (err) {
                console.error("Failed to load service clients:", err);
                setAddCnError("Failed to load clients for this service");
            }
            setAddCnClients(allowed);
            setAddCnClientsLoading(false);
            // drop a pre-filled client / subclient that is no longer allowed
            const okClient = new Set(allowed.map((c) => c.id));
            const inactiveSub = new Set(
                subclients.filter((x) => x.status === "Inactive").map((x) => x.id)
            );
            setAddCnRows((rows) =>
                rows.map((r) =>
                    r.clientId && !okClient.has(r.clientId)
                        ? { ...r, clientId: "", subclientId: "" }
                        : r.subclientId && inactiveSub.has(r.subclientId)
                          ? { ...r, subclientId: "" }
                          : r
                )
            );
        })();
    };

    const closeAddCaseNumbers = () => {
        if (addCnSubmitting) return;
        setAddCnCount(null);
    };

    const submitAddCaseNumbers = async () => {
        if (!addCnCount) return;
        if (addCnParsed.length === 0) {
            setAddCnError(
                caseNumberRequired
                    ? "Type at least one case number."
                    : "Type a case number or set a status (e.g. Completed) for at least one row."
            );
            return;
        }
        if (addCnParsed.length > addCnCount.remaining) {
            setAddCnError(
                `Only ${addCnCount.remaining} case(s) are allocated to you here — you typed ${addCnParsed.length}.`
            );
            return;
        }
        for (const r of addCnParsed) {
            // Client is mandatory for every case.
            if (!r.clientId) {
                setAddCnError(
                    `Select a client for ${r.cn.startsWith("__AUTO__") ? `row ${r.cn.replace("__AUTO__", "")}` : r.cn}.`
                );
                return;
            }
            if (needsReason(r.status) && !r.query.trim()) {
                setAddCnError(
                    `Enter the ${r.status === "OUT_OF_SCOPE" ? "reason" : "query text"} for ${r.cn.startsWith("__AUTO__") ? `row ${r.cn.replace("__AUTO__", "")}` : r.cn}.`
                );
                return;
            }
        }
        setAddCnSubmitting(true);
        setAddCnError(null);
        try {
            const res = await authFetch(
                `${API_BASE}/api/service-cases/my-counts/add-case-numbers`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        countId: addCnCount.id,
                        caseNumbers: addCnParsed.map((r) => r.cn),
                        // per case: its own client / subclient + status.
                        // WIP / Pending = just add (sent to the backend as "WIP"),
                        // anything else = add + submit.
                        statuses: Object.fromEntries(
                            addCnParsed.map((r) => [
                                r.cn.toUpperCase(),
                                {
                                    submissionType: r.status === "PENDING" ? "WIP" : r.status,
                                    ...reasonFields(r.status, r.query),
                                    clientId: r.clientId,
                                    subclientId: r.subclientId || undefined,
                                },
                            ])
                        ),
                    }),
                }
            );
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to add case numbers");
            }
            showToast(json.message || "Case numbers added.");
            setAddCnCount(null);
            loadAll();
        } catch (err: any) {
            setAddCnError(err?.message || "Failed to add case numbers");
        } finally {
            setAddCnSubmitting(false);
        }
    };

    // ---------------------------------------------------------------
    // client / subclient on a case — ADD only (empty field). Once a
    // client / subclient is set it is locked (no dropdown shown).
    // PATCH /:id/client-fill
    // ---------------------------------------------------------------
    const handleCaseClientChange = async (
        c: CaseRow,
        kind: "client" | "subclient",
        value: string
    ) => {
        if (isViewingOther) return;
        if (!value) return; // nothing to add
        setClientCellError(null);
        setSavingClientCaseId(c.id);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}/client-fill`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    kind === "client" ? { clientId: value } : { subclientId: value }
                ),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to update client");
            }
            const d = json.data || {};
            setCases((prev) =>
                prev.map((row) =>
                    row.id === c.id
                        ? {
                              ...row,
                              clientId: d.clientId != null ? String(d.clientId) : null,
                              clientName: d.clientName ?? null,
                              subclientId: d.subclientId != null ? String(d.subclientId) : null,
                              subclientName: d.subclientName ?? null,
                          }
                        : row
                )
            );
        } catch (err: any) {
            setClientCellError(err?.message || "Failed to update client");
        } finally {
            setSavingClientCaseId(null);
        }
    };

    const setBulkType = (id: string, value: "PENDING" | SubmissionType) => {
        setBulkTypeById((prev) => ({ ...prev, [id]: value }));
        if (!needsReason(value)) {
            setBulkQueryById((prev) => ({ ...prev, [id]: "" }));
        }
    };

    const setBulkQuery = (id: string, value: string) => {
        setBulkQueryById((prev) => ({ ...prev, [id]: value }));
    };

    // Only rows changed away from WIP get submitted.
    const bulkRowsToSubmit = useMemo(
        () =>
            pendingTodayCases.filter((c) => {
                const type = bulkTypeById[c.id];
                return type && type !== "PENDING";
            }),
        [pendingTodayCases, bulkTypeById]
    );

    const bulkHasIncompleteQuery = useMemo(
        () =>
            bulkRowsToSubmit.some(
                (c) => needsReason(bulkTypeById[c.id]) && !(bulkQueryById[c.id] || "").trim()
            ),
        [bulkRowsToSubmit, bulkTypeById, bulkQueryById]
    );

    const bulkCanSubmit = bulkRowsToSubmit.length > 0 && !bulkHasIncompleteQuery;

    const handleBulkSubmit = async () => {
        setBulkError(null);
        if (bulkRowsToSubmit.length === 0) return;

        for (const c of bulkRowsToSubmit) {
            const type = bulkTypeById[c.id];
            if (needsReason(type) && !(bulkQueryById[c.id] || "").trim()) {
                setBulkError(
                    `Enter the ${type === "OUT_OF_SCOPE" ? "reason" : "query text"} for ${c.caseNumber} before submitting.`
                );
                return;
            }
        }

        const items = bulkRowsToSubmit.map((c) => ({
            id: c.id,
            submissionType: bulkTypeById[c.id],
            ...reasonFields(bulkTypeById[c.id], bulkQueryById[c.id] || ""),
        }));

        setBulkSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/bulk-submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items, onBehalfOf: isViewingOther ? viewingId : undefined }),
            });
            const json = await safeJson(res);
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Bulk submit failed");
            }
            const submittedCount = json.data?.submittedCount ?? bulkRowsToSubmit.length;
            closeBulkModal();
            showToast(
                `${submittedCount} case${submittedCount === 1 ? "" : "s"} submitted successfully.`
            );
            await loadAll();
        } catch (err: any) {
            setBulkError(err?.message || "Bulk submit failed");
        } finally {
            setBulkSubmitting(false);
        }
    };

    // ---- All Query ----
    const openQueryModal = () => {
        setQueryView("OPEN");
        setQuerySearch("");
        setQueryError(null);
        setQueryNotice(null);
        setResolveTypeById({});
        setShowQueryModal(true);
        refreshCases();
    };

    const closeQueryModal = () => {
        setShowQueryModal(false);
        setQueryError(null);
        setQueryNotice(null);
    };

    const handleResolveQuery = async (c: CaseRow) => {
        const resolutionType = resolveTypeById[c.id];
        if (!resolutionType) {
            setQueryError(`Choose how ${c.caseNumber} was completed first.`);
            return;
        }
        setQueryError(null);
        setQueryNotice(null);
        setResolvingId(c.id);
        try {
            const res = await authFetch(
                `${API_BASE}/api/service-cases/${c.id}/${isViewingOther ? "complete-query" : "resolve-query"}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resolutionType }),
                }
            );
            const json = await safeJson(res);
            if (res.status === 409 && json.alreadyCompleted) {
                setResolveTypeById((prev) => {
                    const next = { ...prev };
                    delete next[c.id];
                    return next;
                });
                setQueryNotice(
                    `${c.caseNumber} was already completed by someone else — it's now under Query Completed.`
                );
                await refreshCases();
                return;
            }
            if (!res.ok || !json.success) {
                throw new Error(json.message || "Failed to complete query");
            }
            setResolveTypeById((prev) => {
                const next = { ...prev };
                delete next[c.id];
                return next;
            });
            showToast(`${c.caseNumber} query marked ${outcomeLabel(resolutionType)}.`);
            await loadAll();
        } catch (err: any) {
            setQueryError(err?.message || "Failed to complete query");
        } finally {
            setResolvingId(null);
        }
    };

    const handleSaveProfile = async () => {
        if (isViewingOther) return;
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
        if (isViewingOther) return;
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

    // Table is hidden until a stat card is clicked (Past Allocation tab
    // always shows it, since that tab has no card of its own).
    const showDetails = openCard !== null || activeTab === "past";

    const openStatCard = (k: "all" | "submitted" | "pending" | "pendingNo") => {
        if (openCard === k && activeTab === "today") {
            setOpenCard(null);
            return;
        }
        setOpenCard(k);
        setActiveTab("today");
        // "pendingNo" (without case no.) -> Counts table;
        // "pending" (with case no.) -> Cases table filtered to PENDING.
        setAllocView(k === "pendingNo" ? "counts" : "cases");
        setStatusFilter(k === "submitted" ? "SUBMITTED" : k === "pending" ? "PENDING" : "all");
        setDateFilter("");
        setProductFilter("all");
        setSearch("");
        window.setTimeout(() => scrollWithinPage(detailRef.current), 60);
    };

    // Clicking a small tile inside "Today's Cases" / "Past Cases":
    // jumps straight to the matching table (never toggles closed).
    const openTile = (cardKey: string, label: string) => {
        if (cardKey === "query") {
            openQueryModal();
            return;
        }
        const goPast = cardKey === "past";
        let nextCard: null | "all" | "submitted" | "pending" | "pendingNo" = null;
        let view: "cases" | "counts" = "cases";
        let status: "all" | "PENDING" | "SUBMITTED" = "all";
        if (goPast) {
            if (label === "Completed") status = "SUBMITTED";
        } else if (label === "Waiting") {
            nextCard = "pendingNo";
            view = "counts";
        } else if (label === "Submitted") {
            nextCard = "submitted";
            status = "SUBMITTED";
        } else if (label === "Pending") {
            nextCard = "pending";
            status = "PENDING";
            // only counts are pending -> show the Counts table
            if (stats.pendingCount === 0 && stats.waitingToday > 0) view = "counts";
        } else {
            nextCard = "all"; // "With case no."
        }
        setOpenCard(nextCard);
        setActiveTab(goPast ? "past" : "today");
        setAllocView(view);
        setStatusFilter(status);
        setDateFilter("");
        setProductFilter("all");
        setSearch("");
        window.setTimeout(() => scrollWithinPage(detailRef.current), 60);
    };

    // Past Allocation card: opens the past cases table (click again to hide).
    const openPastCard = () => {
        if (activeTab === "past") {
            setActiveTab("today");
            setOpenCard(null);
            return;
        }
        setOpenCard(null);
        setActiveTab("past");
        setAllocView("cases");
        setStatusFilter("all");
        setDateFilter("");
        setProductFilter("all");
        setSearch("");
        window.setTimeout(() => scrollWithinPage(detailRef.current), 60);
    };

    const exportCsv = () => {
        const header = [
            "#",
            "Case No.",
            "Service",
            "Date",
            showAllocatedAt ? "Allocated At" : "Allocated",
            "Time (AMP)",
            "Status",
            "Outcome",
        ];
        const rows = filteredRows.map((c, i) => [
            i + 1,
            c.caseNumber,
            c.productName || "-",
            c.workDate,
            showAllocatedAt
                ? `"${formatDateTime(c.allocatedAt)}"`
                : formatDisplayDate(allocDay(c.allocatedAt, c.workDate)),
            ampOf(c.productId) ? formatMinutes(ampOf(c.productId)) : "-",
            isSubmitted(c) ? "Submitted" : "Pending",
            isSubmitted(c) ? outcomeLabel(c.submissionType) : "-",
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
            <div style={styles.topBar} />

            <style>{hoverCss}</style>

            {/* ---- NEW: Employee search (Super Admin / Ops Manager only) ---- */}
            {canViewOthers && (
                <div style={styles.empSearchCard}>
                    <div ref={empBoxRef} style={styles.empPillWrap}>
                        <div className="pf-emp-pill" style={styles.empPill}>
                            <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ color: "#8A93A6", flexShrink: 0 }}
                            >
                                <circle cx="11" cy="11" r="7" />
                                <path d="m20 20-3.5-3.5" />
                            </svg>
                            <input
                                ref={empInputRef}
                                style={styles.empPillInput}
                                placeholder="Search employees (Ex: name, team or email)"
                                value={empQuery}
                                onChange={(e) => {
                                    setEmpQuery(e.target.value);
                                    setEmpDropOpen(true);
                                }}
                                onFocus={() => setEmpDropOpen(true)}
                            />
                            <span style={styles.empKbd}>Alt + K</span>
                        </div>
                        {empDropOpen && empQuery.trim() && (
                            <div style={styles.empDropdown}>
                                <div style={styles.empDropHeader}>
                                    {empMatches.length === 0
                                        ? "No results"
                                        : `${empMatches.length} employee${
                                              empMatches.length === 1 ? "" : "s"
                                          } found`}
                                </div>
                                {empMatches.length === 0 ? (
                                    <div
                                        style={{ ...styles.smallMuted, padding: "10px 12px 14px" }}
                                    >
                                        No employee found for "{empQuery.trim()}".
                                    </div>
                                ) : (
                                    empMatches.map((e) => (
                                        <div
                                            key={e.id}
                                            className="pf-emp-item"
                                            style={styles.empDropItem}
                                            onClick={() => openEmployee(e.id)}
                                        >
                                            <div style={styles.empAvatar}>
                                                {empInitials(e.name)}
                                            </div>
                                            <div style={styles.empItemBody}>
                                                <div style={styles.empItemName}>
                                                    <HighlightMatch
                                                        text={e.name}
                                                        q={empQuery}
                                                        color={BRAND.blue}
                                                    />
                                                </div>
                                                <div style={styles.empItemMeta}>
                                                    {e.designation && (
                                                        <span style={styles.empItemSub}>
                                                            {e.designation}
                                                        </span>
                                                    )}
                                                    {e.team && (
                                                        <span style={styles.empChip}>{e.team}</span>
                                                    )}
                                                </div>
                                                {e.email && (
                                                    <div style={styles.empItemEmail}>
                                                        <HighlightMatch
                                                            text={e.email}
                                                            q={empQuery}
                                                            color={BRAND.blue}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <span className="pf-emp-go" style={styles.empGo}>
                                                →
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div style={styles.empDropFooter}>
                                    Click an employee to open their profile
                                </div>
                            </div>
                        )}
                    </div>
                    {isViewingOther && (
                        <button
                            type="button"
                            className="pf-btn pf-btn-outline"
                            style={styles.exportBtn}
                            onClick={() => openEmployee(null)}
                        >
                            ← Back to my profile
                        </button>
                    )}
                </div>
            )}

            {isViewingOther && (
                <div style={styles.noteWarning}>
                    Viewing <strong>{name}</strong>'s profile. You can submit work on their behalf.
                </div>
            )}

            {error && <div style={styles.noteWarning}>{error}</div>}

            {/* ---- Identity card ---- */}
            <div className="pf-card-hover" style={styles.identityCard}>
                <div style={isMobile ? styles.identityTopMobile : styles.identityTop}>
                    <div style={styles.avatarBlock}>
                        <div style={styles.avatarWrap}>
                            <span aria-hidden="true" style={styles.avatarBlob} />
                            <svg
                                aria-hidden="true"
                                width="58"
                                height="48"
                                viewBox="0 0 58 48"
                                fill="none"
                                style={styles.avatarSpark}
                            >
                                <path
                                    d="M30 6 36 18"
                                    stroke="#9DB4F5"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M43 3 44 12"
                                    stroke="#B9A6F0"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M18 14 26 22"
                                    stroke="#9DB4F5"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                                <circle cx="11" cy="30" r="5" stroke="#B9A6F0" strokeWidth="2.5" />
                                <circle cx="24" cy="38" r="3" stroke="#9DB4F5" strokeWidth="2.5" />
                            </svg>
                            {photoUrl ? (
                                <img
                                    src={photoUrl}
                                    alt={name}
                                    style={{ ...styles.avatarImg, cursor: "pointer" }}
                                    onClick={() => setIsAvatarPreviewOpen(true)}
                                    title="View photo"
                                />
                            ) : (
                                <div style={styles.avatar}>{initials || "?"}</div>
                            )}
                            {!isViewingOther && (
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
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={handlePhotoChange}
                            />
                        </div>
                        <div style={styles.nameBlock}>
                            <span style={styles.name}>{loading ? "Loading..." : name}</span>
                            <span style={styles.activePill}>
                                <span style={styles.activeDot} />
                                Active
                            </span>
                            {uploadingPhoto && (
                                <div style={styles.smallMuted}>Uploading photo…</div>
                            )}
                            {photoError && <p style={styles.rowError}>{photoError}</p>}
                        </div>
                    </div>

                    {!isMobile && <div style={styles.identityDivider} />}

                    <div style={isMobile ? styles.identityGridMobile : styles.identityGrid}>
                        <div style={styles.identityColumn}>
                            <InfoIconRow
                                icon={<ShieldIcon />}
                                label="Role"
                                value={role && role !== "-" ? getRoleLabel(role) : "-"}
                                tone={ROW_TONES.role}
                                styles={styles}
                            />
                            <InfoIconRow
                                icon={<MailIcon />}
                                label="Email"
                                value={email}
                                href={email && email !== "-" ? `mailto:${email}` : undefined}
                                tone={ROW_TONES.email}
                                styles={styles}
                            />
                            {editingProfile && !isViewingOther ? (
                                <div style={styles.editField}>
                                    <label style={styles.smallLabel}>Phone</label>
                                    <input
                                        style={styles.textInput}
                                        value={profileDraft.phone}
                                        onChange={(e) =>
                                            setProfileDraft((p) => ({
                                                ...p,
                                                phone: e.target.value,
                                            }))
                                        }
                                        placeholder="Phone number"
                                    />
                                </div>
                            ) : (
                                <InfoIconRow
                                    icon={<PhoneIcon />}
                                    label="Phone"
                                    value={phone}
                                    href={
                                        phone && phone !== "-"
                                            ? `tel:${phone.replace(/\s+/g, "")}`
                                            : undefined
                                    }
                                    tone={ROW_TONES.phone}
                                    styles={styles}
                                />
                            )}
                        </div>

                        <div style={styles.identityColumn}>
                            <InfoIconRow
                                icon={<TeamIcon />}
                                label="Team"
                                value={team}
                                tone={ROW_TONES.team}
                                styles={styles}
                            />
                            <InfoIconRow
                                icon={<DeptIcon />}
                                label="Department"
                                value={department}
                                tone={ROW_TONES.dept}
                                styles={styles}
                            />
                            <InfoIconRow
                                icon={<UserIcon />}
                                label="Manager"
                                value={manager}
                                tone={ROW_TONES.manager}
                                styles={styles}
                            />
                        </div>

                        <div style={styles.aboutBox}>
                            <svg
                                aria-hidden="true"
                                width="34"
                                height="34"
                                viewBox="0 0 34 34"
                                fill="none"
                                style={styles.aboutSpark}
                            >
                                <path
                                    d="M6 22 12 17"
                                    stroke="#5B8DEF"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M14 9 17 15"
                                    stroke="#5B8DEF"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M25 7 24 13"
                                    stroke="#5B8DEF"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                />
                            </svg>
                            <svg
                                aria-hidden="true"
                                width="150"
                                height="90"
                                viewBox="0 0 150 90"
                                fill="none"
                                style={styles.aboutWave}
                            >
                                <path
                                    d="M150 0C120 20 100 48 70 62 50 72 25 80 0 90H150Z"
                                    fill="rgba(125,160,245,0.28)"
                                />
                                <path
                                    d="M150 30C128 46 112 66 88 78 72 85 56 88 40 90H150Z"
                                    fill="rgba(125,160,245,0.32)"
                                />
                            </svg>
                            <div style={styles.aboutHeader}>
                                <span style={styles.aboutIcon}>
                                    <UserIcon />
                                </span>
                                <div style={styles.aboutTitle}>About Me</div>
                            </div>
                            <div style={styles.aboutRule} />
                            {editingProfile && !isViewingOther ? (
                                <textarea
                                    style={{
                                        ...styles.aboutTextarea,
                                        position: "relative",
                                        zIndex: 1,
                                    }}
                                    rows={3}
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

                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: isMobile ? "flex-start" : "flex-end",
                            gap: 12,
                            alignSelf: isMobile ? "flex-start" : "flex-end",
                        }}
                    >
                        {!isViewingOther && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    alignSelf: isMobile ? "flex-start" : "flex-end",
                                }}
                            >
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
                                        editingProfile
                                            ? handleSaveProfile()
                                            : setEditingProfile(true)
                                    }
                                >
                                    {!editingProfile && <PencilIcon />}
                                    {editingProfile
                                        ? savingProfile
                                            ? "Saving…"
                                            : "Save"
                                        : "Edit Profile"}
                                </button>
                            </div>
                        )}
                        {!isBlueMode && (
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: isMobile ? "flex-start" : "flex-end",
                                    alignItems: "center",
                                    gap: 8,
                                    marginTop: isMobile ? 0 : 22,
                                }}
                            >
                                <span style={styles.smallMuted}>Show</span>
                                <select
                                    value={statPeriod}
                                    onChange={(e) => {
                                        setStatPeriod(e.target.value as "daily" | "monthly");
                                        setOpenCard(null);
                                    }}
                                    aria-label="Stats period"
                                    style={{
                                        height: 34,
                                        padding: "0 30px 0 12px",
                                        borderRadius: 8,
                                        border: "1px solid #e2e4f0",
                                        background: "#fff",
                                        color: "#17181C",
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        outline: "none",
                                    }}
                                >
                                    <option value="daily">Daily</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {profileSaveError && <p style={styles.rowError}>{profileSaveError}</p>}
            </div>

            {isBlueMode && <BlueAllocationBlock employeeId={isViewingOther ? viewingId : null} />}
            {isBlueMode && <BlueWorkSummary employeeId={isViewingOther ? viewingId : null} />}

            {!isBlueMode && (
                <>
                    {/* ---- Stats (click a card -> its cases table opens below) ---- */}
                    <div style={isMobile ? styles.statsGridMobile : styles.statsGrid}>
                        <StatCard
                            icon={<BoxIcon />}
                            tint={BRAND.blue}
                            value={topStats.allocatedTotal}
                            label="Cases Allocated"
                            sub={
                                topStats.waiting > 0
                                    ? `${topStats.withNo} with case no. · ${topStats.waiting} waiting`
                                    : periodLabel
                            }
                            active={isDaily && openCard === "all" && activeTab === "today"}
                            onClick={isDaily ? () => openStatCard("all") : undefined}
                            styles={styles}
                        />
                        <StatCard
                            icon={<CheckIcon />}
                            tint={BRAND.green}
                            value={topStats.submittedCount}
                            label="Submitted"
                            sub={`${periodLabel} · completed & submitted`}
                            active={isDaily && openCard === "submitted" && activeTab === "today"}
                            onClick={isDaily ? () => openStatCard("submitted") : undefined}
                            styles={styles}
                        />
                        <StatCard
                            icon={<ClockIcon />}
                            tint={BRAND.amber}
                            value={topStats.pendingCases}
                            label="Pending · With Case No."
                            sub={`${periodLabel} · awaiting submission`}
                            active={isDaily && openCard === "pending" && activeTab === "today"}
                            onClick={isDaily ? () => openStatCard("pending") : undefined}
                            styles={styles}
                        />
                        <StatCard
                            icon={<ClockIcon />}
                            tint={BRAND.amber}
                            value={topStats.waiting}
                            label="Pending · Without Case No."
                            sub={`${periodLabel} · waiting for case no.`}
                            active={isDaily && openCard === "pendingNo" && activeTab === "today"}
                            onClick={isDaily ? () => openStatCard("pendingNo") : undefined}
                            styles={styles}
                        />
                        {/* total hours allocated = cases x service AMP */}
                        <StatCard
                            icon={<ClockIcon />}
                            tint={BRAND.lightBlue}
                            value={
                                topStats.allocatedMins > 0
                                    ? formatMinutes(topStats.allocatedMins)
                                    : "0m"
                            }
                            label="Allocated Hours"
                            sub={`${periodLabel} · cases × service AMP`}
                            styles={styles}
                        />
                        {/* time utilised = AMP of submitted cases, out of allocated time */}
                        <StatCard
                            icon={<ClockIcon />}
                            tint={BRAND.green}
                            value={
                                topStats.utilisedMins > 0
                                    ? formatMinutes(topStats.utilisedMins)
                                    : "0m"
                            }
                            label="Time Utilised"
                            sub={
                                topStats.allocatedMins > 0
                                    ? `of ${formatMinutes(topStats.allocatedMins)} allocated`
                                    : "Submitted cases × AMP"
                            }
                            progress={
                                topStats.allocatedMins > 0
                                    ? Math.min(
                                          100,
                                          Math.round(
                                              (topStats.utilisedMins / topStats.allocatedMins) * 100
                                          )
                                      )
                                    : 0
                            }
                            // % of the allocated time that was actually completed
                            // (e.g. 100h allocated, 25h done -> "25%")
                            badge={
                                topStats.allocatedMins > 0
                                    ? `${Math.min(
                                          100,
                                          Math.round(
                                              (topStats.utilisedMins / topStats.allocatedMins) * 100
                                          )
                                      )}%`
                                    : undefined
                            }
                            styles={styles}
                        />
                    </div>

                    {/* ---- Case-wise cards (click View Details -> cases table opens) ---- */}
                    <div style={styles.caseSection}>
                        <div style={styles.caseSectionHead}>
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 10,
                                    fontSize: 20,
                                    fontWeight: 700,
                                    color: "#17181C",
                                }}
                            >
                                <span style={{ color: BRAND.green, display: "inline-flex" }}>
                                    <LayersIcon />
                                </span>
                                Allocation Summary
                            </span>
                            <span style={styles.smallMuted}>
                                Click View Details to open the cases
                            </span>
                        </div>
                        {/* ---- Self Allocate / Bulk Submit / Export ---- */}
                        <div
                            style={{
                                ...styles.tabsRow,
                                justifyContent: "flex-end",
                                margin: "0 0 12px",
                            }}
                        >
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                {!isViewingOther && (
                                    <button
                                        type="button"
                                        className="pf-btn pf-btn-outline"
                                        style={styles.exportBtn}
                                        onClick={openSelfAllocModal}
                                    >
                                        <BoxIcon /> Self Allocate
                                    </button>
                                )}
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
                        <div
                            style={
                                isMobile
                                    ? { ...styles.caseGrid, gridTemplateColumns: "1fr" }
                                    : styles.caseGrid
                            }
                        >
                            {[
                                {
                                    key: "today",
                                    title: "Today's Cases",
                                    total: stats.allocatedTotal,
                                    totalLabel: "Allocated",
                                    done: stats.submittedCount,
                                    doneLabel: "submitted",
                                    rows: [
                                        ["With case no.", stats.total, BRAND.blue],
                                        ["Waiting", stats.waitingToday, BRAND.amber],
                                        ["Submitted", stats.submittedCount, BRAND.green],
                                        ["Pending", stats.pendingTotal, BRAND.amber],
                                    ] as [string, number | string, string][],
                                    active: openCard === "all" && activeTab === "today",
                                    onClick: () => openStatCard("all"),
                                },
                                {
                                    key: "past",
                                    title: "Past Cases",
                                    total: pastSummary.total,
                                    totalLabel: "Allocated",
                                    done: pastSummary.submitted,
                                    doneLabel: "completed",
                                    // Past: only "how much I received" and "how much I
                                    // completed" — no pending shown here.
                                    rows: [
                                        ["Received", pastSummary.total, BRAND.blue],
                                        ["Completed", pastSummary.submitted, BRAND.green],
                                    ] as [string, number | string, string][],
                                    active: activeTab === "past",
                                    onClick: openPastCard,
                                },
                                {
                                    key: "query",
                                    title: "Queries",
                                    total: openQueries.length + resolvedQueries.length,
                                    totalLabel: "Total",
                                    done: resolvedQueries.length,
                                    doneLabel: "completed",
                                    rows: [
                                        ["In Query", openQueries.length, BRAND.red],
                                        ["Query Completed", resolvedQueries.length, BRAND.green],
                                    ] as [string, number | string, string][],
                                    active: showQueryModal,
                                    onClick: openQueryModal,
                                },
                            ].map((c) => {
                                // Past + Queries only: all done -> green "All completed" badge,
                                // nothing done at all -> red warning look.
                                // Past card is neutral (no red/green "pending" styling).
                                const allDone =
                                    c.key === "query" && c.total > 0 && c.done >= c.total;
                                const noneDone = c.key === "query" && c.total > 0 && c.done === 0;
                                const accent = noneDone
                                    ? BRAND.red
                                    : allDone
                                      ? BRAND.green
                                      : c.key === "today"
                                        ? BRAND.green
                                        : c.key === "past"
                                          ? BRAND.blue
                                          : BRAND.amber;
                                const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
                                const isActive = c.active && c.key !== "query";
                                return (
                                    <div
                                        key={c.key}
                                        className={
                                            c.key === "today"
                                                ? "pf-card-hover pf-today-card"
                                                : "pf-card-hover"
                                        }
                                        style={{
                                            ...styles.caseCard,
                                            padding: "12px 14px 12px",
                                            gap: 9,
                                            borderRadius: 16,
                                            border: `1px solid ${withAlpha(accent, 0.18)}`,
                                            borderLeft: `1px solid ${withAlpha(accent, 0.18)}`,
                                            borderTop: `3px solid ${accent}`,
                                            background: `linear-gradient(180deg, ${withAlpha(accent, 0.07)} 0%, #fff 55%)`,
                                            boxShadow: `0 4px 14px ${withAlpha(accent, 0.1)}`,
                                        }}
                                    >
                                        {/* header: icon + title (+ LIVE) ........ total */}
                                        <div
                                            style={{ ...styles.caseCardTop, alignItems: "center" }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 9,
                                                    minWidth: 0,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 30,
                                                        height: 30,
                                                        borderRadius: 9,
                                                        background: withAlpha(accent, 0.14),
                                                        color: accent,
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {c.key === "today" ? (
                                                        <CalendarIcon />
                                                    ) : c.key === "past" ? (
                                                        <ClockIcon />
                                                    ) : (
                                                        <ChatIcon />
                                                    )}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 14,
                                                        fontWeight: 700,
                                                        color: "#17181C",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {c.title}
                                                </span>
                                                {c.key === "query" && c.total > 0 && (
                                                    <span
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 5,
                                                            padding: "2px 9px",
                                                            borderRadius: 999,
                                                            background: withAlpha(
                                                                allDone ? BRAND.green : BRAND.red,
                                                                0.14
                                                            ),
                                                            color: allDone
                                                                ? BRAND.green
                                                                : BRAND.red,
                                                            fontSize: 10.5,
                                                            fontWeight: 700,
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                width: 6,
                                                                height: 6,
                                                                borderRadius: "50%",
                                                                background: allDone
                                                                    ? BRAND.green
                                                                    : BRAND.red,
                                                            }}
                                                        />
                                                        {allDone
                                                            ? "All completed"
                                                            : noneDone
                                                              ? "None completed"
                                                              : (() => {
                                                                    // Use the SAME numbers as the tiles below,
                                                                    // so the pill and the tile never disagree.
                                                                    const tile = (name: string) =>
                                                                        Number(
                                                                            c.rows.find(
                                                                                (r) => r[0] === name
                                                                            )?.[1] ?? 0
                                                                        );
                                                                    if (c.key === "query")
                                                                        return `${tile("In Query")} open`;
                                                                    if (tile("Pending") > 0)
                                                                        return `${tile("Pending")} pending`;
                                                                    if (tile("Waiting") > 0)
                                                                        return `${tile("Waiting")} waiting`;
                                                                    return `${c.total - c.done} pending`;
                                                                })()}
                                                    </span>
                                                )}
                                                {c.key === "today" && (
                                                    <span
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 5,
                                                            padding: "2px 8px",
                                                            borderRadius: 999,
                                                            background: withAlpha(
                                                                BRAND.green,
                                                                0.14
                                                            ),
                                                            color: BRAND.green,
                                                            fontSize: 9.5,
                                                            fontWeight: 700,
                                                            letterSpacing: "0.06em",
                                                        }}
                                                    >
                                                        <span
                                                            className="pf-today-dot"
                                                            style={{
                                                                width: 5,
                                                                height: 5,
                                                                borderRadius: "50%",
                                                                background: BRAND.green,
                                                            }}
                                                        />
                                                        LIVE
                                                    </span>
                                                )}
                                            </div>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "baseline",
                                                    gap: 5,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        ...styles.caseTotalNum,
                                                        fontSize: 24,
                                                        color: accent,
                                                    }}
                                                >
                                                    {c.total}
                                                </span>
                                                <span
                                                    style={{ ...styles.smallMuted, fontSize: 11 }}
                                                >
                                                    {c.totalLabel}
                                                </span>
                                            </div>
                                        </div>

                                        {/* progress + % */}
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    ...styles.caseBarTrack,
                                                    flex: 1,
                                                    height: 5,
                                                    background: withAlpha(accent, 0.15),
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        ...styles.caseBarFill,
                                                        width: `${pct}%`,
                                                        background: accent,
                                                    }}
                                                />
                                            </div>
                                            <span
                                                style={{
                                                    ...styles.smallMuted,
                                                    fontSize: 11,
                                                    whiteSpace: "nowrap",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {pct}% {c.doneLabel}
                                            </span>
                                        </div>

                                        {/* stat tiles: one compact row (2 x 2 on phones) */}
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: isMobile
                                                    ? "1fr 1fr"
                                                    : `repeat(${c.rows.length}, 1fr)`,
                                                gap: 7,
                                            }}
                                        >
                                            {c.rows.map(([label, value, color]) => (
                                                <div
                                                    key={label}
                                                    className="pf-card-hover"
                                                    role="button"
                                                    tabIndex={0}
                                                    title={`View ${label}`}
                                                    onClick={() => openTile(c.key, label)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            openTile(c.key, label);
                                                        }
                                                    }}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 1,
                                                        padding: "6px 10px",
                                                        borderRadius: 10,
                                                        background: withAlpha(color, 0.09),
                                                        minWidth: 0,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            fontSize: 11,
                                                            color: "#5B6479",
                                                            whiteSpace: "nowrap",
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                        }}
                                                    >
                                                        {label}
                                                    </span>
                                                    <strong
                                                        style={{
                                                            fontSize: 18,
                                                            lineHeight: 1.15,
                                                            color,
                                                        }}
                                                    >
                                                        {value}
                                                    </strong>
                                                </div>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            className="pf-btn pf-btn-outline"
                                            style={{
                                                ...styles.caseViewBtn,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 6,
                                                padding: "6px 12px",
                                                fontSize: 12.5,
                                                borderRadius: 999,
                                                border: "none",
                                                background: isActive
                                                    ? BRAND.blue
                                                    : withAlpha(accent, 0.1),
                                                color: isActive
                                                    ? "#fff"
                                                    : accent === BRAND.amber
                                                      ? "#B26B00"
                                                      : accent,
                                            }}
                                            onClick={c.onClick}
                                        >
                                            {isActive ? "Hide Details" : "View Details"}
                                            <ArrowRightIcon />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {showDetails && (
                        <>
                            <div ref={detailRef} style={styles.detailHead}>
                                <span style={styles.detailTitle}>
                                    {activeTab === "past"
                                        ? "Past Allocation"
                                        : openCard === "submitted"
                                          ? "Submitted Cases — Today"
                                          : openCard === "pending"
                                            ? "Pending Cases (With Case No.) — Today"
                                            : openCard === "pendingNo"
                                              ? "Pending Counts (Without Case No.) — Today"
                                              : "All Allocated Cases — Today"}
                                </span>
                                {activeTab === "today" && (
                                    <button
                                        type="button"
                                        className="pf-btn pf-btn-outline"
                                        style={styles.exportBtn}
                                        onClick={() => setOpenCard(null)}
                                    >
                                        ✕ Close
                                    </button>
                                )}
                            </div>

                            {/* ---- Counts / Cases toggle (left) + Search (right) ---- */}
                            <div
                                style={{
                                    ...styles.allocViewRow,
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {!isViewingOther && (
                                        <>
                                            <button
                                                type="button"
                                                className="pf-btn"
                                                style={
                                                    allocView === "counts"
                                                        ? styles.allocViewBtnActive
                                                        : styles.allocViewBtn
                                                }
                                                onClick={() => setAllocView("counts")}
                                            >
                                                Counts ({filteredCounts.length})
                                            </button>
                                            <button
                                                type="button"
                                                className="pf-btn"
                                                style={
                                                    allocView === "cases"
                                                        ? styles.allocViewBtnActive
                                                        : styles.allocViewBtn
                                                }
                                                onClick={() => setAllocView("cases")}
                                            >
                                                Cases ({filteredRows.length})
                                            </button>
                                        </>
                                    )}
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 10,
                                        alignItems: "center",
                                        width: isMobile ? "100%" : "auto",
                                    }}
                                >
                                    {allocView === "cases" && (
                                        <select
                                            style={{ ...styles.textInput, minWidth: 130 }}
                                            value={statusFilter}
                                            onChange={(e) => setStatusFilter(e.target.value as any)}
                                            aria-label="Status"
                                        >
                                            <option value="all">All Status</option>
                                            <option value="PENDING">Pending</option>
                                            <option value="SUBMITTED">Submitted</option>
                                        </select>
                                    )}
                                    <input
                                        style={{
                                            ...styles.textInput,
                                            width: isMobile ? "100%" : 300,
                                        }}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder={
                                            allocView === "cases"
                                                ? "Search by case number or service…"
                                                : "Search by service or client…"
                                        }
                                    />
                                </div>
                            </div>

                            {/* ---- Counts view (table: case # / client / sub-client / service / date / status) ---- */}
                            {!isViewingOther && allocView === "counts" && (
                                <div className="pf-card-hover" style={styles.cntCard}>
                                    <div style={styles.cntTop}>
                                        <div>
                                            <div style={styles.countsCardTitle}>
                                                Counts (no case number yet) — add case numbers
                                            </div>
                                            <div style={styles.smallMuted}>
                                                These were allocated to you as a count. Add the real
                                                case number(s), pick the client for each and a
                                                status.
                                            </div>
                                        </div>
                                        <span style={styles.countsBadge}>
                                            {countsToAdd} pending
                                        </span>
                                    </div>
                                    {filteredCounts.length === 0 ? (
                                        <EmptyState
                                            text={
                                                activeTab === "today"
                                                    ? "No counts waiting for today."
                                                    : "No past counts found."
                                            }
                                            styles={styles}
                                        />
                                    ) : (
                                        <div style={{ overflowX: "auto", padding: "0 20px 20px" }}>
                                            <div style={styles.cntGroups}>
                                                {(() => {
                                                    // group the counts by service
                                                    const groups = new Map<string, MyCountRow[]>();
                                                    filteredCounts.forEach((m) => {
                                                        const k = m.productName || "No service";
                                                        if (!groups.has(k)) groups.set(k, []);
                                                        groups.get(k)!.push(m);
                                                    });
                                                    const dotColors = [
                                                        BRAND.blue,
                                                        "#6C8EF5",
                                                        BRAND.green,
                                                        BRAND.amber,
                                                    ];
                                                    return Array.from(groups.entries()).map(
                                                        ([service, rows], gi) => {
                                                            const gAdded = rows.reduce(
                                                                (t, r) => t + r.addedByMe,
                                                                0
                                                            );
                                                            const gTotal = rows.reduce(
                                                                (t, r) => t + r.allocatedToMe,
                                                                0
                                                            );
                                                            return (
                                                                <div
                                                                    key={service}
                                                                    style={styles.cntGroup}
                                                                >
                                                                    <div
                                                                        style={styles.cntGroupHead}
                                                                    >
                                                                        <span
                                                                            style={{
                                                                                ...styles.cntDot,
                                                                                background:
                                                                                    dotColors[
                                                                                        gi %
                                                                                            dotColors.length
                                                                                    ],
                                                                            }}
                                                                        />
                                                                        <span
                                                                            style={
                                                                                styles.cntGroupName
                                                                            }
                                                                        >
                                                                            {service}
                                                                        </span>
                                                                        <span
                                                                            style={
                                                                                styles.cntCountPill
                                                                            }
                                                                        >
                                                                            {rows.length}{" "}
                                                                            {rows.length === 1
                                                                                ? "Case"
                                                                                : "Cases"}
                                                                        </span>
                                                                        <span style={{ flex: 1 }} />
                                                                        <span
                                                                            style={
                                                                                styles.smallMuted
                                                                            }
                                                                        >
                                                                            Total Added
                                                                        </span>
                                                                        <span
                                                                            style={
                                                                                styles.cntGroupTotal
                                                                            }
                                                                        >
                                                                            {gAdded} / {gTotal}
                                                                        </span>
                                                                    </div>
                                                                    {rows.map((mc, ri) => {
                                                                        const done =
                                                                            mc.remaining === 0 &&
                                                                            !mc.missed;
                                                                        const mcAmp = ampOf(
                                                                            mc.productId
                                                                        );
                                                                        const carry =
                                                                            !!mc.workDate &&
                                                                            mc.workDate <
                                                                                todayStr();
                                                                        const days = mc.workDate
                                                                            ? Math.max(
                                                                                  0,
                                                                                  Math.round(
                                                                                      (new Date(
                                                                                          todayStr()
                                                                                      ).getTime() -
                                                                                          new Date(
                                                                                              mc.workDate
                                                                                          ).getTime()) /
                                                                                          86400000
                                                                                  )
                                                                              )
                                                                            : 0;
                                                                        return (
                                                                            <div
                                                                                key={mc.id}
                                                                                style={{
                                                                                    ...styles.cntRow,
                                                                                    borderTop:
                                                                                        ri === 0
                                                                                            ? "none"
                                                                                            : "1px solid #eef0f6",
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    style={
                                                                                        styles.cntCell
                                                                                    }
                                                                                >
                                                                                    <span
                                                                                        style={
                                                                                            styles.cntClient
                                                                                        }
                                                                                    >
                                                                                        {mc.clientName ||
                                                                                            "—"}
                                                                                    </span>
                                                                                    <span
                                                                                        style={
                                                                                            styles.smallMuted
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            mc.allocatedToMe
                                                                                        }{" "}
                                                                                        cases
                                                                                        {mcAmp > 0
                                                                                            ? ` · ${formatMinutes(mcAmp * mc.allocatedToMe)}`
                                                                                            : ""}
                                                                                    </span>
                                                                                </div>
                                                                                <div
                                                                                    style={
                                                                                        styles.cntText
                                                                                    }
                                                                                >
                                                                                    {mc.subclientName ||
                                                                                        "—"}
                                                                                </div>
                                                                                <div
                                                                                    style={
                                                                                        styles.cntCell
                                                                                    }
                                                                                >
                                                                                    <span
                                                                                        style={
                                                                                            styles.cntDate
                                                                                        }
                                                                                    >
                                                                                        {mc.workDate ||
                                                                                            "—"}
                                                                                    </span>
                                                                                    <span
                                                                                        style={
                                                                                            styles.smallMuted
                                                                                        }
                                                                                    >
                                                                                        {days > 0
                                                                                            ? `(${days} day${days === 1 ? "" : "s"})`
                                                                                            : "(today)"}
                                                                                    </span>
                                                                                </div>
                                                                                <div>
                                                                                    <span
                                                                                        style={
                                                                                            styles.statusDone
                                                                                        }
                                                                                    >
                                                                                        ●{" "}
                                                                                        {mc.missed
                                                                                            ? "Not submitted"
                                                                                            : done
                                                                                              ? "All added"
                                                                                              : "Allocated"}
                                                                                    </span>
                                                                                </div>
                                                                                <div>
                                                                                    {carry ? (
                                                                                        <span
                                                                                            style={
                                                                                                styles.cntCarry
                                                                                            }
                                                                                        >
                                                                                            ↻ Carry
                                                                                            Over
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span
                                                                                            style={
                                                                                                styles.smallMuted
                                                                                            }
                                                                                        >
                                                                                            —
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div
                                                                                    style={
                                                                                        styles.cntCell
                                                                                    }
                                                                                >
                                                                                    <span
                                                                                        style={
                                                                                            styles.cntPendingNum
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            mc.remaining
                                                                                        }
                                                                                    </span>
                                                                                    <span
                                                                                        style={
                                                                                            styles.smallMuted
                                                                                        }
                                                                                    >
                                                                                        pending
                                                                                    </span>
                                                                                </div>
                                                                                <div
                                                                                    style={
                                                                                        styles.cntRight
                                                                                    }
                                                                                >
                                                                                    {mc.missed ? (
                                                                                        <span
                                                                                            style={
                                                                                                styles.smallMuted
                                                                                            }
                                                                                        >
                                                                                            Returned
                                                                                            to pool
                                                                                        </span>
                                                                                    ) : !done ? (
                                                                                        <button
                                                                                            type="button"
                                                                                            className="pf-btn pf-btn-solid"
                                                                                            style={
                                                                                                styles.rowSubmitBtn
                                                                                            }
                                                                                            onClick={() =>
                                                                                                openAddCaseNumbers(
                                                                                                    mc
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            Add Case
                                                                                            Numbers
                                                                                        </button>
                                                                                    ) : (
                                                                                        <span
                                                                                            style={
                                                                                                styles.smallMuted
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                mc.addedByMe
                                                                                            }{" "}
                                                                                            /{" "}
                                                                                            {
                                                                                                mc.allocatedToMe
                                                                                            }{" "}
                                                                                            added
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        }
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {(isViewingOther || allocView === "cases") && (
                                <>
                                    <div style={styles.allocSummaryRow}>
                                        <span style={styles.allocSummaryChip}>
                                            Allocated: {filteredRows.length + countsToAdd}
                                        </span>
                                        <span style={styles.allocSummaryChip}>
                                            With case number: {filteredRows.length}
                                        </span>
                                        {!isViewingOther && (
                                            <span style={styles.allocSummaryChip}>
                                                Waiting for case numbers: {countsToAdd}
                                            </span>
                                        )}
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
                                                        ampMins={ampOf(c.productId)}
                                                        showAllocatedAt={showAllocatedAt}
                                                        onSubmit={() => handlePickForSubmit(c)}
                                                        onResolveQuery={openQueryModal}
                                                        clientCell={
                                                            <ClientCell
                                                                c={c}
                                                                clients={clients}
                                                                subclients={subclients}
                                                                saving={savingClientCaseId === c.id}
                                                                onChange={(kind, v) =>
                                                                    handleCaseClientChange(
                                                                        c,
                                                                        kind,
                                                                        v
                                                                    )
                                                                }
                                                                readOnly={
                                                                    isViewingOther || !!c.missed
                                                                }
                                                                styles={styles}
                                                            />
                                                        }
                                                        styles={styles}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <table style={styles.table}>
                                                <colgroup>
                                                    <col style={{ width: "5%" }} />
                                                    <col style={{ width: "12%" }} />
                                                    <col style={{ width: "12%" }} />
                                                    <col style={{ width: "11%" }} />
                                                    <col style={{ width: "17%" }} />
                                                    <col style={{ width: "22%" }} />
                                                    <col style={{ width: "11%" }} />
                                                    <col style={{ width: "10%" }} />
                                                </colgroup>
                                                <thead>
                                                    <tr>
                                                        <th style={styles.th}>#</th>
                                                        <th style={styles.th}>Case No.</th>
                                                        <th style={styles.th}>Service</th>
                                                        <th style={styles.th}>Date</th>
                                                        <th style={styles.th}>
                                                            {showAllocatedAt
                                                                ? "Allocated At"
                                                                : "Allocated"}
                                                        </th>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                textAlign: "center",
                                                            }}
                                                        >
                                                            Status
                                                        </th>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                textAlign: "center",
                                                            }}
                                                        >
                                                            Outcome
                                                        </th>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                textAlign: "center",
                                                            }}
                                                        >
                                                            Action
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredRows.map((c, i) => {
                                                        const submitted = isSubmitted(c);
                                                        const rowAmp = ampOf(c.productId);
                                                        return (
                                                            <tr
                                                                key={c.id}
                                                                className="pf-row"
                                                                style={{
                                                                    ...styles.tr,
                                                                    background:
                                                                        i % 2 === 1
                                                                            ? "#FAFBFF"
                                                                            : "#fff",
                                                                }}
                                                            >
                                                                <td style={styles.td}>{i + 1}</td>
                                                                <td
                                                                    style={{
                                                                        ...styles.td,
                                                                        fontWeight: fontWeight.bold,
                                                                    }}
                                                                >
                                                                    {c.caseNumber}
                                                                </td>
                                                                <td style={styles.td}>
                                                                    {c.productName || "-"}
                                                                </td>
                                                                <td style={styles.td}>
                                                                    {formatDisplayDate(c.workDate)}
                                                                </td>
                                                                {/* NEW: allocation date + time, AMP time and age (manager side only) */}
                                                                <td
                                                                    style={{
                                                                        ...styles.td,
                                                                        whiteSpace: "normal",
                                                                    }}
                                                                >
                                                                    <div>
                                                                        {showAllocatedAt
                                                                            ? formatDateTime(
                                                                                  c.allocatedAt
                                                                              )
                                                                            : formatDisplayDate(
                                                                                  allocDay(
                                                                                      c.allocatedAt,
                                                                                      c.workDate
                                                                                  )
                                                                              )}
                                                                    </div>
                                                                    {showAllocatedAt &&
                                                                        (rowAmp > 0 ||
                                                                            c.allocatedAt) && (
                                                                            <div
                                                                                style={
                                                                                    styles.smallMuted
                                                                                }
                                                                            >
                                                                                {rowAmp > 0
                                                                                    ? `Time: ${formatMinutes(rowAmp)}`
                                                                                    : ""}
                                                                                {rowAmp > 0 &&
                                                                                c.allocatedAt
                                                                                    ? " · "
                                                                                    : ""}
                                                                                {c.allocatedAt
                                                                                    ? allocAgeLabel(
                                                                                          c
                                                                                      )
                                                                                    : ""}
                                                                            </div>
                                                                        )}
                                                                </td>
                                                                <td
                                                                    style={{
                                                                        ...styles.td,
                                                                        textAlign: "center",
                                                                    }}
                                                                >
                                                                    {c.missed ? (
                                                                        <div>
                                                                            <span
                                                                                style={
                                                                                    styles.statusPending
                                                                                }
                                                                            >
                                                                                Pending
                                                                            </span>
                                                                            <div
                                                                                style={
                                                                                    styles.smallMuted
                                                                                }
                                                                            >
                                                                                Not submitted ·
                                                                                returned to pool
                                                                            </div>
                                                                        </div>
                                                                    ) : submitted ? (
                                                                        <span
                                                                            style={
                                                                                styles.statusDone
                                                                            }
                                                                        >
                                                                            Submitted
                                                                        </span>
                                                                    ) : (
                                                                        <div
                                                                            style={{
                                                                                display: "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                justifyContent:
                                                                                    "center",
                                                                                gap: 8,
                                                                                flexWrap: "wrap",
                                                                            }}
                                                                        >
                                                                            <select
                                                                                value={
                                                                                    rowTypeById[
                                                                                        c.id
                                                                                    ] || ""
                                                                                }
                                                                                disabled={
                                                                                    rowSubmittingId ===
                                                                                    c.id
                                                                                }
                                                                                onChange={(e) =>
                                                                                    setRowTypeById(
                                                                                        (prev) => ({
                                                                                            ...prev,
                                                                                            [c.id]:
                                                                                                e
                                                                                                    .target
                                                                                                    .value as
                                                                                                    | ""
                                                                                                    | SubmissionType,
                                                                                        })
                                                                                    )
                                                                                }
                                                                                style={{
                                                                                    width: 150,
                                                                                    height: 34,
                                                                                    padding:
                                                                                        "0 10px",
                                                                                    borderRadius: 8,
                                                                                    border: "1px solid #dfe3ee",
                                                                                    outline: "none",
                                                                                    fontSize: 13,
                                                                                    background:
                                                                                        "#fafafa",
                                                                                    color: "#17181C",
                                                                                    cursor: "pointer",
                                                                                    boxSizing:
                                                                                        "border-box",
                                                                                }}
                                                                            >
                                                                                <option value="">
                                                                                    Pending
                                                                                </option>
                                                                                {SUBMISSION_OPTIONS.map(
                                                                                    (o) => (
                                                                                        <option
                                                                                            key={
                                                                                                o.value
                                                                                            }
                                                                                            value={
                                                                                                o.value
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                o.label
                                                                                            }
                                                                                        </option>
                                                                                    )
                                                                                )}
                                                                            </select>
                                                                            {needsReason(
                                                                                rowTypeById[c.id]
                                                                            ) && (
                                                                                <input
                                                                                    type="text"
                                                                                    autoFocus
                                                                                    placeholder={
                                                                                        rowTypeById[
                                                                                            c.id
                                                                                        ] ===
                                                                                        "OUT_OF_SCOPE"
                                                                                            ? "Out of scope reason…"
                                                                                            : "Query reason…"
                                                                                    }
                                                                                    value={
                                                                                        rowQueryById[
                                                                                            c.id
                                                                                        ] || ""
                                                                                    }
                                                                                    disabled={
                                                                                        rowSubmittingId ===
                                                                                        c.id
                                                                                    }
                                                                                    onChange={(e) =>
                                                                                        setRowQueryById(
                                                                                            (
                                                                                                prev
                                                                                            ) => ({
                                                                                                ...prev,
                                                                                                [c.id]:
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                            })
                                                                                        )
                                                                                    }
                                                                                    style={{
                                                                                        width: 150,
                                                                                        height: 34,
                                                                                        padding:
                                                                                            "0 10px",
                                                                                        borderRadius: 8,
                                                                                        border: "1px solid #dfe3ee",
                                                                                        outline:
                                                                                            "none",
                                                                                        fontSize: 13,
                                                                                        background:
                                                                                            "#fff",
                                                                                        color: "#17181C",
                                                                                        boxSizing:
                                                                                            "border-box",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td
                                                                    style={{
                                                                        ...styles.td,
                                                                        textAlign: "center",
                                                                    }}
                                                                >
                                                                    {submitted ? (
                                                                        <>
                                                                            <span
                                                                                style={{
                                                                                    fontWeight:
                                                                                        fontWeight.medium,
                                                                                }}
                                                                            >
                                                                                {outcomeLabel(
                                                                                    c.submissionType
                                                                                )}
                                                                            </span>
                                                                            {isResolvedQuery(c) && (
                                                                                <div
                                                                                    style={
                                                                                        styles.smallMuted
                                                                                    }
                                                                                >
                                                                                    Query resolved
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <span
                                                                            style={
                                                                                styles.smallMuted
                                                                            }
                                                                        >
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td
                                                                    style={{
                                                                        ...styles.td,
                                                                        textAlign: "center",
                                                                    }}
                                                                >
                                                                    {c.missed ? (
                                                                        <span
                                                                            style={
                                                                                styles.smallMuted
                                                                            }
                                                                        >
                                                                            {formatDisplayDate(
                                                                                localDateStr(
                                                                                    c.returnedAt ??
                                                                                        null
                                                                                )
                                                                            )}
                                                                        </span>
                                                                    ) : isOpenQuery(c) ? (
                                                                        <button
                                                                            type="button"
                                                                            style={
                                                                                styles.rowSubmitBtn
                                                                            }
                                                                            onClick={openQueryModal}
                                                                        >
                                                                            Resolve
                                                                        </button>
                                                                    ) : submitted ? (
                                                                        <span
                                                                            style={
                                                                                styles.smallMuted
                                                                            }
                                                                        >
                                                                            {formatDisplayDate(
                                                                                localDateStr(
                                                                                    c.submittedAt
                                                                                )
                                                                            )}
                                                                        </span>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            style={{
                                                                                ...styles.rowSubmitBtn,
                                                                                opacity:
                                                                                    canSubmitRow(
                                                                                        c
                                                                                    ) &&
                                                                                    rowSubmittingId !==
                                                                                        c.id
                                                                                        ? 1
                                                                                        : 0.5,
                                                                                cursor:
                                                                                    canSubmitRow(
                                                                                        c
                                                                                    ) &&
                                                                                    rowSubmittingId !==
                                                                                        c.id
                                                                                        ? "pointer"
                                                                                        : "not-allowed",
                                                                            }}
                                                                            disabled={
                                                                                !canSubmitRow(c) ||
                                                                                rowSubmittingId !==
                                                                                    null
                                                                            }
                                                                            onClick={() =>
                                                                                handleRowSubmit(c)
                                                                            }
                                                                        >
                                                                            {rowSubmittingId ===
                                                                            c.id
                                                                                ? "Submitting…"
                                                                                : "Submit"}
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}
                                        {clientCellError && (
                                            <p style={styles.rowError}>{clientCellError}</p>
                                        )}
                                        {rowError && <p style={styles.rowError}>{rowError}</p>}
                                    </div>

                                    {/* ---- Submit Your Work (popup, opens right where "Submit" is clicked) ---- */}
                                    {selected && (
                                        <div
                                            style={styles.bulkOverlay}
                                            onClick={() => {
                                                if (!submitting) setSelectedId(null);
                                            }}
                                        >
                                            <div
                                                ref={panelRef}
                                                role="dialog"
                                                aria-modal="true"
                                                style={{
                                                    ...styles.bulkModal,
                                                    width: 640,
                                                    textAlign: "left",
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div style={styles.bulkModalHeader}>
                                                    <div style={{ textAlign: "left" }}>
                                                        <h3
                                                            style={{
                                                                ...styles.bulkModalTitle,
                                                                textAlign: "left",
                                                            }}
                                                        >
                                                            {isViewingOther
                                                                ? `Submit Work for ${name}`
                                                                : "Submit Your Work"}
                                                        </h3>
                                                        <p
                                                            style={{
                                                                ...styles.bulkModalSubtitle,
                                                                textAlign: "left",
                                                            }}
                                                        >
                                                            Confirm submission for case "
                                                            {selected.caseNumber}"
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        style={styles.closeBtn}
                                                        onClick={() => setSelectedId(null)}
                                                        disabled={submitting}
                                                        aria-label="Close"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>

                                                <div
                                                    style={
                                                        isMobile
                                                            ? styles.submitGridMobile
                                                            : styles.submitGrid
                                                    }
                                                >
                                                    <div style={styles.filterField}>
                                                        <label style={styles.smallLabel}>
                                                            Case No.
                                                        </label>
                                                        <input
                                                            style={{
                                                                ...styles.textInput,
                                                                background: "#f5f5fa",
                                                            }}
                                                            value={selected.caseNumber}
                                                            disabled
                                                        />
                                                    </div>
                                                    <div style={styles.filterField}>
                                                        <label style={styles.smallLabel}>
                                                            Service
                                                        </label>
                                                        <input
                                                            style={{
                                                                ...styles.textInput,
                                                                background: "#f5f5fa",
                                                            }}
                                                            value={selected.productName || "-"}
                                                            disabled
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            ...styles.filterField,
                                                            flex: 1,
                                                            minWidth: 180,
                                                        }}
                                                    >
                                                        <label style={styles.smallLabel}>
                                                            Status *
                                                        </label>
                                                        <select
                                                            style={styles.textInput}
                                                            value={submitType}
                                                            autoFocus
                                                            onChange={(e) => {
                                                                const v = e.target.value as
                                                                    "" | SubmissionType;
                                                                setSubmitType(v);
                                                                if (!needsReason(v))
                                                                    setSubmitQueryText("");
                                                            }}
                                                        >
                                                            <option value="">Select status</option>
                                                            {SUBMISSION_OPTIONS.map((o) => (
                                                                <option
                                                                    key={o.value}
                                                                    value={o.value}
                                                                >
                                                                    {o.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    {needsReason(submitType) && (
                                                        <div
                                                            style={{
                                                                ...styles.filterField,
                                                                flex: "1 1 100%",
                                                                minWidth: 220,
                                                            }}
                                                        >
                                                            <label style={styles.smallLabel}>
                                                                {submitType === "OUT_OF_SCOPE"
                                                                    ? "Reason *"
                                                                    : "Query *"}
                                                            </label>
                                                            <input
                                                                style={styles.textInput}
                                                                value={submitQueryText}
                                                                onChange={(e) =>
                                                                    setSubmitQueryText(
                                                                        e.target.value
                                                                    )
                                                                }
                                                                placeholder={reasonPlaceholder(
                                                                    submitType
                                                                )}
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {submitError && (
                                                    <p style={styles.rowError}>{submitError}</p>
                                                )}

                                                <div style={{ ...styles.infoBox, marginTop: 14 }}>
                                                    <span style={styles.infoBoxIcon}>
                                                        <InfoIcon />
                                                    </span>
                                                    <div>
                                                        <strong>How it works?</strong>
                                                        <p style={{ margin: "4px 0 0" }}>
                                                            Choose the status — Completed, Completed
                                                            by Team, Completed by Client, Query or
                                                            Out of Scope — and submit. "Query" and
                                                            "Out of Scope" need a short note (query
                                                            / reason); you can track and complete
                                                            your queries later from "All Query" up
                                                            top. Use "Bulk Submit" to submit every
                                                            pending case for today in one click.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", gap: 10 }}>
                                                    <button
                                                        type="button"
                                                        className="pf-btn"
                                                        style={{
                                                            ...styles.closeBtn,
                                                            width: "auto",
                                                            height: "auto",
                                                            borderRadius: radius.md,
                                                            padding: "13px 22px",
                                                            fontWeight: fontWeight.semibold,
                                                        }}
                                                        onClick={() => setSelectedId(null)}
                                                        disabled={submitting}
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
                                                            opacity:
                                                                !canSubmitSingle || submitting
                                                                    ? 0.6
                                                                    : 1,
                                                            cursor:
                                                                !canSubmitSingle || submitting
                                                                    ? "not-allowed"
                                                                    : "pointer",
                                                        }}
                                                        disabled={!canSubmitSingle || submitting}
                                                        onClick={handleSubmitWork}
                                                    >
                                                        {submitting ? "Submitting…" : "Submit Work"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {/* ---- Bulk Submit modal ---- */}
                    {showBulkModal && (
                        <div style={styles.bulkOverlay}>
                            <div
                                style={{ ...styles.bulkModal, width: 980 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div style={styles.bulkModalHeader}>
                                    <div>
                                        <h3 style={styles.bulkModalTitle}>
                                            Bulk Submit — Today's Pending Cases
                                        </h3>
                                        <p style={styles.bulkModalSubtitle}>
                                            Every case below starts as "WIP" — only change the ones
                                            you're ready to submit now; the rest stay pending for
                                            later. A "Query" or "Out of Scope" row also needs its
                                            reason filled in.
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

                                <input
                                    style={{ ...styles.textInput, width: "100%", marginBottom: 12 }}
                                    value={bulkSearch}
                                    onChange={(e) => setBulkSearch(e.target.value)}
                                    placeholder="Search by case number, client, sub-client, service or status…"
                                />

                                <div style={styles.bulkTableWrap}>
                                    <table style={{ ...styles.bulkTable, minWidth: 880 }}>
                                        <colgroup>
                                            <col style={{ width: "18%" }} />
                                            <col style={{ width: "16%" }} />
                                            <col style={{ width: "18%" }} />
                                            <col style={{ width: "20%" }} />
                                            <col style={{ width: "28%" }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th style={styles.th}>Client</th>
                                                <th style={styles.th}>Sub-client</th>
                                                <th style={styles.th}>Case No.</th>
                                                <th style={styles.th}>Status</th>
                                                <th style={styles.th}>Query / Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bulkVisibleCases.length === 0 && (
                                                <tr>
                                                    <td
                                                        colSpan={5}
                                                        style={{
                                                            ...styles.td,
                                                            textAlign: "center",
                                                        }}
                                                    >
                                                        <span style={styles.smallMuted}>
                                                            No cases match "{bulkSearch}".
                                                        </span>
                                                    </td>
                                                </tr>
                                            )}
                                            {bulkVisibleCases.map((c) => {
                                                const type = bulkTypeById[c.id] ?? "PENDING";
                                                const queryMissing =
                                                    needsReason(type) &&
                                                    !(bulkQueryById[c.id] || "").trim();
                                                return (
                                                    <tr key={c.id} style={styles.tr}>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {c.clientName || "—"}
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {c.subclientName || "—"}
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                fontWeight: fontWeight.bold,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {c.caseNumber}
                                                            <div
                                                                style={{
                                                                    ...styles.smallMuted,
                                                                    fontWeight: "normal",
                                                                }}
                                                            >
                                                                {c.productName || ""}
                                                            </div>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <select
                                                                style={{
                                                                    ...styles.textInput,
                                                                    width: "100%",
                                                                    fontWeight:
                                                                        type !== "PENDING"
                                                                            ? fontWeight.semibold
                                                                            : "normal",
                                                                    color:
                                                                        type !== "PENDING"
                                                                            ? BRAND.blue
                                                                            : undefined,
                                                                }}
                                                                value={type}
                                                                onChange={(e) =>
                                                                    setBulkType(
                                                                        c.id,
                                                                        e.target.value as
                                                                            | "PENDING"
                                                                            | SubmissionType
                                                                    )
                                                                }
                                                            >
                                                                <option value="PENDING">WIP</option>
                                                                {SUBMISSION_OPTIONS.map((o) => (
                                                                    <option
                                                                        key={o.value}
                                                                        value={o.value}
                                                                    >
                                                                        {o.label}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {needsReason(type) ? (
                                                                <input
                                                                    style={{
                                                                        ...styles.textInput,
                                                                        width: "100%",
                                                                        border: queryMissing
                                                                            ? `1px solid ${BRAND.red || "#e04b4b"}`
                                                                            : styles.textInput
                                                                                  .border,
                                                                    }}
                                                                    value={
                                                                        bulkQueryById[c.id] ?? ""
                                                                    }
                                                                    onChange={(e) =>
                                                                        setBulkQuery(
                                                                            c.id,
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    placeholder={reasonPlaceholder(
                                                                        type
                                                                    )}
                                                                />
                                                            ) : (
                                                                <span style={styles.smallMuted}>
                                                                    —
                                                                </span>
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
                                            opacity: bulkSubmitting || !bulkCanSubmit ? 0.6 : 1,
                                            cursor:
                                                bulkSubmitting || !bulkCanSubmit
                                                    ? "not-allowed"
                                                    : "pointer",
                                        }}
                                        onClick={handleBulkSubmit}
                                        disabled={bulkSubmitting || !bulkCanSubmit}
                                        title={
                                            !bulkCanSubmit
                                                ? "Change at least one case's status away from WIP first"
                                                : undefined
                                        }
                                    >
                                        {bulkSubmitting
                                            ? "Submitting…"
                                            : bulkRowsToSubmit.length > 0
                                              ? `Submit (${bulkRowsToSubmit.length})`
                                              : "Submit"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- All Query modal ---- */}
                    {showQueryModal && (
                        <div style={styles.bulkOverlay}>
                            <div
                                style={{ ...styles.bulkModal, width: 940 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div style={styles.bulkModalHeader}>
                                    <div>
                                        <h3 style={styles.bulkModalTitle}>All Queries</h3>
                                        <p style={styles.bulkModalSubtitle}>
                                            Every query raised, across all dates. Once a query is
                                            sorted out, mark it as completed from here. If the team
                                            completes one, it moves to Query Completed on its own
                                            (as "Completed by Team").
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        style={styles.closeBtn}
                                        onClick={closeQueryModal}
                                        aria-label="Close"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div style={styles.queryTilesRow}>
                                    <QueryTile
                                        label="In Query"
                                        value={openQueries.length}
                                        tint={BRAND.red}
                                        active={queryView === "OPEN"}
                                        onClick={() => setQueryView("OPEN")}
                                        styles={styles}
                                    />
                                    <QueryTile
                                        label="Query Completed"
                                        value={resolvedQueries.length}
                                        tint={BRAND.green}
                                        active={queryView === "RESOLVED"}
                                        onClick={() => setQueryView("RESOLVED")}
                                        styles={styles}
                                    />
                                    <QueryTile
                                        label="Total Queries"
                                        value={openQueries.length + resolvedQueries.length}
                                        tint={BRAND.blue}
                                        active={false}
                                        styles={styles}
                                    />
                                </div>

                                <input
                                    style={{ ...styles.textInput, width: "100%", marginBottom: 12 }}
                                    value={querySearch}
                                    onChange={(e) => setQuerySearch(e.target.value)}
                                    placeholder="Search by case number, service or query…"
                                />

                                <div style={styles.bulkTableWrap}>
                                    <table style={{ ...styles.bulkTable, minWidth: 820 }}>
                                        <colgroup>
                                            <col style={{ width: "14%" }} />
                                            <col style={{ width: "16%" }} />
                                            <col style={{ width: "13%" }} />
                                            <col style={{ width: "22%" }} />
                                            <col style={{ width: "35%" }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th style={styles.th}>Case No.</th>
                                                <th style={styles.th}>Service</th>
                                                <th style={styles.th}>Date</th>
                                                <th style={styles.th}>Query</th>
                                                <th style={styles.th}>
                                                    {queryView === "OPEN"
                                                        ? "Complete as"
                                                        : "Completed as"}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleQueries.length === 0 && (
                                                <tr>
                                                    <td
                                                        colSpan={5}
                                                        style={{
                                                            ...styles.td,
                                                            textAlign: "center",
                                                        }}
                                                    >
                                                        <span style={styles.smallMuted}>
                                                            {querySearch.trim()
                                                                ? `No queries match "${querySearch}".`
                                                                : queryView === "OPEN"
                                                                  ? "No open queries."
                                                                  : "No completed queries yet."}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )}
                                            {visibleQueries.map((c) => {
                                                const chosen = resolveTypeById[c.id] || "";
                                                const busy = resolvingId === c.id;
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
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {c.productName || "-"}
                                                        </td>
                                                        <td style={styles.td}>
                                                            {formatDisplayDate(c.workDate)}
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                                wordBreak: "break-word",
                                                            }}
                                                        >
                                                            {c.queryText || "—"}
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {queryView === "OPEN" ? (
                                                                <div
                                                                    style={styles.queryResolveCell}
                                                                >
                                                                    <select
                                                                        style={{
                                                                            ...styles.textInput,
                                                                            flex: 1,
                                                                            minWidth: 0,
                                                                        }}
                                                                        value={chosen}
                                                                        disabled={busy}
                                                                        onChange={(e) =>
                                                                            setResolveTypeById(
                                                                                (prev) => ({
                                                                                    ...prev,
                                                                                    [c.id]: e.target
                                                                                        .value as
                                                                                        | QueryResolution
                                                                                        | "",
                                                                                })
                                                                            )
                                                                        }
                                                                    >
                                                                        <option value="">
                                                                            Select…
                                                                        </option>
                                                                        {RESOLUTION_OPTIONS.map(
                                                                            (o) => (
                                                                                <option
                                                                                    key={o.value}
                                                                                    value={o.value}
                                                                                >
                                                                                    {o.label}
                                                                                </option>
                                                                            )
                                                                        )}
                                                                    </select>
                                                                    <button
                                                                        type="button"
                                                                        style={{
                                                                            ...styles.rowSubmitBtn,
                                                                            opacity:
                                                                                !chosen || busy
                                                                                    ? 0.5
                                                                                    : 1,
                                                                            cursor:
                                                                                !chosen || busy
                                                                                    ? "not-allowed"
                                                                                    : "pointer",
                                                                        }}
                                                                        disabled={!chosen || busy}
                                                                        onClick={() =>
                                                                            handleResolveQuery(c)
                                                                        }
                                                                    >
                                                                        {busy
                                                                            ? "Saving…"
                                                                            : "Complete"}
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span style={styles.statusDone}>
                                                                    {outcomeLabel(c.submissionType)}
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {queryError && <p style={styles.rowError}>{queryError}</p>}
                                {queryNotice && (
                                    <p style={{ ...styles.rowError, color: BRAND.blue }}>
                                        {queryNotice}
                                    </p>
                                )}

                                <div style={styles.bulkModalFooter}>
                                    <button
                                        type="button"
                                        className="pf-btn pf-btn-outline"
                                        style={styles.bulkCancelBtn}
                                        onClick={closeQueryModal}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showSelfAllocModal && (
                        <div style={styles.bulkOverlay}>
                            <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                                {selfAllocSuccessCount !== null ? (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            textAlign: "center",
                                            gap: 10,
                                            padding: "28px 10px 10px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 56,
                                                height: 56,
                                                borderRadius: "50%",
                                                background: withAlpha(BRAND.green, 0.12),
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                color: BRAND.green,
                                            }}
                                        >
                                            <CheckIcon />
                                        </div>
                                        <h3 style={styles.bulkModalTitle}>Allocated!</h3>
                                        <p style={styles.bulkModalSubtitle}>
                                            {selfAllocSuccessCount} case
                                            {selfAllocSuccessCount === 1 ? "" : "s"} allocated to
                                            yourself.{" "}
                                            {selfAllocMode === "counts"
                                                ? `You'll find ${
                                                      selfAllocSuccessCount === 1 ? "it" : "them"
                                                  } under "Counts" — add the case number${
                                                      selfAllocSuccessCount === 1 ? "" : "s"
                                                  } there.`
                                                : `You'll find ${
                                                      selfAllocSuccessCount === 1 ? "it" : "them"
                                                  } in Today's Allocation below, ready to submit.`}
                                        </p>
                                        <button
                                            type="button"
                                            className="pf-btn pf-btn-solid"
                                            style={{
                                                ...styles.submitBtn,
                                                width: "auto",
                                                padding: "10px 28px",
                                            }}
                                            onClick={closeSelfAllocModal}
                                        >
                                            Done
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div style={styles.bulkModalHeader}>
                                            <div>
                                                <h3 style={styles.bulkModalTitle}>Self Allocate</h3>
                                                <p style={styles.bulkModalSubtitle}>
                                                    Pick a service, then take cases that already
                                                    have a case number, or take a count of cases
                                                    whose numbers aren't known yet (you add the
                                                    numbers later). Only services your team (
                                                    {myTeamRaw || "no team set"}) is aligned to show
                                                    up here.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                style={styles.closeBtn}
                                                onClick={closeSelfAllocModal}
                                                aria-label="Close"
                                            >
                                                ✕
                                            </button>
                                        </div>

                                        <div style={styles.selfAllocModeRow}>
                                            <button
                                                type="button"
                                                className="pf-btn"
                                                style={
                                                    selfAllocMode === "cases"
                                                        ? styles.selfAllocModeBtnActive
                                                        : styles.selfAllocModeBtn
                                                }
                                                onClick={() => switchSelfAllocMode("cases")}
                                            >
                                                With case number
                                            </button>
                                            <button
                                                type="button"
                                                className="pf-btn"
                                                style={
                                                    selfAllocMode === "counts"
                                                        ? styles.selfAllocModeBtnActive
                                                        : styles.selfAllocModeBtn
                                                }
                                                onClick={() => switchSelfAllocMode("counts")}
                                            >
                                                Count only (add numbers later)
                                            </button>
                                        </div>

                                        <div style={{ marginBottom: 14 }}>
                                            <label style={styles.smallLabel}>Service</label>
                                            {selfAllocServicesLoading ? (
                                                <p style={styles.smallMuted}>Loading services…</p>
                                            ) : selfAllocServicesError ? (
                                                <p style={styles.rowError}>
                                                    {selfAllocServicesError}
                                                </p>
                                            ) : !myTeamRaw ? (
                                                <p style={styles.smallMuted}>
                                                    You don't have a team set on your profile, so no
                                                    service can be matched to you. Ask your manager
                                                    to set your team.
                                                </p>
                                            ) : selfAllocServices.length === 0 ? (
                                                <p style={styles.smallMuted}>
                                                    No services are aligned to your team (
                                                    {myTeamRaw}) yet.
                                                </p>
                                            ) : (
                                                <select
                                                    style={{ ...styles.textInput, width: "100%" }}
                                                    value={selfAllocServiceId}
                                                    onChange={(e) =>
                                                        selfAllocMode === "counts"
                                                            ? loadAvailableCounts(e.target.value)
                                                            : loadSelfAllocCases(e.target.value)
                                                    }
                                                >
                                                    <option value="">Select a service…</option>
                                                    {selfAllocServices.map((s) => (
                                                        <option key={s.id} value={s.id}>
                                                            {s.product_name}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>

                                        {selfAllocServiceId && selfAllocMode === "counts" && (
                                            <div style={styles.bulkTableWrap}>
                                                {availableCountsLoading ? (
                                                    <p style={styles.smallMuted}>
                                                        Loading remaining counts…
                                                    </p>
                                                ) : availableCountsError ? (
                                                    <p style={styles.rowError}>
                                                        {availableCountsError}
                                                    </p>
                                                ) : availableCounts.length === 0 ? (
                                                    <p style={styles.smallMuted}>
                                                        No unallocated counts left on this service.
                                                    </p>
                                                ) : (
                                                    <table style={styles.bulkTable}>
                                                        <colgroup>
                                                            <col style={{ width: "36%" }} />
                                                            <col style={{ width: "20%" }} />
                                                            <col style={{ width: "16%" }} />
                                                            <col style={{ width: "28%" }} />
                                                        </colgroup>
                                                        <thead>
                                                            <tr>
                                                                <th style={styles.th}>
                                                                    Client / Subclient
                                                                </th>
                                                                <th style={styles.th}>Date</th>
                                                                <th style={styles.th}>Available</th>
                                                                <th style={styles.th}>
                                                                    How many to take
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {availableCounts.map((c) => (
                                                                <tr key={c.id} style={styles.tr}>
                                                                    <td
                                                                        style={{
                                                                            ...styles.td,
                                                                            whiteSpace: "normal",
                                                                        }}
                                                                    >
                                                                        {[
                                                                            c.clientName,
                                                                            c.subclientName,
                                                                        ]
                                                                            .filter(Boolean)
                                                                            .join(" / ") || "-"}
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        {formatDisplayDate(
                                                                            c.workDate
                                                                        )}
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        {c.unallocated}
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        <div
                                                                            style={{
                                                                                display: "flex",
                                                                                gap: 6,
                                                                                alignItems:
                                                                                    "center",
                                                                            }}
                                                                        >
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                max={c.unallocated}
                                                                                style={{
                                                                                    ...styles.textInput,
                                                                                    width: 80,
                                                                                    padding:
                                                                                        "6px 8px",
                                                                                }}
                                                                                value={
                                                                                    selfAllocQtyById[
                                                                                        c.id
                                                                                    ] ?? 0
                                                                                }
                                                                                onChange={(e) =>
                                                                                    setSelfAllocQty(
                                                                                        c,
                                                                                        Number(
                                                                                            e.target
                                                                                                .value
                                                                                        )
                                                                                    )
                                                                                }
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                className="pf-btn pf-btn-outline"
                                                                                style={
                                                                                    styles.selfAllocAllBtn
                                                                                }
                                                                                onClick={() =>
                                                                                    setSelfAllocQty(
                                                                                        c,
                                                                                        c.unallocated
                                                                                    )
                                                                                }
                                                                            >
                                                                                All
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        )}

                                        {selfAllocServiceId && selfAllocMode === "cases" && (
                                            <div style={styles.bulkTableWrap}>
                                                {selfAllocCasesLoading ? (
                                                    <p style={styles.smallMuted}>
                                                        Loading remaining cases…
                                                    </p>
                                                ) : selfAllocCasesError ? (
                                                    <p style={styles.rowError}>
                                                        {selfAllocCasesError}
                                                    </p>
                                                ) : selfAllocCases.length === 0 ? (
                                                    <p style={styles.smallMuted}>
                                                        No pending cases left on this service.
                                                    </p>
                                                ) : (
                                                    <table style={styles.bulkTable}>
                                                        <colgroup>
                                                            <col style={{ width: "10%" }} />
                                                            <col style={{ width: "30%" }} />
                                                            <col style={{ width: "30%" }} />
                                                            <col style={{ width: "30%" }} />
                                                        </colgroup>
                                                        <thead>
                                                            <tr>
                                                                <th style={styles.th}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={
                                                                            selfAllocCases.length >
                                                                                0 &&
                                                                            selfAllocSelectedIds.size ===
                                                                                selfAllocCases.length
                                                                        }
                                                                        onChange={
                                                                            toggleSelfAllocSelectAll
                                                                        }
                                                                        aria-label="Select all"
                                                                    />
                                                                </th>
                                                                <th style={styles.th}>Case No.</th>
                                                                <th style={styles.th}>
                                                                    Client / Subclient
                                                                </th>
                                                                <th style={styles.th}>Date</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {selfAllocCases.map((c) => (
                                                                <tr
                                                                    key={c.id}
                                                                    style={{
                                                                        ...styles.tr,
                                                                        cursor: "pointer",
                                                                    }}
                                                                    onClick={() =>
                                                                        toggleSelfAllocCase(c.id)
                                                                    }
                                                                >
                                                                    <td
                                                                        style={styles.td}
                                                                        onClick={(e) =>
                                                                            e.stopPropagation()
                                                                        }
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selfAllocSelectedIds.has(
                                                                                c.id
                                                                            )}
                                                                            onChange={() =>
                                                                                toggleSelfAllocCase(
                                                                                    c.id
                                                                                )
                                                                            }
                                                                        />
                                                                    </td>
                                                                    <td
                                                                        style={{
                                                                            ...styles.td,
                                                                            fontWeight:
                                                                                fontWeight.bold,
                                                                        }}
                                                                    >
                                                                        {c.caseNumber}
                                                                    </td>
                                                                    <td
                                                                        style={{
                                                                            ...styles.td,
                                                                            whiteSpace: "normal",
                                                                        }}
                                                                    >
                                                                        {[
                                                                            c.clientName,
                                                                            c.subclientName,
                                                                        ]
                                                                            .filter(Boolean)
                                                                            .join(" / ") || "-"}
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        {c.workDate}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        )}

                                        <div style={styles.bulkModalFooter}>
                                            <button
                                                type="button"
                                                className="pf-btn pf-btn-outline"
                                                style={styles.bulkCancelBtn}
                                                onClick={closeSelfAllocModal}
                                                disabled={selfAllocSubmitting}
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
                                                    opacity:
                                                        selfAllocSubmitting ||
                                                        selfAllocPickedCount === 0
                                                            ? 0.6
                                                            : 1,
                                                    cursor:
                                                        selfAllocSubmitting ||
                                                        selfAllocPickedCount === 0
                                                            ? "not-allowed"
                                                            : "pointer",
                                                }}
                                                onClick={
                                                    selfAllocMode === "counts"
                                                        ? submitSelfAllocCounts
                                                        : submitSelfAllocation
                                                }
                                                disabled={
                                                    selfAllocSubmitting ||
                                                    selfAllocPickedCount === 0
                                                }
                                            >
                                                {selfAllocSubmitting
                                                    ? "Allocating…"
                                                    : selfAllocPickedCount > 0
                                                      ? `Allocate (${selfAllocPickedCount})`
                                                      : "Allocate"}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ---- Add Case Numbers modal — per-case client / subclient + status ---- */}
                    {addCnCount && (
                        <div style={styles.bulkOverlay}>
                            <div
                                style={{ ...styles.bulkModal, width: 980 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div style={styles.bulkModalHeader}>
                                    <div>
                                        <h3 style={styles.bulkModalTitle}>Add Case Numbers</h3>
                                        <p style={styles.bulkModalSubtitle}>
                                            {addCnCount.productName || "Service"} ·{" "}
                                            {formatDisplayDate(addCnCount.workDate)} —{" "}
                                            <strong>{addCnCount.remaining}</strong> case
                                            {addCnCount.remaining === 1 ? "" : "s"} left to add.
                                            Type the case number, pick its client (every case can
                                            have a different one) and its status — WIP / Pending
                                            keeps it pending, any other status submits it right
                                            away.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        style={styles.closeBtn}
                                        onClick={closeAddCaseNumbers}
                                        aria-label="Close"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <label style={styles.smallLabel}>
                                    Case numbers, client &amp; status
                                </label>
                                <div
                                    style={{
                                        ...styles.bulkTableWrap,
                                        marginTop: 4,
                                        marginBottom: 6,
                                    }}
                                >
                                    <table style={{ ...styles.bulkTable, minWidth: 880 }}>
                                        <colgroup>
                                            <col style={{ width: "5%" }} />
                                            <col style={{ width: "17%" }} />
                                            <col style={{ width: "21%" }} />
                                            <col style={{ width: "19%" }} />
                                            <col style={{ width: "17%" }} />
                                            <col style={{ width: "21%" }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th style={styles.th}>#</th>
                                                <th style={styles.th}>Case No.</th>
                                                <th style={styles.th}>Client *</th>
                                                <th style={styles.th}>Subclient</th>
                                                <th style={styles.th}>Status</th>
                                                <th style={styles.th}>Query / Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {addCnRows.map((r, i) => {
                                                const queryMissing =
                                                    needsReason(r.status) && !r.query.trim();
                                                const rowSubOptions = subclients.filter(
                                                    (s) =>
                                                        s.clientId === r.clientId &&
                                                        s.status !== "Inactive"
                                                );
                                                // WIP / Pending are the "not submitted" statuses
                                                const isNotSubmitted =
                                                    r.status === "WIP" || r.status === "PENDING";
                                                return (
                                                    <tr key={i} style={styles.tr}>
                                                        <td style={styles.td}>{i + 1}</td>
                                                        <td style={styles.td}>
                                                            <input
                                                                style={{
                                                                    ...styles.textInput,
                                                                    width: "100%",
                                                                }}
                                                                value={r.cn}
                                                                maxLength={50}
                                                                disabled={addCnSubmitting}
                                                                placeholder={
                                                                    caseNumberRequired
                                                                        ? "Case number"
                                                                        : "Case number (optional)"
                                                                }
                                                                onChange={(e) =>
                                                                    setAddCnRow(i, {
                                                                        cn: e.target.value,
                                                                    })
                                                                }
                                                                onPaste={(e) => {
                                                                    const t =
                                                                        e.clipboardData.getData(
                                                                            "text"
                                                                        );
                                                                    if (/[\n,\t]/.test(t.trim())) {
                                                                        e.preventDefault();
                                                                        pasteAddCnRows(i, t);
                                                                    }
                                                                }}
                                                            />
                                                        </td>
                                                        <td style={styles.td}>
                                                            <select
                                                                style={{
                                                                    ...styles.textInput,
                                                                    width: "100%",
                                                                }}
                                                                value={r.clientId}
                                                                disabled={addCnSubmitting}
                                                                onChange={(e) =>
                                                                    setAddCnRow(i, {
                                                                        clientId: e.target.value,
                                                                        subclientId: "",
                                                                    })
                                                                }
                                                            >
                                                                <option value="">
                                                                    {addCnClientsLoading
                                                                        ? "Loading clients…"
                                                                        : addCnClients.length === 0
                                                                          ? "No clients mapped to this service"
                                                                          : "Select client"}
                                                                </option>
                                                                {addCnClients.map((cl) => (
                                                                    <option
                                                                        key={cl.id}
                                                                        value={cl.id}
                                                                    >
                                                                        {cl.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <select
                                                                style={{
                                                                    ...styles.textInput,
                                                                    width: "100%",
                                                                }}
                                                                value={r.subclientId}
                                                                disabled={
                                                                    addCnSubmitting || !r.clientId
                                                                }
                                                                onChange={(e) =>
                                                                    setAddCnRow(i, {
                                                                        subclientId: e.target.value,
                                                                    })
                                                                }
                                                            >
                                                                <option value="">
                                                                    {!r.clientId
                                                                        ? "Pick client first"
                                                                        : rowSubOptions.length === 0
                                                                          ? "No subclients"
                                                                          : "Subclient (optional)"}
                                                                </option>
                                                                {rowSubOptions.map((s) => (
                                                                    <option key={s.id} value={s.id}>
                                                                        {s.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td style={styles.td}>
                                                            <select
                                                                style={{
                                                                    ...styles.textInput,
                                                                    width: "100%",
                                                                    fontWeight: !isNotSubmitted
                                                                        ? fontWeight.semibold
                                                                        : "normal",
                                                                    color: !isNotSubmitted
                                                                        ? BRAND.blue
                                                                        : undefined,
                                                                }}
                                                                value={r.status}
                                                                disabled={addCnSubmitting}
                                                                onChange={(e) =>
                                                                    setAddCnRow(i, {
                                                                        status: e.target.value as
                                                                            | "WIP"
                                                                            | "PENDING"
                                                                            | SubmissionType,
                                                                        query: needsReason(
                                                                            e.target.value
                                                                        )
                                                                            ? r.query
                                                                            : "",
                                                                    })
                                                                }
                                                            >
                                                                <option value="WIP">WIP</option>
                                                                <option value="PENDING">
                                                                    Pending
                                                                </option>
                                                                {SUBMISSION_OPTIONS.map((o) => (
                                                                    <option
                                                                        key={o.value}
                                                                        value={o.value}
                                                                    >
                                                                        {o.label}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td
                                                            style={{
                                                                ...styles.td,
                                                                whiteSpace: "normal",
                                                            }}
                                                        >
                                                            {needsReason(r.status) ? (
                                                                <input
                                                                    style={{
                                                                        ...styles.textInput,
                                                                        width: "100%",
                                                                        border: queryMissing
                                                                            ? `1px solid ${STATUS_RED}`
                                                                            : styles.textInput
                                                                                  .border,
                                                                    }}
                                                                    value={r.query}
                                                                    disabled={addCnSubmitting}
                                                                    placeholder={reasonPlaceholder(
                                                                        r.status
                                                                    )}
                                                                    onChange={(e) =>
                                                                        setAddCnRow(i, {
                                                                            query: e.target.value,
                                                                        })
                                                                    }
                                                                />
                                                            ) : (
                                                                <span style={styles.smallMuted}>
                                                                    —
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 10,
                                        flexWrap: "wrap",
                                        marginBottom: 12,
                                    }}
                                >
                                    <span style={styles.smallMuted}>
                                        {addCnParsed.length} of {addCnCount.remaining} entered
                                        {addCnSubmitCount > 0
                                            ? ` · ${addCnSubmitCount} will be submitted`
                                            : ""}
                                    </span>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <button
                                            type="button"
                                            className="pf-btn pf-btn-outline"
                                            style={styles.selfAllocAllBtn}
                                            disabled={addCnSubmitting || addCnRows.length < 2}
                                            onClick={applyFirstClientToAll}
                                        >
                                            Apply row 1 client to all
                                        </button>
                                        {addCnRows.length < addCnCount.remaining && (
                                            <button
                                                type="button"
                                                className="pf-btn pf-btn-outline"
                                                style={styles.selfAllocAllBtn}
                                                disabled={addCnSubmitting}
                                                onClick={() =>
                                                    setAddCnRows((prev) => [
                                                        ...prev,
                                                        blankAddCnRow(addCnCount),
                                                    ])
                                                }
                                            >
                                                + Add row
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {addCnError && <p style={styles.rowError}>{addCnError}</p>}

                                <div style={styles.bulkModalFooter}>
                                    <button
                                        type="button"
                                        className="pf-btn pf-btn-outline"
                                        style={styles.bulkCancelBtn}
                                        onClick={closeAddCaseNumbers}
                                        disabled={addCnSubmitting}
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
                                            opacity:
                                                addCnSubmitting ||
                                                addCnParsed.length === 0 ||
                                                addCnMissingClient
                                                    ? 0.6
                                                    : 1,
                                            cursor:
                                                addCnSubmitting ||
                                                addCnParsed.length === 0 ||
                                                addCnMissingClient
                                                    ? "not-allowed"
                                                    : "pointer",
                                        }}
                                        onClick={submitAddCaseNumbers}
                                        disabled={
                                            addCnSubmitting ||
                                            addCnParsed.length === 0 ||
                                            addCnMissingClient
                                        }
                                        title={
                                            addCnMissingClient
                                                ? "Select a client for every case number you typed"
                                                : undefined
                                        }
                                    >
                                        {addCnSubmitting
                                            ? "Saving…"
                                            : addCnParsed.length > 0
                                              ? `Submit (${addCnParsed.length})`
                                              : "Submit"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {selfAllocToast && <div style={styles.toast}>{selfAllocToast}</div>}
            {toastMsg && (
                <div
                    role="status"
                    style={{
                        ...styles.toast,
                        zIndex: 400,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <span style={{ color: BRAND.green, display: "flex" }}>
                        <CheckIcon />
                    </span>
                    {toastMsg}
                </div>
            )}

            {/* Open-query reminder for every role (own / team / whole org) */}
            <TeamQueriesPopup
                userKey={myId}
                onViewOwn={openQueryModal}
                enabled={!isBlueMode && !isViewingOther && !!myId}
                // NEW: "Go to this profile" -> opens that employee's profile with
                // the All Query popup already open. Only roles that can view
                // other profiles get the button.
                onOpenProfile={
                    canViewOthers
                        ? (employeeId: string) => {
                              openEmployee(employeeId);
                              setShowQueryModal(true);
                          }
                        : undefined
                }
            />

            {isAvatarPreviewOpen && photoUrl && (
                <div style={styles.lightboxOverlay} onClick={() => setIsAvatarPreviewOpen(false)}>
                    <button
                        type="button"
                        style={styles.lightboxCloseBtn}
                        onClick={() => setIsAvatarPreviewOpen(false)}
                        aria-label="Close"
                        title="Close"
                    >
                        <i className="ti ti-x" style={{ fontSize: fontSize.lg }} />
                    </button>
                    <img
                        src={photoUrl}
                        alt={name}
                        style={styles.lightboxImg}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Small presentational subcomponents                                     */
/* ---------------------------------------------------------------------- */

const ROW_TONES = {
    role: { bg: "#E3F1FC", fg: "#2F9BE6" },
    email: { bg: "#DDF6EC", fg: "#18B67F" },
    phone: { bg: "#E4E8FB", fg: "#4A5BD4" },
    team: { bg: "#EBE3FA", fg: "#8A5CE0" },
    dept: { bg: "#FDEEDC", fg: "#F29A2E" },
    manager: { bg: "#FCE4EF", fg: "#E8479A" },
};

function InfoIconRow({
    icon,
    label,
    value,
    styles,
    tone,
    href,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    styles: Record<string, CSSProperties>;
    tone: { bg: string; fg: string };
    href?: string;
}) {
    return (
        <div style={styles.infoIconRow}>
            <span style={{ ...styles.infoChip, background: tone.bg, color: tone.fg }}>
                <span style={{ display: "flex", transform: "scale(1.05)" }}>{icon}</span>
            </span>
            <div style={styles.infoStack}>
                <span style={styles.infoLabelTop}>{label}</span>
                {href ? (
                    <a href={href} style={{ ...styles.infoValue, textDecoration: "none" }}>
                        {value}
                    </a>
                ) : (
                    <span style={styles.infoValue}>{value}</span>
                )}
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
    onClick,
    active,
    progress,
    badge,
}: {
    icon: React.ReactNode;
    tint: string;
    value: number | string;
    label: string;
    sub: string;
    styles: Record<string, CSSProperties>;
    onClick?: () => void;
    active?: boolean;
    progress?: number; // 0-100, thin bar under the text
    badge?: string; // small pill at the top-right (e.g. "25%")
}) {
    return (
        <div
            className="pf-card-hover"
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick}
            onKeyDown={(e) => {
                if (onClick && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                ...styles.statCard,
                cursor: onClick ? "pointer" : "default",
                outline: active ? `2px solid ${tint}` : "none",
                boxShadow: active ? `0 8px 22px ${tint}33` : styles.statCard.boxShadow,
            }}
        >
            <div style={{ ...styles.statIconWrap, background: `${tint}1A`, color: tint }}>
                {icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...styles.statValue, color: tint }}>{value}</div>
                <div style={styles.statLabel}>{label}</div>
                <div style={styles.statSub}>{sub}</div>
                {progress !== undefined && (
                    <div
                        style={{
                            height: 5,
                            borderRadius: 3,
                            background: `${tint}22`,
                            marginTop: 5,
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                width: `${progress}%`,
                                height: "100%",
                                background: tint,
                                borderRadius: 3,
                                transition: "width .3s ease",
                            }}
                        />
                    </div>
                )}
            </div>
            {onClick && (
                <span style={{ fontSize: 11, fontWeight: 600, color: tint, whiteSpace: "nowrap" }}>
                    {active ? "Hide ▴" : "View ▾"}
                </span>
            )}
            {badge && (
                <span
                    style={{
                        alignSelf: "flex-start",
                        padding: "2px 9px",
                        borderRadius: 999,
                        background: `${tint}1F`,
                        color: tint,
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                    }}
                >
                    {badge}
                </span>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Manager-only: open queries of my team (popup + details)                */
/* ---------------------------------------------------------------------- */
// login.tsx sets this on every successful login; cleared once handled here.
const LOGIN_FLAG = "pf_team_query_popup_pending";

// Roles that have a team / org view (same rule the backend enforces).
const TEAM_QUERY_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD", "VERTICAL_HEAD"];

// ---- reminder schedule -------------------------------------------------
// The popup shows at most QR_MAX_PER_DAY times a day: once the first time
// the user is on this page today (their first login), then again later in
// the day, never closer together than QR_MIN_GAP_MS. Counted per user per
// calendar day in localStorage; a "Later" / close click still counts.
const QR_MAX_PER_DAY = 3;
const QR_MIN_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours
const QR_CHECK_EVERY_MS = 5 * 60 * 1000; // while the page stays open

type QrSched = { d: string; n: number; last: number };
const qrKey = (userKey: string | null) => `pf_qr_sched:${userKey || "anon"}`;
const qrToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
};
function qrRead(userKey: string | null): QrSched {
    try {
        const raw = window.localStorage.getItem(qrKey(userKey));
        const v = raw ? (JSON.parse(raw) as QrSched) : null;
        if (v && v.d === qrToday()) return v;
    } catch {
        /* storage blocked / bad JSON - treat as nothing shown yet */
    }
    return { d: qrToday(), n: 0, last: 0 };
}
function qrIsDue(userKey: string | null) {
    const v = qrRead(userKey);
    if (v.n >= QR_MAX_PER_DAY) return false;
    if (v.n === 0) return true; // first time today
    return Date.now() - v.last >= QR_MIN_GAP_MS;
}
function qrRecordShown(userKey: string | null) {
    const v = qrRead(userKey);
    try {
        window.localStorage.setItem(
            qrKey(userKey),
            JSON.stringify({ d: v.d, n: v.n + 1, last: Date.now() })
        );
    } catch {
        /* storage blocked - skip */
    }
}

type TeamQuery = {
    id: string;
    caseNumber: string;
    productName: string | null;
    clientName: string | null;
    subclientName: string | null;
    employeeId: string;
    employeeName: string;
    queryText: string;
    submittedAt: string | null;
    ageHours: number;
    urgent: boolean;
};
type TeamMember = {
    employeeId: string;
    name: string;
    openCount: number;
    urgentCount: number;
    oldestAgeHours: number;
};
type TeamQueryData = {
    totalOpen: number;
    urgentCount: number;
    urgentHours: number;
    members: TeamMember[];
    queries: TeamQuery[];
    // who the list covers: SELF = only me, TEAM = my team, ORG = whole org
    scope?: "SELF" | "TEAM" | "ORG";
};

// 53.5 -> "2d 5h", 5.2 -> "5h", 0.4 -> "<1h"
function tqAgeLabel(hours: number) {
    if (hours < 1) return "<1h";
    const h = Math.floor(hours);
    const d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

function tqFmtDateTime(iso: string | null) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

const TQ_RED = "#F43F5E";
const tqOverlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 460,
    background: "rgba(23,24,28,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
};
const tqBtn: React.CSSProperties = {
    height: 36,
    padding: "0 16px",
    borderRadius: 10,
    border: "1px solid #dfe3ee",
    background: "#fff",
    color: "#17181C",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
};
const tqBtnRed: React.CSSProperties = {
    ...tqBtn,
    border: "none",
    background: "linear-gradient(135deg, #FB7185, #F43F5E)",
    color: "#fff",
};

function TeamQueriesPopup({
    enabled,
    onOpenProfile: onOpenProfileProp,
    userKey,
    onViewOwn,
}: {
    enabled: boolean;
    onOpenProfile?: (employeeId: string) => void;
    userKey: string | null;
    // opens the user's own All Query popup (used when the scope is SELF)
    onViewOwn?: () => void;
}) {
    const [data, setData] = useState<TeamQueryData | null>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [openEmp, setOpenEmp] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;

        // login.tsx sets this flag on every login; just clear it - the daily
        // schedule (qrIsDue) decides whether a popup is actually due.
        try {
            window.localStorage.removeItem(LOGIN_FLAG);
        } catch {
            /* storage blocked */
        }

        const load = async (): Promise<TeamQueryData | null> => {
            try {
                const res = await authFetch(`${API_BASE}/api/service-cases/team-queries`);
                const json = await res.json();
                if (cancelled || !res.ok || !json.success) return null;
                const d: TeamQueryData = json.data;
                setData(d);
                return d;
            } catch (err) {
                console.error("team queries load failed:", err);
                return null;
            }
        };

        // Show the popup only when today's schedule allows it AND there is
        // something open to remind about.
        const maybeRemind = async () => {
            if (!qrIsDue(userKey)) return;
            const d = await load();
            if (cancelled || !d || d.totalOpen === 0) return;
            if (!qrIsDue(userKey)) return; // another tab may have just shown it
            qrRecordShown(userKey);
            setShowSummary(true);
        };

        (async () => {
            const d = await load(); // always load: feeds the "reopen" pill
            if (cancelled || !d) return;
            if (d.totalOpen > 0 && qrIsDue(userKey)) {
                qrRecordShown(userKey);
                setShowSummary(true);
            }
        })();

        // later reminders while the page stays open
        const timer = window.setInterval(maybeRemind, QR_CHECK_EVERY_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [enabled, userKey]);

    const urgentList = useMemo(() => (data?.queries || []).filter((q) => q.urgent), [data]);

    if (!enabled || !data || data.totalOpen === 0) return null;
    const hasUrgent = data.urgentCount > 0;

    // Wording + behaviour follow who the list covers (backend `scope`).
    const scope = data.scope || "TEAM";
    const isSelf = scope === "SELF";
    const subject = isSelf
        ? "You have"
        : scope === "ORG"
          ? "Your organization has"
          : "Your team has";
    const popupTitle = isSelf
        ? "My Queries"
        : scope === "ORG"
          ? "Organization Queries"
          : "Team Queries";
    const pillLabel = isSelf ? "My queries" : scope === "ORG" ? "Org queries" : "Team queries";
    // "Go to profile" makes no sense when the list is just my own queries.
    const onOpenProfile = isSelf ? undefined : onOpenProfileProp;
    // SELF: jump straight to my own query list; others: the details popup.
    const openDetails = () => {
        if (isSelf && onViewOwn) onViewOwn();
        else setShowDetails(true);
    };

    return (
        <>
            {/* reopen pill */}
            {!showSummary && !showDetails && (
                <button
                    type="button"
                    onClick={openDetails}
                    style={{
                        position: "fixed",
                        right: 18,
                        bottom: 18,
                        zIndex: 400,
                        border: "none",
                        borderRadius: 999,
                        padding: "10px 16px",
                        background: hasUrgent ? TQ_RED : "#3B4A9E",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: "0 8px 22px rgba(0,0,0,.22)",
                    }}
                >
                    {hasUrgent ? "⚠ " : ""}
                    {pillLabel} · {data.totalOpen}
                    {hasUrgent ? ` (${data.urgentCount} urgent)` : ""}
                </button>
            )}

            {/* summary / urgent popup */}
            {showSummary && (
                <div style={tqOverlay} onClick={() => setShowSummary(false)}>
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "#fff",
                            borderTop: `4px solid ${hasUrgent ? TQ_RED : "#F59E0B"}`,
                            borderRadius: 16,
                            padding: "20px 22px",
                            boxShadow: "0 24px 60px rgba(0,0,0,.28)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 14,
                        }}
                    >
                        {hasUrgent && (
                            <div
                                style={{
                                    background: "#FFF1F2",
                                    border: "1px solid #FECDD3",
                                    borderRadius: 12,
                                    padding: "10px 12px",
                                }}
                            >
                                <div
                                    style={{
                                        color: TQ_RED,
                                        fontWeight: 800,
                                        fontSize: 13,
                                        letterSpacing: ".04em",
                                    }}
                                >
                                    ⚠ URGENT
                                </div>
                                <div
                                    style={{
                                        fontSize: 13,
                                        color: "#17181C",
                                        marginTop: 2,
                                        fontWeight: 600,
                                    }}
                                >
                                    {data.urgentCount}{" "}
                                    {data.urgentCount === 1 ? "query is" : "queries are"} open for
                                    more than {data.urgentHours} hours.
                                </div>
                                <div style={{ fontSize: 12, color: "#5B6479", marginTop: 4 }}>
                                    {urgentList
                                        .slice(0, 3)
                                        .map(
                                            (q) =>
                                                `${q.caseNumber} (${q.employeeName}, ${tqAgeLabel(q.ageHours)})`
                                        )
                                        .join(" · ")}
                                    {urgentList.length > 3
                                        ? ` · +${urgentList.length - 3} more`
                                        : ""}
                                </div>
                            </div>
                        )}
                        <div>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 15,
                                    color: "#17181C",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                }}
                            >
                                <span style={{ color: TQ_RED, display: "flex" }}>
                                    <QueryIcon />
                                </span>
                                {subject} {data.totalOpen} open{" "}
                                {data.totalOpen === 1 ? "query" : "queries"}
                            </div>
                            <div style={{ fontSize: 13, color: "#5B6479", marginTop: 2 }}>
                                {isSelf
                                    ? "Your queries are waiting to be resolved. Please look at them."
                                    : "Open View Details to see who has how many and how long they have been waiting."}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                                type="button"
                                style={tqBtn}
                                onClick={() => setShowSummary(false)}
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                style={tqBtnRed}
                                onClick={() => {
                                    setShowSummary(false);
                                    openDetails();
                                }}
                            >
                                {isSelf ? "View Queries" : "View Details"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* details */}
            {showDetails && (
                <div style={tqOverlay} onClick={() => setShowDetails(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 760,
                            maxHeight: "86vh",
                            background: "#fff",
                            borderRadius: 16,
                            boxShadow: "0 24px 60px rgba(0,0,0,.28)",
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "16px 20px",
                                borderBottom: "1px solid #EEF0F6",
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 16, color: "#17181C" }}>
                                    {popupTitle}
                                </div>
                                <div style={{ fontSize: 12.5, color: "#5B6479" }}>
                                    {data.totalOpen} open
                                    {hasUrgent
                                        ? ` · ${data.urgentCount} urgent (over ${data.urgentHours}h)`
                                        : ""}
                                </div>
                            </div>
                            <button
                                type="button"
                                style={tqBtn}
                                onClick={() => setShowDetails(false)}
                            >
                                ✕ Close
                            </button>
                        </div>

                        <div style={{ overflowY: "auto", padding: "12px 20px 20px" }}>
                            {data.members.map((m) => {
                                const isOpen = openEmp === m.employeeId;
                                const mine = data.queries.filter(
                                    (q) => q.employeeId === m.employeeId
                                );
                                return (
                                    <div
                                        key={m.employeeId}
                                        style={{
                                            border: `1px solid ${m.urgentCount > 0 ? "#FECDD3" : "#EEF0F6"}`,
                                            borderRadius: 12,
                                            marginTop: 10,
                                            overflow: "hidden",
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setOpenEmp(isOpen ? null : m.employeeId)}
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 12,
                                                padding: "12px 14px",
                                                border: "none",
                                                background:
                                                    m.urgentCount > 0 ? "#FFF7F8" : "#FAFBFF",
                                                cursor: "pointer",
                                                textAlign: "left",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    flex: 1,
                                                    fontWeight: 700,
                                                    fontSize: 14,
                                                    color: "#17181C",
                                                }}
                                            >
                                                {m.name}
                                            </span>
                                            <span style={{ fontSize: 12.5, color: "#5B6479" }}>
                                                {m.openCount} open · oldest{" "}
                                                {tqAgeLabel(m.oldestAgeHours)}
                                            </span>
                                            {m.urgentCount > 0 && (
                                                <span
                                                    style={{
                                                        background: TQ_RED,
                                                        color: "#fff",
                                                        borderRadius: 999,
                                                        padding: "2px 9px",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    {m.urgentCount} urgent
                                                </span>
                                            )}
                                            <span style={{ color: "#8A92A6", fontSize: 12 }}>
                                                {isOpen ? "▴" : "▾"}
                                            </span>
                                        </button>

                                        {isOpen && (
                                            <div style={{ padding: "4px 14px 12px" }}>
                                                {onOpenProfile && (
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "flex-end",
                                                            padding: "8px 0",
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            style={tqBtnRed}
                                                            onClick={() => {
                                                                setShowDetails(false);
                                                                setShowSummary(false);
                                                                setOpenEmp(null);
                                                                onOpenProfile(m.employeeId);
                                                            }}
                                                        >
                                                            Go to {m.name}'s profile →
                                                        </button>
                                                    </div>
                                                )}
                                                {mine.map((q) => (
                                                    <div
                                                        key={q.id}
                                                        // NEW: clicking a query row also opens that profile
                                                        onClick={
                                                            onOpenProfile
                                                                ? () => {
                                                                      setShowDetails(false);
                                                                      setShowSummary(false);
                                                                      setOpenEmp(null);
                                                                      onOpenProfile(q.employeeId);
                                                                  }
                                                                : undefined
                                                        }
                                                        title={
                                                            onOpenProfile
                                                                ? "Go to this profile"
                                                                : undefined
                                                        }
                                                        style={{
                                                            padding: "10px 0",
                                                            borderTop: "1px solid #EEF0F6",
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 3,
                                                            cursor: onOpenProfile
                                                                ? "pointer"
                                                                : "default",
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                gap: 8,
                                                                alignItems: "center",
                                                                flexWrap: "wrap",
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    fontWeight: 700,
                                                                    fontSize: 13,
                                                                }}
                                                            >
                                                                {q.caseNumber}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    fontSize: 12.5,
                                                                    color: "#5B6479",
                                                                }}
                                                            >
                                                                {[
                                                                    q.productName,
                                                                    q.clientName,
                                                                    q.subclientName,
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join(" · ") || "-"}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    marginLeft: "auto",
                                                                    fontSize: 12,
                                                                    fontWeight: 700,
                                                                    color: q.urgent
                                                                        ? TQ_RED
                                                                        : "#5B6479",
                                                                }}
                                                            >
                                                                {q.urgent ? "⚠ URGENT · " : ""}open{" "}
                                                                {tqAgeLabel(q.ageHours)}
                                                            </span>
                                                        </div>
                                                        {q.queryText && (
                                                            <div
                                                                style={{
                                                                    fontSize: 12.5,
                                                                    color: "#17181C",
                                                                }}
                                                            >
                                                                {q.queryText}
                                                            </div>
                                                        )}
                                                        <div
                                                            style={{
                                                                fontSize: 11.5,
                                                                color: "#8A92A6",
                                                            }}
                                                        >
                                                            Raised {tqFmtDateTime(q.submittedAt)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

/* ---------------------------------------------------------------------- */
/*  Blue Collar: work-submission history (replaces the case sections)      */
/* ---------------------------------------------------------------------- */
type BlueSubmission = { workDate: string; services: string[]; note: string };

function BlueWorkSummary({ employeeId }: { employeeId: string | null }) {
    const [data, setData] = useState<{
        role: string;
        locationName: string;
        submissions: BlueSubmission[];
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [tick, setTick] = useState(0);

    // reload after the Submit Work popup saves
    useEffect(() => {
        const h = () => setTick((t) => t + 1);
        window.addEventListener("blue-work-submitted", h);
        return () => window.removeEventListener("blue-work-submitted", h);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setErr("");
            try {
                const url = `${API_BASE}/api/blue/my-submissions${
                    employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ""
                }`;
                const res = await authFetch(url, { cache: "no-store" });
                const json = await safeJson(res);
                if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
                if (!cancelled) setData(json.data);
            } catch (e: any) {
                if (!cancelled) setErr(e?.message || "Could not load work history.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [employeeId, tick]);

    const today = todayStr();
    const todays = data?.submissions.find((s) => s.workDate === today) || null;
    const submissions = data?.submissions || [];
    const totalServices = submissions.reduce((n, s) => n + s.services.length, 0);

    const MONTHS = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const parts = (ymd: string) => {
        const [y, m, d] = ymd.split("-").map(Number);
        return {
            day: d,
            month: MONTHS[(m || 1) - 1],
            weekday: DAYS[new Date(Date.UTC(y, (m || 1) - 1, d)).getUTCDay()],
        };
    };

    const pill = (bg: string, fg: string): CSSProperties => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 24,
        boxSizing: "border-box",
        padding: "0 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
    });

    return (
        <div
            style={{
                background: "#fff",
                borderRadius: 16,
                padding: "16px 18px",
                boxShadow: "0 10px 30px rgba(0,0,0,.06)",
                textAlign: "left",
            }}
        >
            {/* header: title on the left, who/where/today on the right */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span
                    aria-hidden="true"
                    style={{
                        flex: "0 0 36px",
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "linear-gradient(135deg,#3B82F6,#6366F1)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        boxShadow: "0 6px 14px rgba(99,102,241,0.3)",
                    }}
                >
                    <i className="ti ti-clipboard-check" />
                </span>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#17181C" }}>
                        Work Submissions
                    </div>
                    <div style={{ fontSize: 12, color: "#767F92", marginTop: 2 }}>
                        Services ticked as done in the last 30 days.
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {data?.role && (
                        <span style={pill("#EAF0FB", "#1E40AF")}>
                            <i className="ti ti-id-badge-2" aria-hidden="true" />
                            {data.role}
                        </span>
                    )}
                    {data?.locationName && (
                        <span style={pill("#EDE9FE", "#5B21B6")}>
                            <i className="ti ti-map-pin" aria-hidden="true" />
                            {data.locationName}
                        </span>
                    )}
                    {data && (
                        <span
                            style={pill(
                                todays ? "#DCFCE7" : "#FEF3C7",
                                todays ? "#166534" : "#92400E"
                            )}
                        >
                            <i
                                className={`ti ${todays ? "ti-circle-check-filled" : "ti-clock"}`}
                                aria-hidden="true"
                            />
                            {todays ? "Submitted today" : "Not submitted today"}
                        </span>
                    )}
                </div>
            </div>

            {/* quick numbers */}
            {data && submissions.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 4px" }}>
                    {[
                        {
                            v: submissions.length,
                            l: submissions.length === 1 ? "day submitted" : "days submitted",
                            bg: "#EEF2FF",
                            fg: "#3730A3",
                        },
                        {
                            v: totalServices,
                            l: totalServices === 1 ? "service done" : "services done",
                            bg: "#ECFDF5",
                            fg: "#047857",
                        },
                    ].map((t) => (
                        <div
                            key={t.l}
                            style={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: 8,
                                padding: "6px 12px",
                                borderRadius: 12,
                                background: t.bg,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 18,
                                    fontWeight: 800,
                                    color: t.fg,
                                    lineHeight: 1,
                                }}
                            >
                                {t.v}
                            </span>
                            <span style={{ fontSize: 11.5, color: "#4B5563", fontWeight: 600 }}>
                                {t.l}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {loading && (
                <div style={{ color: "#9099AC", fontSize: 12, marginTop: 16 }}>Loading…</div>
            )}
            {err && (
                <div
                    style={{
                        marginTop: 16,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        color: "#B91C1C",
                        fontSize: 13,
                    }}
                >
                    {err}
                </div>
            )}

            {!loading && !err && data && submissions.length === 0 && (
                <div
                    style={{
                        marginTop: 16,
                        padding: "22px 16px",
                        borderRadius: 14,
                        border: "1.5px dashed #D6DCF5",
                        background: "#FAFBFF",
                        textAlign: "center",
                    }}
                >
                    <i
                        className="ti ti-clipboard-list"
                        aria-hidden="true"
                        style={{
                            fontSize: 26,
                            color: "#A5B4FC",
                            display: "block",
                            marginBottom: 6,
                        }}
                    />
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#3D4459" }}>
                        No submissions yet
                    </div>
                    <div style={{ fontSize: 11.5, color: "#767F92", marginTop: 3 }}>
                        Services ticked as done on Submit Work will show up here, day by day.
                    </div>
                </div>
            )}

            {/* day-by-day history */}
            {submissions.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    {submissions.map((s, i) => {
                        const d = parts(s.workDate);
                        const isToday = s.workDate === today;
                        return (
                            <div
                                key={s.workDate}
                                style={{
                                    display: "flex",
                                    gap: 12,
                                    padding: "10px 0",
                                    borderTop: i === 0 ? "none" : "1px solid #F1F2F6",
                                    alignItems: "flex-start",
                                }}
                            >
                                <div
                                    style={{
                                        flex: "0 0 44px",
                                        width: 44,
                                        padding: "5px 0",
                                        borderRadius: 10,
                                        textAlign: "center",
                                        background: isToday ? "#DCFCE7" : "#EEF2FF",
                                        color: isToday ? "#166534" : "#3730A3",
                                    }}
                                >
                                    <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>
                                        {d.day}
                                    </div>
                                    <div style={{ fontSize: 10, fontWeight: 700 }}>{d.month}</div>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: 11.5,
                                            color: "#767F92",
                                            marginBottom: 6,
                                        }}
                                    >
                                        <span style={{ fontWeight: 700, color: "#3D4459" }}>
                                            {isToday ? "Today" : d.weekday}
                                        </span>{" "}
                                        · {s.services.length}{" "}
                                        {s.services.length === 1 ? "service" : "services"}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {s.services.map((n) => (
                                            <span key={n} style={pill("#F3F4F8", "#374151")}>
                                                <i
                                                    className="ti ti-check"
                                                    aria-hidden="true"
                                                    style={{ color: "#16A34A" }}
                                                />
                                                {n}
                                            </span>
                                        ))}
                                    </div>
                                    {s.note && (
                                        <div
                                            style={{
                                                marginTop: 8,
                                                padding: "6px 10px",
                                                borderLeft: "3px solid #C7D2FE",
                                                background: "#FAFBFF",
                                                borderRadius: "0 8px 8px 0",
                                                fontSize: 11.5,
                                                color: "#5B6479",
                                            }}
                                        >
                                            {s.note}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function EmptyState({ text, styles }: { text: string; styles: Record<string, CSSProperties> }) {
    return <div style={styles.emptyState}>{text}</div>;
}

function QueryTile({
    label,
    value,
    tint,
    active,
    onClick,
    styles,
}: {
    label: string;
    value: number;
    tint: string;
    active: boolean;
    onClick?: () => void;
    styles: Record<string, CSSProperties>;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                ...styles.queryTile,
                borderColor: active ? tint : "#ececf5",
                background: active ? `${tint}14` : "#fff",
                cursor: onClick ? "pointer" : "default",
            }}
        >
            <span style={{ ...styles.queryTileValue, color: tint }}>{value}</span>
            <span style={styles.queryTileLabel}>{label}</span>
        </button>
    );
}

// Client / Subclient cell for a case row.
//  - readOnly              -> plain text only (viewing another employee)
//  - Client already set    -> plain text, NO dropdown (nobody edits it here)
//  - Client blank          -> dropdown to add one
//  - Subclient already set -> plain text
//  - Subclient blank       -> dropdown ONLY if a client is set AND that client
//                             has subclients; otherwise just "-"
function ClientCell({
    c,
    clients,
    subclients,
    saving,
    onChange,
    styles,
    readOnly,
    part,
}: {
    c: CaseRow;
    clients: ClientOption[];
    subclients: SubclientOption[];
    saving: boolean;
    onChange: (kind: "client" | "subclient", value: string) => void;
    styles: Record<string, CSSProperties>;
    readOnly?: boolean;
    part?: "client" | "subclient"; // show only one of the two
}) {
    const clientSet = !!c.clientId;
    const subclientSet = !!c.subclientId;
    // Client / subclient can NOT be added from this table. They are chosen only
    // at submit time (Add Case Numbers popup); after that editing is off.
    // So the cell is always plain text ("-" when empty). Flip to false to
    // bring the inline dropdowns back.
    const LOCKED = true;

    const selectStyle: CSSProperties = {
        ...styles.textInput,
        width: "100%",
        padding: "6px 8px",
        fontSize: fontSize.xs,
        opacity: saving ? 0.6 : 1,
    };
    const subOptions = subclients.filter((s) => s.clientId === (c.clientId || ""));

    // Client: set -> name. Not set + readOnly -> "-". Not set -> dropdown to add.
    const clientNode =
        LOCKED || readOnly || clientSet ? (
            <span>{c.clientName || "-"}</span>
        ) : (
            <select
                style={selectStyle}
                value=""
                disabled={saving}
                onChange={(e) => onChange("client", e.target.value)}
            >
                <option value="">+ Add client</option>
                {clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                        {cl.name}
                    </option>
                ))}
            </select>
        );

    // Subclient: set -> name. Not set -> dropdown ONLY when a client exists and
    // it has subclients to pick from. Otherwise a plain "-" (no empty dropdown).
    const canPickSubclient = !LOCKED && !readOnly && clientSet && subOptions.length > 0;
    const subclientNode = subclientSet ? (
        <span style={part === "subclient" ? undefined : styles.smallMuted}>
            {c.subclientName || "-"}
        </span>
    ) : canPickSubclient ? (
        <select
            style={selectStyle}
            value=""
            disabled={saving}
            onChange={(e) => onChange("subclient", e.target.value)}
        >
            <option value="">+ Add subclient</option>
            {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                    {s.name}
                </option>
            ))}
        </select>
    ) : (
        <span style={part === "subclient" ? undefined : styles.smallMuted}>-</span>
    );

    if (part === "client") return clientNode;
    if (part === "subclient") return subclientNode;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {clientNode}
            {subclientNode}
        </div>
    );
}

function MobileRow({
    index,
    c,
    ampMins,
    showAllocatedAt,
    onSubmit,
    onResolveQuery,
    clientCell,
    styles,
    readOnly,
}: {
    index: number;
    c: CaseRow;
    ampMins: number;
    showAllocatedAt?: boolean;
    onSubmit: () => void;
    onResolveQuery: () => void;
    clientCell: ReactNode;
    styles: Record<string, CSSProperties>;
    readOnly?: boolean;
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
                {submitted && <span>{outcomeLabel(c.submissionType)}</span>}
            </div>
            {/* NEW: allocation date + time, AMP time and age */}
            {(c.allocatedAt || ampMins > 0) && (
                <div style={styles.mobileMetaRow}>
                    {c.allocatedAt && (
                        <span>
                            Allocated{" "}
                            {showAllocatedAt
                                ? formatDateTime(c.allocatedAt)
                                : formatDisplayDate(allocDay(c.allocatedAt, c.workDate))}
                        </span>
                    )}
                    {showAllocatedAt && ampMins > 0 && <span>Time: {formatMinutes(ampMins)}</span>}
                    {showAllocatedAt && c.allocatedAt && <span>{allocAgeLabel(c)}</span>}
                </div>
            )}
            <div style={{ margin: "6px 0" }}>{clientCell}</div>
            {c.missed ? (
                <div style={styles.smallMuted}>
                    Assigned to you but left pending — returned to pool
                </div>
            ) : readOnly ? null : isOpenQuery(c) ? (
                <button type="button" style={styles.rowSubmitBtn} onClick={onResolveQuery}>
                    Resolve
                </button>
            ) : submitted ? (
                <div style={styles.smallMuted}>
                    {isResolvedQuery(c) ? "Query resolved" : "Submitted"}
                </div>
            ) : (
                <button type="button" style={styles.rowSubmitBtn} onClick={onSubmit}>
                    Submit
                </button>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------------- */
/*  Styles — a function of the active theme color (BRAND/GRADIENT)         */
/* ---------------------------------------------------------------------- */

const CARD_SHADOW = "0 10px 30px rgba(0,0,0,.06)";
const CNT_COLS = "1.4fr 1.2fr 110px 120px 120px 80px 160px";

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

        /* NEW: employee search (Super Admin / Ops Manager) */
        empSearchCard: {
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
        },
        empPillWrap: { position: "relative", width: "100%", maxWidth: 320 },
        empPill: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            boxSizing: "border-box",
            padding: "0 8px 0 14px",
            background: "#fff",
            border: "1px solid #E3E8F2",
            borderRadius: 999,
            boxShadow: "0 2px 8px rgba(23,44,84,.06)",
        },
        empPillInput: {
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 13,
            color: "#17181C",
            fontFamily: "inherit",
        },
        empKbd: {
            flexShrink: 0,
            fontSize: 11,
            fontWeight: fontWeight.medium,
            color: "#3D4459",
            background: "#EEF1F6",
            borderRadius: 6,
            padding: "3px 8px",
            whiteSpace: "nowrap",
        },
        empDropdown: {
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 8,
            background: "#fff",
            border: "1px solid #E3E8F2",
            borderRadius: 18,
            boxShadow: "0 18px 44px rgba(23,44,84,.18)",
            zIndex: 50,
            maxHeight: 420,
            overflowY: "auto",
            textAlign: "left",
            padding: 6,
            animation: "pf-emp-pop .16s ease-out",
        },
        empDropHeader: {
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.semibold,
            color: "#9099AC",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "8px 12px 6px",
        },
        empDropItem: {
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            cursor: "pointer",
            borderRadius: 12,
        },
        empAvatar: {
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: "50%",
            background: GRADIENT,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            boxShadow: `0 4px 10px ${withAlpha(BRAND.blue, 0.25)}`,
        },
        empItemBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 },
        empItemName: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        empItemMeta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
        empItemSub: { fontSize: fontSize.xs, color: "#5B6479", fontWeight: fontWeight.medium },
        empChip: {
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.1),
            borderRadius: 999,
            padding: "2px 9px",
            whiteSpace: "nowrap",
        },
        empItemEmail: {
            fontSize: fontSize.xs,
            color: "#9099AC",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        empGo: {
            color: BRAND.blue,
            fontSize: fontSize.lg,
            fontWeight: fontWeight.bold,
            flexShrink: 0,
        },
        empDropFooter: {
            fontSize: fontSize.xxs,
            color: "#9099AC",
            textAlign: "center",
            padding: "8px 0 4px",
            borderTop: "1px solid #f1f1f5",
            marginTop: 4,
        },

        /* Identity card */
        identityCard: {
            background: "linear-gradient(135deg, #F4F7FE 0%, #FFFFFF 62%)",
            borderRadius: radius.xl,
            padding: "16px 22px",
            border: "1px solid #EEF0F8",
            boxShadow: CARD_SHADOW,
            position: "relative",
            overflow: "hidden",
        },
        identityTop: {
            display: "flex",
            alignItems: "center",
            gap: 20,
        },
        identityTopMobile: { display: "flex", flexDirection: "column", gap: 16 },
        identityDivider: {
            width: 1,
            alignSelf: "stretch",
            background: "#E6E9F3",
            flexShrink: 0,
            marginLeft: 48,
            marginRight: 20,
        },
        avatarBlock: { display: "flex", alignItems: "center", gap: 16, flexShrink: 0 },
        avatarWrap: { position: "relative", flexShrink: 0, width: 88, height: 88 },
        avatarBlob: {
            position: "absolute",
            left: -18,
            bottom: -14,
            width: 106,
            height: 90,
            borderRadius: "50%",
            background:
                "radial-gradient(circle at 40% 40%, rgba(167,139,250,0.32), rgba(147,197,253,0.2) 65%, transparent 80%)",
            zIndex: 0,
        },
        avatarSpark: {
            position: "absolute",
            left: -18,
            top: -14,
            zIndex: 0,
            transform: "scale(0.7)",
            transformOrigin: "top left",
        },
        avatar: {
            position: "relative",
            zIndex: 1,
            width: 88,
            height: 88,
            borderRadius: radius.circle,
            background: GRADIENT,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize["6xl"],
            fontWeight: fontWeight.semibold,
            border: "4px solid #fff",
            boxSizing: "border-box",
            boxShadow: "0 8px 20px rgba(80,90,200,0.22)",
        },
        avatarImg: {
            position: "relative",
            zIndex: 1,
            width: 88,
            height: 88,
            borderRadius: radius.circle,
            objectFit: "cover",
            border: "4px solid #fff",
            boxSizing: "border-box",
            boxShadow: "0 8px 20px rgba(80,90,200,0.22)",
        },
        avatarEditBtn: {
            position: "absolute",
            zIndex: 2,
            right: -4,
            bottom: 0,
            width: 30,
            height: 30,
            borderRadius: radius.circle,
            background: "#3F3D9E",
            color: "#fff",
            border: "2px solid #fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            boxShadow: "0 6px 14px rgba(63,61,158,0.35)",
        },
        nameBlock: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 },
        name: { fontSize: 18, fontWeight: fontWeight.medium, color: "#1B1F4B", lineHeight: 1.2 },
        activePill: {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: fontWeight.medium,
            color: "#10936B",
            background: "#DDF7EE",
            padding: "4px 12px 4px 10px",
            borderRadius: radius.pill,
        },
        activeDot: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#19C48F",
            display: "inline-block",
        },
        editProfileBtn: {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${withAlpha(BRAND.blue, 0.22)}`,
            background: "#fff",
            color: BRAND.blue,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            padding: "8px 16px",
            borderRadius: radius["2xl"],
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 3px 10px rgba(70,80,190,0.08)",
        },
        cancelEditBtn: {
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#767F92",
            fontWeight: fontWeight.medium,
            fontSize: fontSize.sm,
            padding: "8px 14px",
            borderRadius: radius["2xl"],
            cursor: "pointer",
        },

        identityGrid: {
            display: "grid",
            gridTemplateColumns: "auto auto minmax(220px, 1fr)",
            columnGap: 40,
            alignItems: "center",
            flex: 1,
            minWidth: 0,
        },
        identityGridMobile: {
            display: "flex",
            flexDirection: "column",
            gap: 18,
            order: 3,
            borderTop: "1px solid #EEF0F6",
            paddingTop: 18,
        },
        identityColumn: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            justifyContent: "center",
        },
        infoIconRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
        infoChip: {
            width: 34,
            height: 34,
            borderRadius: "50%",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        infoStack: { display: "flex", flexDirection: "column", gap: 0, minWidth: 0 },
        infoLabelTop: { fontSize: 11, color: "#8C94A8", textAlign: "left", lineHeight: 1.3 },
        infoValue: {
            fontSize: 13,
            color: "#1B1F4B",
            fontWeight: fontWeight.medium,
            lineHeight: 1.35,
            textAlign: "left",
            whiteSpace: "nowrap",
        },
        aboutBox: {
            position: "relative",
            overflow: "hidden",
            background: "linear-gradient(135deg, #EEF3FD 0%, #E2EAFB 100%)",
            border: "1px solid #E0E8F9",
            borderRadius: 16,
            padding: "12px 16px 14px",
            textAlign: "left",
            minHeight: 0,
            boxSizing: "border-box",
        },
        aboutSpark: {
            position: "absolute",
            top: 8,
            right: 12,
            transform: "scale(0.7)",
            transformOrigin: "top right",
        },
        aboutWave: {
            position: "absolute",
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            transform: "scale(0.65)",
            transformOrigin: "bottom right",
        },
        aboutHeader: { position: "relative", display: "flex", alignItems: "center", gap: 8 },
        aboutIcon: {
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "#DCE5FA",
            color: "#4A5BD4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        aboutTitle: {
            fontSize: 14,
            fontWeight: fontWeight.medium,
            color: "#1B1F4B",
            textAlign: "left",
        },
        aboutRule: {
            position: "relative",
            width: 30,
            height: 2,
            borderRadius: 2,
            background: "#B9CBF2",
            margin: "8px 0 8px 2px",
        },
        aboutText: {
            position: "relative",
            margin: 0,
            fontSize: 12.5,
            color: "#5B6475",
            lineHeight: 1.5,
            textAlign: "left",
        },
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

        /* Stats — 4 cards now (Total / Submitted / Pending / Allocated Time) */
        statsGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 10,
        },
        statsGridMobile: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
        // COMPACT stat cards (was padding 16 / icon 40 / value 3xl)
        statCard: {
            background: "#fff",
            borderRadius: radius.md,
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: CARD_SHADOW,
        },
        statIconWrap: {
            width: 28,
            height: 28,
            borderRadius: radius.sm,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, lineHeight: 1.1 },
        statLabel: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            marginTop: 1,
        },
        statSub: { fontSize: fontSize.xxs, color: "#9099AC", marginTop: 0, lineHeight: 1.2 },

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
            zIndex: 70,
        },
        smallLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#3D4459" },
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
        table: { width: "100%", borderCollapse: "collapse", minWidth: 900, tableLayout: "fixed" },
        th: {
            textAlign: "left",
            fontSize: fontSize.xs,
            color: "#9099AC",
            fontWeight: fontWeight.semibold,
            padding: "14px 16px",
            borderBottom: "1px solid #f1f1f1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "uppercase",
            letterSpacing: 0.4,
        },
        tr: {},
        td: {
            verticalAlign: "middle",
            textAlign: "left",
            fontSize: fontSize.base,
            color: "#3D4459",
            padding: "14px 16px",
            borderBottom: "1px solid #f6f6f9",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        statusDone: {
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.green,
            background: withAlpha(BRAND.green, 0.12),
            padding: "3px 10px",
            borderRadius: radius.pill,
        },
        statusPending: {
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.amber,
            background: withAlpha(BRAND.amber, 0.12),
            padding: "3px 10px",
            borderRadius: radius.pill,
        },
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

        // ---- Avatar lightbox ----
        lightboxOverlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(10,15,25,0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
            padding: 24,
            cursor: "zoom-out",
        },
        lightboxImg: {
            maxWidth: "min(90vw, 480px)",
            maxHeight: "80vh",
            width: "auto",
            height: "auto",
            borderRadius: radius.lg,
            boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
            cursor: "default",
            objectFit: "contain",
        },
        lightboxCloseBtn: {
            position: "fixed",
            top: 20,
            right: 24,
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,0.15)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 301,
        },

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
        // ---- Self Allocate mode toggle, counts card, add-case-number popup ----
        selfAllocModeRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
        selfAllocModeBtn: {
            flex: 1,
            minWidth: 150,
            padding: "9px 12px",
            borderRadius: radius.md,
            border: `1px solid ${withAlpha(BRAND.blue, 0.25)}`,
            background: "#fff",
            color: "#3b4a63",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        selfAllocModeBtnActive: {
            flex: 1,
            minWidth: 150,
            padding: "9px 12px",
            borderRadius: radius.md,
            border: "1px solid transparent",
            background: GRADIENT,
            color: "#fff",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.28)}`,
        },
        selfAllocAllBtn: {
            background: "#fff",
            color: BRAND.blue,
            border: `1px solid ${withAlpha(BRAND.blue, 0.3)}`,
            borderRadius: radius.sm,
            padding: "6px 10px",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        detailHead: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            scrollMarginTop: 12,
        },
        detailTitle: {
            fontSize: fontSize.md,
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        caseSection: { display: "flex", flexDirection: "column", gap: 10 },
        caseGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
        },
        caseCard: {
            background: "#fff",
            borderRadius: radius.md,
            padding: 14,
            border: "1px solid #e5e9f0",
            borderLeft: `4px solid ${BRAND.blue}`,
            boxShadow: CARD_SHADOW,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            textAlign: "left",
        },
        caseCardTop: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
        },
        caseCardName: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
        },
        caseTotalBox: { textAlign: "right", flexShrink: 0 },
        caseTotalNum: {
            fontSize: fontSize["3xl"],
            fontWeight: fontWeight.bold,
            color: BRAND.blue,
            lineHeight: 1.1,
        },
        caseStatRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: fontSize.sm,
            color: "#5B6479",
            padding: "6px 0",
            borderBottom: "1px dashed #E6E9F3",
        },
        caseSectionHead: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
        },
        caseBarTrack: {
            height: 6,
            borderRadius: 3,
            background: withAlpha(BRAND.green, 0.15),
            overflow: "hidden",
        },
        caseBarFill: {
            height: "100%",
            borderRadius: 3,
            background: BRAND.green,
            transition: "width .3s ease",
        },
        caseViewBtn: {
            marginTop: "auto",
            background: "#fff",
            color: BRAND.blue,
            border: `1px solid ${withAlpha(BRAND.blue, 0.3)}`,
            borderRadius: radius.sm,
            padding: "7px 10px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        cntCard: {
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: CARD_SHADOW,
            overflow: "hidden",
            textAlign: "left",
        },
        cntTop: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            padding: "18px 20px 14px",
        },
        cntHead: {
            display: "grid",
            gridTemplateColumns: CNT_COLS,
            gap: 12,
            alignItems: "center",
            padding: "12px 20px",
            background: "#F4F6FB",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#5B6479",
            textTransform: "uppercase",
            letterSpacing: 0.5,
        },
        cntRow: {
            display: "grid",
            gridTemplateColumns: CNT_COLS,
            gap: 12,
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid #f1f1f5",
        },
        cntCell: { display: "flex", flexDirection: "column", gap: 4 },
        cntGroups: { minWidth: 900, display: "flex", flexDirection: "column", gap: 16 },
        cntGroup: {
            border: "1px solid #E6E9F3",
            borderRadius: radius.md,
            background: "#fff",
            overflow: "hidden",
        },
        cntGroupHead: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            background: "#F7F9FE",
            borderBottom: "1px solid #E6E9F3",
        },
        cntDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
        cntGroupName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: "#17181C" },
        cntCountPill: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.1),
            borderRadius: radius.pill,
            padding: "2px 10px",
        },
        cntGroupTotal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: "#1B1F4B" },
        cntClient: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: "#1B1F4B" },
        cntDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: "#3D4459" },
        cntPendingNum: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: "#1B1F4B" },
        cntCarry: {
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.red,
            background: withAlpha(BRAND.red, 0.08),
            border: `1px solid ${withAlpha(BRAND.red, 0.25)}`,
            borderRadius: radius.pill,
            padding: "3px 10px",
            whiteSpace: "nowrap",
        },
        cntCases: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: BRAND.blue },
        cntSub: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: "#3D4459" },
        cntText: { fontSize: fontSize.base, color: "#17181C" },
        cntRight: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
        },
        allocViewRow: { display: "flex", gap: 8, flexWrap: "wrap" },
        allocViewBtn: {
            padding: "6px 16px",
            borderRadius: radius.pill,
            border: `1px solid ${withAlpha(BRAND.blue, 0.25)}`,
            background: "#fff",
            color: "#3b4a63",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            whiteSpace: "nowrap",
        },
        allocViewBtnActive: {
            padding: "6px 16px",
            borderRadius: radius.pill,
            border: "1px solid transparent",
            background: GRADIENT,
            color: "#fff",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: `0 4px 12px ${withAlpha(BRAND.blue, 0.25)}`,
        },
        allocSummaryRow: { display: "flex", gap: 8, flexWrap: "wrap" },
        allocSummaryChip: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.08),
            borderRadius: radius.pill,
            padding: "4px 12px",
            whiteSpace: "nowrap",
        },
        countsCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 16,
            boxShadow: CARD_SHADOW,
            borderLeft: `4px solid ${BRAND.amber}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            textAlign: "left",
        },
        countsCardHeader: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
        },
        countsCardTitle: {
            fontSize: fontSize.md,
            fontWeight: fontWeight.bold,
            color: "#17181C",
            marginBottom: 2,
        },
        countsBadge: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.amber,
            background: withAlpha(BRAND.amber, 0.12),
            borderRadius: radius.pill,
            padding: "4px 12px",
            whiteSpace: "nowrap",
        },
        countsRow: {
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            padding: "10px 12px",
            border: "1px solid #f1f1f5",
            borderRadius: radius.md,
            background: "#FAFBFF",
        },
        countsRowMain: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            textAlign: "left",
            gap: 2,
            flex: 1,
            minWidth: 180,
            fontSize: fontSize.base,
        },
        countsRowNums: { fontSize: fontSize.base, color: "#17181C" },
        addCnFixedValue: {
            padding: "10px 12px",
            background: "#f5f5fa",
            border: "1px solid #ececf5",
            borderRadius: radius.sm,
            fontSize: fontSize.base,
            color: "#17181C",
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

        // ---- All Query modal ----
        queryTilesRow: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 },
        queryTile: {
            flex: 1,
            minWidth: 130,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            padding: "12px 16px",
            borderRadius: radius.md,
            border: "1px solid #ececf5",
            textAlign: "left",
            fontFamily: "inherit",
        },
        queryTileValue: { fontSize: fontSize["6xl"], fontWeight: fontWeight.bold, lineHeight: 1.1 },
        queryTileLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#767F92",
        },
        queryResolveCell: { display: "flex", alignItems: "center", gap: 8 },
    };
}
