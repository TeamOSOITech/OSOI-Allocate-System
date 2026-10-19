// src/components/settingsmodal.tsx
//
// Settings dialog opened from the avatar menu (header.tsx).
//   Appearance  — theme color (every user)
//   Logo        — change the organization logo (Super Admin only)
//   Work rules  — "Case number required" switch (Super Admin / managers only)

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTheme, THEMES } from "../context/themecontext";
import type { ThemeName } from "../context/themecontext";
import { useOrgSettings, saveCaseNumberRequired } from "../context/orgsettings";
import { fontFamily } from "../styles/theme";
import { useCollarMode } from "../context/collarmode";
import CollarToggle from "./collartoggle";

type SectionKey = "appearance" | "logo" | "work" | "plan" | "mode";

interface Props {
    open: boolean;
    onClose: () => void;
    canEditWorkRules: boolean;
    // Logo change (Super Admin only — decided by AppLayout)
    canEditLogo?: boolean;
    logoUrl?: string | null;
    logoUploading?: boolean;
    onLogoChange?: (file: File) => void | Promise<void>;
}

function Switch({
    checked,
    disabled,
    onChange,
    label,
    color,
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    label: string;
    color: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={onChange}
            style={{
                position: "relative",
                width: 46,
                height: 26,
                borderRadius: 999,
                border: "none",
                padding: 0,
                flexShrink: 0,
                background: checked ? color : "#CBD2E1",
                cursor: disabled ? "wait" : "pointer",
                transition: "background .18s ease",
                opacity: disabled ? 0.7 : 1,
            }}
        >
            <span
                style={{
                    position: "absolute",
                    top: 3,
                    left: checked ? 23 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                    transition: "left .18s ease",
                }}
            />
        </button>
    );
}

export default function SettingsModal({
    open,
    onClose,
    canEditWorkRules,
    canEditLogo = false,
    logoUrl,
    logoUploading = false,
    onLogoChange,
}: Props) {
    const navigate = useNavigate();
    // White Collar / Blue Collar switch lives here (admin-side roles only).
    const { mode: collarMode, canToggle: canSwitchMode } = useCollarMode();
    const { colors: BRAND, themeName, setThemeName } = useTheme();
    const { caseNumberRequired } = useOrgSettings();
    const [section, setSection] = useState<SectionKey>("appearance");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const logoFileInputRef = useRef<HTMLInputElement>(null);
    const [narrow, setNarrow] = useState(
        typeof window !== "undefined" ? window.innerWidth < 640 : false
    );

    useEffect(() => {
        if (!open) return;
        setSection("appearance");
        setError("");
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        const onResize = () => setNarrow(window.innerWidth < 640);
        document.addEventListener("keydown", onKey);
        window.addEventListener("resize", onResize);
        return () => {
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onResize);
        };
    }, [open, onClose]);

    if (!open) return null;

    const toggleCaseNumber = async () => {
        if (saving) return;
        setSaving(true);
        setError("");
        try {
            await saveCaseNumberRequired(!caseNumberRequired);
        } catch (e: any) {
            setError(e?.message || "Could not save the setting. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const handleLogoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onLogoChange?.(file);
        if (logoFileInputRef.current) logoFileInputRef.current.value = "";
    };

    const nav: { key: SectionKey; label: string; icon: string }[] = [
        { key: "appearance", label: "Appearance", icon: "ti-palette" },
        ...(canSwitchMode
            ? [{ key: "mode" as SectionKey, label: "Work mode", icon: "ti-switch-horizontal" }]
            : []),
        ...(canEditLogo ? [{ key: "logo" as SectionKey, label: "Logo", icon: "ti-photo" }] : []),
        { key: "plan", label: "Plan & upgrade", icon: "ti-rocket" },
        ...(canEditWorkRules
            ? [{ key: "work" as SectionKey, label: "Work rules", icon: "ti-adjustments" }]
            : []),
    ];

    const s: Record<string, CSSProperties> = {
        overlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 2000,
            fontFamily: fontFamily.base,
        },
        dialog: {
            width: "100%",
            maxWidth: 720,
            maxHeight: "90vh",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(15,23,42,.28)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
        },
        head: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 22px",
            borderBottom: "1px solid #EEF0F6",
        },
        title: { fontSize: 18, fontWeight: 700, color: "#16233a", margin: 0 },
        close: {
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "none",
            background: "#F3F5FA",
            color: "#5a6c85",
            cursor: "pointer",
            fontSize: 16,
        },
        body: {
            display: "flex",
            flexDirection: narrow ? "column" : "row",
            minHeight: narrow ? 0 : 340,
            overflow: "hidden",
            flex: 1,
        },
        nav: {
            display: "flex",
            flexDirection: narrow ? "row" : "column",
            gap: 4,
            padding: narrow ? "10px 14px 0" : "16px 12px",
            width: narrow ? "auto" : 200,
            flexShrink: 0,
            borderRight: narrow ? "none" : "1px solid #EEF0F6",
            borderBottom: narrow ? "1px solid #EEF0F6" : "none",
            background: "#FAFBFE",
        },
        content: { flex: 1, padding: "22px 26px", overflowY: "auto" },
        h2: { fontSize: 16, fontWeight: 700, color: "#16233a", margin: "0 0 4px" },
        sub: { fontSize: 13, color: "#6b7a90", margin: "0 0 18px", lineHeight: 1.5 },
        card: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            padding: "16px 18px",
            border: "1px solid #E6E9F3",
            borderRadius: 12,
            background: "#fff",
        },
    };

    return createPortal(
        <div
            style={s.overlay}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div style={s.dialog} role="dialog" aria-modal="true" aria-label="Settings">
                <div style={s.head}>
                    <h3 style={s.title}>Settings</h3>
                    <button type="button" style={s.close} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" />
                    </button>
                </div>

                <div style={s.body}>
                    <div style={s.nav}>
                        {nav.map((n) => {
                            const active = section === n.key;
                            return (
                                <button
                                    key={n.key}
                                    type="button"
                                    onClick={() => setSection(n.key)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "10px 12px",
                                        border: "none",
                                        borderRadius: 10,
                                        cursor: "pointer",
                                        fontSize: 14,
                                        fontWeight: 600,
                                        textAlign: "left",
                                        background: active ? `${BRAND.blue}14` : "transparent",
                                        color: active ? BRAND.blue : "#4b5a70",
                                    }}
                                >
                                    <i className={`ti ${n.icon}`} style={{ fontSize: 18 }} />
                                    {n.label}
                                </button>
                            );
                        })}
                    </div>

                    <div style={s.content}>
                        {section === "appearance" && (
                            <>
                                <h4 style={s.h2}>Theme color</h4>
                                <p style={s.sub}>
                                    Choose the accent color used across the header, buttons and
                                    charts. Saved on this device.
                                </p>
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                                        gap: 14,
                                    }}
                                >
                                    {(Object.keys(THEMES) as ThemeName[]).map((key) => {
                                        const palette = THEMES[key];
                                        const active = themeName === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setThemeName(key)}
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    padding: "12px 6px",
                                                    borderRadius: 12,
                                                    cursor: "pointer",
                                                    background: "#fff",
                                                    border: active
                                                        ? `2px solid ${palette.blue}`
                                                        : "1px solid #E6E9F3",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 38,
                                                        height: 38,
                                                        borderRadius: "50%",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        background: `linear-gradient(135deg, ${palette.lightBlue}, ${palette.blue})`,
                                                        color: "#fff",
                                                    }}
                                                >
                                                    {active && <i className="ti ti-check" />}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 12,
                                                        color: "#4b5a70",
                                                        fontWeight: active ? 700 : 500,
                                                    }}
                                                >
                                                    {palette.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {section === "mode" && canSwitchMode && (
                            <>
                                <h4 style={s.h2}>Work mode</h4>
                                <p style={s.sub}>
                                    Switch between <b>White Collar</b> (service-based work) and{" "}
                                    <b>Blue Collar</b> (manpower-based work). The menu, Add User and
                                    Employee Preview then show only that mode's people and pages.
                                </p>
                                <div style={s.card}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                                            Current mode:{" "}
                                            {collarMode === "BLUE" ? "Blue Collar" : "White Collar"}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12.5,
                                                color: "#767F92",
                                                marginTop: 2,
                                            }}
                                        >
                                            Saved on this device. Switching takes you back to Home.
                                        </div>
                                    </div>
                                    <CollarToggle
                                        onChange={() => {
                                            onClose();
                                            navigate("/report");
                                        }}
                                    />
                                </div>
                            </>
                        )}

                        {section === "logo" && canEditLogo && (
                            <>
                                <h4 style={s.h2}>Organization logo</h4>
                                <p style={s.sub}>
                                    Shown in the header for everyone in your organization. Only
                                    Super Admin can change it.
                                </p>
                                <div style={s.card}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 14,
                                            minWidth: 0,
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 140,
                                                height: 54,
                                                borderRadius: 10,
                                                border: "1px solid #E6E9F3",
                                                background: "#fff",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                flexShrink: 0,
                                                opacity: logoUploading ? 0.5 : 1,
                                            }}
                                        >
                                            <img
                                                src={logoUrl || "/Allookate.png"}
                                                alt="Current logo"
                                                style={{
                                                    maxWidth: "90%",
                                                    maxHeight: "90%",
                                                    objectFit: "contain",
                                                }}
                                            />
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div
                                                style={{
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    color: "#1B1F4B",
                                                }}
                                            >
                                                Current logo
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: 13,
                                                    color: "#6b7a90",
                                                    marginTop: 4,
                                                    lineHeight: 1.5,
                                                }}
                                            >
                                                {logoUploading
                                                    ? "Uploading…"
                                                    : "Upload a PNG or JPG image."}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={logoUploading}
                                        onClick={() => logoFileInputRef.current?.click()}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "10px 18px",
                                            border: "none",
                                            borderRadius: 999,
                                            cursor: logoUploading ? "wait" : "pointer",
                                            fontSize: 14,
                                            fontWeight: 700,
                                            color: "#fff",
                                            flexShrink: 0,
                                            opacity: logoUploading ? 0.7 : 1,
                                            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
                                            boxShadow: `0 6px 16px ${BRAND.blue}40`,
                                        }}
                                    >
                                        <i className="ti ti-upload" />
                                        Change logo
                                    </button>
                                    <input
                                        ref={logoFileInputRef}
                                        type="file"
                                        accept="image/*"
                                        style={{ display: "none" }}
                                        onChange={handleLogoFileChange}
                                    />
                                </div>
                            </>
                        )}

                        {section === "plan" && (
                            <>
                                <h4 style={s.h2}>Plan & upgrade</h4>
                                <p style={s.sub}>
                                    See your organization's current plan and pricing. Only Super
                                    Admin and Ops Manager can change the plan; everyone else gets a
                                    view-only page.
                                </p>
                                <div style={s.card}>
                                    <div style={{ minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                                color: "#1B1F4B",
                                            }}
                                        >
                                            Subscription
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                color: "#6b7a90",
                                                marginTop: 4,
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            View plans and upgrade your organization.
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onClose();
                                            navigate("/subscription");
                                        }}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "10px 18px",
                                            border: "none",
                                            borderRadius: 999,
                                            cursor: "pointer",
                                            fontSize: 14,
                                            fontWeight: 700,
                                            color: "#fff",
                                            flexShrink: 0,
                                            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
                                            boxShadow: `0 6px 16px ${BRAND.blue}40`,
                                        }}
                                    >
                                        <i className="ti ti-rocket" />
                                        Upgrade
                                    </button>
                                </div>
                            </>
                        )}

                        {section === "work" && canEditWorkRules && (
                            <>
                                <h4 style={s.h2}>Case numbers</h4>
                                <p style={s.sub}>
                                    Applies to everyone in your organization. Only Super Admin and
                                    managers can change this.
                                </p>
                                <div style={s.card}>
                                    <div style={{ minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                                color: "#1B1F4B",
                                            }}
                                        >
                                            Require case numbers for count work
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                color: "#6b7a90",
                                                marginTop: 4,
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {caseNumberRequired
                                                ? "On — employees must enter a case number for every unit they complete."
                                                : "Off — employees can complete count work without entering case numbers."}
                                        </div>
                                    </div>
                                    <Switch
                                        checked={caseNumberRequired}
                                        disabled={saving}
                                        onChange={toggleCaseNumber}
                                        label="Require case numbers for count work"
                                        color={BRAND.blue}
                                    />
                                </div>
                                {error && (
                                    <p style={{ color: "#DC2626", fontSize: 13, marginTop: 12 }}>
                                        {error}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
