// src/pages/blue/locations.tsx
//
// Blue Collar "Services": the Role -> Services map (Excel upload).
// Excel columns: Location | Role | Service | Time (optional) (one service per row).
//
// Styled to match the white-collar Services page (admin/products.tsx):
// page title + subtext, white filter bar, grid/list toggle, coloured avatar
// cards, "View Details" modal. One card per (Location, Role).
//
// Locations themselves are added from the Add User page (the "+" next to
// Location). Uploading the Excel still creates any location it mentions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser } from "../../utils/auth";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import { ui, useIsMobileBlue } from "./ui";

const API_BASE = import.meta.env.VITE_API_URL;

type RoleService = {
    id: string;
    locationId: string;
    locationName: string;
    role: string;
    service: string;
    time?: string;
};
type UploadResult = {
    rowsInFile: number;
    added: number;
    updated?: number;
    alreadyExisted: number;
    newLocations: number;
    errors: { line: number; message: string }[];
};
type Group = {
    key: string;
    locationName: string;
    role: string;
    items: RoleService[];
};

// ---- same avatar palette as the white-collar Services page ----
const AVATAR_PALETTE = [
    { from: "#5b7fee", to: "#2b4fd8", solid: "#2b4fd8" },
    { from: "#2dd4bf", to: "#0ca678", solid: "#0ca678" },
    { from: "#fb923c", to: "#ea580c", solid: "#ea580c" },
    { from: "#a855f7", to: "#7c3aed", solid: "#7c3aed" },
    { from: "#f472b6", to: "#db2777", solid: "#db2777" },
    { from: "#38bdf8", to: "#0284c7", solid: "#0284c7" },
    { from: "#34d399", to: "#059669", solid: "#059669" },
    { from: "#fbbf24", to: "#d97706", solid: "#d97706" },
];

function getInitials(name: string) {
    const t = (name || "").trim();
    if (!t) return "?";
    const parts = t.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarColors(name: string) {
    let hash = 0;
    const key = name || "";
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

const GLOBAL_CSS = `
.bs-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.bs-card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(var(--brand-blue-rgb),.12); }
.bs-row:nth-child(even) { background: #fbfcfe; }
.bs-row { transition: background .12s ease; }
.bs-row:hover { background: #f0f6fd; }
.bs-view-btn:hover { text-decoration: underline; }
.bs-view-btn-filled:hover { filter: brightness(1.06); transform: translateY(-1px); }
.bs-icon-btn-danger:hover { background: #fee2e2 !important; border-color: #fecaca !important; }
.bs-drop:hover { border-color: #93b4f0 !important; background: #f5f8ff !important; }
.bs-table thead th:first-child { border-top-left-radius: 16px; }
.bs-table thead th:last-child { border-top-right-radius: 16px; }
.bs-btn:focus-visible, .bs-drop:focus-within { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
`;

export default function BlueLocations() {
    const isMobile = useIsMobileBlue();
    const role = getCurrentUser()?.role || "";
    const canManage = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"].includes(role);

    const [rows, setRows] = useState<RoleService[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState<UploadResult | null>(null);
    const [locFilter, setLocFilter] = useState("");
    const [search, setSearch] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [showUpload, setShowUpload] = useState(false);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/blue/role-services`, {
                cache: "no-store",
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message || "Failed to load services");
            setRows(json.data || []);
        } catch (e: any) {
            setError(e?.message || "Failed to load.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const flash = (m: string) => {
        setNotice(m);
        setTimeout(() => setNotice(""), 2500);
    };

    const deleteRow = async (r: RoleService) => {
        try {
            const res = await authFetch(`${API_BASE}/api/blue/role-services/${r.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            setRows((prev) => prev.filter((x) => x.id !== r.id));
            flash(`${r.service} removed from ${r.role}.`);
        } catch (e: any) {
            setError(e?.message || "Could not delete.");
        }
    };

    const downloadTemplate = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/blue/role-services/template`);
            if (!res.ok) throw new Error("Could not download the template.");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "role-services-template.xlsx";
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setError(e?.message || "Could not download the template.");
        }
    };

    const upload = async () => {
        if (!file) {
            setError("Please choose an Excel (.xlsx) or CSV file first.");
            return;
        }
        setUploading(true);
        setError("");
        setResult(null);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await authFetch(`${API_BASE}/api/blue/role-services/upload`, {
                method: "POST",
                body: fd,
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Upload failed");
            setResult(json.data);
            setFile(null);
            if (fileRef.current) fileRef.current.value = "";
            load();
        } catch (e: any) {
            setError(e?.message || "Upload failed.");
        } finally {
            setUploading(false);
        }
    };

    const closeUpload = () => {
        setShowUpload(false);
        setFile(null);
        setResult(null);
    };

    const locationOptions = useMemo(() => {
        const m = new Map<string, string>();
        rows.forEach((r) => m.set(r.locationId, r.locationName));
        return [...m.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [rows]);

    // one group per (location, role)
    const groups = useMemo<Group[]>(() => {
        const q = search.trim().toLowerCase();
        const m = new Map<string, Group>();
        rows.filter((r) => !locFilter || r.locationId === locFilter)
            .filter(
                (r) =>
                    !q ||
                    r.role.toLowerCase().includes(q) ||
                    r.service.toLowerCase().includes(q) ||
                    r.locationName.toLowerCase().includes(q)
            )
            .forEach((r) => {
                const key = `${r.locationId}::${r.role}`;
                if (!m.has(key))
                    m.set(key, { key, locationName: r.locationName, role: r.role, items: [] });
                m.get(key)!.items.push(r);
            });
        const out = [...m.values()];
        out.forEach((g) => g.items.sort((a, b) => a.service.localeCompare(b.service)));
        return out.sort(
            (a, b) => a.locationName.localeCompare(b.locationName) || a.role.localeCompare(b.role)
        );
    }, [rows, locFilter, search]);

    const totals = useMemo(
        () => ({
            roles: new Set(rows.map((r) => r.role.toLowerCase())).size,
            services: rows.length,
            locations: new Set(rows.map((r) => r.locationId)).size,
        }),
        [rows]
    );

    const details = detailsKey ? groups.find((g) => g.key === detailsKey) || null : null;
    const hasData = rows.length > 0;

    const previewText = (g: Group) => {
        const names = g.items.map((i) => i.service);
        return names.length > 2
            ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more`
            : names.join(", ");
    };

    return (
        <div
            style={{
                ...(isMobile ? ui.pageMobile : ui.page),
                background: "#f4f7fb",
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            <style>{GLOBAL_CSS}</style>

            {/* ---- title + actions ---- */}
            <div style={isMobile ? S.headerRowMobile : S.headerRow}>
                <div style={{ textAlign: "left" }}>
                    <h2 style={S.pageTitle}>Services</h2>
                    <p style={S.headerSubtext}>
                        {hasData
                            ? `Blue Collar — ${totals.services} services · ${totals.roles} ${
                                  totals.roles === 1 ? "role" : "roles"
                              } · ${totals.locations} ${
                                  totals.locations === 1 ? "location" : "locations"
                              }`
                            : "Blue Collar — which services each role does at each location."}
                    </p>
                </div>
                <div style={S.headerActions}>
                    <button
                        type="button"
                        className="bs-btn"
                        style={S.secondaryBtn}
                        onClick={downloadTemplate}
                    >
                        <i className="ti ti-file-spreadsheet" style={{ fontSize: fontSize.md }} />
                        Sample Sheet
                    </button>
                    {canManage && (
                        <button
                            type="button"
                            className="bs-btn"
                            style={S.addBtn}
                            onClick={() => setShowUpload(true)}
                        >
                            <i className="ti ti-upload" style={{ fontSize: fontSize.md }} />
                            Bulk Upload
                        </button>
                    )}
                </div>
            </div>

            <div aria-live="polite">
                {error && (
                    <div style={S.errorBanner}>
                        <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                        {error}
                    </div>
                )}
                {notice && <div style={ui.ok}>{notice}</div>}
            </div>

            {/* ---- filter bar ---- */}
            {hasData && (
                <div style={isMobile ? S.filterRowMobile : S.filterRow}>
                    <div style={S.searchWrap}>
                        <i
                            className="ti ti-search"
                            aria-hidden="true"
                            style={{ fontSize: fontSize.lg, color: "#7c8aa3" }}
                        />
                        <input
                            style={S.searchInput}
                            placeholder="Search role / service..."
                            aria-label="Search role or service"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <select
                        style={S.filterSelect}
                        value={locFilter}
                        aria-label="Location"
                        onChange={(e) => setLocFilter(e.target.value)}
                    >
                        <option value="">All locations</option>
                        {locationOptions.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                    {!isMobile && (
                        <div style={S.viewToggle}>
                            {(["grid", "list"] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setViewMode(m)}
                                    aria-label={`${m === "grid" ? "Grid" : "List"} view`}
                                    title={`${m === "grid" ? "Grid" : "List"} view`}
                                    style={{
                                        ...S.viewToggleBtn,
                                        ...(viewMode === m ? S.viewToggleBtnActive : {}),
                                    }}
                                >
                                    <i
                                        className={
                                            m === "grid" ? "ti ti-layout-grid" : "ti ti-list"
                                        }
                                        style={{ fontSize: fontSize.lg }}
                                    />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ---- content ---- */}
            {loading && !hasData ? (
                <div style={S.emptyState}>
                    <p style={S.emptyText}>Loading…</p>
                </div>
            ) : !hasData ? (
                <div style={S.emptyState}>
                    <i
                        className="ti ti-tools"
                        style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                    />
                    <p style={S.emptyText}>
                        No services yet.{" "}
                        {canManage
                            ? "Download the sample sheet, fill it and use Bulk Upload."
                            : "Ask an admin to upload them."}
                    </p>
                </div>
            ) : groups.length === 0 ? (
                <div style={S.emptyState}>
                    <i
                        className="ti ti-search-off"
                        style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                    />
                    <p style={S.emptyText}>No services match your filters.</p>
                    <button
                        type="button"
                        className="bs-btn"
                        style={S.secondaryBtn}
                        onClick={() => {
                            setLocFilter("");
                            setSearch("");
                        }}
                    >
                        Clear filters
                    </button>
                </div>
            ) : viewMode === "list" && !isMobile ? (
                <div style={S.tableWrap}>
                    <table className="bs-table" style={S.table}>
                        <colgroup>
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "32%" }} />
                            <col style={{ width: "20%" }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={S.th}>Role</th>
                                <th style={S.th}>Location</th>
                                <th style={S.th}>Services</th>
                                <th style={S.th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map((g) => {
                                const av = getAvatarColors(g.role);
                                return (
                                    <tr
                                        key={g.key}
                                        className="bs-row"
                                        style={{
                                            ...S.tr,
                                            boxShadow: `inset 3px 0 0 0 ${av.solid}`,
                                        }}
                                    >
                                        <td style={S.td}>
                                            <span style={S.tdNameText}>{g.role}</span>
                                        </td>
                                        <td style={S.td}>
                                            <span style={S.tdLine}>
                                                <i
                                                    className="ti ti-map-pin"
                                                    style={{ fontSize: fontSize.sm }}
                                                />
                                                {g.locationName}
                                            </span>
                                        </td>
                                        <td style={S.td}>
                                            <span
                                                style={S.tdLine}
                                                title={g.items.map((i) => i.service).join(", ")}
                                            >
                                                <i
                                                    className="ti ti-tools"
                                                    style={{ fontSize: fontSize.sm }}
                                                />
                                                {g.items.length} · {previewText(g)}
                                            </span>
                                        </td>
                                        <td style={S.td}>
                                            <button
                                                type="button"
                                                className="bs-view-btn"
                                                style={S.viewDetailsBtn}
                                                onClick={() => setDetailsKey(g.key)}
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={isMobile ? S.cardGridMobile : S.cardGrid}>
                    {groups.map((g) => {
                        const av = getAvatarColors(g.role);
                        return (
                            <div
                                key={g.key}
                                className="bs-card"
                                style={{
                                    ...S.card,
                                    border: `1px solid ${av.solid}40`,
                                    borderTop: `3px solid ${av.solid}`,
                                }}
                            >
                                <div style={S.cardHeader}>
                                    <div
                                        style={{
                                            ...S.avatar,
                                            background: `linear-gradient(135deg, ${av.from}, ${av.to})`,
                                            color: "#fff",
                                        }}
                                    >
                                        {getInitials(g.role)}
                                    </div>
                                    <div style={S.cardNameBlock}>
                                        <span style={S.cardName} title={g.role}>
                                            {g.role}
                                        </span>
                                        <span
                                            style={{
                                                ...S.cardBadge,
                                                background: `${av.solid}1A`,
                                                color: av.solid,
                                            }}
                                            title={g.locationName}
                                        >
                                            {g.locationName}
                                        </span>
                                    </div>
                                </div>

                                <div style={S.infoRows}>
                                    <div style={S.infoRow}>
                                        <i className="ti ti-tools" style={S.infoIcon} />
                                        <span style={S.infoValue}>
                                            {g.items.length}{" "}
                                            {g.items.length === 1 ? "service" : "services"}
                                        </span>
                                    </div>
                                    <div style={S.infoRow}>
                                        <i className="ti ti-list-details" style={S.infoIcon} />
                                        <span
                                            style={S.infoValue}
                                            title={g.items.map((i) => i.service).join(", ")}
                                        >
                                            {previewText(g)}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className="bs-view-btn-filled"
                                    style={{
                                        ...S.viewDetailsBtnFilled,
                                        background: `${av.solid}14`,
                                        color: av.solid,
                                    }}
                                    onClick={() => setDetailsKey(g.key)}
                                >
                                    <i className="ti ti-eye" style={{ fontSize: fontSize.md }} />
                                    View Details
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ---- View Details modal ---- */}
            {details && (
                <div style={S.overlay} onClick={() => setDetailsKey(null)}>
                    <div style={S.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={S.modalHeader}>
                            <div style={{ minWidth: 0, textAlign: "left" }}>
                                <h3 style={S.modalTitle}>{details.role}</h3>
                                <span style={S.modalSub}>
                                    <i className="ti ti-map-pin" /> {details.locationName}
                                </span>
                            </div>
                            <button
                                type="button"
                                style={S.closeBtn}
                                onClick={() => setDetailsKey(null)}
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <div style={S.modalBody}>
                            <div style={S.detailsLabel}>
                                {details.items.length}{" "}
                                {details.items.length === 1 ? "SERVICE" : "SERVICES"}
                            </div>
                            {details.items.map((r) => (
                                <div key={r.id} style={S.detailsRow}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            flexWrap: "wrap",
                                            minWidth: 0,
                                        }}
                                    >
                                        <span style={S.detailsValue}>{r.service}</span>
                                        {r.time && (
                                            <span
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                    height: 22,
                                                    padding: "0 9px",
                                                    borderRadius: 999,
                                                    background: "#EEF2FF",
                                                    color: "#3730A3",
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                <i className="ti ti-clock" aria-hidden="true" />
                                                {r.time}
                                            </span>
                                        )}
                                    </div>
                                    {canManage && (
                                        <button
                                            type="button"
                                            className="bs-icon-btn-danger"
                                            style={S.iconBtnDanger}
                                            aria-label={`Remove ${r.service} from ${r.role}`}
                                            title="Remove"
                                            onClick={() => deleteRow(r)}
                                        >
                                            <i
                                                className="ti ti-trash"
                                                style={{ fontSize: fontSize.base }}
                                            />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ---- Bulk Upload modal ---- */}
            {showUpload && canManage && (
                <div style={S.overlay} onClick={closeUpload}>
                    <div style={{ ...S.modal, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
                        <div style={S.modalHeader}>
                            <h3 style={S.modalTitle}>Upload services from Excel</h3>
                            <button
                                type="button"
                                style={S.closeBtn}
                                onClick={closeUpload}
                                aria-label="Close"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <div style={S.modalBody}>
                            <p style={{ ...S.headerSubtext, textAlign: "left", marginBottom: 12 }}>
                                One service per row, with columns <b>Location</b>, <b>Role</b>,{" "}
                                <b>Service</b> and an optional <b>Time</b> (like 10:00 AM or 10:00
                                AM - 11:00 AM, typed as text). Upload an existing service again with
                                a Time to update its time. A role must match the employee's
                                Designation (for example "Office Boy"). New locations in the file
                                are created automatically.
                            </p>

                            <label
                                className="bs-drop"
                                style={{
                                    position: "relative",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    padding: "12px 16px",
                                    border: "1.5px dashed #cfe0f5",
                                    borderRadius: radius.md,
                                    background: "#fafbfc",
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    style={{
                                        flex: "0 0 38px",
                                        width: 38,
                                        height: 38,
                                        borderRadius: radius.sm,
                                        background: "#e7ecf8",
                                        color: "var(--brand-blue)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 19,
                                    }}
                                >
                                    <i
                                        className={`ti ${file ? "ti-file-spreadsheet" : "ti-cloud-upload"}`}
                                    />
                                </span>
                                <span style={{ minWidth: 0 }}>
                                    <span
                                        style={{
                                            display: "block",
                                            fontWeight: fontWeight.semibold,
                                            color: "#16233c",
                                            fontSize: fontSize.base,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {file ? file.name : "Choose an Excel or CSV file"}
                                    </span>
                                    <span
                                        style={{
                                            display: "block",
                                            fontSize: fontSize.xs,
                                            color: "#7c8aa3",
                                        }}
                                    >
                                        {file ? "Ready to upload" : ".xlsx or .csv"}
                                    </span>
                                </span>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".xlsx,.csv"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    style={{
                                        position: "absolute",
                                        width: 1,
                                        height: 1,
                                        opacity: 0,
                                        pointerEvents: "none",
                                    }}
                                />
                            </label>

                            {result && (
                                <div style={{ ...ui.ok, marginTop: 12, textAlign: "left" }}>
                                    {result.added} added · {result.updated ?? 0} time updated ·{" "}
                                    {result.alreadyExisted} already existed · {result.newLocations}{" "}
                                    new location(s) · {result.rowsInFile} rows in file
                                    {result.errors.length > 0 && (
                                        <div style={{ color: "#B91C1C", marginTop: 6 }}>
                                            {result.errors.length} row(s) skipped:
                                            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                                                {result.errors.slice(0, 8).map((er) => (
                                                    <li key={er.line}>
                                                        Row {er.line}: {er.message}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                type="button"
                                className="bs-btn"
                                style={{
                                    ...S.addBtn,
                                    justifyContent: "center",
                                    width: "100%",
                                    marginTop: 14,
                                    opacity: uploading || !file ? 0.55 : 1,
                                    cursor: uploading || !file ? "not-allowed" : "pointer",
                                }}
                                disabled={uploading || !file}
                                onClick={upload}
                            >
                                {uploading ? "Uploading…" : "Upload & Create Services"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---- styles (mirrors admin/products.tsx) ----
const S: Record<string, CSSProperties> = {
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        textAlign: "left",
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
    },
    headerRowMobile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 12,
    },
    headerSubtext: { margin: "2px 0 0", fontSize: fontSize.base, color: "#7c8aa3" },
    headerActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    secondaryBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "var(--brand-blue)",
        border: "1px solid #cfe0f5",
        borderRadius: radius.md,
        padding: "11px 16px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    addBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        border: "none",
        borderRadius: radius.md,
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    errorBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        color: "#b91c1c",
        borderRadius: radius.md,
        padding: "10px 14px",
        fontSize: fontSize.base,
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    filterRowMobile: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,.04)",
    },
    searchWrap: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 180,
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 12px",
    },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.base,
        color: "#16233c",
        fontFamily: "inherit",
        width: "100%",
    },
    filterSelect: {
        border: "1px solid #e4e9f2",
        background: "#fafbfc",
        borderRadius: radius.md,
        padding: "9px 12px",
        fontSize: fontSize.base,
        color: "#3b4a63",
        fontFamily: "inherit",
        outline: "none",
        cursor: "pointer",
        minWidth: 150,
    },
    viewToggle: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fafbfc",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: 4,
        flexShrink: 0,
    },
    viewToggleBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: "none",
        background: "transparent",
        borderRadius: radius.sm,
        color: "#7c8aa3",
        cursor: "pointer",
    },
    viewToggleBtnActive: { background: "#e7ecf8", color: "var(--brand-blue)" },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 0",
    },
    emptyText: { margin: 0, fontSize: fontSize.base, color: "#7c8aa3" },

    // cards
    cardGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 14,
    },
    cardGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 12 },
    card: {
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: radius.lg,
        padding: 13,
        boxShadow: "0 4px 14px rgba(0,0,0,.04)",
        gap: 9,
        textAlign: "left",
    },
    cardHeader: { display: "flex", alignItems: "flex-start", gap: 10 },
    cardNameBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
        minWidth: 0,
    },
    cardName: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    cardBadge: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
        width: "fit-content",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
    },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: radius.circle,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    infoRows: { display: "flex", flexDirection: "column", gap: 8 },
    infoRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
    infoIcon: { fontSize: fontSize.sm, color: "#a7b3c8", flexShrink: 0 },
    infoValue: {
        fontSize: fontSize.sm,
        color: "#3b4a63",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    viewDetailsBtnFilled: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        border: "none",
        borderRadius: radius.md,
        padding: "9px 12px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "filter .15s ease, transform .15s ease",
    },

    // table
    tableWrap: {
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(16,38,89,.06)",
        overflowX: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        fontSize: fontSize.base,
        tableLayout: "fixed",
    },
    th: {
        textAlign: "left",
        padding: "15px 18px",
        boxSizing: "border-box",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.bold,
        color: "var(--brand-blue)",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        borderBottom: "2px solid #e1e9f7",
        background: "linear-gradient(180deg, #f3f7fd, #eef3fb)",
    },
    tr: { borderBottom: "1px solid #eef2f9" },
    td: {
        padding: "14px 18px",
        boxSizing: "border-box",
        verticalAlign: "middle",
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderBottom: "1px solid #eef2f9",
    },
    tdNameText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: "#16233c" },
    tdLine: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: fontSize.sm,
        color: "#3b4a63",
    },
    viewDetailsBtn: {
        border: "none",
        background: "transparent",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        padding: 0,
    },

    // modals
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(16,24,40,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
    },
    modal: {
        width: "100%",
        maxWidth: 440,
        maxHeight: "86vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 20px 50px rgba(16,24,40,.25)",
        overflow: "hidden",
    },
    modalHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "16px 18px",
        borderBottom: "1px solid #eef2f9",
    },
    modalTitle: {
        margin: 0,
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#16233c",
    },
    modalSub: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginTop: 4,
        fontSize: fontSize.sm,
        color: "#7c8aa3",
    },
    closeBtn: {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: fontSize.lg,
        color: "#7c8aa3",
    },
    modalBody: { padding: "14px 18px 18px", overflowY: "auto" },
    detailsLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#7c8aa3",
        letterSpacing: 0.4,
        marginBottom: 6,
        textAlign: "left",
    },
    detailsRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid #eef2f9",
    },
    detailsValue: { fontSize: fontSize.base, color: "#16233c", textAlign: "left" },
    iconBtnDanger: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        border: "1px solid #fee2e2",
        background: "#fff5f5",
        color: "#dc2626",
        cursor: "pointer",
        flexShrink: 0,
    },
};
