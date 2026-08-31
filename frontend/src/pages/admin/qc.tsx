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
//
// AUDIT MODE (added): same page, same flow, toggled with the QC
// Queue / Audit Queue buttons up top. Mirrors the QC assumptions
// above, one level over — audit only makes sense on cases that
// already passed QC:
//   - `service_cases` gets:
//       auditStatus: "PENDING" | "PASSED" | "FAILED"   (default "PENDING")
//   - GET /api/service-cases in audit mode additionally sends
//       qcStatus=PASSED (only QC-passed cases are eligible for audit)
//       auditStatus=PENDING
//   - PATCH /api/service-cases/:id/audit
//       body: { auditStatus: "PASSED" | "FAILED", marks: number | null }
//     If your route/param names differ, only fetchUncheckedCases() and
//     handleDecision() need to change.

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
type Mode = "qc" | "audit";

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
    qcEmployeeName?: string | null;
    qcMarks?: number | null;
    qcNotes?: string | null;
    auditStatus?: QcStatus;
    auditEmployeeName?: string | null;
    auditMarks?: number | null;
    auditNotes?: string | null;
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
    mode: Mode;
    employeeId: string;
    productId: string;
    selectedCaseIds: string[];
    marksByCaseId: Record<string, string>;
    notesByCaseId: Record<string, string>;
};

function loadPersistedQcState(): PersistedQcState {
    const fallback: PersistedQcState = {
        mode: "qc",
        employeeId: "",
        productId: "",
        selectedCaseIds: [],
        marksByCaseId: {},
        notesByCaseId: {},
    };
    if (typeof window === "undefined") return fallback;
    try {
        const raw = sessionStorage.getItem(QC_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return {
            mode: parsed.mode === "audit" ? "audit" : "qc",
            employeeId: typeof parsed.employeeId === "string" ? parsed.employeeId : "",
            productId: typeof parsed.productId === "string" ? parsed.productId : "",
            selectedCaseIds: Array.isArray(parsed.selectedCaseIds) ? parsed.selectedCaseIds : [],
            marksByCaseId:
                parsed.marksByCaseId && typeof parsed.marksByCaseId === "object"
                    ? parsed.marksByCaseId
                    : {},
            notesByCaseId:
                parsed.notesByCaseId && typeof parsed.notesByCaseId === "object"
                    ? parsed.notesByCaseId
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

    // "qc" = QC Queue (this page's original behaviour), "audit" = Audit
    // Queue — same page, same flow, switched with the toggle buttons.
    const [mode, setMode] = useState<Mode>(persisted.mode);

    const [employeeId, setEmployeeId] = useState(persisted.employeeId);
    const [productId, setProductId] = useState(persisted.productId);

    const [uncheckedCases, setUncheckedCases] = useState<ServiceCase[]>([]);
    const [loadingCases, setLoadingCases] = useState(false);
    const [error, setError] = useState("");

    const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>(persisted.selectedCaseIds);
    const [marksByCaseId, setMarksByCaseId] = useState<Record<string, string>>(
        persisted.marksByCaseId
    );
    const [notesByCaseId, setNotesByCaseId] = useState<Record<string, string>>(
        persisted.notesByCaseId
    );
    const [decidingCaseId, setDecidingCaseId] = useState<string | null>(null);
    const [toast, setToast] = useState("");

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    };

    // Persist filters/selection/marks/remarks on every change so they
    // survive navigating away to another page and back.
    useEffect(() => {
        try {
            sessionStorage.setItem(
                QC_STORAGE_KEY,
                JSON.stringify({
                    mode,
                    employeeId,
                    productId,
                    selectedCaseIds,
                    marksByCaseId,
                    notesByCaseId,
                })
            );
        } catch {
            // sessionStorage can throw in private/incognito edge cases —
            // non-fatal, selection just won't survive navigation this time.
        }
    }, [mode, employeeId, productId, selectedCaseIds, marksByCaseId, notesByCaseId]);

    // Switching QC Queue <-> Audit Queue means a different set of cases
    // (and different ids) — drop the current selection/marks/remarks so
    // nothing stale carries over into the other mode.
    const handleModeChange = (next: Mode) => {
        if (next === mode) return;
        setMode(next);
        setSelectedCaseIds([]);
        setMarksByCaseId({});
        setNotesByCaseId({});
        setError("");
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
            params.set("pageSize", "500");
            if (mode === "qc") {
                params.set("qcStatus", "PENDING");
            } else {
                // Audit only makes sense on cases that already passed QC.
                params.set("qcStatus", "PASSED");
                params.set("auditStatus", "PENDING");
            }

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
            setError(err?.message || `Failed to load ${mode === "qc" ? "QC" : "audit"} cases.`);
            setUncheckedCases([]);
        } finally {
            if (myFetchId === fetchIdRef.current) setLoadingCases(false);
        }
    }, [employeeId, productId, mode]);

    useEffect(() => {
        fetchUncheckedCases();
        return () => abortRef.current?.abort();
    }, [fetchUncheckedCases]);

    const selectedCases = uncheckedCases.filter((c) => selectedCaseIds.includes(c.id));

    const handleDecision = async (caseItem: ServiceCase, decision: "PASSED" | "FAILED") => {
        setDecidingCaseId(caseItem.id);
        try {
            const rawMarks = marksByCaseId[caseItem.id];
            const marks = rawMarks === undefined || rawMarks === "" ? null : Number(rawMarks);
            const notes = notesByCaseId[caseItem.id] || "";

            const endpoint = mode === "qc" ? "qc" : "audit";
            const statusKey = mode === "qc" ? "qcStatus" : "auditStatus";

            const res = await authFetch(
                `${API_BASE}/api/service-cases/${caseItem.id}/${endpoint}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ [statusKey]: decision, marks, notes }),
                }
            );
            const json = await res.json();
            if (!res.ok || !json.success)
                throw new Error(json?.message || `${mode === "qc" ? "QC" : "Audit"} update failed`);
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
            setNotesByCaseId((prev) => {
                const next = { ...prev };
                delete next[caseItem.id];
                return next;
            });
        } catch (err: any) {
            showToast(err?.message || `Failed to update ${mode === "qc" ? "QC" : "audit"} status.`);
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
                    <h1 style={styles.pageTitle}>{mode === "qc" ? "Quality Check" : "Audit"}</h1>
                    <p style={styles.headerSubtext}>
                        {mode === "qc"
                            ? "Select an employee and a service, then pick one or more case numbers still pending QC. Review each, enter marks, and mark it Passed or Failed."
                            : "Select an employee and a service, then pick one or more QC-passed case numbers still pending audit. Review each, enter marks, and mark it Passed or Failed."}
                    </p>
                </div>

                {/* QC Queue / Audit Queue — same page, same flow, switched here. */}
                <div style={styles.modeToggleRow}>
                    <button
                        type="button"
                        style={{
                            ...styles.modeToggleBtn,
                            ...(mode === "qc" ? styles.modeToggleBtnActive : {}),
                        }}
                        onClick={() => handleModeChange("qc")}
                    >
                        <i className="ti ti-clipboard-check" style={{ marginRight: 6 }} />
                        QC Queue
                    </button>
                    <button
                        type="button"
                        style={{
                            ...styles.modeToggleBtn,
                            ...(mode === "audit" ? styles.modeToggleBtnActive : {}),
                        }}
                        onClick={() => handleModeChange("audit")}
                    >
                        <i className="ti ti-shield-check" style={{ marginRight: 6 }} />
                        Audit Queue
                    </button>
                </div>

                <div style={styles.filterCard}>
                    <div style={styles.filterCardHeader}>
                        <span style={styles.filterCardTitle}>
                            <i className="ti ti-filter" style={{ color: BRAND.blue }} />
                            Filters
                        </span>
                        {bothSelected && (
                            <div style={styles.pendingBadge}>
                                <i className="ti ti-clipboard-list" />
                                {loadingCases ? "…" : uncheckedCases.length} pending{" "}
                                {mode === "qc" ? "QC" : "audit"}
                            </div>
                        )}
                    </div>

                    <div style={styles.filterBar}>
                        <div style={{ minWidth: 200, flex: 1 }}>
                            <label style={styles.label}>
                                <i className="ti ti-user" style={styles.labelIcon} /> Employee
                            </label>
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
                        <div style={{ minWidth: 200, flex: 1 }}>
                            <label style={styles.label}>
                                <i className="ti ti-cube" style={styles.labelIcon} /> Service
                            </label>
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
                        <div
                            style={{
                                minWidth: 240,
                                flex: 1.4,
                                display: "flex",
                                alignItems: "flex-end",
                                gap: 8,
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <label style={styles.label}>
                                    <i className="ti ti-hash" style={styles.labelIcon} /> Case
                                    Number
                                </label>
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
                                                ? mode === "qc"
                                                    ? "No unchecked cases"
                                                    : "No cases pending audit"
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
                    </div>
                </div>

                {error && <p style={styles.errorText}>{error}</p>}

                {!bothSelected && (
                    <div style={styles.placeholderCard}>
                        <div style={styles.placeholderIconCircle}>
                            <i
                                className="ti ti-checkbox"
                                style={{ fontSize: fontSize["6xl"], color: BRAND.blue }}
                            />
                        </div>
                        <p style={styles.placeholderTitle}>No employee/service selected yet</p>
                        <p style={styles.placeholderText}>
                            {mode === "qc"
                                ? "Pick an employee and a service above to load their unchecked cases."
                                : "Pick an employee and a service above to load their QC-passed cases waiting on audit."}
                        </p>
                    </div>
                )}

                {bothSelected &&
                    selectedCases.length === 0 &&
                    !loadingCases &&
                    uncheckedCases.length > 0 && (
                        <div style={styles.placeholderCard}>
                            <div style={styles.placeholderIconCircle}>
                                <i
                                    className="ti ti-hand-click"
                                    style={{ fontSize: fontSize["6xl"], color: BRAND.blue }}
                                />
                            </div>
                            <p style={styles.placeholderTitle}>Ready when you are</p>
                            <p style={styles.placeholderText}>
                                Select one or more case numbers above to review them.
                            </p>
                        </div>
                    )}

                {bothSelected && uncheckedCases.length === 0 && !loadingCases && (
                    <div style={styles.placeholderCard}>
                        <div
                            style={{
                                ...styles.placeholderIconCircle,
                                background: "rgba(46,187,168,0.12)",
                            }}
                        >
                            <i
                                className="ti ti-circle-check"
                                style={{ fontSize: fontSize["6xl"], color: BRAND.green }}
                            />
                        </div>
                        <p style={styles.placeholderTitle}>All caught up</p>
                        <p style={styles.placeholderText}>
                            {mode === "qc"
                                ? "All cases allocated to this employee for this service are already QC checked."
                                : "There are no QC-passed cases for this employee/service waiting on audit right now."}
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
                                    {mode === "qc" ? "QC Pending" : "Audit Pending"}
                                </span>
                            </div>

                            <div style={styles.cardDivider} />

                            {/* Audit mode: show what QC already found on this
                            case (reviewer, marks, remarks) so the auditor has
                            full context before making their own call. */}
                            {mode === "audit" && (
                                <div style={styles.qcSummaryBox}>
                                    <div style={styles.qcSummaryHeader}>
                                        <i className="ti ti-clipboard-check" />
                                        QC Result
                                    </div>
                                    <div style={styles.qcSummaryRow}>
                                        <span style={styles.qcSummaryLabel}>Reviewer</span>
                                        <span style={styles.qcSummaryValue}>
                                            {c.qcEmployeeName || "—"}
                                        </span>
                                    </div>
                                    <div style={styles.qcSummaryRow}>
                                        <span style={styles.qcSummaryLabel}>Marks</span>
                                        <span style={styles.qcSummaryValue}>
                                            {c.qcMarks ?? "—"}
                                        </span>
                                    </div>
                                    <div style={styles.qcSummaryRow}>
                                        <span style={styles.qcSummaryLabel}>Remarks</span>
                                        <span style={styles.qcSummaryValue}>
                                            {c.qcNotes || "—"}
                                        </span>
                                    </div>
                                </div>
                            )}

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

                            <div style={styles.remarksBlock}>
                                <div style={styles.infoLabel}>
                                    {mode === "qc" ? "QC REMARKS" : "AUDIT REMARKS"}
                                </div>
                                <textarea
                                    style={styles.remarksTextarea}
                                    placeholder="Optional for Pass, recommended for Fail"
                                    rows={2}
                                    value={notesByCaseId[c.id] ?? ""}
                                    onChange={(e) =>
                                        setNotesByCaseId((prev) => ({
                                            ...prev,
                                            [c.id]: e.target.value,
                                        }))
                                    }
                                />
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
                                    onClick={() => handleDecision(c, "FAILED")}
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
                                    onClick={() => handleDecision(c, "PASSED")}
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
                        <i
                            className="ti ti-info-circle"
                            style={{ flexShrink: 0, fontSize: fontSize.xl }}
                        />
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
    root: { display: "flex", flexDirection: "column", width: "100%", flex: 1, minHeight: "100%" },
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
        flex: 1,
        minHeight: 0,
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
    modeToggleRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    modeToggleBtn: {
        display: "flex",
        alignItems: "center",
        padding: "9px 18px",
        borderRadius: radius.pill,
        border: "1px solid #ececf5",
        background: "#fff",
        color: "#767F92",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    modeToggleBtnActive: {
        background: GRADIENT,
        border: "1px solid transparent",
        color: "#fff",
    },
    filterBar: { display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" },
    filterCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        boxSizing: "border-box",
    },
    filterCardHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    filterCardTitle: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    labelIcon: { fontSize: fontSize.base, color: "#9ca3af", marginRight: 2 },
    label: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
        margin: "0 0 6px",
    },
    select: {
        padding: "10px 12px",
        borderRadius: radius.sm,
        border: "1px solid #e5e7eb",
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
        gap: 6,
        padding: "48px 20px",
        borderRadius: radius.lg,
        background: "#fff",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        flex: 1,
        minHeight: 320,
        width: "100%",
        boxSizing: "border-box",
    },
    placeholderIconCircle: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "rgba(59,130,246,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
    placeholderTitle: {
        margin: 0,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    placeholderText: { margin: 0, fontSize: fontSize.sm, color: "#9ca3af" },

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
        fontSize: fontSize["2xl"],
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
    qcSummaryBox: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "rgba(59,130,246,0.06)",
        border: "1px solid rgba(59,130,246,0.15)",
        borderRadius: radius.md,
        padding: "12px 14px",
    },
    qcSummaryHeader: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: BRAND.blue,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        marginBottom: 2,
    },
    qcSummaryRow: { display: "flex", gap: 8, fontSize: fontSize.sm },
    qcSummaryLabel: { color: "#767F92", minWidth: 70, fontWeight: fontWeight.medium },
    qcSummaryValue: { color: "#17181C", fontWeight: fontWeight.medium, flex: 1 },
    remarksBlock: { display: "flex", flexDirection: "column", gap: 6 },
    remarksTextarea: {
        padding: "8px 10px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.sm,
        background: "#fafafa",
        width: "100%",
        boxSizing: "border-box",
        resize: "vertical",
        fontFamily: "inherit",
    },
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
        fontSize: fontSize.lg,
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
