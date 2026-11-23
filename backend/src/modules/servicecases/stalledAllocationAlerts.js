// src/modules/servicecases/stalledAllocationAlerts.js
//
// "NOT SUBMITTING" ALERT
//
//   An employee accepted work but did not submit ANYTHING for 3 working days
//   in a row -> on the 4th working day at 4:30 PM (IST) a mail goes to
//     - the employee   ("you have not completed your allocation since ...")
//     - the employee's reporting manager (one mail listing everybody)
//
// HOW IT KNOWS (no new bookkeeping on the allocation flow)
//   Every night caseRollover.js sends unsubmitted work back to the pool and
//   writes one row per item into case_carryover_log / case_count_carryover_log.
//   So "employee E had work on day D that was left unsubmitted" = a log row
//   for E on D. A day D counts as MISSED when
//        E had such a leftover on D   AND   E submitted nothing on D.
//   (Submitting even one case that day breaks the streak.)
//
// WORKING DAYS - a day is skipped (neither counted nor breaking the streak) when
//   - it is a weekly-off day or a company holiday AND the employee had no
//     work that day (work on an off day still counts), or
//   - the employee was on LEAVE / ABSENT (attendance row or leave period).
//   A day with NO allocation for the employee, or a day on which they
//   submitted something, ends the streak (so nobody is mailed unfairly).
//
// DEDUPE: one mail per employee per streak. The streak is claimed in
//   stalled_allocation_alerts (unique organization_id + employee_id +
//   since_date) BEFORE mailing, so restarts / 2 servers never double-mail.
//
// Needs sql/stalled_allocation_alerts.sql. Until it has been run this job
// quietly does nothing (and logs once), like the acceptance reminders.
//
// Settings (.env, all optional):
//   STALL_ALERT_DAYS=3            working days without a submission
//   STALL_ALERT_TIME=16:30        IST time of day the mails go out
//   STALL_WEEKLY_OFF_DAYS=0,6     0=Sun ... 6=Sat (weekly off days)

const supabase = require("../../config/supabaseClient");
const { todayInIst, isPastExitDate } = require("../../utils/exitDate");

const TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const STALL_DAYS = Math.max(1, Number(process.env.STALL_ALERT_DAYS) || 3);
const LOOKBACK_DAYS = 30; // how far back a streak is followed
// mails may go out up to this long after the set time (covers restarts / a
// busy tick); the claim row makes sure nobody gets it twice.
const SEND_WINDOW_MINUTES = 4 * 60;

function parseTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "16:30").trim());
  if (!m) return 16 * 60 + 30;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}
const SEND_AT_MINUTES = parseTime(process.env.STALL_ALERT_TIME);

const WEEKLY_OFF = new Set(
  String(process.env.STALL_WEEKLY_OFF_DAYS ?? "0,6")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-6]$/.test(s))
    .map(Number),
);

// ---- tiny date helpers (all "YYYY-MM-DD" strings, IST) ----------------------
const istDate = (ts) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ts));

function istMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get("hour") * 60 + get("minute");
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

function prettyDate(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// ---- the rule (pure function - easy to test) --------------------------------
// ctx = {
//   today,                         // "YYYY-MM-DD"
//   leftover: Set<date>,           // days this employee had work left unsubmitted
//   submitted: Set<date>,          // days this employee submitted something
//   isOffDay(date): boolean,       // weekly off / holiday
//   isUnavailable(date): boolean,  // leave / absent
// }
// Returns { streak, since } (since = first missed day of the streak) or null.
function computeStall(ctx, minDays = STALL_DAYS, lookbackDays = LOOKBACK_DAYS) {
  const { today, leftover, submitted, isOffDay, isUnavailable } = ctx;

  // today must be a normal working day for this person and they must not have
  // submitted anything yet today.
  if (isOffDay(today) || isUnavailable(today)) return null;
  if (submitted.has(today)) return null;

  let streak = 0;
  let since = null;
  for (let i = 1; i <= lookbackDays; i++) {
    const d = addDays(today, -i);
    const had = leftover.has(d);
    if (isOffDay(d) && !had) continue; // not a working day for them
    if (isUnavailable(d)) continue; // on leave / absent
    if (had && !submitted.has(d)) {
      streak += 1;
      since = d;
      continue;
    }
    break; // no work that day, or they did submit -> streak ends
  }
  return streak >= minDays ? { streak, since } : null;
}

// ---- small DB helpers -------------------------------------------------------
async function pageAll(build) {
  const out = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const chunk = (arr, n = 150) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const isMissingTable = (err) => {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const msg = err.message || "";
  return (
    /stalled_allocation_alerts|case_carryover_log|case_count_carryover_log/i.test(
      msg,
    ) && /does not exist|could not find|schema cache/i.test(msg)
  );
};

let warnedMissing = false;
function warnMissing() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    "[stall-alert] table missing - run sql/stalled_allocation_alerts.sql in Supabase. The 3-day alert is switched off until then.",
  );
}

async function authEmailOf(authUserId) {
  if (!authUserId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

// "Reporting Manager" is stored as the manager's email.
async function resolveManager(reportingManager, orgId) {
  const v = String(reportingManager || "").trim();
  if (!v || !v.includes("@")) return { email: null, name: "" };
  const { data } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name"')
    .eq("organization_id", orgId)
    .eq("Email", v.toLowerCase())
    .limit(1)
    .maybeSingle();
  const authId = data?.["Auth User Id"] || null;
  const real = authId ? await authEmailOf(authId) : null;
  const name =
    `${data?.["First Name"] || ""} ${data?.["Last Name"] || ""}`.trim();
  return { email: real || v, name };
}

// ---- the job ----------------------------------------------------------------
let running = false;
let lastCompleteDay = null; // in-memory: finished today's pass without failures

async function runStalledAllocationAlerts() {
  if (running) return;

  const today = todayInIst();
  const nowMin = istMinutesNow();
  if (nowMin < SEND_AT_MINUTES) return; // before 4:30 PM
  if (nowMin > SEND_AT_MINUTES + SEND_WINDOW_MINUTES) return;
  if (lastCompleteDay === today) return;

  // Never mail a link that will not open (same guard as the acceptance mails).
  const { APP_LOGIN_URL } = require("./servicecases.controller");
  if (
    !/^https:\/\//i.test(APP_LOGIN_URL || "") &&
    process.env.ACCEPT_REMINDER_ALLOW_LOCAL !== "true"
  ) {
    return;
  }

  running = true;
  try {
    const failed = await sendStalledAlerts(today);
    if (!failed) lastCompleteDay = today;
  } finally {
    running = false;
  }
}

// returns true when something failed and the next tick should try again
async function sendStalledAlerts(today) {
  const from = addDays(today, -LOOKBACK_DAYS);
  // UTC instant a day earlier than `from` -> safely covers IST midnight
  const fromISO = new Date(`${addDays(from, -1)}T00:00:00Z`).toISOString();

  // 1) leftovers (work that went back to the pool unsubmitted) per employee/day
  let caseLog = [];
  let countLog = [];
  try {
    caseLog = await pageAll(() =>
      supabase
        .from("case_carryover_log")
        .select("organization_id, employee_id, allocated_at")
        .gte("allocated_at", fromISO)
        .order("allocated_at", { ascending: true }),
    );
  } catch (e) {
    if (isMissingTable(e)) {
      warnMissing();
      return false;
    }
    throw e;
  }
  try {
    countLog = await pageAll(() =>
      supabase
        .from("case_count_carryover_log")
        .select("organization_id, employee_id, allocated_at, returned_quantity")
        .gte("allocated_at", fromISO)
        .order("allocated_at", { ascending: true }),
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e; // counts log is optional
  }

  const leftoverBy = new Map(); // `${org}|${emp}` -> Set(date)
  const addLeft = (org, emp, ts) => {
    if (!org || !emp || !ts) return;
    const key = `${org}|${emp}`;
    if (!leftoverBy.has(key)) leftoverBy.set(key, new Set());
    leftoverBy.get(key).add(istDate(ts));
  };
  caseLog.forEach((r) =>
    addLeft(r.organization_id, r.employee_id, r.allocated_at),
  );
  countLog.forEach((r) => {
    if ((Number(r.returned_quantity) || 0) > 0)
      addLeft(r.organization_id, r.employee_id, r.allocated_at);
  });

  // only people with at least STALL_DAYS different leftover days can qualify
  const candidates = [...leftoverBy.entries()]
    .filter(([, days]) => days.size >= STALL_DAYS)
    .map(([key]) => {
      const [org, emp] = key.split("|");
      return { key, org, emp };
    });
  if (!candidates.length) return false;

  const empIds = [...new Set(candidates.map((c) => c.emp))];
  const orgIds = [...new Set(candidates.map((c) => c.org))];

  // 2) days on which they submitted at least one case
  const submittedBy = new Map();
  for (const ids of chunk(empIds)) {
    const rows = await pageAll(() =>
      supabase
        .from("service_cases")
        .select("organization_id, assigned_employee_id, submitted_at")
        .in("assigned_employee_id", ids)
        .eq("submission_status", "SUBMITTED")
        .gte("submitted_at", fromISO),
    );
    rows.forEach((r) => {
      if (!r.submitted_at) return;
      const key = `${r.organization_id}|${r.assigned_employee_id}`;
      if (!submittedBy.has(key)) submittedBy.set(key, new Set());
      submittedBy.get(key).add(istDate(r.submitted_at));
    });
  }

  // 3) leave / absent (attendance row wins over a leave period)
  const attBy = new Map(); // `${org}|${emp}` -> Map(date -> status)
  const leavesBy = new Map(); // `${org}|${emp}` -> [{from,to}]
  for (const ids of chunk(empIds)) {
    const att = await pageAll(() =>
      supabase
        .from("attendance")
        .select("organization_id, employee_id, attendance_date, status")
        .in("employee_id", ids)
        .gte("attendance_date", from),
    );
    att.forEach((r) => {
      const key = `${r.organization_id}|${r.employee_id}`;
      if (!attBy.has(key)) attBy.set(key, new Map());
      attBy.get(key).set(String(r.attendance_date).slice(0, 10), r.status);
    });
    try {
      const lv = await pageAll(() =>
        supabase
          .from("employee_leaves")
          .select("organization_id, employee_id, from_date, to_date")
          .in("employee_id", ids)
          .gte("to_date", from),
      );
      lv.forEach((r) => {
        const key = `${r.organization_id}|${r.employee_id}`;
        if (!leavesBy.has(key)) leavesBy.set(key, []);
        leavesBy.get(key).push({
          from: String(r.from_date).slice(0, 10),
          to: String(r.to_date).slice(0, 10),
        });
      });
    } catch (e) {
      console.error("[stall-alert] leave periods:", e?.message || e);
    }
  }

  // 4) company holidays per organization
  const holidaysBy = new Map();
  for (const org of orgIds) {
    const set = new Set();
    try {
      const { data } = await supabase
        .from("holidays")
        .select("date")
        .eq("organization_id", org);
      (data || []).forEach((h) => {
        const d = String(h.date || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
      });
    } catch {
      /* no holiday table -> only weekly off days apply */
    }
    holidaysBy.set(org, set);
  }

  // 5) apply the rule
  const stalled = [];
  for (const c of candidates) {
    const hol = holidaysBy.get(c.org) || new Set();
    const att = attBy.get(c.key) || new Map();
    const leaves = leavesBy.get(c.key) || [];
    const result = computeStall({
      today,
      leftover: leftoverBy.get(c.key) || new Set(),
      submitted: submittedBy.get(c.key) || new Set(),
      isOffDay: (d) => WEEKLY_OFF.has(weekday(d)) || hol.has(d),
      isUnavailable: (d) => {
        const st = att.get(d);
        if (st) return st === "LEAVE" || st === "ABSENT";
        return leaves.some((l) => l.from <= d && d <= l.to);
      },
    });
    if (result) stalled.push({ ...c, ...result });
  }
  if (!stalled.length) return false;

  // 6) CLAIM first - only the run that inserts the row mails it
  const claimed = [];
  for (const s of stalled) {
    const { data, error } = await supabase
      .from("stalled_allocation_alerts")
      .upsert(
        {
          organization_id: s.org,
          employee_id: s.emp,
          since_date: s.since,
          alert_date: today,
          missed_days: s.streak,
        },
        {
          onConflict: "organization_id,employee_id,since_date",
          ignoreDuplicates: true,
        },
      )
      .select("employee_id");
    if (error) {
      if (isMissingTable(error)) {
        warnMissing();
        return false;
      }
      throw error;
    }
    if (data && data.length) claimed.push(s);
  }
  if (!claimed.length) return false;

  // 7) names + mail addresses
  const {
    buildAllocationEmailHtml,
    sendEmail,
  } = require("./servicecases.controller");
  const people = {};
  for (const org of orgIds) {
    const ids = claimed.filter((c) => c.org === org).map((c) => c.emp);
    if (!ids.length) continue;
    const { data } = await supabase
      .from("user_master")
      .select(
        '"Auth User Id", "First Name", "Last Name", "Reporting Manager", "Date of Exit"',
      )
      .eq("organization_id", org)
      .in("Auth User Id", ids);
    (data || []).forEach((p) => (people[`${org}|${p["Auth User Id"]}`] = p));
  }

  const release = async (s) => {
    await supabase
      .from("stalled_allocation_alerts")
      .delete()
      .eq("organization_id", s.org)
      .eq("employee_id", s.emp)
      .eq("since_date", s.since);
  };

  const byManager = new Map(); // `${org}|${email}` -> { manager, entries[] }
  let anyFailed = false;

  for (const s of claimed) {
    const p = people[`${s.org}|${s.emp}`] || {};
    if (isPastExitDate(p["Date of Exit"])) continue; // left the company
    const name =
      `${p["First Name"] || ""} ${p["Last Name"] || ""}`.trim() ||
      "An employee";
    const sinceTxt = prettyDate(s.since);
    const days = `${s.streak} working day${s.streak > 1 ? "s" : ""}`;

    const [empEmail, manager] = await Promise.all([
      authEmailOf(s.emp),
      resolveManager(p["Reporting Manager"], s.org),
    ]);

    let sentAny = false;

    // ---- the employee ----
    if (empEmail) {
      s._attempted = true;
      try {
        await sendEmail({
          to: empEmail,
          subject: `You haven't completed your allocation since ${sinceTxt}`,
          text: `Hi ${name}, we have seen that you have not completed your allocation since ${sinceTxt} (${days}). What happened? Have you faced any problem? Please talk to your manager.`,
          html: buildAllocationEmailHtml({
            icon: "&#9888;",
            heading: "Allocation Not Completed",
            headline: `Hi ${esc(name)}, we have seen that you have not completed your allocation since ${esc(sinceTxt)}.`,
            subtext: `It has been ${esc(days)} without a submission. What happened? Have you faced any problem? Please talk to your manager.`,
            headSolid: "#EA6C0A",
            headGradient:
              "linear-gradient(135deg,#FBBF24 0%,#F97316 55%,#EA580C 100%)",
          }),
        });
        sentAny = true;
      } catch (e) {
        console.error("[stall-alert] employee mail failed:", e?.message || e);
      }
    }

    // ---- collect for the manager (one mail per manager) ----
    if (manager.email) {
      const k = `${s.org}|${manager.email.toLowerCase()}`;
      if (!byManager.has(k)) byManager.set(k, { manager, entries: [] });
      byManager.get(k).entries.push({ name, sinceTxt, days, s });
    }

    if (!empEmail && !manager.email) {
      console.warn(`[stall-alert] ${name}: no email / reporting manager found`);
    }
    s._employeeSent = sentAny;
  }

  // ---- the managers ----
  for (const { manager, entries } of byManager.values()) {
    const rows = entries
      .slice(0, 40)
      .map(
        (e, i) =>
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:9px 0;${i ? "border-top:1px solid #F8DFB0;" : ""}color:#1e2a4a;font-size:15px;font-weight:800;">${esc(e.name)}</td><td align="right" style="padding:9px 0;${i ? "border-top:1px solid #F8DFB0;" : ""}color:#C2410C;font-size:13px;font-weight:800;white-space:nowrap;">since ${esc(e.sinceTxt)} &middot; ${esc(e.days)}</td></tr></table>`,
      )
      .join("");
    const more = entries.length - 40;
    const detail = `<div style="background:#FFF7E6;border:1px solid #F8DFB0;border-radius:12px;padding:12px 16px;margin:0 0 8px;">${rows}${more > 0 ? `<div style="color:#C2410C;font-size:13px;font-weight:700;">+ ${more} more</div>` : ""}</div>`;

    const single = entries.length === 1;
    const first = entries[0];
    entries.forEach((e) => (e.s._attempted = true));
    try {
      await sendEmail({
        to: manager.email,
        subject: single
          ? `${first.name} hasn't completed their allocation since ${first.sinceTxt}`
          : `${entries.length} team members haven't completed their allocation`,
        text: single
          ? `${first.name} has not completed their allocation since ${first.sinceTxt} (${first.days}). Please ask them whether they are facing any problem.`
          : `${entries.length} of your team members have not completed their allocation for ${STALL_DAYS}+ working days: ${entries.map((e) => `${e.name} (since ${e.sinceTxt})`).join(", ")}. Please ask them whether they are facing any problem.`,
        html: buildAllocationEmailHtml({
          icon: "&#9888;",
          heading: "Allocation Not Completed",
          headline: single
            ? `${esc(first.name)} has not completed their allocation since ${esc(first.sinceTxt)}.`
            : `${entries.length} of your team members have not completed their allocation.`,
          subtext:
            "Please ask them whether they are facing any problem and how you can help.",
          headSolid: "#EA6C0A",
          headGradient:
            "linear-gradient(135deg,#FBBF24 0%,#F97316 55%,#EA580C 100%)",
          detailHtml: detail,
        }),
      });
      entries.forEach((e) => (e.s._managerSent = true));
    } catch (e) {
      console.error("[stall-alert] manager mail failed:", e?.message || e);
    }
  }

  // ---- nobody could be mailed -> release the claim so the next tick retries
  for (const s of claimed) {
    const p = people[`${s.org}|${s.emp}`] || {};
    if (isPastExitDate(p["Date of Exit"])) continue;
    // A mail was TRIED but none arrived -> give the claim back so the next
    // tick retries. (No email address at all is not a failure: keep the claim,
    // otherwise it would be retried every 5 minutes for nothing.)
    if (s._attempted && !s._employeeSent && !s._managerSent) {
      anyFailed = true;
      await release(s).catch(() => {});
    }
  }

  const sent = claimed.filter((s) => s._employeeSent || s._managerSent).length;
  if (sent) console.log(`[stall-alert] ${sent} employee(s) mailed.`);
  return anyFailed;
}

module.exports = { runStalledAllocationAlerts, computeStall };
