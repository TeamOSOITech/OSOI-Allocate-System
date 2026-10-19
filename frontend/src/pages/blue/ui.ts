// Small shared style helpers for the Blue Collar pages.
import type { CSSProperties } from "react";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

export const ui = {
    page: {
        padding: "24px 28px 48px",
        fontFamily: fontFamily.base,
        color: "#111827",
        minHeight: "100%",
    } as CSSProperties,
    pageMobile: {
        padding: "16px 14px 40px",
        fontFamily: fontFamily.base,
        color: "#111827",
    } as CSSProperties,
    title: { margin: 0, fontSize: fontSize["5xl"], fontWeight: fontWeight.bold } as CSSProperties,
    sub: { margin: "4px 0 0", fontSize: fontSize.base, color: "#6B7280" } as CSSProperties,
    card: {
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: radius.lg,
        padding: 16,
        boxShadow: "0 1px 3px rgba(16,24,40,0.05)",
    } as CSSProperties,
    input: {
        padding: "8px 10px",
        border: "1px solid #D1D5DB",
        borderRadius: radius.sm,
        fontSize: fontSize.base,
        fontFamily: fontFamily.base,
        background: "#fff",
        color: "#111827",
        outline: "none",
    } as CSSProperties,
    btn: (bg: string, fg = "#fff"): CSSProperties => ({
        padding: "8px 14px",
        border: "none",
        borderRadius: radius.sm,
        background: bg,
        color: fg,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        fontFamily: fontFamily.base,
        cursor: "pointer",
    }),
    ghostBtn: {
        padding: "6px 10px",
        border: "1px solid #D1D5DB",
        borderRadius: radius.sm,
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        fontFamily: fontFamily.base,
        cursor: "pointer",
    } as CSSProperties,
    pill: (bg: string, fg: string): CSSProperties => ({
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: radius.pill,
        background: bg,
        color: fg,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    }),
    error: {
        background: "#FEF2F2",
        color: "#B91C1C",
        border: "1px solid #FECACA",
        padding: "10px 12px",
        borderRadius: radius.sm,
        fontSize: fontSize.base,
        margin: "12px 0",
    } as CSSProperties,
    ok: {
        background: "#ECFDF5",
        color: "#047857",
        border: "1px solid #A7F3D0",
        padding: "10px 12px",
        borderRadius: radius.sm,
        fontSize: fontSize.base,
        margin: "12px 0",
    } as CSSProperties,
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(17,24,39,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
    } as CSSProperties,
    modal: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: 20,
        width: "100%",
        maxWidth: 420,
        boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
    } as CSSProperties,
};

export function useIsMobileBlue() {
    return typeof window !== "undefined" && window.innerWidth < 768;
}

export const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
    PRESENT: { label: "Present", bg: "#DCFCE7", fg: "#166534" },
    HALF_DAY: { label: "Half day", bg: "#FEF3C7", fg: "#92400E" },
    LEAVE: { label: "On leave", bg: "#FEE2E2", fg: "#991B1B" },
    ABSENT: { label: "Absent", bg: "#F3F4F6", fg: "#4B5563" },
};
