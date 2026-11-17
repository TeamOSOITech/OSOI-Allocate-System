import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";

// ---------------------------------------------------------------------------
// HR Details panel (Add User form, Super Admin only).
//
// Opens as a full overlay panel from the "HR Details" button. The panel keeps
// its OWN draft; nothing reaches the Add User form until "Save HR Details" is
// pressed (Cancel / X throws the draft away). All fields are optional.
//
// Field keys here MUST match HR_FIELDS in backend/src/modules/users/hrDetails.js
// ---------------------------------------------------------------------------

export type HrDetails = {
    panNo: string;
    nameOnPan: string;
    aadhaarNo: string;
    nameOnAadhaar: string;
    uanNo: string;
    pfNo: string;
    esiNo: string;
    voterId: string;
    passportNo: string;
    drivingLicenceNo: string;
    drivingLicenceValidUpto: string;
    maritalStatus: string;
    marriageDate: string;
    grade: string;
    level: string;
    applicationDate: string;
    interviewDate: string;
    confirmationDate: string;
    lastIncrementDate: string;
    pfStartDate: string;
    epsStartDate: string;
    esiStartDate: string;
    terminationReason: string;
    pfLeftReason: string;
    esiLeftReason: string;
};

export const EMPTY_HR_DETAILS: HrDetails = {
    panNo: "",
    nameOnPan: "",
    aadhaarNo: "",
    nameOnAadhaar: "",
    uanNo: "",
    pfNo: "",
    esiNo: "",
    voterId: "",
    passportNo: "",
    drivingLicenceNo: "",
    drivingLicenceValidUpto: "",
    maritalStatus: "",
    marriageDate: "",
    grade: "",
    level: "",
    applicationDate: "",
    interviewDate: "",
    confirmationDate: "",
    lastIncrementDate: "",
    pfStartDate: "",
    epsStartDate: "",
    esiStartDate: "",
    terminationReason: "",
    pfLeftReason: "",
    esiLeftReason: "",
};

// how many HR fields are filled (shown as a badge on the button)
export const countHrFilled = (d: HrDetails) =>
    Object.values(d).filter((v) => String(v || "").trim() !== "").length;

type FieldDef = {
    key: keyof HrDetails;
    label: string;
    type?: "text" | "date" | "select" | "digits";
    placeholder?: string;
    maxLength?: number;
    upper?: boolean;
    options?: string[];
};

const SECTIONS: { title: string; icon: string; fields: FieldDef[] }[] = [
    {
        title: "IDs & Statutory Numbers",
        icon: "ti ti-id",
        fields: [
            { key: "panNo", label: "PAN", placeholder: "ABCDE1234F", maxLength: 10, upper: true },
            { key: "nameOnPan", label: "Name on PAN", maxLength: 100 },
            {
                key: "aadhaarNo",
                label: "Aadhaar No.",
                type: "digits",
                placeholder: "12 digits",
                maxLength: 12,
            },
            { key: "nameOnAadhaar", label: "Name on Aadhaar", maxLength: 100 },
            { key: "uanNo", label: "UAN", type: "digits", placeholder: "12 digits", maxLength: 12 },
            { key: "pfNo", label: "PF No.", maxLength: 40, upper: true },
            { key: "esiNo", label: "ESI No.", maxLength: 40 },
            { key: "voterId", label: "Voter ID", maxLength: 20, upper: true },
            { key: "passportNo", label: "Passport No.", maxLength: 20, upper: true },
            { key: "drivingLicenceNo", label: "Driving Licence No.", maxLength: 30, upper: true },
            { key: "drivingLicenceValidUpto", label: "Driving Licence valid upto", type: "date" },
        ],
    },
    {
        title: "Personal & Grade",
        icon: "ti ti-user-star",
        fields: [
            {
                key: "maritalStatus",
                label: "Marital Status",
                type: "select",
                options: ["Single", "Married", "Divorced", "Widowed"],
            },
            { key: "marriageDate", label: "Marriage Date", type: "date" },
            { key: "grade", label: "Grade", maxLength: 30 },
            { key: "level", label: "Level", maxLength: 30 },
        ],
    },
    {
        title: "Service History",
        icon: "ti ti-history",
        fields: [
            { key: "applicationDate", label: "Application Date", type: "date" },
            { key: "interviewDate", label: "Interview Date", type: "date" },
            { key: "confirmationDate", label: "Confirmation Date", type: "date" },
            { key: "lastIncrementDate", label: "Last Increment Date", type: "date" },
            { key: "pfStartDate", label: "PF Start Date", type: "date" },
            { key: "epsStartDate", label: "EPS Start Date", type: "date" },
            { key: "esiStartDate", label: "ESI Start Date", type: "date" },
            { key: "terminationReason", label: "Termination Reason", maxLength: 200 },
            { key: "pfLeftReason", label: "PF Left Reason", maxLength: 200 },
            { key: "esiLeftReason", label: "ESI Left Reason", maxLength: 200 },
        ],
    },
];

// Returns an error message, or "" when everything filled is valid.
export function validateHrDetails(d: HrDetails): string {
    if (d.panNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.panNo.trim().toUpperCase()))
        return "PAN must look like ABCDE1234F.";
    if (d.aadhaarNo && !/^\d{12}$/.test(d.aadhaarNo.trim()))
        return "Aadhaar must be exactly 12 digits.";
    if (d.uanNo && !/^\d{12}$/.test(d.uanNo.trim())) return "UAN must be exactly 12 digits.";
    const today = new Date().toISOString().slice(0, 10);
    if (d.marriageDate && d.marriageDate > today) return "Marriage Date can't be in the future.";
    return "";
}

export default function HrDetailsModal({
    open,
    value,
    onSave,
    onClose,
    brand,
    isMobile,
}: {
    open: boolean;
    value: HrDetails;
    onSave: (next: HrDetails) => void;
    onClose: () => void;
    brand: { blue: string; lightBlue: string; green: string };
    isMobile: boolean;
}) {
    const [draft, setDraft] = useState<HrDetails>(value);
    const [error, setError] = useState("");

    // every time the panel opens, start from what the form currently holds
    useEffect(() => {
        if (open) {
            setDraft(value);
            setError("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const s = getStyles(brand);
    const set = (key: keyof HrDetails, v: string) => setDraft((p) => ({ ...p, [key]: v }));

    const handleSave = () => {
        const msg = validateHrDetails(draft);
        if (msg) {
            setError(msg);
            return;
        }
        onSave(draft);
    };

    // Rendered into <body> (portal) so the app's top header / sidebar and any
    // transformed parent can never overlap or clip this panel.
    return createPortal(
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label="HR Details">
            <div style={isMobile ? s.panelMobile : s.panel} onClick={(e) => e.stopPropagation()}>
                <style>{`
.hr-input:focus { border-color: ${brand.blue} !important; background: #fff !important; box-shadow: 0 0 0 3px ${brand.blue}22; }
.hr-close:hover { background: #E7F0FB !important; }
`}</style>
                <div style={s.header}>
                    <div style={s.headerLeft}>
                        <span style={s.headerIcon}>
                            <i className="ti ti-id-badge-2" />
                        </span>
                        <div>
                            <h3 style={s.title}>HR Details</h3>
                            <p style={s.subtitle}>
                                All fields are optional · Visible and editable by Super Admin only
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="hr-close"
                        style={s.closeBtn}
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <div style={s.body}>
                    {SECTIONS.map((sec) => (
                        <div key={sec.title} style={s.section}>
                            <div style={s.sectionHeader}>
                                <span style={s.sectionIcon}>
                                    <i className={sec.icon} />
                                </span>
                                <span style={s.sectionTitle}>{sec.title}</span>
                                <span style={s.sectionCount}>
                                    {
                                        sec.fields.filter((f) => String(draft[f.key] || "").trim())
                                            .length
                                    }
                                    /{sec.fields.length}
                                </span>
                            </div>
                            <div style={isMobile ? s.gridMobile : s.grid}>
                                {sec.fields.map((f) => (
                                    <div key={f.key}>
                                        <label style={s.label}>{f.label}</label>
                                        {f.type === "select" ? (
                                            <select
                                                className="hr-input"
                                                style={s.input}
                                                value={draft[f.key]}
                                                onChange={(e) => set(f.key, e.target.value)}
                                            >
                                                <option value="">Select</option>
                                                {f.options!.map((o) => (
                                                    <option key={o} value={o}>
                                                        {o}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : f.type === "date" ? (
                                            <input
                                                type="date"
                                                className="hr-input"
                                                style={s.input}
                                                value={draft[f.key]}
                                                onChange={(e) => set(f.key, e.target.value)}
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                className="hr-input"
                                                inputMode={
                                                    f.type === "digits" ? "numeric" : undefined
                                                }
                                                autoComplete="off"
                                                style={s.input}
                                                maxLength={f.maxLength}
                                                placeholder={f.placeholder}
                                                value={draft[f.key]}
                                                onChange={(e) => {
                                                    let v = e.target.value;
                                                    if (f.type === "digits")
                                                        v = v.replace(/\D/g, "");
                                                    if (f.upper) v = v.toUpperCase();
                                                    set(f.key, v);
                                                }}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div style={s.footer}>
                    <span style={s.filledNote}>
                        {countHrFilled(draft)} of {Object.keys(EMPTY_HR_DETAILS).length} fields
                        filled
                    </span>
                    {error && <span style={s.error}>{error}</span>}
                    <button
                        type="button"
                        style={s.clearBtn}
                        onClick={() => {
                            setDraft(EMPTY_HR_DETAILS);
                            setError("");
                        }}
                    >
                        Clear all
                    </button>
                    <button type="button" style={s.cancelBtn} onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" style={s.saveBtn} onClick={handleSave}>
                        Save HR Details
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// Height of the app's top header (header.tsx = 64px). The panel starts BELOW
// it so it never covers the header. Change here if the header height changes.
const APP_HEADER_HEIGHT = 64;

function getStyles(brand: { blue: string; lightBlue: string }): Record<string, CSSProperties> {
    return {
        overlay: {
            position: "fixed",
            top: APP_HEADER_HEIGHT,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
            fontFamily: fontFamily.base,
        },
        panel: {
            width: "min(1280px, 96vw)",
            maxHeight: "100%",
            background: "#fff",
            borderRadius: radius.lg,
            boxShadow: "0 24px 60px rgba(15,23,42,.30)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            textAlign: "left",
        },
        panelMobile: {
            width: "100vw",
            height: "100%",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            textAlign: "left",
        },
        header: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 28px",
            borderBottom: "1px solid #E7F0FB",
            background: `linear-gradient(135deg, ${brand.blue}12, ${brand.lightBlue}0D)`,
        },
        headerLeft: { display: "flex", alignItems: "center", gap: 14 },
        headerIcon: {
            width: 42,
            height: 42,
            borderRadius: radius.md,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: "#fff",
            background: `linear-gradient(135deg, ${brand.lightBlue}, ${brand.blue})`,
            boxShadow: `0 6px 14px ${brand.blue}44`,
            flexShrink: 0,
        },
        title: {
            margin: 0,
            fontSize: fontSize["2xl"],
            fontWeight: fontWeight.semibold,
            color: "#17181C",
            textAlign: "left",
        },
        subtitle: { margin: "3px 0 0", fontSize: fontSize.sm, color: "#767F92", textAlign: "left" },
        closeBtn: {
            border: "none",
            background: "transparent",
            fontSize: fontSize.lg,
            cursor: "pointer",
            color: "#3D4459",
            lineHeight: 1,
            width: 34,
            height: 34,
            borderRadius: radius.circle,
        },
        body: {
            padding: "20px 28px 24px",
            overflowY: "auto",
            flex: 1,
            background: "#F7F9FC",
            display: "flex",
            flexDirection: "column",
            gap: 18,
        },
        section: {
            background: "#fff",
            border: "1px solid #E7ECF4",
            borderRadius: radius.md,
            padding: "16px 20px 20px",
            boxShadow: "0 2px 8px rgba(15,23,42,.04)",
        },
        sectionHeader: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: "1px solid #F0F2F7",
        },
        sectionIcon: {
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            color: brand.blue,
            background: `${brand.blue}14`,
        },
        sectionTitle: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        sectionCount: {
            marginLeft: "auto",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.medium,
            color: brand.blue,
            background: `${brand.blue}14`,
            borderRadius: radius.pill,
            padding: "3px 10px",
        },
        grid: {
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "16px 20px",
        },
        gridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 12 },
        label: {
            display: "block",
            marginBottom: 6,
            color: "#3D4459",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.medium,
            textAlign: "left",
        },
        input: {
            width: "100%",
            padding: "10px 12px",
            background: "#F9FAFC",
            border: "1px solid #E3E8F0",
            outline: "none",
            fontSize: fontSize.base,
            borderRadius: radius.sm,
            boxSizing: "border-box",
            color: "#17181C",
            textAlign: "left",
            transition: "border-color .15s, box-shadow .15s, background .15s",
        },
        footer: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 28px",
            borderTop: "1px solid #E7F0FB",
            background: "#fff",
            flexWrap: "wrap",
        },
        filledNote: { fontSize: fontSize.sm, color: "#767F92", marginRight: "auto" },
        error: { color: "#dc2626", fontSize: fontSize.sm, fontWeight: fontWeight.medium },
        clearBtn: {
            background: "transparent",
            border: "none",
            color: "#B91C1C",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            padding: "10px 8px",
        },
        cancelBtn: {
            background: "#fff",
            color: brand.blue,
            border: `1px solid ${brand.blue}`,
            borderRadius: radius.xl,
            padding: "10px 20px",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
        saveBtn: {
            background: `linear-gradient(135deg, ${brand.lightBlue}, ${brand.blue})`,
            color: "#fff",
            border: "none",
            borderRadius: radius.xl,
            padding: "10px 22px",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
        },
    };
}
