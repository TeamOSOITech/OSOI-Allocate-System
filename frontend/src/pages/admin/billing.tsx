// src/pages/admin/billing.tsx
//
// Billing — earnings report + invoice generator (Super Admin only).
// Styled to match dailywork.tsx / productionreport.tsx (same panels,
// gradient headers, KPI cards, client-wise cards, pills, modals).
//
// MODIFIED in this version (earning logic is unchanged):
//   - LETTERHEAD: the Generate Invoice popup now has a "Letterhead" option.
//     Upload a full-page A4 PNG/JPG; the PDF is printed on top of it (on
//     every page). Top / Bottom space (mm) keep the invoice content clear
//     of the letterhead's header / footer. The letterhead and spacing are
//     remembered in localStorage.
//   - Client-wise cards (4 per row on desktop, 2 on tablet, 1 on mobile),
//     the same layout as the Production Report. Each card shows the client's
//     TOTAL CASES together with its TOTAL AMOUNT, plus a cases · amount line
//     for every service. "View Details" opens that client's table below.
//
// HOW EARNING IS CALCULATED
//   earning = (number of billable cases) x (rate for that client + service)
//   * Rates come from GET /api/clients -> each client's `products`
//     (the client_products junction: amount + currency per service). They
//     are still edited on the Clients page's Edit modal.
//   * Cases come from GET /api/service-cases (same endpoint the Production
//     Report uses), fetched for the chosen date range with
//     submissionStatus=SUBMITTED. A case is BILLABLE only when its
//     submissionType is COMPLETED, DONE_BY_TEAM or DONE_BY_CLIENT. An
//     unresolved QUERY is not counted until someone marks it completed.
//   * A case whose client+service pair has no rate is counted separately
//     as "missing rate" and adds 0 to the earning (never guessed).
//   * Every line is shown in ITS OWN client's currency (the client's Unit).
//
// CURRENCY TOTALS
//   * If every client in the period uses the same currency, totals are
//     shown in that currency, exactly as before.
//   * If the period mixes currencies (INR, USD, ...), a "Show totals in"
//     dropdown appears. Picking a currency converts the KPI totals and the
//     service cards into it. Client cards always stay in the client's own
//     currency. The invoice PDF is NOT converted: it is still one invoice
//     per client currency.
//   * Exchange rates come from open.er-api.com (free, no key, updates once
//     a day) and are cached in localStorage for 12 hours.
//
// FLOW
//   1. Pick a date range -> the TOTAL earning for the period is shown.
//   2. Narrow it down by Service (dropdown or by clicking a service card),
//      Client, Employee or Work type -> the FILTERED earning is shown next
//      to the total.
//   3. Client cards show every client's cases + amount; "View Details"
//      opens the service-wise lines for that client.
//   4. "Generate Invoice" opens a popup with the filtered lines, where the
//      Letterhead / Bill To / From / tax / notes can be edited, and a
//      Download PDF button.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "../../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";
import { useTheme } from "../../context/themecontext";

const API_BASE = import.meta.env.VITE_API_URL;
const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1100;
const CASE_PAGE_SIZE = 5000;
const FROM_KEY = "billing.invoice.from";
// Letterhead (saved in the browser so it isn't uploaded every time)
const LH_KEY = "billing.invoice.letterhead";
const LH_TOP_KEY = "billing.invoice.letterhead.top";
const LH_BOTTOM_KEY = "billing.invoice.letterhead.bottom";
const MM = 72 / 25.4; // mm -> pt
// Services listed on a client card before "+N more".
const CARD_SERVICE_LIMIT = 4;

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

// Client cards per row: 4 on desktop, 2 on tablet, 1 on mobile.
function useCardColumns() {
    const get = () => {
        if (typeof window === "undefined") return 4;
        const w = window.innerWidth;
        if (w < MOBILE_BREAKPOINT) return 1;
        if (w < TABLET_BREAKPOINT) return 2;
        return 4;
    };
    const [cols, setCols] = useState(get);
    useEffect(() => {
        const onResize = () => setCols(get());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return cols;
}

const BRAND = {
    blue: "var(--brand-blue)",
    lightBlue: "var(--brand-light-blue)",
    green: "var(--brand-green)",
    red: "#DC2626",
    grey: "#9CA3AF",
    amber: "#F59E0B",
};
const GRADIENT = "linear-gradient(135deg, var(--brand-light-blue), var(--brand-blue))";

const HOVER_CSS = `
.bl-svc { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; cursor: pointer; }
.bl-svc:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(var(--brand-blue-rgb, 32,66,151), 0.14); }
.bl-row { transition: background .15s ease; }
.bl-row:hover { background: rgba(var(--brand-blue-rgb, 32,66,151), 0.05) !important; }
.bl-btn:focus-visible, .bl-svc:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
`;

// ---------- types ----------
type Product = { id: string | number; product_name: string };
type Employee = { id: string; name: string };
type ClientProduct = {
    id: number | string;
    product_name: string;
    amount: number | string | null;
    currency: string | null;
};
type ClientRow = {
    id: number | string;
    name: string;
    country?: string | null;
    products?: ClientProduct[];
};
type SubmissionType = "COMPLETED" | "DONE_BY_TEAM" | "DONE_BY_CLIENT" | "QUERY" | null;
type CaseRow = {
    id: string;
    caseNumber: string;
    productId: string | number;
    productName: string | null;
    clientId: string | number | null;
    clientName: string | null;
    workDate: string;
    assignedEmployeeId: string | null;
    submissionType: SubmissionType;
};

// One case with its resolved rate.
type PricedCase = {
    row: CaseRow;
    rate: number | null; // null = no rate set for this client + service
    currency: string;
};

// One line of the earnings table / invoice: same client + service.
type Group = {
    key: string;
    clientId: string;
    clientName: string;
    productId: string;
    productName: string;
    cases: number;
    rate: number | null;
    currency: string;
    amount: number; // 0 when unpriced
};

const BILLABLE: SubmissionType[] = ["COMPLETED", "DONE_BY_TEAM", "DONE_BY_CLIENT"];

// ---------- helpers ----------
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}
function firstOfMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fmtDate(iso: string) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return y && m && d ? `${d}-${m}-${y}` : iso;
}

// Screen + PDF use the same formatter so the preview matches the file.
// PDF fonts (Helvetica) can't draw the rupee sign, so INR is "Rs." and
// other currencies use their code — only USD gets a symbol.
function money(amount: number, currency: string): string {
    const cur = (currency || "USD").toUpperCase();
    const locale = cur === "INR" ? "en-IN" : "en-US";
    const num = amount.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (cur === "INR") return `Rs. ${num}`;
    if (cur === "USD") return `$${num}`;
    return `${cur} ${num}`;
}

// One line per currency (never adds different currencies together).
// Returns "—" when nothing is priced.
function formatTotals(totals: Record<string, number>, sep = "\n"): string {
    const entries = Object.entries(totals);
    if (entries.length === 0) return "—";
    return entries.map(([cur, v]) => money(v, cur)).join(sep);
}

function addTo(totals: Record<string, number>, currency: string, value: number) {
    totals[currency] = (totals[currency] || 0) + value;
}

// Same rule the Edit Client form uses to pick its "Unit" (see clients.tsx):
// a rate with no saved currency takes the client's country currency.
const COUNTRY_CURRENCY_MAP: Record<string, string> = {
    usa: "USD",
    "united states": "USD",
    "united states of america": "USD",
    us: "USD",
    uk: "GBP",
    "united kingdom": "GBP",
    britain: "GBP",
    "great britain": "GBP",
    england: "GBP",
    india: "INR",
    bharat: "INR",
    canada: "CAD",
    australia: "AUD",
    germany: "EUR",
    france: "EUR",
    spain: "EUR",
    italy: "EUR",
    netherlands: "EUR",
    ireland: "EUR",
    portugal: "EUR",
    belgium: "EUR",
    austria: "EUR",
};
function currencyForCountry(country: string | null | undefined): string {
    if (!country) return "USD";
    return COUNTRY_CURRENCY_MAP[country.trim().toLowerCase()] || "USD";
}

// ---------- currency conversion ----------
const FX_URL = "https://open.er-api.com/v6/latest/USD";
const FX_KEY = "billing.fx.rates";
const FX_TTL = 12 * 60 * 60 * 1000; // 12 hours

// rates = "1 USD = X <currency>", which is how the API returns them.
// Returns null when either currency has no known rate.
function convertAmount(
    amount: number,
    from: string,
    to: string,
    rates: Record<string, number>
): number | null {
    if (from === to) return amount;
    const a = rates[from];
    const b = rates[to];
    if (!a || !b) return null;
    return (amount / a) * b;
}

function makeInvoiceNo() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
        d.getDate()
    ).padStart(2, "0")}`;
    return `INV-${stamp}-${String(Math.floor(Math.random() * 900) + 100)}`;
}

// All SUBMITTED cases for a date range (every page).
async function loadCases(from: string, to: string): Promise<CaseRow[]> {
    const all: CaseRow[] = [];
    for (let page = 1; page <= 200; page++) {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(CASE_PAGE_SIZE));
        if (from) params.set("workDateFrom", from);
        if (to) params.set("workDateTo", to);
        params.set("submissionStatus", "SUBMITTED");
        const res = await authFetch(`${API_BASE}/api/service-cases?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
        const batch: CaseRow[] = json.data || [];
        all.push(...batch);
        if (batch.length < CASE_PAGE_SIZE) break;
    }
    return all;
}

// Same client + same service -> one line.
function groupCases(list: PricedCase[]): Group[] {
    const m = new Map<string, Group>();
    list.forEach((pc) => {
        const r = pc.row;
        const key = `${r.clientId}:${r.productId}`;
        let g = m.get(key);
        if (!g) {
            g = {
                key,
                clientId: String(r.clientId ?? ""),
                clientName: r.clientName || "No client",
                productId: String(r.productId),
                productName: r.productName || "Unknown service",
                cases: 0,
                rate: pc.rate,
                currency: pc.currency,
                amount: 0,
            };
            m.set(key, g);
        }
        g.cases += 1;
        if (pc.rate !== null) g.amount += pc.rate;
    });
    return [...m.values()].sort(
        (a, b) =>
            a.clientName.localeCompare(b.clientName) || a.productName.localeCompare(b.productName)
    );
}

// ---------- PDF ----------
type InvoiceData = {
    primary: string; // active theme colour (hex) — the PDF follows the app theme
    invoiceNo: string;
    invoiceDate: string;
    from: string;
    billTo: string;
    periodFrom: string;
    periodTo: string;
    currency: string;
    showClientCol: boolean;
    lines: Group[];
    subtotal: number;
    taxPct: number;
    tax: number;
    total: number;
    notes: string;
    letterhead: string; // data URL ("" = no letterhead)
    topMm: number; // blank space at the top, for the letterhead header
    bottomMm: number; // blank space at the bottom, for the letterhead footer
};

const DEFAULT_PDF_BLUE: [number, number, number] = [32, 66, 151];

// Theme hex -> RGB for jsPDF. Very light themes (e.g. "White") would make
// the title/header unreadable on white paper, so those fall back to the
// default dark blue.
function pdfPrimary(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) return DEFAULT_PDF_BLUE;
    const n = parseInt(m[1], 16);
    const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return luminance > 0.75 ? DEFAULT_PDF_BLUE : rgb;
}

function buildInvoicePdf(inv: InvoiceData): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;
    const BLUE = pdfPrimary(inv.primary);
    const GREY: [number, number, number] = [110, 118, 135];

    // letterhead: drawn full-page behind the content, on every page
    const useLH = !!inv.letterhead;
    const top = useLH ? inv.topMm * MM : 40;
    const bottom = useLH ? inv.bottomMm * MM : 40;
    const oy = useLH ? Math.max(0, top - 30) : 0; // content shifts down below the letterhead header

    const drawLH = () => {
        if (!useLH) return;
        try {
            const fmt = inv.letterhead.startsWith("data:image/png") ? "PNG" : "JPEG";
            doc.addImage(inv.letterhead, fmt, 0, 0, W, H, undefined, "FAST");
        } catch {
            /* bad image: skip */
        }
    };

    if (useLH) {
        drawLH();
    } else {
        // header band (only when there is no letterhead)
        doc.setFillColor(...BLUE);
        doc.rect(0, 0, W, 8, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...BLUE);
    doc.text("INVOICE", M, 58 + oy);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text("Invoice No", W - M - 150, 40 + oy);
    doc.text("Invoice Date", W - M - 150, 56 + oy);
    doc.text("Period", W - M - 150, 72 + oy);
    doc.setTextColor(30, 30, 40);
    doc.setFont("helvetica", "bold");
    doc.text(inv.invoiceNo, W - M, 40 + oy, { align: "right" });
    doc.text(fmtDate(inv.invoiceDate), W - M, 56 + oy, { align: "right" });
    doc.text(`${fmtDate(inv.periodFrom)} to ${fmtDate(inv.periodTo)}`, W - M, 72 + oy, {
        align: "right",
    });

    // from / bill to
    let y = 110 + oy;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text("FROM", M, y);
    doc.text("BILL TO", W / 2 + 10, y);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 40);
    const fromLines = doc.splitTextToSize(inv.from || "-", W / 2 - M - 20);
    const toLines = doc.splitTextToSize(inv.billTo || "-", W / 2 - M - 10);
    doc.text(fromLines, M, y + 16);
    doc.text(toLines, W / 2 + 10, y + 16);
    y += 16 + Math.max(fromLines.length, toLines.length) * 14 + 16;

    // lines
    const headLabels = inv.showClientCol
        ? ["#", "Client", "Service", "Cases", "Rate", "Amount"]
        : ["#", "Service", "Cases", "Rate", "Amount"];
    const numCols = inv.showClientCol ? [3, 4, 5] : [2, 3, 4];
    // header cells need their own alignment or they ignore columnStyles
    const head = [
        headLabels.map((label, i) => ({
            content: label,
            styles: { halign: numCols.includes(i) ? ("right" as const) : ("left" as const) },
        })),
    ];
    const body = inv.lines.map((l, i) =>
        inv.showClientCol
            ? [
                  String(i + 1),
                  l.clientName,
                  l.productName,
                  String(l.cases),
                  money(l.rate || 0, inv.currency),
                  money(l.amount, inv.currency),
              ]
            : [
                  String(i + 1),
                  l.productName,
                  String(l.cases),
                  money(l.rate || 0, inv.currency),
                  money(l.amount, inv.currency),
              ]
    );
    const colStyles: Record<number, any> = { 0: { cellWidth: 26 } };
    numCols.forEach((c) => (colStyles[c] = { halign: "right" }));

    autoTable(doc, {
        startY: y,
        head,
        body,
        theme: "striped",
        // top/bottom keep the table clear of the letterhead on every page
        margin: { left: M, right: M, top, bottom },
        // pages after the first get the letterhead too
        willDrawPage: (d: any) => {
            if (d.pageNumber > 1) drawLH();
        },
        headStyles: { fillColor: BLUE, textColor: 255, fontSize: 9.5 },
        styles: { fontSize: 9.5, cellPadding: 6, textColor: [30, 30, 40] },
        alternateRowStyles: { fillColor: [245, 248, 253] },
        columnStyles: colStyles,
    });

    // totals
    let ty = (doc as any).lastAutoTable.finalY + 22;
    // start a new (letterhead) page when the next block doesn't fit
    const ensure = (need: number) => {
        if (ty + need > H - bottom) {
            doc.addPage();
            drawLH();
            ty = useLH ? top : 50;
        }
    };
    ensure(90);
    const labelX = W - M - 180;
    const row = (label: string, value: string, bold = false) => {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(bold ? 12 : 10);
        if (bold) doc.setTextColor(...BLUE);
        else doc.setTextColor(60, 65, 80);
        doc.text(label, labelX, ty);
        doc.text(value, W - M, ty, { align: "right" });
        ty += bold ? 20 : 16;
    };
    row("Subtotal", money(inv.subtotal, inv.currency));
    if (inv.taxPct > 0) row(`Tax (${inv.taxPct}%)`, money(inv.tax, inv.currency));
    doc.setDrawColor(200, 210, 230);
    doc.line(labelX, ty - 8, W - M, ty - 8);
    ty += 4;
    row("Total", money(inv.total, inv.currency), true);

    if (inv.notes.trim()) {
        ensure(60);
        ty += 14;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...GREY);
        doc.text("NOTES", M, ty);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60, 65, 80);
        doc.text(doc.splitTextToSize(inv.notes.trim(), W - M * 2), M, ty + 14);
    }

    // the letterhead already has its own footer, so skip ours
    if (!useLH) {
        doc.setFontSize(8.5);
        doc.setTextColor(...GREY);
        doc.text("This is a computer generated invoice.", W / 2, H - 28, { align: "center" });
    }
    return doc;
}

// ======================================================================
export default function Billing() {
    const isMobile = useIsMobile();
    const cardCols = useCardColumns();
    const { colors: themeColors } = useTheme();

    // lookups
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [lookupError, setLookupError] = useState("");

    // cases for the chosen period
    const [cases, setCases] = useState<CaseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // filters — the date range decides what is fetched (= the "total");
    // everything else narrows it down client-side, instantly.
    const [fromDate, setFromDate] = useState(firstOfMonthStr());
    const [toDate, setToDate] = useState(todayStr());
    const [productId, setProductId] = useState("");
    const [clientId, setClientId] = useState("");
    const [employeeId, setEmployeeId] = useState("");
    const [workType, setWorkType] = useState("");

    // invoice popup
    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [invoiceNo, setInvoiceNo] = useState("");
    const [invoiceDate, setInvoiceDate] = useState(todayStr());
    const [invFrom, setInvFrom] = useState("");
    const [billTo, setBillTo] = useState("");
    const [billToEdited, setBillToEdited] = useState(false);
    const [taxPct, setTaxPct] = useState("0");
    const [notes, setNotes] = useState("");
    const [invCurrency, setInvCurrency] = useState("");

    // letterhead
    const [letterhead, setLetterhead] = useState("");
    const [lhName, setLhName] = useState("");
    const [lhTop, setLhTop] = useState("45");
    const [lhBottom, setLhBottom] = useState("25");
    const [lhError, setLhError] = useState("");

    const onLetterheadFile = (file: File | undefined) => {
        setLhError("");
        if (!file) return;
        if (!/^image\/(png|jpeg)$/.test(file.type)) {
            setLhError("Sirf PNG ya JPG image upload karo.");
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            setLhError("Image 3 MB se choti honi chahiye.");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const data = String(reader.result || "");
            setLetterhead(data);
            setLhName(file.name);
            try {
                localStorage.setItem(LH_KEY, data);
            } catch {
                setLhError(
                    "Letterhead save nahi hua (browser storage full). Is baar ke liye use hoga."
                );
            }
        };
        reader.readAsDataURL(file);
    };
    const removeLetterhead = () => {
        setLetterhead("");
        setLhName("");
        try {
            localStorage.removeItem(LH_KEY);
        } catch {
            /* ignore */
        }
    };

    // load the saved letterhead + spacing when the page opens
    useEffect(() => {
        try {
            const saved = localStorage.getItem(LH_KEY) || "";
            setLetterhead(saved);
            setLhName(saved ? "Saved letterhead" : "");
            setLhTop(localStorage.getItem(LH_TOP_KEY) || "45");
            setLhBottom(localStorage.getItem(LH_BOTTOM_KEY) || "25");
        } catch {
            /* ignore */
        }
    }, []);

    // currency conversion
    const [rates, setRates] = useState<Record<string, number>>({});
    const [fxUpdated, setFxUpdated] = useState<number | null>(null);
    const [fxError, setFxError] = useState(false);
    const [totalCur, setTotalCur] = useState("");

    // client whose "View Details" table is open (clientId, or null)
    const [openClient, setOpenClient] = useState<string | null>(null);
    const detailRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (openClient === null) return;
        const t = setTimeout(
            () => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            60
        );
        return () => clearTimeout(t);
    }, [openClient]);

    // ---- lookups (rates live on the clients) ----
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/clients`);
                const json = await res.json();
                if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
                if (!cancelled) setClients(Array.isArray(json) ? json : json.data || []);
            } catch (err: any) {
                if (!cancelled) setLookupError(err?.message || "Failed to load client rates.");
            }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/products`);
                const json = await res.json();
                if (res.ok && !cancelled) setProducts(json.data || []);
            } catch (err) {
                console.error("Failed to fetch products:", err);
            }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/api/employees`);
                const json = await res.json();
                if (res.ok && !cancelled)
                    setEmployees(Array.isArray(json) ? json : json.data || []);
            } catch (err) {
                console.error("Failed to fetch employees:", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // ---- exchange rates (cached for 12 hours) ----
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const raw = localStorage.getItem(FX_KEY);
                if (raw) {
                    const c = JSON.parse(raw);
                    if (c?.rates) {
                        setRates(c.rates);
                        setFxUpdated(c.t);
                        if (Date.now() - c.t < FX_TTL) return; // fresh enough
                    }
                }
            } catch {
                /* ignore */
            }
            try {
                // plain fetch on purpose: authFetch would send our login cookie to a third party
                const res = await fetch(FX_URL);
                const json = await res.json();
                if (!res.ok || json.result !== "success" || !json.rates) throw new Error("fx");
                if (cancelled) return;
                setRates(json.rates);
                setFxUpdated(Date.now());
                setFxError(false);
                try {
                    localStorage.setItem(
                        FX_KEY,
                        JSON.stringify({ t: Date.now(), rates: json.rates })
                    );
                } catch {
                    /* ignore */
                }
            } catch {
                if (!cancelled) setFxError(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // ---- cases for the date range (all pages) ----
    const fetchCases = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const all = await loadCases(fromDate, toDate);
            setCases(all);
        } catch (err: any) {
            setError(err?.message || "Failed to load cases.");
            setCases([]);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    // ---- rate lookup: client + service -> rate ----
    const rateMap = useMemo(() => {
        const m = new Map<string, { rate: number | null; currency: string }>();
        clients.forEach((c) => {
            // Each rate keeps the currency saved on it. Only a rate with NO saved
            // currency falls back to the client's Unit (first saved currency on
            // the client, else the currency of its country), the same way the
            // Edit Client form picks its Unit dropdown.
            const unit =
                (c.products || []).find((pr) => pr.currency)?.currency ||
                currencyForCountry(c.country);
            (c.products || []).forEach((p) => {
                const n = Number(p.amount);
                const has = p.amount !== null && p.amount !== undefined && p.amount !== "";
                m.set(`${c.id}:${p.id}`, {
                    rate: has && !Number.isNaN(n) ? n : null,
                    currency: p.currency || unit,
                });
            });
        });
        return m;
    }, [clients]);

    // ---- billable cases with their rate attached ----
    const billable = useMemo<PricedCase[]>(
        () =>
            cases
                .filter((c) => BILLABLE.includes(c.submissionType))
                .map((row) => {
                    const r = rateMap.get(`${row.clientId}:${row.productId}`);
                    return { row, rate: r ? r.rate : null, currency: r?.currency || "USD" };
                }),
        [cases, rateMap]
    );

    const matches = useCallback(
        (pc: PricedCase, skipProduct = false) => {
            const r = pc.row;
            if (!skipProduct && productId && String(r.productId) !== productId) return false;
            if (clientId && String(r.clientId) !== clientId) return false;
            if (employeeId && String(r.assignedEmployeeId) !== employeeId) return false;
            if (workType && r.submissionType !== workType) return false;
            return true;
        },
        [productId, clientId, employeeId, workType]
    );

    const filtered = useMemo(() => billable.filter((pc) => matches(pc)), [billable, matches]);
    const forServiceCards = useMemo(
        () => billable.filter((pc) => matches(pc, true)),
        [billable, matches]
    );

    const filtersActive = Boolean(productId || clientId || employeeId || workType);

    const sumOf = (list: PricedCase[]) => {
        const totals: Record<string, number> = {};
        let missing = 0;
        list.forEach((pc) => {
            if (pc.rate === null) missing += 1;
            else addTo(totals, pc.currency, pc.rate);
        });
        return { totals, missing };
    };

    const periodSum = useMemo(() => sumOf(billable), [billable]);
    const filteredSum = useMemo(() => sumOf(filtered), [filtered]);

    // ---- currency conversion for totals ----
    // Currencies present in this period (priced cases only). One currency =
    // nothing to convert; more than one = show the "Show totals in" dropdown.
    const allCurrencies = useMemo(
        () =>
            [...new Set(billable.filter((pc) => pc.rate !== null).map((pc) => pc.currency))].sort(),
        [billable]
    );
    const mixed = allCurrencies.length > 1;
    const targetCur = allCurrencies.includes(totalCur) ? totalCur : allCurrencies[0] || "USD";
    const fxReady = Object.keys(rates).length > 0;
    const showConverted = mixed && fxReady;

    // Total of a per-currency map: converted into targetCur when mixed,
    // otherwise shown per currency exactly as before.
    const fmtTotals = (totals: Record<string, number>, sep = "\n") => {
        if (Object.keys(totals).length === 0) return "—";
        if (!showConverted) return formatTotals(totals, sep);
        let sum = 0;
        Object.entries(totals).forEach(([cur, v]) => {
            const c = convertAmount(v, cur, targetCur, rates);
            if (c !== null) sum += c;
        });
        return money(sum, targetCur);
    };
    const noRateCurs = showConverted
        ? allCurrencies.filter((c) => convertAmount(1, c, targetCur, rates) === null)
        : [];
    const rateNotes = showConverted
        ? allCurrencies
              .filter((c) => c !== targetCur)
              .map((c) => {
                  const r = convertAmount(1, c, targetCur, rates);
                  return r === null ? null : `1 ${c} = ${r.toFixed(2)} ${targetCur}`;
              })
              .filter(Boolean)
        : [];

    // ---- lines: same client + same service ----
    const groups = useMemo<Group[]>(() => groupCases(filtered), [filtered]);

    // ---- client-wise cards: each client with its own cases + total ----
    const clientPages = useMemo(() => {
        const m = new Map<
            string,
            {
                clientId: string;
                clientName: string;
                lines: Group[];
                cases: number;
                missing: number;
                totals: Record<string, number>;
            }
        >();
        groups.forEach((g) => {
            let c = m.get(g.clientId);
            if (!c) {
                c = {
                    clientId: g.clientId,
                    clientName: g.clientName,
                    lines: [],
                    cases: 0,
                    missing: 0,
                    totals: {},
                };
                m.set(g.clientId, c);
            }
            c.lines.push(g);
            c.cases += g.cases;
            if (g.rate === null) c.missing += g.cases;
            else addTo(c.totals, g.currency, g.amount);
        });
        return [...m.values()]; // groups are already sorted by client name
    }, [groups]);

    // close the open client table whenever the selection changes
    useEffect(() => {
        setOpenClient(null);
    }, [fromDate, toDate, productId, clientId, employeeId, workType]);

    const current =
        openClient === null ? undefined : clientPages.find((c) => c.clientId === openClient);

    // ---- service cards (click = filter) ----
    const serviceCards = useMemo(() => {
        const m = new Map<
            string,
            {
                id: string;
                name: string;
                cases: number;
                totals: Record<string, number>;
                missing: number;
            }
        >();
        forServiceCards.forEach((pc) => {
            const id = String(pc.row.productId);
            let s = m.get(id);
            if (!s) {
                s = {
                    id,
                    name: pc.row.productName || "Unknown service",
                    cases: 0,
                    totals: {},
                    missing: 0,
                };
                m.set(id, s);
            }
            s.cases += 1;
            if (pc.rate === null) s.missing += 1;
            else addTo(s.totals, pc.currency, pc.rate);
        });
        return [...m.values()].sort((a, b) => b.cases - a.cases);
    }, [forServiceCards]);

    const resetFilters = () => {
        setProductId("");
        setClientId("");
        setEmployeeId("");
        setWorkType("");
    };

    // ---- invoice ----
    const pricedGroups = useMemo(() => groups.filter((g) => g.rate !== null), [groups]);

    // The invoice has its own date range + client, independent of the page filters.
    const [invFromDate, setInvFromDate] = useState(firstOfMonthStr());
    const [invToDate, setInvToDate] = useState(todayStr());
    const [invClientId, setInvClientId] = useState("");
    const [invCases, setInvCases] = useState<CaseRow[]>([]);
    const [invLoading, setInvLoading] = useState(false);
    const [invError, setInvError] = useState("");

    useEffect(() => {
        if (!invoiceOpen || !invFromDate || !invToDate || invFromDate > invToDate) {
            setInvCases([]);
            return;
        }
        let cancelled = false;
        setInvLoading(true);
        setInvError("");
        loadCases(invFromDate, invToDate)
            .then((rows) => {
                if (!cancelled) setInvCases(rows);
            })
            .catch((err: any) => {
                if (!cancelled) {
                    setInvError(err?.message || "Failed to load cases.");
                    setInvCases([]);
                }
            })
            .finally(() => {
                if (!cancelled) setInvLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [invoiceOpen, invFromDate, invToDate]);

    const invClientName = useMemo(
        () => clients.find((c) => String(c.id) === invClientId)?.name || "",
        [clients, invClientId]
    );
    const invGroups = useMemo<Group[]>(() => {
        if (!invClientId) return [];
        const list: PricedCase[] = invCases
            .filter(
                (c) => BILLABLE.includes(c.submissionType) && String(c.clientId) === invClientId
            )
            .map((row) => {
                const r = rateMap.get(`${row.clientId}:${row.productId}`);
                return { row, rate: r ? r.rate : null, currency: r?.currency || "USD" };
            });
        return groupCases(list);
    }, [invCases, invClientId, rateMap]);
    const invMissing = invGroups.filter((g) => g.rate === null).reduce((n, g) => n + g.cases, 0);
    const invoicePriced = useMemo(() => invGroups.filter((g) => g.rate !== null), [invGroups]);
    const invoiceCurrencies = useMemo(
        () => [...new Set(invoicePriced.map((g) => g.currency))],
        [invoicePriced]
    );
    useEffect(() => {
        if (!invoiceOpen) return;
        if (!invoiceCurrencies.includes(invCurrency)) setInvCurrency(invoiceCurrencies[0] || "");
    }, [invoiceOpen, invoiceCurrencies, invCurrency]);
    const invoiceLines = useMemo(
        () => invoicePriced.filter((g) => g.currency === invCurrency),
        [invoicePriced, invCurrency]
    );
    const invoiceClients = useMemo(
        () => [...new Set(invoiceLines.map((l) => l.clientName))],
        [invoiceLines]
    );
    const subtotal = invoiceLines.reduce((s, l) => s + l.amount, 0);
    const taxNum = Math.max(0, Number(taxPct) || 0);
    const tax = Math.round(subtotal * taxNum) / 100;
    const total = subtotal + tax;

    const openInvoice = () => {
        setInvCurrency("");
        setInvFromDate(fromDate);
        setInvToDate(toDate);
        setInvClientId(clientId);
        setInvError("");
        setInvoiceNo(makeInvoiceNo());
        setInvoiceDate(todayStr());
        setBillToEdited(false);
        setNotes("");
        try {
            setInvFrom(localStorage.getItem(FROM_KEY) || "");
        } catch {
            setInvFrom("");
        }
        setInvoiceOpen(true);
    };

    // keep Bill To in sync with the lines until the user types their own
    useEffect(() => {
        if (!invoiceOpen || billToEdited) return;
        setBillTo(invClientName);
    }, [invoiceOpen, billToEdited, invClientName]);

    useEffect(() => {
        if (!invoiceOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setInvoiceOpen(false);
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [invoiceOpen]);

    const downloadPdf = () => {
        try {
            localStorage.setItem(FROM_KEY, invFrom);
        } catch {
            /* ignore */
        }
        try {
            localStorage.setItem(LH_TOP_KEY, lhTop);
            localStorage.setItem(LH_BOTTOM_KEY, lhBottom);
        } catch {
            /* ignore */
        }
        const doc = buildInvoicePdf({
            primary: themeColors.blue,
            invoiceNo: invoiceNo.trim() || makeInvoiceNo(),
            invoiceDate,
            from: invFrom.trim(),
            billTo: billTo.trim(),
            periodFrom: invFromDate,
            periodTo: invToDate,
            currency: invCurrency,
            showClientCol: invoiceClients.length > 1,
            lines: invoiceLines,
            subtotal,
            taxPct: taxNum,
            tax,
            total,
            notes,
            letterhead,
            topMm: Math.max(0, Number(lhTop) || 0),
            bottomMm: Math.max(0, Number(lhBottom) || 0),
        });
        doc.save(`${invoiceNo.trim() || "invoice"}.pdf`);
    };

    const canInvoice = !loading && clients.length > 0;
    const totalCases = billable.length;

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <style>{HOVER_CSS}</style>
            {/* Top gradient accent bar */}
            <div style={styles.topBar} />

            <div style={styles.contentBody}>
                {/* Header row: title + breadcrumb / invoice button */}
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div style={styles.headerLeft}>
                        <div>
                            <h1 style={styles.pageTitle}>Billing</h1>
                            <p style={styles.headerSubtext}>
                                Earning = completed cases × the rate set for each client's service.
                                See the total for a period first, narrow it down by service, client
                                or employee, then generate an invoice for exactly what's on screen.
                            </p>
                        </div>
                    </div>

                    <div style={isMobile ? styles.headerRightMobile : styles.headerRight}>
                        {!isMobile && (
                            <div style={styles.breadcrumb}>
                                <i className="ti ti-home" style={{ fontSize: fontSize.md }} />
                                <span style={styles.breadcrumbSep}>/</span>
                                <span style={styles.breadcrumbItem}>Dashboard</span>
                                <span style={styles.breadcrumbSep}>/</span>
                                <span style={styles.breadcrumbActive}>Billing</span>
                            </div>
                        )}
                        <button
                            type="button"
                            className="bl-btn"
                            style={{
                                ...styles.submitBtn,
                                marginTop: 0,
                                padding: "10px 18px",
                                opacity: canInvoice ? 1 : 0.5,
                                cursor: canInvoice ? "pointer" : "not-allowed",
                            }}
                            disabled={!canInvoice}
                            onClick={openInvoice}
                            title={canInvoice ? "" : "Client list is still loading"}
                        >
                            <i className="ti ti-file-invoice" style={{ fontSize: fontSize.lg }} />
                            Generate Invoice
                        </button>
                    </div>
                </div>

                {/* ---- filters ---- */}
                <div style={styles.panel}>
                    <div style={styles.panelHeader}>
                        <i className="ti ti-filter" style={{ fontSize: fontSize.xl }} />
                        <span style={{ flex: 1 }}>Filters</span>
                        <button
                            type="button"
                            className="bl-btn"
                            style={{
                                ...styles.headerGhostBtn,
                                opacity: filtersActive ? 1 : 0.5,
                                cursor: filtersActive ? "pointer" : "not-allowed",
                            }}
                            onClick={resetFilters}
                            disabled={!filtersActive}
                        >
                            <i className="ti ti-refresh" style={{ fontSize: fontSize.base }} />
                            Reset filters
                        </button>
                    </div>
                    <div
                        style={{
                            ...styles.filterGrid,
                            gridTemplateColumns: isMobile
                                ? "1fr 1fr"
                                : "repeat(auto-fit, minmax(170px, 1fr))",
                        }}
                    >
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-calendar" style={styles.labelIcon} />
                                From
                            </span>
                            <input
                                type="date"
                                style={styles.input}
                                value={fromDate}
                                max={toDate || undefined}
                                onChange={(e) => setFromDate(e.target.value)}
                            />
                        </label>
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-calendar" style={styles.labelIcon} />
                                To
                            </span>
                            <input
                                type="date"
                                style={styles.input}
                                value={toDate}
                                min={fromDate || undefined}
                                onChange={(e) => setToDate(e.target.value)}
                            />
                        </label>
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-package" style={styles.labelIcon} />
                                Service
                            </span>
                            <select
                                style={styles.input}
                                value={productId}
                                onChange={(e) => setProductId(e.target.value)}
                            >
                                <option value="">All Services</option>
                                {products.map((p) => (
                                    <option key={p.id} value={String(p.id)}>
                                        {p.product_name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-building" style={styles.labelIcon} />
                                Client
                            </span>
                            <select
                                style={styles.input}
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                            >
                                <option value="">All Clients</option>
                                {clients.map((c) => (
                                    <option key={c.id} value={String(c.id)}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-user" style={styles.labelIcon} />
                                Employee
                            </span>
                            <select
                                style={styles.input}
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                            >
                                <option value="">All Employees</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={styles.label}>
                            <span style={styles.labelText}>
                                <i className="ti ti-briefcase" style={styles.labelIcon} />
                                Work type
                            </span>
                            <select
                                style={styles.input}
                                value={workType}
                                onChange={(e) => setWorkType(e.target.value)}
                            >
                                <option value="">All billable</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="DONE_BY_TEAM">Completed by Team</option>
                                <option value="DONE_BY_CLIENT">Completed by Client</option>
                            </select>
                        </label>
                    </div>
                </div>

                {(error || lookupError) && (
                    <div style={styles.formError}>
                        <i className="ti ti-alert-triangle" style={{ fontSize: fontSize.md }} />
                        {error || lookupError}
                    </div>
                )}

                {/* ---- currency picker: only when clients use different currencies ---- */}
                {!loading && mixed && (
                    <div style={styles.fxBar}>
                        <i
                            className="ti ti-currency-dollar"
                            style={{ fontSize: fontSize.xl, color: "var(--brand-blue)" }}
                        />
                        <span style={styles.labelText}>Show totals in</span>
                        <select
                            style={{ ...styles.input, minWidth: 110, width: "auto" }}
                            value={targetCur}
                            onChange={(e) => setTotalCur(e.target.value)}
                        >
                            {allCurrencies.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                        <span style={styles.fxNote}>
                            {fxReady
                                ? rateNotes.join("  ·  ")
                                : fxError
                                  ? "Live exchange rates could not load, so totals are shown per currency."
                                  : "Loading exchange rates…"}
                        </span>
                        {noRateCurs.length > 0 && (
                            <span style={{ ...styles.fxNote, color: "#b45309" }}>
                                No exchange rate for {noRateCurs.join(", ")}. Not included in the
                                converted total.
                            </span>
                        )}
                        {fxReady && (
                            <span style={styles.fxNote}>
                                {fxUpdated
                                    ? `Updated ${new Date(fxUpdated).toLocaleString()} · `
                                    : ""}
                                <a
                                    href="https://www.exchangerate-api.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "var(--brand-blue)" }}
                                >
                                    Rates by ExchangeRate-API
                                </a>
                            </span>
                        )}
                    </div>
                )}

                {/* ---- KPIs: total first, then filtered ---- */}
                <div style={isMobile ? styles.kpiRowMobile : styles.kpiRow}>
                    <KpiCard
                        icon="ti ti-coin"
                        iconBg={GRADIENT}
                        label="Total Earning"
                        value={loading ? "…" : fmtTotals(periodSum.totals)}
                        footer={
                            loading
                                ? ""
                                : `${fmtDate(fromDate)} to ${fmtDate(toDate)} · ${totalCases} case${
                                      totalCases === 1 ? "" : "s"
                                  }`
                        }
                        dotColor="var(--brand-blue)"
                    />
                    <KpiCard
                        icon="ti ti-filter-dollar"
                        iconBg="linear-gradient(135deg, #34d399, #059669)"
                        label={filtersActive ? "Filtered Earning" : "Filtered (no filters)"}
                        value={loading ? "…" : fmtTotals(filteredSum.totals)}
                        footer={
                            loading
                                ? ""
                                : `${filtered.length} case${filtered.length === 1 ? "" : "s"} selected`
                        }
                        dotColor="#059669"
                    />
                    <KpiCard
                        icon="ti ti-stack-2"
                        iconBg="linear-gradient(135deg, #c084fc, #9333ea)"
                        label="Invoice Lines"
                        value={loading ? "…" : String(pricedGroups.length)}
                        footer="Client + service combinations"
                        dotColor="#9333ea"
                    />
                    <KpiCard
                        icon="ti ti-alert-triangle"
                        iconBg="linear-gradient(135deg, #fbbf24, #d97706)"
                        label="Missing Rate"
                        value={loading ? "…" : String(filteredSum.missing)}
                        footer={filteredSum.missing ? "Not counted in earning" : "All cases priced"}
                        dotColor="#d97706"
                    />
                </div>

                {/* ---- service cards ---- */}
                {!loading && serviceCards.length > 0 && (
                    <div style={styles.panel}>
                        <div style={styles.panelHeader}>
                            <i className="ti ti-chart-bar" style={{ fontSize: fontSize.xl }} />
                            <span style={{ flex: 1 }}>Earning by service</span>
                            <span style={styles.panelHint}>Click a service to filter</span>
                        </div>
                        <div style={styles.svcRow}>
                            {serviceCards.map((s) => {
                                const active = productId === s.id;
                                return (
                                    <div
                                        key={s.id}
                                        className="bl-svc"
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={active}
                                        onClick={() => setProductId(active ? "" : s.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                setProductId(active ? "" : s.id);
                                            }
                                        }}
                                        style={{
                                            ...styles.svcCard,
                                            borderColor: active ? "var(--brand-blue)" : "#e2e4f0",
                                            background: active
                                                ? "rgba(var(--brand-blue-rgb, 32,66,151), 0.06)"
                                                : "#fafaff",
                                        }}
                                    >
                                        <div style={styles.svcName}>
                                            <i
                                                className="ti ti-package"
                                                style={{ color: "var(--brand-blue)" }}
                                            />
                                            {s.name}
                                            {active && (
                                                <i
                                                    className="ti ti-check"
                                                    style={{
                                                        color: "var(--brand-blue)",
                                                        marginLeft: "auto",
                                                    }}
                                                />
                                            )}
                                        </div>
                                        <div style={styles.svcAmount}>{fmtTotals(s.totals)}</div>
                                        <div style={styles.svcMeta}>
                                            {s.cases} case{s.cases === 1 ? "" : "s"}
                                            {s.missing > 0 && (
                                                <span style={{ color: "#b45309" }}>
                                                    {" "}
                                                    · {s.missing} no rate
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ---- client-wise cards + detail table ---- */}
                {loading ? (
                    <div style={styles.panel}>
                        <div style={styles.emptyState}>Calculating earnings…</div>
                    </div>
                ) : groups.length === 0 ? (
                    <div style={styles.panel}>
                        <div style={styles.emptyState}>
                            <i
                                className="ti ti-file-invoice"
                                style={{
                                    display: "block",
                                    fontSize: fontSize["6xl"],
                                    color: "var(--brand-blue)",
                                    marginBottom: 6,
                                }}
                            />
                            <div style={styles.emptyTitle}>
                                {filtersActive
                                    ? "Nothing matches these filters"
                                    : "No billable cases in this period"}
                            </div>
                            {filtersActive
                                ? "Reset the filters or widen the date range."
                                : "Only submitted cases (Completed, by Team, by Client) are billed."}
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={styles.cardsSection}>
                            <div style={styles.cardsHeader}>
                                <span style={styles.cardsTitle}>Client-wise Billing</span>
                                <span style={styles.cardsHint}>
                                    {clientPages.length} client
                                    {clientPages.length === 1 ? "" : "s"} · each total is in the
                                    client's own currency
                                </span>
                            </div>
                            <div
                                style={{
                                    ...styles.cardsGrid,
                                    gridTemplateColumns: `repeat(${cardCols}, minmax(0, 1fr))`,
                                }}
                            >
                                {clientPages.map((c) => {
                                    const active = openClient === c.clientId;
                                    const shown = c.lines.slice(0, CARD_SERVICE_LIMIT);
                                    const extra = c.lines.length - shown.length;
                                    return (
                                        <div
                                            key={c.clientId || c.clientName}
                                            style={{
                                                ...styles.clientCard,
                                                borderTopColor: active ? BRAND.blue : "#e5e9f0",
                                                borderRightColor: active ? BRAND.blue : "#e5e9f0",
                                                borderBottomColor: active ? BRAND.blue : "#e5e9f0",
                                                boxShadow: active
                                                    ? "0 8px 22px rgba(var(--brand-blue-rgb),0.2)"
                                                    : "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
                                            }}
                                        >
                                            <div style={styles.clientCardTop}>
                                                <div style={styles.clientCardNameWrap}>
                                                    <div
                                                        style={styles.clientCardName}
                                                        title={c.clientName}
                                                    >
                                                        {c.clientName}
                                                    </div>
                                                    <div style={styles.clientAmount}>
                                                        {formatTotals(c.totals, " · ")}
                                                    </div>
                                                    <div style={styles.clientAmountLbl}>
                                                        Total amount
                                                    </div>
                                                </div>
                                                <div style={styles.totalBox}>
                                                    <div style={styles.totalNum}>{c.cases}</div>
                                                    <div style={styles.totalLbl}>Total cases</div>
                                                </div>
                                            </div>
                                            <div style={styles.statList}>
                                                {shown.map((l) => (
                                                    <div key={l.key} style={styles.statRow}>
                                                        <span
                                                            style={styles.statLabel}
                                                            title={l.productName}
                                                        >
                                                            <span
                                                                style={{
                                                                    ...styles.statDot,
                                                                    background:
                                                                        l.rate === null
                                                                            ? BRAND.amber
                                                                            : BRAND.blue,
                                                                }}
                                                            />
                                                            <span style={styles.statLabelText}>
                                                                {l.productName}
                                                            </span>
                                                        </span>
                                                        <span style={styles.statRight}>
                                                            <span style={styles.statValue}>
                                                                {l.cases}
                                                            </span>
                                                            <span style={styles.statAmount}>
                                                                {l.rate === null
                                                                    ? "No rate"
                                                                    : money(l.amount, l.currency)}
                                                            </span>
                                                        </span>
                                                    </div>
                                                ))}
                                                {extra > 0 && (
                                                    <div style={styles.moreNote}>
                                                        +{extra} more service
                                                        {extra === 1 ? "" : "s"}
                                                    </div>
                                                )}
                                                {c.missing > 0 && (
                                                    <div style={styles.missingNote}>
                                                        {c.missing} case
                                                        {c.missing === 1 ? "" : "s"} without a rate
                                                        — not counted in the amount
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="bl-btn"
                                                style={{
                                                    ...styles.viewDetailsBtn,
                                                    ...(active ? styles.viewDetailsBtnActive : {}),
                                                }}
                                                onClick={() =>
                                                    setOpenClient(active ? null : c.clientId)
                                                }
                                            >
                                                {active ? "Hide Details" : "View Details"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* detail table stays hidden until "View Details" is clicked */}
                        {current && (
                            <div
                                ref={detailRef}
                                style={{ display: "flex", flexDirection: "column", gap: 12 }}
                            >
                                <div style={styles.clientHead}>
                                    <div>
                                        <div style={styles.clientName}>
                                            <i
                                                className="ti ti-building"
                                                style={{ color: "var(--brand-blue)" }}
                                            />
                                            {current.clientName}
                                        </div>
                                        <div style={styles.clientMeta}>
                                            {current.cases} case{current.cases === 1 ? "" : "s"}
                                            {current.missing > 0 && (
                                                <span style={{ color: "#b45309" }}>
                                                    {" "}
                                                    · {current.missing} no rate
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={styles.clientHeadRight}>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={styles.clientTotal}>
                                                {formatTotals(current.totals, "  ·  ")}
                                            </div>
                                            <div style={styles.clientMeta}>Client total</div>
                                        </div>
                                        <button
                                            type="button"
                                            className="bl-btn"
                                            style={styles.closeDetailBtn}
                                            onClick={() => setOpenClient(null)}
                                        >
                                            <i className="ti ti-x" />
                                            Close
                                        </button>
                                    </div>
                                </div>

                                <div style={styles.panel}>
                                    <div style={{ overflowX: "auto" }}>
                                        <table style={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th style={styles.th}>Service</th>
                                                    <th
                                                        style={{ ...styles.th, textAlign: "right" }}
                                                    >
                                                        Cases
                                                    </th>
                                                    <th
                                                        style={{ ...styles.th, textAlign: "right" }}
                                                    >
                                                        Rate
                                                    </th>
                                                    <th
                                                        style={{ ...styles.th, textAlign: "right" }}
                                                    >
                                                        Amount
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {current.lines.map((g, idx) => {
                                                    const rowBg =
                                                        idx % 2 === 0 ? "#fff" : "#fafaff";
                                                    return (
                                                        <tr
                                                            key={g.key}
                                                            className="bl-row"
                                                            style={{ background: rowBg }}
                                                        >
                                                            <td style={styles.td}>
                                                                <button
                                                                    type="button"
                                                                    className="bl-btn"
                                                                    style={styles.linkBtn}
                                                                    onClick={() =>
                                                                        setProductId(
                                                                            productId ===
                                                                                g.productId
                                                                                ? ""
                                                                                : g.productId
                                                                        )
                                                                    }
                                                                    title="Filter by this service"
                                                                >
                                                                    {g.productName}
                                                                </button>
                                                            </td>
                                                            <td
                                                                style={{
                                                                    ...styles.td,
                                                                    textAlign: "right",
                                                                }}
                                                            >
                                                                <Pill value={g.cases} tone="blue" />
                                                            </td>
                                                            <td
                                                                style={{
                                                                    ...styles.td,
                                                                    textAlign: "right",
                                                                }}
                                                            >
                                                                {g.rate === null ? (
                                                                    <span style={styles.noRatePill}>
                                                                        No rate
                                                                    </span>
                                                                ) : (
                                                                    money(g.rate, g.currency)
                                                                )}
                                                            </td>
                                                            <td
                                                                style={{
                                                                    ...styles.td,
                                                                    textAlign: "right",
                                                                    fontWeight: fontWeight.semibold,
                                                                    color: "#1e1b4b",
                                                                }}
                                                            >
                                                                {g.rate === null
                                                                    ? "—"
                                                                    : money(g.amount, g.currency)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr>
                                                    <td style={styles.tfootTd}>
                                                        Total · {current.clientName}
                                                    </td>
                                                    <td
                                                        style={{
                                                            ...styles.tfootTd,
                                                            textAlign: "right",
                                                        }}
                                                    >
                                                        {current.cases}
                                                    </td>
                                                    <td style={styles.tfootTd} />
                                                    <td
                                                        style={{
                                                            ...styles.tfootTd,
                                                            textAlign: "right",
                                                        }}
                                                    >
                                                        {formatTotals(current.totals, "  ·  ")}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ================= INVOICE POPUP ================= */}
            {invoiceOpen && (
                // NOTE: overlay intentionally has no onClick-to-close — an accidental
                // backdrop click shouldn't discard what was typed. Only ✕ / Cancel /
                // Escape close it (same rule as the Daily Work popups).
                <div style={styles.overlay}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Generate invoice"
                        style={{ ...styles.modal, width: isMobile ? "100%" : 760 }}
                    >
                        <div style={styles.modalHeader}>
                            <h3 style={styles.modalTitle}>Generate Invoice</h3>
                            <p style={styles.modalSubtitle}>
                                {invClientName || "Select a client"} · {fmtDate(invFromDate)} to{" "}
                                {fmtDate(invToDate)} ·{" "}
                                {invoiceLines.reduce((n, l) => n + l.cases, 0)} case(s)
                            </p>
                            <button
                                type="button"
                                style={styles.closeBtn}
                                aria-label="Close"
                                onClick={() => setInvoiceOpen(false)}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.modalBody}>
                            {/* ---- period + client (required) ---- */}
                            <div
                                style={{
                                    ...styles.formGrid,
                                    gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1.4fr",
                                }}
                            >
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-calendar" style={styles.labelIcon} />
                                        From date
                                    </span>
                                    <input
                                        type="date"
                                        style={styles.input}
                                        value={invFromDate}
                                        max={invToDate || undefined}
                                        onChange={(e) => setInvFromDate(e.target.value)}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-calendar" style={styles.labelIcon} />
                                        To date
                                    </span>
                                    <input
                                        type="date"
                                        style={styles.input}
                                        value={invToDate}
                                        min={invFromDate || undefined}
                                        onChange={(e) => setInvToDate(e.target.value)}
                                    />
                                </label>
                                <label
                                    style={{
                                        ...styles.label,
                                        gridColumn: isMobile ? "1 / -1" : undefined,
                                    }}
                                >
                                    <span style={styles.labelText}>
                                        <i className="ti ti-building" style={styles.labelIcon} />
                                        Client
                                    </span>
                                    <select
                                        style={styles.input}
                                        value={invClientId}
                                        onChange={(e) => {
                                            setInvClientId(e.target.value);
                                            setBillToEdited(false);
                                        }}
                                    >
                                        <option value="">Select client</option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={String(c.id)}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {invError && (
                                <div style={styles.formError}>
                                    <i
                                        className="ti ti-alert-triangle"
                                        style={{ fontSize: fontSize.md }}
                                    />
                                    {invError}
                                </div>
                            )}
                            {!invLoading && invClientId && invMissing > 0 && (
                                <div style={styles.formError}>
                                    <i
                                        className="ti ti-alert-triangle"
                                        style={{ fontSize: fontSize.md }}
                                    />
                                    {invMissing} case{invMissing === 1 ? "" : "s"} of this client
                                    have no rate set, so they are not on the invoice.
                                </div>
                            )}

                            {/* ---- letterhead ---- */}
                            <div style={styles.lhBox}>
                                <div style={styles.labelText}>
                                    <i className="ti ti-file-text" style={styles.labelIcon} />
                                    Letterhead (optional)
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 10,
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                    }}
                                >
                                    <label
                                        className="bl-btn"
                                        style={{ ...styles.cancelBtn, cursor: "pointer" }}
                                    >
                                        <i className="ti ti-upload" style={{ marginRight: 6 }} />
                                        {letterhead ? "Change letterhead" : "Upload letterhead"}
                                        <input
                                            type="file"
                                            accept="image/png,image/jpeg"
                                            style={{ display: "none" }}
                                            onChange={(e) => {
                                                onLetterheadFile(e.target.files?.[0]);
                                                e.target.value = "";
                                            }}
                                        />
                                    </label>
                                    {letterhead && (
                                        <>
                                            <span style={styles.fxNote}>{lhName}</span>
                                            <button
                                                type="button"
                                                className="bl-btn"
                                                style={styles.cancelBtn}
                                                onClick={removeLetterhead}
                                            >
                                                Remove
                                            </button>
                                        </>
                                    )}
                                </div>
                                {letterhead && (
                                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                                        <label style={{ ...styles.label, width: 150 }}>
                                            <span style={styles.labelText}>Top space (mm)</span>
                                            <input
                                                type="number"
                                                min={0}
                                                style={styles.input}
                                                value={lhTop}
                                                onChange={(e) => setLhTop(e.target.value)}
                                            />
                                        </label>
                                        <label style={{ ...styles.label, width: 150 }}>
                                            <span style={styles.labelText}>Bottom space (mm)</span>
                                            <input
                                                type="number"
                                                min={0}
                                                style={styles.input}
                                                value={lhBottom}
                                                onChange={(e) => setLhBottom(e.target.value)}
                                            />
                                        </label>
                                    </div>
                                )}
                                {lhError && (
                                    <div style={{ ...styles.fxNote, color: "#b45309" }}>
                                        {lhError}
                                    </div>
                                )}
                                <div style={styles.fxNote}>
                                    Letterhead ko A4 size (full page) PNG/JPG banao. Header/footer
                                    ke neeche jitni jagah chhodni hai, utna Top/Bottom space set
                                    karo.
                                </div>
                            </div>

                            <div
                                style={{
                                    ...styles.formGrid,
                                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                                }}
                            >
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i
                                            className="ti ti-building-store"
                                            style={styles.labelIcon}
                                        />
                                        From (your business)
                                    </span>
                                    <input
                                        type="text"
                                        style={styles.input}
                                        placeholder="Your company name & address"
                                        value={invFrom}
                                        onChange={(e) => setInvFrom(e.target.value)}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-building" style={styles.labelIcon} />
                                        Bill to
                                        {invoiceClients.length > 1 && (
                                            <span
                                                style={{
                                                    color: "#b45309",
                                                    fontWeight: fontWeight.regular,
                                                }}
                                            >
                                                · {invoiceClients.length} clients included
                                            </span>
                                        )}
                                    </span>
                                    <input
                                        type="text"
                                        style={styles.input}
                                        placeholder="Client name & address"
                                        value={billTo}
                                        onChange={(e) => {
                                            setBillTo(e.target.value);
                                            setBillToEdited(true);
                                        }}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-hash" style={styles.labelIcon} />
                                        Invoice no.
                                    </span>
                                    <input
                                        type="text"
                                        style={styles.input}
                                        value={invoiceNo}
                                        onChange={(e) => setInvoiceNo(e.target.value)}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-calendar" style={styles.labelIcon} />
                                        Invoice date
                                    </span>
                                    <input
                                        type="date"
                                        style={styles.input}
                                        value={invoiceDate}
                                        onChange={(e) => setInvoiceDate(e.target.value)}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i className="ti ti-percentage" style={styles.labelIcon} />
                                        Tax / GST %
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        style={styles.input}
                                        value={taxPct}
                                        onChange={(e) => setTaxPct(e.target.value)}
                                    />
                                </label>
                                <label style={styles.label}>
                                    <span style={styles.labelText}>
                                        <i
                                            className="ti ti-currency-dollar"
                                            style={styles.labelIcon}
                                        />
                                        Currency
                                    </span>
                                    <select
                                        style={styles.input}
                                        value={invCurrency}
                                        onChange={(e) => {
                                            setInvCurrency(e.target.value);
                                            setBillToEdited(false);
                                        }}
                                        disabled={invoiceCurrencies.length <= 1}
                                    >
                                        {invoiceCurrencies.map((c) => (
                                            <option key={c} value={c}>
                                                {c}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {invoiceCurrencies.length > 1 && (
                                <div style={styles.formError}>
                                    <i
                                        className="ti ti-alert-triangle"
                                        style={{ fontSize: fontSize.md }}
                                    />
                                    The selection has more than one currency. An invoice can only
                                    hold one — pick the currency to invoice, then repeat for the
                                    others.
                                </div>
                            )}

                            {/* preview */}
                            <div style={styles.preview}>
                                <div style={{ overflowX: "auto" }}>
                                    <table style={styles.table}>
                                        <thead>
                                            <tr>
                                                {invoiceClients.length > 1 && (
                                                    <th style={styles.th}>Client</th>
                                                )}
                                                <th style={styles.th}>Service</th>
                                                <th style={{ ...styles.th, textAlign: "right" }}>
                                                    Cases
                                                </th>
                                                <th style={{ ...styles.th, textAlign: "right" }}>
                                                    Rate
                                                </th>
                                                <th style={{ ...styles.th, textAlign: "right" }}>
                                                    Amount
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invoiceLines.map((l, idx) => (
                                                <tr
                                                    key={l.key}
                                                    style={{
                                                        background:
                                                            idx % 2 === 0 ? "#fff" : "#fafaff",
                                                    }}
                                                >
                                                    {invoiceClients.length > 1 && (
                                                        <td style={styles.td}>{l.clientName}</td>
                                                    )}
                                                    <td style={styles.td}>{l.productName}</td>
                                                    <td
                                                        style={{ ...styles.td, textAlign: "right" }}
                                                    >
                                                        {l.cases}
                                                    </td>
                                                    <td
                                                        style={{ ...styles.td, textAlign: "right" }}
                                                    >
                                                        {money(l.rate || 0, invCurrency)}
                                                    </td>
                                                    <td
                                                        style={{ ...styles.td, textAlign: "right" }}
                                                    >
                                                        {money(l.amount, invCurrency)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {invoiceLines.length === 0 && (
                                    <div style={styles.emptyState}>
                                        {invLoading
                                            ? "Loading cases…"
                                            : invFromDate > invToDate
                                              ? "From date must be before To date."
                                              : !invClientId
                                                ? "Select a client to see the invoice lines."
                                                : "No billable priced cases for this client in this period."}
                                    </div>
                                )}
                                <div style={styles.totals}>
                                    <div style={styles.totalRow}>
                                        <span>Subtotal</span>
                                        <span>{money(subtotal, invCurrency)}</span>
                                    </div>
                                    {taxNum > 0 && (
                                        <div style={styles.totalRow}>
                                            <span>Tax ({taxNum}%)</span>
                                            <span>{money(tax, invCurrency)}</span>
                                        </div>
                                    )}
                                    <div style={{ ...styles.totalRow, ...styles.grandRow }}>
                                        <span>Total</span>
                                        <span>{money(total, invCurrency)}</span>
                                    </div>
                                </div>
                            </div>

                            <label style={styles.label}>
                                <span style={styles.labelText}>
                                    <i className="ti ti-notes" style={styles.labelIcon} />
                                    Notes (optional)
                                </span>
                                <textarea
                                    style={{
                                        ...styles.input,
                                        minHeight: 60,
                                        resize: "vertical",
                                    }}
                                    placeholder="Payment terms, bank details…"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </label>
                        </div>

                        <div style={styles.modalFoot}>
                            <button
                                type="button"
                                className="bl-btn"
                                style={styles.cancelBtn}
                                onClick={() => setInvoiceOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="bl-btn"
                                style={{
                                    ...styles.submitBtn,
                                    marginTop: 0,
                                    opacity: invoiceLines.length ? 1 : 0.5,
                                    cursor: invoiceLines.length ? "pointer" : "not-allowed",
                                }}
                                disabled={invoiceLines.length === 0}
                                onClick={downloadPdf}
                            >
                                <i className="ti ti-download" style={{ fontSize: fontSize.lg }} />
                                Download PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function KpiCard({
    icon,
    iconBg,
    label,
    value,
    footer,
    dotColor,
}: {
    icon: string;
    iconBg: string;
    label: string;
    value: number | string;
    footer: string;
    dotColor: string;
}) {
    return (
        <div style={styles.kpiCard}>
            <div style={styles.kpiTop}>
                <div style={{ ...styles.kpiIcon, background: iconBg }}>
                    <i className={icon} style={{ fontSize: fontSize["3xl"], color: "#fff" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                    <div style={styles.kpiLabel}>{label}</div>
                    <div style={styles.kpiValue}>{value}</div>
                </div>
            </div>
            <div style={styles.kpiFooter}>
                <span>{footer}</span>
                <span style={{ ...styles.kpiDot, background: dotColor }}>
                    <i
                        className="ti ti-arrow-right"
                        style={{ fontSize: fontSize.xxs, color: "#fff" }}
                    />
                </span>
            </div>
        </div>
    );
}

const PILL_TONES: Record<string, { bg: string; fg: string }> = {
    blue: { bg: "#dbeafe", fg: "#1d4ed8" },
    green: { bg: "#dcfce7", fg: "#15803d" },
    amber: { bg: "#fef3c7", fg: "#b45309" },
    teal: { bg: "#ccfbf1", fg: "#0f766e" },
};

function Pill({ value, tone }: { value: number; tone: keyof typeof PILL_TONES }) {
    const t = PILL_TONES[tone];
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 28,
                padding: "3px 9px",
                borderRadius: radius.pill,
                background: t.bg,
                color: t.fg,
                fontSize: fontSize.sm,
                fontWeight: fontWeight.semibold,
            }}
        >
            {value}
        </span>
    );
}

const styles: Record<string, CSSProperties> = {
    // the app's global CSS centres text; keep this page left-aligned
    root: {
        width: "100%",
        flex: 1,
        minHeight: "100%",
        background: "#eff4fa",
        fontFamily: fontFamily.base,
        textAlign: "left",
    },
    rootMobile: {
        width: "100%",
        flex: 1,
        minHeight: "100%",
        background: "#eff4fa",
        fontFamily: fontFamily.base,
        textAlign: "left",
    },
    topBar: {
        height: "4px",
        width: "100%",
        background: "linear-gradient(90deg, var(--brand-blue), var(--brand-light-blue), #2EBBA8)",
    },
    contentBody: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "20px 24px 28px",
    },

    headerRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
    },
    headerRowMobile: { display: "flex", flexDirection: "column", gap: "10px" },
    headerLeft: { display: "flex", gap: "14px", alignItems: "flex-start" },
    headerRight: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
        flexShrink: 0,
    },
    headerRightMobile: { display: "flex", flexDirection: "column", gap: 10 },
    pageTitle: {
        margin: 0,
        fontSize: fontSize["5xl"],
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        textAlign: "left",
    },
    headerSubtext: {
        margin: "4px 0 0",
        fontSize: fontSize.base,
        color: "#767F92",
        textAlign: "left",
        maxWidth: 680,
    },
    breadcrumb: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: fontSize.sm,
        color: "#64748b",
        marginTop: "6px",
    },
    breadcrumbSep: { color: "#c7cbe0" },
    breadcrumbItem: { color: "#64748b" },
    breadcrumbActive: { color: "var(--brand-blue)", fontWeight: fontWeight.semibold },

    // generic white panel + gradient header (same as Daily Work's form/list panels)
    panel: {
        background: "#fff",
        borderRadius: radius.lg,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    panelHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "14px 18px",
        background: "#F4F8FD",
        borderBottom: "1px solid #e5e9f0",
        color: "#17181C",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
    },
    panelHint: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: "#767F92" },
    headerGhostBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },

    filterGrid: { display: "grid", gap: "14px", padding: "18px" },
    label: { display: "flex", flexDirection: "column", gap: "6px" },
    labelText: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        color: "#374151",
    },
    labelIcon: { fontSize: fontSize.base, color: "var(--brand-blue)" },
    input: {
        border: "1px solid #e2e4f0",
        borderRadius: radius.sm,
        padding: "9px 12px",
        fontSize: fontSize.base,
        color: "#1e1b4b",
        outline: "none",
        fontFamily: "inherit",
        background: "#fafaff",
        width: "100%",
        boxSizing: "border-box",
    },
    formError: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#fef3e2",
        border: "1px solid #fde3b0",
        color: "#b45309",
        fontSize: fontSize.sm,
        padding: "9px 10px",
        borderRadius: radius.sm,
    },
    submitBtn: {
        marginTop: "4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        background: GRADIENT,
        color: "#fff",
        border: "none",
        borderRadius: radius.sm,
        padding: "11px 14px",
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    cancelBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "11px 18px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
    },

    // currency picker bar (shown only when clients use different currencies)
    fxBar: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: "#fff",
        borderRadius: radius.lg,
        padding: "12px 18px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
    },
    fxNote: { fontSize: fontSize.xs, color: "#94a3b8" },

    // KPI cards (same as Daily Work)
    kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" },
    kpiRowMobile: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" },
    kpiCard: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        minWidth: 0,
    },
    kpiTop: { display: "flex", alignItems: "center", gap: "12px" },
    kpiIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    kpiLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: "var(--brand-blue)" },
    kpiValue: {
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.bold,
        color: "#1e1b4b",
        whiteSpace: "pre-line",
        lineHeight: 1.25,
        wordBreak: "break-word",
    },
    kpiFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.xs,
        color: "#94a3b8",
        borderTop: "1px solid #f1f1f7",
        paddingTop: "10px",
    },
    kpiDot: {
        width: 18,
        height: 18,
        borderRadius: radius.circle,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },

    // service cards
    svcRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 12,
        padding: "18px",
    },
    svcCard: {
        boxSizing: "border-box",
        borderRadius: radius.md,
        border: "1.5px solid #e2e4f0",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    svcName: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#312e81",
    },
    svcAmount: {
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.bold,
        color: "#1e1b4b",
        whiteSpace: "pre-line",
        lineHeight: 1.25,
    },
    svcMeta: { fontSize: fontSize.sm, color: "#94a3b8" },

    // ---- client-wise cards (same layout as the Production Report) ----
    cardsSection: {
        background: "#fff",
        borderRadius: radius.lg,
        padding: "16px 18px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
    },
    cardsHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
    },
    cardsTitle: {
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "#17181C",
    },
    cardsHint: { fontSize: fontSize.xs, color: "#9CA3AF" },
    // Column count is set inline from useCardColumns() (4 / 2 / 1).
    // minmax(0, 1fr) stops long client names from stretching a column.
    cardsGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
    },
    clientCard: {
        background: "#fff",
        border: "1px solid #e5e9f0",
        borderLeft: "4px solid var(--brand-blue)",
        borderRadius: radius.lg,
        padding: "12px 14px",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "inherit",
        boxShadow: "0 4px 14px rgba(var(--brand-blue-rgb),0.07)",
        transition: "box-shadow .15s ease, border-color .15s ease",
        minWidth: 0,
    },
    clientCardTop: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 10,
        borderBottom: "1px dashed #e5e9f0",
    },
    clientCardNameWrap: { minWidth: 0, flex: 1, textAlign: "left" },
    clientCardName: {
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
        color: "#17181C",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    clientAmount: {
        marginTop: 4,
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.bold,
        color: BRAND.green,
        lineHeight: 1.15,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    clientAmountLbl: { fontSize: fontSize.xs, color: "#767F92", marginTop: 2 },
    totalBox: {
        textAlign: "center",
        flexShrink: 0,
        background: "rgba(var(--brand-blue-rgb),0.07)",
        borderRadius: radius.md,
        padding: "5px 12px",
        minWidth: 64,
    },
    totalNum: {
        fontSize: fontSize["4xl"],
        fontWeight: fontWeight.bold,
        color: BRAND.blue,
        lineHeight: 1,
    },
    totalLbl: { fontSize: fontSize.xs, color: "#767F92", marginTop: 2, whiteSpace: "nowrap" },
    statList: { display: "flex", flexDirection: "column", gap: 4 },
    statRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: fontSize.sm,
        background: "#F7F9FD",
        borderRadius: radius.sm,
        padding: "5px 10px",
    },
    statLabel: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#5b6477",
        minWidth: 0,
        flex: 1,
    },
    statLabelText: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    statDot: { width: 8, height: 8, borderRadius: radius.circle, flexShrink: 0 },
    statRight: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "flex-end",
        gap: 8,
        flexShrink: 0,
    },
    statValue: { fontWeight: fontWeight.semibold, fontSize: fontSize.base, color: BRAND.blue },
    statAmount: {
        fontSize: fontSize.xs,
        color: "#5b6477",
        minWidth: 70,
        textAlign: "right",
        whiteSpace: "nowrap",
    },
    moreNote: { fontSize: fontSize.xs, color: "#9CA3AF", padding: "0 10px" },
    missingNote: { fontSize: fontSize.xs, color: "#b45309", padding: "0 10px" },
    viewDetailsBtn: {
        width: "100%",
        padding: "7px 12px",
        borderRadius: radius.md,
        border: "1px solid rgba(var(--brand-blue-rgb),0.25)",
        background: "rgba(var(--brand-blue-rgb),0.06)",
        color: BRAND.blue,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.semibold,
        cursor: "pointer",
        fontFamily: "inherit",
    },
    viewDetailsBtnActive: {
        background: GRADIENT,
        color: "#fff",
        border: "1px solid transparent",
        boxShadow: "0 6px 16px rgba(var(--brand-blue-rgb),0.28)",
    },

    // detail header for the opened client
    clientHead: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        background: "#fff",
        borderRadius: radius.lg,
        padding: "14px 18px",
        boxShadow: "0 1px 3px rgba(30,27,75,0.06)",
        borderLeft: "4px solid var(--brand-blue)",
    },
    clientHeadRight: { display: "flex", alignItems: "center", gap: 14 },
    closeDetailBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: radius.sm,
        border: "1px solid #e2e4f0",
        background: "#fff",
        color: "#374151",
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
    clientName: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.bold,
        color: "#1e1b4b",
    },
    clientMeta: { fontSize: fontSize.sm, color: "#94a3b8", marginTop: 2 },
    clientTotal: {
        fontSize: fontSize["2xl"],
        fontWeight: fontWeight.bold,
        color: "var(--brand-blue)",
        whiteSpace: "pre-line",
    },

    // tables (gradient header, striped rows)
    table: { width: "100%", borderCollapse: "collapse", minWidth: 480 },
    th: {
        textAlign: "left",
        padding: "10px 18px",
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: "#767F92",
        background: "#F4F8FD",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
    },
    td: {
        padding: "10px 18px",
        fontSize: fontSize.base,
        color: "#374151",
        borderBottom: "1px solid #f1f1f7",
    },
    tfootTd: {
        padding: "12px 18px",
        fontSize: fontSize.md,
        fontWeight: fontWeight.bold,
        color: "#17181C",
        background: "#F4F8FD",
        borderTop: "2px solid #ececf5",
    },
    linkBtn: {
        border: "none",
        background: "none",
        padding: 0,
        font: "inherit",
        fontWeight: fontWeight.medium,
        color: "#312e81",
        cursor: "pointer",
        textAlign: "left",
    },
    noRatePill: {
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        padding: "3px 10px",
        borderRadius: radius.pill,
        background: "#fef3c7",
        color: "#b45309",
    },
    emptyState: {
        padding: "32px 24px",
        textAlign: "center",
        color: "#999",
        fontSize: fontSize.sm,
    },
    emptyTitle: {
        fontSize: fontSize.base,
        fontWeight: fontWeight.semibold,
        color: "#1e1b4b",
        marginBottom: 4,
    },

    // ---- invoice popup ----
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
    },
    modal: {
        background: "#fff",
        borderRadius: radius.lg,
        maxWidth: "92vw",
        maxHeight: "88vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 70px rgba(0,0,0,0.3)",
    },
    modalHeader: {
        position: "relative",
        textAlign: "center",
        padding: "24px 28px 16px",
        borderBottom: "1px solid #f0f0f0",
        flexShrink: 0,
    },
    modalTitle: {
        margin: 0,
        fontSize: fontSize["3xl"],
        fontWeight: fontWeight.semibold,
        color: "var(--brand-blue)",
    },
    modalSubtitle: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },
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
    modalBody: {
        padding: "18px 22px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    modalFoot: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 10,
        padding: "14px 22px",
        borderTop: "1px solid #f1f1f7",
        flexShrink: 0,
    },
    formGrid: { display: "grid", gap: 14 },
    lhBox: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        border: "1px dashed #c7cbe0",
        borderRadius: radius.md,
        background: "#fafaff",
    },
    preview: {
        border: "1px solid #e2e4f0",
        borderRadius: radius.md,
        overflow: "hidden",
    },
    totals: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 16px",
        alignItems: "flex-end",
        background: "#fafaff",
    },
    totalRow: {
        display: "flex",
        justifyContent: "space-between",
        gap: 40,
        minWidth: 240,
        fontSize: fontSize.base,
        color: "#374151",
    },
    grandRow: {
        fontSize: fontSize.xl,
        fontWeight: fontWeight.bold,
        color: "var(--brand-blue)",
        borderTop: "1px solid #e2e4f0",
        paddingTop: 8,
        marginTop: 2,
    },
};
