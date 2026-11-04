// src/utils/exitDate.js
//
// SECURITY: an employee whose "Date of Exit" has passed must not be able to
// log in or keep using an existing session. The exit date is treated as the
// LAST working day: access is blocked from the day AFTER it (IST).

const TZ = "Asia/Kolkata";

function todayInIst() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// exitDate: "YYYY-MM-DD" (or an ISO string) or null/undefined/"".
// Returns true only when a valid exit date exists and is strictly before today.
function isPastExitDate(exitDate, today = todayInIst()) {
  if (!exitDate) return false;
  const ymd = String(exitDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false; // unparseable -> don't lock anyone out
  return ymd < today;
}

module.exports = { isPastExitDate, todayInIst };
