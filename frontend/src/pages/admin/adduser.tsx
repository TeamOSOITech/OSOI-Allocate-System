import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import Sidebar from "../../components/sidebar";


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
        const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";

        let pass = "";

        for (let i = 0; i < 10; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        setFormData({
            ...formData,
            password: pass,
        });
    };

    const copyPassword = () => {
        navigator.clipboard.writeText(formData.password);
        alert("Password copied!");
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

            if (!response.ok) {
                throw new Error(data?.message || "Bulk upload failed");
            }

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
        if (
            !formData.fullName ||
            !formData.email ||
            !formData.role ||
            !formData.password
        ) {
            setError(
                "Full name, email, role and password are required."
            );
            return;
        }

        setError("");
        setIsSubmitting(true);

        const trimmedName = formData.fullName.trim();
        const firstSpaceIndex = trimmedName.indexOf(" ");
        const firstName = firstSpaceIndex === -1 ? trimmedName : trimmedName.slice(0, firstSpaceIndex);
        const lastName = firstSpaceIndex === -1 ? "" : trimmedName.slice(firstSpaceIndex + 1).trim();

        try {
            const response = await fetch(
                `${import.meta.env.VITE_API_URL}/api/users/add-user`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        ...formData,
                        firstName,
                        lastName,
                    }),
                }
            );

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.message || "Failed to create user");
            }

            setShowSuccess(true);
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

    return (
        <div
            style={isMobile ? styles.rootMobile : styles.root}
        >
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
                    <button
                        style={styles.bulkHeaderBtnMobile}
                        onClick={() => setShowBulkModal(true)}
                        type="button"
                    >
                        Bulk Add
                    </button>
                </div>
            )}

            {isMobile ? (
                <>
                    {sidebarOpen && (
                        <div
                            style={styles.overlay}
                            onClick={() => setSidebarOpen(false)}
                        />
                    )}

                    <div
                        style={{
                            ...styles.sidebarDrawer,
                            transform: sidebarOpen
                                ? "translateX(0)"
                                : "translateX(-100%)",
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
                        <div style={styles.header}>
                            <h2 style={styles.heading}>Add New User</h2>
                            <button
                                style={styles.bulkHeaderBtn}
                                onClick={() => setShowBulkModal(true)}
                                type="button"
                            >
                                Bulk Add Users
                            </button>
                        </div>
                    )}

                    <div style={isMobile ? styles.cardMobile : styles.card}>
                        <div style={isMobile ? styles.gridMobile : styles.grid}>
                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Select User Name</label>
                                <select style={isMobile ? styles.inputMobile : styles.input}>
                                    <option>Search User Name</option>
                                </select>
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Full Name</label>
                                <input
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.fullName}
                                    onChange={(e) =>
                                        setFormData({ ...formData, fullName: e.target.value })
                                    }
                                    placeholder="e.g. John Doe"
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Email</label>
                                <input
                                    type="email"
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.email}
                                    onChange={(e) =>
                                        setFormData({ ...formData, email: e.target.value })
                                    }
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Employee ID</label>
                                <input
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.employeeId}
                                    onChange={(e) =>
                                        setFormData({ ...formData, employeeId: e.target.value })
                                    }
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Designation</label>
                                <input
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.designation}
                                    onChange={(e) =>
                                        setFormData({ ...formData, designation: e.target.value })
                                    }
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Department</label>
                                <select
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.department}
                                    onChange={(e) =>
                                        setFormData({ ...formData, department: e.target.value })
                                    }
                                >
                                    <option value="">Select Department</option>
                                </select>
                            </div>

                            <div>
                                <label
                                    style={
                                        isMobile
                                            ? styles.labelMobile
                                            : styles.label
                                    }
                                >
                                    Role
                                </label>

                                <select
                                    style={
                                        isMobile
                                            ? styles.inputMobile
                                            : styles.input
                                    }
                                    value={formData.role}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            role: e.target.value
                                        })
                                    }
                                >
                                    <option value="">Select Role</option>
                                    <option value="ADMIN">Admin</option>
                                    <option value="MANAGER">Manager</option>
                                    <option value="EMPLOYEE">Employee</option>
                                </select>
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Date of Birth</label>
                                <input
                                    type="date"
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.dob}
                                    onChange={(e) =>
                                        setFormData({ ...formData, dob: e.target.value })
                                    }
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Date of Joining</label>
                                <input
                                    type="date"
                                    style={isMobile ? styles.inputMobile : styles.input}
                                    value={formData.doj}
                                    onChange={(e) =>
                                        setFormData({ ...formData, doj: e.target.value })
                                    }
                                />
                            </div>

                            <div>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Reporting Manager</label>
                                <select
                                    style={isMobile ? styles.inputMobile : styles.input}
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

                                {!isMobile && <p style={styles.note}>* Please enter Email only</p>}
                            </div>

                            {isMobile && (
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <p style={styles.note}>* Please enter Email only</p>
                                </div>
                            )}

                            <div style={isMobile ? { gridColumn: "1 / -1" } : undefined}>
                                <label style={isMobile ? styles.labelMobile : styles.label}>
                                    Password
                                </label>

                                <div style={styles.passwordRow}>
                                    <input
                                        type="text"
                                        style={{
                                            ...(isMobile ? styles.inputMobile : styles.input),
                                            flex: 1,
                                            minWidth: 0,
                                        }}
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
                                        style={styles.passwordActionBtn}
                                        onClick={generatePassword}
                                        type="button"
                                    >
                                        Generate
                                    </button>

                                    <button
                                        style={styles.passwordActionBtn}
                                        onClick={copyPassword}
                                        type="button"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>

                            <div style={isMobile ? { gridColumn: "1 / -1" } : undefined}>
                                <label style={isMobile ? styles.labelMobile : styles.label}>Worked In Teams</label>
                                <select
                                    style={isMobile ? styles.inputMobile : styles.input}
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
                        </div>

                        {error && <p style={styles.error}>{error}</p>}

                        <div style={isMobile ? styles.footerMobile : styles.footer}>
                            <button
                                style={{
                                    ...(isMobile ? styles.registerButtonMobile : styles.registerButton),
                                    opacity: isSubmitting ? 0.7 : 1,
                                    cursor: isSubmitting ? "not-allowed" : "pointer",
                                }}
                                onClick={handleRegister}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? "Saving..." : "Register"}
                            </button>
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
                            <div>
                                <h3 style={styles.bulkModalTitle}>Bulk Add Users</h3>
                                <p style={styles.bulkModalSubtitle}>Upload an Excel file to create multiple accounts at once</p>
                            </div>
                            <button style={styles.closeBtn} onClick={closeBulkModal} type="button" aria-label="Close">
                                ✕
                            </button>
                        </div>

                        <div style={styles.bulkInfoBox}>
                            <span style={styles.bulkInfoLabel}>Required columns</span>
                            <p style={styles.bulkInfoText}>
                                Full Name, Email, Password, Role (ADMIN / MANAGER / EMPLOYEE)
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
                                        <strong>{bulkResults.filter(r => r.success).length}</strong> created
                                        {bulkResults.some(r => !r.success) && (
                                            <> · <strong style={{ color: "#dc2626" }}>{bulkResults.filter(r => !r.success).length}</strong> failed</>
                                        )}
                                    </span>
                                </div>

                                <div style={styles.resultsList}>
                                    {bulkResults.map((r, i) => (
                                        <div key={i} style={styles.resultRow}>
                                            <div style={styles.resultRowMain}>
                                                <span style={styles.resultEmail}>{r.email}</span>
                                                <span
                                                    style={{
                                                        ...styles.statusPill,
                                                        ...(r.success ? styles.statusPillSuccess : styles.statusPillFail),
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
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        width: "100%",
        flex: 1,
        minHeight: 0,
        background: "#ececec",
        fontFamily: "'Segoe UI', sans-serif",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "#ececec",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
    },

    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "2px solid #d92f3b",
        position: "sticky",
        top: 0,
        zIndex: 30,
    },
    hamburgerBtn: {
        border: "none",
        background: "transparent",
        fontSize: "20px",
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: "16px", fontWeight: 700, color: "#1a1a2e" },
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
    contentColMobile: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
    },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "20px",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
    },

    header: {
        background: "#fff",
        borderRadius: 10,
        borderBottom: "2px solid #d92f3b",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        boxShadow: "0 2px 8px rgba(0,0,0,.08)",
    },

    heading: {
        margin: 0,
        fontSize: 34,
        fontWeight: 700,
    },

    bulkHeaderBtn: {
        background: "#df3740",
        color: "#fff",
        border: "none",
        borderRadius: 30,
        padding: "12px 28px",
        fontSize: 15,
        fontWeight: 700,
        cursor: "pointer",
    },
    bulkHeaderBtnMobile: {
        background: "#df3740",
        color: "#fff",
        border: "none",
        borderRadius: 20,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    card: {
        background: "#fff",
        borderRadius: 10,
        padding: 30,
        boxShadow: "0 2px 8px rgba(0,0,0,.08)",
    },
    cardMobile: {
        background: "#fff",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,.08)",
    },

    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "28px 40px",
    },
    gridMobile: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "12px 10px",
    },

    label: {
        display: "block",
        marginBottom: 8,
        color: "#1c1975",
        fontSize: 16,
    },
    labelMobile: {
        display: "block",
        marginBottom: 4,
        color: "#1c1975",
        fontSize: 13,
    },

    input: {
        width: "100%",
        padding: "12px",
        background: "#f5f5f5",
        border: "1px solid #ddd",
        outline: "none",
        fontSize: 15,
        borderRadius: 4,
        boxSizing: "border-box",
    },
    inputMobile: {
        width: "100%",
        padding: "8px 10px",
        background: "#f5f5f5",
        border: "1px solid #ddd",
        outline: "none",
        fontSize: 13,
        borderRadius: 4,
        boxSizing: "border-box",
    },

    passwordRow: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        width: "100%",
    },
    passwordActionBtn: {
        padding: "8px 10px",
        border: "1px solid #ccc",
        background: "#fff",
        cursor: "pointer",
        borderRadius: 4,
        fontSize: 12,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },

    note: {
        color: "#d40000",
        marginTop: 8,
        fontWeight: 600,
        fontSize: 13,
    },

    error: {
        color: "#d40000",
        marginTop: 20,
        fontWeight: 600,
    },

    smallButton: {
        padding: "10px 18px",
        border: "1px solid #ccc",
        background: "#fff",
        cursor: "pointer",
        borderRadius: 4,
    },
    smallButtonMobile: {
        padding: "12px 16px",
        border: "1px solid #ccc",
        background: "#fff",
        cursor: "pointer",
        borderRadius: 4,
        flex: "1 1 0",
        fontSize: 14,
        textAlign: "center",
    },

    footer: {
        display: "flex",
        justifyContent: "flex-end",
        marginTop: 40,
    },
    footerMobile: {
        display: "flex",
        marginTop: 24,
    },

    registerButton: {
        background: "#df3740",
        color: "#fff",
        border: "none",
        borderRadius: 30,
        padding: "14px 80px",
        fontSize: 18,
        fontWeight: 700,
        cursor: "pointer",
    },
    registerButtonMobile: {
        background: "#df3740",
        color: "#fff",
        border: "none",
        borderRadius: 30,
        padding: "14px 0",
        fontSize: 16,
        fontWeight: 700,
        cursor: "pointer",
        width: "100%",
    },

    successModal: {
        background: "#fff",
        borderRadius: 12,
        padding: "32px",
        width: 360,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    },
    successIcon: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#e6f9ec",
        color: "#15803d",
        fontSize: 28,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 16px",
    },
    successTitle: {
        margin: "0 0 8px",
        fontSize: 18,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    successText: {
        margin: "0 0 24px",
        fontSize: 14,
        color: "#6b7280",
    },
    successBtn: {
        background: "linear-gradient(135deg, #e53935, #c62828)",
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
        padding: "0",
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
        fontSize: 20,
        fontWeight: 700,
        color: "#1c1975",
    },
    bulkModalSubtitle: {
        margin: "4px 0 0",
        fontSize: 13,
        color: "#9ca3af",
    },
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
        background: "#fdf2f2",
        borderLeft: "3px solid #df3740",
        borderRadius: 6,
    },
    bulkInfoLabel: {
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#df3740",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        marginBottom: 4,
    },
    bulkInfoText: {
        margin: 0,
        fontSize: 13,
        color: "#6b7280",
        lineHeight: 1.6,
    },

    bulkUploadRow: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px",
        margin: "0 28px 24px",
    },
    fileInputWrapper: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
        flex: 1,
        minWidth: 200,
        background: "#fafafa",
    },
    fileInputHidden: {
        display: "none",
    },
    fileInputButton: {
        background: "#1c1975",
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
        background: "#df3740",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
    },

    resultsSection: {
        borderTop: "1px solid #f0f0f0",
        padding: "20px 28px 28px",
    },
    resultsSummary: {
        marginBottom: 12,
    },
    resultsSummaryText: {
        fontSize: 14,
        color: "#1a1a2e",
    },
    resultsList: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
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
        gap: "10px",
    },
    resultEmail: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1a1a2e",
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
    statusPillSuccess: {
        background: "#dcfce7",
        color: "#15803d",
    },
    statusPillFail: {
        background: "#fee2e2",
        color: "#dc2626",
    },
    resultMessage: {
        margin: "4px 0 0",
        fontSize: 12,
        color: "#9ca3af",
    },
};