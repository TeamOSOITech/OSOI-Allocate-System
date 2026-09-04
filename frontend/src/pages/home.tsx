import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ChangeEvent } from "react";
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

// Shared floor height for the New Joinees card and the Posts panel beside
// it. With one post the panel matches New Joinees instead of looking
// short; with more posts it's free to grow past this (up to its own
// scroll cap) without pulling New Joinees taller too — see
// cardsGridWithPosts, which intentionally doesn't stretch them to match.
const SIDE_BY_SIDE_CARD_MIN_HEIGHT = 260;

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

// Page palette — matches the neutral tones used across the rest of the
// app (dashboard.tsx, employees.tsx, etc.): near-white page background,
// white cards, light gray borders, dark-gray ink. The old version of
// this page used its own warm cream/olive editorial palette here, which
// made Home look like a different app from the rest of the site. The
// brand accent color itself ("eyebrow") no longer lives here — it now
// comes straight from BRAND.blue (the active theme color) wherever it's
// used, so Home repaints with the rest of the app when the user switches
// theme color, same as dashboard.tsx.
const WARM = {
    bg: "#f4f5fb",
    card: "#FFFFFF",
    border: "#e4e9f2",
    ink: "#17181C",
    subtext: "#767F92",
    pillBorder: "#e4e9f2",
};

// Was a decorative serif ("Playfair Display") unique to this page —
// switched to the app's shared system font so headings match every
// other page instead of standing out.
const SERIF_FONT = fontFamily.base;

// The theme's custom font (fontFamily.base) has no emoji glyphs, so
// characters like 🎉 🏆 🎂 👋 render as empty "tofu" boxes anywhere that
// font is applied. Appending the OS's native emoji fonts as fallbacks
// lets the browser keep using fontFamily.base for normal text and only
// reach into these fallback fonts for the specific glyphs it's missing
// (i.e. the emoji) — so nothing else about the typography changes.
const EMOJI_SAFE_FONT = `${fontFamily.base}, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;

// Shared illustration sizing — kept in one place so the four "hero"
// graphics (holiday icon, birthday cake, trophy, welcome badge) can be
// resized together and stay visually consistent. The Holidays card's
// right-side icon is deliberately larger (its dedicated hero slot);
// its left-side icon and the other three cards' illustrations share
// ILLUSTRATION_SIZE.
const ILLUSTRATION_SIZE = 150;
const HOLIDAY_HERO_SIZE = 210;
// Right-side icon inside the Holidays card only — smaller than
// ILLUSTRATION_SIZE (which the other 3 cards' illustrations still use)
// so the Holidays card takes up less vertical room without shrinking
// the birthday/anniversary/new-joiner illustrations.
const HOLIDAY_RIGHT_ICON_SIZE = 130;
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

// Formats a stored ISO timestamp (wish posts) as a friendly relative
// label — "Just now" right after posting, then minutes/hours/days once
// the page has been refreshed since.
function formatPostedAt(iso: string): string {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

function yearsLabel(n: number) {
    if (n <= 0) return "1st anniversary";
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suffix} anniversary`;
}

// Auto-generated wish text — used whenever a post is created straight
// from a photo pick, so nobody has to type a message themselves.
function buildWishMessage(kind: "birthday" | "anniversary", name: string, years?: number): string {
    if (kind === "anniversary") {
        const y = years ?? 1;
        return `Happy ${y} year${y === 1 ? "" : "s"} anniversary, ${name}! 🎉 Thank you for ${y} amazing year${
            y === 1 ? "" : "s"
        } with us — here's to many more. Have fun celebrating! 🥳`;
    }
    return `Happy Birthday, ${name}! 🎂🎉 Wishing you a fantastic day and an even better year ahead. Have fun!`;
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
    kind: "birthday" | "anniversary";
    employeeId: string;
    photo: string | null;
    message: string;
    employeeName: string;
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
    // Posting a wish is just "pick a photo" — no dropdown, no message box.
    // The hidden file input below is shared by every "+ Post" button and
    // every pencil (edit-photo) button; postFilePickerContextRef records
    // which occasion/post it was opened for so onChange knows what to do.
    const postFileInputRef = useRef<HTMLInputElement | null>(null);
    const postFilePickerContextRef = useRef<{
        kind: "birthday" | "anniversary";
        editingPost: WishPost | null;
    }>({ kind: "birthday", editingPost: null });
    const WISH_POSTS_STORAGE_KEY = "osoi_home_wish_posts";
    const [wishPosts, setWishPosts] = useState<WishPost[]>(() => {
        // Load previously posted wishes from localStorage so they survive
        // a page refresh instead of vanishing (they're client-side only —
        // no backend table exists for wish posts yet).
        try {
            const saved = localStorage.getItem(WISH_POSTS_STORAGE_KEY);
            return saved ? (JSON.parse(saved) as WishPost[]) : [];
        } catch {
            return [];
        }
    });

    // Persist wishPosts to localStorage whenever they change.
    useEffect(() => {
        try {
            localStorage.setItem(WISH_POSTS_STORAGE_KEY, JSON.stringify(wishPosts));
        } catch {
            // Storage full or unavailable — silently ignore, posts just
            // won't persist across refreshes in that case.
        }
    }, [wishPosts]);
    const [showAnniversariesModal, setShowAnniversariesModal] = useState(false);
    const [showNewJoineesModal, setShowNewJoineesModal] = useState(false);

    // A post stays visible for a fixed window after it's created — not
    // tied to the actual birthday/anniversary date — so it survives page
    // refreshes and doesn't vanish just because "today" moved on from the
    // occasion. postedAt is saved in localStorage, so this holds up across
    // reloads too.
    const WISH_POST_VISIBLE_DAYS = 8;

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

    // A post stays visible for WISH_POST_VISIBLE_DAYS from when it was
    // created — simple elapsed-time check against the saved postedAt, so
    // it works the same whether the occasion is today, still days away,
    // or the page was just refreshed.
    const isPostVisible = (p: WishPost) => {
        const postedTime = new Date(p.postedAt).getTime();
        if (isNaN(postedTime)) return true; // don't hide a post over a bad timestamp
        const ageDays = (Date.now() - postedTime) / (24 * 60 * 60 * 1000);
        return ageDays >= 0 && ageDays <= WISH_POST_VISIBLE_DAYS;
    };

    const handleDeletePost = (id: string) => {
        if (!window.confirm("Delete this post?")) return;
        setWishPosts((prev) => prev.filter((p) => p.id !== id));
    };

    // Every post still inside its 8-day visibility window, newest first —
    // this combined feed is what renders beside "New Joinees".
    const visibleWishPosts = useMemo(
        () =>
            wishPosts
                .filter(isPostVisible)
                .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()),
        [wishPosts] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Drop posts that have aged out of the visibility window from storage
    // entirely (once, on load) so localStorage doesn't quietly accumulate
    // old posts forever.
    useEffect(() => {
        setWishPosts((prev) => {
            const kept = prev.filter(isPostVisible);
            return kept.length === prev.length ? prev : kept;
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // "+ Post" (and the pencil on an existing post) both just open the
    // native file picker — no dropdown, no message box. The wish is
    // always for whoever the card is currently featuring (the soonest
    // birthday/anniversary), and the photo is the only thing to pick.
    const triggerPostFilePicker = (
        kind: "birthday" | "anniversary",
        editingPost: WishPost | null = null
    ) => {
        const person = kind === "birthday" ? upcomingBirthdays[0] : upcomingAnniversaries[0];
        if (!person && !editingPost) return; // nothing to post for right now
        postFilePickerContextRef.current = { kind, editingPost };
        postFileInputRef.current?.click();
    };

    const handlePostFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        e.target.value = ""; // allow re-picking the same file next time
        if (!file) return;

        const { kind, editingPost } = postFilePickerContextRef.current;
        const person = kind === "birthday" ? upcomingBirthdays[0] : upcomingAnniversaries[0];
        if (!person && !editingPost) return;

        const years = kind === "anniversary" ? (person as Anniversary)?.years : undefined;
        const name = person?.name || editingPost?.employeeName || "";

        const reader = new FileReader();
        reader.onload = () => {
            const post: WishPost = {
                id: editingPost?.id || `${Date.now()}`,
                kind,
                employeeId: person?.id || editingPost?.employeeId || "",
                photo: reader.result as string,
                message: editingPost?.message || buildWishMessage(kind, name, years),
                employeeName: name,
                postedAt: editingPost?.postedAt || new Date().toISOString(),
            };
            setWishPosts((prev) => {
                const exists = prev.some((p) => p.id === post.id);
                return exists ? prev.map((p) => (p.id === post.id ? post : p)) : [post, ...prev];
            });
        };
        reader.readAsDataURL(file);
    };

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
            label: "New Joinees",
            sub: "This month",
            colors: STAT_COLORS.newJoinees,
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
                                ? `${getGreeting()}, ${displayName}! `
                                : `${getGreeting()}! `}
                            <span style={styles.emojiGlyph}>👋</span>
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

                <div style={isMobile ? styles.cardsGridMobile : styles.cardsGrid3}>
                    {/* ---------------- Holidays card ---------------- */}
                    <div style={styles.programCard}>
                        <div style={styles.programImage(BRAND, null)}>
                            <div style={styles.programImageScrim} />
                            {!holidaysLoading && !holidaysError && currentHoliday && (
                                <>
                                    <div style={styles.programImageIllustrationWrap}>
                                        <FestiveIllustration
                                            BRAND={BRAND}
                                            name={currentHoliday.name}
                                            size={78}
                                        />
                                    </div>
                                    <GarlandLights />
                                    <span
                                        style={{
                                            ...styles.programBadge,
                                            ...(currentHoliday.daysUntil === 0
                                                ? styles.programBadgeToday(BRAND)
                                                : styles.programBadgeMuted),
                                        }}
                                    >
                                        {currentHoliday.isPast
                                            ? "Past"
                                            : daysUntilLabel(currentHoliday.daysUntil)}
                                    </span>
                                    {yearHolidays.length > 1 && (
                                        <>
                                            <button
                                                style={{
                                                    ...styles.programArrowBtn,
                                                    ...styles.programArrowBtnLeft,
                                                    ...(holidayIndex === 0
                                                        ? styles.programArrowBtnDisabled
                                                        : {}),
                                                }}
                                                disabled={holidayIndex === 0}
                                                onClick={() =>
                                                    setHolidayIndex((i) => Math.max(0, i - 1))
                                                }
                                                aria-label="Previous holiday"
                                            >
                                                <i
                                                    className="ti ti-chevron-left"
                                                    aria-hidden="true"
                                                />
                                            </button>
                                            <button
                                                style={{
                                                    ...styles.programArrowBtn,
                                                    ...styles.programArrowBtnRight,
                                                    ...(holidayIndex >= yearHolidays.length - 1
                                                        ? styles.programArrowBtnDisabled
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
                                                <i
                                                    className="ti ti-chevron-right"
                                                    aria-hidden="true"
                                                />
                                            </button>
                                        </>
                                    )}
                                    <div style={styles.programImageOverlay}>
                                        <div style={styles.programEyebrowWhite}>Holidays</div>
                                        <div style={styles.programTitleWhite}>
                                            {currentHoliday.name}
                                        </div>
                                        <div style={styles.programSubtitleWhite}>
                                            {formatNiceDate(currentHoliday.nextOccurrence)}
                                        </div>
                                    </div>
                                </>
                            )}
                            {!holidaysLoading && !holidaysError && !currentHoliday && (
                                <div style={styles.programImageOverlay}>
                                    <div style={styles.programEyebrowWhite}>Holidays</div>
                                    <div style={styles.programTitleWhite}>
                                        No holidays added yet
                                    </div>
                                </div>
                            )}
                        </div>

                        {!holidaysLoading && !holidaysError && yearHolidays.length > 1 && (
                            <div style={styles.programDotRow}>
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

                        <div style={styles.programBody}>
                            <div style={styles.programActionsRow}>
                                {isSuperAdmin && (
                                    <button
                                        style={styles.manageLink}
                                        onClick={() => setShowHolidaysModal(true)}
                                    >
                                        <i className="ti ti-settings" aria-hidden="true" /> Manage
                                    </button>
                                )}
                            </div>

                            {holidaysLoading ? (
                                <div style={styles.cardEmpty}>Loading…</div>
                            ) : holidaysError ? (
                                <div style={styles.cardEmptyError}>{holidaysError}</div>
                            ) : !currentHoliday ? (
                                isSuperAdmin && (
                                    <button
                                        style={styles.smallAddBtn(BRAND)}
                                        onClick={() => setShowHolidaysModal(true)}
                                    >
                                        + Add Holidays
                                    </button>
                                )
                            ) : null}

                            <button
                                style={styles.programFooterLink(BRAND)}
                                onClick={() => setShowHolidaysModal(true)}
                            >
                                View All <i className="ti ti-arrow-right" aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* ---------------- Birthdays card ---------------- */}
                    <div style={styles.programCard}>
                        <div
                            style={styles.programImage(
                                BRAND,
                                upcomingBirthdays[0]?.photoUrl || null
                            )}
                        >
                            <div style={styles.programImageScrim} />
                            {!employeesLoading && upcomingBirthdays.length > 0 && (
                                <>
                                    {!upcomingBirthdays[0].photoUrl && (
                                        <div style={styles.programImageIllustrationWrap}>
                                            <BirthdaysCardBg />
                                        </div>
                                    )}
                                    <span
                                        style={{
                                            ...styles.programBadge,
                                            ...(upcomingBirthdays[0].daysUntil === 0
                                                ? styles.programBadgeToday(BRAND)
                                                : styles.programBadgeMuted),
                                        }}
                                    >
                                        {daysUntilLabel(upcomingBirthdays[0].daysUntil)}
                                    </span>
                                    <div style={styles.programImageOverlay}>
                                        <div style={styles.programEyebrowWhite}>Birthdays</div>
                                        <div style={styles.programTitleWhite}>
                                            <span style={styles.emojiGlyph}>🎉</span>{" "}
                                            {upcomingBirthdays[0].name}
                                        </div>
                                        <div style={styles.programSubtitleWhite}>
                                            {upcomingBirthdays[0].department ||
                                                formatNiceDate(upcomingBirthdays[0].nextOccurrence)}
                                        </div>
                                    </div>
                                </>
                            )}
                            {!employeesLoading && upcomingBirthdays.length === 0 && (
                                <div style={styles.programImageOverlay}>
                                    <div style={styles.programEyebrowWhite}>Birthdays</div>
                                    <div style={styles.programTitleWhite}>
                                        No birthdays this month
                                    </div>
                                </div>
                            )}
                        </div>

                        <div style={styles.programBody}>
                            <div style={styles.programActionsRow}>
                                {isSuperAdmin && (
                                    <button
                                        style={styles.manageLink}
                                        onClick={() => triggerPostFilePicker("birthday")}
                                    >
                                        <i className="ti ti-plus" aria-hidden="true" /> Post
                                    </button>
                                )}
                            </div>

                            {employeesLoading ? (
                                <div style={styles.cardEmpty}>Loading…</div>
                            ) : upcomingBirthdays.length > 1 ? (
                                <div style={styles.birthdayList}>
                                    {upcomingBirthdays.slice(1, 4).map((b) => (
                                        <BirthdayRow
                                            key={b.id}
                                            b={b}
                                            styles={styles}
                                            BRAND={BRAND}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            <button
                                style={styles.programFooterLink(BRAND)}
                                onClick={() => setShowBirthdaysModal(true)}
                            >
                                View All <i className="ti ti-arrow-right" aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* ---------------- Work Anniversaries card ---------------- */}
                    <div style={styles.programCard}>
                        <div
                            style={styles.programImage(
                                BRAND,
                                upcomingAnniversaries[0]?.photoUrl || null
                            )}
                        >
                            <div style={styles.programImageScrim} />
                            {!employeesLoading && upcomingAnniversaries.length > 0 && (
                                <>
                                    {!upcomingAnniversaries[0].photoUrl && (
                                        <div style={styles.programImageIllustrationWrap}>
                                            <AnniversariesCardBg />
                                        </div>
                                    )}
                                    <span
                                        style={{
                                            ...styles.programBadge,
                                            ...(upcomingAnniversaries[0].daysUntil === 0
                                                ? styles.programBadgeToday(BRAND)
                                                : styles.programBadgeMuted),
                                        }}
                                    >
                                        {daysUntilLabel(upcomingAnniversaries[0].daysUntil)}
                                    </span>
                                    <div style={styles.programImageOverlay}>
                                        <div style={styles.programEyebrowWhite}>
                                            Work Anniversaries
                                        </div>
                                        <div style={styles.programTitleWhite}>
                                            <span style={styles.emojiGlyph}>🏆</span>{" "}
                                            {upcomingAnniversaries[0].name}
                                        </div>
                                        <div style={styles.programSubtitleWhite}>
                                            {upcomingAnniversaries[0].years}{" "}
                                            {upcomingAnniversaries[0].years === 1
                                                ? "year"
                                                : "years"}{" "}
                                            · {upcomingAnniversaries[0].department || ""}
                                        </div>
                                    </div>
                                </>
                            )}
                            {!employeesLoading && upcomingAnniversaries.length === 0 && (
                                <div style={styles.programImageOverlay}>
                                    <div style={styles.programEyebrowWhite}>Work Anniversaries</div>
                                    <div style={styles.programTitleWhite}>
                                        No anniversaries this month
                                    </div>
                                </div>
                            )}
                        </div>

                        <div style={styles.programBody}>
                            <div style={styles.programActionsRow}>
                                {isSuperAdmin && (
                                    <button
                                        style={styles.manageLink}
                                        onClick={() => triggerPostFilePicker("anniversary")}
                                    >
                                        <i className="ti ti-plus" aria-hidden="true" /> Post
                                    </button>
                                )}
                            </div>

                            {employeesLoading ? (
                                <div style={styles.cardEmpty}>Loading…</div>
                            ) : upcomingAnniversaries.length > 1 ? (
                                <div style={styles.birthdayList}>
                                    {upcomingAnniversaries.slice(1, 4).map((a) => (
                                        <AnniversaryRow key={a.id} a={a} styles={styles} />
                                    ))}
                                </div>
                            ) : null}

                            <button
                                style={styles.programFooterLink(BRAND)}
                                onClick={() => setShowAnniversariesModal(true)}
                            >
                                View All <i className="ti ti-arrow-right" aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    style={
                        isMobile
                            ? styles.cardsGridMobile
                            : visibleWishPosts.length > 0
                              ? styles.cardsGridWithPosts
                              : styles.cardsGridSingle
                    }
                >
                    {/* ---------------- New Joinees card ---------------- */}
                    {/* Only shrinks (via cardsGridWithPosts, above) once there's
                        an actual post to show beside it — otherwise it keeps
                        the full row to itself. minHeight keeps it (and the
                        Posts panel beside it) a consistent height when there's
                        just one post, without forcing either to stretch to
                        match the other (see cardsGridWithPosts/PostsPanel). */}
                    <div
                        style={{
                            ...styles.card,
                            borderTop: `3px solid ${STAT_COLORS.newJoinees.icon}`,
                            position: "relative",
                            overflow: "hidden",
                            minHeight: SIDE_BY_SIDE_CARD_MIN_HEIGHT,
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
                                <span style={styles.cardEyebrow}>New Joinees</span>
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

                    {/* ---------------- Posts panel (birthday/anniversary wishes) ---------------- */}
                    {/* Sits to the right of New Joinees, and only exists at all
                        once there's at least one visible post. */}
                    {visibleWishPosts.length > 0 && (
                        <PostsPanel
                            posts={visibleWishPosts}
                            isSuperAdmin={isSuperAdmin}
                            onEdit={triggerPostFilePicker}
                            onDelete={handleDeletePost}
                            styles={styles}
                        />
                    )}
                </div>

                {/* Hidden file input shared by every "+ Post" / pencil (edit
                    photo) button — clicking any of them just opens this. */}
                <input
                    ref={postFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handlePostFileChange}
                />

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

// Soft decorative wave + leaf background for the New Joinees card,
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
            <defs>
                <radialGradient id="festiveBackdrop" cx="50%" cy="42%" r="60%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
                    <stop offset="80%" stopColor="rgba(255,255,255,0.96)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.85)" />
                </radialGradient>
                <radialGradient id="diyaFlameGlow" cx="50%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#FFF3C4" stopOpacity="0.95" />
                    <stop offset="55%" stopColor="#FDBA3F" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#FDBA3F" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="diyaFlame" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FFF7D6" />
                    <stop offset="45%" stopColor="#FCD34D" />
                    <stop offset="100%" stopColor="#F97316" />
                </linearGradient>
                <linearGradient id="diyaBody" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#F0924A" />
                    <stop offset="55%" stopColor="#D9662B" />
                    <stop offset="100%" stopColor="#B04A1E" />
                </linearGradient>
                <linearGradient id="diyaRim" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#FDE2C6" />
                    <stop offset="50%" stopColor="#F6B784" />
                    <stop offset="100%" stopColor="#FDE2C6" />
                </linearGradient>
            </defs>

            {/* Frosted-glass backdrop — sits behind every festival icon so
                it reads as a deliberate badge against the card's blue
                gradient, instead of the icon floating directly on it. */}
            <circle cx="50" cy="50" r="46" fill="url(#festiveBackdrop)" />
            <circle
                cx="50"
                cy="50"
                r="45.5"
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
            />

            {type === "diwali" && (
                <g>
                    {/* soft ambient glow behind the flame, so the diya
                        reads as genuinely lit rather than flat-colored */}
                    <circle cx="50" cy="44" r="26" fill="url(#diyaFlameGlow)" />

                    {/* lamp base + bowl, built from two overlapping
                        gradient-shaded ellipses for a rounded, ceramic feel */}
                    <ellipse cx="50" cy="68" rx="21" ry="4" fill="rgba(0,0,0,0.12)" />
                    <path
                        d="M28 60 Q50 76 72 60 Q68 68 50 70 Q32 68 28 60 Z"
                        fill="url(#diyaBody)"
                    />
                    <ellipse cx="50" cy="60" rx="22" ry="7" fill="url(#diyaRim)" />
                    <ellipse
                        cx="50"
                        cy="60"
                        rx="22"
                        ry="7"
                        fill="none"
                        stroke="#B04A1E"
                        strokeWidth="0.75"
                        opacity="0.4"
                    />
                    <ellipse cx="50" cy="59" rx="15" ry="4" fill="#7A3311" opacity="0.55" />

                    {/* flame, layered outer/inner for depth + a bright core */}
                    <path d="M50 30 Q60 44 50 58 Q40 44 50 30 Z" fill="url(#diyaFlame)" />
                    <path d="M50 38 Q55 46 50 54 Q45 46 50 38 Z" fill="#FFF7D6" opacity="0.9" />

                    {/* gold sparkle accents */}
                    <path
                        d="M22 34 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 Z"
                        fill="#FBBF24"
                    />
                    <path
                        d="M76 30 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 Z"
                        fill="#FBBF24"
                        opacity="0.85"
                    />
                    <circle cx="70" cy="52" r="2.2" fill="#FBBF24" opacity="0.8" />
                    <circle cx="28" cy="52" r="1.8" fill="#FBBF24" opacity="0.7" />
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

// ID-badge-with-plant "Welcome" illustration for the empty "New Joinees"
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
                    <h3 style={styles.modalTitle}>New Joinees</h3>
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

// Feed of birthday/anniversary wish posts, rendered beside "New Joinees"
// once at least one post is visible. Each row is just a photo + the
// auto-generated message — there's nothing else to edit here besides
// swapping the photo (pencil) or removing the post (trash).
function PostsPanel({
    posts,
    isSuperAdmin,
    onEdit,
    onDelete,
    styles,
}: {
    posts: WishPost[];
    isSuperAdmin: boolean;
    onEdit: (kind: "birthday" | "anniversary", editingPost: WishPost) => void;
    onDelete: (id: string) => void;
    styles: any;
}) {
    return (
        <div
            style={{
                ...styles.card,
                borderTop: `3px solid ${STAT_COLORS.birthdays.icon}`,
                position: "relative",
                overflow: "hidden",
                minHeight: SIDE_BY_SIDE_CARD_MIN_HEIGHT,
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
                            className="ti ti-confetti"
                            style={{ color: STAT_COLORS.birthdays.icon }}
                            aria-hidden="true"
                        />
                    </div>
                    <span style={styles.cardEyebrow}>Posts</span>
                </div>
            </div>

            <div style={{ ...styles.wishPostList, maxHeight: 440, marginBottom: 0 }}>
                {posts.map((p) => {
                    const isAnniversary = p.kind === "anniversary";
                    return (
                        <div
                            key={p.id}
                            style={
                                isAnniversary
                                    ? styles.wishPostRowAnniversary
                                    : styles.wishPostRowBirthday
                            }
                        >
                            {p.photo ? (
                                <img src={p.photo} alt="" style={styles.wishPostPhotoLarge} />
                            ) : (
                                <div
                                    style={
                                        isAnniversary
                                            ? styles.wishPostPhotoFallbackAnniv
                                            : styles.wishPostPhotoFallbackLarge
                                    }
                                >
                                    <i
                                        className={isAnniversary ? "ti ti-award" : "ti ti-cake"}
                                        aria-hidden="true"
                                    />
                                </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                    style={
                                        isAnniversary
                                            ? styles.wishPostHeadingAnniv
                                            : styles.wishPostHeading
                                    }
                                >
                                    <span style={styles.emojiGlyph}>
                                        {isAnniversary ? "🏆" : "🎉"}
                                    </span>{" "}
                                    {p.employeeName ||
                                        (isAnniversary ? "Happy Anniversary" : "Happy Birthday")}
                                </div>
                                <div style={styles.wishPostMessageLarge}>{p.message}</div>
                                <div style={styles.wishPostMeta}>{formatPostedAt(p.postedAt)}</div>
                            </div>
                            {isSuperAdmin && (
                                <div style={styles.wishPostActions}>
                                    <button
                                        style={styles.wishPostActionBtn}
                                        aria-label="Change photo"
                                        onClick={() => onEdit(p.kind, p)}
                                    >
                                        <i className="ti ti-pencil" aria-hidden="true" />
                                    </button>
                                    <button
                                        style={styles.wishPostActionBtn}
                                        aria-label="Delete post"
                                        onClick={() => onDelete(p.id)}
                                    >
                                        <i className="ti ti-trash" aria-hidden="true" />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
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
            background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.lightBlue}, ${BRAND.green})`,
        },
        contentBody: {
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            padding: "40px 24px 16px",
        },
        contentBodyMobile: {
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            padding: "38px 16px 24px",
        },

        headerRow: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 6,
        },
        headerRowMobile: {
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: 4,
        },

        // Applied directly to a <span> wrapping just the emoji character
        // (rather than relying on inheritance from a parent's
        // fontFamily), so a parent style/class further down the tree
        // can never silently override it and blank the glyph out again.
        emojiGlyph: {
            fontFamily: EMOJI_SAFE_FONT,
        },
        pageTitle: {
            margin: 0,
            fontSize: fontSize["5xl"],
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
        },
        headerSubtext: {
            margin: "4px 0 0",
            marginLeft: 0,
            textAlign: "left",
            fontSize: fontSize.base,
            color: WARM.subtext,
        },

        dateBadge: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: fontSize.sm,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
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
            gap: 12,
            marginTop: 6,
            marginBottom: 10,
        },
        statGridMobile: {
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 12,
            marginTop: 4,
            marginBottom: 8,
        },
        statCard: {
            background: WARM.card,
            border: `1px solid ${WARM.border}`,
            borderRadius: radius.xl,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
        },
        statIconWrap: {
            width: 30,
            height: 30,
            minWidth: 30,
            borderRadius: radius.md,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        statValue: {
            fontFamily: SERIF_FONT,
            fontSize: fontSize["2xl"],
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            lineHeight: 1.1,
        },
        statLabel: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: WARM.ink,
            marginTop: 2,
        },
        statSub: {
            fontSize: fontSize.xxs,
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
            gap: 24,
            alignItems: "stretch",
        },
        // Second row (Work Anniversaries / New Joinees) — equal-width, unlike
        // the featured/side-panel split above, since both are peer lists.
        cardsGridEven: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            alignItems: "stretch",
        },
        cardsGridMobile: { display: "flex", flexDirection: "column", gap: 16 },

        card: {
            background: WARM.card,
            border: `1px solid ${WARM.border}`,
            borderRadius: radius["2xl"],
            padding: "12px 16px",
            minHeight: 120,
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
        // ---- Photo-header cards (Holidays / Birthdays / Work Anniversaries) ----
        // Same "photo banner + gradient text overlay + white body" pattern
        // as the reference design, but using our own brand color + content
        // (the next holiday, the soonest birthday/anniversary — or that
        // person's photo when we have one) instead of stock photography.
        cardsGrid3: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
            alignItems: "stretch",
        },
        cardsGridSingle: {
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 14,
        },
        // New Joinees + the wish-posts panel beside it. New Joinees only
        // gives up width here — when there are no posts, cardsGridSingle
        // above keeps it full-width instead. alignItems is "start" (not
        // "stretch") on purpose — New Joinees keeps its own natural
        // height instead of growing/shrinking to match however tall the
        // Posts panel gets as posts are added or removed.
        cardsGridWithPosts: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            alignItems: "start",
        },
        programCard: {
            background: WARM.card,
            border: `1px solid ${WARM.border}`,
            borderRadius: radius["2xl"],
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
        },
        programImage: (BRAND: any, photoUrl?: string | null) => ({
            position: "relative",
            width: "100%",
            height: 168,
            minHeight: 168,
            background: photoUrl
                ? `url(${photoUrl}) center/cover no-repeat`
                : `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.lightBlue})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
        }),
        // Uniform dark scrim laid over the photo/gradient so text and
        // icons always sit on a readable surface, whether the card is
        // showing an employee photo or the brand gradient/illustration.
        // Kept as its own absolutely-positioned layer (rather than baked
        // into the gradient) so it works identically for both cases.
        programImageScrim: {
            position: "absolute",
            inset: 0,
            background:
                "linear-gradient(180deg, rgba(15,17,23,0.10) 0%, rgba(15,17,23,0.15) 45%, rgba(15,17,23,0.75) 100%)",
            zIndex: 0,
        },
        programImageIllustrationWrap: {
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 6,
            opacity: 0.95,
        },
        programBadge: {
            position: "absolute",
            top: 12,
            left: 12,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "5px 12px",
            borderRadius: radius.pill,
            zIndex: 2,
        },
        programBadgeToday: (BRAND: any) => ({
            background: BRAND.blue,
            color: "#fff",
        }),
        programBadgeMuted: {
            background: "rgba(255,255,255,0.94)",
            color: "#17181C",
        },
        programArrowBtn: {
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            width: 28,
            height: 28,
            borderRadius: radius.circle,
            border: "none",
            background: "rgba(255,255,255,0.85)",
            color: "#17181C",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 2,
            fontSize: fontSize.sm,
        },
        programArrowBtnLeft: { left: 10 },
        programArrowBtnRight: { right: 10 },
        programArrowBtnDisabled: { opacity: 0.35, cursor: "default", pointerEvents: "none" },
        programImageOverlay: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "26px 16px 14px",
            background:
                "linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.2) 65%, rgba(0,0,0,0))",
            zIndex: 1,
        },
        programEyebrowWhite: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            color: "rgba(255,255,255,0.85)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
        },
        programTitleWhite: {
            fontSize: fontSize.lg,
            fontWeight: fontWeight.bold,
            color: "#fff",
            marginTop: 3,
            lineHeight: 1.2,
            // Emoji-safe: this label sometimes renders "🎉 Name" /
            // "🏆 Name" inline (see the Birthdays / Anniversaries cards).
            fontFamily: EMOJI_SAFE_FONT,
        },
        programSubtitleWhite: {
            fontSize: fontSize.xs,
            color: "rgba(255,255,255,0.85)",
            marginTop: 2,
        },
        programDotRow: {
            display: "flex",
            justifyContent: "center",
            gap: 5,
            padding: "8px 0 0",
        },
        programBody: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "10px 12px 12px",
            gap: 8,
        },
        programActionsRow: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 14,
        },
        programFooterLink: (BRAND: any) => ({
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: "auto",
            paddingTop: 10,
            border: "none",
            background: "transparent",
            color: BRAND.blue,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            alignSelf: "flex-start",
        }),

        cardEyebrow: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            color: BRAND.blue,
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
        // the Work Anniversaries / New Joinees cards to match the
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
            color: "#b91c1c",
            fontSize: fontSize.base,
        },
        emptyIcon: { fontSize: 30, color: "#c7ccd6" },
        smallAddBtn: (BRAND: any) => ({
            border: "none",
            background: BRAND.blue,
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
            background: "#f4f5fb",
            border: `1px solid ${WARM.border}`,
            borderRadius: radius.xl,
            padding: "10px 18px",
        }),
        tipIconWrap: (BRAND: any) => ({
            width: 32,
            height: 32,
            minWidth: 32,
            borderRadius: radius.circle,
            background: BRAND.blue,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize.base,
        }),
        tipTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: WARM.ink },
        tipSubtext: { fontSize: fontSize.xs, color: WARM.subtext, marginTop: 2 },

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
            color: BRAND.blue,
        },
        holidayDaysBadge: {
            marginTop: 12,
            display: "inline-block",
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.12),
            padding: "4px 12px",
            borderRadius: radius.pill,
        },
        holidayDaysBadgeSmall: {
            fontSize: fontSize.xs,
            fontWeight: fontWeight.semibold,
            color: BRAND.blue,
            background: withAlpha(BRAND.blue, 0.12),
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
        dotActive: { background: BRAND.blue, width: 16 },

        // ---- Wish posts (shown inside the Birthdays / Anniversaries cards) ----
        wishPostList: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 12,
            maxHeight: 220,
            overflowY: "auto",
        },
        wishPostRow: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "#f4f5fb",
            borderRadius: radius.md,
            padding: "8px 10px",
        },
        // Larger, more festive card-style row used for the new auto-filled
        // birthday/anniversary posts — bigger photo, a bold heading line,
        // and a tinted background so it reads as a celebratory post rather
        // than a plain list row.
        wishPostRowBirthday: {
            display: "flex",
            alignItems: "center",
            gap: 20,
            background: STAT_COLORS.birthdays.bg,
            border: `1px solid ${withAlpha(STAT_COLORS.birthdays.icon, 0.25)}`,
            borderRadius: radius.lg,
            padding: "28px 32px",
        },
        wishPostRowAnniversary: {
            display: "flex",
            alignItems: "center",
            gap: 20,
            background: STAT_COLORS.anniversaries.bg,
            border: `1px solid ${withAlpha(STAT_COLORS.anniversaries.icon, 0.25)}`,
            borderRadius: radius.lg,
            padding: "28px 32px",
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
        // Bigger circular photo/avatar for the new celebratory post rows.
        wishPostPhotoLarge: {
            width: 128,
            height: 128,
            minWidth: 128,
            borderRadius: radius.circle,
            objectFit: "cover",
            border: "2px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        },
        wishPostPhotoFallbackLarge: {
            width: 128,
            height: 128,
            minWidth: 128,
            borderRadius: radius.circle,
            background: "#fff",
            color: STAT_COLORS.birthdays.icon,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize["4xl"],
            border: "2px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        },
        wishPostPhotoFallbackAnniv: {
            width: 128,
            height: 128,
            minWidth: 128,
            borderRadius: radius.circle,
            background: "#fff",
            color: STAT_COLORS.anniversaries.icon,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSize["4xl"],
            border: "2px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        },
        wishPostHeading: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.bold,
            color: STAT_COLORS.birthdays.icon,
            marginBottom: 2,
            // Renders "🎉 Name" — needs the emoji-safe fallback stack.
            fontFamily: EMOJI_SAFE_FONT,
        },
        wishPostHeadingAnniv: {
            fontSize: fontSize.base,
            fontWeight: fontWeight.bold,
            color: STAT_COLORS.anniversaries.icon,
            marginBottom: 2,
            // Renders "🏆 Name" — needs the emoji-safe fallback stack.
            fontFamily: EMOJI_SAFE_FONT,
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
        wishPostMessageLarge: {
            fontSize: fontSize.sm,
            color: WARM.ink,
            lineHeight: 1.4,
            // The auto-filled wish text (buildMessage) is full of emoji
            // (🎂🎉🥳) — needs the emoji-safe fallback stack.
            fontFamily: EMOJI_SAFE_FONT,
        },
        wishPostMeta: { fontSize: fontSize.xxs, color: WARM.subtext, marginTop: 4 },
        wishPostActions: {
            display: "flex",
            flexDirection: "column",
            gap: 6,
            alignSelf: "flex-start",
            flexShrink: 0,
        },
        wishPostActionBtn: {
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: radius.sm,
            background: "rgba(255,255,255,0.7)",
            color: WARM.subtext,
            cursor: "pointer",
            fontSize: fontSize.sm,
        },

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
            background: "rgba(0,0,0,0.55)",
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
            gap: 2,
            flex: 1,
            justifyContent: "flex-start",
        },
        birthdayRow: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 0",
            borderBottom: `1px solid ${WARM.border}`,
        },
        birthdayAvatar: {
            width: 32,
            height: 32,
            minWidth: 32,
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
            width: 32,
            height: 32,
            minWidth: 32,
            borderRadius: radius.circle,
            objectFit: "cover",
        },
        birthdayName: {
            fontSize: fontSize.sm,
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
            background: "rgba(0,0,0,.45)",
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
            background: BRAND.blue,
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
            color: "#b91c1c",
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
        modalError: { fontSize: fontSize.sm, color: "#b91c1c" },
        modalPrimaryBtn: (BRAND: any) => ({
            border: "none",
            background: BRAND.blue,
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
