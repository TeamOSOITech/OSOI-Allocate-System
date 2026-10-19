// src/pages/blue/teamview.tsx
//
// Blue Collar "Team View": manager-wise -> team-wise list of people with
// who is present / on leave, where each person is, how many each team
// needs, and a Standby pool. A person can be moved to another team,
// location or Standby from here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser } from "../../utils/auth";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import { ui, STATUS_META, useIsMobileBlue } from "./ui";

const API_BASE = import.meta.env.VITE_API_URL;
const todayYmd = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
};

type Person = {
    id: string;
    name: string;
    email: string | null;
    designation: string | null;
    team: string;
    managerEmail: string;
    managerName: string;
    locationId: string | null;
    locationName: string;
    status: string;
    submittedCount: number;
};
type Loc = { id: string; name: string };
type TeamView = {
    date: string;
    standbyTeam: string;
    people: Person[];
    locations: Loc[];
    requirements: { team: string; required: number }[];
};

const isAway = (s: string) => s === "LEAVE" || s === "ABSENT";

export default function BlueTeamView() {
    const isMobile = useIsMobileBlue();
    const role = getCurrentUser()?.role || "";
    const canManage = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"].includes(role);
    const canMark = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD", "VERTICAL_HEAD"].includes(role);

    const [date, setDate] = useState(todayYmd());
    const [data, setData] = useState<TeamView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [locFilter, setLocFilter] = useState("");
    const [search, setSearch] = useState("");
    const [moving, setMoving] = useState<Person | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/blue/team-view?date=${date}`, {
                cache: "no-store",
            });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to load");
            setData(json.data);
        } catch (e: any) {
            setError(e?.message || "Failed to load team view.");
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        load();
    }, [load]);

    const flash = (msg: string) => {
        setNotice(msg);
        setTimeout(() => setNotice(""), 2500);
    };

    const standbyKey = (data?.standbyTeam || "Standby").toLowerCase();

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data?.people || []).filter((p) => {
            if (locFilter === "__none" && p.locationId) return false;
            if (locFilter && locFilter !== "__none" && p.locationId !== locFilter) return false;
            if (!q) return true;
            return (
                p.name.toLowerCase().includes(q) ||
                (p.designation || "").toLowerCase().includes(q) ||
                p.team.toLowerCase().includes(q)
            );
        });
    }, [data, locFilter, search]);

    const standby = visible.filter((p) => p.team.toLowerCase() === standbyKey);

    // manager -> team -> people (Standby people are shown in their own pool)
    const byManager = useMemo(() => {
        const managers = new Map<string, { name: string; teams: Map<string, Person[]> }>();
        visible
            .filter((p) => p.team.toLowerCase() !== standbyKey)
            .forEach((p) => {
                const key = p.managerEmail.toLowerCase() || "__none";
                if (!managers.has(key))
                    managers.set(key, { name: p.managerName, teams: new Map() });
                const m = managers.get(key)!;
                if (!m.teams.has(p.team)) m.teams.set(p.team, []);
                m.teams.get(p.team)!.push(p);
            });
        return [...managers.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    }, [visible, standbyKey]);

    const required = useMemo(() => {
        const m = new Map<string, number>();
        (data?.requirements || []).forEach((r) => m.set(r.team.toLowerCase(), r.required));
        return m;
    }, [data]);

    // present headcount per team across ALL managers (not affected by filters)
    const presentByTeam = useMemo(() => {
        const m = new Map<string, number>();
        (data?.people || []).forEach((p) => {
            if (isAway(p.status)) return;
            const k = p.team.toLowerCase();
            m.set(k, (m.get(k) || 0) + 1);
        });
        return m;
    }, [data]);

    const allTeams = useMemo(() => {
        const set = new Set<string>();
        (data?.people || []).forEach((p) => p.team !== "Unassigned" && set.add(p.team));
        (data?.requirements || []).forEach((r) => set.add(r.team));
        set.add(data?.standbyTeam || "Standby");
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [data]);

    const totals = useMemo(() => {
        const all = data?.people || [];
        return {
            total: all.length,
            present: all.filter((p) => !isAway(p.status)).length,
            away: all.filter((p) => isAway(p.status)).length,
        };
    }, [data]);

    const saveRequirement = async (team: string, count: number) => {
        try {
            const res = await authFetch(`${API_BASE}/api/blue/team-requirements`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ teamName: team, requiredCount: count }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            flash(`Requirement for ${team} saved.`);
            load();
        } catch (e: any) {
            setError(e?.message || "Could not save requirement.");
        }
    };

    const markStatus = async (p: Person, status: string) => {
        try {
            const res = await authFetch(`${API_BASE}/api/attendance/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date, records: [{ employeeId: p.id, status }] }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            flash(`${p.name} marked ${STATUS_META[status]?.label || status}.`);
            load();
        } catch (e: any) {
            setError(e?.message || "Could not update attendance.");
        }
    };

    const renderPerson = (p: Person) => {
        const meta = STATUS_META[p.status] || STATUS_META.PRESENT;
        return (
            <div
                key={p.id}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 0",
                    borderTop: "1px solid #F3F4F6",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                    <div style={{ fontWeight: fontWeight.semibold, fontSize: fontSize.base }}>
                        {p.name}
                    </div>
                    <div style={{ fontSize: fontSize.xs, color: "#6B7280" }}>
                        {p.designation || "No role set"}
                    </div>
                </div>
                <span style={ui.pill("#EFF6FF", "#1E40AF")}>
                    <i className="ti ti-map-pin" aria-hidden="true" />{" "}
                    {p.locationName || "No location"}
                </span>
                {p.submittedCount > 0 && (
                    <span style={ui.pill("#F5F3FF", "#5B21B6")}>{p.submittedCount} tasks done</span>
                )}
                {canMark ? (
                    <select
                        value={p.status}
                        onChange={(e) => markStatus(p, e.target.value)}
                        style={{
                            ...ui.input,
                            padding: "4px 8px",
                            fontSize: fontSize.sm,
                            background: meta.bg,
                            color: meta.fg,
                            fontWeight: fontWeight.semibold,
                            border: "none",
                        }}
                    >
                        {Object.entries(STATUS_META).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v.label}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span style={ui.pill(meta.bg, meta.fg)}>{meta.label}</span>
                )}
                {canManage && (
                    <button style={ui.ghostBtn} onClick={() => setMoving(p)}>
                        <i className="ti ti-arrows-exchange" aria-hidden="true" /> Move
                    </button>
                )}
            </div>
        );
    };

    const renderTeam = (team: string, people: Person[]) => {
        const need = required.get(team.toLowerCase());
        const present = presentByTeam.get(team.toLowerCase()) || 0;
        const short = need !== undefined ? need - present : null;
        return (
            <div key={team} style={{ ...ui.card, padding: 14 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 4,
                    }}
                >
                    <div style={{ fontWeight: fontWeight.bold, fontSize: fontSize.lg, flex: 1 }}>
                        {team}
                    </div>
                    <span style={ui.pill("#DCFCE7", "#166534")}>
                        {present} present / {people.length}
                    </span>
                    {short !== null && short > 0 && (
                        <span style={ui.pill("#FEE2E2", "#991B1B")}>Short by {short}</span>
                    )}
                    {short !== null && short <= 0 && (
                        <span style={ui.pill("#DCFCE7", "#166534")}>Fully staffed</span>
                    )}
                    {canManage ? (
                        <label style={{ fontSize: fontSize.xs, color: "#6B7280" }}>
                            Need{" "}
                            <input
                                type="number"
                                min={0}
                                defaultValue={need ?? ""}
                                key={`${team}-${need ?? "x"}`}
                                placeholder="0"
                                style={{ ...ui.input, width: 64, padding: "4px 6px" }}
                                onBlur={(e) => {
                                    const v = e.target.value;
                                    if (v === "" || Number(v) === need) return;
                                    saveRequirement(team, Number(v));
                                }}
                            />
                        </label>
                    ) : (
                        need !== undefined && (
                            <span style={ui.pill("#F3F4F6", "#374151")}>Need {need}</span>
                        )
                    )}
                </div>
                {people.map(renderPerson)}
            </div>
        );
    };

    return (
        <div style={isMobile ? ui.pageMobile : ui.page}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <h2 style={ui.title}>Team View</h2>
                    <p style={ui.sub}>
                        Blue Collar — manager-wise teams, who is in and who is on leave.
                    </p>
                </div>
                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value || todayYmd())}
                    style={ui.input}
                />
                <select
                    value={locFilter}
                    onChange={(e) => setLocFilter(e.target.value)}
                    style={ui.input}
                >
                    <option value="">All locations</option>
                    <option value="__none">No location</option>
                    {(data?.locations || []).map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>
                <input
                    placeholder="Search name / role / team"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ ...ui.input, minWidth: 190 }}
                />
            </div>

            <div style={{ display: "flex", gap: 10, margin: "16px 0", flexWrap: "wrap" }}>
                <span style={ui.pill("#EFF6FF", "#1E40AF")}>{totals.total} people</span>
                <span style={ui.pill("#DCFCE7", "#166534")}>{totals.present} present</span>
                <span style={ui.pill("#FEE2E2", "#991B1B")}>{totals.away} on leave / absent</span>
            </div>

            {error && <div style={ui.error}>{error}</div>}
            {notice && <div style={ui.ok}>{notice}</div>}
            {loading && <p style={ui.sub}>Loading…</p>}

            {!loading && data && data.people.length === 0 && (
                <div style={ui.card}>
                    No Blue Collar employees yet. Switch to Blue Collar on Home and add people from
                    Add User.
                </div>
            )}

            {!loading && standby.length > 0 && (
                <section style={{ marginBottom: 24 }}>
                    <h3 style={{ margin: "0 0 10px", fontSize: fontSize["2xl"] }}>
                        <i className="ti ti-armchair" aria-hidden="true" /> Standby team
                        <span style={{ ...ui.pill("#FEF3C7", "#92400E"), marginLeft: 10 }}>
                            {standby.filter((p) => !isAway(p.status)).length} available
                        </span>
                    </h3>
                    <div style={{ ...ui.card, borderColor: "#FDE68A", background: "#FFFBEB" }}>
                        {standby.map(renderPerson)}
                    </div>
                </section>
            )}

            {!loading &&
                byManager.map(([key, m]) => (
                    <section key={key} style={{ marginBottom: 26 }}>
                        <h3 style={{ margin: "0 0 10px", fontSize: fontSize["2xl"] }}>
                            <i className="ti ti-user-star" aria-hidden="true" /> {m.name}
                            <span
                                style={{
                                    fontSize: fontSize.sm,
                                    color: "#6B7280",
                                    fontWeight: fontWeight.regular,
                                }}
                            >
                                {" "}
                                — {[...m.teams.values()].reduce((n, l) => n + l.length, 0)} people
                            </span>
                        </h3>
                        <div
                            style={{
                                display: "grid",
                                gap: 12,
                                gridTemplateColumns: isMobile
                                    ? "1fr"
                                    : "repeat(auto-fill,minmax(440px,1fr))",
                            }}
                        >
                            {[...m.teams.entries()]
                                .sort((a, b) => a[0].localeCompare(b[0]))
                                .map(([team, people]) => renderTeam(team, people))}
                        </div>
                    </section>
                ))}

            {moving && (
                <MoveModal
                    person={moving}
                    teams={allTeams}
                    locations={data?.locations || []}
                    standbyTeam={data?.standbyTeam || "Standby"}
                    onClose={() => setMoving(null)}
                    onDone={(msg) => {
                        setMoving(null);
                        flash(msg);
                        load();
                    }}
                />
            )}
        </div>
    );
}

function MoveModal({
    person,
    teams,
    locations,
    standbyTeam,
    onClose,
    onDone,
}: {
    person: Person;
    teams: string[];
    locations: Loc[];
    standbyTeam: string;
    onClose: () => void;
    onDone: (msg: string) => void;
}) {
    const [team, setTeam] = useState(person.team === "Unassigned" ? "" : person.team);
    const [newTeam, setNewTeam] = useState("");
    const [locationId, setLocationId] = useState(person.locationId || "");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");

    const finalTeam = (newTeam.trim() || team).trim();

    const save = async () => {
        setSaving(true);
        setErr("");
        try {
            const body: Record<string, unknown> = {};
            if (finalTeam !== (person.team === "Unassigned" ? "" : person.team))
                body.team = finalTeam;
            if (locationId !== (person.locationId || "")) body.locationId = locationId || null;
            if (Object.keys(body).length === 0) {
                onClose();
                return;
            }
            const res = await authFetch(`${API_BASE}/api/blue/employees/${person.id}/assign`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
            onDone(`${person.name} moved${finalTeam ? ` to ${finalTeam}` : ""}.`);
        } catch (e: any) {
            setErr(e?.message || "Could not move this person.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={ui.overlay} onClick={onClose}>
            <div style={ui.modal} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ margin: "0 0 4px", fontSize: fontSize["3xl"] }}>Move {person.name}</h3>
                <p style={{ ...ui.sub, marginBottom: 14 }}>
                    Now: {person.team} · {person.locationName || "No location"}
                </p>

                <label style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>Team</label>
                <select
                    value={team}
                    onChange={(e) => {
                        setTeam(e.target.value);
                        setNewTeam("");
                    }}
                    style={{ ...ui.input, width: "100%", margin: "4px 0 8px" }}
                >
                    <option value="">— No team —</option>
                    {teams.map((t) => (
                        <option key={t} value={t}>
                            {t}
                            {t.toLowerCase() === standbyTeam.toLowerCase() ? " (standby pool)" : ""}
                        </option>
                    ))}
                </select>
                <input
                    placeholder="…or type a new team name"
                    value={newTeam}
                    onChange={(e) => setNewTeam(e.target.value)}
                    style={{
                        ...ui.input,
                        width: "100%",
                        marginBottom: 12,
                        boxSizing: "border-box",
                    }}
                />

                <label style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>
                    Location
                </label>
                <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    style={{ ...ui.input, width: "100%", margin: "4px 0 14px" }}
                >
                    <option value="">— No location —</option>
                    {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>

                {err && <div style={ui.error}>{err}</div>}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button style={ui.ghostBtn} onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        style={{
                            ...ui.btn("#1E40AF"),
                            borderRadius: radius.sm,
                            opacity: saving ? 0.6 : 1,
                        }}
                        disabled={saving}
                        onClick={save}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}
