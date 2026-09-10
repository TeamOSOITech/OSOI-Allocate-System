// src/components/manageroleslabels.tsx
//
// Rendered on the Home page, Super Admin only. Lets an admin rename any
// of the app's 5 assignable roles for their own organization — e.g.
// showing "Team Member" as "Employee" everywhere in the app. The
// underlying role value (and everything it can/can't do) never changes;
// this only changes what gets PRINTED for it. See:
//   - backend/src/modules/roleLabels/roleLabels.routes.js (storage + API)
//   - src/context/roleLabelsContext.tsx (app-wide read side)
//
// Supports renaming SEVERAL roles in one go: starts with 1 row (role +
// new name), "+ Add More" appends another row picking a role that isn't
// already used in another row, capped at CUSTOMIZABLE_ROLES.length since
// there's nothing left to add once every customizable role has a row.

import { useState } from "react";
import { authFetch } from "../utils/authFetch";
import { fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";
import {
    useRoleLabels,
    CUSTOMIZABLE_ROLES,
    DEFAULT_ROLE_LABELS,
} from "../context/roleLabelsContext";

const API_BASE = import.meta.env.VITE_API_URL;

type Row = { role: string; label: string };

// First role in CUSTOMIZABLE_ROLES not already picked by another row —
// used both for the initial row and whenever "+ Add More" is clicked.
function firstUnusedRole(rows: Row[]): string | null {
    const used = new Set(rows.map((r) => r.role));
    return CUSTOMIZABLE_ROLES.find((r) => !used.has(r)) ?? null;
}

// Pre-fills a row's label with the role's current custom name (if any),
// so the admin sees what they're changing FROM instead of a blank box.
function prefillLabel(role: string, roleLabels: Record<string, string>): string {
    const current = roleLabels[role];
    return current && current !== DEFAULT_ROLE_LABELS[role] ? current : "";
}

export default function ManageRoleLabelsButton() {
    const { colors: BRAND } = useTheme();
    const { roleLabels, refreshRoleLabels } = useRoleLabels();
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const openModal = () => {
        // FIX: was always starting with a single blank row for the
        // FIRST role (TEAM_MEMBER) — so reopening this after customizing
        // several roles only ever showed TEAM_MEMBER, making it look
        // like the others weren't saved (they were — just not shown
        // until "+ Add More" was clicked for each one). Now pre-fills a
        // row for every role that already has a custom name, so
        // everything customized so far is visible immediately.
        const alreadyCustomized = CUSTOMIZABLE_ROLES.filter(
            (role) => roleLabels[role] && roleLabels[role] !== DEFAULT_ROLE_LABELS[role]
        );
        const initialRoles =
            alreadyCustomized.length > 0 ? alreadyCustomized : [CUSTOMIZABLE_ROLES[0]];
        setRows(initialRoles.map((role) => ({ role, label: prefillLabel(role, roleLabels) })));
        setError("");
        setOpen(true);
    };

    const closeModal = () => {
        setOpen(false);
        setError("");
        setRows([]);
    };

    const updateRowRole = (index: number, role: string) => {
        setRows((prev) =>
            prev.map((r, i) => (i === index ? { role, label: prefillLabel(role, roleLabels) } : r))
        );
        setError("");
    };

    const updateRowLabel = (index: number, label: string) => {
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
        setError("");
    };

    const addRow = () => {
        const next = firstUnusedRole(rows);
        if (!next) return; // every customizable role already has a row
        setRows((prev) => [...prev, { role: next, label: prefillLabel(next, roleLabels) }]);
    };

    const removeRow = (index: number) => {
        // Keep at least 1 row on screen — remove down to nothing would
        // leave no way to pick a role at all.
        setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    };

    const resetRowToDefault = async (index: number) => {
        const row = rows[index];
        setSaving(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/role-labels`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: row.role, label: "" }),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            await refreshRoleLabels();
            updateRowLabel(index, "");
        } catch (err: any) {
            setError(err?.message || "Couldn't reset — please try again.");
        } finally {
            setSaving(false);
        }
    };

    // "Clear All" — resets EVERY currently-customized role back to its
    // default name in one click, not just the ones currently shown as
    // rows. Fired in parallel (same reasoning as handleSaveAll below).
    const anyCustomized = CUSTOMIZABLE_ROLES.some(
        (role) => roleLabels[role] && roleLabels[role] !== DEFAULT_ROLE_LABELS[role]
    );

    const handleClearAll = async () => {
        const customizedRoles = CUSTOMIZABLE_ROLES.filter(
            (role) => roleLabels[role] && roleLabels[role] !== DEFAULT_ROLE_LABELS[role]
        );
        if (customizedRoles.length === 0) return;

        setSaving(true);
        setError("");
        const results = await Promise.allSettled(
            customizedRoles.map((role) =>
                authFetch(`${API_BASE}/api/role-labels`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role, label: "" }),
                }).then((res) => {
                    if (!res.ok) throw new Error(`Request failed (${res.status})`);
                })
            )
        );

        await refreshRoleLabels();
        setSaving(false);

        const failedCount = results.filter((r) => r.status === "rejected").length;
        if (failedCount > 0) {
            setError(`Couldn't clear ${failedCount} role(s). Please try again.`);
            return;
        }

        // Everything's back to default — collapse back to a single blank row.
        setRows([{ role: CUSTOMIZABLE_ROLES[0], label: "" }]);
    };

    // Only rows with an actual name typed in get saved — a row left
    // blank (e.g. an extra one added via "+ Add More" and then not
    // filled in) is just skipped, not an error, matching the same
    // "at least 1 filled, rest optional" pattern as the Add Team popup.
    const handleSaveAll = async () => {
        const toSave = rows.filter((r) => r.label.trim());
        if (toSave.length === 0) {
            setError("Enter at least one new name to save.");
            return;
        }

        setSaving(true);
        setError("");

        // FIX (was slow): each row was saved ONE AT A TIME in a for-loop,
        // so N roles meant N sequential network round trips before Save
        // finished. Fired in parallel instead — same number of requests,
        // but they all happen at once, so Save takes roughly the time of
        // ONE request regardless of how many rows are being saved.
        const results = await Promise.allSettled(
            toSave.map((row) =>
                authFetch(`${API_BASE}/api/role-labels`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role: row.role, label: row.label.trim() }),
                }).then(async (res) => {
                    if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.message || `Request failed (${res.status})`);
                    }
                })
            )
        );

        const failed = toSave
            .filter((_, i) => results[i].status === "rejected")
            .map((row) => DEFAULT_ROLE_LABELS[row.role] || row.role);

        await refreshRoleLabels();
        setSaving(false);

        if (failed.length > 0) {
            setError(
                `Couldn't save: ${failed.join(", ")}. ${
                    failed.length < toSave.length ? "The rest were saved." : "Please try again."
                }`
            );
            return;
        }

        closeModal();
    };

    const canAddMore = rows.length < CUSTOMIZABLE_ROLES.length;

    return (
        <>
            <button
                type="button"
                onClick={openModal}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#fff",
                    color: BRAND.blue,
                    border: `1px solid ${BRAND.blue}33`,
                    borderRadius: radius["2xl"],
                    padding: "9px 18px",
                    fontSize: fontSize.base,
                    fontWeight: fontWeight.semibold,
                    cursor: "pointer",
                }}
            >
                <i className="ti ti-user-cog" style={{ fontSize: fontSize.md }} />
                Manage Roles
            </button>

            {open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.4)",
                        zIndex: 200,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: "#fff",
                            borderRadius: radius.lg,
                            width: 460,
                            maxWidth: "92vw",
                            maxHeight: "88vh",
                            overflowY: "auto",
                            boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
                            padding: "24px 28px 28px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                marginBottom: 4,
                            }}
                        >
                            <h3
                                style={{
                                    margin: 0,
                                    fontSize: fontSize.xl,
                                    fontWeight: fontWeight.semibold,
                                }}
                            >
                                Manage Roles
                            </h3>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                {/* "Clear All" — resets every customized role
                                    back to default in one click, next to the
                                    title so it's visible without scrolling
                                    even when several roles are already
                                    customized. */}
                                {anyCustomized && (
                                    <button
                                        type="button"
                                        onClick={handleClearAll}
                                        disabled={saving}
                                        style={{
                                            background: "none",
                                            border: "none",
                                            color: "#767F92",
                                            fontSize: fontSize.sm,
                                            textDecoration: "underline",
                                            cursor: saving ? "not-allowed" : "pointer",
                                            padding: 0,
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        Clear All
                                    </button>
                                )}
                                <button
                                    onClick={closeModal}
                                    type="button"
                                    aria-label="Close"
                                    style={{
                                        background: "none",
                                        border: "none",
                                        fontSize: fontSize.lg,
                                        cursor: "pointer",
                                        color: "#767F92",
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <p
                            style={{
                                margin: "0 0 20px",
                                fontSize: fontSize.base,
                                color: "#767F92",
                            }}
                        >
                            Rename how a role is shown across this app, for your organization only.
                            Permissions for that role stay exactly the same — only the name changes.
                        </p>

                        {rows.map((row, index) => {
                            const isCustomized =
                                roleLabels[row.role] &&
                                roleLabels[row.role] !== DEFAULT_ROLE_LABELS[row.role];
                            // A role already picked by another row can't be
                            // picked again here — but this row's OWN current
                            // pick always stays in its own list.
                            const usedByOthers = new Set(
                                rows.filter((_, i) => i !== index).map((r) => r.role)
                            );
                            const optionsForThisRow = CUSTOMIZABLE_ROLES.filter(
                                (r) => r === row.role || !usedByOthers.has(r)
                            );

                            return (
                                <div
                                    key={index}
                                    style={{
                                        marginBottom: 16,
                                        paddingBottom: 16,
                                        borderBottom:
                                            index < rows.length - 1 ? "1px solid #EEF0F5" : "none",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            marginBottom: 6,
                                        }}
                                    >
                                        <label
                                            style={{
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.medium,
                                                color: "#4B5563",
                                            }}
                                        >
                                            Role
                                        </label>
                                        {rows.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeRow(index)}
                                                aria-label="Remove this role"
                                                style={{
                                                    background: "none",
                                                    border: "none",
                                                    color: "#9CA3AF",
                                                    fontSize: fontSize.sm,
                                                    cursor: "pointer",
                                                    padding: 0,
                                                }}
                                            >
                                                ✕ Remove
                                            </button>
                                        )}
                                    </div>
                                    <select
                                        value={row.role}
                                        onChange={(e) => updateRowRole(index, e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "10px 12px",
                                            borderRadius: radius.md,
                                            border: "1px solid #D8DCE5",
                                            fontSize: fontSize.base,
                                            marginBottom: 12,
                                            background: "#fff",
                                            // FIX: no explicit color was set, so in
                                            // dark mode (see index.css's
                                            // `color-scheme: light dark`) the browser
                                            // applied its native dark-mode text color
                                            // to this <select> — white text on the
                                            // white background above, invisible.
                                            color: "#17181C",
                                        }}
                                    >
                                        {optionsForThisRow.map((role) => (
                                            <option key={role} value={role}>
                                                {DEFAULT_ROLE_LABELS[role]}
                                                {roleLabels[role] &&
                                                roleLabels[role] !== DEFAULT_ROLE_LABELS[role]
                                                    ? ` (currently "${roleLabels[role]}")`
                                                    : ""}
                                            </option>
                                        ))}
                                    </select>

                                    <label
                                        style={{
                                            display: "block",
                                            fontSize: fontSize.sm,
                                            fontWeight: fontWeight.medium,
                                            color: "#4B5563",
                                            marginBottom: 6,
                                        }}
                                    >
                                        New name for this role
                                    </label>
                                    <input
                                        value={row.label}
                                        onChange={(e) => updateRowLabel(index, e.target.value)}
                                        placeholder={`e.g. "Employee" instead of "${DEFAULT_ROLE_LABELS[row.role]}"`}
                                        style={{
                                            width: "100%",
                                            padding: "10px 12px",
                                            borderRadius: radius.md,
                                            border: "1px solid #D8DCE5",
                                            fontSize: fontSize.base,
                                            marginBottom: isCustomized ? 8 : 0,
                                            boxSizing: "border-box",
                                            // FIX: neither background nor color was
                                            // set here at all, so in dark mode (see
                                            // index.css's `color-scheme: light dark`)
                                            // the browser rendered this with its
                                            // native dark-mode input colors — a dark
                                            // box with barely-visible text sitting
                                            // inside this white modal card.
                                            background: "#fff",
                                            color: "#17181C",
                                        }}
                                    />

                                    {isCustomized && (
                                        <button
                                            type="button"
                                            onClick={() => resetRowToDefault(index)}
                                            disabled={saving}
                                            style={{
                                                background: "none",
                                                border: "none",
                                                color: "#767F92",
                                                fontSize: fontSize.sm,
                                                textDecoration: "underline",
                                                cursor: saving ? "not-allowed" : "pointer",
                                                padding: 0,
                                            }}
                                        >
                                            Reset "{DEFAULT_ROLE_LABELS[row.role]}" to default
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {canAddMore && (
                            <button
                                type="button"
                                onClick={addRow}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: "none",
                                    border: `1px dashed ${BRAND.blue}66`,
                                    color: BRAND.blue,
                                    fontSize: fontSize.sm,
                                    fontWeight: fontWeight.medium,
                                    padding: "9px 14px",
                                    borderRadius: radius.md,
                                    cursor: "pointer",
                                    width: "100%",
                                    justifyContent: "center",
                                    marginBottom: 16,
                                }}
                            >
                                + Add More
                            </button>
                        )}

                        {error && (
                            <p
                                style={{
                                    color: "#dc2626",
                                    fontSize: fontSize.sm,
                                    margin: "0 0 12px",
                                }}
                            >
                                {error}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={handleSaveAll}
                            disabled={saving}
                            style={{
                                width: "100%",
                                padding: "11px 0",
                                borderRadius: radius.md,
                                border: "none",
                                background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
                                color: "#fff",
                                fontWeight: fontWeight.semibold,
                                fontSize: fontSize.base,
                                cursor: saving ? "not-allowed" : "pointer",
                                opacity: saving ? 0.7 : 1,
                                marginTop: 4,
                            }}
                        >
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
