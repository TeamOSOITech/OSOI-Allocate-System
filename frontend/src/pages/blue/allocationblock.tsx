// src/pages/blue/allocationblock.tsx
//
// "Allocated Work" card for the Profile page (Blue Collar). Shows the
// services a manager allocated to this person: today, what is coming up,
// and how much of the recent days was ticked as done.
//
// Use on Profile:   <BlueAllocationBlock employeeId={employeeId} />
// On your own profile it also has a "Submit Work" button that opens a popup
// to tick the services you finished today.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;

type Day = { workDate: string; services: string[]; done: string[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayParts = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00`);
    return { day: d.getDate(), month: MONTHS[d.getMonth()], weekday: WEEKDAYS[d.getDay()] };
};

// same chip size everywhere so the header button and pills line up
const pill = (bg: string, fg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    boxSizing: "border-box",
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color: fg,
    whiteSpace: "nowrap",
});

function DayRow({
    ymd,
    mode,
    first,
    services,
    done,
}: {
    ymd: string;
    mode: "today" | "upcoming" | "past";
    first: boolean;
    services: string[];
    done: string[];
}) {
    const d = dayParts(ymd);
    const isToday = mode === "today";
    const allDone = done.length === services.length;
    return (
        <div
            style={{
                display: "flex",
                gap: 12,
                padding: "10px 0",
                borderTop: first ? "none" : "1px solid #F1F2F6",
                alignItems: "flex-start",
            }}
        >
            <div
                style={{
                    flex: "0 0 44px",
                    width: 44,
                    padding: "5px 0",
                    borderRadius: 10,
                    textAlign: "center",
                    background: isToday ? "#DCFCE7" : "#EEF2FF",
                    color: isToday ? "#166534" : "#3730A3",
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>{d.day}</div>
                <div style={{ fontSize: 10, fontWeight: 700 }}>{d.month}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        minHeight: 24,
                        fontSize: 11.5,
                        color: "#767F92",
                        marginBottom: 4,
                    }}
                >
                    <span style={{ fontWeight: 700, color: "#3D4459" }}>
                        {isToday ? "Today" : d.weekday}
                    </span>
                    <span>
                        · {services.length} {services.length === 1 ? "service" : "services"}
                    </span>
                    {mode !== "upcoming" && (
                        <span
                            style={pill(
                                allDone ? "#DCFCE7" : "#FEF3C7",
                                allDone ? "#166534" : "#92400E"
                            )}
                        >
                            {done.length}/{services.length} done
                        </span>
                    )}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {services.map((sv) => {
                        const ok = done.includes(sv);
                        const style =
                            mode === "upcoming"
                                ? pill("#F3F4F8", "#374151")
                                : ok
                                  ? pill("#DCFCE7", "#166534")
                                  : mode === "today"
                                    ? pill("#EEF2FF", "#3730A3")
                                    : pill("#FEE2E2", "#B91C1C");
                        const icon =
                            mode === "upcoming"
                                ? null
                                : ok
                                  ? "ti-circle-check"
                                  : mode === "today"
                                    ? "ti-clock"
                                    : "ti-x";
                        return (
                            <span key={sv} style={style}>
                                {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
                                {sv}
                            </span>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

const caption: CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    color: "#9099AC",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    margin: "12px 0 0",
    paddingTop: 10,
    borderTop: "1px solid #F1F2F6",
};

type MyServices = {
    role: string;
    locationName: string;
    services: { id: string; name: string; time?: string }[];
    allocated?: boolean;
    workDate: string;
    submitted: { services: string[]; note: string } | null;
};

function SubmitWorkModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const [info, setInfo] = useState<MyServices | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/blue/my-services`, {
                    cache: "no-store",
                });
                const json = await res.json();
                if (!res.ok || json.success === false)
                    throw new Error(json.message || "Failed to load");
                if (cancelled) return;
                const d: MyServices = json.data;
                setInfo(d);
                setPicked(d.submitted?.services || []);
                setNote(d.submitted?.note || "");
            } catch (e: any) {
                if (!cancelled) setError(e?.message || "Failed to load your services.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Esc closes the popup (unless a submit is in flight)
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !saving) onClose();
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [saving, onClose]);

    const toggle = (name: string) =>
        setPicked((prev) =>
            prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
        );

    const submit = async () => {
        setSaving(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/blue/submissions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ services: picked, note }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to submit");
            onDone();
        } catch (e: any) {
            setError(e?.message || "Failed to submit.");
            setSaving(false);
        }
    };

    const services = info?.services || [];
    const already = Boolean(info?.submitted);

    return (
        <div
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !saving) onClose();
            }}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "rgba(17,24,39,.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Submit Work"
                style={{
                    background: "#fff",
                    borderRadius: 16,
                    width: "100%",
                    maxWidth: 480,
                    maxHeight: "90vh",
                    overflowY: "auto",
                    padding: 22,
                    boxShadow: "0 20px 60px rgba(0,0,0,.25)",
                    textAlign: "left",
                }}
            >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#17181C" }}>
                            Submit Work
                        </div>
                        <div style={{ fontSize: 12, color: "#767F92", marginTop: 2 }}>
                            {info?.allocated
                                ? "Your role duties plus any extra duty from your manager. Tick what you finished."
                                : "Tick what you finished today."}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        aria-label="Close"
                        style={{
                            border: "none",
                            background: "transparent",
                            fontSize: 20,
                            cursor: "pointer",
                            color: "#767F92",
                            lineHeight: 1,
                        }}
                    >
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>

                {loading && (
                    <div style={{ color: "#9099AC", fontSize: 13, marginTop: 16 }}>Loading…</div>
                )}
                {error && (
                    <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 12 }}>{error}</div>
                )}

                {!loading && info && (
                    <>
                        <div
                            style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}
                        >
                            <span style={pill("#EFF6FF", "#1E40AF")}>
                                {info.role || "No role set"}
                            </span>
                            <span style={pill("#F3F4F6", "#374151")}>
                                {info.locationName || "No location"}
                            </span>
                            <span style={pill("#F3F4F6", "#374151")}>{info.workDate}</span>
                            {already && (
                                <span style={pill("#DCFCE7", "#166534")}>Submitted today</span>
                            )}
                        </div>

                        {services.length === 0 ? (
                            <div style={{ color: "#767F92", fontSize: 13 }}>
                                No services are set up for your role
                                {info.locationName ? ` at ${info.locationName}` : ""} yet. Please
                                ask your admin.
                            </div>
                        ) : (
                            <>
                                <div
                                    style={{
                                        border: "1px solid #E5E9F5",
                                        borderRadius: 12,
                                        overflow: "hidden",
                                    }}
                                >
                                    {services.map((sv, i) => {
                                        const on = picked.includes(sv.name);
                                        return (
                                            <label
                                                key={sv.id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                    padding: "11px 14px",
                                                    cursor: "pointer",
                                                    background: on ? "#EEF2FF" : "#fff",
                                                    borderTop: i ? "1px solid #F1F3FA" : "none",
                                                    fontSize: 13,
                                                    color: "#17181C",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={on}
                                                    onChange={() => toggle(sv.name)}
                                                    style={{ width: 18, height: 18 }}
                                                />
                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                    {sv.name}
                                                </span>
                                                {sv.time && (
                                                    <span
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 4,
                                                            fontSize: 11,
                                                            fontWeight: 600,
                                                            color: "#5B6479",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        <i
                                                            className="ti ti-clock"
                                                            aria-hidden="true"
                                                        />
                                                        {sv.time}
                                                    </span>
                                                )}
                                            </label>
                                        );
                                    })}
                                </div>

                                <label
                                    style={{
                                        display: "block",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        marginTop: 14,
                                        color: "#17181C",
                                    }}
                                >
                                    Note (optional)
                                </label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    maxLength={500}
                                    rows={3}
                                    style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        marginTop: 4,
                                        padding: "8px 10px",
                                        border: "1px solid #D9E0F2",
                                        borderRadius: 10,
                                        fontSize: 13,
                                        fontFamily: "inherit",
                                        resize: "vertical",
                                    }}
                                />

                                <button
                                    type="button"
                                    onClick={submit}
                                    disabled={saving || picked.length === 0}
                                    style={{
                                        width: "100%",
                                        marginTop: 14,
                                        padding: "11px 14px",
                                        border: "none",
                                        borderRadius: 10,
                                        background: "#4F46E5",
                                        color: "#fff",
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor:
                                            saving || picked.length === 0
                                                ? "not-allowed"
                                                : "pointer",
                                        opacity: saving || picked.length === 0 ? 0.6 : 1,
                                    }}
                                >
                                    {saving
                                        ? "Submitting…"
                                        : already
                                          ? "Update submission"
                                          : "Submit"}
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default function BlueAllocationBlock({ employeeId }: { employeeId?: string | null }) {
    const [today, setToday] = useState("");
    const [days, setDays] = useState<Day[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [tick, setTick] = useState(0);
    const [showSubmit, setShowSubmit] = useState(false);
    const [toast, setToast] = useState("");
    const isOwn = !employeeId;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setErr("");
            try {
                const url = `${API_BASE}/api/blue/my-allocations${
                    employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ""
                }`;
                const res = await authFetch(url, { cache: "no-store" });
                const json = await res.json();
                if (!res.ok || json.success === false) throw new Error(json.message || "Failed");
                if (!cancelled) {
                    setToday(json.data.today);
                    setDays(json.data.allocations || []);
                }
            } catch (e: any) {
                if (!cancelled) setErr(e?.message || "Could not load allocated work.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [employeeId, tick]);

    const todays = days.find((d) => d.workDate === today) || null;
    const upcoming = days
        .filter((d) => d.workDate > today)
        .sort((a, b) => a.workDate.localeCompare(b.workDate));
    const recent = days.filter((d) => d.workDate < today).slice(0, 7);

    return (
        <div
            style={{
                background: "#fff",
                borderRadius: 16,
                padding: "16px 18px",
                boxShadow: "0 10px 30px rgba(0,0,0,.06)",
                marginBottom: 16,
                textAlign: "left",
            }}
        >
            {/* header: title on the left, button + today count on the right */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span
                    aria-hidden="true"
                    style={{
                        flex: "0 0 36px",
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "linear-gradient(135deg,#3B82F6,#6366F1)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        boxShadow: "0 6px 14px rgba(99,102,241,0.3)",
                    }}
                >
                    <i className="ti ti-user-check" />
                </span>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#17181C" }}>
                        Allocated Work
                    </div>
                    <div style={{ fontSize: 12, color: "#767F92", marginTop: 2 }}>
                        Your role duties and any extra duty.
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {isOwn && (
                        <button
                            type="button"
                            onClick={() => setShowSubmit(true)}
                            style={{
                                ...pill("#4F46E5", "#fff"),
                                border: "none",
                                cursor: "pointer",
                                fontWeight: 700,
                            }}
                        >
                            <i className="ti ti-checklist" aria-hidden="true" />
                            Submit Work
                        </button>
                    )}
                    {!loading && !err && (
                        <span
                            style={todays ? pill("#DBEAFE", "#1E40AF") : pill("#F3F4F6", "#374151")}
                        >
                            {todays ? `${todays.services.length} duties today` : "No duties today"}
                        </span>
                    )}
                </div>
            </div>

            {toast && (
                <div style={{ color: "#166534", fontSize: 12, fontWeight: 600, marginTop: 10 }}>
                    {toast}
                </div>
            )}

            {showSubmit && (
                <SubmitWorkModal
                    onClose={() => setShowSubmit(false)}
                    onDone={() => {
                        setShowSubmit(false);
                        setToast("Submitted. Thank you!");
                        setTimeout(() => setToast(""), 3000);
                        setTick((t) => t + 1);
                        window.dispatchEvent(new Event("blue-work-submitted"));
                    }}
                />
            )}

            {loading && (
                <div style={{ color: "#9099AC", fontSize: 12, marginTop: 14 }}>Loading…</div>
            )}
            {err && <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 14 }}>{err}</div>}

            {!loading && !err && days.length === 0 && (
                <div
                    style={{
                        marginTop: 14,
                        border: "1.5px dashed #D6DCF5",
                        background: "#FAFBFF",
                        borderRadius: 12,
                        padding: "20px 16px",
                        textAlign: "center",
                        color: "#767F92",
                        fontSize: 12,
                    }}
                >
                    No duties yet. Role duties show up here automatically once your role has
                    services mapped.
                </div>
            )}

            {todays && (
                <div style={{ marginTop: 8 }}>
                    <DayRow
                        ymd={todays.workDate}
                        mode="today"
                        first
                        services={todays.services}
                        done={todays.done}
                    />
                </div>
            )}

            {upcoming.length > 0 && (
                <div style={todays ? caption : { ...caption, borderTop: "none", paddingTop: 0 }}>
                    Upcoming
                    {upcoming.map((d, i) => (
                        <div
                            key={d.workDate}
                            style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}
                        >
                            <DayRow
                                ymd={d.workDate}
                                mode="upcoming"
                                first={i === 0}
                                services={d.services}
                                done={d.done}
                            />
                        </div>
                    ))}
                </div>
            )}

            {recent.length > 0 && (
                <div
                    style={
                        todays || upcoming.length
                            ? caption
                            : { ...caption, borderTop: "none", paddingTop: 0 }
                    }
                >
                    Recent days
                    {recent.map((d, i) => (
                        <div
                            key={d.workDate}
                            style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}
                        >
                            <DayRow
                                ymd={d.workDate}
                                mode="past"
                                first={i === 0}
                                services={d.services}
                                done={d.done}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
