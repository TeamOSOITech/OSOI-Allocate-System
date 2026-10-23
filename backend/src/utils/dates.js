// Shared date helpers. "Today" must be computed in the business timezone
// (default Asia/Kolkata), NOT UTC, or between 00:00-05:30 IST it returns
// yesterday.
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

function todayInTz(tz = APP_TIMEZONE) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

module.exports = { APP_TIMEZONE, todayInTz };
