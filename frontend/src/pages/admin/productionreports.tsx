// src/pages/admin/productionreport.tsx
//
// Production Report — case-number-wise report across ALL services, with
// filters on every dimension (Service, Date range, Employee, Status,
// Client). Two output modes:
//   1. On-screen table (paginated) for browsing
//   2. "Export Excel" — fetches every row matching the current filters
//      (not just the current page) and downloads it as a .xlsx file
//      using SheetJS.
//
// MODIFIED in this version:
//   - Client-wise cards redesigned: simple, light, organised (no gradient
//     bar / avatar / coloured underlines).
//   - "Total" on a card = the whole selected date range. The range defaults
//     to the CURRENT MONTH (1st -> today), so Total is month-wise.
//   - "Today's Receiving" = ONLY cases received today (never the total).
//   - Client cards: exactly 4 per row on desktop (2 on tablet, 1 on mobile).
//   - NEW (TIME): time is shown PER EMPLOYEE (cases allocated to them x the
//     service's AMP) in the "Employee-wise Time" strip, and as a "Time"
//     column in the Excel export. Not per client. Services without an AMP
//     count as 0.
//   - NEW (SUBMITTED BY): the table / mobile card / Excel now show WHO
//     submitted a case. If it was submitted by someone other than the
//     employee it was allocated to (e.g. a manager submitting on behalf),
//     it is flagged "On behalf". Needs submittedById + submittedByName from
//     /api/service-cases.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser, hasRole } from "../../utils/auth";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 15;
// Backend clamps pageSize to 100 (servicecases.controller.js), so batches
// must be 100 or the "short batch -> stop" check ends after page 1.
const EXPORT_PAGE_SIZE = 100;
const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1100;
const NO_CLIENT = "No client";
// Roles allowed to mark SOMEONE ELSE's query as completed — same roles that
// hold tasks.allocate.team / tasks.allocate.org on the backend, which is
// what actually enforces it (this list only decides who SEES the button).
const CAN_COMPLETE_QUERY_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD", "VERTICAL_HEAD"];

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

// How many client cards fit in one row: 4 on desktop, 2 on tablet, 1 on mobile.
function useCardColumns() {
    const get = () => {
        if (typeof window === "undefined") return 4;
        const w = window.innerWidth;
        if (w < MOBILE_BREAKPOINT) return 1;
        if (w < TABLET_BREAKPOINT) return 2;
        return 4;
    };
    const [cols, setCols] = useState(get);
    useEffect(() => {
        const onResize = () => setCols(get());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return cols;
}

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    cyan: "#0891b2",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = {
    id: string;
    product_name: string;
    // NEW: AMP — time per case
    time_taken?: number | string | null;
    time_unit?: "minutes" | "hours" | string | null;
};
type Employee = { id: string; name: string; employeeCode: string | null };
type ClientOption = { id: string; name: string };

type ServiceCaseRow = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientId: string | null;
    clientName: string | null;
    subclientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    // who ran the allocate action (manual or Smart/auto allocate) —
    // separate from assignedEmployeeName, which is who the case ended
    // up with.
    allocatedByName: string | null;
    allocationStatus: "PENDING" | "ALLOCATED";
    quantity: number | null;
    amount: number | null;
    submissionStatus: "PENDING" | "SUBMITTED";
    submissionType: "COMPLETED" | "DONE_BY_TEAM" | "DONE_BY_CLIENT" | "QUERY" | null;
    queryText: string | null;
    submittedAt: string | null;
    // NEW: who actually pressed Submit (the employee, or a manager on their
    // behalf). Backend must send these.
    submittedById?: string | number | null;
    submittedByName?: string | null;
};

// NEW: true when someone OTHER than the employee the case was allocated to
// submitted it (manager / ops manager submitting on behalf).
function isOnBehalf(r: ServiceCaseRow) {
    if (r.submissionStatus !== "SUBMITTED" || !r.submittedByName) return false;
    if (r.submittedById != null && r.assignedEmployeeId) {
        return String(r.submittedById) !== String(r.assignedEmployeeId);
    }
    return (
        (r.assignedEmployeeName || "").trim().toLowerCase() !==
        r.submittedByName.trim().toLowerCase()
    );
}

// Count-only work (no case numbers yet) from /api/service-cases/count-allocations.
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
    allocations: { employeeName: string | null; quantity: number; fulfilledQuantity: number }[];
};

// submitted_at is a full timestamp (UTC). Returns the viewer's LOCAL calendar
// date as YYYY-MM-DD (same format as the Date column) — or "" if not
// submitted yet. Slicing the raw string instead would show the previous day
// for anything submitted early morning IST.
function submittedDateStr(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

// Label shown for each post-allocation submission outcome. DONE_BY_TEAM
// is the stored value for "Completed by Team" (label renamed only).
function submissionLabel(type: ServiceCaseRow["submissionType"]) {
    switch (type) {
        case "COMPLETED":
            return "Completed";
        case "DONE_BY_TEAM":
            return "Completed by Team";
        case "DONE_BY_CLIENT":
            return "Completed by Client";
        case "QUERY":
            return "Query";
        default:
            return "Not Submitted";
    }
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

function firstOfMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const clientKey = (name: string | null) => (name || "").trim() || NO_CLIENT;

// NEW: minutes -> "2h 30m"
function formatMinutes(mins: number) {
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export default function ProductionReport() {
    const isMobile = useIsMobile();
    const cardCols = useCardColumns();
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [clients, setClients] = useState<ClientOption[]>([]);

    // filters
    const [productId, setProductId] = useState("");
    const [fromDate, setFromDate] = useState(firstOfMonthStr());
    const [toDate, setToDate] = useState(todayStr());
    const [employeeId, setEmployeeId] = useState("");
    const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "ALLOCATED">("");
    // post-allocation submission filter — independent of allocation status
    // above (a case can be Allocated but still not yet submitted).
    const [submissionFilter, setSubmissionFilter] = useState<"" | "PENDING" | "SUBMITTED">("");
    // Client is a dropdown (clientId) — the backend supports clientId.
    const [clientId, setClientId] = useState("");
    // universal search — Case #, Service, Client, Subclient, Date, status keywords.
    const [searchInput, setSearchInput] = useState(""); // debounced input
    const [searchQuery, setSearchQuery] = useState("");

    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);
    const [toast, setToast] = useState("");

    // ---- client-wise cards ----
    const [cardCases, setCardCases] = useState<ServiceCaseRow[]>([]);
    const [cardCounts, setCardCounts] = useState<CountRow[]>([]);
    const [cardsLoading, setCardsLoading] = useState(true);
    const [openClient, setOpenClient] = useState<string | null>(null);
    // After "View Details" is clicked the table opens BELOW all the cards;
    // jump straight to it so the user doesn't have to scroll.
    const detailRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!openClient) return;
        const t = setTimeout(
            () => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            60
        );
        return () => clearTimeout(t);
    }, [openClient]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // debounce the universal search box — typing still auto-searches after
    // a short pause; the Search button (and Enter key) applies it immediately.
    useEffect(() => {
        const t = setTimeout(() => setSearchQuery(searchInput.trim()), 400);
        return () => clearTimeout(t);
    }, [searchInput]);

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

    // /api/clients returns a raw array (no {success, data} envelope).
    const fetchClients = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/clients`);
            if (!res.ok) return;
            const json = await res.json();
            const list = Array.isArray(json) ? json : json?.data || [];
            setClients(list.map((c: any) => ({ id: String(c.id), name: c.name })));
        } catch (err) {
            console.error("Failed to fetch clients:", err);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
        fetchClients();
    }, [fetchProducts, fetchEmployees, fetchClients]);

    // NEW: service AMP in MINUTES (time_taken, converted if the unit is hours)
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

    const buildParams = useCallback(
        (forExport: boolean, exportPage = 1) => {
            const params = new URLSearchParams();
            params.set("page", String(forExport ? exportPage : page));
            params.set("pageSize", String(forExport ? EXPORT_PAGE_SIZE : PAGE_SIZE));
            if (productId) params.set("productId", productId);
            // the backend's date-range filter reads workDateFrom/workDateTo
            if (fromDate) params.set("workDateFrom", fromDate);
            if (toDate) params.set("workDateTo", toDate);
            if (employeeId) params.set("employeeId", employeeId);
            if (statusFilter) params.set("allocationStatus", statusFilter);
            if (clientId) params.set("clientId", clientId);
            if (searchQuery) params.set("search", searchQuery);
            if (submissionFilter) params.set("submissionStatus", submissionFilter);
            return params;
        },
        [
            page,
            productId,
            fromDate,
            toDate,
            employeeId,
            statusFilter,
            clientId,
            searchQuery,
            submissionFilter,
        ]
    );

    useEffect(() => {
        setPage(1);
    }, [
        productId,
        fromDate,
        toDate,
        employeeId,
        statusFilter,
        clientId,
        searchQuery,
        submissionFilter,
        openClient,
    ]);

    // ---- cards data: every case in the date range (service / employee /
    // client filters apply; Status / Submission / search do NOT, because the
    // cards ARE the Allocated / Pending / Submitted breakdown). ----
    const fetchCards = useCallback(async () => {
        setCardsLoading(true);
        setError("");
        try {
            const all: ServiceCaseRow[] = [];
            for (let p = 1; p <= 60; p++) {
                const params = new URLSearchParams();
                params.set("page", String(p));
                params.set("pageSize", "100");
                if (productId) params.set("productId", productId);
                if (fromDate) params.set("workDateFrom", fromDate);
                if (toDate) params.set("workDateTo", toDate);
                if (employeeId) params.set("employeeId", employeeId);
                if (clientId) params.set("clientId", clientId);
                const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
                const json = await res.json();
                if (!res.ok || !json.success)
                    throw new Error(json?.message || `HTTP ${res.status}`);
                const batch: ServiceCaseRow[] = json.data || [];
                all.push(...batch);
                if (batch.length < 100) break;
            }
            setCardCases(all);

            // Count-only work with no case numbers yet. Optional: if that
            // endpoint isn't deployed (or an employee filter is set, counts
            // aren't per-employee) the cards just use cases.
            let counts: CountRow[] = [];
            if (!employeeId) {
                try {
                    const p = new URLSearchParams();
                    p.set("workDate", toDate);
                    if (productId) p.set("productId", productId);
                    const res = await authFetch(
                        `${API_BASE}/api/service-cases/count-allocations?${p.toString()}`
                    );
                    const json = await res.json();
                    if (res.ok && json.success) {
                        const selectedClientName = clientId
                            ? clients.find((c) => c.id === clientId)?.name
                            : null;
                        counts = (json.data || []).filter(
                            (c: CountRow) =>
                                c.workDate >= fromDate &&
                                (!selectedClientName || c.clientName === selectedClientName)
                        );
                    }
                } catch {
                    counts = [];
                }
            }
            setCardCounts(counts);
        } catch (err: any) {
            console.error("Failed to load client cards:", err);
            setError(err?.message || "Failed to load production report.");
            setCardCases([]);
            setCardCounts([]);
        } finally {
            setCardsLoading(false);
        }
    }, [productId, fromDate, toDate, employeeId, clientId, clients]);

    useEffect(() => {
        fetchCards();
    }, [fetchCards]);

    // MODIFIED: per client —
    //   total    = every case in the selected date range (month-wise by default)
    //   today    = ONLY cases whose date is today (never the total)
    const cards = useMemo(() => {
        const today = todayStr();
        const map = new Map<
            string,
            { receiving: number; today: number; allocated: number; submitted: number }
        >();
        const bucket = (name: string | null) => {
            const key = clientKey(name);
            if (!map.has(key)) map.set(key, { receiving: 0, today: 0, allocated: 0, submitted: 0 });
            return map.get(key)!;
        };
        cardCases.forEach((c) => {
            const b = bucket(c.clientName);
            b.receiving += 1;
            if (c.workDate === today) b.today += 1;
            if (c.allocationStatus === "ALLOCATED") b.allocated += 1;
            if (c.submissionStatus === "SUBMITTED") b.submitted += 1;
        });
        cardCounts.forEach((c) => {
            const b = bucket(c.clientName);
            const fulfilledSum = c.allocations.reduce((s, a) => s + a.fulfilledQuantity, 0);
            b.receiving += c.pendingCount; // units that have no case number yet
            if (c.workDate === today) b.today += c.pendingCount;
            b.allocated += Math.max(0, c.allocatedTotal - fulfilledSum);
        });
        return Array.from(map.entries())
            .map(([client, v]) => ({
                client,
                ...v,
                pending: Math.max(0, v.receiving - v.allocated),
            }))
            .sort((a, b) => b.receiving - a.receiving);
    }, [cardCases, cardCounts]);

    // NEW: time PER EMPLOYEE = cases assigned to them x service AMP
    //      (+ count quantities still allocated to them x AMP).
    const employeeTime = useMemo(() => {
        const map = new Map<
            string,
            { name: string; cases: number; counts: number; mins: number }
        >();
        const add = (name: string, cases: number, counts: number, mins: number) => {
            const cur = map.get(name) || { name, cases: 0, counts: 0, mins: 0 };
            cur.cases += cases;
            cur.counts += counts;
            cur.mins += mins;
            map.set(name, cur);
        };
        cardCases.forEach((c) => {
            if (!c.assignedEmployeeName) return;
            add(c.assignedEmployeeName, 1, 0, ampOf(c.productId));
        });
        cardCounts.forEach((c) =>
            c.allocations.forEach((a) => {
                const q = Math.max(0, a.quantity - a.fulfilledQuantity);
                if (!a.employeeName || q <= 0) return;
                add(a.employeeName, 0, q, q * ampOf(c.productId));
            })
        );
        return Array.from(map.values()).sort((a, b) => b.mins - a.mins);
    }, [cardCases, cardCounts, ampOf]);

    // Label under the big number: "This month" when the range is the
    // current month (default), otherwise the plain date range.
    const totalLabel =
        fromDate === firstOfMonthStr() && toDate === todayStr()
            ? "This Month"
            : `${fromDate} to ${toDate}`;

    // The table below the cards is hidden until a card's "View Details" is
    // clicked. It shows that client's cases, narrowed by the Status /
    // Submission / Search filters, paginated client-side (cardCases already
    // holds every case in the date range).
    const detailCounts = useMemo(
        () => (openClient ? cardCounts.filter((c) => clientKey(c.clientName) === openClient) : []),
        [cardCounts, openClient]
    );
    const tableRows = useMemo(() => {
        if (!openClient) return [];
        const q = searchQuery.toLowerCase();
        return cardCases
            .filter((c) => clientKey(c.clientName) === openClient)
            .filter((c) => !statusFilter || c.allocationStatus === statusFilter)
            .filter((c) => !submissionFilter || c.submissionStatus === submissionFilter)
            .filter(
                (c) =>
                    !q ||
                    `${c.caseNumber} ${c.productName || ""} ${c.clientName || ""} ${
                        c.subclientName || ""
                    } ${c.workDate} ${c.assignedEmployeeName || ""} ${
                        c.submittedByName || ""
                    } ${c.allocationStatus === "ALLOCATED" ? "allocated" : "pending"}`
                        .toLowerCase()
                        .includes(q)
            );
    }, [cardCases, openClient, statusFilter, submissionFilter, searchQuery]);
    const totalCount = tableRows.length;
    const rows = tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const loading = cardsLoading;
    const countsNoNumber = detailCounts.reduce((s, c) => s + c.pendingCount, 0);

    // Pull every matching row across all pages for export, not just what's
    // currently on screen.
    const fetchAllMatchingForExport = async (): Promise<ServiceCaseRow[]> => {
        const all: ServiceCaseRow[] = [];
        let exportPage = 1;
        // hard safety cap so a runaway filter can't loop forever
        for (let i = 0; i < 200; i++) {
            const params = buildParams(true, exportPage);
            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Export fetch failed");
            const batch: ServiceCaseRow[] = json.data || [];
            all.push(...batch);
            if (batch.length < EXPORT_PAGE_SIZE) break;
            exportPage++;
        }
        return all;
    };

    const handleExportExcel = async () => {
        setExporting(true);
        try {
            const allRows = await fetchAllMatchingForExport();
            if (allRows.length === 0) {
                showToast("No matching cases to export.");
                return;
            }

            const sheetData = allRows.map((r) => ({
                "Case #": r.caseNumber,
                Client: r.clientName || "",
                Subclient: r.subclientName || "",
                Service: r.productName || "",
                Date: r.workDate,
                Employee: r.assignedEmployeeName || "Unallocated",
                "Allocated By": r.allocatedByName || "",
                Status: r.allocationStatus === "ALLOCATED" ? "Allocated" : "Pending",
                Submission: submissionLabel(r.submissionType),
                "Submitted By": r.submissionStatus === "SUBMITTED" ? r.submittedByName || "" : "",
                "On Behalf": isOnBehalf(r) ? "Yes" : "",
                "Submitted Date": submittedDateStr(r.submittedAt),
                Time: ampOf(r.productId) > 0 ? formatMinutes(ampOf(r.productId)) : "",
                Query: r.queryText || "",
            }));

            const ws = XLSX.utils.json_to_sheet(sheetData);
            ws["!cols"] = [
                { wch: 14 }, // Case #
                { wch: 22 }, // Client
                { wch: 22 }, // Subclient
                { wch: 16 }, // Service
                { wch: 12 }, // Date
                { wch: 18 }, // Employee
                { wch: 18 }, // Allocated By
                { wch: 12 }, // Status
                { wch: 20 }, // Submission
                { wch: 18 }, // Submitted By
                { wch: 10 }, // On Behalf
                { wch: 14 }, // Submitted Date
                { wch: 10 }, // Time
                { wch: 28 }, // Query
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Production Report");

            const fname = `production-report_${fromDate}_to_${toDate}.xlsx`;
            XLSX.writeFile(wb, fname);
            showToast(`Exported ${allRows.length} case(s).`);
        } catch (err: any) {
            showToast(err?.message || "Export failed.");
        } finally {
            setExporting(false);
        }
    };

    // ---- Mark a query completed (by Team) ----
    const canCompleteQuery = hasRole(getCurrentUser(), CAN_COMPLETE_QUERY_ROLES);
    const [completingId, setCompletingId] = useState<string | null>(null);

    const completeQuery = async (r: ServiceCaseRow) => {
        setCompletingId(r.id);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${r.id}/complete-query`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const json = await res.json();
            // 409 = someone already completed it — treat as done, just sync the row.
            if (!res.ok && !(res.status === 409 && json.alreadyCompleted)) {
                throw new Error(json?.message || `HTTP ${res.status}`);
            }
            setCardCases((prev) =>
                prev.map((x) =>
                    x.id === r.id
                        ? {
                              ...x,
                              submissionType:
                                  json?.data?.submissionType === "QUERY" ||
                                  !json?.data?.submissionType
                                      ? "DONE_BY_TEAM"
                                      : json.data.submissionType,
                          }
                        : x
                )
            );
            showToast(
                res.ok
                    ? `${r.caseNumber} marked Completed by Team.`
                    : json.message || "Already completed."
            );
        } catch (err: any) {
            showToast(err?.message || "Could not complete the query.");
        } finally {
            setCompletingId(null);
        }
    };

    const resetFilters = () => {
        setProductId("");
        setFromDate(firstOfMonthStr());
        setToDate(todayStr());
        setEmployeeId("");
        setStatusFilter("");
        setSubmissionFilter("");
        setClientId("");
        setSearchInput("");
        setSearchQuery("");
        setOpenClient(null);
    };

    // On the 2-column mobile filter grid, select/input's fixed minWidth
    // can exceed the actual column width on narrow screens. Drop it on mobile.
    const filterFieldStyle = isMobile ? { ...styles.select, minWidth: 0 } : styles.select;

    // Shared between the desktop table row and the mobile stacked card
    // below, so the two views never drift out of sync on labels/colors.
    const allocationPillProps = (r: ServiceCaseRow) => ({
        background:
            r.allocationStatus === "ALLOCATED"
                ? "rgba(var(--brand-green-rgb),0.12)"
                : "rgba(156,163,175,0.15)",
        color: r.allocationStatus === "ALLOCATED" ? BRAND.green : BRAND.grey,
        label: r.allocationStatus === "ALLOCATED" ? "Allocated" : "Pending",
    });
    const submissionPillProps = (r: ServiceCaseRow) => ({
        background:
            r.submissionType === "COMPLETED"
                ? "rgba(var(--brand-green-rgb),0.12)"
                : r.submissionType === "DONE_BY_TEAM"
                  ? "rgba(var(--brand-blue-rgb),0.12)"
                  : r.submissionType === "DONE_BY_CLIENT"
                    ? "rgba(124,58,237,0.12)"
                    : r.submissionType === "QUERY"
                      ? "rgba(220,38,38,0.12)"
                      : "rgba(156,163,175,0.15)",
        color:
            r.submissionType === "COMPLETED"
                ? BRAND.green
                : r.submissionType === "DONE_BY_TEAM"
                  ? BRAND.blue
                  : r.submissionType === "DONE_BY_CLIENT"
                    ? "#7C3AED"
                    : r.submissionType === "QUERY"
                      ? BRAND.red
                      : BRAND.grey,
        label: submissionLabel(r.submissionType),
    });

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div
                style={{
                    ...styles.contentBody,
                    padding: isMobile ? "16px" : "20px 24px",
                }}
            >
                <div style={styles.headerRow}>
                    <div>
                        <h2
                            style={{
                                ...styles.pageTitle,
                                fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
                            }}
                        >
                            Production Report
                        </h2>
                        <p style={styles.headerSubtext}>
                            Case-number-wise production across all services — filter by service,
                            date range, employee, status, or client, then browse on screen or export
                            to Excel.
                        </p>
                    </div>
                    <button
                        type="button"
                        style={{ ...styles.exportBtn, opacity: exporting ? 0.6 : 1 }}
                        disabled={exporting}
                        onClick={handleExportExcel}
                    >
                        <i className="ti ti-file-spreadsheet" />
                        {exporting ? "Exporting…" : "Export Excel"}
                    </button>
                </div>

                <div
                    style={
                        isMobile
                            ? { ...styles.searchBar, flexDirection: "column" }
                            : styles.searchBar
                    }
                >
                    <div style={styles.searchInputWrap}>
                        <i className="ti ti-search" style={styles.searchIcon} />
                        <input
                            type="text"
                            placeholder="Search case #, service, client, subclient, date…"
                            style={styles.searchInput}
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") setSearchQuery(searchInput.trim());
                            }}
                        />
                        {searchInput && (
                            <button
                                type="button"
                                style={styles.searchClearBtn}
                                onClick={() => setSearchInput("")}
                                aria-label="Clear search"
                            >
                                <i className="ti ti-x" />
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        style={{ ...styles.searchBtn, ...(isMobile ? { width: "100%" } : {}) }}
                        onClick={() => setSearchQuery(searchInput.trim())}
                    >
                        <i className="ti ti-search" />
                        Search
                    </button>
                </div>

                <div
                    style={
                        isMobile
                            ? {
                                  ...styles.filterBar,
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  alignItems: "start",
                              }
                            : styles.filterBar
                    }
                >
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>Service</label>
                        <select
                            style={filterFieldStyle}
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                        >
                            <option value="">All Services</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>From</label>
                        <input
                            type="date"
                            style={filterFieldStyle}
                            value={fromDate}
                            max={toDate || undefined}
                            onChange={(e) => setFromDate(e.target.value)}
                        />
                    </div>
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>To</label>
                        <input
                            type="date"
                            style={filterFieldStyle}
                            value={toDate}
                            min={fromDate || undefined}
                            onChange={(e) => setToDate(e.target.value)}
                        />
                    </div>
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>Employee</label>
                        <select
                            style={filterFieldStyle}
                            value={employeeId}
                            onChange={(e) => setEmployeeId(e.target.value)}
                        >
                            <option value="">All Employees</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>Status</label>
                        <select
                            style={filterFieldStyle}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                        >
                            <option value="">All</option>
                            <option value="PENDING">Pending</option>
                            <option value="ALLOCATED">Allocated</option>
                        </select>
                    </div>
                    <div style={isMobile ? { minWidth: 0 } : undefined}>
                        <label style={styles.label}>Submission</label>
                        <select
                            style={filterFieldStyle}
                            value={submissionFilter}
                            onChange={(e) => setSubmissionFilter(e.target.value as any)}
                        >
                            <option value="">All</option>
                            <option value="PENDING">Not Submitted</option>
                            <option value="SUBMITTED">Submitted</option>
                        </select>
                    </div>
                    <div style={isMobile ? { gridColumn: "1 / -1" } : { flex: 1, minWidth: 180 }}>
                        <label style={styles.label}>Client</label>
                        <select
                            style={filterFieldStyle}
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                        >
                            <option value="">All Clients</option>
                            {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        style={{
                            ...styles.resetBtn,
                            ...(isMobile ? { gridColumn: "1 / -1", justifyContent: "center" } : {}),
                        }}
                        onClick={resetFilters}
                    >
                        <i className="ti ti-refresh" />
                        Reset
                    </button>
                </div>

                {error && <p style={styles.errorText}>{error}</p>}

                {/* ============ NEW: Employee-wise time (cases x service AMP) ============ */}
                <div style={styles.empTimeCard}>
                    <div style={styles.cardsHeader}>
                        <span style={styles.cardsTitle}>
                            <i className="ti ti-clock" style={{ marginRight: 6 }} />
                            Employee-wise Time
                        </span>
                        <span style={styles.cardsHint}>
                            {totalLabel} · cases allocated to each person × service AMP
                        </span>
                    </div>
                    {cardsLoading ? (
                        <div style={styles.emptyNote}>Loading…</div>
                    ) : employeeTime.length === 0 ? (
                        <div style={styles.emptyNote}>No allocated cases in this date range.</div>
                    ) : (
                        <div style={styles.empTimeGrid}>
                            {employeeTime.map((e) => {
                                const total = e.cases + e.counts;
                                return (
                                    <div key={e.name} style={styles.empTimeItem}>
                                        <div style={styles.empTimeName} title={e.name}>
                                            {e.name}
                                        </div>
                                        <div
                                            style={{
                                                ...styles.empTimeValue,
                                                color: e.mins > 0 ? BRAND.blue : BRAND.grey,
                                            }}
                                        >
                                            {e.mins > 0 ? formatMinutes(e.mins) : "0m"}
                                        </div>
                                        <div style={styles.cardsHint}>
                                            {total} case{total === 1 ? "" : "s"}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ============ Client-wise cards (simple design) ============ */}
                <div style={styles.cardsSection}>
                    <div style={styles.cardsHeader}>
                        <span style={styles.cardsTitle}>Client-wise Summary</span>
                        <span style={styles.cardsHint}>
                            {totalLabel === "This Month"
                                ? "Total = this month · Today's Receiving = today only"
                                : `Total = ${totalLabel} · Today's Receiving = today only`}
                        </span>
                    </div>
                    {cardsLoading ? (
                        <div style={styles.emptyNote}>Loading client summary…</div>
                    ) : cards.length === 0 ? (
                        <div style={styles.emptyNote}>No cases in this date range.</div>
                    ) : (
                        <div
                            style={{
                                ...styles.cardsGrid,
                                // exactly 4 per row on desktop, 2 on tablet, 1 on mobile
                                gridTemplateColumns: `repeat(${cardCols}, minmax(0, 1fr))`,
                            }}
                        >
                            {cards.map((c) => {
                                const active = openClient === c.client;
                                return (
                                    <div
                                        key={c.client}
                                        style={{
                                            ...styles.clientCard,
                                            // only top/right/bottom — keeps the blue left accent
                                            borderTopColor: active ? BRAND.blue : "#e5e9f0",
                                            borderRightColor: active ? BRAND.blue : "#e5e9f0",
                                            borderBottomColor: active ? BRAND.blue : "#e5e9f0",
                                            boxShadow: active
                                                ? "0 8px 22px rgba(var(--brand-blue-rgb),0.2)"
                                                : "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
                                        }}
                                    >
                                        <div style={styles.clientCardTop}>
                                            <div style={styles.clientCardName} title={c.client}>
                                                {c.client}
                                            </div>
                                            <div style={styles.totalBox}>
                                                <div style={styles.totalNum}>{c.receiving}</div>
                                                <div style={styles.totalLbl}>{totalLabel}</div>
                                            </div>
                                        </div>
                                        <div style={styles.statList}>
                                            <StatRow
                                                label="Today's Receiving"
                                                value={c.today}
                                                color={BRAND.blue}
                                            />
                                            <StatRow
                                                label="Allocated"
                                                value={c.allocated}
                                                color={BRAND.cyan}
                                            />
                                            <StatRow
                                                label="Pending"
                                                value={c.pending}
                                                color={BRAND.amber}
                                            />
                                            <StatRow
                                                label="Submitted"
                                                value={c.submitted}
                                                color={BRAND.green}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            style={{
                                                ...styles.viewDetailsBtn,
                                                ...(active ? styles.viewDetailsBtnActive : {}),
                                            }}
                                            onClick={() => setOpenClient(active ? null : c.client)}
                                        >
                                            {active ? "Hide Details" : "View Details"}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Table stays hidden until a client card's "View Details" is clicked */}
                {openClient && (
                    <div ref={detailRef} style={styles.tableWrap}>
                        <div style={styles.tableWrapHead}>
                            <span style={styles.cardsTitle}>{openClient}</span>
                            <button
                                type="button"
                                style={styles.resetBtn}
                                onClick={() => setOpenClient(null)}
                            >
                                <i className="ti ti-x" />
                                Close
                            </button>
                        </div>
                        {countsNoNumber > 0 && (
                            <div style={styles.countNotice}>
                                <i className="ti ti-info-circle" /> {countsNoNumber} more case
                                {countsNoNumber === 1 ? "" : "s"} of this client don't have case
                                numbers yet (allocated as a count) — they'll appear here once the
                                numbers are added.
                            </div>
                        )}
                        <div style={styles.tableCard}>
                            {!isMobile ? (
                                <>
                                    <div style={styles.tableHeadRow}>
                                        <span style={styles.colCase}>Case #</span>
                                        <span style={styles.colClient}>Client</span>
                                        <span style={styles.colClient}>Subclient</span>
                                        <span style={styles.colService}>Service</span>
                                        <span style={styles.colDate}>Date</span>
                                        <span style={styles.colEmployee}>Allocated To</span>
                                        <span style={styles.colAllocatedBy}>Allocated By</span>
                                        <span style={styles.colStatus}>Status</span>
                                        <span style={styles.colStatus}>Submission</span>
                                        <span style={styles.colAllocatedBy}>Submitted By</span>
                                        <span style={styles.colStatus}>Submitted Date</span>
                                        <span style={styles.colQuery}>Query</span>
                                    </div>
                                    {loading ? (
                                        <div style={styles.emptyNote}>Loading report…</div>
                                    ) : rows.length === 0 ? (
                                        <div style={styles.emptyNote}>
                                            No cases found for this filter.
                                        </div>
                                    ) : (
                                        rows.map((r, idx) => {
                                            const allocPill = allocationPillProps(r);
                                            const subPill = submissionPillProps(r);
                                            const onBehalf = isOnBehalf(r);
                                            return (
                                                <div
                                                    key={r.id}
                                                    style={{
                                                        ...styles.tableRow,
                                                        background:
                                                            idx % 2 === 0 ? "#fff" : "#fafbff",
                                                    }}
                                                >
                                                    <span style={styles.colCase}>
                                                        {r.caseNumber}
                                                    </span>
                                                    <span style={styles.colClient}>
                                                        {r.clientName || "—"}
                                                    </span>
                                                    <span style={styles.colClient}>
                                                        {r.subclientName || "—"}
                                                    </span>
                                                    <span style={styles.colService}>
                                                        {r.productName || "—"}
                                                    </span>
                                                    <span style={styles.colDate}>{r.workDate}</span>
                                                    <span style={styles.colEmployee}>
                                                        {r.assignedEmployeeName || "Unallocated"}
                                                    </span>
                                                    <span style={styles.colAllocatedBy}>
                                                        {r.allocatedByName || "—"}
                                                    </span>
                                                    <span style={styles.colStatus}>
                                                        <span
                                                            style={{
                                                                ...styles.statusPill,
                                                                background: allocPill.background,
                                                                color: allocPill.color,
                                                            }}
                                                        >
                                                            {allocPill.label}
                                                        </span>
                                                    </span>
                                                    <span style={styles.colStatus}>
                                                        <span
                                                            style={{
                                                                ...styles.statusPill,
                                                                background: subPill.background,
                                                                color: subPill.color,
                                                            }}
                                                        >
                                                            {subPill.label}
                                                        </span>
                                                    </span>
                                                    {/* NEW: who submitted — flagged when it was
                                                        someone other than the allocated employee */}
                                                    <span
                                                        style={{
                                                            ...styles.colAllocatedBy,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "flex-start",
                                                            gap: 3,
                                                        }}
                                                        title={r.submittedByName || undefined}
                                                    >
                                                        <span
                                                            style={{
                                                                maxWidth: "100%",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                            }}
                                                        >
                                                            {r.submissionStatus === "SUBMITTED"
                                                                ? r.submittedByName || "—"
                                                                : "—"}
                                                        </span>
                                                        {onBehalf && (
                                                            <span
                                                                style={styles.onBehalfChip}
                                                                title={`Allocated to ${
                                                                    r.assignedEmployeeName || "-"
                                                                }, submitted by ${r.submittedByName}`}
                                                            >
                                                                On behalf
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span
                                                        style={styles.colStatus}
                                                        title={
                                                            r.submittedAt
                                                                ? new Date(
                                                                      r.submittedAt
                                                                  ).toLocaleString()
                                                                : undefined
                                                        }
                                                    >
                                                        {submittedDateStr(r.submittedAt) || "—"}
                                                    </span>
                                                    {/* A completed query keeps its text, so it still
                                                reads as "was a query". Open queries also get a
                                                Mark completed button for anyone allowed to. */}
                                                    <span
                                                        style={{
                                                            ...styles.colQuery,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "flex-start",
                                                            gap: 4,
                                                        }}
                                                    >
                                                        <span
                                                            title={r.queryText || undefined}
                                                            style={{
                                                                maxWidth: "100%",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                            }}
                                                        >
                                                            {r.queryText || "—"}
                                                        </span>
                                                        {r.submissionType === "QUERY" &&
                                                            canCompleteQuery && (
                                                                <button
                                                                    type="button"
                                                                    style={styles.completeQueryBtn}
                                                                    disabled={completingId === r.id}
                                                                    onClick={() => completeQuery(r)}
                                                                >
                                                                    {completingId === r.id
                                                                        ? "Saving…"
                                                                        : "Mark completed"}
                                                                </button>
                                                            )}
                                                    </span>
                                                </div>
                                            );
                                        })
                                    )}
                                </>
                            ) : (
                                <div style={styles.mobileCardList}>
                                    {loading ? (
                                        <div style={styles.emptyNote}>Loading report…</div>
                                    ) : rows.length === 0 ? (
                                        <div style={styles.emptyNote}>
                                            No cases found for this filter.
                                        </div>
                                    ) : (
                                        rows.map((r) => {
                                            const allocPill = allocationPillProps(r);
                                            const subPill = submissionPillProps(r);
                                            const onBehalf = isOnBehalf(r);
                                            return (
                                                <div key={r.id} style={styles.mobileCard}>
                                                    <div style={styles.mobileCardHeader}>
                                                        <span style={styles.mobileCardCase}>
                                                            {r.caseNumber}
                                                        </span>
                                                        <span
                                                            style={{
                                                                ...styles.statusPill,
                                                                background: allocPill.background,
                                                                color: allocPill.color,
                                                            }}
                                                        >
                                                            {allocPill.label}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Client
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.clientName || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Subclient
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.subclientName || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Service
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.productName || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Date
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.workDate}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Allocated To
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.assignedEmployeeName ||
                                                                "Unallocated"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Allocated By
                                                        </span>
                                                        <span style={styles.mobileCardValue}>
                                                            {r.allocatedByName || "—"}
                                                        </span>
                                                    </div>
                                                    <div style={styles.mobileCardRow}>
                                                        <span style={styles.mobileCardLabel}>
                                                            Submission
                                                        </span>
                                                        <span
                                                            style={{
                                                                ...styles.statusPill,
                                                                background: subPill.background,
                                                                color: subPill.color,
                                                            }}
                                                        >
                                                            {subPill.label}
                                                        </span>
                                                    </div>
                                                    {r.submissionStatus === "SUBMITTED" &&
                                                        r.submittedByName && (
                                                            <div style={styles.mobileCardRow}>
                                                                <span
                                                                    style={styles.mobileCardLabel}
                                                                >
                                                                    Submitted By
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={
                                                                            styles.mobileCardValue
                                                                        }
                                                                    >
                                                                        {r.submittedByName}
                                                                    </span>
                                                                    {onBehalf && (
                                                                        <span
                                                                            style={
                                                                                styles.onBehalfChip
                                                                            }
                                                                        >
                                                                            On behalf
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        )}
                                                    {r.submittedAt && (
                                                        <div style={styles.mobileCardRow}>
                                                            <span style={styles.mobileCardLabel}>
                                                                Submitted Date
                                                            </span>
                                                            <span style={styles.mobileCardValue}>
                                                                {submittedDateStr(r.submittedAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {(r.submissionType === "QUERY" ||
                                                        r.queryText) && (
                                                        <div style={styles.mobileCardRow}>
                                                            <span style={styles.mobileCardLabel}>
                                                                Query
                                                            </span>
                                                            <span style={styles.mobileCardValue}>
                                                                {r.queryText || "—"}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {r.submissionType === "QUERY" &&
                                                        canCompleteQuery && (
                                                            <button
                                                                type="button"
                                                                style={styles.completeQueryBtn}
                                                                disabled={completingId === r.id}
                                                                onClick={() => completeQuery(r)}
                                                            >
                                                                {completingId === r.id
                                                                    ? "Saving…"
                                                                    : "Mark completed"}
                                                            </button>
                                                        )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                            {!loading && rows.length > 0 && (
                                <div style={styles.totalsRow}>
                                    <span style={{ flex: 1 }}>
                                        Page total ({rows.length} case{rows.length !== 1 ? "s" : ""}
                                        ){` · ${totalCount} matching in total`}
                                    </span>
                                </div>
                            )}
                            <div style={styles.paginationRow}>
                                <button
                                    type="button"
                                    style={styles.pageBtn}
                                    disabled={page <= 1}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    <i className="ti ti-chevron-left" />
                                </button>
                                <span style={styles.pageIndicator}>
                                    Page {page}
                                    {` of ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`}
                                </span>
                                <button
                                    type="button"
                                    style={styles.pageBtn}
                                    disabled={page * PAGE_SIZE >= totalCount}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    <i className="ti ti-chevron-right" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

// One simple "label ........ number" line inside a client card.
function StatRow({
    label,
    value,
    color,
}: {
    label: string;
    value: number | string;
    color: string;
}) {
    return (
        <div style={styles.statRow}>
            <span style={styles.statLabel}>
                <span style={{ ...styles.statDot, background: color }} />
                {label}
            </span>
            <span style={{ ...styles.statValue, color }}>{value}</span>
        </div>
    );
}

// Case # · Client · Subclient · Service · Date · Allocated To · Allocated By ·
// Status · Submission (170px, fits "Completed by Client") · Submitted By ·
// Submitted Date · Query
const GRID_COLS = "100px 1fr 1fr 1fr 100px 1fr 1fr 100px 170px 1fr 130px 1.3fr";

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        flex: 1,
        minHeight: "100%",
        background: "#eff4fa",
    },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 },
    headerRow: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    },
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
    exportBtn: {
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
        whiteSpace: "nowrap",
    },
    searchBar: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "10px 14px",
        boxShadow: "0 4px 16px rgba(var(--brand-blue-rgb),.06)",
        border: "1px solid #dfeaf5",
    },
    searchInputWrap: {
        position: "relative",
        flex: 1,
        display: "flex",
        alignItems: "center",
    },
    searchIcon: {
        position: "absolute",
        left: 12,
        fontSize: fontSize.md,
        color: "#9CA3AF",
        pointerEvents: "none",
    },
    searchInput: {
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 36px 10px 36px",
        borderRadius: radius.md,
        border: "1px solid #dbe6f0",
        fontSize: fontSize.sm,
        background: "#f7fafc",
        color: "#17181C",
    },
    searchClearBtn: {
        position: "absolute",
        right: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: radius.circle,
        border: "none",
        background: "#e5e9f0",
        color: "#374151",
        cursor: "pointer",
        fontSize: fontSize.xs,
    },
    searchBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 20px",
        borderRadius: radius.md,
        border: "none",
        background: GRADIENT,
        color: "#fff",
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.sm,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    filterBar: {
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        flexWrap: "wrap",
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px 18px",
        boxShadow: "0 4px 16px rgba(var(--brand-blue-rgb),.06)",
        border: "1px solid #dfeaf5",
    },
    label: {
        display: "block",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
        margin: "0 0 6px",
    },
    select: {
        padding: "9px 12px",
        borderRadius: radius.md,
        border: "1px solid #dbe6f0",
        fontSize: fontSize.sm,
        background: "#f7fafc",
        // select/date inputs had no explicit text color — invisible in
        // system dark theme.
        color: "#17181C",
        minWidth: 150,
        width: "100%",
        boxSizing: "border-box",
    },
    resetBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 16px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },

    // ---- NEW: employee-wise time (compact) ----
    empTimeCard: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "10px 16px",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    empTimeGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
    empTimeItem: {
        minWidth: 120,
        padding: "6px 12px",
        border: "1px solid #ececf5",
        borderRadius: radius.md,
        background: "#FAFBFF",
        textAlign: "left",
    },
    empTimeName: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        color: "#17181C",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: 160,
    },
    empTimeValue: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        lineHeight: 1.2,
    },

    // ---- client-wise cards (simple) ----
    cardsSection: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px 18px",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
    },
    cardsHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
    },
    cardsTitle: {
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },
    cardsHint: { fontSize: fontSize.xs, color: "#9CA3AF" },
    // Column count is set inline from useCardColumns() (4 / 2 / 1).
    // minmax(0, 1fr) stops long client names from stretching a column.
    cardsGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
    },
    clientCard: {
        background: "#fff",
        border: "1px solid #e5e9f0",
        borderLeft: "4px solid var(--brand-blue)",
        borderRadius: radius.lg,
        padding: "12px 14px",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "inherit",
        boxShadow: "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
        transition: "box-shadow .15s ease, border-color .15s ease",
        minWidth: 0,
    },
    clientCardTop: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 10,
        borderBottom: "1px dashed #e5e9f0",
    },
    clientCardName: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        flex: 1,
    },
    totalBox: {
        textAlign: "center",
        flexShrink: 0,
        background: "rgba(var(--brand-blue-rgb),0.07)",
        borderRadius: radius.md,
        padding: "5px 12px",
        minWidth: 64,
    },
    totalNum: {
        fontSize: fontSize["4xl"],
        fontWeight: fontWeight.bold,
        color: BRAND.blue,
        lineHeight: 1,
    },
    totalLbl: { fontSize: fontSize.xs, color: "#767F92", marginTop: 2 },
    statList: { display: "flex", flexDirection: "column", gap: 4 },
    statRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: fontSize.sm,
        background: "#F7F9FD",
        borderRadius: radius.sm,
        padding: "5px 10px",
    },
    statLabel: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#5b6477",
    },
    statDot: { width: 8, height: 8, borderRadius: radius.circle, flexShrink: 0 },
    statValue: { fontWeight: fontWeight.semibold, fontSize: fontSize.base },
    viewDetailsBtn: {
        width: "100%",
        padding: "7px 12px",
        borderRadius: radius.md,
        border: "1px solid rgba(var(--brand-blue-rgb),0.25)",
        background: "rgba(var(--brand-blue-rgb),0.06)",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        fontFamily: "inherit",
    },
    viewDetailsBtnActive: {
        background: GRADIENT,
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.28)",
    },

    tableWrap: { display: "flex", flexDirection: "column", gap: 10 },
    tableWrapHead: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
    },
    countNotice: {
        padding: "10px 14px",
        borderRadius: radius.md,
        background: "rgba(245,158,11,0.1)",
        color: "#92400E",
        fontSize: fontSize.sm,
    },

    tableCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        overflow: "hidden",
        overflowX: "auto",
    },
    tableHeadRow: {
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        columnGap: 16,
        padding: "10px 20px",
        background: "#F4F8FD",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        minWidth: 1700,
    },
    tableRow: {
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        columnGap: 16,
        padding: "10px 20px",
        borderTop: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#17181C",
        minWidth: 1700,
    },
    totalsRow: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 20px",
        borderTop: "2px solid #ececf5",
        background: "#FAFBFF",
        fontSize: fontSize.sm,
        color: "#374151",
        minWidth: 1700,
    },
    colCase: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colClient: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colService: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colDate: {
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colEmployee: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colAllocatedBy: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colStatus: {
        borderRight: "1px solid #eef1f6",
        paddingRight: 12,
    },
    colQuery: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "#374151",
    },
    // NEW: purple "On behalf" chip (submitted by someone other than the
    // employee the case was allocated to)
    onBehalfChip: {
        display: "inline-block",
        whiteSpace: "nowrap",
        fontSize: fontSize.xxs,
        fontWeight: fontWeight.semibold,
        color: "#7C3AED",
        background: "rgba(124,58,237,0.1)",
        borderRadius: radius.pill,
        padding: "2px 8px",
    },
    completeQueryBtn: {
        border: "1px solid rgba(var(--brand-blue-rgb),0.3)",
        background: "#fff",
        color: BRAND.blue,
        borderRadius: radius.pill,
        padding: "3px 10px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    statusPill: {
        display: "inline-flex",
        whiteSpace: "nowrap",
        padding: "3px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    mobileCardList: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
    },
    mobileCard: {
        border: "1px solid #eef1f6",
        borderRadius: radius.md,
        padding: "12px 14px",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    mobileCardHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 8,
        borderBottom: "1px solid #f1f1f1",
    },
    mobileCardCase: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },
    mobileCardRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    mobileCardLabel: {
        fontSize: fontSize.xs,
        color: "#9CA3AF",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        flexShrink: 0,
    },
    mobileCardValue: {
        fontSize: fontSize.sm,
        color: "#17181C",
        textAlign: "right",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginLeft: 12,
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
