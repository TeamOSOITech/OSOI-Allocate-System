// src/pages/admin/qualitycheck.tsx
//
// Quality Check (QC) page — case-number-wise, same design language as
// the Cases / Production Report pages.
//
// Flow:
//   1. Select an Employee.
//   2. Select a Service.
//   3. "Case Number" is a closed dropdown (like Service/Employee) that
//      opens a checkbox panel on click — pick as many cases as you want,
//      the button shows a count/summary, and it closes when you click
//      outside. Lists every case ALLOCATED to that employee, for that
//      service, whose QC is still PENDING.
//   4. Every selected case renders as its own compact card below —
//      folder icon + case number/subtitle on top, a "QC Pending" pill,
//      a row of icon-labelled fields (Client / Service / Date /
//      Employee / Marks), and Fail / Pass buttons.
//   5. Marking a case sends its marks + decision, then that card drops
//      out of both the selection and the dropdown (list is refetched).
//
// REFRESH-RACE FIX (see fetchUncheckedCases below): every fetch now
// carries its own id + AbortController. If the employee/service filter
// changes again before an in-flight request finishes (or a slow/
// cold-starting backend makes an old request resolve AFTER a newer
// one), the stale response is now dropped instead of being applied —
// previously the LAST response to land always won, even if it was for
// an older filter, which made the case list appear to "refresh" back
// to old data at random. Selections are also now preserved across a
// refetch instead of being force-cleared every time.
//
// BACKEND ASSUMPTIONS (please confirm/adjust to match your actual API):
//   - `service_cases` gets new columns:
//       qcStatus: "PENDING" | "PASSED" | "FAILED"   (default "PENDING")
//       marks: number | null
//   - GET /api/service-cases supports:
//       employeeId, productId, allocationStatus, qcStatus   as query params
//   - PATCH /api/service-cases/:id/qc
//       body: { qcStatus: "PASSED" | "FAILED", marks: number | null }
//     If your route/param names differ, only fetchUncheckedCases() and
//     handleQcDecision() need to change — nothing else depends on them.

import { useState, useEffect, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    grey: "#9CA3AF",
    amber: "#F59E0B",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type Product = { id: string; product_name: string };
type Employee = { id: string; name: string; employeeCode: string | null };

type QcStatus = "PENDING" | "PASSED" | "FAILED";

type ServiceCase = {
    id: string;
    caseNumber: string;
    productId: string;
    productName: string | null;
    clientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    assignedEmployeeName: string | null;
    allocationStatus: "PENDING" | "ALLOCATED";
    qcStatus: QcStatus;
};

// ---------------------------------------------------------------------
// Closed-by-default multi-select dropdown: looks like a normal <select>
// button, opens a checkbox panel on click, closes on outside click.
// ---------------------------------------------------------------------
function CaseMultiSelect({
    options,
    selectedIds,
    onChange,
    disabled,
    placeholder,
}: {
    options: ServiceCase[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    disabled?: boolean;
    placeholder: string;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    const toggleId = (id: string) => {
        if (selectedIds.includes(id)) {
            onChange(selectedIds.filter((x) => x !== id));
        } else {
            onChange([...selectedIds, id]);
        }
    };

    const allSelected = options.length > 0 && options.every((o) => selectedIds.includes(o.id));
    const toggleSelectAll = () => {
        onChange(allSelected ? [] : options.map((o) => o.id));
    };

    const summaryLabel =
        selectedIds.length === 0
            ? placeholder
            : selectedIds.length === 1
              ? options.find((o) => o.id === selectedIds[0])?.caseNumber || "1 selected"
              : `${selectedIds.length} cases selected`;

    return (
        <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
            <button
                type="button"
                style={{
                    ...styles.select,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.6 : 1,
                    color: selectedIds.length === 0 ? "#9ca3af" : "#17181C",
                }}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
            >
                <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                    {summaryLabel}
                </span>
                <i className={`ti ti-chevron-${open ? "up" : "down"}`} style={{ flexShrink: 0 }} />
            </button>

            {open && !disabled && (
                <div style={styles.multiPanel}>
                    {options.length === 0 ? (
                        <div style={styles.multiPanelEmpty}>No unchecked cases</div>
                    ) : (
                        <>
                            <label style={styles.multiSelectAllOption} onClick={toggleSelectAll}>
                                <input type="checkbox" checked={allSelected} readOnly />
                                <span style={styles.multiSelectAllText}>
                                    {allSelected ? "Deselect all" : "Select all"}
                                </span>
                            </label>
                            {options.map((c) => (
                                <label key={c.id} style={styles.multiOption}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(c.id)}
                                        onChange={() => toggleId(c.id)}
                                    />
                                    <span style={styles.multiOptionText}>
                                        {c.caseNumber}
                                        {c.clientName ? ` — ${c.clientName}` : ""}
                                    </span>
                                </label>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// One icon-labelled field inside a case card (Client / Service / Date /
// Employee). Marks has its own inline markup below since it needs an
// editable input instead of static text.
// ---------------------------------------------------------------------
function InfoItem({
    icon,
    color,
    label,
    value,
}: {
    icon: string;
    color: string;
    label: string;
    value: string;
}) {
    return (
        <div style={styles.infoItem}>
            <div style={{ ...styles.infoIconCircle, background: `${color}1A`, color }}>
                <i className={`ti ${icon}`} />
            </div>
            <div style={styles.infoText}>
                <div style={styles.infoLabel}>{label}</div>
                <div style={styles.infoValue}>{value}</div>
            </div>
        </div>
    );
}

// Selections/filters are kept in sessionStorage so switching to another
// page and coming back to QC doesn't lose what you'd already picked —
// React unmounts this component on route change, which was wiping all
// of its local state (employee/service/case selection, entered marks).
// sessionStorage survives that; it only clears when the tab is closed.
const QC_STORAGE_KEY = "qc_page_state_v1";

type PersistedQcState = {
    employeeId: string;
    productId: string;
    selectedCaseIds: string[];
    marksByCaseId: Record<string, string>;
};

function loadPersistedQcState(): PersistedQcState {
    const fallback: PersistedQcState = {
        employeeId: "",
        productId: "",
        selectedCaseIds: [],
        marksByCaseId: {},
    };
    if (typeof window === "undefined") return fallback;
    try {
        const raw = sessionStorage.getItem(QC_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return {
            employeeId: typeof parsed.employeeId === "string" ? parsed.employeeId : "",
            productId: typeof parsed.productId === "string" ? parsed.productId : "",
            selectedCaseIds: Array.isArray(parsed.selectedCaseIds) ? parsed.selectedCaseIds : [],
            marksByCaseId:
                parsed.marksByCaseId && typeof parsed.marksByCaseId === "object"
                    ? parsed.marksByCaseId
                    : {},
        };
    } catch {
        return fallback;
    }
}

export default function QualityCheck() {
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);

    const persisted = useRef(loadPersistedQcState()).current;

    const [employeeId, setEmployeeId] = useState(persisted.employeeId);
    const [productId, setProductId] = useState(persisted.productId);

    const [uncheckedCases, setUncheckedCases] = useState<ServiceCase[]>([]);
    const [loadingCases, setLoadingCases] = useState(false);
    const [error, setError] = useState("");

    const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>(persisted.selectedCaseIds);
    const [marksByCaseId, setMarksByCaseId] = useState<Record<string, string>>(
        persisted.marksByCaseId
    );
    const [decidingCaseId, setDecidingCaseId] = useState<string | null>(null);
    const [toast, setToast] = useState("");

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // Persist filters/selection/marks on every change so they survive
    // navigating away to another page and back.
    useEffect(() => {
        try {
            sessionStorage.setItem(
                QC_STORAGE_KEY,
                JSON.stringify({ employeeId, productId, selectedCaseIds, marksByCaseId })
            );
        } catch {
            // sessionStorage can throw in private/incognito edge cases —
            // non-fatal, selection just won't survive navigation this time.
        }
    }, [employeeId, productId, selectedCaseIds, marksByCaseId]);

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

    // Tags every fetch with an incrementing id so an older, slower
    // request can never clobber a newer one that already landed — this
    // is what was causing the list to appear to "refresh" back to
    // stale data whenever the filters changed quickly or the backend
    // was slow to respond (cold start, flaky network, etc).
    const fetchIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const fetchUncheckedCases = useCallback(async () => {
        // Cancel whatever request is still in flight for the previous
        // filter — no point letting it keep running, and it guarantees
        // it can't win a race against the request we're about to fire.
        abortRef.current?.abort();

        if (!employeeId || !productId) {
            setUncheckedCases([]);
            setSelectedCaseIds([]);
            return;
        }

        const myFetchId = ++fetchIdRef.current;
        const controller = new AbortController();
        abortRef.current = controller;

        setLoadingCases(true);
        setError("");
        try {
            const params = new URLSearchParams();
            params.set("employeeId", employeeId);
            params.set("productId", productId);
            params.set("allocationStatus", "ALLOCATED");
            params.set("qcStatus", "PENDING");
            params.set("pageSize", "500");

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`, {
                signal: controller.signal,
            } as RequestInit);
            const json = await res.json();

            // A newer fetch has already started (or finished) since this
            // one began — throw this response away instead of applying it.
            if (myFetchId !== fetchIdRef.current) return;

            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            const rows: ServiceCase[] = json.data || [];
            setUncheckedCases(rows);
            // Keep any selection that's still valid for the new list
            // instead of wiping it every time — this used to reset
            // mid-review selections on every refetch.
            setSelectedCaseIds((prev) => prev.filter((id) => rows.some((r) => r.id === id)));
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            if (myFetchId !== fetchIdRef.current) return;
            setError(err?.message || "Failed to load unchecked cases.");
            setUncheckedCases([]);
        } finally {
            if (myFetchId === fetchIdRef.current) setLoadingCases(false);
        }
    }, [employeeId, productId]);

    useEffect(() => {
        fetchUncheckedCases();
        return () => abortRef.current?.abort();
    }, [fetchUncheckedCases]);

    const selectedCases = uncheckedCases.filter((c) => selectedCaseIds.includes(c.id));

    const handleQcDecision = async (caseItem: ServiceCase, decision: "PASSED" | "FAILED") => {
        setDecidingCaseId(caseItem.id);
        try {
            const rawMarks = marksByCaseId[caseItem.id];
            const marks = rawMarks === undefined || rawMarks === "" ? null : Number(rawMarks);

            const res = await authFetch(`${API_BASE}/api/service-cases/${caseItem.id}/qc`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qcStatus: decision, marks }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "QC update failed");
            showToast(
                `${caseItem.caseNumber} marked ${decision === "PASSED" ? "Passed ✓" : "Failed ✗"}.`
            );
            setUncheckedCases((prev) => prev.filter((c) => c.id !== caseItem.id));
            setSelectedCaseIds((prev) => prev.filter((id) => id !== caseItem.id));
            setMarksByCaseId((prev) => {
                const next = { ...prev };
                delete next[caseItem.id];
                return next;
            });
        } catch (err: any) {
            showToast(err?.message || "Failed to update QC status.");
        } finally {
            setDecidingCaseId(null);
        }
    };

    const bothSelected = !!employeeId && !!productId;

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div style={styles.contentBody}>
                <div>
                    <h1 style={styles.pageTitle}>Quality Check</h1>
                    <p style={styles.headerSubtext}>
                        Select an employee and a service, then pick one or more case numbers still
                        pending QC. Review each, enter marks, and mark it Passed or Failed.
                    </p>
                </div>

                <div style={styles.filterBar}>
                    <div style={{ minWidth: 200 }}>
                        <label style={styles.label}>Employee</label>
                        <select
                            style={styles.select}
                            value={employeeId}
                            onChange={(e) => setEmployeeId(e.target.value)}
                        >
                            <option value="">Select employee…</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ minWidth: 200 }}>
                        <label style={styles.label}>Service</label>
                        <select
                            style={styles.select}
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                        >
                            <option value="">Select a service…</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.product_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ minWidth: 240, display: "flex", alignItems: "flex-end", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                            <label style={styles.label}>Case Number</label>
                            <CaseMultiSelect
                                options={uncheckedCases}
                                selectedIds={selectedCaseIds}
                                onChange={setSelectedCaseIds}
                                disabled={
                                    !bothSelected || loadingCases || uncheckedCases.length === 0
                                }
                                placeholder={
                                    !bothSelected
                                        ? "Select employee & service first"
                                        : loadingCases
                                          ? "Loading…"
                                          : uncheckedCases.length === 0
                                            ? "No unchecked cases"
                                            : "Select case(s)…"
                                }
                            />
                        </div>
                        {selectedCaseIds.length > 0 && (
                            <button
                                type="button"
                                style={styles.clearAllBtn}
                                onClick={() => setSelectedCaseIds([])}
                                title="Clear all selected cases"
                            >
                                <i className="ti ti-x" />
                                Clear all
                            </button>
                        )}
                    </div>
                    {bothSelected && (
                        <div style={styles.pendingBadge}>
                            <i className="ti ti-clipboard-list" />
                            {loadingCases ? "…" : uncheckedCases.length} pending QC
                        </div>
                    )}
                </div>

                {error && <p style={styles.errorText}>{error}</p>}

                {!bothSelected && (
                    <div style={styles.placeholderCard}>
                        <i className="ti ti-checkbox" style={{ fontSize: 28, color: BRAND.grey }} />
                        <p style={styles.placeholderText}>
                            Pick an employee and a service above to load their unchecked cases.
                        </p>
                    </div>
                )}

                {bothSelected &&
                    selectedCases.length === 0 &&
                    !loadingCases &&
                    uncheckedCases.length > 0 && (
                        <div style={styles.placeholderCard}>
                            <i
                                className="ti ti-hand-click"
                                style={{ fontSize: 28, color: BRAND.grey }}
                            />
                            <p style={styles.placeholderText}>
                                Select one or more case numbers above to review them.
                            </p>
                        </div>
                    )}

                {bothSelected && uncheckedCases.length === 0 && !loadingCases && (
                    <div style={styles.placeholderCard}>
                        <i
                            className="ti ti-circle-check"
                            style={{ fontSize: 28, color: BRAND.green }}
                        />
                        <p style={styles.placeholderText}>
                            All cases allocated to this employee for this service are already QC
                            checked.
                        </p>
                    </div>
                )}

                {selectedCases.map((c) => {
                    const deciding = decidingCaseId === c.id;
                    return (
                        <div key={c.id} style={styles.caseCard}>
                            <div style={styles.cardHeader}>
                                <div style={styles.cardHeaderLeft}>
                                    <div style={styles.folderIcon}>
                                        <i className="ti ti-folder" />
                                    </div>
                                    <div>
                                        <div style={styles.cardCaseNum}>{c.caseNumber}</div>
                                        <div style={styles.cardSub}>
                                            {c.productName || "—"} · {c.clientName || "No client"}
                                        </div>
                                    </div>
                                </div>
                                <span style={styles.qcPendingPill}>
                                    <i className="ti ti-hourglass" />
                                    QC Pending
                                </span>
                            </div>

                            <div style={styles.cardDivider} />

                            <div style={styles.infoRow}>
                                <InfoItem
                                    icon="ti-users"
                                    color="#3B82F6"
                                    label="CLIENT"
                                    value={c.clientName || "—"}
                                />
                                <InfoItem
                                    icon="ti-cube"
                                    color="#14B8A6"
                                    label="SERVICE"
                                    value={c.productName || "—"}
                                />
                                <InfoItem
                                    icon="ti-calendar"
                                    color="#8B5CF6"
                                    label="DATE"
                                    value={c.workDate}
                                />
                                <InfoItem
                                    icon="ti-user"
                                    color={BRAND.amber}
                                    label="EMPLOYEE"
                                    value={c.assignedEmployeeName || "Unallocated"}
                                />
                                <div style={styles.infoItem}>
                                    <div
                                        style={{
                                            ...styles.infoIconCircle,
                                            background: "#EC489918",
                                            color: "#EC4899",
                                        }}
                                    >
                                        <i className="ti ti-star" />
                                    </div>
                                    <div style={styles.infoText}>
                                        <div style={styles.infoLabel}>MARKS</div>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            placeholder="e.g. 92"
                                            style={styles.marksInput}
                                            value={marksByCaseId[c.id] ?? ""}
                                            onChange={(e) =>
                                                setMarksByCaseId((prev) => ({
                                                    ...prev,
                                                    [c.id]: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={styles.cardDivider} />

                            <div style={styles.decisionRow}>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.decisionBtn,
                                        background: "rgba(220,38,38,0.08)",
                                        color: BRAND.red,
                                        opacity: deciding ? 0.6 : 1,
                                    }}
                                    disabled={deciding}
                                    onClick={() => handleQcDecision(c, "FAILED")}
                                >
                                    <i className="ti ti-x" />
                                    Fail
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        ...styles.decisionBtn,
                                        background: GRADIENT,
                                        color: "#fff",
                                        opacity: deciding ? 0.6 : 1,
                                    }}
                                    disabled={deciding}
                                    onClick={() => handleQcDecision(c, "PASSED")}
                                >
                                    <i className="ti ti-check" />
                                    {deciding ? "Saving…" : "Pass"}
                                </button>
                            </div>
                        </div>
                    );
                })}

                {selectedCases.length > 0 && (
                    <div style={styles.infoBanner}>
                        <i className="ti ti-info-circle" style={{ flexShrink: 0, fontSize: 16 }} />
                        <span>
                            Please review all selected cases carefully before marking them as Passed
                            or Failed.
                        </span>
                    </div>
                )}
            </div>

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column", width: "100%" },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: {
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        boxSizing: "border-box",
    },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["4xl"],
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
        width: "100%",
        boxSizing: "border-box",
    },
    multiPanel: {
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 50,
        background: "#fff",
        border: "1px solid #ececf5",
        borderRadius: radius.sm,
        boxShadow: "0 10px 28px rgba(0,0,0,.12)",
        maxHeight: 240,
        overflowY: "auto",
        padding: 6,
    },
    multiPanelEmpty: {
        padding: "10px 12px",
        fontSize: fontSize.sm,
        color: "#9ca3af",
        textAlign: "center",
    },
    multiOption: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: radius.sm,
        cursor: "pointer",
        fontSize: fontSize.sm,
        color: "#17181C",
    },
    multiOptionText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    multiSelectAllOption: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: radius.sm,
        cursor: "pointer",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        borderBottom: "1px solid #ececf5",
        marginBottom: 4,
    },
    multiSelectAllText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    pendingBadge: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 14px",
        borderRadius: radius.pill,
        background: "rgba(245,158,11,0.1)",
        color: BRAND.amber,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    },
    clearAllBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#767F92",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },
    placeholderCard: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "48px 20px",
        borderRadius: radius.lg,
        background: "#fff",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
    },
    placeholderText: { margin: 0, fontSize: fontSize.base, color: "#9ca3af" },

    // ---- New compact case card (matches reference design) ----
    caseCard: {
        background: "#fff",
        borderRadius: radius.lg,
        borderLeft: `4px solid ${BRAND.blue}`,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
        boxSizing: "border-box",
    },
    cardHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    cardHeaderLeft: { display: "flex", alignItems: "center", gap: 12 },
    folderIcon: {
        width: 40,
        height: 40,
        borderRadius: radius.md,
        background: GRADIENT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        flexShrink: 0,
    },
    cardCaseNum: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: "#17181C" },
    cardSub: { fontSize: fontSize.sm, color: "#767F92", marginTop: 2 },
    qcPendingPill: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        background: "rgba(245,158,11,0.1)",
        color: BRAND.amber,
        height: "fit-content",
        whiteSpace: "nowrap",
    },
    cardDivider: { height: 1, background: "#f1f1f1", width: "100%" },
    infoRow: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 22,
        flexWrap: "wrap",
        width: "100%",
    },
    infoItem: { display: "flex", alignItems: "center", gap: 10, minWidth: 120 },
    infoIconCircle: {
        width: 34,
        height: 34,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        flexShrink: 0,
    },
    infoText: { display: "flex", flexDirection: "column", gap: 2 },
    infoLabel: {
        fontSize: fontSize.xxs,
        fontWeight: fontWeight.semibold,
        color: "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    infoValue: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: "#17181C" },
    marksInput: {
        padding: "5px 8px",
        borderRadius: radius.xs,
        border: "1px solid #ececf5",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        background: "#fafafa",
        width: 90,
        boxSizing: "border-box",
    },
    decisionRow: { display: "flex", justifyContent: "flex-end", gap: 12 },
    decisionBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 22px",
        borderRadius: radius.md,
        border: "none",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    infoBanner: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderRadius: radius.md,
        background: "rgba(59,130,246,0.08)",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        width: "100%",
        boxSizing: "border-box",
    },
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
