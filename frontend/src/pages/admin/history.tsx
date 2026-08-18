// src/pages/admin/history.tsx
//
// NEW: History page (sidebar already linked to /history — was showing a
// "Coming Soon" placeholder in App.jsx until this was built). One
// filterable view across every allocation: employee-wise, service-wise,
// client-wise, subclient-wise, date-wise, and completed/pending — backed
// by GET /api/allocations/history (see allocations.controller.js).
//
// Colors are read from the app's live theme CSS variables (var(--brand-
// blue) etc., kept in sync by ThemeContext) rather than fixed hex, so
// this page — like clients.tsx/dailywork.tsx/products.tsx/manualallocation.tsx
// — reacts immediately when someone changes the theme color in Settings.

import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;
const PAGE_SIZE = 15;

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    amber: "#F59E0B",
    red: "#DC2626",
    grey: "#9CA3AF",
};
const GRADIENT = "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))";

function withAlphaVar(varName: "blue" | "lightBlue" | "green", alpha: number) {
    const slug = varName === "lightBlue" ? "light-blue" : varName;
    return `rgba(var(--brand-${slug}-rgb), ${alpha})`;
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
function daysAgoStr(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function formatDisplayDate(iso: string | null) {
    if (!iso) return "-";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

function downloadCsv(filename: string, rows: string[][]) {
    const csv = rows
        .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
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

type HistoryRow = {
    id: string;
    workDate: string | null;
    serviceId: string | number | null;
    serviceName: string | null;
    employeeId: string;
    employeeName: string | null;
    team: string | null;
    allocatedByName: string | null;
    allocatedQty: number;
    submittedQty: number | null;
    status: "COMPLETED" | "PENDING";
    submissionReason: string | null;
    submittedAt: string | null;
    clients: { id: number; name: string }[];
    subclients: { id: number; name: string }[];
};

type Option = { id: string; name: string };
type SubclientOption = Option & { clientId: string | null };

export default function History() {
    const isMobile = useIsMobile();

    // ---- filter dropdown source data ----
    const [employees, setEmployees] = useState<Option[]>([]);
    const [services, setServices] = useState<Option[]>([]);
    const [clients, setClients] = useState<Option[]>([]);
    const [subclients, setSubclients] = useState<SubclientOption[]>([]);
    const [optionsLoading, setOptionsLoading] = useState(true);

    // ---- filters ----
    const [dateFrom, setDateFrom] = useState(daysAgoStr(29));
    const [dateTo, setDateTo] = useState(todayStr());
    const [employeeId, setEmployeeId] = useState("");
    const [serviceId, setServiceId] = useState("");
    const [clientId, setClientId] = useState("");
    const [subclientId, setSubclientId] = useState("");
    const [status, setStatus] = useState<"all" | "completed" | "pending">("all");
    const [searchQuery, setSearchQuery] = useState("");

    // ---- results ----
    const [rows, setRows] = useState<HistoryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [truncated, setTruncated] = useState(false);
    const [page, setPage] = useState(1);
    const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

    // ---- load filter dropdown options once ----
    useEffect(() => {
        (async () => {
            setOptionsLoading(true);
            try {
                const [empRes, svcRes, cliRes, subRes] = await Promise.all([
                    authFetch(`${API_BASE}/api/employees`),
                    authFetch(`${API_BASE}/api/products`),
                    authFetch(`${API_BASE}/api/clients`),
                    authFetch(`${API_BASE}/api/subclients`),
                ]);
                const [empJson, svcJson, cliJson, subJson] = await Promise.all([
                    empRes.json(),
                    svcRes.json(),
                    cliRes.json(),
                    subRes.json(),
                ]);

                const empList = Array.isArray(empJson) ? empJson : empJson.data || [];
                setEmployees(
                    empList.map((e: any) => ({
                        id: e.id || e["Auth User Id"],
                        name:
                            e.name ||
                            `${e["First Name"] || ""} ${e["Last Name"] || ""}`.trim() ||
                            e.email ||
                            "Unnamed",
                    }))
                );

                const svcList = svcJson.data || svcJson || [];
                setServices(svcList.map((s: any) => ({ id: String(s.id), name: s.product_name })));

                // /api/clients returns the full client objects (not wrapped
                // in { data }) — see clients.routes.js GET "/".
                const cliList = Array.isArray(cliJson) ? cliJson : cliJson.data || [];
                setClients(cliList.map((c: any) => ({ id: String(c.id), name: c.name })));

                const subList = Array.isArray(subJson) ? subJson : subJson.data || [];
                setSubclients(
                    subList.map((s: any) => ({
                        id: String(s.id),
                        name: s.name,
                        clientId: s.clientId != null ? String(s.clientId) : null,
                    }))
                );
            } catch (err) {
                console.error("Failed to load History filter options:", err);
            } finally {
                setOptionsLoading(false);
            }
        })();
    }, []);

    // Subclient options narrow to the selected client (if any) — same
    // cascading pattern as the client/subclient rate editor on the
    // Clients page.
    const visibleSubclients = useMemo(
        () => (clientId ? subclients.filter((s) => s.clientId === clientId) : subclients),
        [subclients, clientId]
    );
    useEffect(() => {
        // If the currently-selected subclient no longer belongs to the
        // newly-selected client, clear it rather than silently filtering
        // against a subclient that's not even shown anymore.
        if (subclientId && !visibleSubclients.some((s) => s.id === subclientId)) {
            setSubclientId("");
        }
    }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- fetch history whenever filters change ----
    const fetchHistory = async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set("dateFrom", dateFrom);
            if (dateTo) params.set("dateTo", dateTo);
            if (employeeId) params.set("employeeId", employeeId);
            if (serviceId) params.set("productId", serviceId);
            if (clientId) params.set("clientId", clientId);
            if (subclientId) params.set("subclientId", subclientId);
            if (status !== "all") params.set("status", status);

            const res = await authFetch(`${API_BASE}/api/allocations/history?${params}`);
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.message || `HTTP ${res.status}`);
            }
            setRows(json.data || []);
            setTruncated(!!json.meta?.truncated);
            setPage(1);
        } catch (err: any) {
            console.error("Failed to load history:", err);
            setError(err?.message || "Failed to load history.");
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateFrom, dateTo, employeeId, serviceId, clientId, subclientId, status]);

    // ---- client-side search on top of the server-filtered rows ----
    const filteredRows = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => {
            const haystack = [
                r.employeeName,
                r.serviceName,
                r.team,
                r.allocatedByName,
                r.status,
                r.submissionReason,
                ...r.clients.map((c) => c.name),
                ...r.subclients.map((s) => s.name),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [rows, searchQuery]);

    // ---- summary stats over the currently filtered rows ----
    const stats = useMemo(() => {
        const totalAllocated = filteredRows.reduce((sum, r) => sum + (r.allocatedQty || 0), 0);
        const totalSubmitted = filteredRows.reduce((sum, r) => sum + (r.submittedQty || 0), 0);
        const completedCount = filteredRows.filter((r) => r.status === "COMPLETED").length;
        const pendingCount = filteredRows.filter((r) => r.status === "PENDING").length;
        return { totalAllocated, totalSubmitted, completedCount, pendingCount };
    }, [filteredRows]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetFilters = () => {
        setDateFrom(daysAgoStr(29));
        setDateTo(todayStr());
        setEmployeeId("");
        setServiceId("");
        setClientId("");
        setSubclientId("");
        setStatus("all");
        setSearchQuery("");
    };

    const exportCsv = () => {
        const header = [
            "Date",
            "Employee",
            "Team",
            "Service",
            "Clients",
            "Subclients",
            "Allocated By",
            "Allocated Qty",
            "Submitted Qty",
            "Status",
            "Reason",
        ];
        const body = filteredRows.map((r) => [
            formatDisplayDate(r.workDate),
            r.employeeName || "",
            r.team || "",
            r.serviceName || "",
            r.clients.map((c) => c.name).join("; "),
            r.subclients.map((s) => s.name).join("; "),
            r.allocatedByName || "",
            String(r.allocatedQty ?? ""),
            r.submittedQty === null ? "" : String(r.submittedQty),
            r.status,
            r.submissionReason || "",
        ]);
        downloadCsv(`allocation-history_${dateFrom}_to_${dateTo}.csv`, [header, ...body]);
    };

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.topBar} />

            <div style={styles.contentBody}>
                {/* Header */}
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div>
                        <h1 style={styles.pageTitle}>History</h1>
                        <p style={styles.headerSubtext}>
                            Every allocation, filterable by employee, service, client, subclient,
                            date, and status.
                        </p>
                    </div>
                    <button type="button" style={styles.exportBtn} onClick={exportCsv}>
                        <i className="ti ti-download" style={{ fontSize: fontSize.md }} />
                        Export
                    </button>
                </div>

                {/* KPI cards */}
                <div style={isMobile ? styles.kpiRowMobile : styles.kpiRow}>
                    <KpiCard
                        icon="ti ti-list-check"
                        label="Rows"
                        value={filteredRows.length}
                        footer="Matching Records"
                    />
                    <KpiCard
                        icon="ti ti-package"
                        label="Allocated"
                        value={stats.totalAllocated}
                        footer="Total Allocated Qty"
                    />
                    <KpiCard
                        icon="ti ti-circle-check"
                        label="Submitted"
                        value={stats.totalSubmitted}
                        footer={`${stats.completedCount} Completed`}
                    />
                    <KpiCard
                        icon="ti ti-clock"
                        label="Pending"
                        value={stats.pendingCount}
                        footer="Not Yet Submitted"
                    />
                </div>

                {/* Filters */}
                <div style={styles.filterPanel}>
                    <div style={isMobile ? styles.filterGridMobile : styles.filterGrid}>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>From</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                style={styles.input}
                            />
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>To</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                style={styles.input}
                            />
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>Employee</span>
                            <select
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                                style={styles.input}
                                disabled={optionsLoading}
                            >
                                <option value="">All Employees</option>
                                {employees.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>Service</span>
                            <select
                                value={serviceId}
                                onChange={(e) => setServiceId(e.target.value)}
                                style={styles.input}
                                disabled={optionsLoading}
                            >
                                <option value="">All Services</option>
                                {services.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>Client</span>
                            <select
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                style={styles.input}
                                disabled={optionsLoading}
                            >
                                <option value="">All Clients</option>
                                {clients.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>Subclient</span>
                            <select
                                value={subclientId}
                                onChange={(e) => setSubclientId(e.target.value)}
                                style={styles.input}
                                disabled={optionsLoading}
                            >
                                <option value="">All Subclients</option>
                                {visibleSubclients.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.filterField}>
                            <span style={styles.filterLabel}>Status</span>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value as any)}
                                style={styles.input}
                            >
                                <option value="all">All</option>
                                <option value="completed">Completed</option>
                                <option value="pending">Pending</option>
                            </select>
                        </label>
                        <label style={{ ...styles.filterField, flex: 2, minWidth: 220 }}>
                            <span style={styles.filterLabel}>Search</span>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search employee, service, team, client, reason..."
                                style={styles.input}
                            />
                        </label>
                        <button type="button" style={styles.resetBtn} onClick={resetFilters}>
                            <i className="ti ti-refresh" style={{ fontSize: fontSize.sm }} />
                            Reset
                        </button>
                    </div>
                </div>

                {truncated && (
                    <p style={styles.truncatedNote}>
                        <i className="ti ti-alert-triangle" style={{ fontSize: fontSize.sm }} />
                        Showing the latest 5,000 matching rows — narrow the date range or filters
                        above to see everything.
                    </p>
                )}

                {/* Table */}
                <div style={styles.tablePanel}>
                    <div style={styles.tableScroll}>
                        <table style={styles.table}>
                            <colgroup>
                                <col style={{ width: "9%" }} />
                                <col style={{ width: "14%" }} />
                                <col style={{ width: "9%" }} />
                                <col style={{ width: "14%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "13%" }} />
                                <col style={{ width: "8%" }} />
                                <col style={{ width: "8%" }} />
                                <col style={{ width: "9%" }} />
                                <col style={{ width: "13%" }} />
                            </colgroup>
                            <thead>
                                <tr style={styles.theadRow}>
                                    <th style={styles.th}>Date</th>
                                    <th style={styles.th}>Employee</th>
                                    <th style={styles.th}>Team</th>
                                    <th style={styles.th}>Service</th>
                                    <th style={styles.th}>Client</th>
                                    <th style={styles.th}>Subclient</th>
                                    <th style={styles.thNumeric}>Allocated</th>
                                    <th style={styles.thNumeric}>Submitted</th>
                                    <th style={styles.th}>Status</th>
                                    <th style={styles.th}>Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={10} style={styles.emptyState}>
                                            Loading history...
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={10} style={styles.emptyState}>
                                            {error}
                                        </td>
                                    </tr>
                                ) : pagedRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} style={styles.emptyState}>
                                            No records match these filters.
                                        </td>
                                    </tr>
                                ) : (
                                    pagedRows.map((r, idx) => (
                                        <tr
                                            key={r.id}
                                            onMouseEnter={() => setHoveredRowId(r.id)}
                                            onMouseLeave={() => setHoveredRowId(null)}
                                            style={{
                                                ...styles.tr,
                                                background:
                                                    hoveredRowId === r.id
                                                        ? "#eef2ff"
                                                        : idx % 2 === 0
                                                          ? "#fff"
                                                          : "#fafbff",
                                            }}
                                        >
                                            <td style={styles.td}>
                                                {formatDisplayDate(r.workDate)}
                                            </td>
                                            <td
                                                style={{
                                                    ...styles.td,
                                                    fontWeight: fontWeight.medium,
                                                }}
                                            >
                                                {r.employeeName || "-"}
                                            </td>
                                            <td style={styles.td}>{r.team || "-"}</td>
                                            <td style={styles.td}>{r.serviceName || "-"}</td>
                                            <td style={styles.td}>
                                                {r.clients.length
                                                    ? r.clients.map((c) => c.name).join(", ")
                                                    : "-"}
                                            </td>
                                            <td style={styles.td}>
                                                {r.subclients.length
                                                    ? r.subclients.map((s) => s.name).join(", ")
                                                    : "-"}
                                            </td>
                                            <td style={styles.tdNumeric}>{r.allocatedQty}</td>
                                            <td style={styles.tdNumeric}>
                                                {r.submittedQty === null ? "-" : r.submittedQty}
                                            </td>
                                            <td style={styles.td}>
                                                <span
                                                    style={
                                                        r.status === "COMPLETED"
                                                            ? styles.pillDone
                                                            : styles.pillPending
                                                    }
                                                >
                                                    <span
                                                        style={
                                                            r.status === "COMPLETED"
                                                                ? styles.pillDotDone
                                                                : styles.pillDotPending
                                                        }
                                                    />
                                                    {r.status === "COMPLETED"
                                                        ? "Completed"
                                                        : "Pending"}
                                                </span>
                                            </td>
                                            <td style={styles.td}>{r.submissionReason || "-"}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div style={styles.tableFooter}>
                        <span style={styles.tableFooterText}>
                            {filteredRows.length === 0
                                ? "No entries"
                                : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(
                                      page * PAGE_SIZE,
                                      filteredRows.length
                                  )} of ${filteredRows.length} entries`}
                        </span>
                        <div style={styles.pagination}>
                            <button
                                style={styles.pageBtn}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                            >
                                <i
                                    className="ti ti-chevron-left"
                                    style={{ fontSize: fontSize.md }}
                                />
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .slice(0, 5)
                                .map((n) => (
                                    <button
                                        key={n}
                                        style={{
                                            ...styles.pageBtn,
                                            ...(n === page ? styles.pageBtnActive : {}),
                                        }}
                                        onClick={() => setPage(n)}
                                    >
                                        {n}
                                    </button>
                                ))}
                            <button
                                style={styles.pageBtn}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                            >
                                <i
                                    className="ti ti-chevron-right"
                                    style={{ fontSize: fontSize.md }}
                                />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function KpiCard({
    icon,
    label,
    value,
    footer,
}: {
    icon: string;
    label: string;
    value: number | string;
    footer: string;
}) {
    return (
        <div style={styles.kpiCard}>
            <div style={styles.kpiTop}>
                <div style={styles.kpiIcon}>
                    <i className={icon} style={{ fontSize: fontSize["3xl"], color: "#fff" }} />
                </div>
                <div>
                    <div style={styles.kpiLabel}>{label}</div>
                    <div style={styles.kpiValue}>{value}</div>
                </div>
            </div>
            <div style={styles.kpiFooter}>{footer}</div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { width: "100%", minHeight: "100%", background: "#f4f5fb", fontFamily: fontFamily.base },
    rootMobile: {
        width: "100%",
        minHeight: "100%",
        background: "#f0f0f5",
        fontFamily: fontFamily.base,
    },
    topBar: { height: "4px", width: "100%", background: GRADIENT },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "20px 24px 28px",
    },

    headerRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "12px",
        flexWrap: "wrap",
    },
    headerRowMobile: { display: "flex", flexDirection: "column", gap: "10px" },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        flexShrink: 0,
        textAlign: "left",
    },
    headerSubtext: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },

    exportBtn: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#fff",
        color: BRAND.blue,
        border: `1px solid ${withAlphaVar("blue", 0.3)}`,
        borderRadius: radius.pill,
        padding: "9px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },

    kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" },
    kpiRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    kpiCard: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    kpiTop: { display: "flex", alignItems: "center", gap: "12px" },
    kpiIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        background: GRADIENT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    kpiLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: BRAND.blue },
    kpiValue: { fontSize: fontSize["4xl"], fontWeight: fontWeight.bold, color: "#1e1b4b" },
    kpiFooter: {
        fontSize: fontSize.xs,
        color: "#94a3b8",
        borderTop: "1px solid #f1f1f7",
        paddingTop: "10px",
    },

    filterPanel: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px 18px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    filterGrid: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" },
    filterGridMobile: { display: "flex", flexDirection: "column", gap: "10px" },
    filterField: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 150 },
    filterLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#64748b" },
    input: {
        border: "1px solid #e2e4f0",
        borderRadius: radius.sm,
        padding: "8px 10px",
        fontSize: fontSize.base,
        color: "#1e1b4b",
        outline: "none",
        fontFamily: "inherit",
        background: "#fafaff",
    },
    resetBtn: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#f1f5f9",
        color: "#475569",
        border: "none",
        borderRadius: radius.sm,
        padding: "9px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        height: 36,
    },

    truncatedNote: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        margin: 0,
        fontSize: fontSize.sm,
        color: "#B45309",
        background: "#fef3e2",
        border: "1px solid #fde3b0",
        borderRadius: radius.sm,
        padding: "8px 12px",
    },

    tablePanel: {
        background: "#fff",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: "1px solid #eef0f7",
        boxShadow: "0 2px 8px rgba(30,27,75,0.05)",
    },
    tableScroll: { overflowX: "auto" },
    table: { width: "100%", borderCollapse: "collapse", minWidth: 960, tableLayout: "fixed" },
    // Gradient now lives on `theadRow` so it sweeps once across the
    // whole header instead of restarting inside every <th>.
    theadRow: {
        background: GRADIENT,
    },
    th: {
        textAlign: "left",
        fontSize: fontSize.xs,
        color: "#e0e7ff",
        fontWeight: fontWeight.semibold,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        padding: "13px 14px",
        background: "transparent",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // Same as `th` but right-aligned — used for numeric columns
    // (Allocated / Submitted) so headers line up with the digits below.
    thNumeric: {
        textAlign: "right",
        fontSize: fontSize.xs,
        color: "#e0e7ff",
        fontWeight: fontWeight.semibold,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        padding: "13px 14px",
        background: "transparent",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    tr: { transition: "background 0.12s ease" },
    td: {
        textAlign: "left",
        fontSize: fontSize.base,
        color: "#374151",
        padding: "12px 14px",
        borderBottom: "1px solid #f1f1f7",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    // Pairs with `thNumeric` — keeps Allocated/Submitted values
    // aligned under their right-aligned headers.
    tdNumeric: {
        textAlign: "right",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        color: "#374151",
        padding: "12px 14px",
        borderBottom: "1px solid #f1f1f7",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    emptyState: { padding: "24px", textAlign: "center", color: "#999", fontSize: fontSize.sm },

    pillDone: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "4px 11px",
        borderRadius: radius.pill,
        background: withAlphaVar("green", 0.14),
        color: BRAND.green,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    pillPending: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "4px 11px",
        borderRadius: radius.pill,
        background: "#fef3e2",
        color: "#B45309",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
    },
    pillDotDone: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: BRAND.green,
        flexShrink: 0,
    },
    pillDotPending: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#B45309",
        flexShrink: 0,
    },

    tableFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 18px",
        borderTop: "1px solid #f1f1f7",
        flexWrap: "wrap",
        gap: "10px",
    },
    tableFooterText: { fontSize: fontSize.xs, color: "#94a3b8" },
    pagination: { display: "flex", gap: "6px" },
    pageBtn: {
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    pageBtnActive: { background: GRADIENT, color: "#fff", border: "none" },
};
