import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

// Same brand tokens as the rest of the admin pages (employees.tsx,
// servicecases.tsx, etc.) — pulls from the CSS vars set by
// ThemeContext so white-label colors stay in sync app-wide.
const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    amber: "#D97706",
    grey: "#9CA3AF",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

interface StatCardData {
    title: string;
    today: number;
    total: number;
}

interface VerticalCase {
    name: string;
    count: number;
}

const statCards: StatCardData[] = [
    { title: "Completed Cases", today: 0, total: 0 },
    { title: "Pending Cases", today: 0, total: 0 },
    { title: "Working Hours", today: 0, total: 0 },
    { title: "No of user", today: 0, total: 0 },
];

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

export default function ReportDashboard() {
    const isMobile = useIsMobile();
    const [verticalCases, setVerticalCases] = useState<VerticalCase[]>([]);
    const [verticalsLoading, setVerticalsLoading] = useState(true);
    const [verticalsError, setVerticalsError] = useState<string | null>(null);

    const fetchVerticalCases = async () => {
        setVerticalsLoading(true);
        setVerticalsError(null);
        try {
            const timestamp = new Date().getTime();
            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/api/verticals/case-counts?t=${timestamp}`,
                {
                    method: "GET",
                    headers: { "Content-Type": "application/json" },
                }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: VerticalCase[] = await res.json();
            setVerticalCases(data);
        } catch (err: any) {
            console.error("Failed to fetch vertical case counts:", err);
            setVerticalsError(err?.message || "Failed to load data.");
        } finally {
            setVerticalsLoading(false);
        }
    };

    useEffect(() => {
        fetchVerticalCases();
    }, []);

    return (
        <div
            style={{
                ...(isMobile ? styles.rootMobile : styles.root),
                height: "100vh",
            }}
        >
            {/* Mobile hamburger topbar */}

            {/* Sidebar */}

            {/* Content */}
            <div style={isMobile ? styles.contentColMobile : styles.contentCol}>
                <div style={styles.contentBody}>
                    {/* Stats */}
                    <div style={isMobile ? styles.statsRowMobile : styles.statsRow}>
                        {statCards.map((card) => (
                            <StatCard key={card.title} {...card} />
                        ))}
                    </div>

                    {/* Main Content */}
                    <div
                        style={{
                            ...(isMobile ? styles.contentRowMobile : styles.contentRow),
                            flex: 1,
                            minHeight: 0,
                        }}
                    >
                        {/* Left Side */}
                        <div style={styles.leftCol}>
                            <div style={styles.panel}>
                                <p style={styles.panelTitle}>Billable data</p>

                                <div style={styles.chartPlaceholder}>
                                    <BillableChart />
                                </div>
                            </div>

                            <div style={styles.panel}>
                                <p style={styles.panelTitle}>Work Progress Report</p>

                                <div style={styles.chartPlaceholder}>
                                    <WorkProgressChart />
                                </div>
                            </div>
                        </div>

                        {/* Right Side */}
                        <div style={styles.rightCol}>
                            <div style={styles.tableHead}>
                                <span style={styles.tableHeadLabel}>Vertical Name</span>

                                <span style={styles.tableHeadLabel}>
                                    Total Number of Vertical Cases
                                </span>
                            </div>

                            <div style={styles.tableBody}>
                                {verticalsLoading ? (
                                    <div style={styles.emptyState}>Loading vertical data...</div>
                                ) : verticalsError ? (
                                    <div style={styles.emptyState}>{verticalsError}</div>
                                ) : verticalCases.length === 0 ? (
                                    <div style={styles.emptyState}>No vertical data found.</div>
                                ) : (
                                    verticalCases.map((v: any, index: number) => (
                                        <div key={index} style={styles.tableRow}>
                                            <span>{v.name || v.Title || "-"}</span>

                                            <span>{v.count ?? v.vertical_TotalCases ?? 0}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, today, total }: StatCardData) {
    return (
        <div style={styles.statCard}>
            <div style={styles.statHead}>{title}</div>
            <div style={styles.statBody}>
                <div style={styles.statLine}>
                    <span style={styles.statLabel}>Today</span>
                    <span style={styles.statNum}>{today}</span>
                </div>
                <div style={styles.statBar} />
                <div style={styles.statLine}>
                    <span style={styles.statLabel}>Total</span>
                    <span style={styles.statNum}>{total}</span>
                </div>
            </div>
        </div>
    );
}

const billableData = [
    { name: "Completed", value: 400 },
    { name: "Pending", value: 300 },
    { name: "In Progress", value: 200 },
    { name: "Cancelled", value: 100 },
];
const PIE_COLORS = [BRAND.green, BRAND.blue, BRAND.lightBlue, BRAND.amber];

function BillableChart() {
    return (
        <ResponsiveContainer width="100%" height={180}>
            <PieChart>
                <Pie
                    data={billableData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={3}
                    dataKey="value"
                >
                    {billableData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: "11px" }} />
            </PieChart>
        </ResponsiveContainer>
    );
}

const workProgressData = [
    { name: "Done", value: 540 },
    { name: "In Review", value: 220 },
    { name: "In Progress", value: 310 },
    { name: "Not Started", value: 130 },
];
const WORK_COLORS = [BRAND.green, BRAND.blue, BRAND.amber, BRAND.grey];

function WorkProgressChart() {
    return (
        <ResponsiveContainer width="100%" height={180}>
            <PieChart>
                <Pie
                    data={workProgressData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={3}
                    dataKey="value"
                >
                    {workProgressData.map((_, index) => (
                        <Cell
                            key={`cell-${index}`}
                            fill={WORK_COLORS[index % WORK_COLORS.length]}
                        />
                    ))}
                </Pie>
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: "11px" }} />
            </PieChart>
        </ResponsiveContainer>
    );
}

const styles: Record<string, CSSProperties> = {
    root: {
        display: "flex",
        width: "100%",
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        background: "#f4f7fb",
        fontFamily: fontFamily.base,
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        width: "100%",
        background: "#f4f7fb",
        fontFamily: fontFamily.base,
        position: "relative",
    },
    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "1px solid #e4e9f2",
        position: "sticky",
        top: 0,
        zIndex: 30,
    },
    hamburgerBtn: {
        border: "none",
        background: "transparent",
        fontSize: fontSize.xl,
        cursor: "pointer",
        padding: 4,
    },
    mobileTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: "#16233a" },
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 },
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
        minHeight: "100vh",
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
        gap: "16px",
        padding: "24px 28px",
        flex: 1,
        minHeight: 0,
        boxSizing: "border-box",
    },

    statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" },
    statsRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    statCard: {
        background: "#fff",
        borderRadius: radius.lg,
        overflow: "hidden",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
    },
    statHead: {
        background: GRADIENT,
        color: "#fff",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        textAlign: "center",
        padding: "8px",
        letterSpacing: "0.02em",
    },
    statBody: { padding: "12px 16px" },
    statLine: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "6px",
    },
    statLabel: { fontSize: fontSize.xs, color: BRAND.blue, fontWeight: fontWeight.medium },
    statNum: { fontSize: fontSize["5xl"], fontWeight: fontWeight.bold, color: "#16233a" },
    statBar: { height: "3px", background: "#eef1f7", borderRadius: "2px", margin: "4px 0 8px" },
    contentRow: {
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr",
        gap: "16px",
        flex: 1,
        minHeight: 0,
        alignItems: "stretch",
    },
    contentRowMobile: { display: "flex", flexDirection: "column", gap: "14px" },
    leftCol: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        flex: 1,
        height: "100%",
    },
    panel: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px 18px",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
    },
    panelTitle: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#16233a",
        textAlign: "center",
        margin: "0 0 8px",
    },
    chartPlaceholder: {
        flex: 1,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
    },
    emptyState: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#7d90a6",
        fontSize: fontSize.sm,
        padding: "24px",
        minHeight: 140,
    },
    rightCol: {
        background: "#fff",
        borderRadius: radius.lg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
    },
    tableHead: {
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 18px",
        borderBottom: "1px solid #e4e9f2",
        background: "#F4F8FD",
        gap: "12px",
    },
    tableHeadLabel: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    tableBody: {
        flex: 1,
        overflowY: "auto",
    },
    tableRow: {
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 18px",
        borderBottom: "1px solid #f1f1f1",
        fontSize: fontSize.base,
        color: "#374151",
    },
};
