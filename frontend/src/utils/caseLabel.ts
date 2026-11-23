// One place that decides how a case number is shown on screen.
//
// A case that was allocated through "Anything Urgent" shows
// "<case number> (Urgent)" EVERYWHERE the case number appears
// (Production Report, Profile, Cases, QC, Today's Allocation ...), so the
// flag always travels with the number instead of each page doing its own thing.
//
// Needs `isUrgent` on the row (the backend sends it on every case list);
// backend/sql/service_cases_is_urgent.sql must have been run for it to be saved.
export function caseLabel(
    c: { caseNumber?: string | null; isUrgent?: boolean },
    fallback = ""
): string {
    const n = c.caseNumber || fallback;
    return c.isUrgent && n ? `${n} (Urgent)` : n;
}
