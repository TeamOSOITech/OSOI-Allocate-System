// src/pages/admin/billing.tsx
//
// Billing — Admin-only overview of every Client and the rates (per
// service) they're being charged. Reuses GET /api/clients as-is: each
// client row already comes back with `products` — every service linked
// to that client via the client_products junction table, each carrying
// its own `amount`/`currency` (see products.service.js's
// getProductsForClient / clients.controller.js's toClientResponse).
//
// This page is READ-ONLY. To actually change a client's services or
// rates, that still happens on the Clients page's Edit modal — this is
// just a clean, billing-focused view across every client at once
// (search, KPI totals, one card per client with a Service/Price table).

import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { authFetch } from "../../utils/authFetch";
import { fontSize, fontWeight, radius } from "../../styles/theme";

const API_BASE = import.meta.env.VITE_API_URL;
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

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    grey: "#9CA3AF",
    amber: "#F59E0B",
};
const GRADIENT = `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`;

type ClientProduct = {
    id: number;
    product_name: string;
    amount: number | string | null;
    currency: string | null;
};

type ClientRow = {
    id: number;
    name: string;
    country: string | null;
    status: "Active" | "Inactive";
    subclients: number;
    products?: ClientProduct[];
};

function formatMoney(amount: number | string | null, currency: string | null): string {
    if (amount === null || amount === undefined || amount === "") return "—";
    const num = Number(amount);
    if (Number.isNaN(num)) return "—";
    const symbol =
        { USD: "$", GBP: "£", EUR: "€", INR: "₹", AUD: "A$", CAD: "C$" }[currency || "USD"] ||
        `${currency || ""} `;
    return `${symbol}${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function Billing() {
    const isMobile = useIsMobile();
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError("");
            try {
                const res = await authFetch(`${API_BASE}/api/clients`);
                const json = await res.json();
                if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
                if (!cancelled) setClients(Array.isArray(json) ? json : json.data || []);
            } catch (err: any) {
                if (!cancelled) setError(err?.message || "Failed to load billing data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return clients;
        return clients.filter(
            (c) =>
                c.name.toLowerCase().includes(term) ||
                (c.products || []).some((p) => p.product_name.toLowerCase().includes(term))
        );
    }, [clients, search]);

    // ---- KPI summary across every client ----
    const kpis = useMemo(() => {
        const totalClients = clients.length;
        let pricedServiceLinks = 0;
        let unpricedServiceLinks = 0;
        const currencyTotals: Record<string, number> = {};

        clients.forEach((c) => {
            (c.products || []).forEach((p) => {
                const num = Number(p.amount);
                if (
                    p.amount !== null &&
                    p.amount !== undefined &&
                    p.amount !== "" &&
                    !Number.isNaN(num)
                ) {
                    pricedServiceLinks += 1;
                    const cur = p.currency || "USD";
                    currencyTotals[cur] = (currencyTotals[cur] || 0) + num;
                } else {
                    unpricedServiceLinks += 1;
                }
            });
        });

        return { totalClients, pricedServiceLinks, unpricedServiceLinks, currencyTotals };
    }, [clients]);

    return (
        <div style={styles.root}>
            <div style={styles.topBar} />
            <div
                style={{
                    ...styles.contentBody,
                    padding: isMobile ? "16px" : "20px 24px",
                }}
            >
                <div>
                    <h1
                        style={{
                            ...styles.pageTitle,
                            fontSize: isMobile ? fontSize["3xl"] : fontSize["5xl"],
                        }}
                    >
                        Billing
                    </h1>
                    <p style={styles.headerSubtext}>
                        Every client, the services they're linked to, and the rate charged for each
                        — pulled straight from each client's Services setup.
                    </p>
                </div>

                {/* ---- KPI cards ---- */}
                <div style={styles.kpiRow}>
                    <div style={styles.kpiCard}>
                        <div
                            style={{ ...styles.kpiIconCircle, background: "rgba(59,130,246,0.1)" }}
                        >
                            <i className="ti ti-building-store" style={{ color: "#3B82F6" }} />
                        </div>
                        <div>
                            <div style={styles.kpiValue}>{loading ? "…" : kpis.totalClients}</div>
                            <div style={styles.kpiLabel}>Total Clients</div>
                        </div>
                    </div>
                    <div style={styles.kpiCard}>
                        <div
                            style={{ ...styles.kpiIconCircle, background: "rgba(46,187,168,0.12)" }}
                        >
                            <i className="ti ti-receipt-2" style={{ color: BRAND.green }} />
                        </div>
                        <div>
                            <div style={styles.kpiValue}>
                                {loading ? "…" : kpis.pricedServiceLinks}
                            </div>
                            <div style={styles.kpiLabel}>Priced Services</div>
                        </div>
                    </div>
                    <div style={styles.kpiCard}>
                        <div
                            style={{ ...styles.kpiIconCircle, background: "rgba(245,158,11,0.1)" }}
                        >
                            <i className="ti ti-alert-triangle" style={{ color: BRAND.amber }} />
                        </div>
                        <div>
                            <div style={styles.kpiValue}>
                                {loading ? "…" : kpis.unpricedServiceLinks}
                            </div>
                            <div style={styles.kpiLabel}>Missing a Price</div>
                        </div>
                    </div>
                    {Object.entries(kpis.currencyTotals).map(([cur, total]) => (
                        <div style={styles.kpiCard} key={cur}>
                            <div
                                style={{
                                    ...styles.kpiIconCircle,
                                    background: "rgba(139,92,246,0.1)",
                                }}
                            >
                                <i className="ti ti-coin" style={{ color: "#8B5CF6" }} />
                            </div>
                            <div>
                                <div style={styles.kpiValue}>{formatMoney(total, cur)}</div>
                                <div style={styles.kpiLabel}>Total Rate Value ({cur})</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ---- Search ---- */}
                <div style={styles.searchBar}>
                    <i className="ti ti-search" style={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="Search by client or service name…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={styles.searchInput}
                    />
                </div>

                {error && <p style={styles.errorText}>{error}</p>}

                {loading && (
                    <div style={styles.placeholderCard}>
                        <p style={styles.placeholderText}>Loading billing data…</p>
                    </div>
                )}

                {!loading && !error && filteredClients.length === 0 && (
                    <div style={styles.placeholderCard}>
                        <div style={styles.placeholderIconCircle}>
                            <i
                                className="ti ti-file-invoice"
                                style={{ fontSize: fontSize["6xl"], color: BRAND.blue }}
                            />
                        </div>
                        <p style={styles.placeholderTitle}>
                            {search ? "No matching clients" : "No clients yet"}
                        </p>
                        <p style={styles.placeholderText}>
                            {search
                                ? "Try a different client or service name."
                                : "Add a client and link services to see billing rates here."}
                        </p>
                    </div>
                )}

                {!loading &&
                    filteredClients.map((client) => {
                        const products = client.products || [];
                        return (
                            <div key={client.id} style={styles.clientCard}>
                                <div style={styles.clientCardHeader}>
                                    <div style={styles.clientCardHeaderLeft}>
                                        <div style={styles.clientAvatar}>
                                            <i className="ti ti-building-store" />
                                        </div>
                                        <div>
                                            <div style={styles.clientName}>{client.name}</div>
                                            <div style={styles.clientSub}>
                                                {client.country || "—"} · {client.subclients || 0}{" "}
                                                subclient
                                                {client.subclients === 1 ? "" : "s"}
                                            </div>
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            ...styles.statusPill,
                                            background:
                                                client.status === "Active"
                                                    ? "rgba(46,187,168,0.12)"
                                                    : "rgba(220,38,38,0.08)",
                                            color:
                                                client.status === "Active"
                                                    ? BRAND.green
                                                    : BRAND.red,
                                        }}
                                    >
                                        <i
                                            className={`ti ${client.status === "Active" ? "ti-circle-check" : "ti-circle-x"}`}
                                        />
                                        {client.status}
                                    </span>
                                </div>

                                <div style={styles.cardDivider} />

                                {products.length === 0 ? (
                                    <p style={styles.noServicesText}>
                                        No services linked to this client yet.
                                    </p>
                                ) : (
                                    <div style={styles.serviceTable}>
                                        <div style={styles.serviceTableHeadRow}>
                                            <span style={styles.serviceTableHeadCell}>Service</span>
                                            <span
                                                style={{
                                                    ...styles.serviceTableHeadCell,
                                                    textAlign: "right",
                                                }}
                                            >
                                                Price
                                            </span>
                                        </div>
                                        {products.map((p) => (
                                            <div key={p.id} style={styles.serviceTableRow}>
                                                <span style={styles.serviceNameCell}>
                                                    <i
                                                        className="ti ti-cube"
                                                        style={{
                                                            color: "#14B8A6",
                                                            fontSize: fontSize.md,
                                                        }}
                                                    />
                                                    {p.product_name}
                                                </span>
                                                <span
                                                    style={{
                                                        ...styles.servicePriceCell,
                                                        color:
                                                            p.amount === null ||
                                                            p.amount === undefined ||
                                                            p.amount === ""
                                                                ? BRAND.grey
                                                                : "#17181C",
                                                    }}
                                                >
                                                    {formatMoney(p.amount, p.currency)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    root: { display: "flex", flexDirection: "column", width: "100%", flex: 1, minHeight: "100%" },
    topBar: {
        height: 4,
        background: GRADIENT,
        borderRadius: `${radius.lg}px ${radius.lg}px 0 0`,
    },
    contentBody: {
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        boxSizing: "border-box",
        flex: 1,
        minHeight: 0,
    },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.bold,
        color: "#17181C",
        textAlign: "left",
    },
    headerSubtext: {
        margin: "4px 0 0",
        fontSize: fontSize.base,
        color: "#767F92",
        maxWidth: 640,
        textAlign: "left",
    },

    kpiRow: { display: "flex", gap: 14, flexWrap: "wrap" },
    kpiCard: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: radius.lg,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "16px 18px",
        flex: "1 1 200px",
        minWidth: 200,
        boxSizing: "border-box",
    },
    kpiIconCircle: {
        width: 42,
        height: 42,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize["2xl"],
        flexShrink: 0,
    },
    kpiValue: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, color: "#17181C" },
    kpiLabel: { fontSize: fontSize.xs, color: "#9ca3af", fontWeight: fontWeight.medium },

    searchBar: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#fff",
        borderRadius: radius.md,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "11px 16px",
        maxWidth: 420,
    },
    searchIcon: { color: "#9ca3af", fontSize: fontSize.xl, flexShrink: 0 },
    searchInput: {
        border: "none",
        outline: "none",
        background: "transparent",
        fontSize: fontSize.base,
        color: "#17181C",
        width: "100%",
    },

    errorText: {
        color: BRAND.red,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        margin: 0,
    },

    placeholderCard: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "48px 20px",
        borderRadius: radius.lg,
        background: "#fff",
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        flex: 1,
        minHeight: 240,
        width: "100%",
        boxSizing: "border-box",
    },
    placeholderIconCircle: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "rgba(59,130,246,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
    placeholderTitle: {
        margin: 0,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
    },
    placeholderText: { margin: 0, fontSize: fontSize.sm, color: "#9ca3af" },

    clientCard: {
        background: "#fff",
        borderRadius: radius.lg,
        borderLeft: `4px solid ${BRAND.blue}`,
        boxShadow: "0 6px 20px rgba(0,0,0,.04)",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
        boxSizing: "border-box",
    },
    clientCardHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    clientCardHeaderLeft: { display: "flex", alignItems: "center", gap: 12 },
    clientAvatar: {
        width: 40,
        height: 40,
        borderRadius: radius.md,
        background: GRADIENT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize["2xl"],
        flexShrink: 0,
    },
    clientName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: "#17181C" },
    clientSub: { fontSize: fontSize.sm, color: "#767F92", marginTop: 2 },
    statusPill: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: radius.pill,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        height: "fit-content",
        whiteSpace: "nowrap",
    },
    cardDivider: { height: 1, background: "#f1f1f1", width: "100%" },

    noServicesText: { margin: 0, fontSize: fontSize.sm, color: "#9ca3af", fontStyle: "italic" },

    serviceTable: { display: "flex", flexDirection: "column", width: "100%" },
    serviceTableHeadRow: {
        display: "flex",
        justifyContent: "space-between",
        padding: "0 4px 8px",
        borderBottom: "1px solid #f1f1f1",
    },
    serviceTableHeadCell: {
        fontSize: fontSize.xxs,
        fontWeight: fontWeight.semibold,
        color: "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
    },
    serviceTableRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 4px",
        borderBottom: "1px solid #f7f7fb",
    },
    serviceNameCell: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        color: "#17181C",
    },
    servicePriceCell: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
};
