// src/pages/blue/submitwork.tsx
//
// Blue Collar employee's end-of-day submit: a dropdown of ONLY the
// services mapped to their role (and location), each with a tick box.
// Role services are automatic; an extra duty given by a manager for today is added.

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import { ui, useIsMobileBlue } from "./ui";

const API_BASE = import.meta.env.VITE_API_URL;

type Service = { id: string; name: string; locationName: string; extra?: boolean };
type MyServices = {
    role: string;
    locationName: string;
    services: Service[];
    allocated?: boolean;
    workDate: string;
    submitted: { services: string[]; note: string; updatedAt: string } | null;
};

export default function BlueSubmitWork() {
    const isMobile = useIsMobileBlue();
    const [info, setInfo] = useState<MyServices | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [note, setNote] = useState("");
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await authFetch(`${API_BASE}/api/blue/my-services`, { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || json.success === false)
                throw new Error(json.message || "Failed to load");
            const d: MyServices = json.data;
            setInfo(d);
            setPicked(d.submitted?.services || []);
            setNote(d.submitted?.note || "");
        } catch (e: any) {
            setError(e?.message || "Failed to load your services.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // close the dropdown when clicking outside it
    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, []);

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
            setNotice("Submitted. Thank you!");
            setTimeout(() => setNotice(""), 3000);
            load();
        } catch (e: any) {
            setError(e?.message || "Failed to submit.");
        } finally {
            setSaving(false);
        }
    };

    const alreadySubmitted = Boolean(info?.submitted);

    return (
        <div style={isMobile ? ui.pageMobile : ui.page}>
            <h2 style={ui.title}>Submit Work</h2>
            <p style={ui.sub}>
                {info?.allocated
                    ? "These are your role duties plus the extra duty your manager gave you today. Tick what you finished."
                    : "Tick what you finished today."}
            </p>

            {loading && <p style={ui.sub}>Loading…</p>}
            {error && <div style={ui.error}>{error}</div>}
            {notice && <div style={ui.ok}>{notice}</div>}

            {!loading && info && (
                <div style={{ ...ui.card, maxWidth: 560, marginTop: 16 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                        <span style={ui.pill("#EFF6FF", "#1E40AF")}>
                            <i className="ti ti-user" aria-hidden="true" />{" "}
                            {info.role || "No role set"}
                        </span>
                        <span style={ui.pill("#F3F4F6", "#374151")}>
                            <i className="ti ti-map-pin" aria-hidden="true" />{" "}
                            {info.locationName || "No location"}
                        </span>
                        <span style={ui.pill("#F3F4F6", "#374151")}>{info.workDate}</span>
                        {info.allocated && (
                            <span style={ui.pill("#EDE9FE", "#5B21B6")}>Extra duty today</span>
                        )}
                        {alreadySubmitted && (
                            <span style={ui.pill("#DCFCE7", "#166534")}>Submitted today</span>
                        )}
                    </div>

                    {info.services.length === 0 ? (
                        <p style={ui.sub}>
                            No services are set up for your role
                            {info.locationName ? ` at ${info.locationName}` : ""} yet. Please ask
                            your admin.
                        </p>
                    ) : (
                        <>
                            <label style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>
                                Services done
                            </label>
                            <div ref={boxRef} style={{ position: "relative", marginTop: 4 }}>
                                <button
                                    type="button"
                                    onClick={() => setOpen((o) => !o)}
                                    aria-expanded={open}
                                    style={{
                                        ...ui.input,
                                        width: "100%",
                                        textAlign: "left",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        cursor: "pointer",
                                        boxSizing: "border-box",
                                    }}
                                >
                                    <span style={{ color: picked.length ? "#111827" : "#9CA3AF" }}>
                                        {picked.length
                                            ? `${picked.length} of ${info.services.length} selected`
                                            : "Select services…"}
                                    </span>
                                    <i
                                        className={`ti ti-chevron-${open ? "up" : "down"}`}
                                        aria-hidden="true"
                                    />
                                </button>

                                {open && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            zIndex: 20,
                                            left: 0,
                                            right: 0,
                                            top: "calc(100% + 4px)",
                                            background: "#fff",
                                            border: "1px solid #D1D5DB",
                                            borderRadius: radius.sm,
                                            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                                            maxHeight: 280,
                                            overflowY: "auto",
                                        }}
                                    >
                                        {info.services.map((s) => {
                                            const on = picked.includes(s.name);
                                            return (
                                                <label
                                                    key={s.id}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 10,
                                                        padding: "10px 12px",
                                                        cursor: "pointer",
                                                        background: on ? "#EFF6FF" : "#fff",
                                                        borderBottom: "1px solid #F3F4F6",
                                                        fontSize: fontSize.md,
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={on}
                                                        onChange={() => toggle(s.name)}
                                                        style={{ width: 18, height: 18 }}
                                                    />
                                                    {s.name}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {picked.length > 0 && (
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 6,
                                        flexWrap: "wrap",
                                        marginTop: 10,
                                    }}
                                >
                                    {picked.map((n) => (
                                        <span key={n} style={ui.pill("#DBEAFE", "#1E40AF")}>
                                            {n}
                                        </span>
                                    ))}
                                </div>
                            )}

                            <label
                                style={{
                                    display: "block",
                                    fontSize: fontSize.sm,
                                    fontWeight: fontWeight.medium,
                                    marginTop: 16,
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
                                    ...ui.input,
                                    width: "100%",
                                    marginTop: 4,
                                    boxSizing: "border-box",
                                    resize: "vertical",
                                }}
                            />

                            <button
                                style={{
                                    ...ui.btn("#1E40AF"),
                                    width: "100%",
                                    marginTop: 14,
                                    padding: "11px 14px",
                                    opacity: saving || picked.length === 0 ? 0.6 : 1,
                                }}
                                disabled={saving || picked.length === 0}
                                onClick={submit}
                            >
                                {saving
                                    ? "Submitting…"
                                    : alreadySubmitted
                                      ? "Update submission"
                                      : "Submit"}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
