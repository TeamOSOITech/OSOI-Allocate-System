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
};

// Rotating badge palette for the "All Holidays" grid (month/day chips) —
// cycled by list position so the grid reads as colorful, not by any
// particular meaning per color.
const HOLIDAY_BADGE_COLORS = [
    { bg: "#DFF3F0", text: "#0F766E" },
    { bg: "#FCE7F3", text: "#BE185D" },
    { bg: "#F1E9DC", text: "#92702D" },
    { bg: "#FEE2E2", text: "#B91C1C" },
    { bg: "#DCEAFE", text: "#1D4ED8" },
    { bg: "#FEF3C7", text: "#92600A" },
];

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
    // Counts reflect TODAY only (daysUntil === 0), not the upcoming window.
    const holidaysTodayCount = holidays.filter((h) => h.daysUntil === 0).length;
    const birthdaysTodayCount = allBirthdaysSorted.filter((b) => b.daysUntil === 0).length;

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

                                <FestiveIllustration BRAND={BRAND} name={currentHoliday.name} />

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
                            <div style={styles.cardEmpty}>
                                <BirthdayCakeIllustration BRAND={BRAND} />
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
}: {
    BRAND: { blue: string; lightBlue: string; green: string };
    name?: string;
}) {
    const type = detectHolidayType(name || "");

    return (
        <svg
            width="96"
            height="96"
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
                    <path
                        d="M50 26 L60 44 L54 44 L64 58 L57 58 L68 74 L32 74 L43 58 L36 58 L46 44 L40 44 Z"
                        fill={BRAND.green}
                    />
                    <rect x="46" y="74" width="8" height="8" rx="1.5" fill="#92400E" />
                    <path
                        d="M50 20 L52.5 25.5 L58 26 L54 30 L55 35.5 L50 32.5 L45 35.5 L46 30 L42 26 L47.5 25.5 Z"
                        fill="#FACC15"
                    />
                    <circle cx="44" cy="54" r="2" fill="#EF4444" />
                    <circle cx="57" cy="50" r="2" fill={BRAND.lightBlue} />
                    <circle cx="47" cy="66" r="2" fill="#EF4444" />
                    <circle cx="58" cy="68" r="2" fill="#FACC15" />
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

// Friendly birthday-cake illustration for the empty Birthdays state,
// rendered in the active theme's colors — same visual family as the
// other empty-state graphics on this page.
function BirthdayCakeIllustration({
    BRAND,
}: {
    BRAND: { blue: string; lightBlue: string; green: string };
}) {
    return (
        <svg width="120" height="110" viewBox="0 0 120 110" aria-hidden="true">
            <ellipse cx="60" cy="98" rx="38" ry="6" fill={withAlpha(BRAND.blue, 0.06)} />
            {/* candles */}
            <rect x="40" y="30" width="4" height="16" rx="1.5" fill={BRAND.lightBlue} />
            <rect x="58" y="24" width="4" height="22" rx="1.5" fill={BRAND.blue} />
            <rect x="76" y="30" width="4" height="16" rx="1.5" fill={BRAND.lightBlue} />
            <path d="M42 30 Q46 24 42 18 Q38 24 42 30 Z" fill="#FACC15" />
            <path d="M60 24 Q64 18 60 12 Q56 18 60 24 Z" fill="#FACC15" />
            <path d="M78 30 Q82 24 78 18 Q74 24 78 30 Z" fill="#FACC15" />
            {/* top tier */}
            <rect
                x="34"
                y="46"
                width="52"
                height="18"
                rx="4"
                fill={withAlpha(BRAND.lightBlue, 0.35)}
            />
            <path
                d="M34 50 Q40 44 46 50 Q52 44 58 50 Q64 44 70 50 Q76 44 82 50 L86 50 L86 64 L34 64 Z"
                fill="#fff"
            />
            {/* bottom tier */}
            <rect x="22" y="64" width="76" height="26" rx="5" fill={BRAND.blue} />
            <rect x="22" y="64" width="76" height="8" rx="4" fill={withAlpha(BRAND.blue, 0.55)} />
            <circle cx="40" cy="80" r="3" fill={BRAND.green} />
            <circle cx="60" cy="80" r="3" fill="#fff" />
            <circle cx="80" cy="80" r="3" fill={BRAND.green} />
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

    // Only the current calendar year — no cross-year browsing.
    const currentYear = new Date().getFullYear();
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
                                        const palette =
                                            HOLIDAY_BADGE_COLORS[i % HOLIDAY_BADGE_COLORS.length];
                                        return (
                                            <div key={h.id} style={styles.holidayGridItem}>
                                                <div
                                                    style={{
                                                        ...styles.holidayBadge,
                                                        background: palette.bg,
                                                        color: palette.text,
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
                                                    <div style={styles.modalListRowName}>
                                                        {h.name}
                                                    </div>
                                                    <div style={styles.modalListRowDate}>
                                                        {d.toLocaleDateString("en-US", {
                                                            weekday: "long",
                                                        })}
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

        // ---- Top stat cards (Holidays / Birthdays / Announcements) ----
        statGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
        statGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: 10 },
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
            minHeight: 260,
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
            background: "#f7f8fc",
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
            color: "#16233a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
        },
        wishPostMeta: { fontSize: fontSize.xxs, color: "#9aa5b6", marginTop: 2 },

        // ---- Post-a-wish compose template ----
        postPhotoDrop: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            border: "1px dashed #cfd7e6",
            borderRadius: radius.md,
            padding: "22px 10px",
            color: "#7d90a6",
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
            background: "rgba(17,20,30,0.55)",
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
            border: "1px solid #e4e9f2",
            fontSize: fontSize.base,
            fontFamily: fontFamily.base,
            resize: "vertical",
        },

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
        modalYearTag: {
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: "#9aa5b6",
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
