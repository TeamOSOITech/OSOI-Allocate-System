console.log("VOICE PARSER FILE LOADED");

const FIELD_KEYWORDS: Record<string, string[]> = {
    firstName: ["full name", "naam", "नाम", "पूरा नाम", "name"],
    email: ["email", "ईमेल", "mail"],
    role: ["role", "पद स्तर", "रोल"],
    password: ["password", "पासवर्ड"],
    employeeId: ["employee id", "employee code", "कर्मचारी आईडी", "इम्प्लॉई आईडी"],
    designation: ["designation", "पद", "पदनाम"],
    department: ["department", "विभाग"],
    dob: ["date of birth", "जन्म तिथि", "जन्मतिथि"],
    doj: ["date of joining", "joining date", "ज्वाइनिंग डेट", "ज्वाइनिंग तिथि"],
    reportingManager: ["reporting manager", "manager email", "रिपोर्टिंग मैनेजर"],
    workedInTeams: ["worked in team", "worked in teams", "team", "टीम"],
};

const ROLE_VALUE_KEYWORDS = ["admin", "एडमिन", "manager", "मैनेजर", "employee", "एम्प्लॉई"];

// Require a deliberate, multi-word phrase to submit — NOT the bare word
// "submit" on its own. A plain substring check on just "submit" fires on
// ANY sentence that happens to contain that word anywhere (e.g. a designation
// or note mentioning "submitted"), which caused the form to silently
// register and navigate away before the user could review it.
const EXPLICIT_SUBMIT_PHRASES = [
    "submit now",
    "submit the form",
    "register the user",
    "register this user",
    "please submit",
    "confirm and submit",
    "अभी सबमिट करें",
    "यूजर रजिस्टर करें",
];

// Phrases that signal "end of command" rather than part of a field's value.
// If spoken after a value (e.g. "full name is Rahul, add user"), they get
// trimmed off the tail of the extracted value instead of being captured as
// part of it.
const TRAILING_STOP_PHRASES = [
    "add user",
    "create user",
    "add the user",
    "create the user",
    ...EXPLICIT_SUBMIT_PHRASES,
];

// FIX #1: no longer trims. Keyword indices are found in `text` and then used
// directly to slice `rawText` — if `text` were trimmed but `rawText` wasn't,
// every index after the first would be off by the number of leading
// whitespace characters removed, corrupting every field's extracted value
// except (by luck) the very first one spoken. Lowercasing doesn't change
// string length, so it's safe to keep; trimming is not.
function normalize(text: string) {
    return text.toLowerCase();
}

// Word-boundary aware search for ASCII keywords (prevents "name" from
// matching inside an unrelated longer word). Falls back to plain
// substring search for non-ASCII (Hindi) keywords, since \b doesn't
// work reliably across Devanagari.
function findKeyword(text: string, keyword: string): number {
    const isAscii = /^[a-z0-9\s]+$/i.test(keyword);
    if (!isAscii) return text.indexOf(keyword);

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`\\b${escaped}\\b`, "i"));
    return match ? (match.index ?? -1) : -1;
}

const MONTH_NAMES: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
};

function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Converts a freeform spoken date ("10 May 1995", "May 10th 1995",
// "10/05/1995", "10-5-1995") into the yyyy-mm-dd format that
// <input type="date"> requires. Returns "" if it can't confidently parse one.
export function parseSpokenDate(raw: string): string {
    if (!raw) return "";
    let text = raw
        .toLowerCase()
        .replace(/(\d+)(st|nd|rd|th)/g, "$1") // "10th" -> "10"
        .replace(/\bof\b/g, "")
        .trim();

    // Already ISO: yyyy-mm-dd
    let m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
        const [, y, mo, d] = m;
        if (isValidDate(+y, +mo, +d)) return `${y}-${pad2(+mo)}-${pad2(+d)}`;
    }

    // Numeric day-month-year: 10/05/1995 or 10-5-1995
    m = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) {
        const [, d, mo, y] = m;
        if (isValidDate(+y, +mo, +d)) return `${y}-${pad2(+mo)}-${pad2(+d)}`;
    }

    // "10 may 1995"
    m = text.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
    if (m) {
        const [, d, moName, y] = m;
        const mo = MONTH_NAMES[moName];
        if (mo && isValidDate(+y, mo, +d)) return `${y}-${pad2(mo)}-${pad2(+d)}`;
    }

    // "may 10 1995" / "may 10, 1995"
    m = text.match(/([a-z]+)\s+(\d{1,2})[,]?\s+(\d{4})/);
    if (m) {
        const [, moName, d, y] = m;
        const mo = MONTH_NAMES[moName];
        if (mo && isValidDate(+y, mo, +d)) return `${y}-${pad2(mo)}-${pad2(+d)}`;
    }

    return "";
}

function stripTrailingStopPhrase(value: string): string {
    let cleaned = value;
    let changed = true;

    while (changed) {
        changed = false;
        for (const phrase of TRAILING_STOP_PHRASES) {
            const lower = cleaned.toLowerCase();
            if (lower.endsWith(phrase)) {
                cleaned = cleaned.slice(0, cleaned.length - phrase.length).trim();
                // also drop a trailing comma/"and"/dash left behind
                cleaned = cleaned.replace(/[,\-]+$/, "").trim();
                cleaned = cleaned.replace(/\b(and|please)$/i, "").trim();
                changed = true;
            }
        }
    }

    return cleaned;
}

// Canonical option lists for the <select> dropdowns on the Add New User form.
// Spoken values are fuzzy-matched against these so e.g. "IT department" or
// "engineering" resolve to the exact option value the <select> expects.
// UPDATE THESE ARRAYS to match your real dropdown options exactly.
const DEPARTMENT_OPTIONS = [
    "Engineering",
    "Sales",
    "Marketing",
    "HR",
    "Finance",
    "Operations",
    "IT",
];
const ROLE_OPTIONS: Record<string, string> = {
    admin: "ADMIN",
    एडमिन: "ADMIN",
    manager: "MANAGER",
    मैनेजर: "MANAGER",
    employee: "EMPLOYEE",
    एम्प्लॉई: "EMPLOYEE",
};

function matchDropdownValue(spoken: string, options: string[]): string {
    if (!spoken) return "";
    const lower = spoken.toLowerCase();
    const exact = options.find((o) => o.toLowerCase() === lower);
    if (exact) return exact;
    const partial = options.find(
        (o) => lower.includes(o.toLowerCase()) || o.toLowerCase().includes(lower)
    );
    return partial || "";
}

export function parseVoiceCommand(command: string) {
    const rawText = command || "";
    const text = normalize(rawText);

    console.log("Received Voice:", command);

    const wantsSubmit = EXPLICIT_SUBMIT_PHRASES.some((k) => text.includes(k));

    // User only wants to submit the already-filled form
    if (wantsSubmit) {
        const hasAddUserWords =
            text.includes("add user") ||
            text.includes("create user") ||
            Object.values(FIELD_KEYWORDS)
                .flat()
                .some((k) => findKeyword(text, k) !== -1) ||
            ROLE_VALUE_KEYWORDS.some((k) => text.includes(k));

        if (!hasAddUserWords) {
            return {
                intent: "SUBMIT_FORM",
            };
        }
    }

    const anyFieldKeywordPresent = Object.values(FIELD_KEYWORDS)
        .flat()
        .some((k) => findKeyword(text, k) !== -1);
    const anyRoleValuePresent = ROLE_VALUE_KEYWORDS.some((k) => text.includes(k));
    const explicitAddUser =
        text.includes("add user") ||
        text.includes("create user") ||
        text.includes("यूजर") ||
        text.includes("यूज़र");

    const looksLikeAddUser = anyFieldKeywordPresent || anyRoleValuePresent || explicitAddUser;

    if (!looksLikeAddUser) {
        return { intent: "UNKNOWN", wantsSubmit, text: rawText };
    }

    type Hit = { field: string; start: number; end: number };
    const hits: Hit[] = [];

    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
        for (const keyword of keywords) {
            const idx = findKeyword(text, keyword);
            if (idx !== -1) {
                hits.push({ field, start: idx, end: idx + keyword.length });
                break; // only take the first match per field per utterance
            }
        }
    }

    hits.sort((a, b) => a.start - b.start);

    const extracted: Record<string, string> = {};

    for (let i = 0; i < hits.length; i++) {
        const current = hits[i];
        const next = hits[i + 1];
        const sliceEnd = next ? next.start : rawText.length;
        let value = rawText.slice(current.end, sliceEnd).trim();
        value = value.replace(/^(is|as|hai|:)\s+/i, "").trim();
        value = stripTrailingStopPhrase(value);
        value = value.replace(/[.,!?]+$/, "").trim();
        if (value) extracted[current.field] = value;
    }

    const email =
        rawText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ||
        extracted.email ||
        "";

    const roleRaw = (extracted.role || text).toLowerCase();
    let role = "";
    for (const [keyword, value] of Object.entries(ROLE_OPTIONS)) {
        if (roleRaw.includes(keyword)) {
            role = value;
            break;
        }
    }

    const password = (extracted.password || "")
        .replace(/at the rate/gi, "@")
        .replace(/एट द रेट/g, "@")
        .trim();

    const name = extracted.firstName || "";

    return {
        intent: "ADD_USER",
        wantsSubmit,
        data: {
            firstName: name ? name.split(" ")[0] : "",
            lastName: name ? name.split(" ").slice(1).join(" ") : "",
            email,
            role,
            password,
            employeeId: extracted.employeeId || "",
            designation: extracted.designation || "",
            // Fuzzy-matched to an exact <select> option instead of raw spoken text
            department: matchDropdownValue(extracted.department || "", DEPARTMENT_OPTIONS),
            dob: parseSpokenDate(extracted.dob || ""),
            doj: parseSpokenDate(extracted.doj || ""),
            reportingManager: extracted.reportingManager || "",
            workedInTeams: extracted.workedInTeams || "",
        },
    };
}
