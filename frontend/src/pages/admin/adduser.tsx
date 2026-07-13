import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import Sidebar from "../../components/sidebar";
import VoiceAssistant from "../../components/voiceAssistant";
import { speak } from "../../utils/speak";
//import FormErrorBoundary from "../../components/FormErrorBoundary";

const MOBILE_BREAKPOINT = 768;

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

export default function AddUser() {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        employeeId: "",
        designation: "",
        department: "",
        dob: "",
        doj: "",
        reportingManager: "",
        workedInTeams: "",
        password: "",
        role: "",
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showSuccess, setShowSuccess] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkResults, setBulkResults] = useState<any[] | null>(null);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState("");

    const generatePassword = () => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";
        let pass = "";
        for (let i = 0; i < 10; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setFormData({ ...formData, password: pass });
    };

    const copyPassword = () => {
        navigator.clipboard.writeText(formData.password);
        alert("Password copied!");
    };

    const downloadTemplate = () => {
        const templateData = [
            {
                "Full Name": "John Doe",
                Email: "john.doe@example.com",
                "Employee ID": "EMP12345",
                Designation: "Senior Developer",
                Department: "Tech",
                "Date of Birth": "1995-05-10",
                "Date of Joining": "2023-01-15",
                "Reporting Manager": "manager@example.com",
                "Worked In Teams": "Tech",
                Password: "Sample@123",
                Role: "EMPLOYEE",
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

            const mappedUsers = rows.map((row) => ({
                firstName: row["First Name"] || row["Full Name"] || "",
                lastName: row["Last Name"] || "",
                email: row["Email"] || "",
                employeeId: row["Employee ID"] || "",
                designation: row["Designation"] || "",
                department: row["Department"] || "",
                dob: row["Date of Birth"] || "",
                doj: row["Date of Joining"] || "",
                reportingManager: row["Reporting Manager"] || "",
                workedInTeams: row["Worked In Teams"] || "",
                password: row["Password"] || "",
                role: (row["Role"] || "").toString().toUpperCase().trim(),
            }));

            const response = await fetch(
                `${import.meta.env.VITE_API_URL}/api/users/bulk-add-user`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ users: mappedUsers }),
                }
            );

            const data = await response.json();
            if (!response.ok) throw new Error(data?.message || "Bulk upload failed");
            setBulkResults(data.results);
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

    const handleRegister = async () => {
        if (!formData.fullName || !formData.email || !formData.role || !formData.password) {
            setError("Full name, email, role and password are required.");
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

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/users/add-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...formData, firstName, lastName }),
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
        navigate("/reportdashboard");
    };

    const handleVoiceFillForm = (data: any) => {
        const combinedFullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();

        setFormData((prev) => ({
            ...prev,
            fullName: combinedFullName || prev.fullName,
            email: data.email || prev.email,
            role: data.role || prev.role,
            password: data.password || prev.password,
            employeeId: data.employeeId || prev.employeeId,
            designation: data.designation || prev.designation,
            department: data.department || prev.department,
            dob: data.dob || prev.dob,
            doj: data.doj || prev.doj,
            reportingManager: data.reportingManager || prev.reportingManager,
            workedInTeams: data.workedInTeams || prev.workedInTeams,
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
        if (!formData.fullName || !formData.email || !formData.role || !formData.password) {
            speak("Some required fields are still missing. Please review before submitting.");
            return;
        }
        handleRegister();
    };

    return (
        <FormErrorBoundary>
            <div style={isMobile ? styles.rootMobile : styles.root}>
                {isMobile && (
                    <div style={styles.mobileTopbar}>
                        <button
                            style={styles.hamburgerBtn}
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            type="button"
                        >
                            ☰
                        </button>
                        <span style={styles.mobileTitle}>Add New User</span>
                        <div style={styles.mobileHeaderBtnGroup}>
                            <button
                                style={styles.templateBtnMobile}
                                onClick={downloadTemplate}
                                type="button"
                                aria-label="Download Excel Format"
                            >
                                <i className="ti ti-file-spreadsheet" style={{ fontSize: 14 }} />
                            </button>
                            <button
                                style={styles.bulkHeaderBtnMobile}
                                onClick={() => setShowBulkModal(true)}
                                type="button"
                            >
                                Bulk Add
                            </button>
                        </div>
                    </div>
                )}

                {isMobile ? (
                    <>
                        {sidebarOpen && (
                            <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
                        )}
                        <div
                            style={{
                                ...styles.sidebarDrawer,
                                transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                            }}
                        >
                            <Sidebar />
                        </div>
                    </>
                ) : (
                    <Sidebar />
                )}

                <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                    <div style={styles.contentBody}>
                        {!isMobile && (
                            <div style={styles.pageHeaderRow}>
                                <div style={styles.pageTitleBlock}>
                                    <h2 style={styles.pageTitle}>Add New User</h2>
                                    <p style={styles.pageSubtitle}>
                                        Create a new employee account and assign role & permissions
                                    </p>
                                </div>
                                <div style={styles.headerButtonGroup}>
                                    <button
                                        style={styles.templateBtn}
                                        onClick={downloadTemplate}
                                        type="button"
                                    >
                                        <i
                                            className="ti ti-file-spreadsheet"
                                            style={{ fontSize: 14 }}
                                        />
                                        Excel Format
                                    </button>
                                    <button
                                        style={styles.bulkBtn}
                                        onClick={() => setShowBulkModal(true)}
                                        type="button"
                                    >
                                        <i className="ti ti-upload" style={{ fontSize: 14 }} />
                                        Bulk Add Users
                                    </button>
                                </div>
                            </div>
                        )}

                        <div style={styles.formCard}>
                            {/* Section: Personal Information */}
                            <div style={styles.sectionHeader}>
                                <i
                                    className="ti ti-user"
                                    style={{ fontSize: 15, color: "#7c3aed" }}
                                />
                                <span style={styles.sectionHeaderText}>Personal Information</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <div style={isMobile ? styles.gridMobile : styles.grid}>
                                    <div>
                                        <label style={styles.label}>Select User Name</label>
                                        <select style={styles.input}>
                                            <option>Search User Name</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={styles.label}>Full Name</label>
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
                                        <label style={styles.label}>Email</label>
                                        <input
                                            type="email"
                                            style={styles.input}
                                            value={formData.email}
                                            onChange={(e) =>
                                                setFormData({ ...formData, email: e.target.value })
                                            }
                                            placeholder="e.g. john.doe@email.com"
                                        />
                                    </div>
                                    <div>
                                        <label style={styles.label}>Employee ID</label>
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
                                        <label style={styles.label}>Designation</label>
                                        <input
                                            style={styles.input}
                                            value={formData.designation}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    designation: e.target.value,
                                                })
                                            }
                                            placeholder="e.g. Senior Developer"
                                        />
                                    </div>
                                    <div>
                                        <label style={styles.label}>Department</label>
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
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Organization Details */}
                            <div style={styles.sectionHeader}>
                                <i
                                    className="ti ti-building"
                                    style={{ fontSize: 15, color: "#7c3aed" }}
                                />
                                <span style={styles.sectionHeaderText}>Organization Details</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <div style={isMobile ? styles.gridMobile : styles.grid}>
                                    <div>
                                        <label style={styles.label}>Role</label>
                                        <select
                                            style={styles.input}
                                            value={formData.role}
                                            onChange={(e) =>
                                                setFormData({ ...formData, role: e.target.value })
                                            }
                                        >
                                            <option value="">Select Role</option>
                                            <option value="ADMIN">Admin</option>
                                            <option value="MANAGER">Manager</option>
                                            <option value="EMPLOYEE">Employee</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={styles.label}>Reporting Manager</label>
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
                                            <option value="">Select Manager</option>
                                            <option value="Joyce">joyce@gmail.com</option>
                                            <option value="SPRAINT">spraint@gmail.com</option>
                                        </select>
                                        <p style={styles.note}>* Please enter Email only</p>
                                    </div>
                                    <div>
                                        <label style={styles.label}>Worked In Teams</label>
                                        <select
                                            style={styles.input}
                                            value={formData.workedInTeams}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    workedInTeams: e.target.value,
                                                })
                                            }
                                        >
                                            <option value="">Search User Name</option>
                                            <option value="Tech">Tech</option>
                                            <option value="Legal">Legal</option>
                                            <option value="SD">SD</option>
                                            <option value="HR & Admin">HR & Admin</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={styles.label}>Date of Birth</label>
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
                                        <label style={styles.label}>Date of Joining</label>
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
                                    style={{ fontSize: 15, color: "#7c3aed" }}
                                />
                                <span style={styles.sectionHeaderText}>Security</span>
                            </div>
                            <div style={styles.sectionBody}>
                                <label style={styles.label}>Password</label>
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
                                            placeholder="Enter password or generate"
                                        />
                                        <button
                                            style={styles.generateBtn}
                                            onClick={generatePassword}
                                            type="button"
                                        >
                                            <i className="ti ti-refresh" style={{ fontSize: 13 }} />
                                            Generate
                                        </button>
                                        <button
                                            style={styles.copyBtn}
                                            onClick={copyPassword}
                                            type="button"
                                        >
                                            <i className="ti ti-copy" style={{ fontSize: 13 }} />
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
                                        <i className="ti ti-user-plus" style={{ fontSize: 15 }} />
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
                                    Full Name, Email, Employee ID, Designation, Department, Date of
                                    Birth, Date of Joining, Reporting Manager, Worked In Teams,
                                    Password, Role (ADMIN / MANAGER / EMPLOYEE)
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
        background: "#f5f3ff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflowX: "hidden",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "#f5f3ff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
        fontSize: "20px",
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: "16px", fontWeight: 700, color: "#1e1b3a" },
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
    pageTitle: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1e1b3a" },
    pageSubtitle: { margin: "4px 0 0", fontSize: 13, color: "#9c96b8" },

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
        color: "#6d28d9",
        border: "1px solid #ddd6fe",
        borderRadius: 24,
        padding: "11px 20px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
    },
    bulkBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 24,
        padding: "11px 22px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
    },
    bulkHeaderBtnMobile: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 20,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    formCard: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: 20,
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
        background: "#faf8ff",
        borderBottom: "1px solid #f0ecff",
    },
    sectionHeaderText: { fontSize: 13, fontWeight: 700, color: "#6d28d9" },
    sectionBody: { padding: "16px 24px" },

    grid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "18px 24px" },
    gridMobile: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "12px",
    },

    label: { display: "block", marginBottom: 6, color: "#4b4560", fontSize: 12, fontWeight: 600 },
    input: {
        width: "100%",
        padding: "10px 12px",
        background: "#fafafa",
        border: "1px solid #ececf5",
        outline: "none",
        fontSize: 13,
        borderRadius: 8,
        boxSizing: "border-box",
        color: "#1e1b3a",
    },
    note: { color: "#f59e0b", marginTop: 6, fontWeight: 600, fontSize: 11 },

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
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "10px 16px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    copyBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        color: "#6d28d9",
        border: "1px solid #ddd6fe",
        borderRadius: 8,
        padding: "10px 16px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    error: { color: "#dc2626", margin: "16px 0 0", fontWeight: 600, fontSize: 13 },

    registerButton: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 24,
        padding: "12px 26px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
        whiteSpace: "nowrap",
        flexShrink: 0,
    },

    successModal: {
        background: "#fff",
        borderRadius: 16,
        padding: 32,
        width: 360,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    },
    successIcon: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#ede9fe",
        color: "#6d28d9",
        fontSize: 28,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 16px",
    },
    successTitle: { margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#1e1b3a" },
    successText: { margin: "0 0 24px", fontSize: 14, color: "#9c96b8" },
    successBtn: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "10px 32px",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
    },

    bulkModal: {
        background: "#fff",
        borderRadius: 16,
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
    bulkModalTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: "#6d28d9" },
    bulkModalSubtitle: { margin: "4px 0 0", fontSize: 13, color: "#9c96b8" },
    closeBtn: {
        position: "absolute",
        top: 20,
        right: 24,
        border: "none",
        background: "#f3f4f6",
        borderRadius: "50%",
        width: 28,
        height: 28,
        fontSize: 14,
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    bulkInfoBox: {
        margin: "20px 28px",
        padding: "14px 16px",
        background: "#faf5ff",
        borderLeft: "3px solid #8b5cf6",
        borderRadius: 6,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#6d28d9",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 4,
    },
    bulkInfoText: { margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.6 },
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
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
        flex: 1,
        minWidth: 200,
        background: "#fafafa",
    },
    fileInputHidden: { display: "none" },
    fileInputButton: {
        background: "#6d28d9",
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 12px",
        borderRadius: 6,
        whiteSpace: "nowrap",
    },
    fileInputName: {
        fontSize: 13,
        color: "#6b7280",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    bulkUploadBtn: {
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
    },
    resultsSection: { borderTop: "1px solid #f0f0f0", padding: "20px 28px 28px" },
    resultsSummary: { marginBottom: 12 },
    resultsSummaryText: { fontSize: 14, color: "#1e1b3a" },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: 260,
        overflowY: "auto",
    },
    resultRow: {
        border: "1px solid #f0f0f0",
        borderRadius: 8,
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
        fontSize: 13,
        fontWeight: 600,
        color: "#1e1b3a",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    statusPill: {
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 20,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    statusPillSuccess: { background: "#dcfce7", color: "#15803d" },
    statusPillFail: { background: "#fee2e2", color: "#dc2626" },
    resultMessage: { margin: "4px 0 0", fontSize: 12, color: "#9ca3af" },
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
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        color: "#fff",
        border: "none",
        borderRadius: 24,
        padding: "12px 28px",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(124,58,237,0.3)",
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
        color: "#6d28d9",
        border: "1px solid #ddd6fe",
        borderRadius: "50%",
        width: 30,
        height: 30,
        cursor: "pointer",
        flexShrink: 0,
    },
};
