// src/pages/blue/allocationblock.tsx
//
// "Allocated Work" card for the Profile page (Blue Collar). Shows the
// services a manager allocated to this person: today, what is coming up,
// and how much of the recent days was ticked as done.
//
// Use on Profile:   <BlueAllocationBlock employeeId={employeeId} />

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;

type Day = { workDate: string; services: string[]; done: string[] };

const fmt = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short" });
};

const pill = (bg: string, fg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
    whiteSpace: "nowrap",
});

export default function BlueAllocationBlock({ employeeId }: { employeeId?: string | null }) {
    const [today, setToday] = useState("");
    const [days, setDays] = useState<Day[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

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
    }, [employeeId]);

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
                padding: 20,
                boxShadow: "0 10px 30px rgba(0,0,0,.06)",
                marginBottom: 16,
                textAlign: "left",
            }}
        >
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span
                    aria-hidden="true"
                    style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: "linear-gradient(135deg,#3B82F6,#6366F1)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 21,
                    }}
                >
                    <i className="ti ti-user-check" />
                </span>
                <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#17181C" }}>
                        Allocated Work
                    </div>
                    <div style={{ fontSize: 13, color: "#767F92" }}>
                        Services your manager allocated.
                    </div>
                </div>
                {!loading && !err && (
                    <span style={todays ? pill("#DBEAFE", "#1E40AF") : pill("#F3F4F6", "#374151")}>
                        {todays
                            ? `${todays.services.length} allocated today`
                            : "Nothing allocated today"}
                    </span>
                )}
            </div>

            {loading && (
                <div style={{ color: "#9099AC", fontSize: 13, marginTop: 14 }}>Loading…</div>
            )}
            {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 14 }}>{err}</div>}

            {!loading && !err && days.length === 0 && (
                <div
                    style={{
                        marginTop: 14,
                        border: "1px dashed #D9E0F2",
                        background: "#FAFBFF",
                        borderRadius: 12,
                        padding: "22px 16px",
                        textAlign: "center",
                        color: "#767F92",
                        fontSize: 13,
                    }}
                >
                    No work allocated yet. It will show up here once a manager allocates it.
                </div>
            )}

            {todays && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#17181C" }}>
                            Today
                        </span>
                        <span
                            style={pill(
                                todays.done.length === todays.services.length
                                    ? "#DCFCE7"
                                    : "#FEF3C7",
                                todays.done.length === todays.services.length
                                    ? "#166534"
                                    : "#92400E"
                            )}
                        >
                            {todays.done.length}/{todays.services.length} done
                        </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {todays.services.map((s) => {
                            const ok = todays.done.includes(s);
                            return (
                                <span
                                    key={s}
                                    style={
                                        ok ? pill("#DCFCE7", "#166534") : pill("#EEF2FF", "#3730A3")
                                    }
                                >
                                    <i
                                        className={`ti ${ok ? "ti-circle-check" : "ti-clock"}`}
                                        aria-hidden="true"
                                    />{" "}
                                    {s}
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            {upcoming.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div
                        style={{ fontSize: 13, fontWeight: 700, color: "#17181C", marginBottom: 8 }}
                    >
                        Upcoming
                    </div>
                    {upcoming.map((d) => (
                        <div
                            key={d.workDate}
                            style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                flexWrap: "wrap",
                                padding: "8px 0",
                                borderTop: "1px solid #EEF1F8",
                            }}
                        >
                            <span
                                style={{
                                    flex: "0 0 110px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: "#374151",
                                }}
                            >
                                {fmt(d.workDate)}
                            </span>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                                {d.services.map((s) => (
                                    <span key={s} style={pill("#F3F4F8", "#374151")}>
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {recent.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div
                        style={{ fontSize: 13, fontWeight: 700, color: "#17181C", marginBottom: 8 }}
                    >
                        Recent days
                    </div>
                    {recent.map((d) => (
                        <div
                            key={d.workDate}
                            style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                flexWrap: "wrap",
                                padding: "8px 0",
                                borderTop: "1px solid #EEF1F8",
                            }}
                        >
                            <span
                                style={{
                                    flex: "0 0 110px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: "#374151",
                                }}
                            >
                                {fmt(d.workDate)}
                            </span>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                                {d.services.map((s) => {
                                    const ok = d.done.includes(s);
                                    return (
                                        <span
                                            key={s}
                                            style={
                                                ok
                                                    ? pill("#DCFCE7", "#166534")
                                                    : pill("#FEE2E2", "#B91C1C")
                                            }
                                        >
                                            <i
                                                className={`ti ${ok ? "ti-check" : "ti-x"}`}
                                                aria-hidden="true"
                                            />{" "}
                                            {s}
                                        </span>
                                    );
                                })}
                            </div>
                            <span
                                style={pill(
                                    d.done.length === d.services.length ? "#DCFCE7" : "#FEF3C7",
                                    d.done.length === d.services.length ? "#166534" : "#92400E"
                                )}
                            >
                                {d.done.length}/{d.services.length}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
