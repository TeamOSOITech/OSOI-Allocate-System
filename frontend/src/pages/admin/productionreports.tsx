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
// BACKEND ASSUMPTIONS (please confirm/adjust to match your actual API):
//   GET /api/service-cases supports these query params:
//     - productId          (single service id)
//     - fromDate, toDate   (workDate range, inclusive, YYYY-MM-DD)
//     - employeeId         (assignedEmployeeId)
//     - allocationStatus   (PENDING | ALLOCATED)
//     - clientName         (partial/ILIKE match)
//     - page, pageSize
//   Response rows additionally include `quantity` and `amount` fields
//   (numbers) — same as whatever Daily Work / Case Register already
//   stores per case. If your field names differ, just rename below.
//
// For export, we re-call the same endpoint with a very large pageSize
// (no server-side "export all" endpoint assumed). If you'd rather add a
// dedicated /api/service-cases/export route that streams everything in
// one shot, swap out fetchAllMatchingForExport() only — nothing else
// needs to change.

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 15;
const EXPORT_PAGE_SIZE = 5000; // fetched in batches until a short page comes back
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

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = { id: string; product_name: string };
type Employee = { id: string; name: string; employeeCode: string | null };

type ServiceCaseRow = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    allocationStatus: "PENDING" | "ALLOCATED";
    quantity: number | null;
    amount: number | null;
};

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

export default function ProductionReport() {
    const isMobile = useIsMobile();
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);

    // filters
    const [productId, setProductId] = useState("");
    const [fromDate, setFromDate] = useState(firstOfMonthStr());
    const [toDate, setToDate] = useState(todayStr());
    const [employeeId, setEmployeeId] = useState("");
    const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "ALLOCATED">("");
    const [clientName, setClientName] = useState("");
    const [clientNameInput, setClientNameInput] = useState(""); // debounced input

    const [rows, setRows] = useState<ServiceCaseRow[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);
    const [toast, setToast] = useState("");

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // debounce client name search
    useEffect(() => {
        const t = setTimeout(() => setClientName(clientNameInput.trim()), 400);
        return () => clearTimeout(t);
    }, [clientNameInput]);

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

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
    }, [fetchProducts, fetchEmployees]);

    const buildParams = useCallback(
        (forExport: boolean, exportPage = 1) => {
            const params = new URLSearchParams();
            params.set("page", String(forExport ? exportPage : page));
            params.set("pageSize", String(forExport ? EXPORT_PAGE_SIZE : PAGE_SIZE));
            if (productId) params.set("productId", productId);
            if (fromDate) params.set("fromDate", fromDate);
            if (toDate) params.set("toDate", toDate);
            if (employeeId) params.set("employeeId", employeeId);
            if (statusFilter) params.set("allocationStatus", statusFilter);
            if (clientName) params.set("clientName", clientName);
            return params;
        },
        [page, productId, fromDate, toDate, employeeId, statusFilter, clientName]
    );

    const fetchReport = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = buildParams(false);
            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setRows(json.data || []);
            setTotalCount(typeof json.totalCount === "number" ? json.totalCount : null);
        } catch (err: any) {
            setError(err?.message || "Failed to load production report.");
        } finally {
            setLoading(false);
        }
    }, [buildParams]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    useEffect(() => {
        setPage(1);
    }, [productId, fromDate, toDate, employeeId, statusFilter, clientName]);

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
                Service: r.productName || "",
                Date: r.workDate,
                Employee: r.assignedEmployeeName || "Unallocated",
                Status: r.allocationStatus === "ALLOCATED" ? "Allocated" : "Pending",
            }));

            const ws = XLSX.utils.json_to_sheet(sheetData);
            ws["!cols"] = [
                { wch: 14 }, // Case #
                { wch: 22 }, // Client
                { wch: 16 }, // Service
                { wch: 12 }, // Date
                { wch: 18 }, // Employee
                { wch: 12 }, // Status
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

    const resetFilters = () => {
        setProductId("");
        setFromDate(firstOfMonthStr());
        setToDate(todayStr());
        setEmployeeId("");
        setStatusFilter("");
        setClientNameInput("");
        setClientName("");
    };

    // On the 2-column mobile filter grid, select/input's fixed minWidth
    // (150px, meant for the desktop flex-wrap row) can exceed the
    // actual column width on narrow screens and push content past the
    // card's edge. Drop it to 0 on mobile so fields shrink to fit.
    const filterFieldStyle = isMobile ? { ...styles.select, minWidth: 0 } : styles.select;

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
                    <div style={isMobile ? { gridColumn: "1 / -1" } : { flex: 1, minWidth: 180 }}>
                        <label style={styles.label}>Client</label>
                        <input
                            type="text"
                            placeholder="Search client…"
                            style={filterFieldStyle}
                            value={clientNameInput}
                            onChange={(e) => setClientNameInput(e.target.value)}
                        />
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

                <div style={styles.tableCard}>
                    <div style={styles.tableHeadRow}>
                        <span style={styles.colCase}>Case #</span>
                        <span style={styles.colClient}>Client</span>
                        <span style={styles.colService}>Service</span>
                        <span style={styles.colDate}>Date</span>
                        <span style={styles.colEmployee}>Employee</span>
                        <span style={styles.colStatus}>Status</span>
                    </div>
                    {loading ? (
                        <div style={styles.emptyNote}>Loading report…</div>
                    ) : rows.length === 0 ? (
                        <div style={styles.emptyNote}>No cases found for this filter.</div>
                    ) : (
                        rows.map((r) => (
                            <div key={r.id} style={styles.tableRow}>
                                <span style={styles.colCase}>{r.caseNumber}</span>
                                <span style={styles.colClient}>{r.clientName || "—"}</span>
                                <span style={styles.colService}>{r.productName || "—"}</span>
                                <span style={styles.colDate}>{r.workDate}</span>
                                <span style={styles.colEmployee}>
                                    {r.assignedEmployeeName || "Unallocated"}
                                </span>
                                <span style={styles.colStatus}>
                                    <span
                                        style={{
                                            ...styles.statusPill,
                                            background:
                                                r.allocationStatus === "ALLOCATED"
                                                    ? "rgba(var(--brand-green-rgb),0.12)"
                                                    : "rgba(156,163,175,0.15)",
                                            color:
                                                r.allocationStatus === "ALLOCATED"
                                                    ? BRAND.green
                                                    : BRAND.grey,
                                        }}
                                    >
                                        {r.allocationStatus === "ALLOCATED"
                                            ? "Allocated"
                                            : "Pending"}
                                    </span>
                                </span>
                            </div>
                        ))
                    )}
                    {!loading && rows.length > 0 && (
                        <div style={styles.totalsRow}>
                            <span style={{ flex: 1 }}>
                                Page total ({rows.length} case{rows.length !== 1 ? "s" : ""})
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
                            {totalCount !== null
                                ? ` of ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`
                                : ""}
                        </span>
                        <button
                            type="button"
                            style={styles.pageBtn}
                            disabled={rows.length < PAGE_SIZE}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            <i className="ti ti-chevron-right" />
                        </button>
                    </div>
                </div>
            </div>

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

const GRID_COLS = "100px 1fr 1fr 100px 1fr 100px";

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column" },
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
        fontWeight: fontWeight.bold,
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
        minWidth: 900,
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
        minWidth: 900,
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
        minWidth: 900,
    },
    colCase: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    colClient: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    colService: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    colDate: { whiteSpace: "nowrap" },
    colEmployee: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    colStatus: {},
    statusPill: {
        display: "inline-flex",
        padding: "3px 10px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
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
