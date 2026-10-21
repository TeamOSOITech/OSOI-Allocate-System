// src/pages/blue/teamview.tsx
//
// Blue Collar "Team View": manager-wise -> team-wise list of people with
// who is present / on leave, where each person is, how many each team
// needs, and a Standby pool. A person can be moved to another team,
// location or Standby from here.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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

// ---- design tokens (soft gradient header, white rounded cards) ----
const NAVY = "#1B2559";
const MUTED = "#6B7280";
const LINE = "#EEF1F8";
const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("") || "?";

const filterBox: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#fff",
    borderRadius: radius.sm,
    padding: "7px 11px",
    boxShadow: "0 1px 6px rgba(30,64,175,0.08)",
    color: "#374151",
};
const bareField: CSSProperties = {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: "#374151",
    fontFamily: "inherit",
};
const chip = (bg: string, fg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: radius.pill,
    background: bg,
    color: fg,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
});
const teamCard = (_accent: string): CSSProperties => ({
    position: "relative",
    overflow: "hidden",
    background: "#fff",
    borderRadius: radius.lg,
    padding: "12px 14px 12px 18px",
    boxShadow: "0 4px 14px rgba(30,64,175,0.07)",
    border: `1px solid ${LINE}`,
});
const accentBar = (accent: string): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    background: accent,
});
const BLUE_BAR = "linear-gradient(180deg,#3B82F6,#6366F1)";
const AMBER_BAR = "linear-gradient(180deg,#F59E0B,#FCD34D)";

const AVATARS: [string, string][] = [
    ["#DBEAFE", "#1D4ED8"],
    ["#EDE9FE", "#6D28D9"],
    ["#FCE7F3", "#BE185D"],
    ["#DCFCE7", "#15803D"],
    ["#FEF3C7", "#B45309"],
    ["#CFFAFE", "#0E7490"],
];
const avatarColors = (name: string) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATARS[h % AVATARS.length];
};
const STATUS_DOT: Record<string, string> = {
    PRESENT: "#22C55E",
    HALF_DAY: "#F59E0B",
    LEAVE: "#EF4444",
    ABSENT: "#9CA3AF",
};

// hover polish - only for people who have not asked for reduced motion
const TV_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .tv-card { transition: transform .18s ease, box-shadow .18s ease; }
  .tv-card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(30,64,175,.14) !important; }
  .tv-stat { transition: transform .18s ease; }
  .tv-stat:hover { transform: translateY(-1px); }
}
.tv-row { transition: background .15s ease; }
.tv-row:hover { background: #F6F8FF; }
`;

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
        <div
            className="tv-stat"
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#fff",
                border: `1px solid ${LINE}`,
                borderRadius: radius.md,
                padding: "7px 16px 7px 8px",
                boxShadow: "0 1px 6px rgba(30,64,175,0.08)",
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.sm,
                    background: bg,
                    color: fg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 17,
                }}
            >
                <i className={`ti ${icon}`} />
            </span>
            <div style={{ textAlign: "left" }}>
                <div
                    style={{
                        fontSize: fontSize["2xl"],
                        fontWeight: fontWeight.bold,
                        color: NAVY,
                        lineHeight: 1.1,
                    }}
                >
                    {value}
                </div>
                <div style={{ fontSize: fontSize.xs, color: MUTED }}>{label}</div>
            </div>
        </div>
    );
}

function Filter({ icon, children }: { icon: string; children: ReactNode }) {
    return (
        <label style={filterBox}>
            <i
                className={`ti ${icon}`}
                aria-hidden="true"
                style={{ fontSize: 15, color: "#4B5563" }}
            />
            {children}
        </label>
    );
}

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
    // which team cards have "View all" open (key = manager::team)
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
    const toggleGroup = (k: string) =>
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });

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
        const [avBg, avFg] = avatarColors(p.name);
        return (
            <div
                key={p.id}
                className="tv-row"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    margin: "0 -8px",
                    padding: "8px",
                    borderRadius: radius.md,
                    borderTop: `1px solid ${LINE}`,
                }}
            >
                <div
                    style={{
                        flex: "1 1 150px",
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                    }}
                >
                    <div style={{ position: "relative", flex: "0 0 36px" }}>
                        <div
                            aria-hidden="true"
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: radius.circle,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: avBg,
                                color: avFg,
                                fontWeight: fontWeight.bold,
                                fontSize: fontSize.xs,
                            }}
                        >
                            {initials(p.name)}
                        </div>
                        <span
                            title={meta.label}
                            style={{
                                position: "absolute",
                                right: -1,
                                bottom: -1,
                                width: 10,
                                height: 10,
                                borderRadius: radius.circle,
                                background: STATUS_DOT[p.status] || "#22C55E",
                                border: "2px solid #fff",
                            }}
                        />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div
                            style={{
                                fontWeight: fontWeight.semibold,
                                fontSize: fontSize.md,
                                color: NAVY,
                            }}
                        >
                            {p.name}
                        </div>
                        <div style={{ fontSize: fontSize.xs, color: MUTED }}>
                            {p.designation || "No role set"}
                            {p.submittedCount > 0 && (
                                <span style={{ color: "#6D28D9", fontWeight: fontWeight.medium }}>
                                    {" "}
                                    · {p.submittedCount} tasks done
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span
                        style={{
                            ...chip("#EDE9FE", "#5B21B6"),
                            padding: "4px 10px",
                            fontSize: fontSize.xs,
                        }}
                    >
                        <i className="ti ti-map-pin" aria-hidden="true" />
                        {p.locationName || "No location"}
                    </span>
                    {canMark ? (
                        <span style={{ position: "relative", display: "inline-flex" }}>
                            <select
                                value={p.status}
                                onChange={(e) => markStatus(p, e.target.value)}
                                style={{
                                    ...bareField,
                                    appearance: "none",
                                    WebkitAppearance: "none",
                                    cursor: "pointer",
                                    padding: "5px 26px 5px 12px",
                                    borderRadius: radius.pill,
                                    background: meta.bg,
                                    color: meta.fg,
                                    fontWeight: fontWeight.semibold,
                                    fontSize: fontSize.sm,
                                }}
                            >
                                {Object.entries(STATUS_META).map(([k, v]) => (
                                    <option key={k} value={k}>
                                        {v.label}
                                    </option>
                                ))}
                            </select>
                            <i
                                className="ti ti-chevron-down"
                                aria-hidden="true"
                                style={{
                                    position: "absolute",
                                    right: 9,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    pointerEvents: "none",
                                    color: meta.fg,
                                    fontSize: 13,
                                }}
                            />
                        </span>
                    ) : (
                        <span style={chip(meta.bg, meta.fg)}>{meta.label}</span>
                    )}
                    {canManage && (
                        <button
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "5px 12px",
                                borderRadius: radius.pill,
                                border: "1px solid #DDE3F0",
                                background: "#fff",
                                color: "#3730A3",
                                fontSize: fontSize.sm,
                                fontWeight: fontWeight.medium,
                                fontFamily: "inherit",
                                cursor: "pointer",
                            }}
                            onClick={() => setMoving(p)}
                        >
                            <i className="ti ti-arrows-exchange" aria-hidden="true" /> Move
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderTeam = (team: string, people: Person[], groupKey: string, isStandby = false) => {
        const need = isStandby ? undefined : required.get(team.toLowerCase());
        const present = presentByTeam.get(team.toLowerCase()) || 0;
        const short = need !== undefined ? need - present : null;
        const presentHere = people.filter((x) => !isAway(x.status)).length;
        const awayHere = people.length - presentHere;
        const hasNeed = need !== undefined && need > 0;
        const pct = hasNeed
            ? Math.min(100, Math.round((present / need!) * 100))
            : people.length
              ? Math.round((presentHere / people.length) * 100)
              : 0;
        const barColor =
            pct >= 100
                ? "linear-gradient(90deg,#34D399,#10B981)"
                : pct >= 60
                  ? "linear-gradient(90deg,#FBBF24,#F59E0B)"
                  : "linear-gradient(90deg,#FB7185,#EF4444)";

        // locations in this team, biggest first
        const locCount = new Map<string, number>();
        people.forEach((x) => {
            const k = x.locationName || "No location";
            locCount.set(k, (locCount.get(k) || 0) + 1);
        });
        const locList = [...locCount.entries()].sort((x, y) => y[1] - x[1]);

        // a search shows matching people straight away, so no toggle then
        const forceOpen = search.trim() !== "";
        const isOpen = forceOpen || openGroups.has(groupKey);
        const accent = isStandby ? AMBER_BAR : BLUE_BAR;

        return (
            <div
                key={groupKey}
                className="tv-card"
                style={{
                    ...teamCard(accent),
                    ...(isStandby ? { background: "#FFFBEB", borderColor: "#FDE68A" } : {}),
                }}
            >
                <span style={accentBar(accent)} />

                {/* title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div
                        aria-hidden="true"
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: radius.sm,
                            background: isStandby
                                ? "linear-gradient(135deg,#F59E0B,#FBBF24)"
                                : "linear-gradient(135deg,#3B82F6,#6366F1)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 17,
                            boxShadow: "0 3px 8px rgba(99,102,241,0.35)",
                        }}
                    >
                        <i className={isStandby ? "ti ti-armchair" : "ti ti-users-group"} />
                    </div>
                    <div
                        style={{
                            fontWeight: fontWeight.bold,
                            fontSize: fontSize.lg,
                            color: NAVY,
                            flex: 1,
                            minWidth: 110,
                            textAlign: "left",
                        }}
                    >
                        {team}
                    </div>
                    {short !== null && short > 0 && (
                        <span
                            style={{
                                ...chip("#FEE2E2", "#991B1B"),
                                padding: "3px 10px",
                                fontSize: fontSize.xs,
                            }}
                        >
                            Short by {short}
                        </span>
                    )}
                    {short !== null && short <= 0 && hasNeed && (
                        <span
                            style={{
                                ...chip("#DCFCE7", "#166534"),
                                padding: "3px 10px",
                                fontSize: fontSize.xs,
                            }}
                        >
                            Fully staffed
                        </span>
                    )}
                    {!isStandby &&
                        (canManage ? (
                            <label
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: fontSize.sm,
                                    color: MUTED,
                                }}
                            >
                                Need
                                <input
                                    type="number"
                                    min={0}
                                    defaultValue={need ?? ""}
                                    key={`${team}-${need ?? "x"}`}
                                    placeholder="0"
                                    style={{
                                        ...bareField,
                                        width: 44,
                                        padding: "4px 8px",
                                        borderRadius: radius.sm,
                                        background: "#EEF4FF",
                                        textAlign: "center",
                                    }}
                                    onBlur={(e) => {
                                        const v = e.target.value;
                                        if (v === "" || Number(v) === need) return;
                                        saveRequirement(team, Number(v));
                                    }}
                                />
                            </label>
                        ) : (
                            need !== undefined && (
                                <span
                                    style={{
                                        ...chip("#F3F4F6", "#374151"),
                                        padding: "3px 10px",
                                        fontSize: fontSize.xs,
                                    }}
                                >
                                    Need {need}
                                </span>
                            )
                        ))}
                </div>

                {/* summary: present / absent / locations + View all */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        marginTop: 10,
                    }}
                >
                    <span
                        style={{
                            ...chip("#DCFCE7", "#166534"),
                            padding: "3px 10px",
                            fontSize: fontSize.xs,
                        }}
                    >
                        <i className="ti ti-circle-check-filled" aria-hidden="true" />
                        {presentHere} present
                    </span>
                    <span
                        style={{
                            ...(awayHere > 0
                                ? chip("#FEE2E2", "#B91C1C")
                                : chip("#F3F4F6", "#6B7280")),
                            padding: "3px 10px",
                            fontSize: fontSize.xs,
                        }}
                    >
                        <i className="ti ti-user-x" aria-hidden="true" />
                        {awayHere} absent
                    </span>
                    {locList.slice(0, 3).map(([name, count]) => (
                        <span
                            key={name}
                            style={{
                                ...chip("#EDE9FE", "#5B21B6"),
                                padding: "3px 10px",
                                fontSize: fontSize.xs,
                            }}
                        >
                            <i className="ti ti-map-pin" aria-hidden="true" />
                            {name} · {count}
                        </span>
                    ))}
                    {locList.length > 3 && (
                        <span
                            style={{
                                ...chip("#F3F4F6", "#4B5563"),
                                padding: "3px 10px",
                                fontSize: fontSize.xs,
                            }}
                        >
                            +{locList.length - 3} more
                        </span>
                    )}
                    {!forceOpen && (
                        <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleGroup(groupKey)}
                            style={{
                                marginLeft: "auto",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "4px 12px",
                                borderRadius: radius.pill,
                                border: "1px solid #C7D2FE",
                                background: isOpen ? "#E0E7FF" : "#fff",
                                color: "#3730A3",
                                fontSize: fontSize.sm,
                                fontWeight: fontWeight.semibold,
                                fontFamily: "inherit",
                                cursor: "pointer",
                            }}
                        >
                            {isOpen ? "Hide" : `View all (${people.length})`}
                            <i
                                className={`ti ti-chevron-${isOpen ? "up" : "down"}`}
                                aria-hidden="true"
                            />
                        </button>
                    )}
                </div>

                {/* staffing progress */}
                <div style={{ margin: "10px 0 2px" }}>
                    <div
                        style={{
                            height: 6,
                            borderRadius: radius.pill,
                            background: isStandby ? "#FEF3C7" : "#EEF2FF",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                width: `${pct}%`,
                                height: "100%",
                                borderRadius: radius.pill,
                                background: barColor,
                                transition: "width .4s ease",
                            }}
                        />
                    </div>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 4,
                            fontSize: fontSize.xs,
                            color: MUTED,
                        }}
                    >
                        <span>
                            {hasNeed
                                ? `${present} of ${need} needed`
                                : `${presentHere} of ${people.length} present`}
                        </span>
                        <span style={{ fontWeight: fontWeight.medium }}>{pct}%</span>
                    </div>
                </div>

                {/* employee details - only after View all */}
                {isOpen && <div style={{ marginTop: 6 }}>{people.map(renderPerson)}</div>}
            </div>
        );
    };

    const sectionTitle = (icon: string, title: string, extra?: ReactNode) => (
        <h3
            style={{
                margin: "0 0 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: fontSize.xl,
                fontWeight: fontWeight.bold,
                color: NAVY,
                textAlign: "left",
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: radius.sm,
                    background: "#E0E7FF",
                    color: "#4338CA",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                }}
            >
                <i className={`ti ${icon}`} />
            </span>
            {title}
            {extra}
            <span style={{ flex: 1, height: 1, background: LINE, minWidth: 16 }} />
        </h3>
    );

    return (
        <div
            style={{
                ...(isMobile ? ui.pageMobile : ui.page),
                background: "linear-gradient(180deg,#F1F6FF 0%,#FFFFFF 380px)",
            }}
        >
            <style>{TV_CSS}</style>

            {/* ---- header ---- */}
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    padding: isMobile ? "12px" : "14px 18px",
                    borderRadius: radius.lg,
                    background: "linear-gradient(120deg,#E3EEFF 0%,#EAEDFF 50%,#F1E4FF 100%)",
                    boxShadow: "0 4px 16px rgba(99,102,241,0.10)",
                }}
            >
                <span
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        right: -50,
                        top: -60,
                        width: 190,
                        height: 190,
                        borderRadius: radius.circle,
                        background: "rgba(167,139,250,0.22)",
                    }}
                />
                <span
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        right: 150,
                        bottom: -80,
                        width: 150,
                        height: 150,
                        borderRadius: radius.circle,
                        background: "rgba(96,165,250,0.16)",
                    }}
                />
                <div
                    aria-hidden="true"
                    style={{
                        position: "relative",
                        width: 44,
                        height: 44,
                        borderRadius: radius.md,
                        background: "linear-gradient(135deg,#3B82F6,#6366F1)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 22,
                        boxShadow: "0 6px 14px rgba(99,102,241,0.35)",
                    }}
                >
                    <i className="ti ti-users" />
                </div>
                <div style={{ position: "relative", flex: 1, minWidth: 200, textAlign: "left" }}>
                    <h2
                        style={{
                            ...ui.title,
                            fontSize: fontSize["4xl"],
                            background: "linear-gradient(90deg,#1B2559,#4338CA)",
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            width: "fit-content",
                        }}
                    >
                        Team View
                    </h2>
                    <p style={{ ...ui.sub, fontSize: fontSize.sm }}>
                        Blue Collar — manager-wise teams, who is in and who is on leave.
                    </p>
                </div>
                <div
                    style={{
                        position: "relative",
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        width: isMobile ? "100%" : "auto",
                    }}
                >
                    <Filter icon="ti-calendar">
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value || todayYmd())}
                            style={bareField}
                        />
                    </Filter>
                    <Filter icon="ti-map-pin">
                        <select
                            value={locFilter}
                            onChange={(e) => setLocFilter(e.target.value)}
                            style={{ ...bareField, cursor: "pointer" }}
                        >
                            <option value="">All locations</option>
                            <option value="__none">No location</option>
                            {(data?.locations || []).map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                    </Filter>
                    <Filter icon="ti-search">
                        <input
                            placeholder="Search name / role / team"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ ...bareField, minWidth: 150 }}
                        />
                    </Filter>
                </div>
            </div>

            {/* ---- summary tiles ---- */}
            <div style={{ display: "flex", gap: 10, margin: "14px 0", flexWrap: "wrap" }}>
                <StatTile
                    icon="ti-users"
                    label="People"
                    value={totals.total}
                    bg="#DBEAFE"
                    fg="#1D4ED8"
                />
                <StatTile
                    icon="ti-circle-check-filled"
                    label="Present"
                    value={totals.present}
                    bg="#D1FAE5"
                    fg="#047857"
                />
                <StatTile
                    icon="ti-user-x"
                    label="On leave / absent"
                    value={totals.away}
                    bg="#FEE2E2"
                    fg="#DC2626"
                />
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
                <section style={{ marginBottom: 20 }}>
                    {sectionTitle("ti-armchair", "Standby team")}
                    <div
                        style={{
                            display: "grid",
                            gap: 12,
                            gridTemplateColumns: isMobile
                                ? "1fr"
                                : "repeat(auto-fill,minmax(440px,1fr))",
                        }}
                    >
                        {renderTeam(data?.standbyTeam || "Standby", standby, "__standby", true)}
                    </div>
                </section>
            )}

            {!loading &&
                byManager.map(([key, m]) => (
                    <section key={key} style={{ marginBottom: 20 }}>
                        {sectionTitle(
                            "ti-user-star",
                            m.name,
                            <span
                                style={{
                                    fontSize: fontSize.sm,
                                    color: MUTED,
                                    fontWeight: fontWeight.regular,
                                }}
                            >
                                — {[...m.teams.values()].reduce((n, l) => n + l.length, 0)} people
                            </span>
                        )}
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
                                .map(([team, people]) =>
                                    renderTeam(team, people, `${key}::${team}`)
                                )}
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
