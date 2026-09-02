import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
// NEW: two more tabs on this page — "Cases" (manual + smart allocation of
// individual cases from the Case Register) and "Employees" (service-wise
// Present/Absent/Leave marking that Smart Allocation reads). Same pattern
// dailywork.tsx uses for its own "Case Register" tab — completely
// separate components; nothing below this import touches the existing
// quantity-based Allocate tab's logic or JSX.
import TodaysAllocationCases from "./todaysallocationcases";
import TodaysAllocationEmployees from "./todaysallocationemployees";
import TodaysAllocationHistory from "./todaysallocationhistory";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;

// THEME FIX: these three used to be fixed hex values, so this page
// never reacted when someone changed the app's theme color in
// Settings — every other page that reads var(--brand-blue) etc.
// (clients.tsx, dailywork.tsx, products.tsx) already does, and
// ThemeContext keeps these CSS variables in sync with the active
// palette on <html>, so pointing at them here makes this page pick
// up the same live color changes automatically.
const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))";

function withAlpha(hex: string, alpha: number) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- minimal inline icon set (no external icon lib needed) ----
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
function Calendar({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}
function CalendarCheck({ size = 20, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <path d="m9 16 2 2 4-4" />
        </svg>
    );
}
function Box({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
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
function Clock({ size = 12, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}
function Zap({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}
function Edit3({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}
function Save({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
    );
}
function AlertTriangle({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}
function Users({ size = 34, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}
function Search({ size = 14, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    );
}
function Download({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}
function Filter({ size = 15, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
    );
}
function MoreVertical({ size = 16, color = "currentColor", ...rest }: IconProps) {
    return (
        <svg {...iconBase(size)} color={color} {...rest}>
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
        </svg>
    );
}

// Decorative header illustration — calendar with a checkmark badge and a
// gift box, recolored to the brand blue/teal palette (no external image
// asset needed).
function HeaderIllustration() {
    return (
        <svg width="110" height="90" viewBox="0 0 110 90" fill="none">
            <circle cx="18" cy="14" r="2" fill={BRAND.lightBlue} opacity="0.6" />
            <circle cx="100" cy="20" r="1.6" fill={BRAND.green} opacity="0.7" />
            <circle cx="12" cy="60" r="1.6" fill="#FBBF24" opacity="0.7" />
            <circle cx="96" cy="66" r="2" fill={BRAND.lightBlue} opacity="0.5" />

            <rect
                x="30"
                y="16"
                width="52"
                height="46"
                rx="8"
                fill="rgba(var(--brand-blue-rgb), 0.08)"
            />
            <rect x="30" y="16" width="52" height="14" rx="8" fill={BRAND.blue} />
            <rect x="40" y="6" width="4" height="14" rx="2" fill={BRAND.blue} />
            <rect x="68" y="6" width="4" height="14" rx="2" fill={BRAND.blue} />
            {[0, 1, 2].map((row) =>
                [0, 1, 2, 3].map((col) => (
                    <rect
                        key={`${row}-${col}`}
                        x={38 + col * 11}
                        y={38 + row * 8}
                        width="6"
                        height="6"
                        rx="1.5"
                        fill="rgba(var(--brand-blue-rgb), 0.18)"
                    />
                ))
            )}
            <circle cx="82" cy="62" r="13" fill={BRAND.green} />
            <path
                d="M76 62l4 4 8-8"
                stroke="#fff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            <rect x="82" y="48" width="18" height="16" rx="3" fill={BRAND.lightBlue} />
            <rect x="82" y="54" width="18" height="4" fill="#fff" opacity="0.6" />
            <rect x="89" y="48" width="4" height="16" fill="#fff" opacity="0.6" />
            <path d="M91 48c-3-4-9-4-9 0" stroke={BRAND.lightBlue} strokeWidth="2" fill="none" />
            <path d="M91 48c3-4 9-4 9 0" stroke={BRAND.lightBlue} strokeWidth="2" fill="none" />
        </svg>
    );
}

function EmptyStateIcon() {
    return (
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="28" fill="rgba(var(--brand-blue-rgb), 0.06)" />
            <rect
                x="14"
                y="24"
                width="28"
                height="16"
                rx="3"
                fill="rgba(var(--brand-blue-rgb), 0.12)"
            />
            <path
                d="M14 28h8l2 4h8l2-4h8"
                stroke="rgba(var(--brand-blue-rgb), 0.35)"
                strokeWidth="2"
                fill="none"
            />
            <circle cx="20" cy="20" r="2" fill="#FBBF24" />
            <circle cx="38" cy="18" r="1.6" fill="#FBBF24" />
        </svg>
    );
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

// ---------------- types ----------------
type Product = { id: string; product_name: string; teams?: string[] };

type DailyWorkBatch = {
    id: string;
    workDate: string;
    productId: string;
    productName: string | null;
    totalQty: number;
    allocatedQty: number;
    pendingQty: number;
};

type Employee = {
    id: string;
    name: string;
    employeeCode: string | null;
    department: string | null;
    team: string | null;
};

type RowStatus = "PRESENT" | "HALF" | "LEAVE";
type RowState = { status: RowStatus; qty: number };

// ---- unsaved-draft persistence ----
// Problem this fixes: running "Smart Allocation" fills in qty per
// employee, but nothing is actually saved to the server until the
// "Allocate & Save" button is clicked. Navigating to another page and
// back used to unmount this whole component, so all that unsaved state
// (React state, in memory only) was lost — everything came back blank.
// localStorage survives navigation/unmount, so a draft is written on
// every change and restored on return, per daily-work batch (never mixed
// across different services/dates). It's cleared once the allocation is
// actually saved (no longer "unsaved"), or when the person hits Clear.
// Hover state for the page-level tab bar (Allocate / Cases / Employees)
// — same treatment as the Client/Subclient tab buttons on clients.tsx.
const MAIN_TAB_CSS = `
.ma-tab-btn:hover { border-color: #cfe0f5; color: var(--brand-blue); }
`;

const DRAFT_PREFIX = "manualalloc_draft_";

function draftKey(batchId: string) {
    return `${DRAFT_PREFIX}${batchId}`;
}

function loadDraft(batchId: string): Record<string, RowState> | null {
    try {
        const raw = localStorage.getItem(draftKey(batchId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveDraft(batchId: string, rows: Record<string, RowState>) {
    try {
        localStorage.setItem(draftKey(batchId), JSON.stringify(rows));
    } catch {
        // localStorage unavailable/full — draft persistence just won't
        // work this time, not worth surfacing an error for.
    }
}

function clearDraft(batchId: string) {
    try {
        localStorage.removeItem(draftKey(batchId));
    } catch {
        // ignore
    }
}

const STATUS_META: Record<RowStatus, { label: string; color: string; icon: typeof Box }> = {
    PRESENT: { label: "Present", color: BRAND.green, icon: CheckCircle2 },
    HALF: { label: "Half", color: BRAND.amber, icon: Clock },
    LEAVE: { label: "Leave", color: BRAND.grey, icon: Calendar },
};

function initials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}
const AVATAR_PALETTE = ["#E9E4FB", "#FCE7D6", "#DCEFFB", "#FCE4EC", "#E1F3EC", "#EDEBFF"];
const AVATAR_TEXT = ["#6D4FE0", "#C2761B", "#1785B0", "#C2447A", "#1E9A78", "#5B3DF5"];
function avatarColors(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const idx = hash % AVATAR_PALETTE.length;
    return { bg: AVATAR_PALETTE[idx], fg: AVATAR_TEXT[idx] };
}

function downloadCsv(filename: string, rows: string[][]) {
    const csv = rows
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export default function ManualAllocation() {
    const isMobile = useIsMobile();

    // ---- filter bar state ----
    // Date always defaults to TODAY on every visit/reload — it used to
    // restore whatever date was last used (via localStorage), which
    // meant re-opening this page days later could silently land on a
    // stale past date instead of today. Service selection still
    // restores from localStorage below (only the date no longer does).
    const [date, setDate] = useState(() => todayStr());

    const [products, setProducts] = useState<Product[]>([]);
    const [productId, setProductId] = useState(
        () => localStorage.getItem("manualalloc_last_productId") || ""
    ); // "" = All
    const [searchText, setSearchText] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(true);

    // Keep localStorage in sync so the NEXT visit restores this same
    // service instead of resetting to "All" (date no longer persists —
    // see the comment above the `date` state; it always starts on today).
    useEffect(() => {
        localStorage.setItem("manualalloc_last_productId", productId);
    }, [productId]);

    // ---- data ----
    const [batchesForDate, setBatchesForDate] = useState<DailyWorkBatch[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [rows, setRows] = useState<Record<string, RowState>>({});
    // NEW: snapshot of what's actually persisted on the server for the
    // currently selected batch — used only to detect whether `rows` has
    // changed since the last successful save, so "Allocate & Save" can
    // be disabled when there's genuinely nothing new to save.
    const [savedRows, setSavedRows] = useState<Record<string, RowState>>({});

    // ---- ui state ----
    const [manualEdit, setManualEdit] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");
    // NEW: centered success popup shown after "Allocate & Save" — the
    // small corner toast alone was too easy to miss, so a proper modal
    // (matching the AddUser page's success modal pattern) confirms the
    // save with the product name and total quantity allocated.
    const [saveSuccess, setSaveSuccess] = useState<{
        productName: string;
        totalQty: number;
    } | null>(null);
    const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // ---- Tab 1 "Allocate" (pick a service, see its case, auto/manual
    // allocate). The "Employees" tab has been removed — everything it
    // did (seeing/editing each employee's assigned qty for the selected
    // service) already happens right here in the Allocate view, so a
    // second tab for it was redundant. activeTab is kept as a variable
    // (always "allocate" now) rather than ripped out everywhere, so the
    // JSX below didn't need restructuring beyond removing the tab bar
    // and the employees-only block.
    const [activeTab] = useState<"allocate">("allocate");

    // NEW: top-level tab switcher for this page — "allocate" (default,
    // 100% unchanged original quantity-based behavior above/below) vs
    // "cases" (manual/smart allocation of individual Case Register
    // entries) vs "employees" (service-wise Present/Absent/Leave, feeds
    // the Cases tab's Smart Allocation). Kept separate from the
    // quantity-based `date`/`productId` state above so neither tab's
    // filters interfere with the other's.
    // NOTE: "Allocate" tab now shows the old header/filters/KPI cards
    // with the Case Register table embedded directly below them (see the
    // `activeTab === "allocate"` block further down) instead of its own
    // original quantity-based table, which is disabled via `{false && ()}`
    // there — not deleted. The standalone "Cases" tab button is hidden
    // (commented out below); "cases" is kept as a valid mainTab value
    // (unreachable via the UI now) in case a separate Cases tab is
    // wanted again later.
    const [mainTab, setMainTab] = useState<"allocate" | "cases" | "employees" | "history">(
        "allocate"
    );
    const [caseProductId, setCaseProductId] = useState("");
    const [caseWorkDate, setCaseWorkDate] = useState(todayStr());

    // BUGFIX: the Allocate tab used to never look at the `attendance`
    // table at all — it had its own local Present/Half/Leave toggle that
    // always defaulted everyone to Present, completely disconnected from
    // whatever was marked on the Employees tab. So marking someone Leave
    // there had zero effect here, and Smart Allocation / manual save would
    // still hand them qty. Fetching attendance for the selected `date` and
    // treating ABSENT/LEAVE as unavailable (same as the Cases tab already
    // does for its own Smart Allocation) closes that gap.
    const [attendanceByEmployee, setAttendanceByEmployee] = useState<
        Record<string, "PRESENT" | "ABSENT" | "LEAVE">
    >({});
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/attendance?date=${date}`);
                const json = await res.json();
                if (!res.ok || !json.success) {
                    setAttendanceByEmployee({});
                    return;
                }
                const next: Record<string, "PRESENT" | "ABSENT" | "LEAVE"> = {};
                (json.data || []).forEach((a: any) => {
                    if (a.status === "ABSENT" || a.status === "LEAVE") {
                        next[a.employeeId] = a.status;
                    }
                });
                setAttendanceByEmployee(next);
            } catch {
                // Attendance failing to load shouldn't block the page —
                // just fall back to the old "everyone present" behavior.
                setAttendanceByEmployee({});
            }
        })();
    }, [date]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // close the row action menu on outside click
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuFor(null);
            }
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, []);

    // ---- selected batch (the one specific daily_work row for date+product) ----
    const selectedBatch = useMemo(
        () => batchesForDate.find((b) => String(b.productId) === String(productId)) || null,
        [batchesForDate, productId]
    );

    // ---- load products (once) ----
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/products`);
                const json = await res.json();
                if (res.ok) setProducts(json.data || []);
            } catch (err) {
                console.error("Failed to load products:", err);
            }
        })();
    }, []);

    // ---- load employees (once) ----
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/employees`);
                const json = await res.json();
                if (res.ok) setEmployees(Array.isArray(json) ? json : json.data || []);
            } catch (err) {
                console.error("Failed to load employees:", err);
            }
        })();
    }, []);

    // ---- load daily_work batches whenever the date changes ----
    const loadBatches = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/daily-work?date=${date}`);
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to load daily work");
            setBatchesForDate(json.data || []);
        } catch (err: any) {
            setError(err.message || "Failed to load daily work for this date");
            setBatchesForDate([]);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        loadBatches();
    }, [loadBatches]);

    // ---- filtered employee list: the selected service's linked Teams
    // (Products/Services -> Teams multi-select) narrows the list FIRST —
    // only employees whose own Team is one of that service's teams show up
    // at all. The Team dropdown then narrows further within that, and the
    // single search box matches name, department, team, product, or status.
    // Falls back to every employee ONLY when the service has no teams
    // linked at all (nothing configured to filter by). If teams ARE
    // linked but zero employees currently have a matching Team, the list
    // is meant to come up empty — silently showing everyone in that case
    // defeats the point of linking teams to begin with.
    const serviceMatched = useMemo(() => {
        const productTeams = products
            .find((p) => String(p.id) === String(productId))
            ?.teams?.map((t) => (t || "").trim())
            .filter(Boolean);
        if (!productTeams || productTeams.length === 0) return employees;
        const allowed = new Set(productTeams.map((t) => t.toLowerCase()));
        return employees.filter((e) => e.team && allowed.has(e.team.trim().toLowerCase()));
    }, [employees, products, productId]);

    const teams = useMemo(
        () => Array.from(new Set(serviceMatched.map((e) => e.team).filter(Boolean))) as string[],
        [serviceMatched]
    );
    // NEW: what the "Team" field now shows — a plain, read-only label of
    // which team(s) the SELECTED SERVICE is aligned to (Products/Services
    // -> Teams multi-select), not a filter the person can change. Comes
    // straight from the product's own `teams` list rather than `teams`
    // above (which is derived from matched employees) so it still reads
    // correctly even before any employees have loaded. Falls back to "All
    // teams" when no service is selected, and "Not linked to any team yet"
    // when a service IS selected but has no teams configured on it.
    const alignedTeamsLabel = useMemo(() => {
        if (!productId) return "All teams";
        const productTeams = products
            .find((p) => String(p.id) === String(productId))
            ?.teams?.map((t) => (t || "").trim())
            .filter(Boolean);
        if (!productTeams || productTeams.length === 0) return "Not linked to any team yet";
        return productTeams.join(", ");
    }, [products, productId]);
    const filteredEmployees = useMemo(() => {
        const list = serviceMatched;

        const q = searchText.trim().toLowerCase();
        if (!q) return list;
        return list.filter((e) => {
            const status = rows[e.id]?.status || "PRESENT";
            const haystack = [
                e.name,
                e.employeeCode,
                e.department,
                e.team,
                selectedBatch?.productName,
                STATUS_META[status]?.label,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [serviceMatched, searchText, rows, selectedBatch]);

    // ---- when the selected batch changes, prefill rows: restore a previous
    // save if one exists for this batch, otherwise default everyone to
    // Present / qty 0 ----
    useEffect(() => {
        setManualEdit(false);
        setError("");

        if (!selectedBatch) {
            setRows({});
            return;
        }

        (async () => {
            let previous: Record<string, RowState> = {};
            let hasServerSave = false;
            try {
                const res = await authFetch(
                    `${API_BASE}/api/allocations?dailyWorkId=${selectedBatch.id}`
                );
                const json = await res.json();
                if (res.ok && json.success && (json.data || []).length > 0) {
                    hasServerSave = true;
                    (json.data || []).forEach((a: any) => {
                        const status: RowStatus = ["PRESENT", "HALF", "LEAVE"].includes(a.status)
                            ? a.status
                            : "PRESENT";
                        previous[a.employee_id] = { status, qty: a.allocated_qty || 0 };
                    });
                }
            } catch {
                // no previous save — fall through to draft/defaults below
            }

            // Only fall back to an unsaved local draft when nothing has
            // actually been saved to the server yet — a real save is
            // always the source of truth over a stale draft.
            const draft = hasServerSave ? null : loadDraft(selectedBatch.id);

            const next: Record<string, RowState> = {};
            filteredEmployees.forEach((emp) => {
                const attStatus = attendanceByEmployee[emp.id];
                if (attStatus === "ABSENT" || attStatus === "LEAVE") {
                    // Attendance (marked on the Employees tab) always wins —
                    // someone marked Absent/Leave for the day should never
                    // load in here as allocatable, regardless of any old
                    // saved row or draft that predates the leave.
                    next[emp.id] = { status: "LEAVE", qty: 0 };
                } else {
                    next[emp.id] = previous[emp.id] ||
                        draft?.[emp.id] || { status: "PRESENT", qty: 0 };
                }
            });
            setRows(next);
            // Baseline = exactly what the server has right now (empty if
            // nothing's been saved for this batch yet). A restored draft
            // is intentionally NOT folded in here — a draft is by
            // definition unsaved, so it should show up as a change
            // against this baseline and keep the save button enabled.
            setSavedRows(previous);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBatch?.id]);

    // Keep `rows` in sync if attendance changes (or finishes loading)
    // AFTER the batch's rows were already seeded above — e.g. the
    // attendance fetch above resolves late, or the manager marks someone
    // Leave on the Employees tab and flips back to this tab without
    // reselecting the service. Attendance always overrides to Leave/qty 0
    // here too, so a stale "Present" row can't linger.
    useEffect(() => {
        setRows((prev) => {
            let changed = false;
            const next = { ...prev };
            Object.entries(attendanceByEmployee).forEach(([empId, status]) => {
                if (
                    (status === "ABSENT" || status === "LEAVE") &&
                    next[empId] &&
                    (next[empId].status !== "LEAVE" || next[empId].qty !== 0)
                ) {
                    next[empId] = { status: "LEAVE", qty: 0 };
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [attendanceByEmployee]);

    // Persist the draft on every change (Smart Allocation, manual qty
    // edits, status clicks) so it survives navigating away and back.
    // Skipped on the very first render for a batch (rows still empty
    // object before the load effect above populates it) to avoid
    // clobbering a just-restored draft with {} for one tick.
    useEffect(() => {
        if (!selectedBatch || Object.keys(rows).length === 0) return;
        saveDraft(selectedBatch.id, rows);
    }, [rows, selectedBatch]);

    // ---- KPI numbers ----
    const totalQty = useMemo(() => {
        if (productId) return selectedBatch?.totalQty ?? 0;
        return batchesForDate.reduce((sum, b) => sum + b.totalQty, 0);
    }, [productId, selectedBatch, batchesForDate]);

    const allocatedQty = useMemo(() => {
        if (productId) return Object.values(rows).reduce((sum, r) => sum + (r.qty || 0), 0);
        return batchesForDate.reduce((sum, b) => sum + b.allocatedQty, 0);
    }, [productId, rows, batchesForDate]);

    const remainingQty = totalQty - allocatedQty;

    // ---- NEW: case-number-based KPI counts ----
    // The "Allocate" tab now shows the Case Register table (Cases tab
    // content embedded above), so its Total/Allocated/Remaining KPI
    // cards should count CASES (rows in service_cases for this
    // service+date), not the Daily Work batch's quantity like totalQty/
    // allocatedQty/remainingQty above still do. Two lightweight
    // pageSize=1 list calls (one unfiltered, one allocationStatus=
    // ALLOCATED) just read back `pagination.total` for an exact count
    // without pulling every row. Re-fetches whenever the selected
    // service or date changes; "All Services" (productId === "") omits
    // productId from the query so the count spans every service for
    // that date, same scope the old batchesForDate sum used.
    const [caseTotalCount, setCaseTotalCount] = useState(0);
    const [caseAllocatedCount, setCaseAllocatedCount] = useState(0);
    // Bumped by TodaysAllocationCases (via onCasesChanged) after any
    // allocate/auto-allocate/clear action, so these KPI counts refresh
    // right away instead of waiting for the next productId/date change.
    const [caseCountsRefreshKey, setCaseCountsRefreshKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const fetchCaseCounts = async () => {
            try {
                const baseParams = new URLSearchParams();
                baseParams.set("page", "1");
                baseParams.set("pageSize", "1");
                if (productId) baseParams.set("productId", productId);
                if (date) baseParams.set("workDate", date);
                // NEW: keep these KPI counts in sync with the table below
                // (TodaysAllocationCases), which now carries forward any
                // still-PENDING case from an earlier date instead of
                // hiding it — without this, "Total Cases"/"Remaining"
                // would undercount versus what's actually listed.
                baseParams.set("includeBacklog", "true");

                const allocatedParams = new URLSearchParams(baseParams);
                allocatedParams.set("allocationStatus", "ALLOCATED");

                const [totalRes, allocatedRes] = await Promise.all([
                    authFetch(`${API_BASE}/api/service-cases?${baseParams.toString()}`),
                    authFetch(`${API_BASE}/api/service-cases?${allocatedParams.toString()}`),
                ]);
                const [totalJson, allocatedJson] = await Promise.all([
                    totalRes.json(),
                    allocatedRes.json(),
                ]);
                if (cancelled) return;
                setCaseTotalCount(
                    totalRes.ok && totalJson.success ? (totalJson.pagination?.total ?? 0) : 0
                );
                setCaseAllocatedCount(
                    allocatedRes.ok && allocatedJson.success
                        ? (allocatedJson.pagination?.total ?? 0)
                        : 0
                );
            } catch (err) {
                if (!cancelled) {
                    setCaseTotalCount(0);
                    setCaseAllocatedCount(0);
                }
            }
        };
        fetchCaseCounts();
        return () => {
            cancelled = true;
        };
    }, [productId, date, caseCountsRefreshKey]);

    const caseRemainingCount = caseTotalCount - caseAllocatedCount;

    const fetchCaseCountsAgain = useCallback(() => {
        setCaseCountsRefreshKey((k) => k + 1);
    }, []);

    // ---- status counts (for the smart allocation formula) ----
    // Present is the default: an employee counts as Present unless they've
    // been explicitly marked Half or Leave. This is computed off
    // filteredEmployees (not just Object.values(rows)) so nobody needs to
    // be actively "marked" Present for Smart Allocation to see them —
    // only Half/Leave need explicit marking.
    const presentCount = useMemo(
        () =>
            filteredEmployees.filter((e) => {
                const s = rows[e.id]?.status;
                return s !== "HALF" && s !== "LEAVE";
            }).length,
        [filteredEmployees, rows]
    );
    const halfCount = useMemo(
        () => filteredEmployees.filter((e) => rows[e.id]?.status === "HALF").length,
        [filteredEmployees, rows]
    );

    // ---- SMART ALLOCATION LOGIC ----
    // total_units = present + half*0.5
    // base_qty = floor(total_qty / total_units)
    // Present -> base_qty, Half -> base_qty/2, Leave -> 0
    const handleSmartAllocation = () => {
        if (!selectedBatch) return;
        const totalUnits = presentCount + halfCount * 0.5;
        if (totalUnits <= 0) {
            setError("Mark at least one employee Present or Half before running Smart Allocation.");
            return;
        }
        const baseQty = Math.floor(selectedBatch.totalQty / totalUnits);

        setRows((prev) => {
            const next = { ...prev };
            // Every visible employee gets a row here (defaulting to
            // Present) — not just whoever already had one in `prev` —
            // so someone nobody has touched yet still gets their share.
            filteredEmployees.forEach((emp) => {
                const attStatus = attendanceByEmployee[emp.id];
                const status =
                    attStatus === "ABSENT" || attStatus === "LEAVE"
                        ? "LEAVE"
                        : next[emp.id]?.status || "PRESENT";
                const qty =
                    status === "PRESENT"
                        ? baseQty
                        : status === "HALF"
                          ? Math.round(baseQty / 2)
                          : 0;
                next[emp.id] = { status, qty };
            });
            return next;
        });
        setError("");
    };

    // ---- status button click ----
    const setStatus = (employeeId: string, status: RowStatus) => {
        setRows((prev) => {
            const current = prev[employeeId] || { status: "PRESENT", qty: 0 };
            const qty = status === "LEAVE" ? 0 : current.qty;
            return { ...prev, [employeeId]: { status, qty } };
        });
    };

    // ---- manual qty edit ----
    const setQty = (employeeId: string, qty: number) => {
        setRows((prev) => ({
            ...prev,
            [employeeId]: {
                ...(prev[employeeId] || { status: "PRESENT", qty: 0 }),
                qty: Math.max(0, qty),
            },
        }));
    };

    // ---- row quick-action menu ----
    const resetRow = (employeeId: string) => {
        setRows((prev) => ({ ...prev, [employeeId]: { status: "PRESENT", qty: 0 } }));
        setOpenMenuFor(null);
    };
    const markPresentRow = (employeeId: string) => {
        setStatus(employeeId, "PRESENT");
        setOpenMenuFor(null);
    };

    // ---- EXPORT (CSV of current filtered table) ----
    const handleExport = () => {
        const header = [
            "#",
            "Employee Name",
            "Employee Code",
            "Dept",
            "Team",
            "Status",
            "Allocated Qty",
        ];
        const body = filteredEmployees.map((emp, idx) => {
            const r = rows[emp.id] || { status: "PRESENT" as RowStatus, qty: 0 };
            return [
                String(idx + 1),
                emp.name,
                emp.employeeCode || "",
                emp.department || "",
                emp.team || "",
                STATUS_META[r.status].label,
                String(r.qty),
            ];
        });
        const productLabel = selectedBatch?.productName || "all-products";
        downloadCsv(`manual-allocation_${date}_${productLabel}.csv`, [header, ...body]);
    };

    const productSelected = !!productId;

    // NEW: is there any actual change between the live `rows` and the
    // last-saved `savedRows` baseline? Compares status+qty for every
    // currently-visible employee — a missing row on either side is
    // treated as the default (Present / qty 0) so a freshly-loaded batch
    // with nothing entered isn't considered "dirty".
    const isDirty = useMemo(() => {
        if (!selectedBatch) return false;
        const defaultRow: RowState = { status: "PRESENT", qty: 0 };
        return filteredEmployees.some((emp) => {
            const current = rows[emp.id] || defaultRow;
            const saved = savedRows[emp.id] || defaultRow;
            return current.status !== saved.status || current.qty !== saved.qty;
        });
    }, [rows, savedRows, filteredEmployees, selectedBatch]);

    // ---- SAVE (shared by Tab 1's "Allocate & Save" button and Tab 2's
    // "Save Changes" button — both write the whole visible table for the
    // selected case via bulk-upsert, replacing whatever was saved before). ----
    const handleSaveAllocations = async () => {
        if (!selectedBatch) {
            setError('Select a specific service (not "All") before saving.');
            return;
        }
        const rowsPayload = filteredEmployees.map((emp) => {
            const r = rows[emp.id] || { status: "PRESENT" as RowStatus, qty: 0 };
            return { employeeId: emp.id, status: r.status, allocatedQty: r.qty };
        });
        if (rowsPayload.length === 0) {
            setError("No employees to allocate — check your search.");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/allocations/bulk-upsert`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dailyWorkId: selectedBatch.id,
                    rows: rowsPayload,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json.message || "Failed to save allocation");
            showToast("Allocation Saved");
            // NEW: centered success popup — total qty is the sum of every
            // row just saved, regardless of status (Present/Half/Leave),
            // since that's exactly what was written to the server.
            const totalQty = rowsPayload.reduce((sum, r) => sum + (r.allocatedQty || 0), 0);
            setSaveSuccess({
                productName: selectedBatch.productName || "this service",
                totalQty,
            });
            // NEW: `rows` is now exactly what's saved on the server — move
            // the baseline forward so the button goes back to disabled
            // until something actually changes again.
            setSavedRows(rows);
            // Now officially saved on the server — the local draft's job
            // is done, drop it so a stale draft never shadows real saved
            // data on a future visit.
            clearDraft(selectedBatch.id);
            loadBatches();
        } catch (err: any) {
            setError(err.message || "Failed to save allocation");
        } finally {
            setSubmitting(false);
        }
    };

    // ---- CLEAR — resets every visible row back to Present / qty 0 and
    // drops the unsaved draft for this batch. Doesn't touch anything
    // already saved on the server; that's only removed by actually
    // saving over it (handleSaveAllocations above).
    const handleClearAllocation = () => {
        if (!selectedBatch) return;
        const next: Record<string, RowState> = {};
        filteredEmployees.forEach((emp) => {
            next[emp.id] = { status: "PRESENT", qty: 0 };
        });
        setRows(next);
        clearDraft(selectedBatch.id);
        setError("");
    };

    // ---- (Load Test Cases / seed-dummy removed — batches now come only
    // from real Daily Work entries, no dev/test seeding button on this
    // page.) ----

    return (
        <>
            <style>{MAIN_TAB_CSS}</style>
            {/* Tab bar — Tab 1 is the exact original quantity-based
                Allocate page (nothing inside it was changed), Tab 2 is
                the new case-level Cases view, Tab 3 is the new Employees
                (attendance) view that feeds Tab 2's Smart Allocation.
                Styled as real pill buttons (border + hover + gradient
                when active), same as the Client/Subclient tabs on the
                Clients page, so they're unmistakably clickable. */}
            <div style={styles.mainTabBar}>
                <button
                    type="button"
                    className="ma-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "allocate" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("allocate")}
                >
                    <i className="ti ti-hand-stop" style={{ fontSize: fontSize.md }} />
                    Allocate
                </button>
                {/* HIDDEN: standalone "Cases" tab button — its content
                    (TodaysAllocationCases) is now embedded directly under
                    the "Allocate" tab instead (see the `activeTab ===
                    "allocate"` block: KPI cards stay, then the Cases table
                    is rendered right below them using the same Date/
                    Service filters). Kept here, commented, in case a
                    separate Cases tab is wanted again later.
                <button
                    type="button"
                    className="ma-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "cases" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("cases")}
                >
                    <i className="ti ti-list-numbers" style={{ fontSize: fontSize.md }} />
                    Cases
                </button>
                */}
                <button
                    type="button"
                    className="ma-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "employees" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("employees")}
                >
                    <i className="ti ti-users" style={{ fontSize: fontSize.md }} />
                    Employees
                </button>
                <button
                    type="button"
                    className="ma-tab-btn"
                    style={{
                        ...styles.mainTabBtn,
                        ...(mainTab === "history" ? styles.mainTabBtnActive : {}),
                    }}
                    onClick={() => setMainTab("history")}
                >
                    <i className="ti ti-history" style={{ fontSize: fontSize.md }} />
                    History
                </button>
            </div>

            {mainTab === "cases" ? (
                <TodaysAllocationCases
                    productId={caseProductId}
                    onChangeProductId={setCaseProductId}
                    workDate={caseWorkDate}
                    onChangeWorkDate={setCaseWorkDate}
                />
            ) : mainTab === "employees" ? (
                // NEW: Service/Team here are no longer independent — they now
                // mirror whatever's picked on the "Allocate" tab (shared
                // productId/setProductId state above), and the Service field
                // inside TodaysAllocationEmployees is read-only to match.
                // Switch to the Allocate tab to actually change the service.
                <TodaysAllocationEmployees
                    productId={productId}
                    onChangeProductId={setProductId}
                    workDate={date}
                />
            ) : mainTab === "history" ? (
                <TodaysAllocationHistory />
            ) : (
                <div style={isMobile ? styles.rootMobile : styles.root}>
                    <div style={styles.topBar} />

                    <div style={isMobile ? styles.pageMobile : styles.page}>
                        {/* ---- Header card — simplified: icon, title, one-line
                    subtext. Illustration + tab switcher removed since
                    there's only ever one view on this page now. ---- */}
                        <div style={isMobile ? styles.headerCardMobile : styles.headerCard}>
                            <div>
                                <h2 style={styles.title}>Today's Allocation</h2>
                                <p style={styles.headerSubtext}>
                                    Pick a date and service, then Smart Allocate or hand out
                                    quantities by hand.
                                </p>
                            </div>
                        </div>

                        {error && (
                            <div style={styles.errorBanner}>
                                <AlertTriangle size={14} />
                                {error}
                            </div>
                        )}

                        {/* ---- 1. TOP FILTER BAR ---- */}
                        {filtersOpen && (
                            <div style={styles.card}>
                                <div style={isMobile ? styles.filterBarMobile : styles.filterBar}>
                                    <div
                                        style={{ ...styles.filterField, width: 190, flexShrink: 0 }}
                                    >
                                        <label style={styles.label}>
                                            <Box size={12} color={BRAND.blue} /> Service
                                        </label>
                                        <select
                                            value={productId}
                                            onChange={(e) => setProductId(e.target.value)}
                                            style={styles.select}
                                        >
                                            <option value="">All Services</option>
                                            {products.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.product_name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div
                                        style={{ ...styles.filterField, width: 190, flexShrink: 0 }}
                                    >
                                        <label style={styles.label}>
                                            <Users size={12} color={BRAND.blue} /> Team
                                        </label>
                                        {/* NEW: read-only — just states which team(s) the
                                            SELECTED SERVICE is aligned to (Products/Services ->
                                            Teams multi-select). No dropdown, nothing to change
                                            here anymore; the service picker above is the only
                                            control. */}
                                        <div
                                            style={styles.teamAlignedLabel}
                                            title={alignedTeamsLabel}
                                        >
                                            {alignedTeamsLabel}
                                        </div>
                                    </div>
                                    <div style={{ ...styles.filterField, flex: 1, minWidth: 180 }}>
                                        <label style={styles.label}>
                                            <Search size={12} color={BRAND.blue} /> Search
                                        </label>
                                        <input
                                            type="text"
                                            value={searchText}
                                            onChange={(e) => setSearchText(e.target.value)}
                                            placeholder="Search by name, department, team, service or status..."
                                            style={styles.select}
                                        />
                                    </div>
                                </div>

                                {!productSelected && (
                                    <p style={styles.allNote}>
                                        <AlertTriangle size={12} color={BRAND.amber} /> "All
                                        Services" is summary-only. Select one service to run Smart
                                        Allocation, Manual Edit, or Allocate &amp; Save.
                                    </p>
                                )}

                                {productSelected && !loading && !selectedBatch && (
                                    <p style={styles.allNote}>
                                        <AlertTriangle size={12} color={BRAND.amber} /> No Daily
                                        Work has been logged for{" "}
                                        {products.find((p) => String(p.id) === String(productId))
                                            ?.product_name || "this service"}{" "}
                                        on {date}. Log today's quantity on the Daily Work page first
                                        — until then this table has no batch to allocate against.
                                    </p>
                                )}
                            </div>
                        )}

                        {activeTab === "allocate" && (
                            <>
                                {/* ---- KPI CARDS ---- */}
                                <div style={isMobile ? styles.kpiRowMobile : styles.kpiRow}>
                                    <KpiCard
                                        icon={Box}
                                        label="Total Cases"
                                        subLabel="Total cases to allocate"
                                        value={caseTotalCount}
                                        color={BRAND.blue}
                                    />
                                    <KpiCard
                                        icon={Users}
                                        label="Present Employees"
                                        subLabel="Currently present"
                                        value={presentCount}
                                        color={BRAND.green}
                                    />
                                    <KpiCard
                                        icon={CheckCircle2}
                                        label="Allocated"
                                        subLabel="Already allocated"
                                        value={caseAllocatedCount}
                                        color={BRAND.lightBlue}
                                    />
                                    <KpiCard
                                        icon={AlertTriangle}
                                        label="Remaining"
                                        subLabel="Yet to allocate"
                                        value={caseRemainingCount}
                                        color={caseRemainingCount > 0 ? BRAND.amber : BRAND.green}
                                    />
                                </div>

                                {/* Case Register table now embedded directly here,
                            reusing the Date/Service filters above instead of
                            its own filter row (Smart Allocation/Clear/Status
                            hidden via hideHeader). The old quantity-based
                            action-bar + table + save-button block that used
                            to sit here is further below, disabled with
                            `{false && (...)}` — not deleted — in case this
                            needs to revert. */}
                                <TodaysAllocationCases
                                    productId={productId}
                                    onChangeProductId={setProductId}
                                    workDate={date}
                                    onChangeWorkDate={setDate}
                                    hideHeader
                                    onCasesChanged={fetchCaseCountsAgain}
                                />

                                {false && (
                                    <>
                                        {/* ---- 2. ACTION BUTTONS ---- */}
                                        <div style={styles.actionBar}>
                                            <div style={styles.actionBarLeft}>
                                                <button
                                                    style={{
                                                        ...styles.smartBtn,
                                                        opacity: productSelected ? 1 : 0.5,
                                                        cursor: productSelected
                                                            ? "pointer"
                                                            : "not-allowed",
                                                    }}
                                                    disabled={!productSelected}
                                                    onClick={handleSmartAllocation}
                                                >
                                                    <Zap size={14} />
                                                    Smart Allocation
                                                </button>
                                                <button
                                                    style={{
                                                        ...styles.manualBtn,
                                                        ...(manualEdit
                                                            ? styles.manualBtnActive
                                                            : {}),
                                                        opacity: productSelected ? 1 : 0.5,
                                                        cursor: productSelected
                                                            ? "pointer"
                                                            : "not-allowed",
                                                    }}
                                                    disabled={!productSelected}
                                                    onClick={() => setManualEdit((v) => !v)}
                                                >
                                                    <Edit3 size={14} />
                                                    Manual Edit: {manualEdit ? "ON" : "OFF"}
                                                </button>
                                                {/* Clears every filled-in qty on screen (and the
                                    saved-locally draft) back to zero — for
                                    starting over, not for undoing an already-saved
                                    allocation. */}
                                                <button
                                                    style={{
                                                        ...styles.clearBtn,
                                                        opacity: productSelected ? 1 : 0.5,
                                                        cursor: productSelected
                                                            ? "pointer"
                                                            : "not-allowed",
                                                    }}
                                                    disabled={!productSelected}
                                                    onClick={handleClearAllocation}
                                                    title="Clear all quantities on screen"
                                                >
                                                    <i
                                                        className="ti ti-eraser"
                                                        style={{ fontSize: 14 }}
                                                    />
                                                    Clear
                                                </button>
                                            </div>
                                            {!isMobile && (
                                                <div style={styles.actionBarRight}>
                                                    <button
                                                        style={styles.iconTextBtn}
                                                        onClick={handleExport}
                                                        disabled={!productSelected}
                                                        title="Export current table to CSV"
                                                    >
                                                        <Download size={14} />
                                                        Export
                                                    </button>
                                                    <button
                                                        style={styles.iconOnlyBtn}
                                                        onClick={() => setFiltersOpen((v) => !v)}
                                                        title={
                                                            filtersOpen
                                                                ? "Hide filters"
                                                                : "Show filters"
                                                        }
                                                    >
                                                        <Filter size={15} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* ---- 3. MAIN TABLE ----
                    A real <table> is used (not stacked CSS-grid divs) so the
                    header and every row are guaranteed to share the exact
                    same column widths — the browser's table layout engine
                    enforces this across <thead> and <tbody> automatically,
                    which independent grid containers per row cannot. */}
                                        <div style={styles.tableCard}>
                                            <table style={styles.table}>
                                                <colgroup>
                                                    <col style={{ width: isMobile ? 28 : 40 }} />
                                                    <col />
                                                    {!isMobile && <col style={{ width: "13%" }} />}
                                                    {!isMobile && <col style={{ width: "13%" }} />}
                                                    {!isMobile && <col style={{ width: "15%" }} />}
                                                    <col
                                                        style={{ width: isMobile ? "34%" : "24%" }}
                                                    />
                                                    <col style={{ width: isMobile ? 84 : 120 }} />
                                                    <col style={{ width: 28 }} />
                                                </colgroup>
                                                <thead>
                                                    <tr style={styles.theadRow}>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                paddingLeft: 18,
                                                            }}
                                                        >
                                                            #
                                                        </th>
                                                        <th style={styles.th}>Employee Name</th>
                                                        {!isMobile && (
                                                            <th style={styles.th}>Dept</th>
                                                        )}
                                                        {!isMobile && (
                                                            <th style={styles.th}>Team</th>
                                                        )}
                                                        {!isMobile && (
                                                            <th style={styles.th}>Service</th>
                                                        )}
                                                        <th style={styles.th}>Status</th>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                textAlign: "right",
                                                            }}
                                                        >
                                                            Allocated Qty
                                                        </th>
                                                        <th
                                                            style={{
                                                                ...styles.th,
                                                                paddingRight: 18,
                                                            }}
                                                        />
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {loading ? (
                                                        <tr>
                                                            <td
                                                                style={styles.emptyNote}
                                                                colSpan={isMobile ? 5 : 8}
                                                            >
                                                                Loading...
                                                            </td>
                                                        </tr>
                                                    ) : !productSelected ? (
                                                        <tr>
                                                            <td colSpan={isMobile ? 5 : 8}>
                                                                <div style={styles.emptyState}>
                                                                    <EmptyStateIcon />
                                                                    <span
                                                                        style={
                                                                            styles.emptyStateText
                                                                        }
                                                                    >
                                                                        Select a service above to
                                                                        see the employee list.
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : filteredEmployees.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={isMobile ? 5 : 8}>
                                                                <div style={styles.emptyState}>
                                                                    <EmptyStateIcon />
                                                                    <span
                                                                        style={
                                                                            styles.emptyStateText
                                                                        }
                                                                    >
                                                                        No employees match your
                                                                        search.
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        filteredEmployees.map((emp, idx) => {
                                                            const r = rows[emp.id] || {
                                                                status: "PRESENT" as RowStatus,
                                                                qty: 0,
                                                            };
                                                            const { bg, fg } = avatarColors(
                                                                emp.name
                                                            );
                                                            const isLeave = r.status === "LEAVE";
                                                            return (
                                                                <tr
                                                                    key={emp.id}
                                                                    style={{
                                                                        background: isLeave
                                                                            ? "#f3f4f6"
                                                                            : idx % 2 === 0
                                                                              ? "#fff"
                                                                              : "#fafaff",
                                                                        opacity: isLeave ? 0.65 : 1,
                                                                    }}
                                                                >
                                                                    <td
                                                                        style={{
                                                                            ...styles.td,
                                                                            paddingLeft: 18,
                                                                            fontSize: fontSize.sm,
                                                                            color: "#9ca3af",
                                                                        }}
                                                                    >
                                                                        {idx + 1}
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        <div
                                                                            style={{
                                                                                display: "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                gap: 10,
                                                                                minWidth: 0,
                                                                            }}
                                                                        >
                                                                            <div
                                                                                style={{
                                                                                    ...styles.avatar,
                                                                                    background: bg,
                                                                                    color: fg,
                                                                                }}
                                                                            >
                                                                                {initials(emp.name)}
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    minWidth: 0,
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    style={
                                                                                        styles.empName
                                                                                    }
                                                                                >
                                                                                    {emp.name}
                                                                                </div>
                                                                                {emp.employeeCode && (
                                                                                    <div
                                                                                        style={
                                                                                            styles.empCode
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            emp.employeeCode
                                                                                        }
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    {!isMobile && (
                                                                        <td
                                                                            style={{
                                                                                ...styles.td,
                                                                                fontSize:
                                                                                    fontSize.base,
                                                                                color: "#374151",
                                                                            }}
                                                                        >
                                                                            {emp.department || "-"}
                                                                        </td>
                                                                    )}
                                                                    {!isMobile && (
                                                                        <td
                                                                            style={{
                                                                                ...styles.td,
                                                                                fontSize:
                                                                                    fontSize.base,
                                                                                color: "#374151",
                                                                            }}
                                                                        >
                                                                            {emp.team || "-"}
                                                                        </td>
                                                                    )}
                                                                    {!isMobile && (
                                                                        <td
                                                                            style={{
                                                                                ...styles.td,
                                                                                fontSize:
                                                                                    fontSize.base,
                                                                                fontWeight:
                                                                                    fontWeight.medium,
                                                                                color: BRAND.blue,
                                                                            }}
                                                                        >
                                                                            {selectedBatch?.productName ||
                                                                                "-"}
                                                                        </td>
                                                                    )}
                                                                    <td style={styles.td}>
                                                                        <div
                                                                            style={{
                                                                                display: "flex",
                                                                                gap: 6,
                                                                                flexWrap: "wrap",
                                                                            }}
                                                                        >
                                                                            {r.status ===
                                                                                "PRESENT" && (
                                                                                <span
                                                                                    style={{
                                                                                        ...styles.statusBtn,
                                                                                        background:
                                                                                            withAlpha(
                                                                                                STATUS_META
                                                                                                    .PRESENT
                                                                                                    .color,
                                                                                                0.06
                                                                                            ),
                                                                                        color: STATUS_META
                                                                                            .PRESENT
                                                                                            .color,
                                                                                        border: `1px solid ${withAlpha(
                                                                                            STATUS_META
                                                                                                .PRESENT
                                                                                                .color,
                                                                                            0.35
                                                                                        )}`,
                                                                                        cursor: "default",
                                                                                    }}
                                                                                >
                                                                                    <CheckCircle2
                                                                                        size={12}
                                                                                        color={
                                                                                            STATUS_META
                                                                                                .PRESENT
                                                                                                .color
                                                                                        }
                                                                                    />
                                                                                    Present
                                                                                </span>
                                                                            )}
                                                                            {(
                                                                                [
                                                                                    "HALF",
                                                                                    "LEAVE",
                                                                                ] as RowStatus[]
                                                                            ).map((s) => {
                                                                                const active =
                                                                                    r.status === s;
                                                                                const meta =
                                                                                    STATUS_META[s];
                                                                                const StatusIcon =
                                                                                    meta.icon;
                                                                                return (
                                                                                    <button
                                                                                        key={s}
                                                                                        onClick={() =>
                                                                                            setStatus(
                                                                                                emp.id,
                                                                                                active
                                                                                                    ? "PRESENT"
                                                                                                    : s
                                                                                            )
                                                                                        }
                                                                                        style={{
                                                                                            ...styles.statusBtn,
                                                                                            background:
                                                                                                active
                                                                                                    ? meta.color
                                                                                                    : withAlpha(
                                                                                                          meta.color,
                                                                                                          0.06
                                                                                                      ),
                                                                                            color: active
                                                                                                ? "#fff"
                                                                                                : meta.color,
                                                                                            border: `1px solid ${
                                                                                                active
                                                                                                    ? meta.color
                                                                                                    : withAlpha(
                                                                                                          meta.color,
                                                                                                          0.35
                                                                                                      )
                                                                                            }`,
                                                                                        }}
                                                                                    >
                                                                                        <StatusIcon
                                                                                            size={
                                                                                                12
                                                                                            }
                                                                                            color={
                                                                                                active
                                                                                                    ? "#fff"
                                                                                                    : meta.color
                                                                                            }
                                                                                        />
                                                                                        {meta.label}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </td>
                                                                    <td style={styles.td}>
                                                                        <div
                                                                            style={{
                                                                                display: "flex",
                                                                                justifyContent:
                                                                                    "flex-end",
                                                                            }}
                                                                        >
                                                                            {manualEdit ? (
                                                                                <input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    value={r.qty}
                                                                                    disabled={
                                                                                        isLeave
                                                                                    }
                                                                                    onChange={(e) =>
                                                                                        setQty(
                                                                                            emp.id,
                                                                                            Number(
                                                                                                e
                                                                                                    .target
                                                                                                    .value
                                                                                            ) || 0
                                                                                        )
                                                                                    }
                                                                                    style={
                                                                                        styles.qtyInput
                                                                                    }
                                                                                />
                                                                            ) : (
                                                                                <span
                                                                                    style={{
                                                                                        ...styles.qtyPill,
                                                                                        background:
                                                                                            withAlpha(
                                                                                                BRAND.lightBlue,
                                                                                                0.12
                                                                                            ),
                                                                                        color: BRAND.blue,
                                                                                    }}
                                                                                >
                                                                                    {r.qty}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        style={{
                                                                            ...styles.td,
                                                                            paddingRight: 18,
                                                                            position: "relative",
                                                                        }}
                                                                    >
                                                                        <button
                                                                            style={styles.dotsBtn}
                                                                            onClick={() =>
                                                                                setOpenMenuFor(
                                                                                    openMenuFor ===
                                                                                        emp.id
                                                                                        ? null
                                                                                        : emp.id
                                                                                )
                                                                            }
                                                                        >
                                                                            <MoreVertical
                                                                                size={15}
                                                                                color="#9ca3af"
                                                                            />
                                                                        </button>
                                                                        {openMenuFor === emp.id && (
                                                                            <div
                                                                                ref={menuRef}
                                                                                style={
                                                                                    styles.rowMenu
                                                                                }
                                                                            >
                                                                                <button
                                                                                    style={
                                                                                        styles.rowMenuItem
                                                                                    }
                                                                                    onClick={() =>
                                                                                        markPresentRow(
                                                                                            emp.id
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    Mark Present
                                                                                </button>
                                                                                <button
                                                                                    style={
                                                                                        styles.rowMenuItem
                                                                                    }
                                                                                    onClick={() =>
                                                                                        resetRow(
                                                                                            emp.id
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    Reset to 0
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* ---- 6. BOTTOM BUTTON ----
                    Disabled once everything visible matches what's
                    already saved (isDirty === false) — re-enables the
                    instant any row's status/qty changes, even by 1. */}
                                        <button
                                            style={{
                                                ...styles.saveBtn,
                                                opacity:
                                                    submitting || !productSelected || !isDirty
                                                        ? 0.6
                                                        : 1,
                                                cursor:
                                                    submitting || !productSelected || !isDirty
                                                        ? "not-allowed"
                                                        : "pointer",
                                            }}
                                            disabled={submitting || !productSelected || !isDirty}
                                            onClick={handleSaveAllocations}
                                        >
                                            <Save size={16} />
                                            {submitting
                                                ? "Saving..."
                                                : !isDirty && productSelected
                                                  ? "Saved"
                                                  : "Allocate & Save"}
                                        </button>
                                    </>
                                )}
                            </>
                        )}

                        {toast && (
                            <div style={styles.toast}>
                                <CheckCircle2 size={16} color="#fff" />
                                {toast}
                            </div>
                        )}

                        {/* ---- centered success popup after Allocate & Save ---- */}
                        {saveSuccess && (
                            <div style={styles.overlay} onClick={() => setSaveSuccess(null)}>
                                <div
                                    style={styles.successModal}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div style={styles.successIcon}>
                                        <CheckCircle2 size={30} color={BRAND.green} />
                                    </div>
                                    <h3 style={styles.successTitle}>Allocation Successful</h3>
                                    <p style={styles.successText}>
                                        {saveSuccess.totalQty} unit(s) allocated for{" "}
                                        <strong>{saveSuccess.productName}</strong>.
                                    </p>
                                    <button
                                        style={styles.successBtn}
                                        onClick={() => setSaveSuccess(null)}
                                        type="button"
                                    >
                                        OK
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

function KpiCard({
    icon: Icon,
    label,
    subLabel,
    value,
    color,
}: {
    icon: typeof Box;
    label: string;
    subLabel: string;
    value: number;
    color: string;
}) {
    return (
        <div style={{ ...styles.kpiCard, background: withAlpha(color, 0.07) }}>
            <div style={styles.dotPattern}>
                {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} style={{ ...styles.dot, background: withAlpha(color, 0.35) }} />
                ))}
            </div>
            <div style={{ ...styles.kpiIconWrap, background: withAlpha(color, 0.16) }}>
                <Icon size={20} color={color} />
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ ...styles.kpiValue, color }}>{value}</div>
                <div style={styles.kpiLabel}>{label}</div>
                <div style={styles.kpiSubLabel}>{subLabel}</div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    // Page-level tab bar (Allocate / Cases / Employees) — same
    // pill-button look as the Client/Subclient tabs on clients.tsx:
    // a real bordered button with a hover state and a gradient +
    // shadow when active, instead of a flat underline tab. Easier to
    // see and to hit, which is what was making clicks feel unreliable.
    mainTabBar: {
        display: "flex",
        gap: 8,
        padding: "14px 28px",
        background: "#f4f5fb",
        flexWrap: "wrap",
    },
    mainTabBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#3b4a63",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "10px 18px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        transition: "border-color .15s ease, color .15s ease",
    },
    mainTabBtnActive: {
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
    },
    root: {
        width: "100%",
        minHeight: "100%",
        background: "linear-gradient(180deg, #EEF1FB 0%, #F7F8FC 40%)",
        fontFamily: fontFamily.base,
    },
    rootMobile: {
        width: "100%",
        minHeight: "100%",
        background: "linear-gradient(180deg, #EEF1FB 0%, #F7F8FC 40%)",
        fontFamily: fontFamily.base,
    },
    topBar: {
        height: "4px",
        width: "100%",
        background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
    },
    page: { padding: "24px 32px 32px", width: "100%", boxSizing: "border-box" },
    pageMobile: { padding: "14px 14px 20px" },

    headerCard: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 18,
    },
    headerCardMobile: {
        display: "flex",
        flexDirection: "column",
        marginBottom: 14,
    },
    title: {
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        margin: 0,
        textAlign: "left",
    },
    headerSubtext: {
        margin: "4px 0 0",

        fontSize: fontSize.base,

        color: "#767F92",

        textAlign: "left",
    },
    headerIllustration: { flexShrink: 0, marginLeft: 20 },

    tabBarRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 16,
        flexWrap: "wrap",
    },
    tabBarRowMobile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 10,
        marginBottom: 14,
    },
    tabBar: {
        display: "inline-flex",
        background: "#fff",
        borderRadius: radius.xl,
        padding: 4,
        gap: 4,
        boxShadow: "0 2px 10px rgba(32,66,151,0.06)",
    },
    tabBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "transparent",
        color: "#6b7280",
        borderRadius: radius.lg,
        padding: "8px 18px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    tabBtnActive: {
        background: GRADIENT,
        color: "#fff",
        boxShadow: "0 4px 12px rgba(32,66,151,0.3)",
    },
    loadTestCasesBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        color: BRAND.blue,
        border: `1px dashed rgba(var(--brand-blue-rgb), 0.4)`,
        borderRadius: radius.xl,
        padding: "10px 18px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
    },
    errorBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#FEF2F2",
        color: BRAND.red,
        border: "1px solid #FECACA",
        borderRadius: radius.sm,
        padding: "10px 14px",
        fontSize: fontSize.base,
        marginBottom: 16,
    },

    card: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: 18,
        boxShadow: "0 2px 10px rgba(32,66,151,0.06)",
        marginBottom: 16,
    },
    filterBar: {
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
    },
    filterBarMobile: { display: "flex", flexDirection: "column", gap: 12 },
    filterField: {},
    label: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        marginBottom: 6,
    },
    select: {
        width: "100%",
        height: 38,
        padding: "0 10px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        fontSize: fontSize.base,
        boxSizing: "border-box",
        background: "#fafbff",
    },
    // NEW: read-only stand-in for the old Team <select> — same box shape
    // so the filter row's alignment doesn't shift, but not a control
    // (no border-hover/focus states, text can wrap for multi-team labels).
    teamAlignedLabel: {
        width: "100%",
        height: 38,
        padding: "0 10px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        fontSize: fontSize.base,
        boxSizing: "border-box",
        background: "#f4f5f9",
        color: "#374151",
        display: "flex",
        alignItems: "center",
    },
    allNote: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.xs,
        color: "#92400E",
        background: "#FFFBEB",
        padding: "8px 12px",
        borderRadius: radius.sm,
        marginTop: 12,
    },

    kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 },
    kpiRowMobile: {
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 10,
        marginBottom: 14,
    },
    kpiCard: {
        position: "relative",
        overflow: "hidden",
        borderRadius: radius.lg,
        padding: "16px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 0,
    },
    dotPattern: {
        position: "absolute",
        right: 14,
        top: "50%",
        transform: "translateY(-50%)",
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 5,
        opacity: 0.6,
    },
    dot: { width: 3, height: 3, borderRadius: radius.circle },
    kpiIconWrap: {
        width: 42,
        height: 42,
        borderRadius: radius.circle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        zIndex: 1,
    },
    kpiValue: {
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.bold,
        zIndex: 1,
        position: "relative",
        lineHeight: 1.2,
    },
    kpiLabel: {
        fontSize: fontSize.sm,
        color: "#374151",
        fontWeight: fontWeight.semibold,
        marginTop: 2,
        zIndex: 1,
        position: "relative",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    kpiSubLabel: {
        fontSize: fontSize.xxs,
        color: "#9ca3af",
        fontWeight: fontWeight.regular,
        marginTop: 1,
        zIndex: 1,
        position: "relative",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    actionBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
        flexWrap: "wrap",
    },
    actionBarLeft: { display: "flex", gap: 10, flexWrap: "wrap" },
    actionBarRight: { display: "flex", gap: 8 },
    smartBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: radius.pill,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        boxShadow: `0 4px 14px rgba(var(--brand-blue-rgb), 0.3)`,
    },
    manualBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        color: BRAND.blue,
        border: `1px solid rgba(var(--brand-blue-rgb), 0.25)`,
        borderRadius: radius.pill,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
    },
    manualBtnActive: {
        background: withAlpha(BRAND.amber, 0.12),
        border: `1px solid ${BRAND.amber}`,
        color: BRAND.amber,
    },
    clearBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        color: BRAND.red,
        border: `1px solid ${withAlpha(BRAND.red, 0.3)}`,
        borderRadius: radius.pill,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
    },
    iconTextBtn: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        background: "#fff",
        color: BRAND.blue,
        border: "1px solid #e2e4f0",
        borderRadius: radius.md,
        padding: "11px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },
    iconOnlyBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        background: "#fff",
        color: BRAND.blue,
        border: "1px solid #e2e4f0",
        borderRadius: radius.md,
        cursor: "pointer",
    },

    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 2px 10px rgba(32,66,151,0.06)",
        overflow: "visible",
        marginBottom: 18,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
    },
    theadRow: {
        background: "#f9fafb",
        borderBottom: "1px solid #f1f1f1",
    },
    th: {
        textAlign: "left",
        padding: "12px 10px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
    },
    td: {
        textAlign: "left",
        verticalAlign: "middle",
        padding: "10px 10px",
        borderBottom: "1px solid #f1f1f1",
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: radius.circle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    empName: {
        fontSize: fontSize.base,
        color: "#1a1a2e",
        fontWeight: fontWeight.medium,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    empCode: { fontSize: fontSize.xs, color: "#9ca3af", marginTop: 1 },
    statusBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 11px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    qtyInput: {
        width: 70,
        padding: "7px 8px",
        borderRadius: radius.sm,
        border: "1px solid #d1d5db",
        fontSize: fontSize.base,
        textAlign: "center",
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
    },
    qtyPill: {
        display: "inline-flex",
        minWidth: 40,
        justifyContent: "center",
        padding: "5px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
    },
    dotsBtn: {
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        borderRadius: radius.xs,
    },
    rowMenu: {
        position: "absolute",
        right: 18,
        top: "100%",
        marginTop: 4,
        background: "#fff",
        borderRadius: radius.sm,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        border: "1px solid #f1f1f1",
        zIndex: 20,
        overflow: "hidden",
        minWidth: 130,
    },
    rowMenuItem: {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "9px 14px",
        fontSize: fontSize.sm,
        color: "#374151",
        background: "#fff",
        border: "none",
        cursor: "pointer",
    },
    emptyNote: {
        padding: "28px",
        textAlign: "center" as const,
        color: "#9ca3af",
        fontSize: fontSize.base,
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "36px 20px",
    },
    emptyStateText: { fontSize: fontSize.base, color: "#9ca3af" },

    saveBtn: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "16px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.md,
        boxShadow: `0 6px 18px rgba(var(--brand-blue-rgb), 0.3)`,
    },

    toast: {
        position: "fixed",
        bottom: 24,
        right: 24,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: BRAND.green,
        color: "#fff",
        padding: "12px 18px",
        borderRadius: radius.md,
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        zIndex: 1000,
    },

    // ---- centered success popup (Allocate & Save) ----
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    successModal: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: 32,
        width: 360,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    },
    successIcon: {
        width: 56,
        height: 56,
        borderRadius: radius.circle,
        background: "rgba(var(--brand-green-rgb), 0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 16px",
    },
    successTitle: {
        margin: "0 0 8px",
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    successText: {
        margin: "0 0 24px",
        fontSize: fontSize.md,
        color: "#767F92",
    },
    successBtn: {
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "10px 32px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
};
