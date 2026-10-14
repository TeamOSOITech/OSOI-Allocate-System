// src/pages/admin/todaysallocationcases.tsx
//
// "Cases" tab on the Today's Allocation page (see manualallocation.tsx).
//
// Handles BOTH kinds of work:
//  A) Cases WITH case numbers (service_cases) — per-row dropdown + Smart Allocation
//  B) COUNT-ONLY entries (service_case_counts) — shown as "N cases pending" rows,
//     with per-employee quantity boxes + Smart Allocation (even split, extras
//     rotate to whoever got the least work in the last 30 days).
//
// Nothing is saved until the user presses the bottom "Allocate" button.
//
// MODIFIED in this version:
//   - FIX (URGENT EMPLOYEES): the "Anything Urgent" popup lists pending cases
//     of ALL services, but the External Members of a service were only loaded
//     for the service currently selected on the page. So for an urgent case of
//     any other service its External employees (and so the whole list) were
//     missing and the dropdown showed just one person. Now, when the popup
//     opens, the External Members of EVERY service that has an urgent case are
//     loaded too, and the employee dropdown shows everyone mapped to that
//     service - team members AND external members (Absent / Leave excluded).
//   - NEW (8h WARNING): when the Allocate button is pressed and any employee
//     would end up with MORE THAN 8 HOURS of work, a warning popup opens first
//     ("Some employees got more than 8 hours of work") with a button to see
//     all those employees. "Yes, Continue" then allocates; "Cancel" saves nothing.
//   - NEW (NOTIFY): as soon as work is allocated, every employee who got NEW
//     work receives ONE message: "Your work has been allocated. Please login
//     to check." The message never contains how many cases they got, and an
//     employee is messaged only once per Allocate press (even if they got
//     many cases). The message is sent by the backend endpoint
//     POST /api/service-cases/notify-allocation (see notifyEmployees below).
//   - NEW (URGENT): an "Anything Urgent" button next to Smart Allocation /
//     Clear opens a popup. Pick one or more pending case numbers from the
//     multi-select dropdown, choose the employee for each (the least busy
//     eligible employee is pre-filled) and press "Allocate Urgently". The
//     cases are saved straight away and every employee who got one receives
//     an urgent mail: "An urgent case has been allocated to you. Please
//     prioritise this first." (backend: POST /api/service-cases/notify-urgent).
//   - NEW (NOTIFY OVERLOAD): only the FIRST allocation of the day mails an
//     employee. If their work for the day later goes above 8 hours they get
//     ONE extra polite "more work" mail (the backend makes sure it is sent
//     only once per day). This page sends overloadEmployeeIds = the people
//     who just got new work and are above 8 hours (same number as the 8h
//     warning popup uses).
//   - Summary strip: TOTAL still to allocate = today's pending + carried-over
//     pending (e.g. 10 today + 5 from yesterday = 15).
//   - MONTH-WISE: carry-over only comes from the same month as the selected
//     date. On the 1st everything starts fresh; older months stay in history.
//   - OLDEST FIRST: rows are listed oldest date first, so carried-over work
//     is at the top and gets allocated before the new work. Carried-over rows
//     are tagged "Carry-over".
//   - TIME: every service has an AMP (time per case = time_taken + time_unit
//     on the service). While allocating, the page shows a per-employee
//     "Allocation Time" strip, a "Time" column on every case row, the total
//     time next to every count row, and the employee's current time next to
//     their name in the dropdowns.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 10;
const MOBILE_BREAKPOINT = 768;
// Sent to each employee after allocation. Intentionally has NO numbers.
const ALLOC_MESSAGE = "Your work has been allocated. Please login to check.";
// NEW (8h WARNING): an employee getting more than this many minutes of work
// triggers the warning popup when Allocate is pressed.
const MAX_WORK_MINUTES = 8 * 60;

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

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = {
    id: string;
    product_name: string;
    teams?: string[];
    // AMP — time per case
    time_taken?: number | string | null;
    time_unit?: "minutes" | "hours" | string | null;
};
type Employee = {
    id: string;
    name: string;
    employeeCode: string | null;
    team: string | null;
};
type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    subclientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    allocationStatus: "PENDING" | "ALLOCATED";
};
// Light version of a case — used only to work out each employee's
// total time across ALL pages (not just the 10 rows on screen).
type LightCase = {
    id: string;
    productId: string;
    assignedEmployeeId: string | null;
    // when it was allocated — used so the time card shows TODAY only
    allocatedAt: string | null;
};
// NEW (URGENT): a pending case that can be picked in the "Anything Urgent" popup
type UrgentCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    workDate: string;
};
// Count-only entry with its current allocations
type CountRow = {
    id: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    subclientName: string | null;
    workDate: string;
    quantity: number;
    fulfilledCount: number;
    pendingCount: number;
    allocatedTotal: number;
    unallocated: number;
    allocations: {
        employeeId: string;
        employeeName: string | null;
        quantity: number;
        fulfilledQuantity: number;
        allocatedAt?: string | null;
    }[];
};

function formatDisplayDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

// First day of the month of the given YYYY-MM-DD date. The pending backlog
// only carries over inside this month — on the 1st it starts fresh.
function monthStartOf(iso: string) {
    return /^\d{4}-\d{2}/.test(iso || "") ? `${iso.slice(0, 7)}-01` : "";
}

// local calendar day (YYYY-MM-DD) of a timestamp — used to tell whether an
// allocation was made on the selected day.
function localDayOf(ts?: string | null) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// minutes -> "2h 30m"
function formatMinutes(mins: number) {
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

type Props = {
    productId: string;
    onChangeProductId: (id: string) => void;
    workDate: string;
    onChangeWorkDate: (date: string) => void;
    hideHeader?: boolean;
    onCasesChanged?: () => void;
};

export default function TodaysAllocationCases({
    productId,
    onChangeProductId,
    workDate,
    onChangeWorkDate,
    hideHeader = false,
    onCasesChanged,
}: Props) {
    const isMobile = useIsMobile();
    const monthStart = monthStartOf(workDate);
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [attendanceByEmployee, setAttendanceByEmployee] = useState<
        Record<string, "PRESENT" | "ABSENT" | "LEAVE" | "HALF_DAY">
    >({});
    const fetchAttendance = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/attendance?date=${workDate}`);
            const json = await res.json();
            if (!res.ok || !json.success) return;
            const next: Record<string, "PRESENT" | "ABSENT" | "LEAVE" | "HALF_DAY"> = {};
            (json.data || []).forEach((a: any) => {
                if (["PRESENT", "ABSENT", "LEAVE", "HALF_DAY"].includes(a.status)) {
                    next[a.employeeId] = a.status;
                }
            });
            setAttendanceByEmployee(next);
        } catch {
            setAttendanceByEmployee({});
        }
    }, [workDate]);
    useEffect(() => {
        fetchAttendance();
    }, [fetchAttendance]);

    const [externalMemberIds, setExternalMemberIds] = useState<Set<string>>(new Set());
    const fetchExternalMembers = useCallback(async () => {
        if (!productId) {
            setExternalMemberIds(new Set());
            return;
        }
        try {
            const res = await authFetch(
                `${API_BASE}/api/external-members?productId=${productId}&workDate=${workDate}`
            );
            const json = await res.json();
            setExternalMemberIds(res.ok && json.success ? new Set(json.data || []) : new Set());
        } catch {
            setExternalMemberIds(new Set());
        }
    }, [productId, workDate]);
    useEffect(() => {
        fetchExternalMembers();
    }, [fetchExternalMembers]);

    const [cases, setCases] = useState<ServiceCase[]>([]);
    // every case of this service for the month (all pages) — light rows
    const [allCases, setAllCases] = useState<LightCase[]>([]);
    // count-only rows (backlog included) + the unsaved per-employee quantities
    const [countRows, setCountRows] = useState<CountRow[]>([]);
    const [countsLoading, setCountsLoading] = useState(true);
    // countDraft[countId][employeeId] = TOTAL quantity typed for that employee (unsaved)
    const [countDraft, setCountDraft] = useState<Record<string, Record<string, number>>>({});
    // totals of case-number cases still pending (this month up to the
    // selected date, and on the selected date alone) for the summary strip.
    const [caseSummary, setCaseSummary] = useState({ monthPending: 0, todayPending: 0 });

    const [externalMembersByProduct, setExternalMembersByProduct] = useState<
        Record<string, Set<string>>
    >({});
    useEffect(() => {
        // include product ids of count rows too, not just cases
        const distinctProductIds = [
            ...new Set(
                [...cases.map((c) => c.productId), ...countRows.map((c) => c.productId)].filter(
                    Boolean
                )
            ),
        ];
        if (distinctProductIds.length === 0) return;
        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                distinctProductIds.map(async (pid) => {
                    try {
                        const res = await authFetch(
                            `${API_BASE}/api/external-members?productId=${pid}&workDate=${workDate}`
                        );
                        const json = await res.json();
                        return [
                            pid,
                            new Set<string>(res.ok && json.success ? json.data || [] : []),
                        ] as const;
                    } catch {
                        return [pid, new Set<string>()] as const;
                    }
                })
            );
            if (!cancelled) {
                setExternalMembersByProduct(Object.fromEntries(entries));
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cases, countRows, workDate]);

    // service AMP in MINUTES (time_taken, converted if the unit is hours)
    const ampOf = useCallback(
        (pid: string | null | undefined) => {
            if (!pid) return 0;
            const p = products.find((x) => String(x.id) === String(pid));
            const t = Number(p?.time_taken);
            if (!t || Number.isNaN(t)) return 0;
            return p?.time_unit === "hours" ? t * 60 : t;
        },
        [products]
    );

    // Strict team-based eligibility per service (same as before).
    const getEligibleEmployeesForProduct = useCallback(
        (pid: string) => {
            const product = products.find((p) => String(p.id) === String(pid)) || null;
            const productTeams = (product?.teams || [])
                .map((t) => (t || "").trim())
                .filter(Boolean);
            const teamMatched =
                productTeams.length === 0
                    ? employees
                    : employees.filter((e) => {
                          const allowed = new Set(productTeams.map((t) => t.toLowerCase()));
                          return e.team && allowed.has(e.team.trim().toLowerCase());
                      });
            const externalIdsForProduct = externalMembersByProduct[pid] || new Set<string>();
            return employees.filter((e) => {
                const att = attendanceByEmployee[e.id];
                if (att === "ABSENT" || att === "LEAVE") return false;
                const isTeamMatched = teamMatched.some((t) => t.id === e.id);
                const isExternalMember = externalIdsForProduct.has(e.id);
                return isTeamMatched || isExternalMember;
            });
        },
        [products, employees, attendanceByEmployee, externalMembersByProduct]
    );

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "ALLOCATED">("");
    const [page, setPage] = useState(1);
    // like Case Register — "Counts" and "Cases" are separate views,
    // only the selected one shows.
    const [view, setView] = useState<"counts" | "cases">("cases");
    const [totalCases, setTotalCases] = useState(0);
    const [searchInput, setSearchInput] = useState("");
    const [searchText, setSearchText] = useState("");
    useEffect(() => {
        const t = setTimeout(() => setSearchText(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const [allocatingId, setAllocatingId] = useState<string | null>(null);
    const [pendingSelection, setPendingSelection] = useState<Record<string, string>>({});
    const [autoRunning, setAutoRunning] = useState(false);
    const [autoResult, setAutoResult] = useState<{
        allocatedCount: number;
        perEmployee: { employeeId: string; employeeName: string | null; caseCount: number }[];
    } | null>(null);
    // preview summary for the count-only split
    const [countAutoResult, setCountAutoResult] = useState<{
        allocatedCount: number;
        perEmployee: { employeeId: string; quantity: number }[];
    } | null>(null);
    const [toast, setToast] = useState("");
    // NEW (NOTIFY TOGGLE): ON/OFF lives in the header bell, which saves it
    // in localStorage. This page just reads it when it is about to send.
    const isNotifyOn = () => {
        try {
            return localStorage.getItem("allocNotifyEnabled") !== "false";
        } catch {
            return true;
        }
    };
    // Adds a line to the header bell's notification list (kept in
    // localStorage "allocNotifyLog", last 20 only) and tells the header.
    const logNotify = (text: string, kind: "ok" | "off" | "fail" = "ok") => {
        try {
            const old = JSON.parse(localStorage.getItem("allocNotifyLog") || "[]");
            const list = Array.isArray(old) ? old : [];
            list.unshift({ id: Date.now() + Math.random(), text, kind, time: Date.now() });
            localStorage.setItem("allocNotifyLog", JSON.stringify(list.slice(0, 20)));
        } catch {
            /* ignore storage errors */
        }
        window.dispatchEvent(new Event("allocNotifyLogChanged"));
    };
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [autoPreviewCaseIds, setAutoPreviewCaseIds] = useState<string[]>([]);
    const [successPopup, setSuccessPopup] = useState<{ count: number } | null>(null);
    // Result of the employee mail, shown inside the "Allocated successfully"
    // popup so the notification status is visible in the alert too.
    const [notifyStatus, setNotifyStatus] = useState<{
        kind: "sending" | "ok" | "off" | "fail";
        text: string;
    } | null>(null);
    // NEW (8h WARNING): popup state
    const [overloadOpen, setOverloadOpen] = useState(false);
    const [showOverloadList, setShowOverloadList] = useState(false);
    // NEW (URGENT): "Anything Urgent" popup state
    const [urgentOpen, setUrgentOpen] = useState(false);
    const [urgentCases, setUrgentCases] = useState<UrgentCase[]>([]);
    const [urgentLoading, setUrgentLoading] = useState(false);
    const [urgentSelected, setUrgentSelected] = useState<string[]>([]); // case ids
    const [urgentEmp, setUrgentEmp] = useState<Record<string, string>>({}); // caseId -> employeeId
    const [urgentPickerOpen, setUrgentPickerOpen] = useState(false);
    const [urgentSearch, setUrgentSearch] = useState("");
    const [urgentSaving, setUrgentSaving] = useState(false);
    const [urgentError, setUrgentError] = useState("");
    // FIX (URGENT EMPLOYEES): External Members of EVERY service that has an
    // urgent case (productId -> employee ids). Loaded when the popup opens,
    // because the page itself only loads them for the selected service.
    const [urgentExternal, setUrgentExternal] = useState<Record<string, Set<string>>>({});

    // FIX (URGENT EMPLOYEES): everyone mapped to this case's service —
    // team-matched employees AND external members (internal or external),
    // except those marked Absent / Leave for the date.
    const getUrgentEmployees = useCallback(
        (pid: string) => {
            const base = getEligibleEmployeesForProduct(pid);
            const ext = urgentExternal[pid];
            if (!ext || ext.size === 0) return base;
            const have = new Set(base.map((e) => e.id));
            const extra = employees.filter(
                (e) =>
                    ext.has(e.id) &&
                    !have.has(e.id) &&
                    attendanceByEmployee[e.id] !== "ABSENT" &&
                    attendanceByEmployee[e.id] !== "LEAVE"
            );
            return [...base, ...extra];
        },
        [getEligibleEmployeesForProduct, urgentExternal, employees, attendanceByEmployee]
    );

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    const fetchProducts = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await res.json();
            if (res.ok) setProducts(json.data || []);
        } catch (err) {
            console.error("Failed to fetch products:", err);
        }
    }, []);

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/employees`);
            const json = await res.json();
            if (!res.ok) return;
            setEmployees(Array.isArray(json) ? json : json.data || []);
        } catch (err) {
            console.error("Failed to fetch employees:", err);
        }
    }, []);

    const fetchCases = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("pageSize", String(PAGE_SIZE));
            if (productId) params.set("productId", productId);
            if (workDate) params.set("workDate", workDate);
            params.set("includeBacklog", "true");
            // backlog only from the same month (new month = fresh start)
            if (monthStart) params.set("workDateFrom", monthStart);
            if (statusFilter) params.set("allocationStatus", statusFilter);
            if (searchText) params.set("search", searchText);

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            const rows: ServiceCase[] = json.data || [];
            setCases(rows);
            setTotalCases(json.pagination?.total ?? rows.length);
            setPendingSelection((prev) => {
                const next = { ...prev };
                rows.forEach((c) => {
                    if (!(c.id in next)) next[c.id] = c.assignedEmployeeId || "";
                });
                return next;
            });
        } catch (err: any) {
            setError(err?.message || "Failed to load cases.");
        } finally {
            setLoading(false);
        }
    }, [page, productId, workDate, monthStart, statusFilter, searchText]);

    // loads EVERY case of this service for the month (all pages, light
    // fields only) so each employee's time is correct even for cases that
    // are not on the page currently on screen.
    const fetchAllCases = useCallback(async () => {
        if (!productId || !workDate) {
            setAllCases([]);
            return;
        }
        try {
            const out: LightCase[] = [];
            for (let p = 1; p <= 30; p++) {
                const params = new URLSearchParams();
                params.set("page", String(p));
                params.set("pageSize", "100");
                params.set("productId", productId);
                params.set("workDate", workDate);
                params.set("includeBacklog", "true");
                if (monthStart) params.set("workDateFrom", monthStart);
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success) break;
                const rows: any[] = json.data || [];
                rows.forEach((r) =>
                    out.push({
                        id: r.id,
                        productId: String(r.productId),
                        assignedEmployeeId: r.assignedEmployeeId || null,
                        allocatedAt: r.allocatedAt || null,
                    })
                );
                const totalPages = json.pagination?.totalPages ?? 1;
                if (p >= totalPages || rows.length === 0) break;
            }
            setAllCases(out);
        } catch {
            setAllCases([]);
        }
    }, [productId, workDate, monthStart]);

    // how many case-number cases are still PENDING — this month up to the
    // selected date, and on the selected date alone. Only the totals are
    // needed, so pageSize=1 and we read pagination.total.
    const fetchCaseSummary = useCallback(async () => {
        if (!productId || !workDate) return;
        const build = (extra: Record<string, string>) => {
            const p = new URLSearchParams();
            p.set("page", "1");
            p.set("pageSize", "1");
            p.set("productId", productId);
            p.set("allocationStatus", "PENDING");
            Object.entries(extra).forEach(([k, v]) => p.set(k, v));
            return p.toString();
        };
        try {
            const [monthRes, todayRes] = await Promise.all([
                authFetch(
                    `${API_BASE}/api/service-cases?${build({
                        workDateFrom: monthStart,
                        workDateTo: workDate,
                    })}`
                ),
                authFetch(`${API_BASE}/api/service-cases?${build({ workDate })}`),
            ]);
            const [monthJson, todayJson] = await Promise.all([monthRes.json(), todayRes.json()]);
            setCaseSummary({
                monthPending: monthJson?.success ? (monthJson.pagination?.total ?? 0) : 0,
                todayPending: todayJson?.success ? (todayJson.pagination?.total ?? 0) : 0,
            });
        } catch {
            setCaseSummary({ monthPending: 0, todayPending: 0 });
        }
    }, [productId, workDate, monthStart]);

    // count-only rows for this service/date (+ older unfinished ones of
    // the SAME month), oldest first.
    const fetchCounts = useCallback(async () => {
        setCountsLoading(true);
        try {
            const params = new URLSearchParams();
            if (productId) params.set("productId", productId);
            if (workDate) params.set("workDate", workDate);
            const res = await authFetch(
                `${API_BASE}/api/service-cases/count-allocations?${params.toString()}`
            );
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            const rows: CountRow[] = (json.data || [])
                .filter((c: CountRow) => !monthStart || c.workDate >= monthStart)
                .sort((a: CountRow, b: CountRow) => a.workDate.localeCompare(b.workDate));
            setCountRows(rows);
        } catch (err) {
            console.error("Failed to fetch count entries:", err);
            setCountRows([]);
        } finally {
            setCountsLoading(false);
        }
    }, [productId, workDate, monthStart]);

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
    }, [fetchProducts, fetchEmployees]);

    const autoSelectedRef = useRef(false);

    useEffect(() => {
        if (autoSelectedRef.current) {
            autoSelectedRef.current = false;
            return;
        }
        if (!productId) return;
        fetchProducts();
        fetchEmployees();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productId]);

    useEffect(() => {
        if (!productId && products.length > 0) {
            autoSelectedRef.current = true;
            onChangeProductId(products[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [products]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    useEffect(() => {
        fetchCaseSummary();
    }, [fetchCaseSummary]);

    useEffect(() => {
        fetchAllCases();
    }, [fetchAllCases]);

    useEffect(() => {
        if (!productId) return;
        fetchCounts();
    }, [fetchCounts, productId]);

    const selectedProduct = useMemo(
        () => products.find((p) => String(p.id) === String(productId)) || null,
        [products, productId]
    );
    const eligibleEmployees = useMemo(() => {
        const productTeams = (selectedProduct?.teams || [])
            .map((t) => (t || "").trim())
            .filter(Boolean);
        const teamMatched =
            productTeams.length === 0
                ? employees
                : employees.filter((e) => {
                      const allowed = new Set(productTeams.map((t) => t.toLowerCase()));
                      return e.team && allowed.has(e.team.trim().toLowerCase());
                  });
        return employees.filter((e) => {
            const att = attendanceByEmployee[e.id];
            if (att === "ABSENT" || att === "LEAVE") return false;
            const isTeamMatched = teamMatched.some((t) => t.id === e.id);
            const isExplicitlyPresent = att === "PRESENT" || att === "HALF_DAY";
            const isExternalMember = externalMemberIds.has(e.id);
            return isTeamMatched || isExplicitlyPresent || isExternalMember;
        });
    }, [employees, selectedProduct, attendanceByEmployee, externalMemberIds]);

    useEffect(() => {
        setPage(1);
        setAutoResult(null);
        setCountAutoResult(null);
        setAutoPreviewCaseIds([]);
    }, [productId, workDate, statusFilter, searchText]);

    // Unsaved count quantities belong to the service/date they were typed for.
    useEffect(() => {
        setCountDraft({});
    }, [productId, workDate]);

    // ---- count helpers ----
    const savedQty = (c: CountRow, empId: string) =>
        c.allocations.find((a) => a.employeeId === empId)?.quantity || 0;
    const fulfilledQty = (c: CountRow, empId: string) =>
        c.allocations.find((a) => a.employeeId === empId)?.fulfilledQuantity || 0;
    const draftQty = (c: CountRow, empId: string) =>
        countDraft[c.id]?.[empId] ?? savedQty(c, empId);

    // Employees shown for a count row: eligible ones + anyone already allocated.
    const employeesForCount = (c: CountRow): Employee[] => {
        const eligible = getEligibleEmployeesForProduct(c.productId);
        const extra = c.allocations
            .filter((a) => !eligible.some((e) => e.id === a.employeeId))
            .map((a) => employees.find((e) => e.id === a.employeeId))
            .filter(Boolean) as Employee[];
        return [...extra, ...eligible];
    };
    const draftTotal = (c: CountRow) => {
        const ids = new Set<string>([
            ...c.allocations.map((a) => a.employeeId),
            ...Object.keys(countDraft[c.id] || {}),
        ]);
        let t = 0;
        ids.forEach((id) => (t += draftQty(c, id)));
        return t;
    };

    // everything whose typed quantity differs from what's saved
    const changedCountItems = useMemo(() => {
        const items: { countId: string; employeeId: string; quantity: number }[] = [];
        countRows.forEach((c) => {
            const ids = new Set<string>([
                ...c.allocations.map((a) => a.employeeId),
                ...Object.keys(countDraft[c.id] || {}),
            ]);
            ids.forEach((empId) => {
                const d = countDraft[c.id]?.[empId];
                if (d !== undefined && d !== savedQty(c, empId)) {
                    items.push({ countId: c.id, employeeId: empId, quantity: d });
                }
            });
        });
        return items;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [countRows, countDraft]);

    // search + status filter for count rows (client-side)
    const visibleCountRows = useMemo(() => {
        const q = searchText.toLowerCase();
        return countRows.filter((c) => {
            if (statusFilter === "PENDING" && c.unallocated <= 0) return false;
            if (statusFilter === "ALLOCATED" && c.allocatedTotal <= 0) return false;
            if (!q) return true;
            return [
                c.productName,
                c.clientName,
                c.subclientName,
                c.workDate,
                formatDisplayDate(c.workDate),
                "count",
            ]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q));
        });
    }, [countRows, searchText, statusFilter]);

    // oldest date first (then by case number) so carried-over cases sit
    // at the top and are allocated before the new ones.
    const sortedCases = useMemo(
        () =>
            [...cases].sort(
                (a, b) =>
                    a.workDate.localeCompare(b.workDate) ||
                    a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true })
            ),
        [cases]
    );

    // DAILY time per employee (minutes) = case-number cases x AMP
    //      + count quantities x AMP, counting ONLY work allocated on the
    //      selected day (today). Older allocations are ignored, so the
    //      card starts again from 0 every new day. The monthly total lives
    //      on the Production Report page. Uses the unsaved dropdown picks
    //      (pendingSelection) and unsaved count boxes (countDraft), so it
    //      changes as the manager allocates / runs Smart Allocation.
    const employeeLoad = useMemo(() => {
        const map: Record<string, { cases: number; counts: number; mins: number }> = {};
        const add = (empId: string, cases: number, counts: number, mins: number) => {
            if (!empId) return;
            const cur = map[empId] || { cases: 0, counts: 0, mins: 0 };
            cur.cases += cases;
            cur.counts += counts;
            cur.mins += mins;
            map[empId] = cur;
        };

        allCases.forEach((c) => {
            const isUnsaved = c.id in pendingSelection;
            const emp = isUnsaved ? pendingSelection[c.id] : c.assignedEmployeeId || "";
            if (!emp) return;
            // saved allocation from an earlier day -> not part of today's time
            if (!isUnsaved && localDayOf(c.allocatedAt) !== workDate) return;
            add(emp, 1, 0, ampOf(c.productId));
        });

        countRows.forEach((c) => {
            const ids = new Set<string>([
                ...c.allocations.map((a) => a.employeeId),
                ...Object.keys(countDraft[c.id] || {}),
            ]);
            ids.forEach((empId) => {
                const draft = countDraft[c.id]?.[empId];
                let q: number;
                if (draft !== undefined) {
                    q = draft;
                } else {
                    const a = c.allocations.find((x) => x.employeeId === empId);
                    // saved quantity counts only if it was allocated on this day
                    // (an old server that sends no allocatedAt at all -> keep counting it)
                    q =
                        a && (a.allocatedAt === undefined || localDayOf(a.allocatedAt) === workDate)
                            ? a.quantity || 0
                            : 0;
                }
                if (q > 0) add(empId, 0, q, q * ampOf(c.productId));
            });
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCases, pendingSelection, countRows, countDraft, ampOf, workDate]);

    const loadLabel = (empId: string) => {
        const l = employeeLoad[empId];
        return l && l.mins > 0 ? ` (${formatMinutes(l.mins)})` : "";
    };

    // NEW (8h WARNING): employees whose live time (incl. unsaved picks)
    // is above 8 hours, highest first.
    const overloadedEmployees = useMemo(
        () =>
            employees
                .filter((e) => (employeeLoad[e.id]?.mins || 0) > MAX_WORK_MINUTES)
                .map((e) => ({
                    id: e.id,
                    name: e.name,
                    mins: employeeLoad[e.id].mins,
                    total: employeeLoad[e.id].cases + employeeLoad[e.id].counts,
                }))
                .sort((a, b) => b.mins - a.mins),
        [employees, employeeLoad]
    );

    // summary strip numbers — everything still to allocate, split into
    // today (selected date) and carried-over (earlier days of the month).
    const summary = useMemo(() => {
        const countsAll = countRows.reduce((s, c) => s + Math.max(0, c.unallocated), 0);
        const countsToday = countRows
            .filter((c) => c.workDate === workDate)
            .reduce((s, c) => s + Math.max(0, c.unallocated), 0);
        const casesToday = caseSummary.todayPending;
        const casesCarry = Math.max(0, caseSummary.monthPending - caseSummary.todayPending);
        const countsCarry = Math.max(0, countsAll - countsToday);
        const total = casesToday + countsToday + casesCarry + countsCarry;
        return {
            today: casesToday + countsToday,
            carry: casesCarry + countsCarry,
            total,
            // time still to allocate (all of it belongs to the selected service)
            totalMins: total * ampOf(productId),
        };
    }, [countRows, caseSummary, workDate, ampOf, productId]);

    const handleManualAllocate = async (caseId: string, employeeId: string) => {
        setAllocatingId(caseId);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${caseId}/allocate`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ employeeId: employeeId || null }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to allocate");
            setCases((prev) =>
                prev.map((c) =>
                    c.id === caseId
                        ? {
                              ...c,
                              assignedEmployeeId: json.data.assignedEmployeeId,
                              assignedEmployeeName: json.data.assignedEmployeeName,
                              allocationStatus: json.data.allocationStatus,
                          }
                        : c
                )
            );
            setPendingSelection((prev) => ({
                ...prev,
                [caseId]: json.data.assignedEmployeeId || "",
            }));
            onCasesChanged?.();
            return true;
        } catch (err: any) {
            showToast(err?.message || `Failed to allocate ${caseId}.`);
            return false;
        } finally {
            setAllocatingId(null);
        }
    };

    const [bulkSaving, setBulkSaving] = useState(false);
    const changedOnPage = cases
        .filter((c) => {
            const picked = pendingSelection[c.id] ?? (c.assignedEmployeeId || "");
            return picked !== (c.assignedEmployeeId || "");
        })
        .map((c) => c.id);
    const changedCaseIds = Array.from(new Set([...changedOnPage, ...autoPreviewCaseIds]));
    const changedCountTotal = changedCountItems.length;
    const totalChanged = changedCaseIds.length + changedCountTotal;

    // NEW: sends the "work allocated" message. Only employee ids go to the
    // server (no case counts / details) and every employee appears ONCE, so
    // an employee who got many cases still receives a single message.
    const notifyEmployees = async (employeeIds: string[], overloadEmployeeIds: string[] = []) => {
        const unique = [...new Set(employeeIds.filter(Boolean))];
        if (unique.length === 0) {
            setNotifyStatus(null);
            return;
        }
        if (!isNotifyOn()) {
            // notifications are turned OFF
            logNotify(`Notifications OFF. Mail not sent to ${unique.length} employee(s).`, "off");
            setNotifyStatus({
                kind: "off",
                text: `Notifications are OFF. Mail not sent to ${unique.length} employee(s).`,
            });
            return;
        }
        setNotifyStatus({
            kind: "sending",
            text: `Sending notification to ${unique.length} employee(s)…`,
        });
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/notify-allocation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeIds: unique,
                    workDate,
                    // NEW: people above 8 hours who just got new work
                    overloadEmployeeIds: [...new Set(overloadEmployeeIds.filter(Boolean))],
                    message: ALLOC_MESSAGE,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "failed");
            logNotify(`Work allocated mail sent to ${unique.length} employee(s).`);
            setNotifyStatus({
                kind: "ok",
                text: `Notification sent to ${unique.length} employee(s).`,
            });
        } catch {
            logNotify("Allocated, but the mail could not be sent.", "fail");
            setNotifyStatus({
                kind: "fail",
                text: "Allocated, but the notification could not be sent.",
            });
            showToast("Allocated, but the message could not be sent.");
        }
    };

    // ------------------------------------------------------------
    // NEW (URGENT): "Anything Urgent" popup
    // ------------------------------------------------------------
    // every PENDING case (all services, this date + this month's backlog)
    const loadUrgentCases = async () => {
        setUrgentLoading(true);
        try {
            const out: UrgentCase[] = [];
            for (let p = 1; p <= 30; p++) {
                const params = new URLSearchParams();
                params.set("page", String(p));
                params.set("pageSize", "100");
                if (workDate) params.set("workDate", workDate);
                params.set("includeBacklog", "true");
                if (monthStart) params.set("workDateFrom", monthStart);
                params.set("allocationStatus", "PENDING");
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json?.message || "Failed to load cases.");
                const rows: any[] = json.data || [];
                rows.forEach((r) =>
                    out.push({
                        id: r.id,
                        caseNumber: String(r.caseNumber ?? ""),
                        productId: String(r.productId),
                        productName: r.productName ?? null,
                        clientName: r.clientName ?? null,
                        workDate: r.workDate,
                    })
                );
                const totalPages = json.pagination?.totalPages ?? 1;
                if (p >= totalPages || rows.length === 0) break;
            }
            out.sort((a, b) =>
                a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true })
            );
            setUrgentCases(out);

            // FIX (URGENT EMPLOYEES): load the External Members of EVERY
            // service that has an urgent case (not only the service selected
            // on the page), so internal AND external employees all show up.
            const urgentProductIds = [...new Set(out.map((c) => c.productId).filter(Boolean))];
            const entries = await Promise.all(
                urgentProductIds.map(async (pid) => {
                    try {
                        const res = await authFetch(
                            `${API_BASE}/api/external-members?productId=${pid}&workDate=${workDate}`
                        );
                        const json = await res.json();
                        return [
                            pid,
                            new Set<string>(res.ok && json.success ? json.data || [] : []),
                        ] as const;
                    } catch {
                        return [pid, new Set<string>()] as const;
                    }
                })
            );
            setUrgentExternal(Object.fromEntries(entries));
        } catch (err: any) {
            setUrgentCases([]);
            setUrgentError(err?.message || "Failed to load cases.");
        } finally {
            setUrgentLoading(false);
        }
    };

    const openUrgent = () => {
        setUrgentSelected([]);
        setUrgentEmp({});
        setUrgentSearch("");
        setUrgentError("");
        setUrgentPickerOpen(true);
        setUrgentOpen(true);
        void loadUrgentCases();
    };

    const closeUrgent = () => {
        if (urgentSaving) return;
        setUrgentOpen(false);
        setUrgentPickerOpen(false);
    };

    // tick / untick a case. A newly ticked case gets the LEAST BUSY eligible
    // employee pre-filled (counting what is already picked in this popup);
    // the manager can change it.
    const toggleUrgentCase = (id: string) => {
        if (urgentSelected.includes(id)) {
            setUrgentSelected((prev) => prev.filter((x) => x !== id));
            setUrgentEmp((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            return;
        }
        const c = urgentCases.find((x) => x.id === id);
        if (!c) return;
        setUrgentSelected((prev) => [...prev, id]);
        setUrgentEmp((prev) => {
            const eligible = getUrgentEmployees(c.productId);
            if (eligible.length === 0) return prev;
            const loadOf = (empId: string) =>
                (employeeLoad[empId]?.mins || 0) +
                Object.entries(prev).reduce(
                    (sum, [cid, eid]) =>
                        eid === empId
                            ? sum + ampOf(urgentCases.find((x) => x.id === cid)?.productId)
                            : sum,
                    0
                );
            const best = [...eligible].sort((a, b) => loadOf(a.id) - loadOf(b.id))[0];
            return { ...prev, [id]: best.id };
        });
    };

    // one mail per employee who got an urgent case (the server reads the
    // employee from the saved case, so only the case ids are sent)
    const notifyUrgent = async (caseIds: string[]) => {
        if (caseIds.length === 0) return;
        if (!isNotifyOn()) {
            // notifications are turned OFF
            logNotify(
                `Notifications OFF. Urgent mail not sent (${caseIds.length} case(s)).`,
                "off"
            );
            return;
        }
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/notify-urgent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ caseIds }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "failed");
            logNotify(`Urgent mail sent for ${caseIds.length} case(s).`);
        } catch {
            logNotify("Allocated, but the urgent mail could not be sent.", "fail");
            showToast("Allocated, but the urgent mail could not be sent.");
        }
    };

    const handleUrgentAllocate = async () => {
        if (urgentSelected.length === 0 || urgentSaving) return;
        if (urgentSelected.some((id) => !urgentEmp[id])) {
            setUrgentError("Please pick an employee for every selected case.");
            return;
        }
        setUrgentError("");
        setUrgentSaving(true);
        try {
            const results = await Promise.all(
                urgentSelected.map((id) => handleManualAllocate(id, urgentEmp[id]))
            );
            const okIds = urgentSelected.filter((_, i) => results[i]);
            const failedIds = urgentSelected.filter((_, i) => !results[i]);

            if (okIds.length > 0) {
                void notifyUrgent(okIds);
                fetchCases();
                fetchCaseSummary();
                fetchAllCases();
            }

            if (failedIds.length > 0) {
                // keep the popup open with only the ones that did not save
                setUrgentCases((prev) => prev.filter((c) => !okIds.includes(c.id)));
                setUrgentSelected(failedIds);
                setUrgentError(
                    `${failedIds.length} case(s) could not be allocated. Please try again.`
                );
                if (okIds.length > 0) showToast(`${okIds.length} urgent case(s) allocated.`);
            } else {
                setUrgentOpen(false);
                setUrgentPickerOpen(false);
                showToast(
                    isNotifyOn()
                        ? `${okIds.length} urgent case(s) allocated. Employees have been notified.`
                        : `${okIds.length} urgent case(s) allocated. Notifications are OFF.`
                );
            }
        } finally {
            setUrgentSaving(false);
        }
    };

    const urgentFiltered = useMemo(() => {
        const q = urgentSearch.trim().toLowerCase();
        if (!q) return urgentCases;
        return urgentCases.filter((c) =>
            [c.caseNumber, c.productName, c.clientName].some((v) =>
                (v || "").toLowerCase().includes(q)
            )
        );
    }, [urgentCases, urgentSearch]);

    // NEW (8h WARNING): the Allocate button calls this first. If anyone is
    // above 8 hours the warning popup opens; otherwise it allocates directly.
    const handleAllocateClick = () => {
        if (totalChanged === 0) return;
        if (overloadedEmployees.length > 0) {
            setShowOverloadList(false);
            setOverloadOpen(true);
            return;
        }
        handleAllocateAll();
    };

    const handleAllocateAll = async () => {
        if (totalChanged === 0) return;

        // validate the count totals BEFORE saving anything.
        // Before, the case-number allocations were saved first and this
        // check ran afterwards — so a failed check left a half-saved state
        // (cases allocated, counts not).
        for (const c of countRows) {
            if (draftTotal(c) > c.quantity) {
                showToast(
                    `${c.productName || "Service"}: allocated ${draftTotal(c)} is more than ${c.quantity}.`
                );
                return;
            }
        }

        setBulkSaving(true);
        try {
            let okCount = 0;
            // employees who got NEW work in this press (a Set = one message each)
            const notifyIds = new Set<string>();

            // A) cases with case numbers
            if (changedCaseIds.length > 0) {
                const results = await Promise.all(
                    changedCaseIds.map((caseId) =>
                        handleManualAllocate(caseId, pendingSelection[caseId] ?? "")
                    )
                );
                okCount += results.filter(Boolean).length;

                // message only those who newly got a case (failed saves are skipped)
                changedCaseIds.forEach((id, i) => {
                    if (!results[i]) return;
                    const emp = pendingSelection[id];
                    const before = cases.find((c) => c.id === id)?.assignedEmployeeId || "";
                    if (emp && emp !== before) notifyIds.add(emp);
                });
            }

            // B) count-only entries
            if (changedCountItems.length > 0) {
                const res = await authFetch(
                    `${API_BASE}/api/service-cases/count-allocations/save`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ items: changedCountItems }),
                    }
                );
                const json = await res.json();
                if (!res.ok || !json.success) {
                    showToast(json?.message || "Failed to save count allocations.");
                } else {
                    const countSavedUnits = changedCountItems.reduce(
                        (s, i) =>
                            s +
                            Math.max(
                                0,
                                i.quantity -
                                    savedQty(
                                        countRows.find((c) => c.id === i.countId)!,
                                        i.employeeId
                                    )
                            ),
                        0
                    );
                    okCount += countSavedUnits;

                    // message those whose quantity went UP
                    changedCountItems.forEach((i) => {
                        const row = countRows.find((c) => c.id === i.countId);
                        if (row && i.quantity > savedQty(row, i.employeeId)) {
                            notifyIds.add(i.employeeId);
                        }
                    });

                    setCountDraft({});
                    fetchCounts();
                }
            }

            // one message per employee, right after the allocation is saved
            // NEW (NOTIFY OVERLOAD): of those who just got new work, who is
            // now above 8 hours (same live number the 8h warning uses)?
            const overloadIds = [...notifyIds].filter(
                (id) => (employeeLoad[id]?.mins || 0) > MAX_WORK_MINUTES
            );
            void notifyEmployees([...notifyIds], overloadIds);

            setAutoPreviewCaseIds([]);
            setAutoResult(null);
            setCountAutoResult(null);
            if (okCount > 0) {
                showToast(`${okCount} case(s) allocated.`);
                setSuccessPopup({ count: okCount });
                fetchCases();
                fetchCaseSummary();
                fetchAllCases();
                onCasesChanged?.();
            }
        } finally {
            setBulkSaving(false);
        }
    };

    const handleAutoAllocate = async () => {
        if (!productId) {
            showToast("Select a service first.");
            return;
        }
        setAutoRunning(true);
        setAutoResult(null);
        setCountAutoResult(null);
        try {
            const attRes = await authFetch(`${API_BASE}/api/attendance?date=${workDate}`);
            const attJson = await attRes.json();
            if (!attRes.ok || !attJson.success)
                throw new Error(attJson?.message || "Failed to load attendance");
            const unavailableIds = new Set(
                (attJson.data || [])
                    .filter((a: any) => a.status === "ABSENT" || a.status === "LEAVE")
                    .map((a: any) => a.employeeId)
            );
            const presentIds = eligibleEmployees
                .filter((e) => !unavailableIds.has(e.id))
                .map((e) => e.id);

            if (presentIds.length === 0) {
                showToast("No employees available to allocate to.");
                return;
            }

            let casesMsg = "";
            // what the case-number preview just gave each person — sent to the
            // count preview so the "extra" doesn't land on the same person twice
            const extraLoad: Record<string, number> = {};
            let casePreviewed = 0;
            let countPreviewed = 0;

            // A) cases with case numbers (preview only)
            try {
                const res = await authFetch(`${API_BASE}/api/service-cases/auto-allocate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ productId, workDate, employeeIds: presentIds }),
                });
                const json = await res.json();
                if (res.ok && json.success) {
                    setAutoResult(json.data);
                    (json.data?.perEmployee || []).forEach((p: any) => {
                        extraLoad[p.employeeId] = p.caseCount || 0;
                    });
                    const assignments: { caseId: string; employeeId: string }[] =
                        json.data?.assignments || [];
                    setPendingSelection((prev) => {
                        const next = { ...prev };
                        assignments.forEach((a) => {
                            next[a.caseId] = a.employeeId;
                        });
                        return next;
                    });
                    setAutoPreviewCaseIds(assignments.map((a) => a.caseId));
                    casePreviewed = assignments.length;
                    casesMsg = json.message || "";
                } else if (countRows.length === 0) {
                    throw new Error(json?.message || "Auto allocation failed");
                }
            } catch (e) {
                if (countRows.length === 0) throw e;
            }

            // B) count-only entries (preview only) — fills the quantity boxes
            const cRes = await authFetch(
                `${API_BASE}/api/service-cases/count-allocations/auto-preview`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productId,
                        workDate,
                        employeeIds: presentIds,
                        extraLoad,
                    }),
                }
            );
            const cJson = await cRes.json();
            if (cRes.ok && cJson.success) {
                // only rows of the current month are on screen — ignore any
                // preview row for an older month's count entry
                const shownCountIds = new Set(countRows.map((c) => c.id));
                const assignments: { countId: string; employeeId: string; quantity: number }[] = (
                    cJson.data?.assignments || []
                ).filter((a: any) => shownCountIds.has(a.countId));
                setCountDraft((prev) => {
                    const next = { ...prev };
                    assignments.forEach((a) => {
                        next[a.countId] = {
                            ...(next[a.countId] || {}),
                            [a.employeeId]: a.quantity,
                        };
                    });
                    return next;
                });
                setCountAutoResult({
                    allocatedCount: cJson.data?.allocatedCount || 0,
                    perEmployee: cJson.data?.perEmployee || [],
                });
                countPreviewed = cJson.data?.allocatedCount || 0;
            }

            if (casePreviewed === 0 && countPreviewed === 0) {
                showToast("Nothing pending to allocate.");
            } else {
                showToast(
                    casesMsg || "Distributed — review the boxes and press Allocate to confirm."
                );
            }
        } catch (err: any) {
            showToast(err?.message || "Auto allocation failed.");
        } finally {
            setAutoRunning(false);
        }
    };

    const handleClearAllocations = async () => {
        setClearConfirmOpen(false);
        setClearing(true);
        try {
            const allocatedIds: string[] = [];
            let fetchPage = 1;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const params = new URLSearchParams();
                params.set("page", String(fetchPage));
                params.set("pageSize", "100");
                if (productId) params.set("productId", productId);
                if (workDate) params.set("workDate", workDate);
                params.set("allocationStatus", "ALLOCATED");
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json?.message || "Failed to load allocated cases");
                const rows: ServiceCase[] = json.data || [];
                allocatedIds.push(...rows.map((c) => c.id));
                const totalPages = Math.ceil((json.pagination?.total ?? rows.length) / 100);
                if (fetchPage >= totalPages || rows.length === 0) break;
                fetchPage += 1;
            }

            if (allocatedIds.length > 0) {
                await Promise.all(
                    allocatedIds.map((id) =>
                        authFetch(`${API_BASE}/api/service-cases/${id}/allocate`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ employeeId: null }),
                        })
                    )
                );
            }

            // clear count allocations too (logged on the server)
            let clearedCounts = 0;
            const cRes = await authFetch(`${API_BASE}/api/service-cases/count-allocations/clear`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId, workDate }),
            });
            const cJson = await cRes.json();
            if (cRes.ok && cJson.success) clearedCounts = cJson.data?.cleared || 0;

            if (allocatedIds.length === 0 && clearedCounts === 0) {
                showToast("Nothing allocated for this service/date.");
                return;
            }

            showToast(
                `Cleared ${allocatedIds.length} case(s) and ${clearedCounts} count allocation(s).`
            );
            setAutoResult(null);
            setCountAutoResult(null);
            setPendingSelection({});
            setCountDraft({});
            setPage(1);
            fetchCases();
            fetchCaseSummary();
            fetchAllCases();
            fetchCounts();
            onCasesChanged?.();
        } catch (err: any) {
            showToast(err?.message || "Failed to clear allocations.");
        } finally {
            setClearing(false);
        }
    };

    const [refreshingLookups, setRefreshingLookups] = useState(false);
    const refreshLookups = async () => {
        setRefreshingLookups(true);
        try {
            await Promise.all([fetchProducts(), fetchEmployees()]);
            showToast("Services and employees refreshed.");
        } finally {
            setRefreshingLookups(false);
        }
    };

    const pendingCount =
        cases.filter((c) => c.allocationStatus === "PENDING").length +
        countRows.reduce((s, c) => s + Math.max(0, c.unallocated), 0);
    const allocatedCount =
        cases.filter((c) => c.allocationStatus === "ALLOCATED").length +
        countRows.reduce((s, c) => s + c.allocatedTotal, 0);

    const nameOf = (id: string) => employees.find((e) => e.id === id)?.name || "Unknown";

    const pendingCountsTotal = countRows.reduce((s, c) => s + c.pendingCount, 0);

    // employees shown in the time strip — everyone eligible for this
    // service plus anyone who already has work (even if not eligible now).
    const timeStripEmployees = useMemo(() => {
        const ids = new Set<string>(eligibleEmployees.map((e) => e.id));
        Object.keys(employeeLoad).forEach((id) => {
            if (employeeLoad[id].mins > 0 || employeeLoad[id].cases + employeeLoad[id].counts > 0)
                ids.add(id);
        });
        return employees
            .filter((e) => ids.has(e.id))
            .sort((a, b) => (employeeLoad[b.id]?.mins || 0) - (employeeLoad[a.id]?.mins || 0));
    }, [eligibleEmployees, employeeLoad, employees]);

    // One "Allocate" button, shown under whichever view (Counts / Cases) is open.
    // It saves BOTH the case dropdown picks and the count quantities.
    const allocateBar = (
        <div style={styles.bulkAllocateRow}>
            <button
                type="button"
                style={{
                    ...styles.allocateAllBtn,
                    opacity: bulkSaving || totalChanged === 0 ? 0.6 : 1,
                }}
                disabled={bulkSaving || totalChanged === 0}
                onClick={handleAllocateClick}
            >
                <i className="ti ti-check" />
                {bulkSaving
                    ? "Allocating…"
                    : totalChanged > 0
                      ? `Allocate (${totalChanged})`
                      : "Allocate"}
            </button>
        </div>
    );

    const actionButtons = (
        <>
            <button
                type="button"
                style={{
                    ...styles.autoBtn,
                    opacity: autoRunning || pendingCount === 0 ? 0.6 : 1,
                }}
                disabled={autoRunning || pendingCount === 0}
                onClick={handleAutoAllocate}
                title={pendingCount === 0 ? "Nothing pending" : "Smart Allocation"}
            >
                <i className="ti ti-bolt" />
                {autoRunning ? "Allocating…" : "Smart Allocation"}
            </button>
            <button
                type="button"
                style={{
                    ...styles.clearAllocBtn,
                    opacity: clearing || allocatedCount === 0 ? 0.6 : 1,
                    cursor: clearing || allocatedCount === 0 ? "not-allowed" : "pointer",
                }}
                disabled={clearing || allocatedCount === 0}
                onClick={() => setClearConfirmOpen(true)}
                title={
                    allocatedCount === 0
                        ? "Nothing allocated"
                        : "Unassign every allocated case/count for this service/date"
                }
            >
                <i className="ti ti-eraser" />
                {clearing ? "Clearing…" : "Clear"}
            </button>
            {/* NEW (URGENT) */}
            <button
                type="button"
                style={styles.urgentBtn}
                onClick={openUrgent}
                title="Allocate urgent cases right away and mail the employees"
            >
                <i className="ti ti-alarm" />
                Anything Urgent
            </button>
            <div style={{ marginLeft: "auto", minWidth: 220 }}>
                <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search case, client, service, date, status…"
                    style={styles.select}
                />
            </div>
        </>
    );

    const previewBox = (extraStyle?: CSSProperties) =>
        (autoResult || countAutoResult) && (
            <div style={{ ...styles.autoSummary, ...extraStyle }}>
                <strong>Preview:</strong>{" "}
                {autoResult && (
                    <>
                        <strong>{autoResult.allocatedCount}</strong> case(s) →{" "}
                        {autoResult.perEmployee
                            .map((e) => `${e.employeeName || "Unknown"} (${e.caseCount})`)
                            .join(", ")}
                        .{" "}
                    </>
                )}
                {countAutoResult && countAutoResult.allocatedCount > 0 && (
                    <>
                        <strong>{countAutoResult.allocatedCount}</strong> count case(s) →{" "}
                        {countAutoResult.perEmployee
                            .map((e) => `${nameOf(e.employeeId)} (${e.quantity})`)
                            .join(", ")}
                        .{" "}
                    </>
                )}
                Nothing is saved yet — review below and press <strong>Allocate</strong> to confirm.
            </div>
        );

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div
                style={{
                    ...styles.contentBody,
                    padding: isMobile ? "16px" : "20px 24px",
                }}
            >
                {!hideHeader && (
                    <>
                        <div style={styles.headerRow}>
                            <div style={styles.headerLeft}>
                                <div>
                                    <h2
                                        style={{
                                            ...styles.pageTitle,
                                            fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
                                        }}
                                    >
                                        Cases
                                    </h2>
                                    <p style={styles.headerSubtext}>
                                        Cases with a case number are allocated one by one. Entries
                                        logged as a count only ("20 cases pending") are split by
                                        quantity. Pending work from earlier days of the month is
                                        carried over and shown first — a new month starts fresh.
                                        Smart Allocation previews an even split across available
                                        employees — the extra case rotates, so whoever got it
                                        yesterday is last in line today. Every employee's time
                                        (cases × the service's AMP) is shown live while you
                                        allocate. Nothing is saved until you press Allocate, and
                                        then each employee who got new work is told once to login
                                        and check.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div style={styles.filterBar}>
                            <div>
                                <label style={styles.label}>Service</label>
                                <select
                                    style={styles.select}
                                    value={productId}
                                    onChange={(e) => onChangeProductId(e.target.value)}
                                >
                                    {products.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.product_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={styles.label}>Date</label>
                                <input
                                    type="date"
                                    style={styles.select}
                                    value={workDate}
                                    onChange={(e) => onChangeWorkDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Status</label>
                                <select
                                    style={styles.select}
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as any)}
                                >
                                    <option value="">All</option>
                                    <option value="PENDING">Pending</option>
                                    <option value="ALLOCATED">Allocated</option>
                                </select>
                            </div>
                            {actionButtons}
                        </div>

                        <p style={styles.eligibilityHint}>
                            {selectedProduct &&
                            (selectedProduct.teams || []).filter(Boolean).length > 0 ? (
                                <>
                                    Team-eligible for{" "}
                                    <strong>{selectedProduct.product_name}</strong> (
                                    {(selectedProduct.teams || []).filter(Boolean).join(", ")}):{" "}
                                    {eligibleEmployees.length === 0 ? (
                                        <span style={{ color: BRAND.red }}>
                                            no employees have a matching Team — check the Team field
                                            on the Employees page.
                                        </span>
                                    ) : (
                                        eligibleEmployees.map((e) => e.name).join(", ")
                                    )}
                                </>
                            ) : (
                                <>No team linked to this service — every employee is eligible.</>
                            )}{" "}
                            <button
                                type="button"
                                onClick={refreshLookups}
                                disabled={refreshingLookups}
                                style={styles.refreshLink}
                            >
                                <i
                                    className="ti ti-refresh"
                                    style={{ fontSize: fontSize.xs, display: "inline-block" }}
                                />
                                {refreshingLookups ? "Refreshing…" : "Refresh"}
                            </button>
                        </p>

                        {previewBox()}
                    </>
                )}

                {hideHeader && (
                    <div style={{ ...styles.filterBar, marginBottom: 12 }}>
                        {actionButtons}
                        {previewBox({ width: "100%" })}
                    </div>
                )}

                {error && <p style={styles.errorText}>{error}</p>}

                {/* total still to allocate = today's pending + carried-over pending */}
                <div style={styles.summaryBar}>
                    <div style={styles.summaryItemMain}>
                        <div style={styles.summaryNumMain}>{summary.total}</div>
                        <div style={styles.summaryLbl}>Total to allocate</div>
                        {summary.totalMins > 0 && (
                            <div style={styles.summaryTime}>{formatMinutes(summary.totalMins)}</div>
                        )}
                    </div>
                    <div style={styles.summaryEquals}>=</div>
                    <div style={styles.summaryItem}>
                        <div style={styles.summaryNum}>{summary.today}</div>
                        <div style={styles.summaryLbl}>Today ({formatDisplayDate(workDate)})</div>
                    </div>
                    <div style={styles.summaryEquals}>+</div>
                    <div style={styles.summaryItem}>
                        <div style={{ ...styles.summaryNum, color: BRAND.amber }}>
                            {summary.carry}
                        </div>
                        <div style={styles.summaryLbl}>Carried over (older, this month)</div>
                    </div>
                    <div style={styles.summaryNote}>
                        Month-wise: counting from {formatDisplayDate(monthStart)}. A new month
                        starts fresh — older months stay in history.
                    </div>
                </div>

                {/* live per-employee allocation time (cases x service AMP) */}
                <div style={styles.timeCard}>
                    <div style={styles.timeCardHeader}>
                        <span style={styles.sectionTitle}>
                            <i className="ti ti-clock" style={{ marginRight: 6 }} />
                            Allocation Time per Employee — Today ({formatDisplayDate(workDate)})
                        </span>
                        <span style={styles.smallMutedText}>
                            {ampOf(productId) > 0
                                ? `AMP: ${formatMinutes(ampOf(productId))} per case · updates live before you press Allocate`
                                : "This service has no AMP (time per case) set, so time can't be calculated."}
                        </span>
                    </div>
                    {timeStripEmployees.length === 0 ? (
                        <div style={styles.emptyNote}>No employees to show yet.</div>
                    ) : (
                        <div style={styles.timeGrid}>
                            {timeStripEmployees.map((emp) => {
                                const l = employeeLoad[emp.id] || { cases: 0, counts: 0, mins: 0 };
                                const total = l.cases + l.counts;
                                return (
                                    <div key={emp.id} style={styles.timeItem}>
                                        <div style={styles.timeEmpName}>{emp.name}</div>
                                        <div
                                            style={{
                                                ...styles.timeValue,
                                                color: l.mins > 0 ? BRAND.blue : BRAND.grey,
                                            }}
                                        >
                                            {l.mins > 0 ? formatMinutes(l.mins) : "0m"}
                                        </div>
                                        <div style={styles.smallMutedText}>
                                            {total} case{total === 1 ? "" : "s"}
                                            {l.counts > 0 && l.cases > 0
                                                ? ` (${l.cases} + ${l.counts} count)`
                                                : l.counts > 0
                                                  ? " (count)"
                                                  : ""}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Counts / Cases toggle — only the selected view shows */}
                <div style={styles.viewToggleRow}>
                    <button
                        type="button"
                        style={{
                            ...styles.viewToggleBtn,
                            ...(view === "counts" ? styles.viewToggleBtnActive : {}),
                        }}
                        onClick={() => setView("counts")}
                    >
                        Counts ({pendingCountsTotal})
                    </button>
                    <button
                        type="button"
                        style={{
                            ...styles.viewToggleBtn,
                            ...(view === "cases" ? styles.viewToggleBtnActive : {}),
                        }}
                        onClick={() => setView("cases")}
                    >
                        Cases ({totalCases})
                    </button>
                </div>

                {/* ============ B) COUNT-ONLY ENTRIES ============ */}
                {view === "counts" && (
                    <div style={styles.tableCard}>
                        <div style={styles.sectionTitleRow}>
                            <span style={styles.sectionTitle}>
                                Counts (no case number yet) — allocate by quantity
                            </span>
                            <span style={styles.countPill}>
                                {visibleCountRows.reduce((s, c) => s + c.pendingCount, 0)} pending
                            </span>
                        </div>
                        <div style={styles.tableScroll}>
                            <div style={styles.cgWrap}>
                                <div style={styles.cgHead}>
                                    <span>Client</span>
                                    <span>Sub-client</span>
                                    <span>Date</span>
                                    <span>Status</span>
                                    <span style={{ textAlign: "right" }}>Allocated</span>
                                </div>
                                {countsLoading ? (
                                    <div style={styles.emptyNote}>Loading counts…</div>
                                ) : visibleCountRows.length === 0 ? (
                                    <div style={styles.emptyNote}>
                                        No pending counts for this filter.
                                    </div>
                                ) : null}
                                {(() => {
                                    // group the counts by service so it reads in clean blocks
                                    const groups = new Map<string, CountRow[]>();
                                    visibleCountRows.forEach((c) => {
                                        const k = c.productName || "No service";
                                        if (!groups.has(k)) groups.set(k, []);
                                        groups.get(k)!.push(c);
                                    });
                                    const dots = [BRAND.blue, "#6C8EF5", BRAND.green, "#F59E0B"];
                                    return Array.from(groups.entries()).map(
                                        ([service, rows], gi) => {
                                            const gAlloc = rows.reduce(
                                                (t, r) => t + draftTotal(r),
                                                0
                                            );
                                            const gQty = rows.reduce((t, r) => t + r.quantity, 0);
                                            return (
                                                <div key={service} style={styles.cgGroup}>
                                                    <div style={styles.cgGroupHead}>
                                                        <span
                                                            style={{
                                                                ...styles.cgDot,
                                                                background: dots[gi % dots.length],
                                                            }}
                                                        />
                                                        <span style={styles.cgGroupName}>
                                                            {service}
                                                        </span>
                                                        <span style={styles.cgCountPill}>
                                                            {rows.length}{" "}
                                                            {rows.length === 1 ? "Case" : "Cases"}
                                                        </span>
                                                        <span style={{ flex: 1 }} />
                                                        <span style={styles.smallMutedText}>
                                                            Total Allocated
                                                        </span>
                                                        <span style={styles.cgGroupTotal}>
                                                            {gAlloc} / {gQty}
                                                        </span>
                                                    </div>
                                                    {rows.map((c, ri) => {
                                                        const total = draftTotal(c);
                                                        const left = c.quantity - total;
                                                        const over = left < 0;
                                                        const rowAmp = ampOf(c.productId);
                                                        return (
                                                            <div
                                                                key={c.id}
                                                                style={{
                                                                    ...styles.cgRowWrap,
                                                                    borderTop:
                                                                        ri === 0
                                                                            ? "none"
                                                                            : "1px solid #eef0f6",
                                                                }}
                                                            >
                                                                <div style={styles.cgRow}>
                                                                    <div style={styles.cgCell}>
                                                                        <span
                                                                            style={styles.cgClient}
                                                                        >
                                                                            {c.clientName || "—"}
                                                                        </span>
                                                                        <span
                                                                            style={
                                                                                styles.smallMutedText
                                                                            }
                                                                        >
                                                                            {c.pendingCount} cases
                                                                            {rowAmp > 0 &&
                                                                                ` · ${formatMinutes(c.pendingCount * rowAmp)}`}
                                                                        </span>
                                                                    </div>
                                                                    <div style={styles.cgText}>
                                                                        {c.subclientName || "—"}
                                                                    </div>
                                                                    <div style={styles.cgCell}>
                                                                        <span style={styles.cgText}>
                                                                            {c.workDate}
                                                                        </span>
                                                                        {c.workDate < workDate && (
                                                                            <span
                                                                                style={
                                                                                    styles.cgCarry
                                                                                }
                                                                            >
                                                                                ↻ Carry-over
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <span
                                                                            style={{
                                                                                ...styles.statusPill,
                                                                                background:
                                                                                    left === 0
                                                                                        ? "rgba(var(--brand-green-rgb),0.12)"
                                                                                        : "rgba(156,163,175,0.15)",
                                                                                color:
                                                                                    left === 0
                                                                                        ? BRAND.green
                                                                                        : BRAND.grey,
                                                                            }}
                                                                        >
                                                                            {left === 0
                                                                                ? "Allocated"
                                                                                : `${left} left`}
                                                                        </span>
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            ...styles.cgRight,
                                                                            color: over
                                                                                ? BRAND.red
                                                                                : "#767F92",
                                                                        }}
                                                                    >
                                                                        <strong
                                                                            style={{
                                                                                color: over
                                                                                    ? BRAND.red
                                                                                    : "#1B1F4B",
                                                                            }}
                                                                        >
                                                                            {total} / {c.quantity}
                                                                        </strong>
                                                                        <span
                                                                            style={
                                                                                styles.smallMutedText
                                                                            }
                                                                        >
                                                                            allocated
                                                                            {rowAmp > 0 &&
                                                                                ` · ${formatMinutes(total * rowAmp)}`}
                                                                            {c.fulfilledCount > 0 &&
                                                                                ` · ${c.fulfilledCount} submitted`}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div style={styles.cgEmpGrid}>
                                                                    {employeesForCount(c).map(
                                                                        (emp) => {
                                                                            const done =
                                                                                fulfilledQty(
                                                                                    c,
                                                                                    emp.id
                                                                                );
                                                                            const qty = draftQty(
                                                                                c,
                                                                                emp.id
                                                                            );
                                                                            return (
                                                                                <label
                                                                                    key={emp.id}
                                                                                    style={{
                                                                                        ...styles.cgEmpItem,
                                                                                        ...(qty > 0
                                                                                            ? styles.cgEmpItemOn
                                                                                            : {}),
                                                                                    }}
                                                                                >
                                                                                    <span
                                                                                        style={
                                                                                            styles.cgEmpName
                                                                                        }
                                                                                        title={
                                                                                            emp.name
                                                                                        }
                                                                                    >
                                                                                        {emp.name}
                                                                                    </span>
                                                                                    <input
                                                                                        type="number"
                                                                                        min={done}
                                                                                        max={
                                                                                            c.quantity
                                                                                        }
                                                                                        style={
                                                                                            styles.qtyInput
                                                                                        }
                                                                                        disabled={
                                                                                            bulkSaving
                                                                                        }
                                                                                        value={qty}
                                                                                        title={
                                                                                            done > 0
                                                                                                ? `${done} already submitted`
                                                                                                : undefined
                                                                                        }
                                                                                        onChange={(
                                                                                            e
                                                                                        ) => {
                                                                                            const v =
                                                                                                Math.max(
                                                                                                    done,
                                                                                                    Math.floor(
                                                                                                        Number(
                                                                                                            e
                                                                                                                .target
                                                                                                                .value
                                                                                                        ) ||
                                                                                                            0
                                                                                                    )
                                                                                                );
                                                                                            setCountDraft(
                                                                                                (
                                                                                                    prev
                                                                                                ) => ({
                                                                                                    ...prev,
                                                                                                    [c.id]:
                                                                                                        {
                                                                                                            ...(prev[
                                                                                                                c
                                                                                                                    .id
                                                                                                            ] ||
                                                                                                                {}),
                                                                                                            [emp.id]:
                                                                                                                v,
                                                                                                        },
                                                                                                })
                                                                                            );
                                                                                        }}
                                                                                    />
                                                                                    <span
                                                                                        style={
                                                                                            styles.cgEmpTime
                                                                                        }
                                                                                    >
                                                                                        {rowAmp >
                                                                                            0 &&
                                                                                        qty > 0
                                                                                            ? formatMinutes(
                                                                                                  qty *
                                                                                                      rowAmp
                                                                                              )
                                                                                            : ""}
                                                                                    </span>
                                                                                </label>
                                                                            );
                                                                        }
                                                                    )}
                                                                </div>
                                                                {over && (
                                                                    <p
                                                                        style={{
                                                                            ...styles.errorText,
                                                                            margin: "6px 0 0",
                                                                        }}
                                                                    >
                                                                        Allocated is {-left} more
                                                                        than the pending count.
                                                                    </p>
                                                                )}
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
                        {allocateBar}
                    </div>
                )}

                {/* ============ A) CASES WITH CASE NUMBERS ============ */}
                {view === "cases" && (
                    <div style={styles.tableCard}>
                        <div style={styles.tableScroll}>
                            <div style={styles.tableHeadRow}>
                                <span style={styles.colCase}>Case #</span>
                                <span style={styles.colClient}>Client</span>
                                <span style={styles.colSubclient}>Sub-Client</span>
                                <span style={styles.colService}>Service</span>
                                <span style={styles.colDate}>Date</span>
                                <span style={styles.colTime}>Time</span>
                                <span style={styles.colStatus}>Status</span>
                                <span style={styles.colAssign}>Allocate to</span>
                            </div>
                            {loading ? (
                                <div style={styles.emptyNote}>Loading cases…</div>
                            ) : sortedCases.length === 0 ? (
                                <div style={styles.emptyNote}>No cases found for this filter.</div>
                            ) : (
                                sortedCases.map((c) => {
                                    const rowAmp = ampOf(c.productId);
                                    return (
                                        <div key={c.id} style={styles.tableRow}>
                                            <span style={styles.colCase}>{c.caseNumber}</span>
                                            <span style={styles.colClient}>
                                                {c.clientName || "—"}
                                            </span>
                                            <span style={styles.colSubclient}>
                                                {c.subclientName || "—"}
                                            </span>
                                            <span style={styles.colService}>
                                                {c.productName || "—"}
                                            </span>
                                            <span style={styles.colDate}>
                                                {c.workDate}
                                                {c.workDate < workDate && (
                                                    <span style={styles.carryTag}>Carry-over</span>
                                                )}
                                            </span>
                                            <span style={styles.colTime}>
                                                {rowAmp > 0 ? formatMinutes(rowAmp) : "—"}
                                            </span>
                                            <span style={styles.colStatus}>
                                                <span
                                                    style={{
                                                        ...styles.statusPill,
                                                        background:
                                                            c.allocationStatus === "ALLOCATED"
                                                                ? "rgba(var(--brand-green-rgb),0.12)"
                                                                : "rgba(156,163,175,0.15)",
                                                        color:
                                                            c.allocationStatus === "ALLOCATED"
                                                                ? BRAND.green
                                                                : BRAND.grey,
                                                    }}
                                                >
                                                    {c.allocationStatus === "ALLOCATED"
                                                        ? "Allocated"
                                                        : "Pending"}
                                                </span>
                                            </span>
                                            <span style={styles.colAssign}>
                                                <select
                                                    style={styles.assignSelect}
                                                    value={
                                                        pendingSelection[c.id] ??
                                                        (c.assignedEmployeeId || "")
                                                    }
                                                    disabled={allocatingId === c.id || bulkSaving}
                                                    onChange={(e) =>
                                                        setPendingSelection((prev) => ({
                                                            ...prev,
                                                            [c.id]: e.target.value,
                                                        }))
                                                    }
                                                >
                                                    <option value="">Unallocated</option>
                                                    {(() => {
                                                        const rowEligible =
                                                            getEligibleEmployeesForProduct(
                                                                c.productId
                                                            );
                                                        const list = rowEligible.some(
                                                            (e) => e.id === c.assignedEmployeeId
                                                        )
                                                            ? rowEligible
                                                            : [
                                                                  ...(c.assignedEmployeeId
                                                                      ? employees.filter(
                                                                            (e) =>
                                                                                e.id ===
                                                                                c.assignedEmployeeId
                                                                        )
                                                                      : []),
                                                                  ...rowEligible,
                                                              ];
                                                        return list.map((emp) => (
                                                            <option key={emp.id} value={emp.id}>
                                                                {emp.name}
                                                                {loadLabel(emp.id)}
                                                            </option>
                                                        ));
                                                    })()}
                                                </select>
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        {!loading && cases.length > 0 && allocateBar}
                        <div style={styles.paginationRow}>
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                <i className="ti ti-chevron-left" />
                            </button>
                            <span style={styles.pageIndicator}>Page {page}</span>
                            {/* uses totalCases, so the next button is disabled correctly on the
                                last page (before it relied on "fewer than PAGE_SIZE rows" and
                                opened an empty page when the total was an exact multiple of 10). */}
                            <button
                                type="button"
                                style={styles.pageBtn}
                                disabled={page * PAGE_SIZE >= totalCases}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                <i className="ti ti-chevron-right" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {clearConfirmOpen && (
                <div style={styles.overlay}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Clear allocations?</h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={() => setClearConfirmOpen(false)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />
                        <p style={styles.modalBody}>
                            This unassigns all <strong>{allocatedCount}</strong> allocated case(s)
                            (case-number cases and counts) for{" "}
                            <strong>{selectedProduct?.product_name || "this service"}</strong> on{" "}
                            {workDate} back to Pending. Count cases the employee has already
                            submitted stay with them. The clear is logged.
                        </p>
                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={styles.modalCancelBtn}
                                onClick={() => setClearConfirmOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={styles.modalClearBtn}
                                onClick={handleClearAllocations}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW (8h WARNING): shown when Allocate is pressed and someone has > 8 hours */}
            {overloadOpen && (
                <div style={styles.overlay}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Heavy workload warning</h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={() => setOverloadOpen(false)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />
                        <p style={styles.modalBody}>
                            <i
                                className="ti ti-alert-triangle"
                                style={{
                                    fontSize: 40,
                                    color: BRAND.amber,
                                    display: "block",
                                    marginBottom: 8,
                                }}
                            />
                            <strong>{overloadedEmployees.length}</strong> employee
                            {overloadedEmployees.length === 1 ? "" : "s"} got more than 8 hours of
                            work.
                            <br />
                            <button
                                type="button"
                                style={styles.refreshLink}
                                onClick={() => setShowOverloadList((v) => !v)}
                            >
                                {showOverloadList
                                    ? "Hide employees"
                                    : "See all employees who got more than 8 hours"}
                            </button>
                        </p>

                        {showOverloadList && (
                            <div
                                style={{
                                    padding: "0 22px 12px",
                                    maxHeight: 220,
                                    overflowY: "auto",
                                }}
                            >
                                {overloadedEmployees.map((e) => (
                                    <div
                                        key={e.id}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            padding: "8px 0",
                                            borderTop: "1px solid #f1f1f1",
                                            fontSize: fontSize.sm,
                                        }}
                                    >
                                        <span>{e.name}</span>
                                        <span
                                            style={{
                                                color: BRAND.red,
                                                fontWeight: fontWeight.semibold,
                                            }}
                                        >
                                            {formatMinutes(e.mins)} · {e.total} case
                                            {e.total === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={styles.modalCancelBtn}
                                onClick={() => setOverloadOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={{
                                    ...styles.modalClearBtn,
                                    background: GRADIENT,
                                    boxShadow: "none",
                                }}
                                onClick={() => {
                                    setOverloadOpen(false);
                                    handleAllocateAll();
                                }}
                            >
                                Yes, Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW (URGENT): "Anything Urgent" popup */}
            {urgentOpen && (
                <div style={styles.overlay}>
                    <div
                        style={{
                            ...styles.modal,
                            maxWidth: 580,
                            maxHeight: "92vh",
                            display: "flex",
                            flexDirection: "column",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>
                                <i
                                    className="ti ti-alarm"
                                    style={{ color: BRAND.red, marginRight: 8 }}
                                />
                                Anything urgent?
                            </h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={closeUrgent}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />

                        <div style={styles.urgentBody}>
                            <p style={styles.urgentHint}>
                                Pick the urgent case numbers. They are allocated right away, and
                                each employee gets a mail to prioritise them first.
                            </p>

                            <button
                                type="button"
                                style={styles.urgentPickerBtn}
                                onClick={() => setUrgentPickerOpen((o) => !o)}
                            >
                                <span>
                                    {urgentSelected.length > 0
                                        ? `${urgentSelected.length} case(s) selected`
                                        : "Select case numbers…"}
                                </span>
                                <i
                                    className={`ti ${urgentPickerOpen ? "ti-chevron-up" : "ti-chevron-down"}`}
                                />
                            </button>

                            {urgentPickerOpen && (
                                <div style={styles.urgentPickerPanel}>
                                    <input
                                        type="text"
                                        value={urgentSearch}
                                        onChange={(e) => setUrgentSearch(e.target.value)}
                                        placeholder="Search case number, service, client…"
                                        style={{
                                            ...styles.select,
                                            width: "100%",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                    <div style={styles.urgentOptionList}>
                                        {urgentLoading ? (
                                            <div style={styles.urgentEmpty}>Loading cases…</div>
                                        ) : urgentFiltered.length === 0 ? (
                                            <div style={styles.urgentEmpty}>
                                                {urgentCases.length === 0
                                                    ? "No pending cases to allocate."
                                                    : "No case matches your search."}
                                            </div>
                                        ) : (
                                            urgentFiltered.slice(0, 100).map((c) => {
                                                const checked = urgentSelected.includes(c.id);
                                                return (
                                                    <label
                                                        key={c.id}
                                                        style={{
                                                            ...styles.urgentOption,
                                                            background: checked
                                                                ? "rgba(220,38,38,0.07)"
                                                                : "transparent",
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleUrgentCase(c.id)}
                                                        />
                                                        <span>
                                                            <strong>{c.caseNumber}</strong>
                                                            <span style={styles.urgentMeta}>
                                                                {" · "}
                                                                {c.productName || "Service"}
                                                                {c.clientName
                                                                    ? ` · ${c.clientName}`
                                                                    : ""}
                                                            </span>
                                                        </span>
                                                    </label>
                                                );
                                            })
                                        )}
                                        {urgentFiltered.length > 100 && (
                                            <div style={styles.urgentEmpty}>
                                                Showing the first 100 — type to narrow down.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {urgentSelected.length > 0 && (
                                <div style={styles.urgentRows}>
                                    {urgentSelected.map((id) => {
                                        const c = urgentCases.find((x) => x.id === id);
                                        if (!c) return null;
                                        // FIX (URGENT EMPLOYEES): everyone mapped to this
                                        // case's service — team members + external members.
                                        const options = getUrgentEmployees(c.productId);
                                        return (
                                            <div key={id} style={styles.urgentRow}>
                                                <div style={{ flex: 1, minWidth: 140 }}>
                                                    <div style={styles.urgentRowTitle}>
                                                        {c.caseNumber}
                                                    </div>
                                                    <div style={styles.urgentMeta}>
                                                        {c.productName || "Service"}
                                                        {c.clientName ? ` · ${c.clientName}` : ""}
                                                    </div>
                                                </div>
                                                <select
                                                    value={urgentEmp[id] || ""}
                                                    onChange={(e) =>
                                                        setUrgentEmp((prev) => ({
                                                            ...prev,
                                                            [id]: e.target.value,
                                                        }))
                                                    }
                                                    style={{
                                                        ...styles.select,
                                                        minWidth: 0,
                                                        width: 210,
                                                    }}
                                                >
                                                    <option value="">
                                                        {options.length > 0
                                                            ? "Select employee"
                                                            : "No eligible employee"}
                                                    </option>
                                                    {options.map((e) => (
                                                        <option key={e.id} value={e.id}>
                                                            {e.name}
                                                            {loadLabel(e.id)}
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    style={styles.urgentRemoveBtn}
                                                    onClick={() => toggleUrgentCase(id)}
                                                    aria-label={`Remove ${c.caseNumber}`}
                                                >
                                                    <i className="ti ti-x" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {urgentError && <div style={styles.errorText}>{urgentError}</div>}
                        </div>

                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={styles.modalCancelBtn}
                                onClick={closeUrgent}
                                disabled={urgentSaving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={{
                                    ...styles.modalClearBtn,
                                    opacity: urgentSaving || urgentSelected.length === 0 ? 0.6 : 1,
                                    cursor:
                                        urgentSaving || urgentSelected.length === 0
                                            ? "not-allowed"
                                            : "pointer",
                                }}
                                disabled={urgentSaving || urgentSelected.length === 0}
                                onClick={handleUrgentAllocate}
                            >
                                {urgentSaving
                                    ? "Allocating…"
                                    : `Allocate Urgently${urgentSelected.length > 0 ? ` (${urgentSelected.length})` : ""}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {successPopup && (
                <div style={styles.overlay}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Allocated successfully</h2>
                            <button
                                type="button"
                                style={styles.modalCloseBtn}
                                onClick={() => setSuccessPopup(null)}
                                aria-label="Close"
                            >
                                <i className="ti ti-x" style={{ fontSize: fontSize.md }} />
                            </button>
                        </div>
                        <div style={styles.modalDivider} />
                        <p style={styles.modalBody}>
                            <i
                                className="ti ti-circle-check"
                                style={{
                                    fontSize: 40,
                                    color: BRAND.green,
                                    display: "block",
                                    marginBottom: 8,
                                }}
                            />
                            <strong>{successPopup.count}</strong> case
                            {successPopup.count === 1 ? "" : "s"} allocated successfully.
                            {notifyStatus && (
                                <span
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                        marginTop: 12,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color:
                                            notifyStatus.kind === "ok"
                                                ? "#0f766e"
                                                : notifyStatus.kind === "fail"
                                                  ? "#DC2626"
                                                  : "#6b7280",
                                    }}
                                >
                                    <i
                                        className={
                                            notifyStatus.kind === "ok"
                                                ? "ti ti-bell-ringing"
                                                : notifyStatus.kind === "off"
                                                  ? "ti ti-bell-off"
                                                  : notifyStatus.kind === "fail"
                                                    ? "ti ti-alert-circle"
                                                    : "ti ti-loader-2"
                                        }
                                        style={{ fontSize: 16 }}
                                    />
                                    {notifyStatus.text}
                                </span>
                            )}
                        </p>
                        <div style={styles.modalActions}>
                            <button
                                type="button"
                                style={{ ...styles.modalCancelBtn, flex: "none", width: "100%" }}
                                onClick={() => setSuccessPopup(null)}
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

// clean grid for the grouped Counts view
const CG_COLS = "220px 200px 130px 120px 1fr";

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column" },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 },
    headerRow: { display: "flex", alignItems: "center" },
    headerLeft: { display: "flex", alignItems: "center", gap: 14 },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        textAlign: "left",
    },
    headerSubtext: {
        margin: "4px 0 0",
        fontSize: fontSize.base,
        color: "#767F92",
        maxWidth: 640,
        textAlign: "left",
    },
    filterBar: { display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" },
    label: {
        display: "block",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
        margin: "0 0 6px",
    },
    select: {
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
        color: "#17181C",
        minWidth: 170,
    },
    autoBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.3)",
    },
    // NEW (URGENT)
    urgentBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: radius.md,
        border: "1px solid rgba(220,38,38,0.35)",
        background: "rgba(220,38,38,0.08)",
        color: BRAND.red,
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
        cursor: "pointer",
    },
    urgentBody: {
        padding: "16px 20px 16px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    urgentHint: {
        margin: 0,
        fontSize: fontSize.base,
        color: "#4B5563",
        lineHeight: 1.5,
    },
    urgentPickerBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "11px 14px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "#17181C",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },
    urgentPickerPanel: {
        border: "1px solid #e2e4f0",
        borderRadius: radius.sm,
        padding: 10,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    urgentOptionList: { maxHeight: 150, overflowY: "auto" },
    urgentOption: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 8px",
        borderRadius: radius.xs,
        cursor: "pointer",
        fontSize: fontSize.base,
        color: "#17181C",
    },
    urgentMeta: { fontSize: fontSize.sm, color: "#6B7280" },
    urgentEmpty: {
        padding: "10px 8px",
        fontSize: fontSize.sm,
        color: "#6B7280",
        textAlign: "center",
    },
    urgentRows: { display: "flex", flexDirection: "column", gap: 8 },
    urgentRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 12px",
        borderRadius: radius.sm,
        border: "1px solid rgba(220,38,38,0.18)",
        background: "rgba(220,38,38,0.04)",
    },
    urgentRowTitle: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    urgentRemoveBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: radius.circle,
        border: "none",
        background: "#f1f2f6",
        color: "#374151",
        cursor: "pointer",
        flexShrink: 0,
    },
    autoSummary: {
        padding: "10px 16px",
        borderRadius: radius.sm,
        background: "rgba(var(--brand-green-rgb),0.08)",
        color: "#17181C",
        fontSize: fontSize.sm,
    },
    clearAllocBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: radius.md,
        border: `1px solid ${BRAND.red}`,
        background: "#fff",
        color: BRAND.red,
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.base,
    },
    eligibilityHint: {
        margin: 0,
        fontSize: fontSize.xs,
        color: "#767F92",
        textAlign: "left",
    },
    refreshLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        color: BRAND.blue,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        padding: 0,
    },
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,17,25,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
    },
    modal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: "100%",
        maxWidth: 440,
        boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        overflow: "hidden",
    },
    modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 20px 14px",
    },
    modalTitle: {
        margin: 0,
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "center",
        flex: 1,
    },
    modalCloseBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: radius.circle,
        border: "none",
        background: "#f1f2f6",
        color: "#374151",
        cursor: "pointer",
        flexShrink: 0,
    },
    modalDivider: { height: 1, background: "#eef0f5" },
    modalBody: {
        margin: 0,
        padding: "18px 22px",
        fontSize: fontSize.base,
        color: "#374151",
        textAlign: "center",
        lineHeight: 1.6,
    },
    modalActions: { display: "flex", gap: 12, padding: "0 20px 20px" },
    modalCancelBtn: {
        flex: 1,
        padding: "12px 16px",
        borderRadius: radius.md,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: BRAND.blue,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    modalClearBtn: {
        flex: 1,
        padding: "12px 16px",
        borderRadius: radius.md,
        border: "none",
        background: BRAND.red,
        color: "#fff",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(220,38,38,0.3)",
    },
    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },

    // ---- total-to-allocate summary strip ----
    summaryBar: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 18px",
        boxShadow: "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
        border: "1px solid #e5e9f0",
        borderLeft: "4px solid var(--brand-blue)",
    },
    summaryItemMain: {
        textAlign: "center",
        background: "rgba(var(--brand-blue-rgb),0.07)",
        borderRadius: radius.md,
        padding: "6px 16px",
        minWidth: 110,
    },
    summaryItem: { textAlign: "center", minWidth: 90 },
    summaryNumMain: {
        fontSize: fontSize["4xl"],
        fontWeight: fontWeight.bold,
        color: BRAND.blue,
        lineHeight: 1.1,
    },
    summaryNum: {
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        lineHeight: 1.1,
    },
    summaryLbl: { fontSize: fontSize.xs, color: "#767F92", marginTop: 2 },
    summaryTime: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        marginTop: 2,
    },
    summaryEquals: { fontSize: fontSize.xl, color: "#9CA3AF", fontWeight: fontWeight.medium },
    summaryNote: {
        marginLeft: "auto",
        fontSize: fontSize.xs,
        color: "#9CA3AF",
        maxWidth: 280,
        textAlign: "right",
    },
    carryTag: {
        display: "block",
        marginTop: 2,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#92400E",
    },

    // ---- per-employee allocation time strip (compact) ----
    timeCard: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "8px 14px",
        boxShadow: "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
        border: "1px solid #e5e9f0",
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    timeCardHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    timeGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
    timeItem: {
        minWidth: 110,
        padding: "5px 10px",
        border: "1px solid #ececf5",
        borderRadius: radius.md,
        background: "#FAFBFF",
        textAlign: "left",
    },
    timeEmpName: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        color: "#17181C",
    },
    timeValue: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        lineHeight: 1.2,
    },
    smallMutedText: { fontSize: fontSize.xs, color: "#9099AC" },

    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflow: "hidden",
        width: "calc(100% + 16px)",
        marginLeft: -8,
        marginRight: -8,
    },
    tableScroll: { overflowX: "auto" },
    tableHeadRow: {
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "12px 20px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        textAlign: "left",
    },
    tableRow: {
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "12px 20px",
        minHeight: 56,
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
        textAlign: "left",
    },
    colCase: { width: 120, flexShrink: 0, fontWeight: fontWeight.medium },
    colClient: { width: 150, flexShrink: 0, textAlign: "left" },
    colSubclient: { width: 150, flexShrink: 0, textAlign: "left" },
    colService: { width: 140, flexShrink: 0 },
    colDate: { width: 100, flexShrink: 0 },
    colTime: { width: 70, flexShrink: 0 },
    colStatus: { width: 110, flexShrink: 0 },
    colAssign: { width: 220, flexShrink: 0, textAlign: "right", marginLeft: "auto" },
    statusPill: {
        display: "inline-flex",
        padding: "3px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    assignSelect: {
        width: "100%",
        padding: "7px 10px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
        color: "#17181C",
    },
    // ---- count-only block ----
    sectionTitleRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px 6px",
    },
    sectionTitle: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    countPill: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        background: "rgba(var(--brand-blue-rgb),0.08)",
        borderRadius: radius.pill,
        padding: "2px 10px",
    },
    viewToggleRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    viewToggleBtn: {
        minWidth: 130,
        padding: "9px 18px",
        borderRadius: radius.md,
        border: "1px solid #e4e9f2",
        background: "#fff",
        color: "#3b4a63",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    viewToggleBtnActive: {
        background: GRADIENT,
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.28)",
    },
    // ---- grouped Counts view ----
    cgWrap: {
        minWidth: 900,
        padding: "0 20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
    },
    cgHead: {
        display: "grid",
        gridTemplateColumns: CG_COLS,
        gap: 14,
        padding: "10px 18px",
        background: "#F4F8FD",
        borderRadius: radius.sm,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        textAlign: "left",
    },
    cgGroup: {
        border: "1px solid #E6E9F3",
        borderRadius: radius.md,
        background: "#fff",
        overflow: "hidden",
    },
    cgGroupHead: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 18px",
        background: "#F7F9FE",
        borderBottom: "1px solid #E6E9F3",
    },
    cgDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
    cgGroupName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: "#17181C" },
    cgCountPill: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        background: "rgba(var(--brand-blue-rgb),0.1)",
        borderRadius: radius.pill,
        padding: "2px 10px",
    },
    cgGroupTotal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: "#1B1F4B" },
    cgRowWrap: { padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 },
    cgRow: {
        display: "grid",
        gridTemplateColumns: CG_COLS,
        gap: 14,
        alignItems: "center",
        textAlign: "left",
    },
    cgCell: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
        textAlign: "left",
    },
    cgClient: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.bold,
        color: "#1B1F4B",
        textAlign: "left",
    },
    cgText: { fontSize: fontSize.base, color: "#17181C", textAlign: "left" },
    cgCarry: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: "#B45309" },
    cgRight: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 2,
        textAlign: "right",
    },
    cgEmpGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        gap: 8,
    },
    cgEmpItem: {
        display: "grid",
        gridTemplateColumns: "1fr 64px 54px",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: "1px solid #ececf5",
        borderRadius: radius.sm,
        background: "#fafafa",
        fontSize: fontSize.sm,
        color: "#17181C",
    },
    cgEmpItemOn: {
        background: "rgba(var(--brand-blue-rgb),0.05)",
        borderColor: "rgba(var(--brand-blue-rgb),0.25)",
    },
    cgEmpName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    cgEmpTime: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        textAlign: "right",
        whiteSpace: "nowrap",
    },
    countBlock: {
        borderTop: "1px solid #f1f1f1",
        padding: "10px 20px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 900,
    },
    countRowTop: {
        display: "flex",
        alignItems: "center",
        gap: 28,
        fontSize: fontSize.base,
        color: "#17181C",
    },
    countEmpGrid: { display: "flex", flexWrap: "wrap", gap: 10 },
    countEmpItem: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: "1px solid #ececf5",
        borderRadius: radius.sm,
        background: "#fafafa",
        fontSize: fontSize.sm,
        color: "#17181C",
    },
    countEmpName: { minWidth: 90 },
    qtyInput: {
        width: 64,
        padding: "5px 8px",
        borderRadius: radius.sm,
        border: "1px solid #dfe3ee",
        fontSize: fontSize.sm,
        background: "#fff",
        color: "#17181C",
    },
    qtyTime: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        whiteSpace: "nowrap",
    },
    bulkAllocateRow: {
        display: "flex",
        justifyContent: "flex-end",
        padding: "14px 20px",
        borderTop: "1px solid #f1f1f1",
    },
    allocateAllBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "9px 20px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    emptyNote: {
        padding: "28px 20px",
        textAlign: "center",
        color: "#9ca3af",
        fontSize: fontSize.base,
    },
    paginationRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "14px 20px",
        borderTop: "1px solid #f1f1f1",
    },
    pageBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#374151",
        cursor: "pointer",
    },
    pageIndicator: { fontSize: fontSize.sm, color: "#374151", fontWeight: fontWeight.medium },
    toast: {
        position: "fixed",
        bottom: 24,
        right: 24,
        background: BRAND.blue,
        color: "#fff",
        padding: "12px 18px",
        borderRadius: radius.md,
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        zIndex: 1000,
    },
};
