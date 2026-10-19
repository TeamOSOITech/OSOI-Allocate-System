// src/modules/servicecases/caseRollover.js
//
// END-OF-DAY ROLLOVER for allocated cases.
//
// RULE
//   A case that was allocated to an employee on an EARLIER day and is
//   still submission-PENDING (the employee never picked Completed / Query /
//   Completed by Team / Completed by Client) is sent BACK TO THE POOL:
//
//     service_cases.assigned_employee_id -> null
//     service_cases.allocation_status    -> 'PENDING'   (= unallocated)
//     service_cases.allocated_at / allocated_by -> null
//
//   Because the Cases tab and Smart Allocation already pull every
//   unallocated (PENDING) case with work_date <= the chosen date, the case
//   shows up automatically the next time someone picks that service on
//   Today's Allocation, and gets re-allocated like any other pending case.
//
//   Cases that DO have an outcome (Completed, Query, Completed by Team,
//   Completed by Client) are never touched.
//
// HISTORY
//   Before a case is returned, one row is written to `case_carryover_log`
//   (who it was allocated to, when, and when it was returned). The Profile
//   page reads this to show "assigned to you, left pending" under Past
//   Allocation — read-only, no Submit button.
//
// WHEN IT RUNS (all idempotent, safe to run any number of times)
//   - every few minutes from server.js (rolloverAllOrgs)
//   - lazily (throttled) when the Cases list / Smart Allocation / Profile
//     are opened or a case is submitted, so nothing stale is ever shown
//     even if the timer has not fired yet.
//
// REQUIRES THIS TABLE (run once in the Supabase SQL editor):
//
//   create table if not exists case_carryover_log (
//     id uuid primary key default gen_random_uuid(),
//     organization_id text not null,
//     case_id text not null,
//     case_number text,
//     product_id text,
//     client_id text,
//     subclient_id text,
//     work_date date,
//     employee_id text not null,
//     allocated_at timestamptz not null,
//     returned_at timestamptz not null default now(),
//     unique (case_id, employee_id, allocated_at)
//   );
//   create index if not exists case_carryover_log_emp_idx
//     on case_carryover_log (organization_id, employee_id, returned_at desc);
//
// (ids are text so this works whatever id type your other tables use.)
//
// TIMEZONE: "a new day" starts at midnight in APP_TIMEZONE
// (.env, default Asia/Kolkata).

const supabase = require("../../config/supabaseClient");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const BATCH = 500;
// Lazy callers (list/submit/profile) re-run the sweep at most this often.
const LAZY_THROTTLE_MS = 60 * 1000;

// ---- timezone helpers -------------------------------------------------

// Offset (in minutes) of APP_TIMEZONE from UTC at the given instant.
function tzOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

// ISO timestamp of 00:00 TODAY in APP_TIMEZONE. Anything allocated
// strictly before this belongs to an earlier day.
function startOfTodayISO(now = new Date()) {
  const offset = tzOffsetMinutes(now);
  const local = new Date(now.getTime() + offset * 60000);
  const midnightLocalAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(midnightLocalAsUtc - offset * 60000).toISOString();
}

// ---- core sweep -------------------------------------------------------

// organizationId optional: omit to sweep every organization.
async function rolloverPendingCases(organizationId = null) {
  const cutoff = startOfTodayISO();
  let totalReturned = 0;

  // Loop in batches. Every returned case leaves the candidate set (its
  // allocation_status flips to PENDING), so re-querying from the top
  // each time always yields the next batch.
  // Hard cap on loops so a bad row can never spin forever.
  for (let loop = 0; loop < 200; loop++) {
    let q = supabase
      .from("service_cases")
      .select(
        "id, organization_id, case_number, product_id, client_id, subclient_id, work_date, assigned_employee_id, allocated_at",
      )
      .eq("allocation_status", "ALLOCATED")
      .not("assigned_employee_id", "is", null)
      .lt("allocated_at", cutoff)
      // not submitted yet: NULL or 'PENDING'
      .or("submission_status.is.null,submission_status.eq.PENDING")
      .limit(BATCH);
    if (organizationId) q = q.eq("organization_id", organizationId);

    const { data: candidates, error } = await q;
    if (error) throw error;
    if (!candidates || candidates.length === 0) break;

    // 1) write history FIRST so a returned case can never lose its record.
    const logRows = candidates.map((c) => ({
      organization_id: String(c.organization_id),
      case_id: String(c.id),
      case_number: c.case_number,
      product_id: c.product_id != null ? String(c.product_id) : null,
      client_id: c.client_id != null ? String(c.client_id) : null,
      subclient_id: c.subclient_id != null ? String(c.subclient_id) : null,
      work_date: c.work_date || null,
      employee_id: String(c.assigned_employee_id),
      allocated_at: c.allocated_at,
    }));
    const { error: logError } = await supabase
      .from("case_carryover_log")
      .upsert(logRows, {
        onConflict: "case_id,employee_id,allocated_at",
        ignoreDuplicates: true,
      });
    if (logError) throw logError;

    // 2) send the cases back to the pool. The same guards are repeated
    //    here so a case the employee submitted a split-second ago is NOT
    //    touched.
    const ids = candidates.map((c) => c.id);
    const { data: returned, error: updError } = await supabase
      .from("service_cases")
      .update({
        assigned_employee_id: null,
        allocation_status: "PENDING",
        allocated_at: null,
        allocated_by: null,
      })
      .in("id", ids)
      .eq("allocation_status", "ALLOCATED")
      .lt("allocated_at", cutoff)
      .or("submission_status.is.null,submission_status.eq.PENDING")
      .select("id");
    if (updError) throw updError;

    // 3) drop log rows for any case that was NOT returned (submitted in
    //    the gap between step 1 and 2) so history stays truthful.
    const returnedIds = new Set((returned || []).map((r) => String(r.id)));
    const skipped = candidates.filter((c) => !returnedIds.has(String(c.id)));
    for (const s of skipped) {
      await supabase
        .from("case_carryover_log")
        .delete()
        .eq("case_id", String(s.id))
        .eq("employee_id", String(s.assigned_employee_id))
        .eq("allocated_at", s.allocated_at);
    }

    totalReturned += returnedIds.size;
    // Nothing moved this round -> the rest are all "skipped"; stop.
    if (returnedIds.size === 0) break;
    if (candidates.length < BATCH) break;
  }

  return totalReturned;
}

// ---- LEAVE / HALF-DAY RELEASE -----------------------------------------
//
// When an employee is marked LEAVE (or put on a leave period that covers
// today), every case still sitting with them that has NOT been submitted goes
// back to the main pool. When they are marked HALF_DAY, HALF of those
// unsubmitted cases (rounded up, most recently allocated first) go back.
// Submitted cases (Completed / Query / ...) are never touched.
//
// Only acts on TODAY (APP_TIMEZONE): marking a past or future date must not
// pull back today's work.

function todayYmdInAppTz(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // YYYY-MM-DD
}

// mode: "ALL" (leave) | "HALF" (half day). Returns number of cases returned.
async function releaseCasesForEmployee(organizationId, employeeId, mode) {
  const { data: open, error } = await supabase
    .from("service_cases")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("assigned_employee_id", employeeId)
    .eq("allocation_status", "ALLOCATED")
    .or("submission_status.is.null,submission_status.eq.PENDING")
    .order("allocated_at", { ascending: false });
  if (error) throw error;

  const ids = (open || []).map((c) => c.id);
  if (ids.length === 0) return 0;

  const toReturn =
    mode === "HALF" ? ids.slice(0, Math.ceil(ids.length / 2)) : ids;

  // Same guards as the end-of-day sweep: a case submitted a split-second ago
  // is NOT touched.
  const { data: returned, error: updError } = await supabase
    .from("service_cases")
    .update({
      assigned_employee_id: null,
      allocation_status: "PENDING",
      allocated_at: null,
      allocated_by: null,
    })
    .in("id", toReturn)
    .eq("assigned_employee_id", employeeId)
    .eq("allocation_status", "ALLOCATED")
    .or("submission_status.is.null,submission_status.eq.PENDING")
    .select("id");
  if (updError) throw updError;
  return (returned || []).length;
}

async function rolloverAllOrgs() {
  const n = await rolloverPendingCases(null);
  if (n > 0) {
    console.log(`🔁 Rollover: ${n} pending case(s) returned to the pool.`);
  }
  return n;
}

// Throttled, never throws — safe to `await` at the top of any request.
const lastRunByOrg = new Map();
async function ensureRollover(organizationId) {
  const key = organizationId || "*";
  const now = Date.now();
  if (now - (lastRunByOrg.get(key) || 0) < LAZY_THROTTLE_MS) return;
  lastRunByOrg.set(key, now);
  try {
    await rolloverPendingCases(organizationId || null);
  } catch (err) {
    // Missing table / transient DB error must never break the request.
    console.error("ensureRollover failed:", err?.message || err);
  }
}

module.exports = {
  rolloverPendingCases,
  rolloverAllOrgs,
  ensureRollover,
  startOfTodayISO,
  todayYmdInAppTz,
  releaseCasesForEmployee,
};
