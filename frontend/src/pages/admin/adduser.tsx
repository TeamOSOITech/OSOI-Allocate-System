import { useState, useEffect } from "react";
import { authFetch } from "../../utils/authFetch";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import VoiceAssistant from "../../components/voiceAssistant";
import { speak } from "../../utils/speak";
import FormErrorBoundary from "../../components/formErrorBoundary";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

const MOBILE_BREAKPOINT = 768;

// Domains that are NOT allowed for the Email field — personal/free email
// providers. Only company/professional domains (e.g. abc@infosys.com) pass.
const BLOCKED_EMAIL_DOMAINS = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "rediffmail.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "msn.com",
];

const isProfessionalEmail = (email: string) => {
    const trimmed = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) return false;
    const domain = trimmed.split("@")[1];
    return !BLOCKED_EMAIL_DOMAINS.includes(domain);
};

// Styled tooltip (matches the gradient tooltip used on the Clients page) —
// inline style objects can't express :hover, so this small bit of CSS is
// injected once via a <style> tag instead of scattered onMouseEnter handlers.
const GLOBAL_CSS = `
.au-tooltip-wrap { position: relative; display: inline-flex; }
.au-tooltip-wrap .au-tooltip-bubble {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: linear-gradient(135deg, #2BAADD, #2A2F8F);
  color: #fff;
  font-size: 11.5px;
  font-weight: 600;
  padding: 7px 10px;
  border-radius: 8px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
  z-index: 20;
  box-shadow: 0 8px 20px rgba(42,47,143,.35);
}
.au-tooltip-wrap .au-tooltip-bubble::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: #2BAADD;
}
.au-tooltip-wrap:hover .au-tooltip-bubble {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}
`;

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(
        typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
    );
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return isMobile;
}

// Small reusable "+ add new option" control used under Department,
// Designation, Role, Reporting Manager and Teams. Clicking the + reveals
// an inline text box; submitting calls onAdd(value), which the parent
// uses to (a) push the value into that field's dropdown list and (b)
// persist it to the backend.
function InlineAddOption({
    onAdd,
    placeholder,
}: {
    onAdd: (value: string) => Promise<void> | void;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        const trimmed = value.trim();
        if (!trimmed) return;
        setSaving(true);
        try {
            await onAdd(trimmed);
            setValue("");
            setOpen(false);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                style={styles.addOptionToggle}
                aria-label="Add new option"
            >
                <i className="ti ti-plus" style={{ fontSize: fontSize.xs }} />
            </button>
        );
    }

    return (
        <div style={styles.addOptionRow}>
            <input
                autoFocus
                style={styles.addOptionInput}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder || "Type new value"}
                onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") {
                        setOpen(false);
                        setValue("");
                    }
                }}
            />
            <button type="button" style={styles.addOptionSubmit} onClick={submit} disabled={saving}>
                {saving ? "..." : "Add"}
            </button>
            <button
                type="button"
                style={styles.addOptionCancel}
                onClick={() => {
                    setOpen(false);
                    setValue("");
                }}
                aria-label="Cancel"
            >
                ✕
            </button>
        </div>
    );
}

// Shape of one bulk-upload row after mapping from the Excel sheet.
function mapBulkRow(row: any) {
    return {
        firstName: row["First Name"] || row["Full Name"] || "",
        lastName: row["Last Name"] || "",
        email: row["Email"] || "",
        contactNumber: row["Contact Number"] || "",
        employeeId: row["Employee ID"] || "",
        designation: row["Designation"] || "",
        department: row["Department"] || "",
        dob: row["Date of Birth"] || "",
        doj: row["Date of Joining"] || "",
        reportingManager: row["Reporting Manager"] || "",
        Teams: row["Teams"] || "",
        password: row["Password"] || "",
        role: (row["Role"] || "").toString().toUpperCase().trim(),
    };
}

// Required for bulk rows too — same rule as the single Add User form:
// everything except Date of Birth and Contact Number.
const BULK_REQUIRED_FIELDS: (keyof ReturnType<typeof mapBulkRow>)[] = [
    "firstName",
    "email",
    "employeeId",
    "designation",
    "department",
    "doj",
    "reportingManager",
    "Teams",
    "role",
];

export default function AddUser() {
    const navigate = useNavigate();
    const isMobile = useIsMobile();

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        contactNumber: "",
        employeeId: "",
        designation: "",
        department: "",
        dob: "",
        doj: "",
        reportingManager: "",
        Teams: "",
        password: "",
        role: "",
    });

    // Fields that must be filled before submit. DOB, Contact Number and
    // Password are intentionally excluded per requirement.
    const REQUIRED_FIELDS: (keyof typeof formData)[] = [
        "fullName",
        "email",
        "employeeId",
        "designation",
        "department",
        "doj",
        "reportingManager",
        "Teams",
        "role",
    ];
    const isRequired = (field: keyof typeof formData) => REQUIRED_FIELDS.includes(field);
    const labelStyle = (field: keyof typeof formData) => ({
        ...styles.label,
        ...(isRequired(field) ? styles.labelRequired : {}),
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showSuccess, setShowSuccess] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkResults, setBulkResults] = useState<any[] | null>(null);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState("");

    // Dropdown option lists for the fields that support "add new" inline.
    // Seeded with sensible defaults; anything added via the + control gets
    // appended here so it shows up immediately in the dropdown.
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
    const [designationOptions, setDesignationOptions] = useState<string[]>([]);
    const [teamsOptions, setTeamsOptions] = useState<string[]>([]);
    const [optionsLoading, setOptionsLoading] = useState(true);

    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/options`, {
                    cache: "no-store",
                });
                if (!res.ok) throw new Error("Failed to load options");
                const data = await res.json();
                setDepartmentOptions(data.departments || []);
                setDesignationOptions(data.designations || []);
                setTeamsOptions(data.teams || []);
            } catch (err) {
                console.error("Failed to load dropdown options:", err);
            } finally {
                setOptionsLoading(false);
            }
        };
        fetchOptions();
    }, []);
    // NOTE: Roles are tied to permission gating elsewhere (App.jsx role
    // lists, backend src/config/permissions.js). Adding a role name here
    // that doesn't exist in those places will let it be selected, but that
    // user won't actually get any matching permissions. Keeping this
    // addable because it was requested — worth revisiting.
    const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([
        { value: "TEAM_MEMBER", label: "Team Member" },
        { value: "VERTICAL_HEAD", label: "Vertical Head" },
        { value: "PROCESS_LEAD", label: "Process Lead" },
        { value: "OPS_MANAGER", label: "Ops Manager" },
        { value: "AUDIT_MANAGER", label: "Audit Manager" },
        { value: "SUPER_ADMIN", label: "Super Admin" },
    ]);

    // Reporting Manager dropdown = every current Process Lead, fetched
    // live from /api/employees and filtered by role, plus anything added
    // manually via the + control below.
    const [processLeads, setProcessLeads] = useState<{ id: string; name: string; email: string }[]>(
        []
    );
    const [processLeadsError, setProcessLeadsError] = useState("");

    useEffect(() => {
        const fetchProcessLeads = async () => {
            try {
                const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/employees`, {
                    cache: "no-store",
                });
                if (!res.ok) throw new Error("Failed to load Process Leads");
                const all = await res.json();
                setProcessLeads(
                    (all || [])
                        .filter((e: any) => e.role === "PROCESS_LEAD")
                        .map((e: any) => ({ id: e.id, name: e.name, email: e.email }))
                );
            } catch (err: any) {
                setProcessLeadsError("Could not load Reporting Manager list.");
            }
        };
        fetchProcessLeads();
    }, []);

    // Generic "save this new dropdown option to the backend" call. Adjust
    // the URL/body shape to match your actual backend route — this is a
    // placeholder endpoint (`POST /api/options`) since none was specified.
    const saveCustomOption = async (field: string, value: string) => {
        try {
            await authFetch(`${import.meta.env.VITE_API_URL}/api/options`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field, value }),
            });
        } catch (err) {
            // Non-fatal: value still shows in the dropdown locally (added
            // by the caller before this runs), it just won't be persisted
            // for other sessions/users until this endpoint exists/succeeds.
            console.error(`Failed to persist new "${field}" option:`, err);
        }
    };

    const generatePassword = () => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";
        let pass = "";
        for (let i = 0; i < 10; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return pass;
    };

    const handleGeneratePasswordClick = () => {
        setFormData((prev) => ({ ...prev, password: generatePassword() }));
    };

    const copyPassword = () => {
        navigator.clipboard.writeText(formData.password);
        alert("Password copied!");
    };

    const downloadTemplate = () => {
        const templateData = [
            {
                "Full Name": "John Doe",
                Email: "john.doe@company.com",
                "Contact Number": "9876543210",
                "Employee ID": "EMP12345",
                Designation: "Senior Developer",
                Department: "Tech",
                "Date of Birth": "1995-05-10",
                "Date of Joining": "2023-01-15",
                "Reporting Manager": "manager@company.com",
                Teams: "Tech",
                Password: "",
                Role: "TEAM_MEMBER",
            },
        ];

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
        XLSX.writeFile(workbook, "bulk_add_users_template.xlsx");
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) {
            setBulkError("Please select an Excel file first.");
            return;
        }

        setBulkError("");
        setBulkSubmitting(true);
        setBulkResults(null);

        try {
            const arrayBuffer = await bulkFile.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows: any[] = XLSX.utils.sheet_to_json(sheet);

            if (rows.length === 0) {
                setBulkError("The Excel file is empty.");
                setBulkSubmitting(false);
                return;
            }

            const mappedUsers = rows.map(mapBulkRow);

            // ---- client-side validation pass, mirrors handleRegister ----
            // Required fields (DOB & Contact Number excluded) + professional
            // email domain check, same rules as the single Add User form.
            const validUsers: ReturnType<typeof mapBulkRow>[] = [];
            const preFailedResults: any[] = [];

            mappedUsers.forEach((u) => {
                const missing = BULK_REQUIRED_FIELDS.filter((f) => !u[f]);
                if (missing.length > 0) {
                    preFailedResults.push({
                        email: u.email || "(no email)",
                        success: false,
                        message: `Missing required field(s): ${missing.join(", ")}`,
                    });
                    return;
                }
                if (!isProfessionalEmail(u.email)) {
                    preFailedResults.push({
                        email: u.email,
                        success: false,
                        message:
                            "Email must be a company domain (Gmail, Yahoo, Outlook etc. are not allowed).",
                    });
                    return;
                }
                validUsers.push(u);
            });

            let backendResults: any[] = [];
            if (validUsers.length > 0) {
                const response = await authFetch(
                    `${import.meta.env.VITE_API_URL}/api/users/bulk-add-user`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ users: validUsers }),
                    }
                );

                const data = await response.json();
                if (!response.ok) throw new Error(data?.message || "Bulk upload failed");
                backendResults = data.results || [];
            }

            // Combine so the results list shows every row from the sheet —
            // locally-rejected rows plus whatever the backend returned.
            setBulkResults([...preFailedResults, ...backendResults]);
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong reading the file.");
        } finally {
            setBulkSubmitting(false);
        }
    };

    const closeBulkModal = () => {
        setShowBulkModal(false);
        setBulkFile(null);
        setBulkResults(null);
        setBulkError("");
    };

    const validateRequired = () => {
        const missing = REQUIRED_FIELDS.filter((field) => !formData[field]);
        return missing;
    };

    const handleRegister = async () => {
        const missing = validateRequired();
        if (missing.length > 0) {
            setError("Please fill all required fields.");
            return;
        }

        if (!isProfessionalEmail(formData.email)) {
            setError(
                "Please enter a professional company email (e.g. abc@osoitech.com). Gmail, Yahoo, Outlook etc. are not allowed."
            );
            return;
        }

        setError("");
        setIsSubmitting(true);

        const trimmedName = formData.fullName.trim();
        const firstSpaceIndex = trimmedName.indexOf(" ");
        const firstName =
            firstSpaceIndex === -1 ? trimmedName : trimmedName.slice(0, firstSpaceIndex);
        const lastName =
            firstSpaceIndex === -1 ? "" : trimmedName.slice(firstSpaceIndex + 1).trim();

        // Password is optional in the form, but the backend still needs
        // something to create the login — auto-generate one if left blank
        // rather than blocking submit.
        const passwordToSend = formData.password || generatePassword();
        if (!formData.password) {
            setFormData((prev) => ({ ...prev, password: passwordToSend }));
        }

        try {
            const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/users/add-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    password: passwordToSend,
                    firstName,
                    lastName,
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.message || "Failed to create user");
            }

            setShowSuccess(true);
            speak("User submitted successfully.");
        } catch (err: any) {
            setError(err?.message || "Something went wrong");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSuccessClose = () => {
        setShowSuccess(false);
        navigate("/clients");
    };

    const handleVoiceFillForm = (data: any) => {
        const combinedFullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();

        setFormData((prev) => ({
            ...prev,
            fullName: combinedFullName || prev.fullName,
            email: data.email || prev.email,
            contactNumber: data.contactNumber || prev.contactNumber,
            role: data.role || prev.role,
            password: data.password || prev.password,
            employeeId: data.employeeId || prev.employeeId,
            designation: data.designation || prev.designation,
            department: data.department || prev.department,
            dob: data.dob || prev.dob,
            doj: data.doj || prev.doj,
            reportingManager: data.reportingManager || prev.reportingManager,
            Teams: data.Teams || prev.Teams,
        }));
    };

    // FIX: this is the actual cause of the blank-screen bug.
    //
    // Previously <VoiceAssistant onRequestSubmit={handleRegister} /> wired
    // the REAL registration handler directly to voice. handleRegister()
    // posts to the backend, and on success sets showSuccess(true) + calls
    // speak("User submitted successfully."). The success modal's OK button
    // calls navigate("/reportdashboard") — that's the only navigate() call
    // in this whole file.
    //
    // With continuous:true speech recognition, a second short listening
    // cycle can fire moments after your main sentence (a trailing word,
    // a pause-triggered re-segment, etc). If that second fragment contains
    // anything matching a submit phrase, VoiceAssistant silently calls
    // onRequestSubmit() — which WAS handleRegister — registering the user
    // for real and redirecting you away before you ever got to review.
    // That's why you'd hear "please review" and then immediately land on
    // a blank/different page: two separate voice commands were processed
    // back to back, not one.
    //
    // This wrapper re-validates required fields and refuses to silently
    // submit/navigate if the form isn't actually ready, so a stray voice
    // match can no longer blow past your review step.
    const handleVoiceRequestSubmit = () => {
        if (validateRequired().length > 0) {
            speak("Some required fields are still missing. Please review before submitting.");
            return;
        }
        handleRegister();
    };

    return (
        <FormErrorBoundary>
            <div style={isMobile ? styles.rootMobile : styles.root}>
                <style>{GLOBAL_CSS}</style>
                {isMobile && (
                    <div style={styles.mobileTopbar}>
                        <span style={styles.mobileTitle}>Add New User</span>
                        <div style={styles.mobileHeaderBtnGroup}>
                            <span className="au-tooltip-wrap">
                                <button
                                    style={styles.templateBtnMobile}
                                    onClick={downloadTemplate}
                                    type="button"
                                    aria-label="Download Excel Format"
                                >
                                    <i
                                        className="ti ti-file-spreadsheet"
                                        style={{ fontSize: fontSize.md }}
                                    />
                                </button>
                                <span className="au-tooltip-bubble">
                                    Sample sheet for bulk upload (.xlsx)
                                </span>
                            </span>
                            <span className="au-tooltip-wrap">
                                <button
                                    style={styles.bulkHeaderBtnMobile}
                                    onClick={() => setShowBulkModal(true)}
                                    type="button"
                                >
                                    Bulk Add
                                </button>
                                <span className="au-tooltip-bubble">
                                    Add multiple users from an Excel (.xlsx) file
                                </span>
                            </span>
                        </div>
                    </div>
                )}

                <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                    <div style={styles.contentBody}>
                        {!isMobile && (
                            <div style={styles.pageHeaderRow}>
                                <div style={styles.pageTitleBlock}>
                                    <h2 style={styles.pageTitle}>Add New User</h2>
                                    <p style={styles.headerSubtext}>
                                        Create a new employee account and assign role & permissions
                                    </p>
                                </div>
                                <div style={styles.headerButtonGroup}>
                                    <span className="au-tooltip-wrap">
                                        <button
                                            style={styles.templateBtn}
                                            onClick={downloadTemplate}
                                            type="button"
                                        >
                                            <i
                                                className="ti ti-file-spreadsheet"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            Sample Sheet
                                        </button>
                                        <span className="au-tooltip-bubble">
                                            Sample sheet for bulk upload (.xlsx)
                                        </span>
                                    </span>
                                    <span className="au-tooltip-wrap">
                                        <button
                                            style={styles.bulkBtn}
                                            onClick={() => setShowBulkModal(true)}
                                            type="button"
                                        >
                                            <i
                                                className="ti ti-upload"
                                                style={{ fontSize: fontSize.md }}
                                            />
                                            Bulk Add Users
                                        </button>
                                        <span className="au-tooltip-bubble">
                                            Add multiple users from an Excel (.xlsx) file
                                        </span>
                                    </span>
                                </div>
                            </div>
                        )}

                        <div style={styles.formCard}>
                            {/* Section: Personal Information */}
                            <div style={styles.sectionHeader}>
                                <i
                                    className="ti ti-user"
                                    style={{ fontSize: fontSize.lg, color: "#2A2F8F" }}
                                />
                                <span style={styles.sectionHeaderText}>Personal Information</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <div style={isMobile ? styles.gridMobile : styles.grid}>
                                    <div>
                                        <label style={labelStyle("fullName")}>Full Name *</label>
                                        <input
                                            style={styles.input}
                                            value={formData.fullName}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    fullName: e.target.value,
                                                })
                                            }
                                            placeholder="e.g. John Doe"
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("email")}>Email *</label>
                                        <input
                                            type="email"
                                            style={styles.input}
                                            value={formData.email}
                                            onChange={(e) =>
                                                setFormData({ ...formData, email: e.target.value })
                                            }
                                            placeholder="e.g. john.doe@infosys.com"
                                        />
                                        <p style={styles.note}>
                                            Use your official company email (not Gmail / Yahoo /
                                            Outlook)
                                        </p>
                                    </div>
                                    <div>
                                        <label style={labelStyle("contactNumber")}>
                                            Contact Number
                                        </label>
                                        <input
                                            type="tel"
                                            style={styles.input}
                                            value={formData.contactNumber}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    contactNumber: e.target.value,
                                                })
                                            }
                                            placeholder="e.g. 9876543210"
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("employeeId")}>
                                            Employee ID *
                                        </label>
                                        <input
                                            style={styles.input}
                                            value={formData.employeeId}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    employeeId: e.target.value,
                                                })
                                            }
                                            placeholder="e.g. EMP12345"
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("designation")}>
                                            Designation *
                                        </label>
                                        <select
                                            style={styles.input}
                                            value={formData.designation}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    designation: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">Select Designation</option>
                                            {designationOptions.map((d) => (
                                                <option key={d} value={d}>
                                                    {d}
                                                </option>
                                            ))}
                                        </select>
                                        <InlineAddOption
                                            placeholder="e.g. Senior Developer"
                                            onAdd={async (val) => {
                                                setDesignationOptions((prev) =>
                                                    prev.includes(val) ? prev : [...prev, val]
                                                );
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    designation: val,
                                                }));
                                                await saveCustomOption("designation", val);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("department")}>Department *</label>
                                        <select
                                            style={styles.input}
                                            value={formData.department}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    department: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">Select Department</option>
                                            {departmentOptions.map((d) => (
                                                <option key={d} value={d}>
                                                    {d}
                                                </option>
                                            ))}
                                        </select>
                                        <InlineAddOption
                                            placeholder="e.g. Finance"
                                            onAdd={async (val) => {
                                                setDepartmentOptions((prev) =>
                                                    prev.includes(val) ? prev : [...prev, val]
                                                );
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    department: val,
                                                }));
                                                await saveCustomOption("department", val);
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Organization Details */}
                            <div style={styles.sectionHeader}>
                                <i
                                    className="ti ti-building"
                                    style={{ fontSize: fontSize.lg, color: "#2A2F8F" }}
                                />
                                <span style={styles.sectionHeaderText}>Organization Details</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <div style={isMobile ? styles.gridMobile : styles.grid}>
                                    <div>
                                        <label style={labelStyle("role")}>Role *</label>
                                        <select
                                            style={styles.input}
                                            value={formData.role}
                                            onChange={(e) =>
                                                setFormData({ ...formData, role: e.target.value })
                                            }
                                        >
                                            <option value="">Select Role</option>
                                            {roleOptions.map((r) => (
                                                <option key={r.value} value={r.value}>
                                                    {r.label}
                                                </option>
                                            ))}
                                        </select>
                                        <InlineAddOption
                                            placeholder="e.g. QA_LEAD"
                                            onAdd={async (val) => {
                                                setRoleOptions((prev) =>
                                                    prev.some((r) => r.value === val)
                                                        ? prev
                                                        : [...prev, { value: val, label: val }]
                                                );
                                                setFormData((prev) => ({ ...prev, role: val }));
                                                await saveCustomOption("role", val);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("reportingManager")}>
                                            Reporting Manager *
                                        </label>
                                        <select
                                            style={styles.input}
                                            value={formData.reportingManager}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    reportingManager: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">
                                                {processLeads.length === 0
                                                    ? "No Process Leads found"
                                                    : "Select Manager"}
                                            </option>
                                            {processLeads.map((pl) => (
                                                <option key={pl.id} value={pl.email}>
                                                    {pl.name} ({pl.email})
                                                </option>
                                            ))}
                                        </select>

                                        <InlineAddOption
                                            placeholder="Manager name"
                                            onAdd={async (val) => {
                                                setProcessLeads((prev) =>
                                                    prev.some((pl) => pl.email === val)
                                                        ? prev
                                                        : [
                                                              ...prev,
                                                              {
                                                                  id: `custom-${Date.now()}`,
                                                                  name: val,
                                                                  email: val,
                                                              },
                                                          ]
                                                );
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    reportingManager: val,
                                                }));
                                                await saveCustomOption("reportingManager", val);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("Teams")}>Teams *</label>
                                        <select
                                            style={styles.input}
                                            value={formData.Teams}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    Teams: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">Select Team</option>
                                            {teamsOptions.map((t) => (
                                                <option key={t} value={t}>
                                                    {t}
                                                </option>
                                            ))}
                                        </select>
                                        <InlineAddOption
                                            placeholder="e.g. Support"
                                            onAdd={async (val) => {
                                                setTeamsOptions((prev) =>
                                                    prev.includes(val) ? prev : [...prev, val]
                                                );
                                                setFormData((prev) => ({ ...prev, Teams: val }));
                                                await saveCustomOption("teams", val);
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("dob")}>Date of Birth</label>
                                        <input
                                            type="date"
                                            style={styles.input}
                                            value={formData.dob}
                                            onChange={(e) =>
                                                setFormData({ ...formData, dob: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle("doj")}>Date of Joining *</label>
                                        <input
                                            type="date"
                                            style={styles.input}
                                            value={formData.doj}
                                            onChange={(e) =>
                                                setFormData({ ...formData, doj: e.target.value })
                                            }
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Security */}
                            <div style={styles.sectionHeader}>
                                <i
                                    className="ti ti-lock"
                                    style={{ fontSize: fontSize.lg, color: "#2A2F8F" }}
                                />
                                <span style={styles.sectionHeaderText}>Security</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <label style={labelStyle("password")}>Password</label>
                                <div
                                    style={
                                        isMobile
                                            ? styles.passwordRegisterRowMobile
                                            : styles.passwordRegisterRow
                                    }
                                >
                                    <div
                                        style={
                                            isMobile ? styles.passwordRowMobile : styles.passwordRow
                                        }
                                    >
                                        <input
                                            type="text"
                                            style={{ ...styles.input, flex: 1, minWidth: 0 }}
                                            value={formData.password}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    password: e.target.value,
                                                })
                                            }
                                            placeholder="Optional — auto-generated if left blank"
                                        />
                                        <button
                                            style={styles.generateBtn}
                                            onClick={handleGeneratePasswordClick}
                                            type="button"
                                        >
                                            <i
                                                className="ti ti-refresh"
                                                style={{ fontSize: fontSize.base }}
                                            />
                                            Generate
                                        </button>
                                        <button
                                            style={styles.copyBtn}
                                            onClick={copyPassword}
                                            type="button"
                                        >
                                            <i
                                                className="ti ti-copy"
                                                style={{ fontSize: fontSize.base }}
                                            />
                                            Copy
                                        </button>
                                    </div>

                                    <button
                                        style={{
                                            ...(isMobile
                                                ? styles.registerButtonMobile
                                                : styles.registerButton),
                                            opacity: isSubmitting ? 0.7 : 1,
                                            cursor: isSubmitting ? "not-allowed" : "pointer",
                                        }}
                                        onClick={handleRegister}
                                        disabled={isSubmitting}
                                    >
                                        <i
                                            className="ti ti-user-plus"
                                            style={{ fontSize: fontSize.lg }}
                                        />
                                        {isSubmitting ? "Saving..." : "Register User"}
                                    </button>
                                </div>

                                {error && <p style={styles.error}>{error}</p>}
                            </div>
                        </div>
                    </div>
                </div>

                {showSuccess && (
                    <div style={styles.overlay}>
                        <div style={styles.successModal}>
                            <div style={styles.successIcon}>✓</div>
                            <h3 style={styles.successTitle}>User Added Successfully</h3>
                            <p style={styles.successText}>
                                {formData.fullName} has been added as a new user.
                            </p>
                            <button style={styles.successBtn} onClick={handleSuccessClose}>
                                OK
                            </button>
                        </div>
                    </div>
                )}

                {showBulkModal && (
                    <div style={styles.overlay} onClick={closeBulkModal}>
                        <div style={styles.bulkModal} onClick={(e) => e.stopPropagation()}>
                            <div style={styles.bulkModalHeader}>
                                <h3 style={styles.bulkModalTitle}>Bulk Add Users</h3>
                                <p style={styles.bulkModalSubtitle}>
                                    Upload an Excel file to create multiple accounts at once
                                </p>
                                <button
                                    style={styles.closeBtn}
                                    onClick={closeBulkModal}
                                    type="button"
                                    aria-label="Close"
                                >
                                    ✕
                                </button>
                            </div>

                            <div style={styles.bulkInfoBox}>
                                <span style={styles.bulkInfoLabel}>Required columns</span>
                                <p style={styles.bulkInfoText}>
                                    Full Name, Email (company domain only), Employee ID,
                                    Designation, Department, Date of Joining, Reporting Manager,
                                    Teams, Role. Contact Number and Date of Birth are optional.
                                </p>
                            </div>

                            <div style={styles.bulkUploadRow}>
                                <label style={styles.fileInputWrapper}>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
                                        style={styles.fileInputHidden}
                                    />
                                    <span style={styles.fileInputButton}>Choose File</span>
                                    <span style={styles.fileInputName}>
                                        {bulkFile ? bulkFile.name : "No file chosen"}
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    onClick={handleBulkUpload}
                                    disabled={bulkSubmitting}
                                    style={{
                                        ...styles.bulkUploadBtn,
                                        opacity: bulkSubmitting ? 0.7 : 1,
                                        cursor: bulkSubmitting ? "not-allowed" : "pointer",
                                    }}
                                >
                                    {bulkSubmitting ? "Uploading…" : "Upload & Create Users"}
                                </button>
                            </div>

                            {bulkError && <p style={styles.error}>{bulkError}</p>}

                            {bulkResults && (
                                <div style={styles.resultsSection}>
                                    <div style={styles.resultsSummary}>
                                        <span style={styles.resultsSummaryText}>
                                            <strong>
                                                {bulkResults.filter((r) => r.success).length}
                                            </strong>{" "}
                                            created
                                            {bulkResults.some((r) => !r.success) && (
                                                <>
                                                    {" "}
                                                    ·{" "}
                                                    <strong style={{ color: "#dc2626" }}>
                                                        {
                                                            bulkResults.filter((r) => !r.success)
                                                                .length
                                                        }
                                                    </strong>{" "}
                                                    failed
                                                </>
                                            )}
                                        </span>
                                    </div>
                                    <div style={styles.resultsList}>
                                        {bulkResults.map((r, i) => (
                                            <div key={i} style={styles.resultRow}>
                                                <div style={styles.resultRowMain}>
                                                    <span style={styles.resultEmail}>
                                                        {r.email}
                                                    </span>
                                                    <span
                                                        style={{
                                                            ...styles.statusPill,
                                                            ...(r.success
                                                                ? styles.statusPillSuccess
                                                                : styles.statusPillFail),
                                                        }}
                                                    >
                                                        {r.success ? "✓ Created" : "✗ Failed"}
                                                    </span>
                                                </div>
                                                <p style={styles.resultMessage}>{r.message}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* FIX: was onRequestSubmit={handleRegister} — now goes through
                the guarded wrapper above instead of calling the real
                registration handler directly. */}
                <VoiceAssistant
                    onFillForm={handleVoiceFillForm}
                    onRequestSubmit={handleVoiceRequestSubmit}
                />
            </div>
        </FormErrorBoundary>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        width: "100%",
        flex: 1,
        minHeight: 0,
        background: "#EAF3FC",
        fontFamily: fontFamily.base,
        overflowX: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "#EAF3FC",
        fontFamily: fontFamily.base,
        position: "relative",
        overflowX: "hidden",
    },

    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "1px solid #eee",
        position: "sticky",
        top: 0,
        zIndex: 30,
        boxSizing: "border-box",
        width: "100%",
    },
    hamburgerBtn: {
        border: "none",
        background: "transparent",
        fontSize: fontSize["3xl"],
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: "#17181C" },
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    sidebarDrawer: {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: "230px",
        maxWidth: "80vw",
        zIndex: 50,
        transition: "transform 0.25s ease",
        boxShadow: "2px 0 12px rgba(0,0,0,0.15)",
        overflowY: "auto",
    },

    contentCol: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
    },
    contentColMobile: { flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px",
        flex: 1,
        overflow: "hidden",
        minHeight: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
    },

    pageHeaderRow: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
        minHeight: 48,
    },
    pageTitleBlock: { textAlign: "center" },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },

    headerSubtext: {
        margin: "4px 0 0",

        fontSize: fontSize.base,

        color: "#767F92",

        textAlign: "left",
    },

    headerButtonGroup: {
        position: "absolute",
        right: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    templateBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        color: "#2A2F8F",
        border: "1px solid #C7D9F0",
        borderRadius: radius["2xl"],
        padding: "11px 20px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },
    bulkBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius["2xl"],
        padding: "11px 22px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(42,47,143,0.3)",
    },
    bulkHeaderBtnMobile: {
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius.xl,
        padding: "6px 14px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    formCard: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: radius.xl,
        padding: 0,
        boxShadow: "0 10px 30px rgba(0,0,0,.06)",
        overflow: "hidden",
        minHeight: 0,
    },
    sectionHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "14px 24px",
        background: "#F4F8FD",
        borderBottom: "1px solid #E7F0FB",
    },
    sectionHeaderText: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#2A2F8F",
    },
    sectionBody: { padding: "16px 24px" },

    grid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "18px 24px" },
    gridMobile: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "12px",
    },

    label: {
        display: "block",
        marginBottom: 6,
        color: "#3D4459",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
    },
    labelRequired: {
        // Changed: no longer red — required labels now match the
        // regular label color (same as Contact Number's label).
        color: "#3D4459",
    },
    input: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafafa",
        border: "1px solid #ececf5",
        outline: "none",
        fontSize: fontSize.base,
        borderRadius: radius.sm,
        boxSizing: "border-box",
        color: "#17181C",
    },
    note: { color: "#f59e0b", marginTop: 6, fontWeight: fontWeight.medium, fontSize: fontSize.xs },

    addOptionToggle: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        marginTop: 6,
        border: "1px dashed #C7D9F0",
        borderRadius: radius.circle,
        background: "#fff",
        color: "#2A2F8F",
        cursor: "pointer",
        padding: 0,
    },
    addOptionRow: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
    },
    addOptionInput: {
        flex: 1,
        minWidth: 0,
        padding: "6px 8px",
        fontSize: fontSize.sm,
        border: "1px solid #ececf5",
        borderRadius: radius.xs,
        outline: "none",
        background: "#fafafa",
        color: "#17181C",
    },
    addOptionSubmit: {
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius.xs,
        padding: "6px 10px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    addOptionCancel: {
        border: "none",
        background: "transparent",
        color: "#9ca3af",
        cursor: "pointer",
        fontSize: fontSize.sm,
        padding: "0 4px",
    },

    passwordRegisterRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
    },
    passwordRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "58%",
        minWidth: 280,
    },

    generateBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "10px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    copyBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#2A2F8F",
        border: "1px solid #C7D9F0",
        borderRadius: radius.sm,
        padding: "10px 16px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    error: {
        color: "#dc2626",
        margin: "16px 0 0",
        fontWeight: fontWeight.medium,
        fontSize: fontSize.base,
    },

    registerButton: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius["2xl"],
        padding: "12px 26px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(42,47,143,0.3)",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },

    successModal: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: 32,
        width: 360,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    },
    successIcon: {
        width: 56,
        height: 56,
        borderRadius: radius.circle,
        background: "#DCEAFB",
        color: "#2A2F8F",
        fontSize: fontSize["6xl"],
        fontWeight: fontWeight.semibold,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 16px",
    },
    successTitle: {
        margin: "0 0 8px",
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    successText: { margin: "0 0 24px", fontSize: fontSize.md, color: "#767F92" },
    successBtn: {
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "10px 32px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
    },

    bulkModal: {
        background: "#fff",
        borderRadius: radius.lg,
        width: 560,
        maxWidth: "92vw",
        maxHeight: "88vh",
        overflowY: "auto",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    bulkModalHeader: {
        position: "relative",
        textAlign: "center",
        padding: "24px 28px 16px",
        borderBottom: "1px solid #f0f0f0",
    },
    bulkModalTitle: {
        margin: 0,
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.semibold,
        color: "#2A2F8F",
    },
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },
    closeBtn: {
        position: "absolute",
        top: 20,
        right: 24,
        border: "none",
        background: "#f3f4f6",
        borderRadius: radius.circle,
        width: 28,
        height: 28,
        fontSize: fontSize.md,
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "#EEF6FB",
        borderLeft: "3px solid #2BAADD",
        borderRadius: radius.xs,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#2A2F8F",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 4,
    },
    bulkInfoText: { margin: 0, fontSize: fontSize.base, color: "#6b7280", lineHeight: 1.6 },
    bulkUploadRow: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        margin: "0 28px 24px",
    },
    fileInputWrapper: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid #e5e7eb",
        borderRadius: radius.sm,
        padding: "8px 12px",
        cursor: "pointer",
        flex: 1,
        minWidth: 200,
        background: "#fafafa",
    },
    fileInputHidden: { display: "none" },
    fileInputButton: {
        background: "#2A2F8F",
        color: "#fff",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        padding: "6px 12px",
        borderRadius: radius.xs,
        whiteSpace: "nowrap",
    },
    fileInputName: {
        fontSize: fontSize.base,
        color: "#6b7280",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    bulkUploadBtn: {
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "10px 20px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        whiteSpace: "nowrap",
    },
    resultsSection: { borderTop: "1px solid #f0f0f0", padding: "20px 28px 28px" },
    resultsSummary: { marginBottom: 12 },
    resultsSummaryText: { fontSize: fontSize.md, color: "#17181C" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 260,
        overflowY: "auto",
    },
    resultRow: {
        border: "1px solid #f0f0f0",
        borderRadius: radius.sm,
        padding: "10px 14px",
        background: "#fafafa",
    },
    resultRowMain: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    resultEmail: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        color: "#17181C",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    statusPill: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.xl,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    statusPillSuccess: { background: "#dcfce7", color: "#15803d" },
    statusPillFail: { background: "#fee2e2", color: "#dc2626" },
    resultMessage: { margin: "4px 0 0", fontSize: fontSize.sm, color: "#9ca3af" },
    passwordRegisterRowMobile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
    },
    passwordRowMobile: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
    },
    registerButtonMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "linear-gradient(135deg, #2BAADD, #2A2F8F)",
        color: "#fff",
        border: "none",
        borderRadius: radius["2xl"],
        padding: "12px 28px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(42,47,143,0.3)",
        whiteSpace: "nowrap",
    },
    mobileHeaderBtnGroup: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
    },
    templateBtnMobile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
        color: "#2A2F8F",
        border: "1px solid #C7D9F0",
        borderRadius: radius.circle,
        width: 30,
        height: 30,
        cursor: "pointer",
        flexShrink: 0,
    },
};
