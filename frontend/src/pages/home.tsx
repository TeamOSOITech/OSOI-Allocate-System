import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import * as XLSX from "xlsx";
import { authFetch } from "../utils/authFetch";
import { fontFamily, fontSize, fontWeight, radius } from "../styles/theme";
import { useTheme } from "../context/themecontext";

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

function withAlpha(hex: string, alpha: number) {
    const clean = hex.replace("#", "");
    const n = parseInt(clean, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Fixed, theme-independent palette for the 4 top stat cards — same
// reasoning as STATUS_AMBER in dashboard.tsx: these are semantic
// categories (holidays/birthdays/announcements/tasks), not brand accents,
// so they stay put regardless of which theme color is active.
const STAT_COLORS = {
    holidays: { icon: "#4F46E5", bg: "#EEF0FE" },
    birthdays: { icon: "#059669", bg: "#E7FBF3" },
    announcements: { icon: "#9333EA", bg: "#F5EBFE" },
    tasks: { icon: "#EA8C00", bg: "#FEF3E2" },
};

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

// "2026-10-02" -> "Fri, 02 October, 2026"
function formatNiceDate(iso: string | null | undefined) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const day = pad2(d.getDate());
    const month = d.toLocaleDateString("en-US", { month: "long" });
    return `${weekday}, ${day} ${month}, ${d.getFullYear()}`;
}

// "2026-10-02" -> "02 Oct"
function formatShortDate(iso: string | null | undefined) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    return `${pad2(d.getDate())} ${d.toLocaleDateString("en-US", { month: "short" })}`;
}

function daysUntilLabel(n: number) {
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return `In ${n} days`;
}

function initials(name: string) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Takes a stored Date of Birth (or any date) and returns how many days
// until the NEXT occurrence of that month/day — same logic as the
// backend's holidays module, done client-side here since birthdays come
// straight off the employees list rather than a dedicated table.
function nextOccurrenceInfo(dateStr: string) {
    const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
    if (isNaN(d.getTime())) return null;
    const month = d.getMonth();
    const day = d.getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let next = new Date(today.getFullYear(), month, day);
    if (next < today) next = new Date(today.getFullYear() + 1, month, day);
    const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
    const iso = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
    return { iso, daysUntil };
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HomeUser {
    role?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
}

interface Holiday {
    id: string;
    name: string;
    date: string;
    nextOccurrence: string;
    daysUntil: number;
}

interface Employee {
    id: string;
    name: string;
    dateOfBirth: string | null;
    department?: string | null;
    designation?: string | null;
    photoUrl?: string | null;
}

interface Birthday {
    id: string;
    name: string;
    department?: string | null;
    photoUrl?: string | null;
    nextOccurrence: string;
    daysUntil: number;
}

interface BulkRowResult {
    row: number;
    name: string;
    date: string;
    success: boolean;
    message: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function Home({ user }: { user: HomeUser }) {
    const isMobile = useIsMobile();
    const { colors: themeColors } = useTheme();
    const BRAND = {
        blue: themeColors.blue,
        lightBlue: themeColors.lightBlue,
        green: themeColors.green,
    };
    const styles = getStyles(BRAND);
    const isSuperAdmin = user?.role === "SUPER_ADMIN";

    const displayName = user?.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
        : user?.email || "";

    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [holidaysLoading, setHolidaysLoading] = useState(true);
    const [holidaysError, setHolidaysError] = useState("");
    const [holidayIndex, setHolidayIndex] = useState(0);
    const [showHolidaysModal, setShowHolidaysModal] = useState(false);

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employeesLoading, setEmployeesLoading] = useState(true);
    const [showBirthdaysModal, setShowBirthdaysModal] = useState(false);

    const fetchHolidays = async () => {
        setHolidaysLoading(true);
        setHolidaysError("");
        try {
            const res = await authFetch(`${API_BASE}/api/holidays`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setHolidays(json.data || []);
            setHolidayIndex(0);
        } catch (err: any) {
            setHolidaysError(err?.message || "Failed to load holidays.");
        } finally {
            setHolidaysLoading(false);
        }
    };

    const fetchEmployees = async () => {
        setEmployeesLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/employees`);
            const json = await res.json();
            if (!res.ok) return;
            const list = Array.isArray(json) ? json : json.data || [];
            setEmployees(list);
        } catch (err) {
            console.error("Failed to fetch employees:", err);
        } finally {
            setEmployeesLoading(false);
        }
    };

    useEffect(() => {
        fetchHolidays();
        fetchEmployees();
    }, []);

    // Every employee with a DOB, resolved to "next birthday" + sorted —
    // this is the full-year list (used by the "View All" modal).
    const allBirthdaysSorted: Birthday[] = useMemo(() => {
        return employees
            .filter((e) => !!e.dateOfBirth)
            .map((e) => {
                const info = nextOccurrenceInfo(e.dateOfBirth as string);
                if (!info) return null;
                return {
                    id: e.id,
                    name: e.name,
                    department: e.department,
                    photoUrl: e.photoUrl,
                    nextOccurrence: info.iso,
                    daysUntil: info.daysUntil,
                } as Birthday;
            })
            .filter((b): b is Birthday => !!b)
            .sort((a, b) => a.daysUntil - b.daysUntil);
    }, [employees]);

    // Only the ones landing within the next month, per the requirement —
    // birthdays "start showing" once they're within a month away.
    const upcomingBirthdays = useMemo(
        () => allBirthdaysSorted.filter((b) => b.daysUntil <= 30),
        [allBirthdaysSorted]
    );

    const todayNice = formatNiceDate(
        `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`
    );

    const currentHoliday = holidays[holidayIndex] || null;

    // ---- Top stat cards ----
    const holidaysUpcomingCount = holidays.filter((h) => h.daysUntil <= 30).length;
    // Birthdays still remaining THIS calendar month (nextOccurrence already
    // rolls a passed birthday to next year, so this stays correct across
    // the Dec -> Jan boundary too).
    const now = new Date();
    const birthdaysThisMonthCount = allBirthdaysSorted.filter((b) => {
        const d = new Date(`${b.nextOccurrence}T00:00:00`);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    const statCards = [
        {
            key: "holidays",
            icon: "ti ti-calendar-event",
            value: holidaysUpcomingCount,
            label: "Holidays",
            sub: "Upcoming",
            colors: STAT_COLORS.holidays,
        },
        {
            key: "birthdays",
            icon: "ti ti-cake",
            value: birthdaysThisMonthCount,
            label: "Birthdays",
            sub: "This Month",
            colors: STAT_COLORS.birthdays,
        },
        {
            // Placeholder — no announcements module exists yet, shown as "—"
            // rather than a made-up number so the card isn't misleading.
            key: "announcements",
            icon: "ti ti-speakerphone",
            value: "—",
            label: "Announcements",
            sub: "Coming soon",
            colors: STAT_COLORS.announcements,
        },
        {
            // Placeholder — same reasoning as Announcements above.
            key: "tasks",
            icon: "ti ti-clipboard-check",
            value: "—",
            label: "Tasks",
            sub: "Coming soon",
            colors: STAT_COLORS.tasks,
        },
    ];

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.topBar} />
            <div style={isMobile ? styles.contentBodyMobile : styles.contentBody}>
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div>
                        <h2 style={styles.pageTitle}>
                            {displayName ? `Welcome back, ${displayName}` : "Welcome back"}
                        </h2>
                        <p style={styles.headerSubtext}>Here's what's happening today.</p>
                    </div>
                    <div style={styles.dateBadge}>
                        <i className="ti ti-calendar-event" aria-hidden="true" />
                        {todayNice}
                    </div>
                </div>

                {/* ---------------- Stat cards ---------------- */}
                <div style={isMobile ? styles.statGridMobile : styles.statGrid}>
                    {statCards.map((s) => (
                        <div
                            key={s.key}
                            style={styles.statCard}
                            title={s.sub === "Coming soon" ? "Coming soon" : undefined}
                        >
                            <div style={{ ...styles.statIconWrap, background: s.colors.bg }}>
                                <i
                                    className={s.icon}
                                    style={{ fontSize: fontSize.xl, color: s.colors.icon }}
                                    aria-hidden="true"
                                />
                            </div>
                            <div>
                                <div style={styles.statValue}>{s.value}</div>
                                <div style={styles.statLabel}>{s.label}</div>
                                <div style={styles.statSub}>{s.sub}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <div style={isMobile ? styles.cardsGridMobile : styles.cardsGrid}>
                    {/* ---------------- Holidays card ---------------- */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.holidays.icon}`,
                        }}
                    >
                        <div style={styles.cardHeaderRow}>
                            <div style={styles.cardTitleWrap}>
                                <div
                                    style={{
                                        ...styles.cardIconBadge,
                                        background: STAT_COLORS.holidays.bg,
                                    }}
                                >
                                    <i
                                        className="ti ti-calendar-event"
                                        style={{ color: STAT_COLORS.holidays.icon }}
                                        aria-hidden="true"
                                    />
                                </div>
                                <span style={styles.cardEyebrow}>Holidays</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                {isSuperAdmin && (
                                    <button
                                        style={styles.manageLink}
                                        onClick={() => setShowHolidaysModal(true)}
                                    >
                                        <i className="ti ti-settings" aria-hidden="true" /> Manage
                                    </button>
                                )}
                                <button
                                    style={styles.viewAllLink}
                                    onClick={() => setShowHolidaysModal(true)}
                                >
                                    View All
                                </button>
                            </div>
                        </div>

                        {holidaysLoading ? (
                            <div style={styles.cardEmpty}>Loading…</div>
                        ) : holidaysError ? (
                            <div style={styles.cardEmptyError}>{holidaysError}</div>
                        ) : !currentHoliday ? (
                            <div style={styles.cardEmpty}>
                                <EmptyCalendarIllustration BRAND={BRAND} />
                                <span>No holidays added yet.</span>
                                {isSuperAdmin && (
                                    <button
                                        style={styles.smallAddBtn(BRAND)}
                                        onClick={() => setShowHolidaysModal(true)}
                                    >
                                        + Add Holidays
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div style={styles.holidayBody}>
                                <button
                                    style={{
                                        ...styles.arrowBtn,
                                        ...(holidayIndex === 0 ? styles.arrowBtnDisabled : {}),
                                    }}
                                    disabled={holidayIndex === 0}
                                    onClick={() => setHolidayIndex((i) => Math.max(0, i - 1))}
                                    aria-label="Previous holiday"
                                >
                                    <i className="ti ti-chevron-left" aria-hidden="true" />
                                </button>

                                <div style={styles.holidayTextCol}>
                                    <div style={styles.holidayName}>{currentHoliday.name}</div>
                                    <div style={styles.holidayDate}>
                                        {formatNiceDate(currentHoliday.nextOccurrence)}
                                    </div>
                                    <div style={styles.holidayDaysBadge}>
                                        {daysUntilLabel(currentHoliday.daysUntil)}
                                    </div>
                                </div>

                                <FestiveIllustration BRAND={BRAND} />

                                <button
                                    style={{
                                        ...styles.arrowBtn,
                                        ...(holidayIndex >= holidays.length - 1
                                            ? styles.arrowBtnDisabled
                                            : {}),
                                    }}
                                    disabled={holidayIndex >= holidays.length - 1}
                                    onClick={() =>
                                        setHolidayIndex((i) => Math.min(holidays.length - 1, i + 1))
                                    }
                                    aria-label="Next holiday"
                                >
                                    <i className="ti ti-chevron-right" aria-hidden="true" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ---------------- Birthdays card ---------------- */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.birthdays.icon}`,
                        }}
                    >
                        <div style={styles.cardHeaderRow}>
                            <div style={styles.cardTitleWrap}>
                                <div
                                    style={{
                                        ...styles.cardIconBadge,
                                        background: STAT_COLORS.birthdays.bg,
                                    }}
                                >
                                    <i
                                        className="ti ti-cake"
                                        style={{ color: STAT_COLORS.birthdays.icon }}
                                        aria-hidden="true"
                                    />
                                </div>
                                <span style={styles.cardEyebrow}>Birthdays</span>
                            </div>
                            <button
                                style={styles.viewAllLink}
                                onClick={() => setShowBirthdaysModal(true)}
                            >
                                View All
                            </button>
                        </div>

                        {employeesLoading ? (
                            <div style={styles.cardEmpty}>Loading…</div>
                        ) : upcomingBirthdays.length === 0 ? (
                            <div style={styles.cardEmpty}>
                                <i
                                    className="ti ti-cake"
                                    style={styles.emptyIcon}
                                    aria-hidden="true"
                                />
                                <span>No birthdays in the next month.</span>
                            </div>
                        ) : (
                            <div style={styles.birthdayList}>
                                {upcomingBirthdays.slice(0, 5).map((b) => (
                                    <BirthdayRow key={b.id} b={b} styles={styles} BRAND={BRAND} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ---------------- Bottom tip banner ---------------- */}
                <div style={styles.tipBanner(BRAND)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={styles.tipIconWrap(BRAND)}>
                            <i className="ti ti-sparkles" aria-hidden="true" />
                        </div>
                        <div>
                            <div style={styles.tipTitle}>Stay Organized, Stay Productive!</div>
                            <div style={styles.tipSubtext}>
                                Check your tasks, upcoming events and stay ahead of your schedule.
                            </div>
                        </div>
                    </div>
                    {!isMobile && <TipIllustration BRAND={BRAND} />}
                </div>
            </div>

            {showHolidaysModal && (
                <HolidaysModal
                    holidays={holidays}
                    isSuperAdmin={isSuperAdmin}
                    onClose={() => setShowHolidaysModal(false)}
                    onRefresh={fetchHolidays}
                    styles={styles}
                    BRAND={BRAND}
                />
            )}

            {showBirthdaysModal && (
                <BirthdaysModal
                    birthdays={allBirthdaysSorted}
                    onClose={() => setShowBirthdaysModal(false)}
                    styles={styles}
                    BRAND={BRAND}
                />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function BirthdayRow({ b, styles, BRAND }: { b: Birthday; styles: any; BRAND: any }) {
    return (
        <div style={styles.birthdayRow}>
            {b.photoUrl ? (
                <img src={b.photoUrl} alt={b.name} style={styles.birthdayAvatarImg} />
            ) : (
                <div style={styles.birthdayAvatar}>{initials(b.name)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.birthdayName}>{b.name}</div>
                {b.department && <div style={styles.birthdayDept}>{b.department}</div>}
            </div>
            <div style={styles.birthdayDateCol}>
                <div
                    style={{
                        color: BRAND.blue,
                        fontWeight: fontWeight.semibold,
                        fontSize: fontSize.sm,
                    }}
                >
                    {formatShortDate(b.nextOccurrence)}
                </div>
                <div style={styles.birthdayDaysTag}>{daysUntilLabel(b.daysUntil)}</div>
            </div>
        </div>
    );
}

// Generic celebratory illustration (bunting + confetti) rendered in the
// active theme's colors — deliberately generic rather than tied to any
// one festival, since the featured holiday changes with every upload.
function FestiveIllustration({
    BRAND,
}: {
    BRAND: { blue: string; lightBlue: string; green: string };
}) {
    return (
        <svg
            width="96"
            height="96"
            viewBox="0 0 100 100"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
        >
            <circle cx="50" cy="50" r="46" fill={withAlpha(BRAND.lightBlue, 0.1)} />
            <path d="M18 34 L34 44 L26 58 Z" fill={BRAND.blue} transform="rotate(-10 26 46)" />
            <path d="M40 26 L56 34 L46 48 Z" fill={BRAND.lightBlue} transform="rotate(8 46 36)" />
            <path d="M60 32 L76 40 L66 54 Z" fill={BRAND.green} transform="rotate(-6 68 42)" />
            <circle cx="30" cy="70" r="4" fill={BRAND.green} />
            <circle cx="68" cy="72" r="3" fill={BRAND.blue} />
            <circle cx="50" cy="78" r="3.5" fill={BRAND.lightBlue} />
            <circle cx="78" cy="58" r="3" fill={BRAND.blue} />
            <circle cx="20" cy="56" r="2.5" fill={BRAND.lightBlue} />
            <path
                d="M32 62 Q50 78 68 62"
                stroke={BRAND.blue}
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
            />
        </svg>
    );
}

// Friendly "nothing here yet" calendar illustration for the empty
// Holidays state (a tear-off wall calendar with a couple of clouds),
// rendered in the active theme's colors.
function EmptyCalendarIllustration({
    BRAND,
}: {
    BRAND: { blue: string; lightBlue: string; green: string };
}) {
    return (
        <svg width="140" height="120" viewBox="0 0 140 120" aria-hidden="true">
            <ellipse cx="70" cy="108" rx="42" ry="6" fill={withAlpha(BRAND.blue, 0.06)} />
            <circle cx="24" cy="26" r="12" fill={withAlpha(BRAND.lightBlue, 0.14)} />
            <circle cx="112" cy="20" r="9" fill={withAlpha(BRAND.lightBlue, 0.14)} />
            <rect x="38" y="26" width="64" height="66" rx="8" fill={withAlpha(BRAND.blue, 0.12)} />
            <rect
                x="44"
                y="34"
                width="52"
                height="50"
                rx="5"
                fill="#fff"
                stroke={withAlpha(BRAND.blue, 0.2)}
            />
            <rect x="44" y="34" width="52" height="14" rx="5" fill={BRAND.blue} />
            {[0, 1, 2, 3].map((row) =>
                [0, 1, 2, 3].map((col) => (
                    <rect
                        key={`${row}-${col}`}
                        x={51 + col * 11}
                        y={54 + row * 8}
                        width="7"
                        height="5"
                        rx="1.5"
                        fill={withAlpha(BRAND.blue, 0.16)}
                    />
                ))
            )}
            <rect x="52" y="20" width="4" height="12" rx="2" fill={BRAND.blue} />
            <rect x="84" y="20" width="4" height="12" rx="2" fill={BRAND.blue} />
        </svg>
    );
}

// Small decorative clipboard-with-checkmark for the bottom tip banner.
function TipIllustration({ BRAND }: { BRAND: { blue: string; lightBlue: string; green: string } }) {
    return (
        <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
        >
            <rect x="14" y="8" width="36" height="50" rx="6" fill={withAlpha(BRAND.blue, 0.08)} />
            <rect
                x="20"
                y="14"
                width="24"
                height="38"
                rx="3"
                fill="#fff"
                stroke={withAlpha(BRAND.blue, 0.2)}
            />
            <rect x="26" y="6" width="12" height="6" rx="2" fill={BRAND.blue} />
            <rect x="24" y="22" width="16" height="3" rx="1.5" fill={withAlpha(BRAND.blue, 0.3)} />
            <rect x="24" y="29" width="12" height="3" rx="1.5" fill={withAlpha(BRAND.blue, 0.3)} />
            <circle cx="46" cy="44" r="12" fill={BRAND.green} />
            <path
                d="M40 44 L44 48 L52 39"
                stroke="#fff"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function HolidaysModal({
    holidays,
    isSuperAdmin,
    onClose,
    onRefresh,
    styles,
    BRAND,
}: {
    holidays: Holiday[];
    isSuperAdmin: boolean;
    onClose: () => void;
    onRefresh: () => void;
    styles: any;
    BRAND: any;
}) {
    const [tab, setTab] = useState<"list" | "add" | "bulk">("list");

    // ---- Add single holiday ----
    const [addName, setAddName] = useState("");
    const [addDate, setAddDate] = useState("");
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState("");

    const handleAdd = async () => {
        if (!addName.trim() || !addDate) {
            setAddError("Please enter both a name and a date.");
            return;
        }
        setAddSubmitting(true);
        setAddError("");
        try {
            const res = await authFetch(`${API_BASE}/api/holidays`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: addName.trim(), date: addDate }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to add holiday");
            setAddName("");
            setAddDate("");
            await onRefresh();
            setTab("list");
        } catch (err: any) {
            setAddError(err?.message || "Failed to add holiday.");
        } finally {
            setAddSubmitting(false);
        }
    };

    // ---- Bulk upload ----
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState("");
    const [bulkResults, setBulkResults] = useState<BulkRowResult[] | null>(null);

    const downloadTemplate = () => {
        const templateData = [
            { "Festival Name": "Gandhi Jayanti", Date: "02-Oct-2026" },
            { "Festival Name": "Diwali", Date: "2026-11-08" },
        ];
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Holidays");
        XLSX.writeFile(workbook, "bulk_holidays_template.xlsx");
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) {
            setBulkError("Please select an Excel/CSV file first.");
            return;
        }
        setBulkError("");
        setBulkSubmitting(true);
        setBulkResults(null);
        try {
            const arrayBuffer = await bulkFile.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false });

            if (rows.length === 0) {
                setBulkError("The file is empty.");
                setBulkSubmitting(false);
                return;
            }

            // Accepts a few common header spellings so the sheet doesn't
            // have to match the template exactly.
            const mapped = rows.map((row) => ({
                name:
                    row["Festival Name"] ||
                    row["Holiday Name"] ||
                    row["Name"] ||
                    row["Festival"] ||
                    "",
                date: row["Date"] || row["Holiday Date"] || "",
            }));

            const res = await authFetch(`${API_BASE}/api/holidays/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ holidays: mapped }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.message || "Bulk upload failed");
            setBulkResults(json.results || []);
            await onRefresh();
        } catch (err: any) {
            setBulkError(err?.message || "Something went wrong reading the file.");
        } finally {
            setBulkSubmitting(false);
        }
    };

    // ---- Delete ----
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            const res = await authFetch(`${API_BASE}/api/holidays/${id}`, { method: "DELETE" });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || "Failed to delete");
            await onRefresh();
        } catch (err) {
            console.error(err);
        } finally {
            setDeletingId(null);
        }
    };

    const sorted = [...holidays].sort((a, b) => a.daysUntil - b.daysUntil);

    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Holidays</h3>
                    <button style={styles.modalCloseBtn} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>

                {isSuperAdmin && (
                    <div style={styles.modalTabRow}>
                        {(["list", "add", "bulk"] as const).map((t) => (
                            <button
                                key={t}
                                style={{
                                    ...styles.modalTabBtn,
                                    ...(tab === t ? styles.modalTabBtnActive(BRAND) : {}),
                                }}
                                onClick={() => setTab(t)}
                            >
                                {t === "list"
                                    ? "All Holidays"
                                    : t === "add"
                                      ? "Add One"
                                      : "Bulk Upload"}
                            </button>
                        ))}
                    </div>
                )}

                <div style={styles.modalBody}>
                    {tab === "list" && (
                        <>
                            {sorted.length === 0 ? (
                                <div style={styles.cardEmpty}>No holidays added yet.</div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {sorted.map((h) => (
                                        <div key={h.id} style={styles.modalListRow}>
                                            <div>
                                                <div style={styles.modalListRowName}>{h.name}</div>
                                                <div style={styles.modalListRowDate}>
                                                    {formatNiceDate(h.nextOccurrence)}
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                }}
                                            >
                                                <span style={styles.holidayDaysBadgeSmall}>
                                                    {daysUntilLabel(h.daysUntil)}
                                                </span>
                                                {isSuperAdmin && (
                                                    <button
                                                        style={styles.rowDeleteBtn}
                                                        disabled={deletingId === h.id}
                                                        onClick={() => handleDelete(h.id)}
                                                        aria-label={`Delete ${h.name}`}
                                                    >
                                                        <i
                                                            className="ti ti-trash"
                                                            aria-hidden="true"
                                                        />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {tab === "add" && isSuperAdmin && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <div>
                                <label style={styles.modalLabel}>Festival / Holiday Name</label>
                                <input
                                    style={styles.modalInput}
                                    value={addName}
                                    onChange={(e) => setAddName(e.target.value)}
                                    placeholder="e.g. Gandhi Jayanti"
                                />
                            </div>
                            <div>
                                <label style={styles.modalLabel}>Date</label>
                                <input
                                    type="date"
                                    style={styles.modalInput}
                                    value={addDate}
                                    onChange={(e) => setAddDate(e.target.value)}
                                />
                            </div>
                            {addError && <div style={styles.modalError}>{addError}</div>}
                            <button
                                style={styles.modalPrimaryBtn(BRAND)}
                                onClick={handleAdd}
                                disabled={addSubmitting}
                            >
                                {addSubmitting ? "Adding…" : "Add Holiday"}
                            </button>
                        </div>
                    )}

                    {tab === "bulk" && isSuperAdmin && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <p style={styles.modalHint}>
                                Upload an Excel/CSV file with a "Festival Name" and "Date" column.
                                Dates can be in any common format (e.g. 02-Oct-2026, 2026-10-02, 2
                                October 2026) — they'll be parsed automatically.
                            </p>
                            <button
                                style={styles.modalSecondaryBtn(BRAND)}
                                onClick={downloadTemplate}
                            >
                                <i className="ti ti-download" aria-hidden="true" /> Download
                                Template
                            </button>
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
                            />
                            {bulkError && <div style={styles.modalError}>{bulkError}</div>}
                            <button
                                style={styles.modalPrimaryBtn(BRAND)}
                                onClick={handleBulkUpload}
                                disabled={bulkSubmitting}
                            >
                                {bulkSubmitting ? "Uploading…" : "Upload"}
                            </button>

                            {bulkResults && (
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                        marginTop: 6,
                                    }}
                                >
                                    {bulkResults.map((r) => (
                                        <div
                                            key={r.row}
                                            style={{
                                                ...styles.bulkResultRow,
                                                color: r.success ? "#15803D" : "#b91c1c",
                                            }}
                                        >
                                            <i
                                                className={r.success ? "ti ti-check" : "ti ti-x"}
                                                aria-hidden="true"
                                            />
                                            Row {r.row} — {r.name || "(blank)"}: {r.message}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function BirthdaysModal({
    birthdays,
    onClose,
    styles,
    BRAND,
}: {
    birthdays: Birthday[];
    onClose: () => void;
    styles: any;
    BRAND: any;
}) {
    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Birthdays</h3>
                    <button style={styles.modalCloseBtn} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>
                <div style={styles.modalBody}>
                    {birthdays.length === 0 ? (
                        <div style={styles.cardEmpty}>No employee birthdays on file yet.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {birthdays.map((b) => (
                                <BirthdayRow key={b.id} b={b} styles={styles} BRAND={BRAND} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

function getStyles(BRAND: { blue: string; lightBlue: string; green: string }): Record<string, any> {
    return {
        root: {
            width: "100%",
            minHeight: "100%",
            background: "#f4f5fb",
            fontFamily: fontFamily.base,
        },
        rootMobile: {
            width: "100%",
            minHeight: "100%",
            background: "#f0f0f5",
            fontFamily: fontFamily.base,
        },
        topBar: {
            height: "4px",
            width: "100%",
            background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
        },
        contentBody: {
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            padding: "20px 24px 28px",
        },
        contentBodyMobile: {
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            padding: "14px 14px 22px",
        },

        headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
        headerRowMobile: { display: "flex", flexDirection: "column", gap: "10px" },

        pageTitle: {
            margin: 0,
            fontSize: fontSize["5xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        headerSubtext: { margin: "4px 0 0", fontSize: fontSize.base, color: "#767F92" },

        dateBadge: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#fff",
            background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            padding: "8px 14px",
            borderRadius: radius.md,
            whiteSpace: "nowrap",
            boxShadow: `0 6px 16px ${withAlpha(BRAND.blue, 0.28)}`,
        },

        // ---- Top stat cards (Holidays / Birthdays / Announcements / Tasks) ----
        statGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 },
        statGridMobile: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
        statCard: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: "16px 18px",
            boxShadow: "0 4px 16px rgba(0,0,0,.04)",
            display: "flex",
            alignItems: "center",
            gap: 12,
        },
        statIconWrap: {
            width: 42,
            height: 42,
            minWidth: 42,
            borderRadius: radius.md,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        statValue: {
            fontSize: fontSize["3xl"],
            fontWeight: fontWeight.bold,
            color: "#17181C",
            lineHeight: 1.1,
        },
        statLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#3b4a63",
            marginTop: 2,
        },
        statSub: { fontSize: fontSize.xs, color: "#9aa5b6", marginTop: 1 },

        cardsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 },
        cardsGridMobile: { display: "flex", flexDirection: "column", gap: 14 },

        card: {
            background: "#fff",
            borderRadius: radius.lg,
            padding: "18px 20px",
            boxShadow: "0 4px 16px rgba(0,0,0,.04)",
            minHeight: 200,
            display: "flex",
            flexDirection: "column",
        },
        cardHeaderRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
        },
        cardTitleWrap: { display: "flex", alignItems: "center", gap: 10 },
        cardIconBadge: {
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.base,
        },
        cardEyebrow: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#17181C",
        },
        viewAllLink: {
            border: "none",
            background: "transparent",
            color: BRAND.blue,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            padding: 0,
        },
        manageLink: {
            display: "flex",
            alignItems: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: "#7d90a6",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.regular,
            cursor: "pointer",
            padding: 0,
        },

        cardEmpty: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "#9aa5b6",
            fontSize: fontSize.base,
            padding: "18px 0",
            textAlign: "center",
        },
        cardEmptyError: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#b91c1c",
            fontSize: fontSize.base,
        },
        emptyIcon: { fontSize: 30, color: "#c7cedb" },
        smallAddBtn: (BRAND: any) => ({
            border: "none",
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            padding: "9px 20px",
            borderRadius: radius.md,
            cursor: "pointer",
            marginTop: 2,
        }),

        // ---- Bottom tip banner ----
        tipBanner: (BRAND: any) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            background: `linear-gradient(90deg, ${withAlpha(BRAND.blue, 0.05)}, ${withAlpha(BRAND.lightBlue, 0.08)})`,
            border: `1px solid ${withAlpha(BRAND.blue, 0.1)}`,
            borderRadius: radius.lg,
            padding: "16px 22px",
        }),
        tipIconWrap: (BRAND: any) => ({
            width: 44,
            height: 44,
            minWidth: 44,
            borderRadius: radius.circle,
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.lg,
        }),
        tipTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: "#17181C" },
        tipSubtext: { fontSize: fontSize.sm, color: "#7d90a6", marginTop: 2 },

        holidayBody: { flex: 1, display: "flex", alignItems: "center", gap: 10 },
        holidayTextCol: { flex: 1, minWidth: 0 },
        holidayName: {
            fontSize: fontSize["4xl"],
            fontWeight: fontWeight.bold,
            color: BRAND.blue,
            lineHeight: 1.15,
        },
        holidayDate: {
            marginTop: 6,
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#F97316",
        },
        holidayDaysBadge: {
            marginTop: 10,
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.1),
            padding: "4px 10px",
            borderRadius: radius.pill,
        },
        holidayDaysBadgeSmall: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.1),
            padding: "3px 9px",
            borderRadius: radius.pill,
            whiteSpace: "nowrap",
        },
        arrowBtn: {
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: radius.circle,
            border: "1px solid #eef0f3",
            background: "#fff",
            color: "#7d90a6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: fontSize.lg,
        },
        arrowBtnDisabled: { opacity: 0.35, cursor: "default" },

        birthdayList: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: 1,
            justifyContent: "center",
        },
        birthdayRow: { display: "flex", alignItems: "center", gap: 10 },
        birthdayAvatar: {
            width: 36,
            height: 36,
            minWidth: 36,
            borderRadius: radius.circle,
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        birthdayAvatarImg: {
            width: 36,
            height: 36,
            minWidth: 36,
            borderRadius: radius.circle,
            objectFit: "cover",
        },
        birthdayName: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#16233a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        birthdayDept: { fontSize: fontSize.xs, color: "#9aa5b6" },
        birthdayDateCol: { textAlign: "right", flexShrink: 0 },
        birthdayDaysTag: { fontSize: fontSize.xxs, color: "#9aa5b6", marginTop: 2 },

        /* ---- Modal ---- */
        modalOverlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(17,20,30,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
        },
        modalCard: {
            background: "#fff",
            borderRadius: radius.lg,
            width: "100%",
            maxWidth: 460,
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
        },
        modalHeader: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid #f1f2f4",
        },
        modalTitle: {
            margin: 0,
            fontSize: fontSize.xl,
            fontWeight: fontWeight.bold,
            color: "#17181C",
        },
        modalCloseBtn: {
            border: "none",
            background: "transparent",
            color: "#7d90a6",
            cursor: "pointer",
            fontSize: fontSize.lg,
            display: "flex",
        },
        modalTabRow: { display: "flex", gap: 8, padding: "12px 20px 0" },
        modalTabBtn: {
            border: "1px solid #e4e9f2",
            background: "#fff",
            color: "#3b4a63",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            padding: "6px 12px",
            borderRadius: radius.md,
            cursor: "pointer",
        },
        modalTabBtnActive: (BRAND: any) => ({
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            border: "1px solid transparent",
        }),
        modalBody: { padding: "16px 20px 20px", overflowY: "auto" },
        modalListRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: radius.md,
            border: "1px solid #f1f2f4",
        },
        modalListRowName: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#16233a",
        },
        modalListRowDate: { fontSize: fontSize.xs, color: "#9aa5b6", marginTop: 2 },
        rowDeleteBtn: {
            border: "none",
            background: "transparent",
            color: "#b91c1c",
            cursor: "pointer",
            fontSize: fontSize.base,
        },
        modalLabel: { display: "block", fontSize: fontSize.xs, color: "#7d90a6", marginBottom: 4 },
        modalInput: {
            width: "100%",
            boxSizing: "border-box",
            padding: "9px 12px",
            borderRadius: radius.sm,
            border: "1px solid #e4e9f2",
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
        },
        modalHint: { fontSize: fontSize.sm, color: "#7d90a6", margin: 0 },
        modalError: { fontSize: fontSize.sm, color: "#b91c1c" },
        modalPrimaryBtn: (BRAND: any) => ({
            border: "none",
            background: `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})`,
            color: "#fff",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            padding: "10px 16px",
            borderRadius: radius.md,
            cursor: "pointer",
        }),
        modalSecondaryBtn: (BRAND: any) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            border: `1px solid ${withAlpha(BRAND.blue, 0.3)}`,
            background: "#fff",
            color: BRAND.blue,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            padding: "9px 14px",
            borderRadius: radius.md,
            cursor: "pointer",
        }),
        bulkResultRow: { fontSize: fontSize.xs, display: "flex", alignItems: "center", gap: 6 },
    };
}
