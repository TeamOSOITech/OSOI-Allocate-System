import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { authFetch } from "../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";
import { useRoleLabels } from "../context/roleLabelsContext";

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
@keyframes pf-emp-pop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
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
type SubmissionType = "COMPLETED" | "DONE_BY_TEAM" | "DONE_BY_CLIENT" | "QUERY";
// What an open Query can be turned into once it's sorted out.
type QueryResolution = Exclude<SubmissionType, "QUERY">;

// Dropdown order + labels, shared by the Submit panel and the Bulk modal.
const SUBMISSION_OPTIONS: { value: SubmissionType; label: string }[] = [
    { value: "COMPLETED", label: "Completed" },
    { value: "QUERY", label: "Query" },
    { value: "DONE_BY_TEAM", label: "Completed by Team" },
    { value: "DONE_BY_CLIENT", label: "Completed by Client" },
];
// Same list minus "Query" — what an open query can be completed as.
const RESOLUTION_OPTIONS = SUBMISSION_OPTIONS.filter((o) => o.value !== "QUERY") as {
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
type ClientOption = { id: string; name: string };
type SubclientOption = { id: string; name: string; clientId: string };

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
    const { colors: themeColors } = useTheme();
    const { getRoleLabel } = useRoleLabels();
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
    // Which list is open under the tabs — "Cases" or "Counts".
    const [allocView, setAllocView] = useState<"cases" | "counts">("cases");
    const [dateFilter, setDateFilter] = useState("");
    const [productFilter, setProductFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "PENDING" | "SUBMITTED">("all");
    const [search, setSearch] = useState("");

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [submitType, setSubmitType] = useState<"" | SubmissionType>("");
    const [submitQueryText, setSubmitQueryText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
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
    // "Add Case Numbers" popup for one of those counts. Client / subclient
    // now live on EACH ROW (addCnRows), not as one popup-wide value.
    const [addCnCount, setAddCnCount] = useState<MyCountRow | null>(null);
    const [addCnRows, setAddCnRows] = useState<AddCnRow[]>([]);
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
            const res = await authFetch(`${API_BASE}/api/employees`, { cache: "no-store" });
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
        setShowQueryModal(false);
        setCases([]);
        setBatches([]);
        setMyCounts([]);
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
                setClients(list.map((c: any) => ({ id: String(c.id), name: c.name })));
            }
            if (sRes.ok) {
                const json = await safeJson(sRes);
                const list = Array.isArray(json) ? json : json?.data || [];
                setSubclients(
                    list.map((s: any) => ({
                        id: String(s.id),
                        name: s.name,
                        clientId: String(s.clientId),
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
            // Counts endpoint is always "me" — skip it when viewing someone else.
            if (!targetId) loadMyCounts();
            else setMyCounts([]);
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
        loadEmpList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // While the All Query popup is open, re-check every 15s.
    useEffect(() => {
        if (!showQueryModal) return;
        const timer = window.setInterval(() => {
            if (!resolvingId) refreshCases();
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

    const name =
        profile?.first_name || profile?.last_name
            ? `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim()
            : employee?.name ||
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

    const baseRows = activeTab === "today" ? todaysCases : pastCases;

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
        return myCounts
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
    }, [myCounts, activeTab, dateFilter, productFilter, search]);

    // only the counts that still need case numbers.
    const countsToAdd = useMemo(
        () => filteredCounts.reduce((s, m) => s + m.remaining, 0),
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

        return { total, submittedCount, pendingCount, allocatedMins };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todaysCases, myCounts, productAmp]);

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
        setSelectedId(c.id);
        setTimeout(
            () => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
            50
        );
    };

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
            const hay = `${c.caseNumber} ${c.productName || ""} ${statusLabel(c.id)}`.toLowerCase();
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
    const addCnParsed = useMemo(
        () => addCnRows.filter((r) => r.cn.trim()).map((r) => ({ ...r, cn: r.cn.trim() })),
        [addCnRows]
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
    };

    const closeAddCaseNumbers = () => {
        if (addCnSubmitting) return;
        setAddCnCount(null);
    };

    const submitAddCaseNumbers = async () => {
        if (!addCnCount) return;
        if (addCnParsed.length === 0) {
            setAddCnError("Type at least one case number.");
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
                setAddCnError(`Select a client for ${r.cn}.`);
                return;
            }
            if (r.status === "QUERY" && !r.query.trim()) {
                setAddCnError(`Enter the query text for ${r.cn}.`);
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
                                    queryText: r.status === "QUERY" ? r.query.trim() : undefined,
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
        if (value !== "QUERY") {
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
                (c) => bulkTypeById[c.id] === "QUERY" && !(bulkQueryById[c.id] || "").trim()
            ),
        [bulkRowsToSubmit, bulkTypeById, bulkQueryById]
    );

    const bulkCanSubmit = bulkRowsToSubmit.length > 0 && !bulkHasIncompleteQuery;

    const handleBulkSubmit = async () => {
        setBulkError(null);
        if (bulkRowsToSubmit.length === 0) return;

        for (const c of bulkRowsToSubmit) {
            const type = bulkTypeById[c.id];
            if (type === "QUERY" && !(bulkQueryById[c.id] || "").trim()) {
                setBulkError(`Enter the query text for ${c.caseNumber} before submitting.`);
                return;
            }
        }

        const items = bulkRowsToSubmit.map((c) => ({
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

    const exportCsv = () => {
        const header = [
            "#",
            "Case No.",
            "Service",
            "Date",
            "Allocated At",
            "Time (AMP)",
            "Status",
            "Outcome",
        ];
        const rows = filteredRows.map((c, i) => [
            i + 1,
            c.caseNumber,
            c.productName || "-",
            c.workDate,
            `"${formatDateTime(c.allocatedAt)}"`,
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
                                width="18"
                                height="18"
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

                    {!isViewingOther && (
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
                                {editingProfile
                                    ? savingProfile
                                        ? "Saving…"
                                        : "Save"
                                    : "Edit Profile"}
                            </button>
                        </div>
                    )}
                </div>

                <div style={isMobile ? styles.identityGridMobile : styles.identityGrid}>
                    <div style={styles.identityColumn}>
                        <InfoIconRow
                            icon={<ShieldIcon />}
                            label="Role"
                            value={role && role !== "-" ? getRoleLabel(role) : "-"}
                            styles={styles}
                        />
                        <div style={styles.contactRow}>
                            <span style={styles.contactIcon}>
                                <MailIcon />
                            </span>
                            {email && email !== "-" ? (
                                <a
                                    href={`mailto:${email}`}
                                    style={{ ...styles.contactValue, textDecoration: "none" }}
                                >
                                    {email}
                                </a>
                            ) : (
                                <span style={styles.contactValue}>{email}</span>
                            )}
                        </div>
                        {editingProfile && !isViewingOther ? (
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
                                {phone && phone !== "-" ? (
                                    <a
                                        href={`tel:${phone.replace(/\s+/g, "")}`}
                                        style={{ ...styles.contactValue, textDecoration: "none" }}
                                    >
                                        {phone}
                                    </a>
                                ) : (
                                    <span style={styles.contactValue}>{phone}</span>
                                )}
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
                        {editingProfile && !isViewingOther ? (
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
                {/* NEW: total time allocated today = cases x service AMP */}
                <StatCard
                    icon={<ClockIcon />}
                    tint={BRAND.lightBlue}
                    value={stats.allocatedMins > 0 ? formatMinutes(stats.allocatedMins) : "0m"}
                    label="Allocated Time"
                    sub="Cases × service AMP"
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
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                        type="button"
                        className="pf-btn pf-btn-outline"
                        style={styles.exportBtn}
                        onClick={openQueryModal}
                    >
                        <QueryIcon /> All Query
                        {openQueries.length > 0 ? ` (${openQueries.length})` : ""}
                    </button>
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

            {/* ---- Counts / Cases toggle (works for Today's AND Past) ---- */}
            {!isViewingOther && (
                <div style={styles.allocViewRow}>
                    <button
                        type="button"
                        className="pf-btn"
                        style={
                            allocView === "counts" ? styles.allocViewBtnActive : styles.allocViewBtn
                        }
                        onClick={() => setAllocView("counts")}
                    >
                        Counts ({filteredCounts.length})
                    </button>
                    <button
                        type="button"
                        className="pf-btn"
                        style={
                            allocView === "cases" ? styles.allocViewBtnActive : styles.allocViewBtn
                        }
                        onClick={() => setAllocView("cases")}
                    >
                        Cases ({filteredRows.length})
                    </button>
                </div>
            )}

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
                {allocView === "cases" && (
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
                )}
                <div style={{ ...styles.filterField, flex: 1 }}>
                    <label style={styles.smallLabel}>Search</label>
                    <input
                        style={styles.textInput}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={
                            allocView === "cases"
                                ? "Search by case number, service or profile…"
                                : "Search by service or client…"
                        }
                    />
                </div>
            </div>

            {/* ---- Counts view ---- */}
            {!isViewingOther && allocView === "counts" && (
                <div className="pf-card-hover" style={styles.countsCard}>
                    <div style={styles.countsCardHeader}>
                        <div>
                            <div style={styles.countsCardTitle}>Cases waiting for case numbers</div>
                            <div style={styles.smallMuted}>
                                These were allocated to you as a count. Add the real case number(s),
                                pick the client for each case and a status — each one becomes a
                                case, submitted right away or kept as WIP.
                            </div>
                        </div>
                        <span style={styles.countsBadge}>{countsToAdd} to add</span>
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
                        filteredCounts.map((mc) => {
                            const done = mc.remaining === 0;
                            const mcAmp = ampOf(mc.productId);
                            return (
                                <div key={mc.id} style={styles.countsRow}>
                                    <div style={styles.countsRowMain}>
                                        <strong>{mc.productName || "-"}</strong>
                                        <span style={styles.smallMuted}>
                                            {[mc.clientName, mc.subclientName]
                                                .filter(Boolean)
                                                .join(" / ") || "No client yet"}{" "}
                                            · {formatDisplayDate(mc.workDate)}
                                            {mc.allocatedAt && (
                                                <> · Allocated {formatDateTime(mc.allocatedAt)}</>
                                            )}
                                        </span>
                                    </div>
                                    <div style={styles.countsRowNums}>
                                        {done ? (
                                            <span style={styles.statusDone}>All added</span>
                                        ) : (
                                            <>
                                                <strong>{mc.remaining}</strong> to add
                                            </>
                                        )}
                                        <span style={styles.smallMuted}>
                                            {" "}
                                            ({mc.addedByMe}/{mc.allocatedToMe} added)
                                        </span>
                                        {mcAmp > 0 && (
                                            <span style={styles.smallMuted}>
                                                {" "}
                                                · {formatMinutes(mcAmp * mc.allocatedToMe)} total
                                            </span>
                                        )}
                                    </div>
                                    {!done && (
                                        <button
                                            type="button"
                                            className="pf-btn pf-btn-solid"
                                            style={styles.rowSubmitBtn}
                                            onClick={() => openAddCaseNumbers(mc)}
                                        >
                                            Submit Case Numbers
                                        </button>
                                    )}
                                </div>
                            );
                        })
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
                                        onSubmit={() => handlePickForSubmit(c)}
                                        onResolveQuery={openQueryModal}
                                        clientCell={
                                            <ClientCell
                                                c={c}
                                                clients={clients}
                                                subclients={subclients}
                                                saving={savingClientCaseId === c.id}
                                                onChange={(kind, v) =>
                                                    handleCaseClientChange(c, kind, v)
                                                }
                                                readOnly={isViewingOther}
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
                                    <col style={{ width: "4%" }} />
                                    <col style={{ width: "10%" }} />
                                    <col style={{ width: "11%" }} />
                                    <col style={{ width: "12%" }} />
                                    <col style={{ width: "12%" }} />
                                    <col style={{ width: "8%" }} />
                                    <col style={{ width: "15%" }} />
                                    <col style={{ width: "9%" }} />
                                    <col style={{ width: "9%" }} />
                                    <col style={{ width: "10%" }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>#</th>
                                        <th style={styles.th}>Case No.</th>
                                        <th style={styles.th}>Service</th>
                                        <th style={styles.th}>Client</th>
                                        <th style={styles.th}>Subclient</th>
                                        <th style={styles.th}>Date</th>
                                        <th style={styles.th}>Allocated At</th>
                                        <th style={{ ...styles.th, textAlign: "center" }}>
                                            Status
                                        </th>
                                        <th style={{ ...styles.th, textAlign: "center" }}>
                                            Outcome
                                        </th>
                                        <th style={{ ...styles.th, textAlign: "center" }}>
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
                                                    background: i % 2 === 1 ? "#FAFBFF" : "#fff",
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
                                                <td style={styles.td}>{c.productName || "-"}</td>
                                                {/* FIX: part="client" -> only the client shows here
                                                    (subclient has its own column) */}
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    <ClientCell
                                                        c={c}
                                                        part="client"
                                                        clients={clients}
                                                        subclients={subclients}
                                                        saving={savingClientCaseId === c.id}
                                                        onChange={(kind, v) =>
                                                            handleCaseClientChange(c, kind, v)
                                                        }
                                                        readOnly={isViewingOther}
                                                        styles={styles}
                                                    />
                                                </td>

                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    <ClientCell
                                                        c={c}
                                                        part="subclient"
                                                        clients={clients}
                                                        subclients={subclients}
                                                        saving={savingClientCaseId === c.id}
                                                        onChange={(kind, v) =>
                                                            handleCaseClientChange(c, kind, v)
                                                        }
                                                        readOnly={isViewingOther}
                                                        styles={styles}
                                                    />
                                                </td>
                                                <td style={styles.td}>
                                                    {formatDisplayDate(c.workDate)}
                                                </td>
                                                {/* NEW: allocation date + time, AMP time and age */}
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    <div>{formatDateTime(c.allocatedAt)}</div>
                                                    {(rowAmp > 0 || c.allocatedAt) && (
                                                        <div style={styles.smallMuted}>
                                                            {rowAmp > 0
                                                                ? `Time: ${formatMinutes(rowAmp)}`
                                                                : ""}
                                                            {rowAmp > 0 && c.allocatedAt
                                                                ? " · "
                                                                : ""}
                                                            {c.allocatedAt ? allocAgeLabel(c) : ""}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: "center" }}>
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
                                                <td style={{ ...styles.td, textAlign: "center" }}>
                                                    {submitted ? (
                                                        <>
                                                            <span
                                                                style={{
                                                                    fontWeight: fontWeight.medium,
                                                                }}
                                                            >
                                                                {outcomeLabel(c.submissionType)}
                                                            </span>
                                                            {isResolvedQuery(c) && (
                                                                <div style={styles.smallMuted}>
                                                                    Query resolved
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span style={styles.smallMuted}>—</span>
                                                    )}
                                                </td>
                                                <td style={{ ...styles.td, textAlign: "center" }}>
                                                    {isOpenQuery(c) ? (
                                                        <button
                                                            type="button"
                                                            style={styles.rowSubmitBtn}
                                                            onClick={openQueryModal}
                                                        >
                                                            Resolve
                                                        </button>
                                                    ) : submitted ? (
                                                        <span style={styles.smallMuted}>
                                                            {formatDisplayDate(
                                                                localDateStr(c.submittedAt)
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
                        {clientCellError && <p style={styles.rowError}>{clientCellError}</p>}
                    </div>

                    {/* ---- Submit Your Work ---- */}
                    <div ref={panelRef} className="pf-card-hover" style={styles.submitPanel}>
                        <div style={styles.submitPanelTitle}>
                            {isViewingOther ? `Submit Work for ${name}` : "Submit Your Work"}
                        </div>
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
                                            const v = e.target.value as "" | SubmissionType;
                                            setSubmitType(v);
                                            if (v !== "QUERY") setSubmitQueryText("");
                                        }}
                                    >
                                        <option value="">Select status</option>
                                        {SUBMISSION_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {submitType === "QUERY" && (
                                    <div
                                        style={{
                                            ...styles.filterField,
                                            flex: 1,
                                            minWidth: 220,
                                        }}
                                    >
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
                                    Pick a case from the table above, choose its status — Completed,
                                    Completed by Team, Completed by Client or Query — and submit.
                                    "Query" needs a short note on what the query is; you can track
                                    and complete your queries later from "All Query" up top. Use
                                    "Bulk Submit" to submit every pending case for today in one
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
                </>
            )}

            {/* ---- Bulk Submit modal ---- */}
            {showBulkModal && (
                <div style={styles.bulkOverlay}>
                    <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.bulkModalHeader}>
                            <div>
                                <h3 style={styles.bulkModalTitle}>
                                    Bulk Submit — Today's Pending Cases
                                </h3>
                                <p style={styles.bulkModalSubtitle}>
                                    Every case below starts as "WIP" — only change the ones you're
                                    ready to submit now; the rest stay pending for later. A "Query"
                                    row also needs its text filled in.
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
                            placeholder="Search by case number, service or status…"
                        />

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
                                        <th style={styles.th}>Status</th>
                                        <th style={styles.th}>Query</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bulkVisibleCases.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={4}
                                                style={{ ...styles.td, textAlign: "center" }}
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
                                                                    "PENDING" | SubmissionType
                                                            )
                                                        }
                                                    >
                                                        <option value="PENDING">WIP</option>
                                                        {SUBMISSION_OPTIONS.map((o) => (
                                                            <option key={o.value} value={o.value}>
                                                                {o.label}
                                                            </option>
                                                        ))}
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
                                    Every query raised, across all dates. Once a query is sorted
                                    out, mark it as completed from here. If the team completes one,
                                    it moves to Query Completed on its own (as "Completed by Team").
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
                                            {queryView === "OPEN" ? "Complete as" : "Completed as"}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleQueries.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={5}
                                                style={{ ...styles.td, textAlign: "center" }}
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
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
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
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    {queryView === "OPEN" ? (
                                                        <div style={styles.queryResolveCell}>
                                                            <select
                                                                style={{
                                                                    ...styles.textInput,
                                                                    flex: 1,
                                                                    minWidth: 0,
                                                                }}
                                                                value={chosen}
                                                                disabled={busy}
                                                                onChange={(e) =>
                                                                    setResolveTypeById((prev) => ({
                                                                        ...prev,
                                                                        [c.id]: e.target.value as
                                                                            QueryResolution | "",
                                                                    }))
                                                                }
                                                            >
                                                                <option value="">Select…</option>
                                                                {RESOLUTION_OPTIONS.map((o) => (
                                                                    <option
                                                                        key={o.value}
                                                                        value={o.value}
                                                                    >
                                                                        {o.label}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                style={{
                                                                    ...styles.rowSubmitBtn,
                                                                    opacity:
                                                                        !chosen || busy ? 0.5 : 1,
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
                                                                {busy ? "Saving…" : "Complete"}
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
                            <p style={{ ...styles.rowError, color: BRAND.blue }}>{queryNotice}</p>
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
                                    {selfAllocSuccessCount === 1 ? "" : "s"} allocated to yourself.{" "}
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
                                            Pick a service, then take cases that already have a case
                                            number, or take a count of cases whose numbers aren't
                                            known yet (you add the numbers later). Only services
                                            your team ({myTeamRaw || "no team set"}) is aligned to
                                            show up here.
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
                                        <p style={styles.rowError}>{selfAllocServicesError}</p>
                                    ) : !myTeamRaw ? (
                                        <p style={styles.smallMuted}>
                                            You don't have a team set on your profile, so no service
                                            can be matched to you. Ask your manager to set your
                                            team.
                                        </p>
                                    ) : selfAllocServices.length === 0 ? (
                                        <p style={styles.smallMuted}>
                                            No services are aligned to your team ({myTeamRaw}) yet.
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
                                            <p style={styles.rowError}>{availableCountsError}</p>
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
                                                        <th style={styles.th}>How many to take</th>
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
                                                                {[c.clientName, c.subclientName]
                                                                    .filter(Boolean)
                                                                    .join(" / ") || "-"}
                                                            </td>
                                                            <td style={styles.td}>
                                                                {formatDisplayDate(c.workDate)}
                                                            </td>
                                                            <td style={styles.td}>
                                                                {c.unallocated}
                                                            </td>
                                                            <td style={styles.td}>
                                                                <div
                                                                    style={{
                                                                        display: "flex",
                                                                        gap: 6,
                                                                        alignItems: "center",
                                                                    }}
                                                                >
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        max={c.unallocated}
                                                                        style={{
                                                                            ...styles.textInput,
                                                                            width: 80,
                                                                            padding: "6px 8px",
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
                                                                                    e.target.value
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
                                            <p style={styles.rowError}>{selfAllocCasesError}</p>
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
                                                                    selfAllocCases.length > 0 &&
                                                                    selfAllocSelectedIds.size ===
                                                                        selfAllocCases.length
                                                                }
                                                                onChange={toggleSelfAllocSelectAll}
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
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selfAllocSelectedIds.has(
                                                                        c.id
                                                                    )}
                                                                    onChange={() =>
                                                                        toggleSelfAllocCase(c.id)
                                                                    }
                                                                />
                                                            </td>
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
                                                                {[c.clientName, c.subclientName]
                                                                    .filter(Boolean)
                                                                    .join(" / ") || "-"}
                                                            </td>
                                                            <td style={styles.td}>{c.workDate}</td>
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
                                                selfAllocSubmitting || selfAllocPickedCount === 0
                                                    ? 0.6
                                                    : 1,
                                            cursor:
                                                selfAllocSubmitting || selfAllocPickedCount === 0
                                                    ? "not-allowed"
                                                    : "pointer",
                                        }}
                                        onClick={
                                            selfAllocMode === "counts"
                                                ? submitSelfAllocCounts
                                                : submitSelfAllocation
                                        }
                                        disabled={selfAllocSubmitting || selfAllocPickedCount === 0}
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
                <div style={styles.bulkOverlay} onClick={closeAddCaseNumbers}>
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
                                    {addCnCount.remaining === 1 ? "" : "s"} left to add. Type the
                                    case number, pick its client (every case can have a different
                                    one) and its status — WIP / Pending keeps it pending, any other
                                    status submits it right away.
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

                        <label style={styles.smallLabel}>Case numbers, client &amp; status</label>
                        <div style={{ ...styles.bulkTableWrap, marginTop: 4, marginBottom: 6 }}>
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
                                        <th style={styles.th}>Query</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {addCnRows.map((r, i) => {
                                        const queryMissing =
                                            r.status === "QUERY" && !r.query.trim();
                                        const rowSubOptions = subclients.filter(
                                            (s) => s.clientId === r.clientId
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
                                                        placeholder="Case number"
                                                        onChange={(e) =>
                                                            setAddCnRow(i, { cn: e.target.value })
                                                        }
                                                        onPaste={(e) => {
                                                            const t =
                                                                e.clipboardData.getData("text");
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
                                                        <option value="">Select client</option>
                                                        {clients.map((cl) => (
                                                            <option key={cl.id} value={cl.id}>
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
                                                        disabled={addCnSubmitting || !r.clientId}
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
                                                                query:
                                                                    e.target.value === "QUERY"
                                                                        ? r.query
                                                                        : "",
                                                            })
                                                        }
                                                    >
                                                        <option value="WIP">WIP</option>
                                                        <option value="PENDING">Pending</option>
                                                        {SUBMISSION_OPTIONS.map((o) => (
                                                            <option key={o.value} value={o.value}>
                                                                {o.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td style={{ ...styles.td, whiteSpace: "normal" }}>
                                                    {r.status === "QUERY" ? (
                                                        <input
                                                            style={{
                                                                ...styles.textInput,
                                                                width: "100%",
                                                                border: queryMissing
                                                                    ? `1px solid ${STATUS_RED}`
                                                                    : styles.textInput.border,
                                                            }}
                                                            value={r.query}
                                                            disabled={addCnSubmitting}
                                                            placeholder="Describe the query…"
                                                            onChange={(e) =>
                                                                setAddCnRow(i, {
                                                                    query: e.target.value,
                                                                })
                                                            }
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
    value: number | string;
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
    onSubmit,
    onResolveQuery,
    clientCell,
    styles,
    readOnly,
}: {
    index: number;
    c: CaseRow;
    ampMins: number;
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
                    {c.allocatedAt && <span>Allocated {formatDateTime(c.allocatedAt)}</span>}
                    {ampMins > 0 && <span>Time: {formatMinutes(ampMins)}</span>}
                    {c.allocatedAt && <span>{allocAgeLabel(c)}</span>}
                </div>
            )}
            <div style={{ margin: "6px 0" }}>{clientCell}</div>
            {readOnly ? null : isOpenQuery(c) ? (
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
        empPillWrap: { position: "relative", width: "100%", maxWidth: 420 },
        empPill: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 46,
            boxSizing: "border-box",
            padding: "0 10px 0 16px",
            background: "#fff",
            border: "1px solid #E3E8F2",
            borderRadius: 999,
            boxShadow: "0 4px 14px rgba(23,44,84,.08)",
        },
        empPillInput: {
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: fontSize.base,
            color: "#17181C",
            fontFamily: "inherit",
        },
        empKbd: {
            flexShrink: 0,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#3D4459",
            background: "#EEF1F6",
            borderRadius: 8,
            padding: "5px 10px",
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
            width: 96,
            height: 96,
            borderRadius: radius.circle,
            background: GRADIENT,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize["6xl"],
            fontWeight: fontWeight.semibold,
            boxShadow: `0 0 0 4px ${withAlpha(BRAND.blue, 0.08)}`,
        },
        avatarImg: {
            width: 96,
            height: 96,
            borderRadius: radius.circle,
            objectFit: "cover",
            boxShadow: `0 0 0 4px ${withAlpha(BRAND.blue, 0.08)}`,
        },
        avatarEditBtn: {
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 32,
            height: 32,
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

        /* Stats — 4 cards now (Total / Submitted / Pending / Allocated Time) */
        statsGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
        },
        statsGridMobile: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
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
