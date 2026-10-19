// src/pages/blue/locations.tsx
//
// Blue Collar setup: locations + the Role -> Services map (Excel upload).
// Excel columns: Location | Role | Service (one service per row).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser } from "../../utils/auth";
import { fontSize, fontWeight } from "../../styles/theme";
import { ui, useIsMobileBlue } from "./ui";

const API_BASE = import.meta.env.VITE_API_URL;

type Loc = { id: string; name: string; employeeCount: number };
type RoleService = {
    id: string;
    locationId: string;
    locationName: string;
    role: string;
    service: string;
};
type UploadResult = {
    rowsInFile: number;
    added: number;
    alreadyExisted: number;
    newLocations: number;
    errors: { line: number; message: string }[];
};

export default function BlueLocations() {
    const isMobile = useIsMobileBlue();
    const role = getCurrentUser()?.role || "";
    const canManage = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"].includes(role);

    const [locations, setLocations] = useState<Loc[]>([]);
    const [rows, setRows] = useState<RoleService[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [newLocation, setNewLocation] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState<UploadResult | null>(null);
    const [locFilter, setLocFilter] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [lRes, rRes] = await Promise.all([
                authFetch(`${API_BASE}/api/blue/locations`, { cache: "no-store" }),
                authFetch(`${API_BASE}/api/blue/role-services`, { cache: "no-store" }),
            ]);
            const [lJson, rJson] = await Promise.all([lRes.json(), rRes.json()]);
            if (!lRes.ok) throw new Error(lJson.message || "Failed to load locations");
            if (!rRes.ok) throw new Error(rJson.message || "Failed to load role services");
            setLocations(lJson.data || []);
            setRows(rJson.data || []);
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

    const addLocation = async () => {
        if (!newLocation.trim()) return;
        try {
            const res = await authFetch(`${API_BASE}/api/blue/locations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newLocation.trim() }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            setNewLocation("");
            flash("Location added.");
            load();
        } catch (e: any) {
            setError(e?.message || "Could not add location.");
        }
    };

    const deleteLocation = async (l: Loc) => {
        if (
            !window.confirm(
                `Delete "${l.name}"? Its role-service mappings are removed and ${l.employeeCount} people become "No location".`
            )
        )
            return;
        try {
            const res = await authFetch(`${API_BASE}/api/blue/locations/${l.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            load();
        } catch (e: any) {
            setError(e?.message || "Could not delete.");
        }
    };

    const deleteRow = async (r: RoleService) => {
        try {
            const res = await authFetch(`${API_BASE}/api/blue/role-services/${r.id}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            setRows((prev) => prev.filter((x) => x.id !== r.id));
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

    // location -> role -> services
    const grouped = useMemo(() => {
        const out = new Map<string, Map<string, RoleService[]>>();
        rows.filter((r) => !locFilter || r.locationId === locFilter).forEach((r) => {
            if (!out.has(r.locationName)) out.set(r.locationName, new Map());
            const roles = out.get(r.locationName)!;
            if (!roles.has(r.role)) roles.set(r.role, []);
            roles.get(r.role)!.push(r);
        });
        return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [rows, locFilter]);

    return (
        <div style={isMobile ? ui.pageMobile : ui.page}>
            <h2 style={ui.title}>Locations & Services</h2>
            <p style={ui.sub}>
                Blue Collar setup — add locations, then upload an Excel that maps each Role to its
                Services.
            </p>

            {error && <div style={ui.error}>{error}</div>}
            {notice && <div style={ui.ok}>{notice}</div>}

            <div
                style={{
                    display: "grid",
                    gap: 16,
                    marginTop: 16,
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                }}
            >
                {/* ---------------- Locations ---------------- */}
                <div style={ui.card}>
                    <h3 style={{ margin: "0 0 10px", fontSize: fontSize.xl }}>Locations</h3>
                    {canManage && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                            <input
                                placeholder="e.g. Plant A"
                                value={newLocation}
                                onChange={(e) => setNewLocation(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && addLocation()}
                                style={{ ...ui.input, flex: 1 }}
                            />
                            <button style={ui.btn("#1E40AF")} onClick={addLocation}>
                                Add
                            </button>
                        </div>
                    )}
                    {loading && <p style={ui.sub}>Loading…</p>}
                    {!loading && locations.length === 0 && (
                        <p style={ui.sub}>
                            No locations yet. Add one, or just upload the Excel — it creates them.
                        </p>
                    )}
                    {locations.map((l) => (
                        <div
                            key={l.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 0",
                                borderTop: "1px solid #F3F4F6",
                            }}
                        >
                            <i
                                className="ti ti-map-pin"
                                aria-hidden="true"
                                style={{ color: "#1E40AF" }}
                            />
                            <span style={{ flex: 1, fontWeight: fontWeight.semibold }}>
                                {l.name}
                            </span>
                            <span style={ui.pill("#EFF6FF", "#1E40AF")}>
                                {l.employeeCount} people
                            </span>
                            {canManage && (
                                <button
                                    style={{ ...ui.ghostBtn, color: "#B91C1C" }}
                                    onClick={() => deleteLocation(l)}
                                    aria-label={`Delete ${l.name}`}
                                >
                                    <i className="ti ti-trash" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {/* ---------------- Excel upload ---------------- */}
                <div style={ui.card}>
                    <h3 style={{ margin: "0 0 4px", fontSize: fontSize.xl }}>
                        Upload Role → Services
                    </h3>
                    <p style={{ ...ui.sub, margin: "0 0 12px" }}>
                        Columns: <b>Location</b>, <b>Role</b>, <b>Service</b> — one service per row.
                        A role must match the employee's Designation (e.g. "Office Boy").
                    </p>
                    <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                    >
                        <button style={ui.ghostBtn} onClick={downloadTemplate}>
                            <i className="ti ti-download" aria-hidden="true" /> Template
                        </button>
                        {canManage && (
                            <>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".xlsx,.csv"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    style={{ fontSize: fontSize.sm, maxWidth: 220 }}
                                />
                                <button
                                    style={{
                                        ...ui.btn("#1E40AF"),
                                        opacity: uploading || !file ? 0.6 : 1,
                                    }}
                                    disabled={uploading || !file}
                                    onClick={upload}
                                >
                                    {uploading ? "Uploading…" : "Upload"}
                                </button>
                            </>
                        )}
                    </div>
                    {!canManage && <p style={ui.sub}>Only admins can upload.</p>}

                    {result && (
                        <div style={{ ...ui.ok, marginTop: 14 }}>
                            {result.added} added · {result.alreadyExisted} already existed ·{" "}
                            {result.newLocations} new location(s) · {result.rowsInFile} rows in file
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
                </div>
            </div>

            {/* ---------------- Mapped services ---------------- */}
            <div style={{ ...ui.card, marginTop: 16 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 10,
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: fontSize.xl, flex: 1 }}>Role → Services</h3>
                    <select
                        value={locFilter}
                        onChange={(e) => setLocFilter(e.target.value)}
                        style={ui.input}
                    >
                        <option value="">All locations</option>
                        {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </div>
                {!loading && grouped.length === 0 && (
                    <p style={ui.sub}>Nothing mapped yet — upload the Excel above.</p>
                )}
                {grouped.map(([locName, roles]) => (
                    <div key={locName} style={{ marginBottom: 16 }}>
                        <div style={{ fontWeight: fontWeight.bold, marginBottom: 6 }}>
                            <i className="ti ti-map-pin" aria-hidden="true" /> {locName}
                        </div>
                        {[...roles.entries()]
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([roleName, list]) => (
                                <div
                                    key={roleName}
                                    style={{
                                        display: "flex",
                                        gap: 10,
                                        padding: "8px 0",
                                        borderTop: "1px solid #F3F4F6",
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                    }}
                                >
                                    <div style={{ width: 150, fontWeight: fontWeight.semibold }}>
                                        {roleName}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            gap: 6,
                                            flexWrap: "wrap",
                                            flex: 1,
                                        }}
                                    >
                                        {list.map((r) => (
                                            <span key={r.id} style={ui.pill("#F3F4F6", "#374151")}>
                                                {r.service}
                                                {canManage && (
                                                    <button
                                                        onClick={() => deleteRow(r)}
                                                        aria-label={`Remove ${r.service}`}
                                                        style={{
                                                            border: "none",
                                                            background: "none",
                                                            cursor: "pointer",
                                                            color: "#9CA3AF",
                                                            marginLeft: 4,
                                                            padding: 0,
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
