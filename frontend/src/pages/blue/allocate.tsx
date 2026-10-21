// src/pages/blue/allocate.tsx
//
// Blue Collar "Allocate Work": every present employee automatically gets the
// services mapped to their Designation (Services page), so nothing has to be
// allocated day by day. A manager only uses this page to give someone an
// EXTRA duty for a date (e.g. the pantry cleaner is absent, so the office boy
// covers it). The employee's Submit Work page shows role duties + extras.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import { ui, useIsMobileBlue } from "./ui";

const API_BASE = import.meta.env.VITE_API_URL;

type Person = {
    id: string;
    name: string;
    designation: string;
    team: string;
    locationId: string;
    locationName: string;
    status: string;
    services: string[]; // own role duties (automatic)
    extraOptions: string[]; // services that can be given as an extra duty
    extras: string[]; // extra duties saved for the date
    done: string[]; // what they submitted for the date
};
type Payload = {
    date: string;
    today: string;
    locations: { id: string; name: string }[];
    people: Person[];
};

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
const avatarOf = (name: string) => {
    let h = 0;
    for (let i = 0; i < (name || "").length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
};
const initialsOf = (name: string) => {
    const p = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
    PRESENT: { label: "Present", bg: "#DCFCE7", fg: "#166534" },
    HALF_DAY: { label: "Half day", bg: "#FEF3C7", fg: "#92400E" },
    LEAVE: { label: "On leave", bg: "#FEE2E2", fg: "#B91C1C" },
    ABSENT: { label: "Absent", bg: "#FEE2E2", fg: "#B91C1C" },
};
const isAway = (s: string) => s === "LEAVE" || s === "ABSENT";
const norm = (s: string) => (s || "").trim().toLowerCase();
const sameList = (a: string[] = [], b: string[] = []) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const CSS = `
.al-btn:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
.al-btn:not(:disabled):hover { filter: brightness(1.05); }
.al-card { transition: box-shadow .18s ease, transform .18s ease; }
.al-card:hover { box-shadow: 0 10px 24px rgba(var(--brand-blue-rgb),.10); transform: translateY(-1px); }
.al-opt:hover { background: #f0f6fd; }
.al-x:hover { background: #fee2e2 !important; color: #b91c1c !important; }
.al-add:hover { background: #f5f8ff !important; border-color: var(--brand-blue) !important; }
`;

/* ---------- multi-select for one person's services ---------- */
function ServicePicker({
    options,
    value,
    onChange,
    disabled,
}: {
    options: string[];
    value: string[];
    onChange: (v: string[]) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, []);

    const toggle = (n: string) =>
        onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);

    return (
        <div ref={ref} style={{ position: "relative" }}>
            {value.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginBottom: disabled ? 0 : 8,
                    }}
                >
                    {value.map((n) => (
                        <span key={n} style={S.chip}>
                            {n}
                            {!disabled && (
                                <button
                                    type="button"
                                    className="al-x"
                                    style={S.chipX}
                                    aria-label={`Remove ${n}`}
                                    onClick={() => toggle(n)}
                                >
                                    <i className="ti ti-x" aria-hidden="true" />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}
            {value.length === 0 && disabled && (
                <span style={{ fontSize: fontSize.sm, color: "#a7b3c8" }}>No extra duty</span>
            )}
            {!disabled && (
                <button
                    type="button"
                    className="al-btn al-add"
                    style={value.length ? S.editBtn : S.addBtn2}
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                >
                    <i
                        className={`ti ${value.length ? "ti-pencil" : "ti-plus"}`}
                        aria-hidden="true"
                    />
                    {value.length ? "Change extra duty" : "Add extra duty"}
                </button>
            )}
            {open && (
                <div style={S.popover}>
                    <div style={S.popoverTop}>
                        <button
                            type="button"
                            style={S.linkBtn}
                            onClick={() => onChange([...options])}
                        >
                            Select all
                        </button>
                        <button type="button" style={S.linkBtn} onClick={() => onChange([])}>
                            Clear
                        </button>
                    </div>
                    {options.map((n) => (
                        <label key={n} className="al-opt" style={S.optRow}>
                            <input
                                type="checkbox"
                                checked={value.includes(n)}
                                onChange={() => toggle(n)}
                            />
                            {n}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

function StatTile({
    icon,
    label,
    value,
    bg,
    fg,
}: {
    icon: string;
    label: string;
    value: number;
    bg: string;
    fg: string;
}) {
    return (
        <div style={S.tile}>
            <span style={{ ...S.tileIcon, background: bg, color: fg }} aria-hidden="true">
                <i className={`ti ${icon}`} />
            </span>
            <div style={{ textAlign: "left" }}>
                <div style={S.tileValue}>{value}</div>
                <div style={S.tileLabel}>{label}</div>
            </div>
        </div>
    );
}

export default function BlueAllocate() {
    const isMobile = useIsMobileBlue();
    const navigate = useNavigate();
    const [date, setDate] = useState("");
    const [data, setData] = useState<Payload | null>(null);
    const [draft, setDraft] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [locFilter, setLocFilter] = useState("");
    const [search, setSearch] = useState("");
    const [showHelp, setShowHelp] = useState(() => {
        try {
            return localStorage.getItem("blueAllocHelpHidden") !== "1";
        } catch {
            return true;
        }
    });

    const hideHelp = () => {
        setShowHelp(false);
        try {
            localStorage.setItem("blueAllocHelpHidden", "1");
        } catch {
            /* ignore */
        }
    };

    const flash = (m: string) => {
        setNotice(m);
        setTimeout(() => setNotice(""), 3500);
    };

    const load = useCallback(async (d: string) => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(
                `${API_BASE}/api/blue/allocations${d ? `?date=${encodeURIComponent(d)}` : ""}`,
                { cache: "no-store" }
            );
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to load");
            const p: Payload = json.data;
            setData(p);
            const next: Record<string, string[]> = {};
            p.people.forEach((x) => {
                next[x.id] = isAway(x.status) ? [] : x.extras;
            });
            setDraft(next);
        } catch (e: any) {
            setError(e?.message || "Failed to load.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(date);
    }, [date, load]);

    const readOnly = Boolean(data && data.date < data.today);

    const original = useMemo(() => {
        const m: Record<string, string[]> = {};
        data?.people.forEach((p) => {
            m[p.id] = isAway(p.status) ? [] : p.extras;
        });
        return m;
    }, [data]);

    const changedIds = useMemo(
        () =>
            (data?.people || [])
                .filter((p) => !sameList(draft[p.id], original[p.id]))
                .map((p) => p.id),
        [data, draft, original]
    );
    const dirty = changedIds.length > 0;

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data?.people || [])
            .filter((p) => !locFilter || p.locationId === locFilter)
            .filter(
                (p) =>
                    !q ||
                    p.name.toLowerCase().includes(q) ||
                    p.designation.toLowerCase().includes(q) ||
                    (draft[p.id] || []).some((s) => s.toLowerCase().includes(q))
            );
    }, [data, locFilter, search, draft]);

    // location -> role -> people
    const grouped = useMemo(() => {
        const out = new Map<string, Map<string, { role: string; people: Person[] }>>();
        visible.forEach((p) => {
            const loc = p.locationName || "No location";
            if (!out.has(loc)) out.set(loc, new Map());
            const roles = out.get(loc)!;
            const key = norm(p.designation) || "-";
            if (!roles.has(key)) roles.set(key, { role: p.designation || "No role", people: [] });
            roles.get(key)!.people.push(p);
        });
        return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [visible]);

    const stats = useMemo(() => {
        const people = data?.people || [];
        const present = people.filter((p) => !isAway(p.status));
        const withExtra = present.filter((p) => (draft[p.id] || []).length > 0).length;
        const noServices = present.filter((p) => p.services.length === 0).length;
        return {
            present: present.length,
            withExtra,
            onDuty: present.length - noServices,
            away: people.length - present.length,
            noServices,
        };
    }, [data, draft]);

    const setFor = (id: string, v: string[]) => setDraft((d) => ({ ...d, [id]: v }));

    const clearAll = () => {
        const next = { ...draft };
        visible.forEach((p) => (next[p.id] = []));
        setDraft(next);
    };

    const save = async () => {
        if (!data || !dirty) return;
        setSaving(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/blue/allocations`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: data.date,
                    items: changedIds.map((id) => ({ employeeId: id, extras: draft[id] || [] })),
                }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to save");
            flash("Extra duties saved. Employees will see them on Submit Work.");
            load(date);
        } catch (e: any) {
            setError(e?.message || "Failed to save.");
        } finally {
            setSaving(false);
        }
    };

    const changeDate = (d: string) => {
        if (dirty && !window.confirm("You have unsaved changes. Discard them?")) return;
        setDate(d);
    };

    // roles present today that have no mapped services (cannot be allocated)
    const unmappedRoles = useMemo(() => {
        const seen = new Set<string>();
        (data?.people || [])
            .filter((p) => !isAway(p.status) && p.services.length === 0)
            .forEach((p) =>
                seen.add(`${p.designation || "No role"} · ${p.locationName || "No location"}`)
            );
        return [...seen];
    }, [data]);

    const steps: [string, string][] = [
        [
            "Duties are automatic",
            "Everyone who is present already has the services mapped to their role.",
        ],
        [
            "Someone absent?",
            "Open a present person's card and press Add extra duty to cover the missing service.",
        ],
        ["Press Save", "The person then sees role duties + the extra duty on Submit Work."],
    ];

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
            <style>{CSS}</style>

            {/* ---- title + actions ---- */}
            <div style={isMobile ? S.headerRowMobile : S.headerRow}>
                <div style={{ textAlign: "left" }}>
                    <h2 style={S.pageTitle}>Allocate Work</h2>
                    <p style={S.headerSubtext}>
                        Roles do their own services automatically. Add an extra duty only when
                        someone is missing.
                    </p>
                </div>
                <div style={S.headerActions}>
                    <input
                        type="date"
                        aria-label="Date"
                        value={date || data?.date || ""}
                        onChange={(e) => e.target.value && changeDate(e.target.value)}
                        style={S.dateInput}
                    />
                    {!showHelp && (
                        <button
                            type="button"
                            className="al-btn"
                            style={S.ghostBtn}
                            onClick={() => setShowHelp(true)}
                        >
                            <i className="ti ti-help-circle" /> How it works
                        </button>
                    )}
                    {!readOnly && (
                        <button
                            type="button"
                            className="al-btn"
                            style={{
                                ...S.addBtn,
                                opacity: !dirty || saving ? 0.55 : 1,
                                cursor: !dirty || saving ? "not-allowed" : "pointer",
                            }}
                            disabled={!dirty || saving}
                            onClick={save}
                        >
                            <i className="ti ti-device-floppy" style={{ fontSize: fontSize.md }} />
                            {saving ? "Saving…" : dirty ? `Save (${changedIds.length})` : "Save"}
                        </button>
                    )}
                </div>
            </div>

            {/* ---- how it works ---- */}
            {showHelp && (
                <div style={S.helpCard}>
                    <button
                        type="button"
                        style={S.helpClose}
                        onClick={hideHelp}
                        aria-label="Hide help"
                        title="Hide"
                    >
                        <i className="ti ti-x" />
                    </button>
                    <div style={S.helpTitle}>How it works</div>
                    <div
                        style={{
                            display: "grid",
                            gap: 14,
                            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                        }}
                    >
                        {steps.map(([t, d], i) => (
                            <div key={t} style={{ display: "flex", gap: 10, textAlign: "left" }}>
                                <span style={S.stepNum}>{i + 1}</span>
                                <div>
                                    <div
                                        style={{
                                            fontWeight: fontWeight.semibold,
                                            color: "#16233c",
                                            fontSize: fontSize.base,
                                        }}
                                    >
                                        {t}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: fontSize.sm,
                                            color: "#7c8aa3",
                                            marginTop: 2,
                                        }}
                                    >
                                        {d}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={S.helpNote}>
                        <i className="ti ti-info-circle" /> Role duties come from the Services page
                        (<b>Designation</b> at their <b>Location</b>). If a card says "No services
                        mapped", add them there first. Extra duty can be any other service of the
                        same location.
                    </div>
                </div>
            )}

            <div aria-live="polite">
                {error && (
                    <div style={S.errorBanner}>
                        <i className="ti ti-alert-circle" style={{ fontSize: fontSize.lg }} />
                        {error}
                    </div>
                )}
                {notice && <div style={ui.ok}>{notice}</div>}
                {readOnly && (
                    <div style={S.infoBanner}>
                        <i className="ti ti-lock" /> This is a past date, so it is view only.
                    </div>
                )}
            </div>

            {/* ---- unmapped warning ---- */}
            {data && unmappedRoles.length > 0 && (
                <div style={S.warnBanner}>
                    <i className="ti ti-alert-triangle" style={{ fontSize: fontSize.xl }} />
                    <div style={{ flex: 1, minWidth: 220, textAlign: "left" }}>
                        <b>
                            {stats.noServices}{" "}
                            {stats.noServices === 1 ? "person has" : "people have"} no role duties
                            mapped.
                        </b>{" "}
                        No services are mapped for: {unmappedRoles.slice(0, 4).join(", ")}
                        {unmappedRoles.length > 4 ? ` +${unmappedRoles.length - 4} more` : ""}.
                    </div>
                    <button
                        type="button"
                        className="al-btn"
                        style={S.warnBtn}
                        onClick={() => navigate("/blue/locations")}
                    >
                        Open Services <i className="ti ti-arrow-right" />
                    </button>
                </div>
            )}

            {/* ---- stats ---- */}
            {data && (
                <div
                    style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: isMobile
                            ? "repeat(2, minmax(0, 1fr))"
                            : "repeat(4, minmax(0, 1fr))",
                    }}
                >
                    <StatTile
                        icon="ti-user-check"
                        label="Present"
                        value={stats.present}
                        bg="#D1FAE5"
                        fg="#047857"
                    />
                    <StatTile
                        icon="ti-circle-check"
                        label="On role duties"
                        value={stats.onDuty}
                        bg="#DBEAFE"
                        fg="#1D4ED8"
                    />
                    <StatTile
                        icon="ti-plus"
                        label="With extra duty"
                        value={stats.withExtra}
                        bg="#EDE9FE"
                        fg="#5B21B6"
                    />
                    <StatTile
                        icon="ti-user-off"
                        label="On leave / absent"
                        value={stats.away}
                        bg="#FEE2E2"
                        fg="#B91C1C"
                    />
                </div>
            )}

            {/* ---- filters ---- */}
            <div style={isMobile ? S.filterRowMobile : S.filterRow}>
                <div style={S.searchWrap}>
                    <i
                        className="ti ti-search"
                        aria-hidden="true"
                        style={{ fontSize: fontSize.lg, color: "#7c8aa3" }}
                    />
                    <input
                        style={S.searchInput}
                        placeholder="Search person / role / service..."
                        aria-label="Search"
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
                    {(data?.locations || []).map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>
                {!readOnly && (
                    <button
                        type="button"
                        className="al-btn"
                        style={S.ghostBtn}
                        onClick={clearAll}
                        title="Remove extra duties for everyone shown"
                    >
                        <i className="ti ti-eraser" /> Clear extras
                    </button>
                )}
            </div>

            {/* ---- content ---- */}
            {loading && !data ? (
                <div style={S.emptyState}>
                    <p style={S.emptyText}>Loading…</p>
                </div>
            ) : grouped.length === 0 ? (
                <div style={S.emptyState}>
                    <i
                        className="ti ti-users-group"
                        style={{ fontSize: fontSize["7xl"], color: "#9fd6e6" }}
                    />
                    <p style={S.emptyText}>
                        {data?.people.length
                            ? "No one matches these filters."
                            : "No Blue Collar employees yet. Add them from Add User."}
                    </p>
                </div>
            ) : (
                grouped.map(([locName, roles]) => {
                    const count = [...roles.values()].reduce((n, g) => n + g.people.length, 0);
                    return (
                        <section key={locName} style={S.panel}>
                            <header style={S.panelHeader}>
                                <span style={S.panelIcon} aria-hidden="true">
                                    <i className="ti ti-map-pin" />
                                </span>
                                <h3 style={S.panelTitle}>{locName}</h3>
                                <span style={ui.pill("#EEF2FF", "#3730A3")}>
                                    {count} {count === 1 ? "person" : "people"}
                                </span>
                            </header>

                            <div
                                style={{
                                    padding: 14,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 14,
                                }}
                            >
                                {[...roles.entries()]
                                    .sort((a, b) => a[1].role.localeCompare(b[1].role))
                                    .map(([key, grp]) => {
                                        const options = grp.people[0]?.services || [];
                                        const extraOpts = grp.people[0]?.extraOptions || [];
                                        const live = grp.people.filter((p) => !isAway(p.status));
                                        // a service is covered when someone present at this
                                        // location does it (own role or as an extra duty)
                                        const coveredAtLoc = new Set(
                                            visible
                                                .filter(
                                                    (p) =>
                                                        !isAway(p.status) &&
                                                        p.locationId === grp.people[0]?.locationId
                                                )
                                                .flatMap((p) => [
                                                    ...p.services,
                                                    ...(draft[p.id] || []),
                                                ])
                                                .map(norm)
                                        );
                                        const unassigned = options.filter(
                                            (o) => !coveredAtLoc.has(norm(o))
                                        );
                                        const av = avatarOf(grp.role);
                                        return (
                                            <div
                                                key={key}
                                                style={{
                                                    ...S.roleBox,
                                                    borderLeft: `4px solid ${av.solid}`,
                                                }}
                                            >
                                                <div style={S.roleHeader}>
                                                    <span
                                                        style={{ ...S.roleName, color: av.solid }}
                                                    >
                                                        {grp.role}
                                                    </span>
                                                    <span style={ui.pill("#F3F4F8", "#374151")}>
                                                        {grp.people.length}{" "}
                                                        {grp.people.length === 1
                                                            ? "person"
                                                            : "people"}{" "}
                                                        · {options.length}{" "}
                                                        {options.length === 1 ? "duty" : "duties"}
                                                    </span>
                                                    {!readOnly &&
                                                        options.length > 0 &&
                                                        unassigned.length > 0 && (
                                                            <span
                                                                style={ui.pill(
                                                                    "#FEF3C7",
                                                                    "#92400E"
                                                                )}
                                                                title={unassigned.join(", ")}
                                                            >
                                                                <i className="ti ti-alert-triangle" />{" "}
                                                                Nobody to do:{" "}
                                                                {unassigned.slice(0, 3).join(", ")}
                                                                {unassigned.length > 3
                                                                    ? ` +${unassigned.length - 3}`
                                                                    : ""}
                                                            </span>
                                                        )}
                                                </div>

                                                <div
                                                    style={{
                                                        display: "grid",
                                                        gap: 12,
                                                        gridTemplateColumns: isMobile
                                                            ? "1fr"
                                                            : "repeat(auto-fill, minmax(280px, 1fr))",
                                                        alignItems: "start",
                                                    }}
                                                >
                                                    {grp.people
                                                        .slice()
                                                        .sort((a, b) =>
                                                            a.name.localeCompare(b.name)
                                                        )
                                                        .map((p) => {
                                                            const pav = avatarOf(p.name);
                                                            const meta =
                                                                STATUS_META[p.status] ||
                                                                STATUS_META.PRESENT;
                                                            const away = isAway(p.status);
                                                            const mine = draft[p.id] || [];
                                                            const dutyList = away
                                                                ? []
                                                                : [...options, ...mine];
                                                            const doneCount = dutyList.filter((s) =>
                                                                p.done.includes(s)
                                                            ).length;
                                                            return (
                                                                <div
                                                                    key={p.id}
                                                                    className="al-card"
                                                                    style={{
                                                                        ...S.personCard,
                                                                        opacity: away ? 0.65 : 1,
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            display: "flex",
                                                                            alignItems: "center",
                                                                            gap: 10,
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                ...S.avatar,
                                                                                background: `linear-gradient(135deg, ${pav.from}, ${pav.to})`,
                                                                            }}
                                                                        >
                                                                            {initialsOf(p.name)}
                                                                        </div>
                                                                        <div
                                                                            style={{
                                                                                minWidth: 0,
                                                                                flex: 1,
                                                                                textAlign: "left",
                                                                            }}
                                                                        >
                                                                            <div
                                                                                style={S.personName}
                                                                            >
                                                                                {p.name}
                                                                            </div>
                                                                            <span
                                                                                style={ui.pill(
                                                                                    meta.bg,
                                                                                    meta.fg
                                                                                )}
                                                                            >
                                                                                {meta.label}
                                                                            </span>
                                                                        </div>
                                                                        {!away &&
                                                                            dutyList.length > 0 && (
                                                                                <span
                                                                                    style={ui.pill(
                                                                                        doneCount ===
                                                                                            dutyList.length
                                                                                            ? "#DCFCE7"
                                                                                            : "#F3F4F6",
                                                                                        doneCount ===
                                                                                            dutyList.length
                                                                                            ? "#166534"
                                                                                            : "#374151"
                                                                                    )}
                                                                                    title="Services the employee has ticked as done"
                                                                                >
                                                                                    {doneCount}/
                                                                                    {
                                                                                        dutyList.length
                                                                                    }{" "}
                                                                                    done
                                                                                </span>
                                                                            )}
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop: 12,
                                                                            textAlign: "left",
                                                                        }}
                                                                    >
                                                                        {away ? (
                                                                            <span
                                                                                style={{
                                                                                    fontSize:
                                                                                        fontSize.sm,
                                                                                    color: "#a7b3c8",
                                                                                }}
                                                                            >
                                                                                No duties while{" "}
                                                                                {meta.label.toLowerCase()}
                                                                                .
                                                                            </span>
                                                                        ) : (
                                                                            <>
                                                                                {options.length ===
                                                                                0 ? (
                                                                                    <div
                                                                                        style={
                                                                                            S.noMap
                                                                                        }
                                                                                    >
                                                                                        <i className="ti ti-alert-circle" />{" "}
                                                                                        No services
                                                                                        mapped to{" "}
                                                                                        {grp.role}
                                                                                        {p.locationName
                                                                                            ? ` at ${p.locationName}`
                                                                                            : ""}
                                                                                        .
                                                                                    </div>
                                                                                ) : (
                                                                                    <div
                                                                                        style={
                                                                                            S.ownBox
                                                                                        }
                                                                                    >
                                                                                        <div
                                                                                            style={
                                                                                                S.ownLabel
                                                                                            }
                                                                                        >
                                                                                            Role
                                                                                            duties
                                                                                            (automatic)
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                display:
                                                                                                    "flex",
                                                                                                gap: 6,
                                                                                                flexWrap:
                                                                                                    "wrap",
                                                                                            }}
                                                                                        >
                                                                                            {options.map(
                                                                                                (
                                                                                                    n
                                                                                                ) => (
                                                                                                    <span
                                                                                                        key={
                                                                                                            n
                                                                                                        }
                                                                                                        style={
                                                                                                            S.ownChip
                                                                                                        }
                                                                                                    >
                                                                                                        {
                                                                                                            n
                                                                                                        }
                                                                                                    </span>
                                                                                                )
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {(extraOpts.length >
                                                                                    0 ||
                                                                                    mine.length >
                                                                                        0) && (
                                                                                    <div
                                                                                        style={{
                                                                                            marginTop: 10,
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            style={
                                                                                                S.ownLabel
                                                                                            }
                                                                                        >
                                                                                            Extra
                                                                                            duty
                                                                                        </div>
                                                                                        <ServicePicker
                                                                                            options={
                                                                                                extraOpts
                                                                                            }
                                                                                            value={
                                                                                                mine
                                                                                            }
                                                                                            onChange={(
                                                                                                v
                                                                                            ) =>
                                                                                                setFor(
                                                                                                    p.id,
                                                                                                    v
                                                                                                )
                                                                                            }
                                                                                            disabled={
                                                                                                readOnly
                                                                                            }
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </section>
                    );
                })
            )}
        </div>
    );
}

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
    headerRowMobile: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12 },
    headerSubtext: { margin: "2px 0 0", fontSize: fontSize.base, color: "#7c8aa3" },
    headerActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    dateInput: {
        border: "1px solid #cfe0f5",
        background: "#fff",
        borderRadius: radius.md,
        padding: "10px 12px",
        fontSize: fontSize.base,
        fontFamily: "inherit",
        color: "#16233c",
    },
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
        whiteSpace: "nowrap",
    },
    ghostBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fafbfc",
        color: "#3b4a63",
        border: "1px solid #e4e9f2",
        borderRadius: radius.md,
        padding: "9px 12px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    helpCard: {
        position: "relative",
        background: "linear-gradient(120deg,#EEF4FF 0%,#F3EEFF 100%)",
        border: "1px solid #dbe4fb",
        borderRadius: radius.lg,
        padding: "16px 18px",
    },
    helpClose: {
        position: "absolute",
        top: 10,
        right: 10,
        border: "none",
        background: "transparent",
        color: "#7c8aa3",
        cursor: "pointer",
        fontSize: fontSize.lg,
    },
    helpTitle: {
        textAlign: "left",
        fontSize: fontSize.lg,
        fontWeight: fontWeight.bold,
        color: "#16233c",
        marginBottom: 12,
    },
    stepNum: {
        flex: "0 0 26px",
        width: 26,
        height: 26,
        borderRadius: radius.circle,
        background: "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.bold,
    },
    helpNote: { textAlign: "left", marginTop: 14, fontSize: fontSize.sm, color: "#475569" },
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
    infoBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        color: "#1e40af",
        borderRadius: radius.md,
        padding: "10px 14px",
        fontSize: fontSize.base,
    },
    warnBanner: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        color: "#92400E",
        borderRadius: radius.md,
        padding: "12px 16px",
        fontSize: fontSize.base,
    },
    warnBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        borderRadius: radius.md,
        background: "#F59E0B",
        color: "#fff",
        padding: "8px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
    },
    tile: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: radius.md,
        padding: "12px 16px",
        boxShadow: "0 2px 10px rgba(16,38,89,.05)",
    },
    tileIcon: {
        flex: "0 0 40px",
        width: 40,
        height: 40,
        borderRadius: radius.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 20,
    },
    tileValue: {
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#16233c",
        lineHeight: 1.05,
    },
    tileLabel: { fontSize: fontSize.sm, color: "#7c8aa3", marginTop: 2 },
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
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 0",
    },
    emptyText: { margin: 0, fontSize: fontSize.base, color: "#7c8aa3" },
    panel: {
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: radius.lg,
        boxShadow: "0 4px 14px rgba(0,0,0,.04)",
    },
    panelHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        borderBottom: "1px solid #eef2f9",
    },
    panelIcon: {
        flex: "0 0 34px",
        width: 34,
        height: 34,
        borderRadius: radius.sm,
        background: "#EDE9FE",
        color: "#6D28D9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
    },
    panelTitle: {
        margin: 0,
        flex: 1,
        textAlign: "left",
        fontSize: fontSize.lg,
        fontWeight: fontWeight.bold,
        color: "#16233c",
    },
    roleBox: {
        background: "#fafbfe",
        border: "1px solid #eef2f9",
        borderRadius: radius.md,
        padding: "12px 14px 14px",
    },
    roleHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 12,
    },
    roleName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
    personCard: {
        background: "#fff",
        border: "1px solid #e5edf7",
        borderRadius: radius.md,
        padding: 12,
        boxShadow: "0 2px 8px rgba(16,38,89,.04)",
    },
    personName: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#16233c",
        marginBottom: 3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    avatar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: radius.circle,
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        flexShrink: 0,
    },
    ownBox: { display: "flex", flexDirection: "column", gap: 6 },
    ownLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#7c8aa3",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginBottom: 4,
    },
    ownChip: {
        background: "#F1F5F9",
        color: "#334155",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: fontSize.sm,
    },
    noMap: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#FFFBEB",
        border: "1px dashed #FCD34D",
        color: "#92400E",
        borderRadius: radius.sm,
        padding: "8px 10px",
        fontSize: fontSize.sm,
    },
    chip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "3px 4px 3px 11px",
        borderRadius: radius.pill,
        background: "#E7ECF8",
        color: "#1E3A8A",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
    },
    chipX: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        border: "none",
        borderRadius: radius.circle,
        background: "transparent",
        color: "#6B7280",
        fontSize: 13,
        padding: 0,
        cursor: "pointer",
    },
    addBtn2: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        padding: "9px 12px",
        borderRadius: radius.sm,
        border: "1.5px dashed #93b4f0",
        background: "#fff",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
    },
    editBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: radius.sm,
        border: "1px solid #cfe0f5",
        background: "#fff",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
    },
    popover: {
        position: "absolute",
        zIndex: 30,
        left: 0,
        right: 0,
        top: "calc(100% + 6px)",
        minWidth: 220,
        maxHeight: 280,
        overflowY: "auto",
        background: "#fff",
        border: "1px solid #D1D5DB",
        borderRadius: radius.sm,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        textAlign: "left",
    },
    popoverTop: {
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid #F3F4F6",
    },
    linkBtn: {
        border: "none",
        background: "transparent",
        color: "var(--brand-blue)",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        fontFamily: "inherit",
        cursor: "pointer",
        padding: 0,
    },
    optRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        cursor: "pointer",
        fontSize: fontSize.md,
        borderBottom: "1px solid #F3F4F6",
    },
};
