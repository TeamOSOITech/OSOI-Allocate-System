import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, FormEvent } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 10;
const MOBILE_BREAKPOINT = 768;
// Manual Entry mode: how many case numbers can be typed in and
// submitted together in one go.
const MAX_MANUAL_CASE_NUMBERS = 10;

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

function withBrandAlpha(varName: "blue" | "lightBlue" | "green", alpha: number) {
    const rgbVar =
        varName === "blue"
            ? "--brand-blue-rgb"
            : varName === "lightBlue"
              ? "--brand-light-blue-rgb"
              : "--brand-green-rgb";
    return `rgba(var(${rgbVar}), ${alpha})`;
}

function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDisplayDate(iso: string) {
    const [y, m, d] = (iso || "").split("-");
    if (!y || !m || !d) return iso;
    return `${d}-${m}-${y}`;
}

// NEW: numbered pagination (1, 2, 3, … , last) with ellipsis — matches
// the "Showing X to Y of Z" + numbered-buttons pagination style used
// elsewhere in the redesigned Case Register table.
function getPageNumbers(current: number, total: number): (number | "...")[] {
    const delta = 1;
    const range: number[] = [];
    for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
            range.push(i);
        }
    }
    const withDots: (number | "...")[] = [];
    let last: number | undefined;
    range.forEach((i) => {
        if (last !== undefined) {
            if (i - last === 2) withDots.push(last + 1);
            else if (i - last > 2) withDots.push("...");
        }
        withDots.push(i);
        last = i;
    });
    return withDots;
}

type Product = { id: string; product_name: string };
type Client = { id: string; name: string };
// NEW: Subclient — id + name + which client it belongs to, used to
// filter the dropdown to whichever client a row/form currently has.
type Subclient = { id: string; name: string; clientId: string };
type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientId: string | null;
    clientName: string | null;
    subclientId: string | null;
    subclientName: string | null;
    workDate: string;
    sequenceNumber: number;
    createdAt: string;
};

// NEW: small presentational card for the KPI row — same look as the
// KpiCard used on the Daily Work tab.
function KpiCard({
    icon,
    iconBg,
    label,
    value,
    footer,
    dotColor,
    styles,
}: {
    icon: string;
    iconBg: string;
    label: string;
    value: number | string;
    footer: string;
    dotColor: string;
    styles: Record<string, CSSProperties>;
}) {
    return (
        <div style={styles.kpiCard}>
            <div style={styles.kpiTop}>
                <div style={{ ...styles.kpiIcon, background: iconBg }}>
                    <i className={icon} style={{ fontSize: fontSize["3xl"], color: "#fff" }} />
                </div>
                <div>
                    <div style={styles.kpiLabel}>{label}</div>
                    <div style={styles.kpiValue}>{value}</div>
                </div>
            </div>
            <div style={styles.kpiFooter}>
                <span>{footer}</span>
                <span style={{ ...styles.kpiDot, background: dotColor }}>
                    <i
                        className="ti ti-arrow-right"
                        style={{ fontSize: fontSize.xxs, color: "#fff" }}
                    />
                </span>
            </div>
        </div>
    );
}

// NEW: KPI figures passed down from the parent (Daily Work) page — this
// tab shows the same org-wide Services/Allocated/Pending/Employees
// numbers, not separate Case-Register-only figures.
type ServiceCasesKpi = {
    services: number;
    allocated: number;
    pending: number;
    employees: number | null;
};

export default function ServiceCases({ kpi }: { kpi?: ServiceCasesKpi } = {}) {
    const isMobile = useIsMobile();
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    // NEW: Case Register — Client column. Fetched once, same list the
    // Clients page uses, just for the inline dropdown here.
    const [clients, setClients] = useState<Client[]>([]);
    // NEW: Subclient column — org-wide list, filtered client-side to
    // whichever client a given row/form has selected.
    const [subclients, setSubclients] = useState<Subclient[]>([]);

    // ---- left side: same shape as Daily Work's form (service + qty) ----
    const [workDate, setWorkDate] = useState(todayStr());
    const [productId, setProductId] = useState("");
    // NEW: pick the Client at creation time too — still editable later
    // from the table, this just saves that extra edit for the common case.
    const [formClientId, setFormClientId] = useState("");
    // NEW: Subclient picked alongside Client — cleared automatically
    // whenever the Client selection changes (see the effect below).
    const [formSubclientId, setFormSubclientId] = useState("");
    // Manual entry: the person types the actual case number(s) instead
    // of the system auto-generating them — one per line (or comma
    // separated), up to MAX_MANUAL_CASE_NUMBERS at once.
    const [caseNumbersText, setCaseNumbersText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const [formSuccess, setFormSuccess] = useState("");

    // ---- "Manual Entry" (type the case number(s) yourself) vs "Upload"
    // (bring in custom/random case numbers via an Excel sheet) — for
    // orgs that already have their own case numbering (e.g. a
    // client-provided case ID). Service + Date still come from the same
    // dropdown/date picker either way.
    const [formMode, setFormMode] = useState<"manual" | "upload">("manual");
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadResult, setUploadResult] = useState<{
        createdCount: number;
        skippedCount: number;
        totalRows: number;
    } | null>(null);

    // ---- right side: individual case rows, filterable + paginated ----
    const [cases, setCases] = useState<ServiceCase[]>([]);
    const [casesLoading, setCasesLoading] = useState(true);
    const [casesError, setCasesError] = useState("");
    const [filterProductId, setFilterProductId] = useState("");
    // NEW: Case Register search box — searches Case Number, Service,
    // Client, and Subclient names (and the date column) via the
    // backend's `search` param, so it works across every page of
    // results, not just whatever 10 rows happen to be on screen.
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCases, setTotalCases] = useState(0);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState("");
    // NEW: Case Register — inline Client edit. Tracks which row's
    // dropdown is mid-save so it can be disabled/greyed while saving.
    const [savingClientId, setSavingClientId] = useState<string | null>(null);
    // NEW: separate saving flag for the Subclient dropdown, since it
    // can be edited independently of the Client dropdown.
    const [savingSubclientId, setSavingSubclientId] = useState<string | null>(null);
    const [clientEditError, setClientEditError] = useState("");
    // NEW: Client/Subclient cells now render as plain text by default —
    // clicking the pencil icon on a row switches just that row's
    // Client/Subclient cells into editable dropdowns.
    const [editingRowId, setEditingRowId] = useState<string | null>(null);
    // NEW: multi-select for bulk delete — a "Select all" checkbox in the
    // header plus a per-row checkbox on the left of every row.
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // NEW: bulk-select mode is off by default — checkboxes only appear
    // once the "Select" button (next to the service filter) is clicked.
    // Turning it off again also clears whatever was checked.
    const [selectMode, setSelectMode] = useState(false);
    const toggleSelectMode = () => {
        setSelectMode((prev) => {
            if (prev) setSelectedIds(new Set());
            return !prev;
        });
    };
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const fetchProducts = useCallback(async () => {
        setProductsLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/products`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
            setProducts(json.data || []);
        } catch (err) {
            console.error("Failed to fetch products:", err);
        } finally {
            setProductsLoading(false);
        }
    }, []);

    // NEW: Case Register — Client column dropdown options.
    const fetchClients = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/clients`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // NOTE: /api/clients returns a raw array (no {success, data}
            // envelope), same as clients.tsx already assumes.
            const json = await res.json();
            const list = Array.isArray(json) ? json : json?.data || [];
            // FIX: clients.id is an integer column, so this comes back as
            // a JS number — but every <select>'s value (and the case
            // list's clientId from /api/service-cases) is always a
            // string. Comparing a number to a string is always false,
            // which was silently breaking the Subclient filter below.
            // Normalizing every id to a string here, once, up front,
            // means every comparison downstream just works.
            setClients(list.map((c: any) => ({ id: String(c.id), name: c.name })));
        } catch (err) {
            console.error("Failed to fetch clients:", err);
        }
    }, []);

    // NEW: Subclient column dropdown options — org-wide, filtered by
    // client client-side wherever it's rendered.
    const fetchSubclients = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/clients/all/subclients`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const list = Array.isArray(json) ? json : json?.data || [];
            // FIX: same string-normalization as fetchClients above —
            // clientId here is also an integer from the DB.
            setSubclients(
                list.map((s: any) => ({
                    id: String(s.id),
                    name: s.name,
                    clientId: String(s.clientId),
                }))
            );
        } catch (err) {
            console.error("Failed to fetch subclients:", err);
        }
    }, []);

    // NEW: search box is debounced 350ms so it doesn't fire a request on
    // every single keystroke — same idea as any typeahead search. The
    // page reset to 1 happens in this SAME callback (not a separate
    // effect) so React batches them into one render — otherwise the
    // table briefly re-fetches with the OLD page number + NEW search
    // term, which can ask the backend for a page that no longer exists
    // once results are filtered down (a 416 "Requested range not
    // satisfiable" error) before the corrected page-1 fetch lands.
    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedSearch(searchQuery.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const fetchCases = useCallback(async () => {
        setCasesLoading(true);
        setCasesError("");
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("pageSize", String(PAGE_SIZE));
            if (filterProductId) params.set("productId", filterProductId);
            if (debouncedSearch) params.set("search", debouncedSearch);

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            // FIX: same string-normalization as clients/subclients above
            // — client_id/subclient_id are integer DB columns, so this
            // JSON has them as numbers. Every dropdown's value (and the
            // clients/subclients lists themselves) are strings, so this
            // keeps every id comparison in this file consistent.
            setCases(
                (json.data || []).map((row: any) => ({
                    ...row,
                    clientId: row.clientId != null ? String(row.clientId) : null,
                    subclientId: row.subclientId != null ? String(row.subclientId) : null,
                }))
            );
            setTotalPages(json.pagination?.totalPages || 1);
            setTotalCases(json.pagination?.total || 0);
            // NEW: if the backend had to clamp an out-of-range page
            // (e.g. a filter/search cut results down while we were on
            // page 3), sync local state to match so the pager UI and
            // any subsequent fetch use the corrected page too.
            if (json.pagination?.page && json.pagination.page !== page) {
                setPage(json.pagination.page);
            }
        } catch (err: any) {
            console.error("Failed to fetch service cases:", err);
            setCasesError(err?.message || "Failed to load cases.");
        } finally {
            setCasesLoading(false);
        }
    }, [page, filterProductId, debouncedSearch]);

    useEffect(() => {
        fetchProducts();
        fetchClients();
        fetchSubclients();
    }, [fetchProducts, fetchClients, fetchSubclients]);

    // NEW: Subclient must always belong to the currently selected form
    // Client — clear it out whenever Client changes so a stale
    // subclient from a previous client can't silently get submitted.
    useEffect(() => {
        setFormSubclientId("");
    }, [formClientId]);

    // Filter dropdown defaults to "All" — every service's cases show
    // together until the user picks a specific one.
    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    // NEW: whenever the page's row list changes (new page, filter change,
    // refetch after a delete), drop any selections that no longer exist
    // on screen — keeps "Select all" and the bulk-delete count honest.
    useEffect(() => {
        setSelectedIds((prev) => {
            const visibleIds = new Set(cases.map((c) => c.id));
            const next = new Set<string>();
            prev.forEach((id) => {
                if (visibleIds.has(id)) next.add(id);
            });
            return next.size === prev.size ? prev : next;
        });
    }, [cases]);

    const toggleSelectAll = () => {
        setSelectedIds((prev) =>
            prev.size === cases.length ? new Set() : new Set(cases.map((c) => c.id))
        );
    };

    const toggleSelectOne = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Splits the textarea on newlines AND commas, trims each entry, and
    // drops blanks — lets people paste either "one per line" or
    // "comma, separated, values" and have it just work.
    const parseCaseNumbers = (text: string) =>
        text
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");

        if (!productId) {
            setFormError("Select a service.");
            return;
        }
        const caseNumbers = parseCaseNumbers(caseNumbersText);
        if (caseNumbers.length === 0) {
            setFormError("Type at least one case number.");
            return;
        }
        if (caseNumbers.length > MAX_MANUAL_CASE_NUMBERS) {
            setFormError(
                `You can enter up to ${MAX_MANUAL_CASE_NUMBERS} case numbers at once — you typed ${caseNumbers.length}.`
            );
            return;
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/manual`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId,
                    caseNumbers,
                    workDate,
                    clientId: formClientId || null,
                    subclientId: formSubclientId || null,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to create cases");
            setFormSuccess(json.message || "Cases created.");
            setUploadResult(json.data || null);
            setCaseNumbersText("");
            // Switch the filter to the service just logged, so the newly
            // created cases are immediately visible (services are always
            // shown separately now, never mixed together).
            setFilterProductId(productId);
            setPage(1);
            fetchCases();
        } catch (err: any) {
            setFormError(err?.message || "Something went wrong.");
        } finally {
            setSubmitting(false);
        }
    };

    // NEW: sample .xlsx download for Upload mode — Case Number, Client
    // Name, Subclient Name columns, so the long explanatory paragraph
    // that used to live in the form isn't needed anymore.
    const handleDownloadTemplate = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/upload/template`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "case_register_upload_template.xlsx";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to download template:", err);
        }
    };

    const handleUploadSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");
        setUploadResult(null);

        if (!productId) {
            setFormError("Select a service.");
            return;
        }
        if (!uploadFile) {
            setFormError("Choose a file to upload.");
            return;
        }

        setSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("file", uploadFile);
            formData.append("productId", productId);
            formData.append("workDate", workDate);
            // NOTE: Client/Subclient are NOT sent here in Upload mode —
            // they're now resolved per row from the sheet's own "Client
            // Name" / "Subclient Name" columns on the backend.

            const res = await authFetch(`${API_BASE}/api/service-cases/upload`, {
                method: "POST",
                body: formData,
            });
            // The server can 404/500 with an HTML error page instead of
            // JSON (e.g. if this endpoint isn't deployed on the backend
            // yet) — res.json() would throw a confusing raw parse error
            // in that case, so check the content-type first and surface
            // a clear message instead.
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(
                    res.status === 404
                        ? "Upload endpoint not found (HTTP 404) — the backend may not have this feature deployed yet."
                        : `Server returned an unexpected response (HTTP ${res.status}).`
                );
            }
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to upload cases");
            setFormSuccess(json.message || "Cases uploaded.");
            setUploadResult(json.data || null);
            setUploadFile(null);
            setFilterProductId(productId);
            setPage(1);
            fetchCases();
        } catch (err: any) {
            setFormError(err?.message || "Something went wrong.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (c: ServiceCase) => {
        if (!window.confirm(`Delete ${c.caseNumber}? This can't be undone.`)) return;
        setDeleteError("");
        setDeletingId(c.id);
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to delete");
            // If this was the only row on the current page (and we're not
            // on page 1), step back a page so we don't land on an empty one.
            if (cases.length === 1 && page > 1) {
                setPage((p) => p - 1);
            } else {
                fetchCases();
            }
        } catch (err: any) {
            setDeleteError(err?.message || "Failed to delete case");
        } finally {
            setDeletingId(null);
        }
    };

    // NEW: bulk delete — reuses the same single-case DELETE endpoint for
    // every selected id (no dedicated bulk endpoint on the backend), run
    // in parallel and reported together.
    const handleBulkDelete = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (
            !window.confirm(
                `Delete ${ids.length} selected case${ids.length > 1 ? "s" : ""}? This can't be undone.`
            )
        )
            return;
        setDeleteError("");
        setBulkDeleting(true);
        try {
            const results = await Promise.allSettled(
                ids.map((id) =>
                    authFetch(`${API_BASE}/api/service-cases/${id}`, { method: "DELETE" }).then(
                        async (res) => {
                            const json = await res.json();
                            if (!res.ok || !json.success)
                                throw new Error(json?.message || "Failed to delete");
                        }
                    )
                )
            );
            const failedCount = results.filter((r) => r.status === "rejected").length;
            if (failedCount > 0) {
                setDeleteError(
                    `${failedCount} of ${ids.length} case${ids.length > 1 ? "s" : ""} couldn't be deleted.`
                );
            }
            setSelectedIds(new Set());
            // Same "don't land on an empty page" guard as the single delete.
            if (ids.length >= cases.length && page > 1) {
                setPage((p) => p - 1);
            } else {
                fetchCases();
            }
        } finally {
            setBulkDeleting(false);
        }
    };

    // NEW: Case Register — inline Client edit. Changing Client also
    // clears Subclient (old subclient belonged to the previous client
    // and can't be assumed valid under the new one) — same rule the
    // backend enforces.
    const handleClientChange = async (c: ServiceCase, newClientId: string) => {
        setClientEditError("");
        setSavingClientId(c.id);
        // Optimistic update so the dropdown reflects the choice immediately.
        const prevClientId = c.clientId;
        const prevClientName = c.clientName;
        const prevSubclientId = c.subclientId;
        const prevSubclientName = c.subclientName;
        const newClientName = clients.find((cl) => cl.id === newClientId)?.name || null;
        setCases((prev) =>
            prev.map((row) =>
                row.id === c.id
                    ? {
                          ...row,
                          clientId: newClientId || null,
                          clientName: newClientName,
                          subclientId: null,
                          subclientName: null,
                      }
                    : row
            )
        );
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}/client`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: newClientId || null, subclientId: null }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to update client");
        } catch (err: any) {
            // Roll back on failure.
            setCases((prev) =>
                prev.map((row) =>
                    row.id === c.id
                        ? {
                              ...row,
                              clientId: prevClientId,
                              clientName: prevClientName,
                              subclientId: prevSubclientId,
                              subclientName: prevSubclientName,
                          }
                        : row
                )
            );
            setClientEditError(err?.message || "Failed to update client");
        } finally {
            setSavingClientId(null);
        }
    };

    // NEW: Case Register — inline Subclient edit. Independent of the
    // Client edit above; only touches subclient_id.
    const handleSubclientChange = async (c: ServiceCase, newSubclientId: string) => {
        setClientEditError("");
        setSavingSubclientId(c.id);
        const prevSubclientId = c.subclientId;
        const prevSubclientName = c.subclientName;
        const newSubclientName = subclients.find((s) => s.id === newSubclientId)?.name || null;
        setCases((prev) =>
            prev.map((row) =>
                row.id === c.id
                    ? {
                          ...row,
                          subclientId: newSubclientId || null,
                          subclientName: newSubclientName,
                      }
                    : row
            )
        );
        try {
            const res = await authFetch(`${API_BASE}/api/service-cases/${c.id}/client`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subclientId: newSubclientId || null }),
            });
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || "Failed to update subclient");
        } catch (err: any) {
            setCases((prev) =>
                prev.map((row) =>
                    row.id === c.id
                        ? { ...row, subclientId: prevSubclientId, subclientName: prevSubclientName }
                        : row
                )
            );
            setClientEditError(err?.message || "Failed to update subclient");
        } finally {
            setSavingSubclientId(null);
        }
    };

    const styles = getStyles(isMobile);

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                {/* ---- header ---- */}
                <div style={styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div>
                            <h1 style={styles.pageTitle}>Daily Work</h1>
                            <p style={styles.headerSubtext}>
                                Log a service and type in the case number(s) yourself — up to{" "}
                                {MAX_MANUAL_CASE_NUMBERS} at once.
                            </p>
                        </div>
                    </div>

                    {!isMobile && (
                        <div style={styles.breadcrumb}>
                            <i className="ti ti-home" style={{ fontSize: fontSize.md }} />
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbItem}>Dashboard</span>
                            <span style={styles.breadcrumbSep}>/</span>
                            <span style={styles.breadcrumbActive}>Case Register</span>
                        </div>
                    )}
                </div>

                {/* NEW: same KPI row as the Daily Work tab — Services /
                    Allocated / Pending / Employees, using the figures
                    passed down from the parent page. */}
                {kpi && (
                    <div style={styles.kpiRow}>
                        <KpiCard
                            styles={styles}
                            icon="ti ti-package"
                            iconBg="linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))"
                            label="Services"
                            value={kpi.services}
                            footer="Total Services"
                            dotColor="var(--brand-blue)"
                        />
                        <KpiCard
                            styles={styles}
                            icon="ti ti-users"
                            iconBg="linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))"
                            label="Allocated"
                            value={kpi.allocated}
                            footer="Total Allocated"
                            dotColor="var(--brand-light-blue)"
                        />
                        <KpiCard
                            styles={styles}
                            icon="ti ti-check"
                            iconBg="linear-gradient(135deg, #34d399, #059669)"
                            label="Pending"
                            value={kpi.pending}
                            footer="Total Pending"
                            dotColor="#059669"
                        />
                        <KpiCard
                            styles={styles}
                            icon="ti ti-users-group"
                            iconBg="linear-gradient(135deg, #c084fc, #9333ea)"
                            label="Employees"
                            value={kpi.employees ?? "-"}
                            footer="Total Employees"
                            dotColor="#9333ea"
                        />
                    </div>
                )}

                <div style={styles.layout}>
                    {/* ---- LEFT: add form (same shape as Daily Work) ---- */}
                    <div style={styles.formPanel}>
                        <div style={styles.formPanelHeader}>
                            <i className="ti ti-list-numbers" style={{ fontSize: fontSize.xl }} />
                            <span style={{ flex: 1 }}>Log Cases</span>
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                style={styles.headerGhostBtn}
                                title="Sample sheet for case-number upload (.xlsx)"
                            >
                                <i
                                    className="ti ti-file-spreadsheet"
                                    style={{ fontSize: fontSize.base }}
                                />
                            </button>
                        </div>

                        <form
                            style={styles.form}
                            onSubmit={formMode === "manual" ? handleSubmit : handleUploadSubmit}
                        >
                            {/* Mode toggle — Manual Entry (type the case number(s)
                            yourself, up to MAX_MANUAL_CASE_NUMBERS at once) vs
                            Upload (custom case numbers from an Excel/CSV sheet,
                            for orgs with their own numbering). */}
                            <div style={styles.modeToggleRow}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.modeToggleBtn,
                                        ...(formMode === "manual"
                                            ? styles.modeToggleBtnActive
                                            : {}),
                                    }}
                                    onClick={() => {
                                        setFormMode("manual");
                                        setFormError("");
                                        setFormSuccess("");
                                        setUploadResult(null);
                                    }}
                                >
                                    Manual Entry
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.modeToggleBtn,
                                        ...(formMode === "upload"
                                            ? styles.modeToggleBtnActive
                                            : {}),
                                    }}
                                    onClick={() => {
                                        setFormMode("upload");
                                        setFormError("");
                                        setFormSuccess("");
                                        setUploadResult(null);
                                    }}
                                >
                                    Upload Case Numbers
                                </button>
                            </div>

                            <label style={styles.label}>Date</label>
                            <input
                                type="date"
                                style={styles.input}
                                value={workDate}
                                onChange={(e) => setWorkDate(e.target.value)}
                            />

                            <label style={styles.label}>Service</label>
                            <select
                                style={styles.input}
                                value={productId}
                                onChange={(e) => setProductId(e.target.value)}
                                disabled={productsLoading}
                            >
                                <option value="">-- Select service --</option>
                                {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.product_name}
                                    </option>
                                ))}
                            </select>

                            {formMode === "manual" ? (
                                <>
                                    <label style={styles.label}>Client</label>
                                    <select
                                        style={styles.input}
                                        value={formClientId}
                                        onChange={(e) => setFormClientId(e.target.value)}
                                    >
                                        <option value="">-- Select client --</option>
                                        {clients.map((cl) => (
                                            <option key={cl.id} value={cl.id}>
                                                {cl.name}
                                            </option>
                                        ))}
                                    </select>

                                    <label style={styles.label}>Subclient</label>
                                    <select
                                        style={styles.input}
                                        value={formSubclientId}
                                        onChange={(e) => setFormSubclientId(e.target.value)}
                                        disabled={!formClientId}
                                    >
                                        <option value="">
                                            {formClientId
                                                ? "-- Select subclient --"
                                                : "-- Select client first --"}
                                        </option>
                                        {subclients
                                            .filter((s) => s.clientId === formClientId)
                                            .map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                    </select>
                                    <p style={styles.helperNote}>
                                        Optional — editable later from the table too.
                                    </p>
                                </>
                            ) : (
                                <p style={styles.helperNote}>
                                    Client &amp; Subclient come from the file — see Sample Excel
                                    above.
                                </p>
                            )}

                            {formMode === "manual" ? (
                                <>
                                    <label style={styles.label}>Case Numbers</label>
                                    <textarea
                                        style={{ ...styles.input, ...styles.caseNumbersTextarea }}
                                        value={caseNumbersText}
                                        onChange={(e) => setCaseNumbersText(e.target.value)}
                                        placeholder={`Type one case number per line\n(or comma-separated) — up to ${MAX_MANUAL_CASE_NUMBERS} at once`}
                                        rows={5}
                                    />
                                    <p style={styles.helperNote}>
                                        One row is created per case number typed — up to{" "}
                                        {MAX_MANUAL_CASE_NUMBERS} at a time. One per line or
                                        comma-separated both work.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <label style={styles.label}>Case Numbers File</label>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        style={styles.input}
                                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                    />
                                    <p style={styles.helperNote}>
                                        Duplicate or already-used case numbers are skipped and
                                        reported below.
                                    </p>
                                </>
                            )}

                            {formError && <p style={styles.errorText}>{formError}</p>}
                            {formSuccess && <p style={styles.successText}>{formSuccess}</p>}
                            {uploadResult && uploadResult.skippedCount > 0 && (
                                <p style={styles.helperNote}>
                                    {uploadResult.createdCount} created, {uploadResult.skippedCount}{" "}
                                    skipped out of {uploadResult.totalRows} row(s).
                                </p>
                            )}

                            <button
                                type="submit"
                                style={{ ...styles.submitBtn, opacity: submitting ? 0.6 : 1 }}
                                disabled={submitting}
                            >
                                <i className="ti ti-plus" style={{ fontSize: fontSize.md }} />
                                {submitting
                                    ? formMode === "manual"
                                        ? "Creating..."
                                        : "Uploading..."
                                    : formMode === "manual"
                                      ? "Create Cases"
                                      : "Upload Cases"}
                            </button>
                        </form>
                    </div>

                    {/* ---- RIGHT: case list — filter + pagination ---- */}
                    <div style={styles.tableCard}>
                        <div style={styles.tableToolbar}>
                            <p style={styles.cardHeading}>
                                Cases{" "}
                                {totalCases > 0 && (
                                    <span style={styles.countBadge}>{totalCases}</span>
                                )}
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {/* NEW: appears only once at least one row is
                                    checked — bulk-deletes every selected case. */}
                                {selectMode && selectedIds.size > 0 && (
                                    <button
                                        type="button"
                                        style={{
                                            ...styles.bulkDeleteBtn,
                                            opacity: bulkDeleting ? 0.6 : 1,
                                            cursor: bulkDeleting ? "not-allowed" : "pointer",
                                        }}
                                        disabled={bulkDeleting}
                                        onClick={handleBulkDelete}
                                    >
                                        <i
                                            className="ti ti-trash"
                                            style={{ fontSize: fontSize.sm }}
                                        />
                                        {bulkDeleting
                                            ? "Deleting…"
                                            : `Delete Selected (${selectedIds.size})`}
                                    </button>
                                )}
                                {/* NEW: searches Case Number, Service, Client, and
                                    Subclient (and the date) across every page of
                                    results — not just the 10 rows on screen. */}
                                <div style={styles.searchBox}>
                                    <i
                                        className="ti ti-search"
                                        style={{ fontSize: fontSize.sm, color: "#94a3b8" }}
                                    />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search case no, client, service, date..."
                                        style={styles.searchInput}
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery("")}
                                            style={styles.searchClearBtn}
                                            aria-label="Clear search"
                                        >
                                            <i
                                                className="ti ti-x"
                                                style={{ fontSize: fontSize.xs }}
                                            />
                                        </button>
                                    )}
                                </div>
                                <select
                                    style={styles.filterSelect}
                                    value={filterProductId}
                                    onChange={(e) => {
                                        // Reset to page 1 in the SAME handler as the
                                        // filter change (not a separate effect) — see
                                        // the note above debouncedSearch for why that
                                        // matters (avoids a stale-page 416 error).
                                        setFilterProductId(e.target.value);
                                        setPage(1);
                                    }}
                                >
                                    <option value="">All</option>
                                    {products.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.product_name}
                                        </option>
                                    ))}
                                </select>
                                {/* NEW: checkboxes (select-all + per-row + bulk
                                    delete) are hidden until this is clicked, so
                                    the table doesn't show tick boxes all the time. */}
                                <button
                                    type="button"
                                    style={{
                                        ...styles.selectModeBtn,
                                        ...(selectMode ? styles.selectModeBtnActive : {}),
                                    }}
                                    onClick={toggleSelectMode}
                                >
                                    <i
                                        className="ti ti-square-check"
                                        style={{ fontSize: fontSize.sm }}
                                    />
                                    {selectMode ? "Cancel" : "Select"}
                                </button>
                            </div>
                        </div>

                        <div
                            style={{
                                ...styles.tableHeadRow,
                                gridTemplateColumns: selectMode
                                    ? "32px 100px 1fr 1fr 1fr 100px 76px"
                                    : "100px 1fr 1fr 1fr 100px 76px",
                            }}
                        >
                            {selectMode && (
                                <span style={styles.colCheckbox}>
                                    <input
                                        type="checkbox"
                                        style={styles.checkbox}
                                        checked={
                                            cases.length > 0 && selectedIds.size === cases.length
                                        }
                                        ref={(el) => {
                                            if (el) {
                                                el.indeterminate =
                                                    selectedIds.size > 0 &&
                                                    selectedIds.size < cases.length;
                                            }
                                        }}
                                        onChange={toggleSelectAll}
                                        aria-label="Select all cases on this page"
                                        disabled={cases.length === 0}
                                    />
                                </span>
                            )}
                            <span style={styles.colCaseNo}>Case No.</span>
                            <span style={styles.colClient}>Client</span>
                            <span style={styles.colClient}>Subclient</span>
                            <span style={styles.colService}>Service</span>
                            <span style={styles.colDate}>Date</span>
                            <span style={styles.colAction}></span>
                        </div>
                        {/* Client/Subclient cells show as plain text until the
                            row's pencil icon is clicked, then switch to the
                            editable dropdowns below. */}

                        {casesLoading ? (
                            <div style={styles.emptyNote}>Loading…</div>
                        ) : casesError ? (
                            <div style={{ ...styles.emptyNote, color: BRAND.red }}>
                                {casesError}
                            </div>
                        ) : cases.length === 0 ? (
                            <div style={styles.emptyNote}>
                                {debouncedSearch || filterProductId
                                    ? "No matching cases found."
                                    : "No cases logged yet."}
                            </div>
                        ) : (
                            cases.map((c) => {
                                const isEditingRow = editingRowId === c.id;
                                const isSelected = selectedIds.has(c.id);
                                return (
                                    <div
                                        key={c.id}
                                        style={{
                                            ...styles.tableRow,
                                            gridTemplateColumns: selectMode
                                                ? "32px 100px 1fr 1fr 1fr 100px 76px"
                                                : "100px 1fr 1fr 1fr 100px 76px",
                                            ...(isSelected ? styles.tableRowSelected : null),
                                        }}
                                    >
                                        {selectMode && (
                                            <span style={styles.colCheckbox}>
                                                <input
                                                    type="checkbox"
                                                    style={styles.checkbox}
                                                    checked={isSelected}
                                                    onChange={() => toggleSelectOne(c.id)}
                                                    aria-label={`Select ${c.caseNumber}`}
                                                />
                                            </span>
                                        )}
                                        <span
                                            style={{
                                                ...styles.colCaseNo,
                                                fontWeight: fontWeight.semibold,
                                            }}
                                        >
                                            {c.caseNumber}
                                        </span>
                                        {/* Case number, service, and date stay
                                            read-only. Client/Subclient toggle
                                            between plain text and dropdown
                                            based on the row's edit state. */}
                                        <span style={styles.colClient}>
                                            {isEditingRow ? (
                                                <select
                                                    style={{
                                                        ...styles.clientSelect,
                                                        opacity: savingClientId === c.id ? 0.6 : 1,
                                                    }}
                                                    value={c.clientId || ""}
                                                    disabled={savingClientId === c.id}
                                                    autoFocus
                                                    onChange={(e) =>
                                                        handleClientChange(c, e.target.value)
                                                    }
                                                >
                                                    <option value="">-- Select client --</option>
                                                    {clients.map((cl) => (
                                                        <option key={cl.id} value={cl.id}>
                                                            {cl.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span style={styles.cellText}>
                                                    {c.clientName || "-"}
                                                </span>
                                            )}
                                        </span>
                                        <span style={styles.colClient}>
                                            {isEditingRow ? (
                                                <select
                                                    style={{
                                                        ...styles.clientSelect,
                                                        opacity:
                                                            savingSubclientId === c.id ? 0.6 : 1,
                                                    }}
                                                    value={c.subclientId || ""}
                                                    disabled={
                                                        savingSubclientId === c.id || !c.clientId
                                                    }
                                                    onChange={(e) =>
                                                        handleSubclientChange(c, e.target.value)
                                                    }
                                                >
                                                    <option value="">
                                                        {c.clientId
                                                            ? "-- Select subclient --"
                                                            : "-- No client --"}
                                                    </option>
                                                    {subclients
                                                        .filter((s) => s.clientId === c.clientId)
                                                        .map((s) => (
                                                            <option key={s.id} value={s.id}>
                                                                {s.name}
                                                            </option>
                                                        ))}
                                                </select>
                                            ) : (
                                                <span style={styles.cellText}>
                                                    {c.subclientName || "-"}
                                                </span>
                                            )}
                                        </span>
                                        <span style={styles.colService}>
                                            {c.productName || "-"}
                                        </span>
                                        <span style={{ ...styles.colDate, color: "#767F92" }}>
                                            {formatDisplayDate(c.workDate)}
                                        </span>
                                        <span style={styles.colAction}>
                                            <button
                                                type="button"
                                                style={{
                                                    ...styles.editBtn,
                                                    ...(isEditingRow ? styles.editBtnActive : null),
                                                }}
                                                onClick={() =>
                                                    setEditingRowId((prev) =>
                                                        prev === c.id ? null : c.id
                                                    )
                                                }
                                                aria-label={`Edit ${c.caseNumber}`}
                                                title={
                                                    isEditingRow
                                                        ? "Done editing"
                                                        : "Edit client / subclient"
                                                }
                                            >
                                                <i
                                                    className={
                                                        isEditingRow
                                                            ? "ti ti-check"
                                                            : "ti ti-pencil"
                                                    }
                                                    style={{ fontSize: fontSize.md }}
                                                />
                                            </button>
                                            <button
                                                type="button"
                                                style={{
                                                    ...styles.deleteBtn,
                                                    opacity: deletingId === c.id ? 0.5 : 1,
                                                    cursor:
                                                        deletingId === c.id
                                                            ? "not-allowed"
                                                            : "pointer",
                                                }}
                                                disabled={deletingId === c.id}
                                                onClick={() => handleDelete(c)}
                                                aria-label={`Delete ${c.caseNumber}`}
                                                title="Delete case"
                                            >
                                                <i
                                                    className="ti ti-trash"
                                                    style={{ fontSize: fontSize.md }}
                                                />
                                            </button>
                                        </span>
                                    </div>
                                );
                            })
                        )}

                        {clientEditError && <p style={styles.deleteErrorText}>{clientEditError}</p>}
                        {deleteError && <p style={styles.deleteErrorText}>{deleteError}</p>}

                        {/* ---- pagination — numbered, "Showing X to Y of Z" ---- */}
                        {!casesLoading && !casesError && totalPages > 1 && (
                            <div style={styles.paginationRow}>
                                <span style={styles.paginationSummary}>
                                    Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
                                    {Math.min(page * PAGE_SIZE, totalCases)} of {totalCases} cases
                                </span>
                                <div style={styles.paginationControls}>
                                    <button
                                        type="button"
                                        style={{
                                            ...styles.pageBtn,
                                            opacity: page <= 1 ? 0.5 : 1,
                                            cursor: page <= 1 ? "not-allowed" : "pointer",
                                        }}
                                        disabled={page <= 1}
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    >
                                        <i className="ti ti-chevron-left" />
                                    </button>
                                    {getPageNumbers(page, totalPages).map((p, idx) =>
                                        p === "..." ? (
                                            <span key={`dots-${idx}`} style={styles.pageEllipsis}>
                                                …
                                            </span>
                                        ) : (
                                            <button
                                                key={p}
                                                type="button"
                                                style={{
                                                    ...styles.pageNumBtn,
                                                    ...(p === page
                                                        ? {
                                                              ...styles.pageNumBtnActive,
                                                              background: GRADIENT,
                                                          }
                                                        : {}),
                                                }}
                                                onClick={() => setPage(p as number)}
                                            >
                                                {p}
                                            </button>
                                        )
                                    )}
                                    <button
                                        type="button"
                                        style={{
                                            ...styles.pageBtn,
                                            opacity: page >= totalPages ? 0.5 : 1,
                                            cursor: page >= totalPages ? "not-allowed" : "pointer",
                                        }}
                                        disabled={page >= totalPages}
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    >
                                        <i className="ti ti-chevron-right" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function getStyles(isMobile: boolean): Record<string, CSSProperties> {
    return {
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            flex: 1,
            minHeight: 0,
            background: "#f4f7fb",
            fontFamily: fontFamily.base,
            overflow: "hidden",
        },
        topBar: {
            height: 4,
            width: "100%",
            background: GRADIENT,
            flexShrink: 0,
        },
        contentBody: {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "24px 28px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 18,
        },
        headerRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: isMobile ? undefined : "flex-start",
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 10 : undefined,
        },
        headerLeft: {
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
        },
        breadcrumb: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.sm,
            color: "#64748b",
            marginTop: 6,
        },
        breadcrumbSep: { color: "#c7cbe0" },
        breadcrumbItem: { color: "#64748b" },
        breadcrumbActive: { color: BRAND.blue, fontWeight: fontWeight.semibold },
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
            maxWidth: 560,
        },
        layout: {
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "450px 1fr",
            gap: 20,
            alignItems: "start",
            flex: 1,
            minHeight: 0,
        },
        // NEW: same KPI-card row shown at the top of the Daily Work tab,
        // reused here on Case Register too (Services / Allocated /
        // Pending / Employees) — driven by the same underlying figures,
        // passed down from the parent page as props.
        kpiRow: {
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
            gap: isMobile ? 10 : 14,
        },
        kpiCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: 16,
            boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
        },
        kpiTop: { display: "flex", alignItems: "center", gap: 12 },
        kpiIcon: {
            width: 44,
            height: 44,
            borderRadius: radius.md,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        kpiLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "var(--brand-blue)",
        },
        kpiValue: { fontSize: fontSize["4xl"], fontWeight: fontWeight.bold, color: "#1e1b4b" },
        kpiFooter: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: fontSize.xs,
            color: "#94a3b8",
            borderTop: "1px solid #f1f1f7",
            paddingTop: 10,
        },
        kpiDot: {
            width: 18,
            height: 18,
            borderRadius: radius.circle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        // Left panel now matches the Daily Work "Log Production" panel:
        // white card + a blue gradient header bar (icon, title, ghost
        // icon button for the sample sheet) instead of a plain heading row.
        formPanel: {
            background: "#fff",
            borderRadius: radius.lg,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        },
        formPanelHeader: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 18px",
            background: `linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))`,
            color: "#fff",
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
        },
        headerGhostBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            border: "1px solid rgba(255,255,255,0.5)",
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            cursor: "pointer",
        },
        form: {
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
            textAlign: "left",
        },
        cardHeading: {
            margin: 0,
            fontSize: fontSize.md,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
        // Auto-generate / Upload Case Numbers mode toggle — same pill-button
        // look as the other tab bars in this app (border + hover + gradient
        // when active).
        modeToggleRow: {
            display: "flex",
            gap: 8,
            margin: "0 0 4px",
            flexWrap: "wrap",
        },
        modeToggleBtn: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            color: "#3b4a63",
            border: "1px solid #e4e9f2",
            borderRadius: radius.md,
            padding: "9px 12px",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            transition: "border-color .15s ease, color .15s ease",
            whiteSpace: "nowrap",
        },
        modeToggleBtnActive: {
            background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb), 0.28)",
        },
        label: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            color: "#374151",
            margin: "2px 0 3px",
            textAlign: "left",
        },
        input: {
            width: "100%",
            padding: "8px 10px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.base,
            background: "#fafafa",
            boxSizing: "border-box",
            textAlign: "left",
        },
        helperNote: {
            margin: "2px 0 0",
            fontSize: fontSize.xs,
            color: "#9ca3af",
            textAlign: "left",
        },
        caseNumbersTextarea: {
            fontFamily: "inherit",
            resize: "vertical",
            minHeight: 100,
        },
        errorText: {
            margin: "10px 0 0",
            fontSize: fontSize.sm,
            color: BRAND.red,
            fontWeight: fontWeight.medium,
        },
        successText: {
            margin: "8px 0 0",
            fontSize: fontSize.sm,
            color: BRAND.green,
            fontWeight: fontWeight.medium,
        },
        submitBtn: {
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "11px 18px",
            borderRadius: radius["2xl"],
            border: "none",
            background: GRADIENT,
            color: "#fff",
            fontWeight: fontWeight.semibold,
            fontSize: fontSize.md,
            boxShadow: `0 6px 16px ${withBrandAlpha("blue", 0.3)}`,
            cursor: "pointer",
        },
        tableCard: {
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 6px 20px rgba(0,0,0,.04)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
        },
        tableToolbar: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px 8px",
        },
        countBadge: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withBrandAlpha("blue", 0.08),
            borderRadius: radius.xl,
            padding: "2px 9px",
        },
        // NEW: Case Register search box — same look as the search box
        // on the Daily Work tab (searchBox/searchInput there).
        searchBox: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "#fafaff",
            border: "1px solid #ececf5",
            borderRadius: radius.pill,
            padding: "6px 12px",
            minWidth: 220,
        },
        searchInput: {
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: fontSize.sm,
            color: "#1e1b4b",
            width: "100%",
            fontFamily: "inherit",
        },
        searchClearBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: radius.circle,
            border: "none",
            background: "#e5e7eb",
            color: "#4b5563",
            cursor: "pointer",
            flexShrink: 0,
        },
        filterSelect: {
            padding: "8px 12px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.sm,
            background: "#fafafa",
            minWidth: 180,
        },
        // NEW: toggles bulk-select mode (checkboxes) on/off. Sits next to
        // the service filter dropdown so checkboxes aren't shown by default.
        selectModeBtn: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#3b4a63",
            background: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
        },
        selectModeBtnActive: {
            background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
            color: "#fff",
            border: "1px solid transparent",
        },
        // Header and rows both use this exact grid template — a shared
        // set of column tracks with one uniform `gap` between every one
        // of them, so the space between Case No./Client/Subclient/
        // Service/Date/Actions is always identical regardless of how
        // long any cell's content is (a flex `1fr` column can't drift
        // and swallow the gap the way flex:1 + variable text does).
        tableHeadRow: {
            display: "grid",
            gridTemplateColumns: "32px 100px 1fr 1fr 1fr 100px 76px",
            alignItems: "center",
            columnGap: 20,
            padding: "10px 20px",
            background: "#F4F8FD",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: "#767F92",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
        },
        tableRow: {
            display: "grid",
            gridTemplateColumns: "32px 100px 1fr 1fr 1fr 100px 76px",
            alignItems: "center",
            columnGap: 20,
            padding: "12px 20px",
            borderTop: "1px solid #f1f1f1",
            fontSize: fontSize.base,
            color: "#17181C",
        },
        // NEW: light highlight on a row while it's checked for bulk delete.
        tableRowSelected: {
            background: withBrandAlpha("blue", 0.05),
        },
        // NEW: checkbox column — first cell in both the header (select
        // all) and every row (select this case).
        colCheckbox: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        checkbox: {
            width: 16,
            height: 16,
            cursor: "pointer",
            accentColor: BRAND.blue,
        },
        colCaseNo: {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        colClient: {
            minWidth: 0,
        },
        // NEW: plain-text display for Client/Subclient cells when the
        // row isn't in edit mode — same box as the select it replaces,
        // so nothing shifts when toggling edit mode.
        cellText: {
            display: "block",
            width: "100%",
            padding: "6px 8px",
            boxSizing: "border-box",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "#17181C",
        },
        clientSelect: {
            width: "100%",
            padding: "6px 8px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            fontSize: fontSize.sm,
            background: "#fafafa",
            boxSizing: "border-box",
            color: "#17181C",
        },
        colService: {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        colDate: {
            minWidth: 0,
            textAlign: "right",
        },
        // Fits both the edit and delete icon buttons side by side.
        colAction: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
        },
        // NEW: edit (pencil) icon button — sits immediately to the left
        // of Delete in the actions column.
        editBtn: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            border: "1px solid #dbe4f3",
            background: "#f4f8fd",
            color: BRAND.blue,
            cursor: "pointer",
            flexShrink: 0,
        },
        // NEW: highlighted state while a row's Client/Subclient cells
        // are open for editing, so it's clear which row is active.
        editBtnActive: {
            border: `1px solid ${BRAND.green}`,
            background: withBrandAlpha("green", 0.1),
            color: BRAND.green,
        },
        deleteBtn: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: BRAND.red,
            cursor: "pointer",
            flexShrink: 0,
        },
        deleteErrorText: {
            margin: "10px 20px",
            fontSize: fontSize.sm,
            color: BRAND.red,
            fontWeight: fontWeight.medium,
        },
        // NEW: "Delete Selected (n)" button — shown in the table toolbar
        // once at least one row's checkbox is ticked.
        bulkDeleteBtn: {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: radius.sm,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: BRAND.red,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            whiteSpace: "nowrap",
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
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 14,
            padding: "14px 20px",
            borderTop: "1px solid #f1f1f1",
        },
        // NEW: "Showing X to Y of Z cases" summary text on the left.
        paginationSummary: {
            fontSize: fontSize.sm,
            color: "#767F92",
        },
        // NEW: numbered page buttons on the right, alongside the
        // prev/next chevrons.
        paginationControls: {
            display: "flex",
            alignItems: "center",
            gap: 6,
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
        },
        // NEW: individual numbered page button.
        pageNumBtn: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 32,
            height: 32,
            padding: "0 8px",
            borderRadius: radius.sm,
            border: "1px solid #ececf5",
            background: "#fff",
            color: "#374151",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            cursor: "pointer",
        },
        pageNumBtnActive: {
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: `0 4px 12px ${withBrandAlpha("blue", 0.28)}`,
        },
        pageEllipsis: {
            padding: "0 4px",
            color: "#9ca3af",
            fontSize: fontSize.sm,
        },
        pageIndicator: {
            fontSize: fontSize.sm,
            color: "#374151",
            fontWeight: fontWeight.medium,
        },
    };
}
