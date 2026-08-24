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
//   4. Every selected case renders as its own card below: Client,
//      Service, Date, Employee, and an editable "Marks" field.
//   5. Each card has its own Pass / Fail buttons. Marking a case sends
//      its marks + decision, then that card drops out of both the
//      selection and the dropdown (list is refetched).
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
                        options.map((c) => (
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
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export default function QualityCheck() {
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);

    const [employeeId, setEmployeeId] = useState("");
    const [productId, setProductId] = useState("");

    const [uncheckedCases, setUncheckedCases] = useState<ServiceCase[]>([]);
    const [loadingCases, setLoadingCases] = useState(false);
    const [error, setError] = useState("");

    const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
    const [marksByCaseId, setMarksByCaseId] = useState<Record<string, string>>({});
    const [decidingCaseId, setDecidingCaseId] = useState<string | null>(null);
    const [toast, setToast] = useState("");

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

    useEffect(() => {
        fetchProducts();
        fetchEmployees();
    }, [fetchProducts, fetchEmployees]);

    const fetchUncheckedCases = useCallback(async () => {
        if (!employeeId || !productId) {
            setUncheckedCases([]);
            setSelectedCaseIds([]);
            return;
        }
        setLoadingCases(true);
        setError("");
        try {
            const params = new URLSearchParams();
            params.set("employeeId", employeeId);
            params.set("productId", productId);
            params.set("allocationStatus", "ALLOCATED");
            params.set("qcStatus", "PENDING");
            params.set("pageSize", "500");

            const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setUncheckedCases(json.data || []);
            setSelectedCaseIds([]);
        } catch (err: any) {
            setError(err?.message || "Failed to load unchecked cases.");
            setUncheckedCases([]);
        } finally {
            setLoadingCases(false);
        }
    }, [employeeId, productId]);

    useEffect(() => {
        fetchUncheckedCases();
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
                    <div style={{ minWidth: 240 }}>
                        <label style={styles.label}>Case Number</label>
                        <CaseMultiSelect
                            options={uncheckedCases}
                            selectedIds={selectedCaseIds}
                            onChange={setSelectedCaseIds}
                            disabled={!bothSelected || loadingCases || uncheckedCases.length === 0}
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
                        <div key={c.id} style={styles.detailCard}>
                            <div style={styles.detailHeader}>
                                <div>
                                    <div style={styles.detailCaseNum}>{c.caseNumber}</div>
                                    <div style={styles.detailSub}>
                                        {c.productName || "—"} · {c.clientName || "No client"}
                                    </div>
                                </div>
                                <span style={styles.qcPendingPill}>QC Pending</span>
                            </div>

                            <div style={styles.detailGrid}>
                                <DetailField label="Client" value={c.clientName || "—"} />
                                <DetailField label="Service" value={c.productName || "—"} />
                                <DetailField label="Date" value={c.workDate} />
                                <DetailField
                                    label="Employee"
                                    value={c.assignedEmployeeName || "Unallocated"}
                                />
                                <div style={styles.detailField}>
                                    <div style={styles.detailFieldLabel}>Marks</div>
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
            </div>

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
}

function DetailField({ label, value }: { label: string; value: string }) {
    return (
        <div style={styles.detailField}>
            <div style={styles.detailFieldLabel}>{label}</div>
            <div style={styles.detailFieldValue}>{value}</div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column" },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 },
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
    detailCard: {
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
    },
    detailHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    detailCaseNum: { fontSize: fontSize["2xl"], fontWeight: fontWeight.bold, color: "#17181C" },
    detailSub: { fontSize: fontSize.sm, color: "#767F92", marginTop: 4 },
    qcPendingPill: {
        display: "inline-flex",
        padding: "5px 14px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        background: "rgba(245,158,11,0.1)",
        color: BRAND.amber,
        height: "fit-content",
    },
    detailGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 16,
        padding: "16px 0",
        borderTop: "1px solid #f1f1f1",
        borderBottom: "1px solid #f1f1f1",
    },
    detailField: { display: "flex", flexDirection: "column", gap: 4 },
    detailFieldLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    detailFieldValue: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: "#17181C" },
    marksInput: {
        padding: "6px 10px",
        borderRadius: radius.sm,
        border: "1px solid #ececf5",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        background: "#fafafa",
        width: "100%",
        boxSizing: "border-box",
    },
    decisionRow: { display: "flex", justifyContent: "flex-end", gap: 12 },
    decisionBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "11px 26px",
        borderRadius: radius.md,
        border: "none",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
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
