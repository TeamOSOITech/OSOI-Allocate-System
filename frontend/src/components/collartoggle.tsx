// src/components/collartoggle.tsx
//
// White Collar / Blue Collar switch shown at the top of the Home page.
// Team Members (locked to one mode) just get a read-only badge.

import { useCollarMode } from "../context/collarmode";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

export default function CollarToggle({
    onChange,
}: {
    onChange?: (mode: "WHITE" | "BLUE") => void;
}) {
    const { mode, canToggle, setMode } = useCollarMode();

    const pill = (value: "WHITE" | "BLUE", label: string, icon: string) => {
        const active = mode === value;
        return (
            <button
                type="button"
                key={value}
                onClick={() => {
                    if (!canToggle || value === mode) return;
                    setMode(value);
                    onChange?.(value);
                }}
                disabled={!canToggle}
                aria-pressed={active}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 14px",
                    border: "none",
                    borderRadius: radius.pill,
                    cursor: canToggle ? "pointer" : "default",
                    fontFamily: fontFamily.base,
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.semibold,
                    background: active
                        ? value === "BLUE"
                            ? "linear-gradient(135deg,#2563EB,#1E40AF)"
                            : "linear-gradient(135deg,#FFFFFF,#E5E7EB)"
                        : "transparent",
                    color: active ? (value === "BLUE" ? "#fff" : "#111827") : "#6B7280",
                    boxShadow: active ? "0 1px 4px rgba(0,0,0,0.18)" : "none",
                    transition: "all .15s ease",
                }}
            >
                <i className={icon} aria-hidden="true" />
                {label}
            </button>
        );
    };

    if (!canToggle) {
        return (
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: radius.pill,
                    background: mode === "BLUE" ? "#DBEAFE" : "#F3F4F6",
                    color: mode === "BLUE" ? "#1E40AF" : "#374151",
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.semibold,
                    fontFamily: fontFamily.base,
                }}
            >
                <i
                    className={mode === "BLUE" ? "ti ti-helmet" : "ti ti-briefcase"}
                    aria-hidden="true"
                />
                {mode === "BLUE" ? "Blue Collar" : "White Collar"}
            </span>
        );
    }

    return (
        <div
            role="group"
            aria-label="Work mode"
            style={{
                display: "inline-flex",
                padding: 3,
                gap: 2,
                borderRadius: radius.pill,
                background: "#E5E7EB",
                border: "1px solid #D1D5DB",
            }}
        >
            {pill("WHITE", "White Collar", "ti ti-briefcase")}
            {pill("BLUE", "Blue Collar", "ti ti-helmet")}
        </div>
    );
}
