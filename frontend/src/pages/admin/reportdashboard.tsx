import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

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
const PIE_COLORS = ["#e24b4a", "#2b2b3d", "#185fa5", "#f4a93c"];

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
const WORK_COLORS = ["#3B6D11", "#185fa5", "#f4a93c", "#9ca3af"];

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
        background: "#f5f3ff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    rootMobile: {
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        width: "100%",
        background: "#ececec",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
    },
    mobileTopbar: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
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
    mobileTitle: { fontSize: "15px", fontWeight: 700, color: "#1a1a2e" },
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
        gap: "14px",
        padding: "16px",
        flex: 1,
        minHeight: 0,
    },

    statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" },
    statsRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    statCard: { background: "#fff", borderRadius: "8px", overflow: "hidden" },
    statHead: {
        background: "#2b2b3d",
        color: "#fff",
        fontSize: "11px",
        fontWeight: 500,
        textAlign: "center",
        padding: "7px",
    },
    statBody: { padding: "10px 14px" },
    statLine: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "6px",
    },
    statLabel: { fontSize: "11px", color: "#185fa5", fontWeight: 500 },
    statNum: { fontSize: "20px", fontWeight: 700, color: "#1a1a2e" },
    statBar: { height: "3px", background: "#e24b4a", borderRadius: "2px", margin: "4px 0 8px" },
    contentRow: {
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr",
        gap: "14px",
        flex: 1,
        minHeight: 0,
        alignItems: "stretch",
    },
    contentRowMobile: { display: "flex", flexDirection: "column", gap: "14px" },
    leftCol: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        flex: 1,
        height: "100%",
    },
    panel: {
        background: "#fff",
        borderRadius: "8px",
        padding: "14px 16px",
        flex: 1,
        display: "flex",
        flexDirection: "column",
    },
    panelTitle: {
        fontSize: "13px",
        fontWeight: 600,
        color: "#1a1a2e",
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
        color: "#999",
        fontSize: "12px",
        padding: "24px",
        minHeight: 140,
    },
    rightCol: {
        background: "#fff",
        borderRadius: "8px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
    },
    tableHead: {
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "2px solid #e24b4a",
        background: "#f3f3f3",
        gap: "12px",
    },
    tableHeadLabel: { fontSize: "12px", fontWeight: 600, color: "#a32d2d" },
    tableBody: {
        flex: 1,
        overflowY: "auto",
    },
    tableRow: {
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid #f1f1f1",
        fontSize: "13px",
        color: "#374151",
    },
};
