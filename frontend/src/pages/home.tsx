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
// Recolored to the warm, editorial (cream / olive / terracotta) palette
// used across the Home page's holidays & birthdays layout.
const STAT_COLORS = {
    holidays: { icon: "#8A6D3B", bg: "#F3EEE1" },
    birthdays: { icon: "#B45F3E", bg: "#FBEAE2" },
    anniversaries: { icon: "#9C6B3E", bg: "#F1E5D8" },
    newJoinees: { icon: "#3F7A5C", bg: "#E2F0E8" },
    announcements: { icon: "#5B7065", bg: "#EAF0EA" },
};

// Rotating badge palette for the "All Holidays" grid (month/day chips) —
// cycled by list position so the grid reads as colorful, not by any
// particular meaning per color. Muted, earthy tones to match the warm
// editorial palette.
const HOLIDAY_BADGE_COLORS = [
    { bg: "#F3EEE1", text: "#8A6D3B" },
    { bg: "#FBEAE2", text: "#B45F3E" },
    { bg: "#EAF0EA", text: "#5B7065" },
    { bg: "#F1E5D8", text: "#9C6B3E" },
    { bg: "#EDEDE3", text: "#6B6650" },
    { bg: "#F6E7D8", text: "#A8763F" },
];

// Warm, editorial page palette (cream background, olive/tan accents,
// serif headings) — the "featured program" / "action center" look.
const WARM = {
    bg: "#F7F5F0",
    card: "#FFFFFF",
    border: "#EAE3D4",
    ink: "#1F2A24",
    subtext: "#6B7566",
    eyebrow: "#8A6D3B",
    pillBorder: "#DCD3BE",
};

// Editorial serif for the warm Home-page headings — kept local to this
// file (not in the shared theme.ts) since it's specific to this page's
// look, not an app-wide token. Loaded via Google Fonts in index.html.
const SERIF_FONT = "'Playfair Display', Georgia, 'Times New Roman', serif";

// Shared illustration sizing — kept in one place so the four "hero"
// graphics (holiday icon, birthday cake, trophy, welcome badge) can be
// resized together and stay visually consistent. The Holidays card's
// right-side icon is deliberately larger (its dedicated hero slot);
// its left-side icon and the other three cards' illustrations share
// ILLUSTRATION_SIZE.
const ILLUSTRATION_SIZE = 150;
const HOLIDAY_HERO_SIZE = 210;
// Trophy/WelcomeBadge/BirthdayHero are drawn in a 130x110 viewBox
// (≈1.182:1) — this derives the matching height for ILLUSTRATION_SIZE
// so they scale without distortion.
const ILLUSTRATION_HEIGHT = Math.round(ILLUSTRATION_SIZE * (110 / 130));

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

// Time-based greeting for the page header — before 12pm "Good Morning",
// until 4pm "Good Afternoon", until 8pm "Good Evening", after that
// "Good Night".
function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 16) return "Good Afternoon";
    if (hour < 20) return "Good Evening";
    return "Good Night";
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
    return { iso, daysUntil, years: next.getFullYear() - d.getFullYear() };
}

// Like nextOccurrenceInfo, but for events that have already happened
// (joining date) rather than recurring future ones — returns how many
// whole days have passed since the date's most recent month/day match,
// used for the "New Joinees" list (Keka-style: show who joined recently).
function daysSinceLastOccurrence(dateStr: string) {
    const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const joined = new Date(d);
    joined.setHours(0, 0, 0, 0);
    const daysSince = Math.round((today.getTime() - joined.getTime()) / 86400000);
    return { daysSince };
}

function daysAgoLabel(n: number) {
    if (n === 0) return "Joined today";
    if (n === 1) return "Joined yesterday";
    return `Joined ${n} days ago`;
}

function yearsLabel(n: number) {
    if (n <= 0) return "1st anniversary";
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix} anniversary`;
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
    isPast?: boolean;
}

interface Employee {
    id: string;
    name: string;
    dateOfBirth: string | null;
    joiningDate?: string | null;
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

interface Anniversary {
    id: string;
    name: string;
    department?: string | null;
    designation?: string | null;
    photoUrl?: string | null;
    nextOccurrence: string;
    daysUntil: number;
    years: number;
}

interface NewJoinee {
    id: string;
    name: string;
    department?: string | null;
    designation?: string | null;
    photoUrl?: string | null;
    joiningDate: string;
    daysSince: number;
}

interface WishPost {
    id: string;
    photo: string | null;
    message: string;
    postedAt: string;
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
    const [showPostModal, setShowPostModal] = useState(false);
    const [wishPosts, setWishPosts] = useState<WishPost[]>([]);
    const [showAnniversariesModal, setShowAnniversariesModal] = useState(false);
    const [showNewJoineesModal, setShowNewJoineesModal] = useState(false);

    const fetchHolidays = async () => {
        setHolidaysLoading(true);
        setHolidaysError("");
        try {
            const res = await authFetch(`${API_BASE}/api/holidays`);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json?.message || `HTTP ${res.status}`);
            setHolidays(json.data || []);
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

    const currentYear = new Date().getFullYear();

    // Re-anchor every holiday's month/day to THIS calendar year only. The
    // backend rolls an already-passed date into next year (so a recurring
    // holiday keeps "coming up" every year for the modal's cross-year
    // logic) — but the Home page carousel must stay strictly within
    // Jan 1 – Dec 31 of the current year, with past dates flagged
    // (rendered muted/disabled) rather than jumping into next year.
    const yearHolidays: Holiday[] = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return holidays
            .map((h) => {
                const [, mo, d] = h.date.split("-").map(Number);
                const thisYearDate = new Date(currentYear, mo - 1, d);
                const daysUntil = Math.round((thisYearDate.getTime() - today.getTime()) / 86400000);
                return {
                    ...h,
                    nextOccurrence: `${currentYear}-${pad2(mo)}-${pad2(d)}`,
                    daysUntil,
                    isPast: thisYearDate < today,
                } as Holiday;
            })
            .sort(
                (a, b) =>
                    new Date(`${a.nextOccurrence}T00:00:00`).getTime() -
                    new Date(`${b.nextOccurrence}T00:00:00`).getTime()
            );
    }, [holidays, currentYear]);

    // Land the carousel on the soonest upcoming (or today's) holiday by
    // default, rather than always starting at Jan 1 — but browsing with
    // the arrows/dots still only ever moves within yearHolidays (Jan→Dec
    // of the current year), never past Dec 31.
    useEffect(() => {
        if (yearHolidays.length === 0) return;
        const nextIdx = yearHolidays.findIndex((h) => !h.isPast);
        setHolidayIndex(nextIdx === -1 ? 0 : nextIdx);
    }, [holidays]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Same pattern as birthdays, but off "Date of Joining" — years counted
    // as (next occurrence year − joining year), Keka-style "Nth anniversary".
    const allAnniversariesSorted: Anniversary[] = useMemo(() => {
        return employees
            .filter((e) => !!e.joiningDate)
            .map((e) => {
                const info = nextOccurrenceInfo(e.joiningDate as string);
                if (!info || info.years <= 0) return null; // skip employees not yet at their 1st anniversary
                return {
                    id: e.id,
                    name: e.name,
                    department: e.department,
                    designation: e.designation,
                    photoUrl: e.photoUrl,
                    nextOccurrence: info.iso,
                    daysUntil: info.daysUntil,
                    years: info.years,
                } as Anniversary;
            })
            .filter((a): a is Anniversary => !!a)
            .sort((a, b) => a.daysUntil - b.daysUntil);
    }, [employees]);

    const upcomingAnniversaries = useMemo(
        () => allAnniversariesSorted.filter((a) => a.daysUntil <= 30),
        [allAnniversariesSorted]
    );

    // "New Joinee" = joined in the last 30 days — most recent first.
    const newJoineesSorted: NewJoinee[] = useMemo(() => {
        return employees
            .filter((e) => !!e.joiningDate)
            .map((e) => {
                const info = daysSinceLastOccurrence(e.joiningDate as string);
                if (!info || info.daysSince < 0 || info.daysSince > 30) return null;
                return {
                    id: e.id,
                    name: e.name,
                    department: e.department,
                    designation: e.designation,
                    photoUrl: e.photoUrl,
                    joiningDate: e.joiningDate as string,
                    daysSince: info.daysSince,
                } as NewJoinee;
            })
            .filter((j): j is NewJoinee => !!j)
            .sort((a, b) => a.daysSince - b.daysSince);
    }, [employees]);

    const todayNice = formatNiceDate(
        `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`
    );

    const currentHoliday = yearHolidays[holidayIndex] || null;

    // ---- Top stat cards ----
    // Counts reflect TODAY only (daysUntil === 0), not the upcoming window.
    const holidaysTodayCount = yearHolidays.filter((h) => h.daysUntil === 0).length;
    const birthdaysTodayCount = allBirthdaysSorted.filter((b) => b.daysUntil === 0).length;
    const anniversariesTodayCount = allAnniversariesSorted.filter((a) => a.daysUntil === 0).length;
    const newJoineesTodayCount = newJoineesSorted.filter((j) => j.daysSince === 0).length;

    const statCards = [
        {
            key: "holidays",
            icon: "ti ti-calendar-event",
            value: holidaysTodayCount,
            label: "Holidays",
            sub: "Today",
            colors: STAT_COLORS.holidays,
        },
        {
            key: "birthdays",
            icon: "ti ti-cake",
            value: birthdaysTodayCount,
            label: "Birthdays",
            sub: "Today",
            colors: STAT_COLORS.birthdays,
        },
        {
            key: "anniversaries",
            icon: "ti ti-award",
            value: anniversariesTodayCount,
            label: "Anniversaries",
            sub: "Today",
            colors: STAT_COLORS.anniversaries,
        },
        {
            key: "newJoinees",
            icon: "ti ti-user-plus",
            value: newJoineesTodayCount,
            label: "New Joiners",
            sub: "This month",
            colors: STAT_COLORS.newJoinees,
        },
        {
            // Placeholder — no announcements module exists yet, shown as "—"
            // rather than a made-up number so the card isn't misleading.
            key: "announcements",
            icon: "ti ti-speakerphone",
            value: "—",
            label: "Announcements",
            sub: "Today",
            colors: STAT_COLORS.announcements,
        },
    ];

    return (
        <div style={isMobile ? styles.rootMobile : styles.root}>
            <div style={styles.topBar} />
            <div style={isMobile ? styles.contentBodyMobile : styles.contentBody}>
                <div style={isMobile ? styles.headerRowMobile : styles.headerRow}>
                    <div>
                        <h2 style={styles.pageTitle}>
                            {displayName
                                ? `${getGreeting()}, ${displayName}! 👋`
                                : `${getGreeting()}! 👋`}
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
                            position: "relative",
                            overflow: "hidden",
                        }}
                    >
                        <GarlandLights />
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

                                {/* Left-side icon — now the LARGE hero size (swapped with
                                    the right side per request). Hidden on mobile — no room
                                    next to the text column and the right-side icon. */}
                                {!isMobile && (
                                    <FestiveIllustration
                                        BRAND={BRAND}
                                        name={currentHoliday.name}
                                        size={HOLIDAY_HERO_SIZE}
                                    />
                                )}

                                <div style={styles.holidayTextCol}>
                                    <div
                                        style={{
                                            ...styles.holidayName,
                                            ...(currentHoliday.isPast ? { color: "#A9A79C" } : {}),
                                        }}
                                    >
                                        {currentHoliday.name}
                                    </div>
                                    <div
                                        style={{
                                            ...styles.holidayDate,
                                            ...(currentHoliday.isPast ? { color: "#A9A79C" } : {}),
                                        }}
                                    >
                                        {formatNiceDate(currentHoliday.nextOccurrence)}
                                    </div>
                                    <div
                                        style={{
                                            ...styles.holidayDaysBadge,
                                            ...(currentHoliday.isPast
                                                ? { background: "#EFEDE6", color: "#A9A79C" }
                                                : {}),
                                        }}
                                    >
                                        {currentHoliday.isPast
                                            ? "Past"
                                            : daysUntilLabel(currentHoliday.daysUntil)}
                                    </div>
                                </div>

                                {/* Right-side icon — now the smaller size (swapped with the
                                    left side per request): left = large hero, right =
                                    ILLUSTRATION_SIZE (same size used on the other 3 cards). */}
                                <FestiveIllustration
                                    BRAND={BRAND}
                                    name={currentHoliday.name}
                                    size={ILLUSTRATION_SIZE}
                                />

                                <button
                                    style={{
                                        ...styles.arrowBtn,
                                        ...(holidayIndex >= yearHolidays.length - 1
                                            ? styles.arrowBtnDisabled
                                            : {}),
                                    }}
                                    disabled={holidayIndex >= yearHolidays.length - 1}
                                    onClick={() =>
                                        setHolidayIndex((i) =>
                                            Math.min(yearHolidays.length - 1, i + 1)
                                        )
                                    }
                                    aria-label="Next holiday"
                                >
                                    <i className="ti ti-chevron-right" aria-hidden="true" />
                                </button>
                            </div>
                        )}

                        {!holidaysLoading && !holidaysError && yearHolidays.length > 1 && (
                            <div style={styles.dotRow}>
                                {yearHolidays.map((h, i) => (
                                    <button
                                        key={h.id}
                                        aria-label={`Go to holiday ${i + 1}`}
                                        onClick={() => setHolidayIndex(i)}
                                        style={{
                                            ...styles.dot,
                                            ...(i === holidayIndex ? styles.dotActive : {}),
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ---------------- Birthdays card ---------------- */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.birthdays.icon}`,
                            position: "relative",
                            overflow: "hidden",
                        }}
                    >
                        <BirthdaysCardBg />
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
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                <button
                                    style={styles.manageLink}
                                    onClick={() => setShowPostModal(true)}
                                >
                                    <i className="ti ti-plus" aria-hidden="true" /> Post
                                </button>
                                <button
                                    style={styles.viewAllLink}
                                    onClick={() => setShowBirthdaysModal(true)}
                                >
                                    View All
                                </button>
                            </div>
                        </div>

                        {wishPosts.length > 0 && (
                            <div style={styles.wishPostList}>
                                {wishPosts.map((p) => (
                                    <div key={p.id} style={styles.wishPostRow}>
                                        {p.photo ? (
                                            <img
                                                src={p.photo}
                                                alt=""
                                                style={styles.wishPostPhoto}
                                            />
                                        ) : (
                                            <div style={styles.wishPostPhotoFallback}>
                                                <i className="ti ti-cake" aria-hidden="true" />
                                            </div>
                                        )}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={styles.wishPostMessage}>{p.message}</div>
                                            <div style={styles.wishPostMeta}>{p.postedAt}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {employeesLoading ? (
                            <div style={styles.cardEmpty}>Loading…</div>
                        ) : upcomingBirthdays.length === 0 ? (
                            <div style={styles.cardEmptyRow}>
                                <BirthdayHeroIllustration />
                                <div>
                                    <div style={styles.cardEmptyRowTitle}>No birthdays</div>
                                    <div style={styles.cardEmptyRowSubtitle}>
                                        in the next month.
                                    </div>
                                </div>
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

                <div style={isMobile ? styles.cardsGridMobile : styles.cardsGridEven}>
                    {/* ---------------- Work Anniversaries card ---------------- */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.anniversaries.icon}`,
                            position: "relative",
                            overflow: "hidden",
                        }}
                    >
                        <AnniversariesCardBg />
                        <div style={styles.cardHeaderRow}>
                            <div style={styles.cardTitleWrap}>
                                <div
                                    style={{
                                        ...styles.cardIconBadge,
                                        background: STAT_COLORS.anniversaries.bg,
                                    }}
                                >
                                    <i
                                        className="ti ti-award"
                                        style={{ color: STAT_COLORS.anniversaries.icon }}
                                        aria-hidden="true"
                                    />
                                </div>
                                <span style={styles.cardEyebrow}>Work Anniversaries</span>
                            </div>
                            <button
                                style={styles.viewAllLink}
                                onClick={() => setShowAnniversariesModal(true)}
                            >
                                View All
                            </button>
                        </div>

                        {employeesLoading ? (
                            <div style={styles.cardEmpty}>Loading…</div>
                        ) : upcomingAnniversaries.length === 0 ? (
                            <div style={styles.cardEmptyRow}>
                                <TrophyIllustration />
                                <div>
                                    <div style={styles.cardEmptyRowTitle}>
                                        No work anniversaries
                                    </div>
                                    <div style={styles.cardEmptyRowSubtitle}>
                                        in the next month.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={styles.birthdayList}>
                                {upcomingAnniversaries.slice(0, 5).map((a) => (
                                    <AnniversaryRow key={a.id} a={a} styles={styles} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ---------------- New Joinees card ---------------- */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.newJoinees.icon}`,
                            position: "relative",
                            overflow: "hidden",
                        }}
                    >
                        <NewJoinersCardBg />
                        <div style={styles.cardHeaderRow}>
                            <div style={styles.cardTitleWrap}>
                                <div
                                    style={{
                                        ...styles.cardIconBadge,
                                        background: STAT_COLORS.newJoinees.bg,
                                    }}
                                >
                                    <i
                                        className="ti ti-user-plus"
                                        style={{ color: STAT_COLORS.newJoinees.icon }}
                                        aria-hidden="true"
                                    />
                                </div>
                                <span style={styles.cardEyebrow}>New Joiners</span>
                            </div>
                            <button
                                style={styles.viewAllLink}
                                onClick={() => setShowNewJoineesModal(true)}
                            >
                                View All
                            </button>
                        </div>

                        {employeesLoading ? (
                            <div style={styles.cardEmpty}>Loading…</div>
                        ) : newJoineesSorted.length === 0 ? (
                            <div style={styles.cardEmptyRow}>
                                <WelcomeBadgeIllustration />
                                <div>
                                    <div style={styles.cardEmptyRowTitle}>No new joiners</div>
                                    <div style={styles.cardEmptyRowSubtitle}>
                                        in the last 30 days.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={styles.birthdayList}>
                                {newJoineesSorted.slice(0, 5).map((j) => (
                                    <NewJoineeRow key={j.id} j={j} styles={styles} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ---------------- Bottom tip banner ---------------- */}
                <div style={styles.tipBanner(BRAND)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={styles.tipIconWrap(BRAND)}>
                            <i className="ti ti-star" aria-hidden="true" />
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

            {showPostModal && (
                <PostWishModal
                    onClose={() => setShowPostModal(false)}
                    onPost={(post) => {
                        setWishPosts((prev) => [post, ...prev]);
                        setShowPostModal(false);
                    }}
                    styles={styles}
                    BRAND={BRAND}
                />
            )}

            {showAnniversariesModal && (
                <AnniversariesModal
                    anniversaries={allAnniversariesSorted}
                    onClose={() => setShowAnniversariesModal(false)}
                    styles={styles}
                />
            )}

            {showNewJoineesModal && (
                <NewJoineesModal
                    joinees={newJoineesSorted}
                    onClose={() => setShowNewJoineesModal(false)}
                    styles={styles}
                />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

// Rich, full-color cake + balloons illustration for the Birthdays card's
// empty state — same visual weight/size as the Trophy and Welcome-Badge
// illustrations, so all four cards feel equally "finished" instead of
// this one looking like a plain placeholder.
function BirthdayHeroIllustration() {
    return (
        <svg
            width={ILLUSTRATION_SIZE}
            height={ILLUSTRATION_HEIGHT}
            viewBox="0 0 130 110"
            aria-hidden="true"
        >
            <circle cx="65" cy="52" r="48" fill={STAT_COLORS.birthdays.bg} />
            <ellipse cx="65" cy="100" rx="42" ry="6" fill="rgba(180,95,62,0.08)" />
            {/* balloons */}
            <ellipse cx="95" cy="30" rx="12" ry="15" fill="#F3B4A0" />
            <path d="M95 45 L95 62" stroke="#E3947C" strokeWidth="1.4" />
            <ellipse cx="113" cy="42" rx="9" ry="12" fill="#F6D9A0" />
            <path d="M113 54 L110 68" stroke="#D9B673" strokeWidth="1.4" />
            {/* confetti */}
            <circle cx="34" cy="24" r="2" fill="#B45F3E" />
            <circle cx="20" cy="46" r="1.8" fill="#8A6D3B" />
            <circle cx="108" cy="20" r="1.6" fill="#5B7065" />
            <circle cx="44" cy="16" r="1.4" fill="#B45F3E" />
            {/* cake */}
            <rect x="35" y="76" width="60" height="24" rx="5" fill="#B45F3E" />
            <rect x="35" y="76" width="60" height="8" rx="4" fill="#F3EEE1" />
            <rect x="42" y="58" width="46" height="20" rx="5" fill="#E27B57" />
            <rect x="42" y="58" width="46" height="7" rx="3.5" fill="#F3EEE1" />
            <circle cx="50" cy="90" r="3" fill="#F3EEE1" />
            <circle cx="65" cy="90" r="3" fill="#F2C563" />
            <circle cx="80" cy="90" r="3" fill="#F3EEE1" />
            {/* candles */}
            <rect x="48" y="42" width="4" height="16" rx="1.5" fill="#7FB3D5" />
            <rect x="63" y="36" width="4" height="22" rx="1.5" fill="#F2C563" />
            <rect x="78" y="42" width="4" height="16" rx="1.5" fill="#7FB3D5" />
            <path d="M50 42 Q54 36 50 30 Q46 36 50 42 Z" fill="#F2C563" />
            <path d="M65 36 Q69 30 65 24 Q61 30 65 36 Z" fill="#F2C563" />
            <path d="M80 42 Q84 36 80 30 Q76 36 80 42 Z" fill="#F2C563" />
        </svg>
    );
}

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

function AnniversaryRow({ a, styles }: { a: Anniversary; styles: any }) {
    return (
        <div style={styles.birthdayRow}>
            {a.photoUrl ? (
                <img src={a.photoUrl} alt={a.name} style={styles.birthdayAvatarImg} />
            ) : (
                <div style={styles.birthdayAvatar}>{initials(a.name)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.birthdayName}>{a.name}</div>
                {a.department && <div style={styles.birthdayDept}>{a.department}</div>}
            </div>
            <div style={styles.birthdayDateCol}>
                <div style={styles.holidayDaysBadgeSmall}>{yearsLabel(a.years)}</div>
                <div style={styles.birthdayDaysTag}>{daysUntilLabel(a.daysUntil)}</div>
            </div>
        </div>
    );
}

function NewJoineeRow({ j, styles }: { j: NewJoinee; styles: any }) {
    return (
        <div style={styles.birthdayRow}>
            {j.photoUrl ? (
                <img src={j.photoUrl} alt={j.name} style={styles.birthdayAvatarImg} />
            ) : (
                <div style={styles.birthdayAvatar}>{initials(j.name)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.birthdayName}>{j.name}</div>
                {(j.designation || j.department) && (
                    <div style={styles.birthdayDept}>
                        {[j.designation, j.department].filter(Boolean).join(" · ")}
                    </div>
                )}
            </div>
            <div style={styles.birthdayDateCol}>
                <div style={styles.holidayDaysBadgeSmall}>{formatShortDate(j.joiningDate)}</div>
                <div style={styles.birthdayDaysTag}>{daysAgoLabel(j.daysSince)}</div>
            </div>
        </div>
    );
}

// Soft decorative background scene for the Birthdays card — a small
// cake with balloons and confetti dots, anchored bottom-right and kept
// low-contrast so the actual birthday rows on top stay readable.
function BirthdaysCardBg() {
    return (
        <svg
            width="220"
            height="140"
            viewBox="0 0 220 140"
            style={{
                position: "absolute",
                right: -10,
                bottom: -10,
                pointerEvents: "none",
                opacity: 0.9,
            }}
            aria-hidden="true"
        >
            <path d="M60 140 Q110 100 220 120 L220 140 Z" fill="#FBEAE2" opacity="0.6" />
            {/* balloons */}
            <ellipse cx="168" cy="46" rx="13" ry="16" fill="#F3B4A0" opacity="0.85" />
            <path d="M168 62 L168 78" stroke="#E3947C" strokeWidth="1.2" />
            <ellipse cx="192" cy="62" rx="10" ry="13" fill="#F6D9A0" opacity="0.85" />
            <path d="M192 75 L192 88" stroke="#D9B673" strokeWidth="1.2" />
            {/* confetti */}
            <circle cx="140" cy="30" r="2" fill="#B45F3E" opacity="0.6" />
            <circle cx="205" cy="40" r="1.6" fill="#8A6D3B" opacity="0.6" />
            <circle cx="150" cy="70" r="1.8" fill="#5B7065" opacity="0.5" />
            <circle cx="120" cy="50" r="1.4" fill="#B45F3E" opacity="0.5" />
            {/* cake */}
            <rect x="90" y="96" width="52" height="22" rx="4" fill="#B45F3E" />
            <rect x="90" y="96" width="52" height="7" rx="3.5" fill="#F3EEE1" />
            <rect x="96" y="82" width="40" height="16" rx="4" fill="#E27B57" />
            <rect x="96" y="82" width="40" height="6" rx="3" fill="#F3EEE1" />
            <rect x="112" y="70" width="4" height="12" fill="#F2C563" />
            <path d="M112 66 Q114 62 116 66 Q114 70 112 66 Z" fill="#E0B25A" />
        </svg>
    );
}

// Soft decorative wave + laurel-sparkle background for the Work
// Anniversaries card, matching the warm/olive palette.
function AnniversariesCardBg() {
    return (
        <svg
            width="220"
            height="140"
            viewBox="0 0 220 140"
            style={{
                position: "absolute",
                right: -10,
                bottom: -10,
                pointerEvents: "none",
                opacity: 0.9,
            }}
            aria-hidden="true"
        >
            <path d="M40 140 Q110 95 220 118 L220 140 Z" fill="#F1E5D8" opacity="0.6" />
            <path d="M90 140 Q140 112 220 128 L220 140 Z" fill="#F3EEE1" opacity="0.7" />
            <circle cx="176" cy="46" r="2.2" fill="#C99A3F" opacity="0.6" />
            <circle cx="196" cy="66" r="1.6" fill="#9C6B3E" opacity="0.5" />
            <circle cx="150" cy="60" r="1.4" fill="#C99A3F" opacity="0.5" />
            <path d="M188 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#C99A3F" opacity="0.7" />
        </svg>
    );
}

// Soft decorative wave + leaf background for the New Joiners card,
// matching the sage-green palette.
function NewJoinersCardBg() {
    return (
        <svg
            width="220"
            height="140"
            viewBox="0 0 220 140"
            style={{
                position: "absolute",
                right: -10,
                bottom: -10,
                pointerEvents: "none",
                opacity: 0.9,
            }}
            aria-hidden="true"
        >
            <path d="M40 140 Q110 95 220 118 L220 140 Z" fill="#E2F0E8" opacity="0.6" />
            <path d="M90 140 Q140 112 220 128 L220 140 Z" fill="#EDF5EE" opacity="0.7" />
            <path d="M176 60 Q166 48 176 36 Q186 48 176 60 Z" fill="#9DBF8E" opacity="0.7" />
            <path d="M196 70 Q188 60 196 50 Q204 60 196 70 Z" fill="#B7D3A2" opacity="0.7" />
        </svg>
    );
}

// Decorative festive-lights garland strip across the top of the Holidays
// card — small colored bulbs hanging off a wire, alternating colors,
// tiling seamlessly across any card width via viewBox + preserveAspectRatio.
function GarlandLights() {
    const colors = ["#B45F3E", "#8A6D3B", "#5B7065", "#C99A3F", "#B45F3E", "#5B7065"];
    const bulbs = Array.from({ length: 14 }, (_, i) => i);
    return (
        <svg
            width="100%"
            height="28"
            viewBox="0 0 560 28"
            preserveAspectRatio="none"
            style={{ display: "block", margin: "-22px -24px 14px -24px", flexShrink: 0 }}
            aria-hidden="true"
        >
            <path
                d="M0 2 Q20 16 40 2 T80 2 T120 2 T160 2 T200 2 T240 2 T280 2 T320 2 T360 2 T400 2 T440 2 T480 2 T520 2 T560 2"
                fill="none"
                stroke="#DCD3BE"
                strokeWidth="1.5"
            />
            {bulbs.map((i) => (
                <g key={i} transform={`translate(${20 + i * 40}, 12)`}>
                    <line x1="0" y1="-10" x2="0" y2="0" stroke="#DCD3BE" strokeWidth="1.2" />
                    <circle cx="0" cy="4" r="4.5" fill={colors[i % colors.length]} />
                </g>
            ))}
        </svg>
    );
}

// Detects which small icon set to use for a holiday name, so the
// illustration on the Holidays card actually matches the festival
// instead of showing one generic graphic for everything.
function detectHolidayType(
    name: string
):
    | "diwali"
    | "holi"
    | "christmas"
    | "independence"
    | "rakhi"
    | "eid"
    | "dussehra"
    | "newyear"
    | "gandhi"
    | "guru"
    | "default" {
    const n = (name || "").toLowerCase();
    if (n.includes("diwali") || n.includes("deepavali")) return "diwali";
    if (n.includes("holi")) return "holi";
    if (n.includes("christmas") || n.includes("xmas")) return "christmas";
    if (n.includes("independence")) return "independence";
    if (n.includes("republic")) return "independence";
    if (n.includes("raksha") || n.includes("rakhi")) return "rakhi";
    if (n.includes("eid") || n.includes("bakrid")) return "eid";
    if (n.includes("dussehra") || n.includes("dasara") || n.includes("vijayadashami"))
        return "dussehra";
    if (n.includes("new year")) return "newyear";
    if (n.includes("gandhi")) return "gandhi";
    if (n.includes("guru nanak") || n.includes("gurpurab")) return "guru";
    return "default";
}

// Festival-specific illustration for the Holidays card — swaps its inner
// glyph based on the holiday name (diya for Diwali, tree for Christmas,
// flag for Independence/Republic Day, etc.), falling back to a generic
// celebratory graphic for anything unrecognised, so a brand-new/custom
// holiday still looks intentional.
function FestiveIllustration({
    BRAND,
    name,
    size = 96,
}: {
    BRAND: { blue: string; lightBlue: string; green: string };
    name?: string;
    size?: number;
}) {
    const type = detectHolidayType(name || "");

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
        >
            <circle cx="50" cy="50" r="46" fill={withAlpha(BRAND.lightBlue, 0.1)} />

            {type === "diwali" && (
                <g>
                    <ellipse cx="50" cy="66" rx="20" ry="7" fill="#C2410C" />
                    <path d="M32 62 Q50 74 68 62 Q50 68 32 62 Z" fill="#EA580C" />
                    <path d="M50 34 Q58 46 50 56 Q42 46 50 34 Z" fill="#FACC15" />
                    <path d="M50 40 Q54 47 50 53 Q46 47 50 40 Z" fill="#FB923C" />
                    <circle cx="26" cy="40" r="2.5" fill={BRAND.lightBlue} />
                    <circle cx="74" cy="42" r="2" fill={BRAND.blue} />
                    <circle cx="66" cy="26" r="2.5" fill={BRAND.green} />
                    <circle cx="34" cy="24" r="2" fill={BRAND.blue} />
                </g>
            )}

            {type === "holi" && (
                <g>
                    <circle cx="38" cy="40" r="11" fill="#EC4899" opacity="0.85" />
                    <circle cx="62" cy="36" r="9" fill="#22C55E" opacity="0.85" />
                    <circle cx="58" cy="60" r="12" fill="#F59E0B" opacity="0.85" />
                    <circle cx="34" cy="64" r="8" fill="#3B82F6" opacity="0.85" />
                    <circle cx="50" cy="50" r="6" fill="#A855F7" opacity="0.9" />
                    <circle cx="24" cy="30" r="2.5" fill="#EC4899" />
                    <circle cx="74" cy="56" r="2.5" fill="#22C55E" />
                    <circle cx="70" cy="70" r="2" fill="#3B82F6" />
                </g>
            )}

            {type === "christmas" && (
                <g>
                    {/* falling snow */}
                    <circle cx="20" cy="18" r="1.6" fill="#DCEFFA" />
                    <circle cx="80" cy="22" r="1.3" fill="#DCEFFA" />
                    <circle cx="14" cy="46" r="1.4" fill="#DCEFFA" />
                    <circle cx="86" cy="52" r="1.6" fill="#DCEFFA" />
                    <circle cx="30" cy="12" r="1.1" fill="#DCEFFA" />
                    {/* gift boxes at the tree's base */}
                    <rect x="30" y="78" width="14" height="12" rx="1.5" fill="#B45F3E" />
                    <rect x="30" y="82" width="14" height="3" fill="#F2C563" />
                    <rect x="36" y="78" width="2.5" height="12" fill="#F2C563" />
                    <rect x="58" y="80" width="12" height="10" rx="1.5" fill="#5B7065" />
                    <rect x="58" y="83.5" width="12" height="2.5" fill="#F2C563" />
                    <rect x="63" y="80" width="2" height="10" fill="#F2C563" />
                    {/* tree, built from 3 stacked tiers */}
                    <path
                        d="M50 22 L60 38 L54 38 L62 50 L55 50 L64 64 L36 64 L45 50 L38 50 L46 38 L40 38 Z"
                        fill="#4C7A5C"
                    />
                    <path
                        d="M50 22 L60 38 L54 38 L62 50 L55 50 L64 64 L50 64 Z"
                        fill="#5F8F6C"
                        opacity="0.55"
                    />
                    <rect x="46" y="64" width="8" height="10" rx="1.5" fill="#92400E" />
                    {/* star topper */}
                    <path
                        d="M50 14 L52.3 19.3 L58 19.8 L53.8 23.6 L55 29.2 L50 26.2 L45 29.2 L46.2 23.6 L42 19.8 L47.7 19.3 Z"
                        fill="#F2C563"
                    />
                    {/* ornaments */}
                    <circle cx="44" cy="46" r="2.2" fill="#D9534F" />
                    <circle cx="57" cy="43" r="2" fill="#7FB3D5" />
                    <circle cx="47" cy="57" r="2.2" fill="#F2C563" />
                    <circle cx="59" cy="58" r="2" fill="#D9534F" />
                    <circle cx="41" cy="60" r="1.8" fill="#7FB3D5" />
                </g>
            )}

            {type === "independence" && (
                <g>
                    <rect x="40" y="24" width="3" height="50" rx="1.5" fill="#6B7280" />
                    <rect x="43" y="26" width="26" height="7" fill="#F97316" />
                    <rect
                        x="43"
                        y="33"
                        width="26"
                        height="7"
                        fill="#F8FAFC"
                        stroke="#e5e7eb"
                        strokeWidth="0.5"
                    />
                    <rect x="43" y="40" width="26" height="7" fill="#16A34A" />
                    <circle cx="56" cy="36.5" r="3" fill="none" stroke="#1D4ED8" strokeWidth="1" />
                </g>
            )}

            {type === "guru" && (
                <g>
                    {/* domed shrine silhouette with a small pennant — kept generic/simple */}
                    <rect
                        x="34"
                        y="52"
                        width="32"
                        height="24"
                        rx="2"
                        fill={withAlpha(BRAND.blue, 0.18)}
                    />
                    <path d="M34 52 Q50 30 66 52 Z" fill={withAlpha(BRAND.blue, 0.28)} />
                    <circle cx="50" cy="28" r="3" fill={BRAND.blue} />
                    <rect x="49" y="18" width="2" height="10" fill="#6B7280" />
                    <path d="M51 19 L60 22 L51 25 Z" fill="#F97316" />
                    <rect x="40" y="60" width="6" height="16" rx="1" fill="#fff" />
                    <rect x="54" y="60" width="6" height="16" rx="1" fill="#fff" />
                    <circle cx="30" cy="40" r="2" fill={BRAND.lightBlue} />
                    <circle cx="70" cy="42" r="2" fill={BRAND.green} />
                </g>
            )}

            {type === "rakhi" && (
                <g>
                    <circle cx="50" cy="48" r="14" fill="none" stroke="#DC2626" strokeWidth="3" />
                    <circle cx="50" cy="48" r="7" fill="#FACC15" />
                    <circle cx="50" cy="48" r="3" fill="#DC2626" />
                    <path
                        d="M50 34 L50 22"
                        stroke="#DC2626"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />
                    <path
                        d="M50 62 L50 74"
                        stroke="#DC2626"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                    />
                    <circle cx="38" cy="40" r="2" fill={BRAND.lightBlue} />
                    <circle cx="62" cy="56" r="2" fill={BRAND.green} />
                </g>
            )}

            {type === "eid" && (
                <g>
                    <path d="M58 26 A22 22 0 1 0 58 74 A17 17 0 1 1 58 26 Z" fill="#16A34A" />
                    <path
                        d="M68 34 L70.5 40 L77 40.5 L72 44.5 L73.5 51 L68 47.3 L62.5 51 L64 44.5 L59 40.5 L65.5 40 Z"
                        fill="#FACC15"
                    />
                </g>
            )}

            {type === "dussehra" && (
                <g>
                    <path
                        d="M32 30 Q52 50 32 70"
                        stroke="#92400E"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                    />
                    <path
                        d="M32 30 L34 30 L32 50 L34 70 L32 70"
                        stroke="#92400E"
                        strokeWidth="1"
                        fill="none"
                    />
                    <path d="M32 30 L74 50 L32 70" stroke="#78350F" strokeWidth="1.5" fill="none" />
                    <path d="M60 46 L76 50 L60 54 L64 50 Z" fill="#B91C1C" />
                </g>
            )}

            {type === "newyear" && (
                <g>
                    <circle cx="50" cy="46" r="4" fill="#F97316" />
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                        <line
                            key={deg}
                            x1={50 + 8 * Math.cos((deg * Math.PI) / 180)}
                            y1={46 + 8 * Math.sin((deg * Math.PI) / 180)}
                            x2={50 + 18 * Math.cos((deg * Math.PI) / 180)}
                            y2={46 + 18 * Math.sin((deg * Math.PI) / 180)}
                            stroke={deg % 90 === 0 ? BRAND.blue : "#F59E0B"}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                        />
                    ))}
                    <circle cx="26" cy="68" r="2.5" fill={BRAND.green} />
                    <circle cx="72" cy="66" r="2" fill={BRAND.blue} />
                    <circle cx="66" cy="76" r="2.5" fill="#F59E0B" />
                </g>
            )}

            {type === "gandhi" && (
                <g>
                    <circle
                        cx="50"
                        cy="48"
                        r="16"
                        fill="none"
                        stroke={BRAND.blue}
                        strokeWidth="2.5"
                    />
                    <circle cx="50" cy="48" r="3" fill={BRAND.blue} />
                    {[0, 60, 120, 180, 240, 300].map((deg) => (
                        <line
                            key={deg}
                            x1={50 + 3 * Math.cos((deg * Math.PI) / 180)}
                            y1={48 + 3 * Math.sin((deg * Math.PI) / 180)}
                            x2={50 + 16 * Math.cos((deg * Math.PI) / 180)}
                            y2={48 + 16 * Math.sin((deg * Math.PI) / 180)}
                            stroke={BRAND.blue}
                            strokeWidth="1.5"
                        />
                    ))}
                    <rect x="30" y="66" width="40" height="4" rx="2" fill={BRAND.lightBlue} />
                </g>
            )}

            {type === "default" && (
                <g>
                    <path
                        d="M18 34 L34 44 L26 58 Z"
                        fill={BRAND.blue}
                        transform="rotate(-10 26 46)"
                    />
                    <path
                        d="M40 26 L56 34 L46 48 Z"
                        fill={BRAND.lightBlue}
                        transform="rotate(8 46 36)"
                    />
                    <path
                        d="M60 32 L76 40 L66 54 Z"
                        fill={BRAND.green}
                        transform="rotate(-6 68 42)"
                    />
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
                </g>
            )}
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

// Gold trophy + laurel wreath for the empty "Work Anniversaries" state —
// matches the warm/editorial palette rather than BRAND, since it's a
// celebratory, fixed-tone illustration (like the birthday cake).
function TrophyIllustration() {
    return (
        <svg
            width={ILLUSTRATION_SIZE}
            height={ILLUSTRATION_HEIGHT}
            viewBox="0 0 130 110"
            aria-hidden="true"
        >
            <circle cx="65" cy="52" r="48" fill={STAT_COLORS.anniversaries.bg} />
            <ellipse cx="65" cy="98" rx="40" ry="6" fill="rgba(154,120,64,0.08)" />
            {/* laurel wreath */}
            <path
                d="M40 70 Q20 55 30 30 Q34 45 44 55"
                fill="none"
                stroke="#B7C79A"
                strokeWidth="5"
                strokeLinecap="round"
            />
            <path
                d="M90 70 Q110 55 100 30 Q96 45 86 55"
                fill="none"
                stroke="#B7C79A"
                strokeWidth="5"
                strokeLinecap="round"
            />
            {[0, 1, 2].map((i) => (
                <ellipse
                    key={`l-${i}`}
                    cx={33 + i * 4}
                    cy={40 + i * 10}
                    rx="6"
                    ry="3.5"
                    fill="#B7C79A"
                    transform={`rotate(${-40 + i * 10} ${33 + i * 4} ${40 + i * 10})`}
                />
            ))}
            {[0, 1, 2].map((i) => (
                <ellipse
                    key={`r-${i}`}
                    cx={97 - i * 4}
                    cy={40 + i * 10}
                    rx="6"
                    ry="3.5"
                    fill="#B7C79A"
                    transform={`rotate(${40 - i * 10} ${97 - i * 4} ${40 + i * 10})`}
                />
            ))}
            {/* trophy cup */}
            <rect x="52" y="78" width="26" height="6" rx="2" fill="#C99A3F" />
            <rect x="60" y="68" width="10" height="12" fill="#E0B25A" />
            <path d="M42 34 h46 v10 q0 20 -23 24 q-23 -4 -23 -24 Z" fill="#F2C563" />
            <path
                d="M42 34 h46 v10 q0 20 -23 24 q-23 -4 -23 -24 Z"
                fill="none"
                stroke="#C99A3F"
                strokeWidth="2"
            />
            <path
                d="M42 36 q-12 0 -12 12 q0 10 12 12"
                fill="none"
                stroke="#E0B25A"
                strokeWidth="4"
            />
            <path
                d="M88 36 q12 0 12 12 q0 10 -12 12"
                fill="none"
                stroke="#E0B25A"
                strokeWidth="4"
            />
            <circle cx="65" cy="24" r="5" fill="#F6D98A" />
            <path d="M60 24 h10 M65 19 v10" stroke="#C99A3F" strokeWidth="1.5" />
        </svg>
    );
}

// ID-badge-with-plant "Welcome" illustration for the empty "New Joiners"
// state — same flat, pastel treatment as the other empty-state graphics.
function WelcomeBadgeIllustration() {
    return (
        <svg
            width={ILLUSTRATION_SIZE}
            height={ILLUSTRATION_HEIGHT}
            viewBox="0 0 130 110"
            aria-hidden="true"
        >
            <ellipse cx="65" cy="100" rx="42" ry="6" fill="rgba(63,122,92,0.08)" />
            {/* plant */}
            <path d="M30 100 V80" stroke="#7FA383" strokeWidth="4" strokeLinecap="round" />
            <path d="M30 82 Q18 78 16 64 Q30 66 33 80 Z" fill="#9DBF8E" />
            <path d="M30 88 Q42 84 44 70 Q30 72 27 86 Z" fill="#B7D3A2" />
            {/* badge lanyard */}
            <rect x="60" y="16" width="10" height="18" rx="3" fill="#7FA383" />
            <rect
                x="45"
                y="32"
                width="40"
                height="56"
                rx="8"
                fill="#FFFFFF"
                stroke="#DCD3BE"
                strokeWidth="2"
            />
            <rect x="45" y="32" width="40" height="14" rx="8" fill="#3F7A5C" />
            <circle cx="65" cy="62" r="10" fill="#E2F0E8" />
            <circle cx="65" cy="58" r="4" fill="#3F7A5C" />
            <path d="M57 70 q8 -8 16 0" fill="#3F7A5C" />
            <rect x="55" y="78" width="20" height="4" rx="2" fill="#DCD3BE" />
            <text
                x="65"
                y="42"
                textAnchor="middle"
                fontSize="6"
                fontWeight="700"
                fill="#fff"
                fontFamily="sans-serif"
            >
                WELCOME
            </text>
            {/* sparkles */}
            <path d="M100 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#C99A3F" />
            <path
                d="M100 66 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 Z"
                fill="#7FA383"
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

    // Only the current calendar year — no cross-year browsing.
    const currentYear = new Date().getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Use the holiday's stored date (not the rolled-forward nextOccurrence)
    // so already-passed holidays this year still show, and chronological
    // order runs Jan -> Dec instead of "soonest first" (which would push
    // passed dates to the bottom/wrap them into next year).
    const sorted = [...holidays]
        .filter((h) => new Date(`${h.date}T00:00:00`).getFullYear() === currentYear)
        .sort(
            (a, b) =>
                new Date(`${a.date}T00:00:00`).getTime() - new Date(`${b.date}T00:00:00`).getTime()
        );

    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <h3 style={styles.modalTitle}>Holidays</h3>
                        <span style={styles.modalYearTag}>{currentYear}</span>
                    </div>
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
                                <div style={styles.cardEmpty}>No Holidays to show.</div>
                            ) : (
                                <div style={styles.holidayGrid}>
                                    {sorted.map((h, i) => {
                                        const d = new Date(`${h.date}T00:00:00`);
                                        const isPast = d < today;
                                        const palette =
                                            HOLIDAY_BADGE_COLORS[i % HOLIDAY_BADGE_COLORS.length];
                                        return (
                                            <div
                                                key={h.id}
                                                style={{
                                                    ...styles.holidayGridItem,
                                                    ...(isPast ? styles.holidayGridItemPast : {}),
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        ...styles.holidayBadge,
                                                        background: isPast ? "#EFEDE6" : palette.bg,
                                                        color: isPast ? "#A9A79C" : palette.text,
                                                    }}
                                                >
                                                    <div style={styles.holidayBadgeMonth}>
                                                        {d
                                                            .toLocaleDateString("en-US", {
                                                                month: "short",
                                                            })
                                                            .toUpperCase()}
                                                    </div>
                                                    <div style={styles.holidayBadgeDay}>
                                                        {pad2(d.getDate())}
                                                    </div>
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div
                                                        style={{
                                                            ...styles.modalListRowName,
                                                            ...(isPast ? { color: "#A9A79C" } : {}),
                                                        }}
                                                    >
                                                        {h.name}
                                                    </div>
                                                    <div style={styles.modalListRowDate}>
                                                        {d.toLocaleDateString("en-US", {
                                                            weekday: "long",
                                                        })}
                                                        {isPast && " · Past"}
                                                    </div>
                                                </div>
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
                                        );
                                    })}
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

function AnniversariesModal({
    anniversaries,
    onClose,
    styles,
}: {
    anniversaries: Anniversary[];
    onClose: () => void;
    styles: any;
}) {
    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Work Anniversaries</h3>
                    <button style={styles.modalCloseBtn} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>
                <div style={styles.modalBody}>
                    {anniversaries.length === 0 ? (
                        <div style={styles.cardEmpty}>No employee joining dates on file yet.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {anniversaries.map((a) => (
                                <AnniversaryRow key={a.id} a={a} styles={styles} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function NewJoineesModal({
    joinees,
    onClose,
    styles,
}: {
    joinees: NewJoinee[];
    onClose: () => void;
    styles: any;
}) {
    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>New Joiners</h3>
                    <button style={styles.modalCloseBtn} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>
                <div style={styles.modalBody}>
                    {joinees.length === 0 ? (
                        <div style={styles.cardEmpty}>No one has joined in the last 30 days.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {joinees.map((j) => (
                                <NewJoineeRow key={j.id} j={j} styles={styles} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Simple compose template — just a photo and a message, then Post.
// Kept intentionally minimal per the requirement: no extra fields.
function PostWishModal({
    onClose,
    onPost,
    styles,
    BRAND,
}: {
    onClose: () => void;
    onPost: (post: WishPost) => void;
    styles: any;
    BRAND: any;
}) {
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const handlePhotoChange = (file: File | null) => {
        setPhotoFile(file);
        if (!file) {
            setPhotoPreview(null);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => setPhotoPreview(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSubmit = () => {
        if (!photoFile && !message.trim()) {
            setError("Add a photo or write a message first.");
            return;
        }
        onPost({
            id: `${Date.now()}`,
            photo: photoPreview,
            message: message.trim(),
            postedAt: "Just now",
        });
    };

    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Post a Wish</h3>
                    <button style={styles.modalCloseBtn} onClick={onClose} aria-label="Close">
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </div>
                <div style={styles.modalBody}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div>
                            <label style={styles.modalLabel}>Photo</label>
                            {photoPreview ? (
                                <div style={styles.postPhotoPreviewWrap}>
                                    <img
                                        src={photoPreview}
                                        alt=""
                                        style={styles.postPhotoPreview}
                                    />
                                    <button
                                        style={styles.postPhotoRemoveBtn}
                                        onClick={() => handlePhotoChange(null)}
                                        aria-label="Remove photo"
                                    >
                                        <i className="ti ti-x" aria-hidden="true" />
                                    </button>
                                </div>
                            ) : (
                                <label style={styles.postPhotoDrop}>
                                    <i className="ti ti-camera-plus" aria-hidden="true" />
                                    <span>Add a photo</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        style={{ display: "none" }}
                                        onChange={(e) =>
                                            handlePhotoChange(e.target.files?.[0] || null)
                                        }
                                    />
                                </label>
                            )}
                        </div>
                        <div>
                            <label style={styles.modalLabel}>Message</label>
                            <textarea
                                style={styles.modalTextarea}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Write a birthday wish…"
                                rows={4}
                            />
                        </div>
                        {error && <div style={styles.modalError}>{error}</div>}
                        <button style={styles.modalPrimaryBtn(BRAND)} onClick={handleSubmit}>
                            Post
                        </button>
                    </div>
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
            background: WARM.bg,
            fontFamily: fontFamily.base,
        },
        rootMobile: {
            width: "100%",
            minHeight: "100%",
            background: WARM.bg,
            fontFamily: fontFamily.base,
        },
        topBar: {
            height: "3px",
            width: "100%",
            background: `linear-gradient(90deg, ${WARM.eyebrow}, #B45F3E, ${WARM.eyebrow})`,
        },
        contentBody: {
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            padding: "24px 28px 32px",
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
            fontFamily: SERIF_FONT,
            fontSize: fontSize["6xl"],
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            letterSpacing: "-0.01em",
        },
        headerSubtext: { margin: "6px 0 0", fontSize: fontSize.base, color: WARM.subtext },

        dateBadge: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: WARM.eyebrow,
            background: "#fff",
            border: `1px solid ${WARM.pillBorder}`,
            padding: "8px 16px",
            borderRadius: radius.pill,
            whiteSpace: "nowrap",
        },

        // ---- Top stat cards (Holidays / Birthdays / Announcements) ----
        statGrid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 16,
        },
        statGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 10 },
        statCard: {
            background: WARM.card,
            border: `1px solid ${WARM.border}`,
            borderRadius: radius.xl,
            padding: "16px 18px",
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
            fontFamily: SERIF_FONT,
            fontSize: fontSize["3xl"],
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            lineHeight: 1.1,
        },
        statLabel: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            marginTop: 2,
        },
        statSub: {
            fontSize: fontSize.xs,
            color: WARM.subtext,
            marginTop: 1,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
        },

        // Featured card (left, wide) + side panel (right) — mirrors the
        // "Featured program" / "Needs your attention" layout: one large
        // editorial card plus a slim action list beside it.
        cardsGrid: {
            display: "grid",
            gridTemplateColumns: "1.7fr 1fr",
            gap: 18,
            alignItems: "stretch",
        },
        // Second row (Work Anniversaries / New Joinees) — equal-width, unlike
        // the featured/side-panel split above, since both are peer lists.
        cardsGridEven: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            alignItems: "stretch",
        },
        cardsGridMobile: { display: "flex", flexDirection: "column", gap: 14 },

        card: {
            background: WARM.card,
            border: `1px solid ${WARM.border}`,
            borderRadius: radius["2xl"],
            padding: "22px 24px",
            minHeight: 260,
            display: "flex",
            flexDirection: "column",
        },
        cardHeaderRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
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
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            color: WARM.eyebrow,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
        },
        viewAllLink: {
            border: `1px solid ${WARM.pillBorder}`,
            background: "#fff",
            color: WARM.ink,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            cursor: "pointer",
            padding: "6px 14px",
            borderRadius: radius.pill,
        },
        manageLink: {
            display: "flex",
            alignItems: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: WARM.subtext,
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
            color: WARM.subtext,
            fontSize: fontSize.base,
            padding: "18px 0",
            textAlign: "center",
        },
        // Row-style empty state (illustration left, text right) — used by
        // the Work Anniversaries / New Joiners cards to match the
        // reference layout, instead of the centered-stack style above.
        cardEmptyRow: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "10px 4px",
        },
        cardEmptyRowTitle: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.bold,
            color: WARM.ink,
        },
        cardEmptyRowSubtitle: {
            fontSize: fontSize.sm,
            color: WARM.subtext,
            marginTop: 4,
        },
        cardEmptyError: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#B45F3E",
            fontSize: fontSize.base,
        },
        emptyIcon: { fontSize: 30, color: "#D8D2C4" },
        smallAddBtn: (BRAND: any) => ({
            border: "none",
            background: WARM.eyebrow,
            color: "#fff",
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            padding: "9px 20px",
            borderRadius: radius.pill,
            cursor: "pointer",
            marginTop: 2,
        }),

        // ---- Bottom tip banner ----
        tipBanner: (BRAND: any) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            background: "#FBF9F3",
            border: `1px solid ${WARM.border}`,
            borderRadius: radius.xl,
            padding: "16px 22px",
        }),
        tipIconWrap: (BRAND: any) => ({
            width: 44,
            height: 44,
            minWidth: 44,
            borderRadius: radius.circle,
            background: WARM.eyebrow,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.lg,
        }),
        tipTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: WARM.ink },
        tipSubtext: { fontSize: fontSize.sm, color: WARM.subtext, marginTop: 2 },

        holidayBody: { flex: 1, display: "flex", alignItems: "center", gap: 10 },
        holidayTextCol: { flex: 1, minWidth: 0 },
        holidayName: {
            fontFamily: SERIF_FONT,
            fontSize: fontSize["6xl"],
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            lineHeight: 1.15,
        },
        holidayDate: {
            marginTop: 8,
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: "#B45F3E",
        },
        holidayDaysBadge: {
            marginTop: 12,
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: WARM.eyebrow,
            background: "#F3EEE1",
            padding: "4px 12px",
            borderRadius: radius.pill,
        },
        holidayDaysBadgeSmall: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: WARM.eyebrow,
            background: "#F3EEE1",
            padding: "3px 9px",
            borderRadius: radius.pill,
            whiteSpace: "nowrap",
        },
        arrowBtn: {
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: radius.circle,
            border: `1px solid ${WARM.pillBorder}`,
            background: "#fff",
            color: WARM.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: fontSize.lg,
        },
        arrowBtnDisabled: { opacity: 0.35, cursor: "default" },

        dotRow: { display: "flex", justifyContent: "center", gap: 6, marginTop: 14 },
        dot: {
            width: 7,
            height: 7,
            borderRadius: radius.circle,
            border: "none",
            background: WARM.pillBorder,
            padding: 0,
            cursor: "pointer",
        },
        dotActive: { background: WARM.eyebrow, width: 16 },

        // ---- Wish posts (shown inside the Birthdays card) ----
        wishPostList: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 10,
            maxHeight: 130,
            overflowY: "auto",
        },
        wishPostRow: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "#FBF9F3",
            borderRadius: radius.md,
            padding: "8px 10px",
        },
        wishPostPhoto: {
            width: 40,
            height: 40,
            minWidth: 40,
            borderRadius: radius.sm,
            objectFit: "cover",
        },
        wishPostPhotoFallback: {
            width: 40,
            height: 40,
            minWidth: 40,
            borderRadius: radius.sm,
            background: STAT_COLORS.birthdays.bg,
            color: STAT_COLORS.birthdays.icon,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.base,
        },
        wishPostMessage: {
            fontSize: fontSize.sm,
            color: WARM.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
        },
        wishPostMeta: { fontSize: fontSize.xxs, color: WARM.subtext, marginTop: 2 },

        // ---- Post-a-wish compose template ----
        postPhotoDrop: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            border: `1px dashed ${WARM.pillBorder}`,
            borderRadius: radius.md,
            padding: "22px 10px",
            color: WARM.subtext,
            fontSize: fontSize.sm,
            cursor: "pointer",
        },
        postPhotoPreviewWrap: { position: "relative", width: "fit-content" },
        postPhotoPreview: {
            maxWidth: "100%",
            maxHeight: 180,
            borderRadius: radius.md,
            display: "block",
        },
        postPhotoRemoveBtn: {
            position: "absolute",
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            borderRadius: radius.circle,
            border: "none",
            background: "rgba(31,42,36,0.55)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
        },
        modalTextarea: {
            width: "100%",
            boxSizing: "border-box",
            padding: "9px 12px",
            borderRadius: radius.sm,
            border: `1px solid ${WARM.border}`,
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
            resize: "vertical",
        },

        // ---- "Needs your attention"-style birthday list (side panel) ----
        birthdayList: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flex: 1,
            justifyContent: "flex-start",
        },
        birthdayRow: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 0",
            borderBottom: `1px solid ${WARM.border}`,
        },
        birthdayAvatar: {
            width: 36,
            height: 36,
            minWidth: 36,
            borderRadius: radius.circle,
            background: STAT_COLORS.birthdays.bg,
            color: STAT_COLORS.birthdays.icon,
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
            color: WARM.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        birthdayDept: { fontSize: fontSize.xs, color: WARM.subtext },
        birthdayDateCol: { textAlign: "right", flexShrink: 0 },
        birthdayDaysTag: { fontSize: fontSize.xxs, color: WARM.subtext, marginTop: 2 },

        /* ---- Modal ---- */
        modalOverlay: {
            position: "fixed",
            inset: 0,
            background: "rgba(31,42,36,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
        },
        modalCard: {
            background: "#fff",
            borderRadius: radius.xl,
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
            borderBottom: `1px solid ${WARM.border}`,
        },
        modalTitle: {
            margin: 0,
            fontFamily: SERIF_FONT,
            fontSize: fontSize.xl,
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
        },
        modalYearTag: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: WARM.subtext,
        },
        modalCloseBtn: {
            border: "none",
            background: "transparent",
            color: WARM.subtext,
            cursor: "pointer",
            fontSize: fontSize.lg,
            display: "flex",
        },
        modalTabRow: { display: "flex", gap: 8, padding: "12px 20px 0" },
        modalTabBtn: {
            border: `1px solid ${WARM.pillBorder}`,
            background: "#fff",
            color: WARM.ink,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            padding: "6px 12px",
            borderRadius: radius.pill,
            cursor: "pointer",
        },
        modalTabBtnActive: (BRAND: any) => ({
            background: WARM.eyebrow,
            color: "#fff",
            border: "1px solid transparent",
        }),
        modalBody: { padding: "16px 20px 20px", overflowY: "auto" },
        holidayGrid: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "14px 24px",
        },
        holidayGridItem: {
            display: "flex",
            alignItems: "center",
            gap: 12,
        },
        // Past-dated holidays (already gone by this calendar year) render
        // muted/grayscale, Keka-style, instead of disappearing from the
        // Jan→Dec list.
        holidayGridItemPast: {
            opacity: 0.55,
            filter: "grayscale(0.4)",
        },
        holidayBadge: {
            width: 52,
            height: 48,
            minWidth: 52,
            borderRadius: radius.md,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1.1,
        },
        holidayBadgeMonth: {
            fontSize: fontSize.xxs,
            fontWeight: fontWeight.bold,
            letterSpacing: "0.03em",
        },
        holidayBadgeDay: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.bold,
            marginTop: 2,
        },
        modalListRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: radius.md,
            border: `1px solid ${WARM.border}`,
        },
        modalListRowName: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
        },
        modalListRowDate: { fontSize: fontSize.xs, color: WARM.subtext, marginTop: 2 },
        rowDeleteBtn: {
            border: "none",
            background: "transparent",
            color: "#B45F3E",
            cursor: "pointer",
            fontSize: fontSize.base,
        },
        modalLabel: {
            display: "block",
            fontSize: fontSize.xs,
            color: WARM.subtext,
            marginBottom: 4,
        },
        modalInput: {
            width: "100%",
            boxSizing: "border-box",
            padding: "9px 12px",
            borderRadius: radius.sm,
            border: `1px solid ${WARM.border}`,
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
        },
        modalHint: { fontSize: fontSize.sm, color: WARM.subtext, margin: 0 },
        modalError: { fontSize: fontSize.sm, color: "#B45F3E" },
        modalPrimaryBtn: (BRAND: any) => ({
            border: "none",
            background: WARM.eyebrow,
            color: "#fff",
            fontSize: fontSize.base,
            fontWeight: fontWeight.semibold,
            padding: "10px 16px",
            borderRadius: radius.pill,
            cursor: "pointer",
        }),
        modalSecondaryBtn: (BRAND: any) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            border: `1px solid ${WARM.pillBorder}`,
            background: "#fff",
            color: WARM.ink,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            padding: "9px 14px",
            borderRadius: radius.pill,
            cursor: "pointer",
        }),
        bulkResultRow: { fontSize: fontSize.xs, display: "flex", alignItems: "center", gap: 6 },
    };
}
