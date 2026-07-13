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

const SUBMIT_KEYWORDS = [
    "submit",
    "register",
    "save user",
    "सबमिट",
    "रजिस्टर करें",
    "रजिस्टर",
    "सेव करें",
];

function normalize(text: string) {
    return text.toLowerCase().trim();
}

export function parseVoiceCommand(command: string) {
    const rawText = command || "";
    const text = normalize(rawText);

    console.log("Received Voice:", command);

    const wantsSubmit = SUBMIT_KEYWORDS.some((k) => text.includes(k));

    // Recognize as an ADD_USER command if ANY field keyword is present,
    // OR a bare role value (admin/manager/employee) is spoken alone,
    // OR the explicit "add user"/"create user" phrase is used.
    const anyFieldKeywordPresent = Object.values(FIELD_KEYWORDS)
        .flat()
        .some((k) => text.includes(k));
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

    // Find every keyword occurrence (for every field) and its position,
    // then sort by position so text between two keywords becomes that field's value.
    // This works whether the person says one field alone or several in one sentence.
    type Hit = { field: string; start: number; end: number };
    const hits: Hit[] = [];

    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
        for (const keyword of keywords) {
            const idx = text.indexOf(keyword);
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
        if (value) extracted[current.field] = value;
    }

    const email =
        rawText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ||
        extracted.email ||
        "";

    // Role: prefer whatever comes after the word "role" if present,
    // otherwise fall back to detecting a bare admin/manager/employee mention.
    const roleRaw = (extracted.role || text).toLowerCase();
    const role =
        roleRaw.includes("admin") || roleRaw.includes("एडमिन")
            ? "ADMIN"
            : roleRaw.includes("manager") || roleRaw.includes("मैनेजर")
              ? "MANAGER"
              : roleRaw.includes("employee") || roleRaw.includes("एम्प्लॉई")
                ? "EMPLOYEE"
                : "";

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
            department: extracted.department || "",
            dob: extracted.dob || "",
            doj: extracted.doj || "",
            reportingManager: extracted.reportingManager || "",
            workedInTeams: extracted.workedInTeams || "",
        },
    };
}
