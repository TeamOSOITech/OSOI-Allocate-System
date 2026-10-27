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
// COUNT-ONLY WORK (no case number yet) FOLLOWS THE SAME RULE
//   Units allocated to an employee as a COUNT on an earlier day that still
//   have no case number added (service_case_count_allocations.quantity >
//   fulfilled_quantity) are sent back to the pool too: the employee's
//   allocation shrinks to what was already added (or the row is removed if
//   nothing was added). The pool figure (count.quantity - allocated) grows
//   by the same amount, so the units show up again on Today's Allocation.
//   Units that already have case numbers are never touched. One history row
//   per return goes to `case_count_carryover_log` (read-only, Past
//   Allocation) — see rolloverPendingCounts below for the table.
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

// ---- COUNT ROLLOVER ---------------------------------------------------
//
// REQUIRES THIS TABLE (run once in the Supabase SQL editor):
//
//   create table if not exists case_count_carryover_log (
//     id uuid primary key default gen_random_uuid(),
//     organization_id text not null,
//     count_id text not null,
//     product_id text,
//     client_id text,
//     subclient_id text,
//     work_date date,
//     employee_id text not null,
//     allocated_at timestamptz not null,
//     returned_quantity integer not null,
//     returned_at timestamptz not null default now(),
//     unique (count_id, employee_id, allocated_at)
//   );
//   create index if not exists case_count_carryover_log_emp_idx
//     on case_count_carryover_log (organization_id, employee_id, returned_at desc);
//
// Allocations older than this many days were already swept by an earlier
// run (the sweep runs every few minutes), so they are not re-scanned.
const COUNT_LOOKBACK_DAYS = 45;

async function rolloverPendingCounts(organizationId = null) {
  const cutoff = startOfTodayISO();
  const since = new Date(
    Date.now() - COUNT_LOOKBACK_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // 1) every allocation made on an earlier day (paged, read-only first so
  //    deleting rows below can't shift the pages).
  const allocs = [];
  for (let from = 0; from < 100000; from += BATCH) {
    let q = supabase
      .from("service_case_count_allocations")
      .select(
        "organization_id, count_id, employee_id, quantity, fulfilled_quantity, allocated_at",
      )
      .lt("allocated_at", cutoff)
      .gte("allocated_at", since)
      .order("allocated_at", { ascending: true })
      .range(from, from + BATCH - 1);
    if (organizationId) q = q.eq("organization_id", organizationId);
    const { data, error } = await q;
    if (error) throw error;
    allocs.push(...(data || []));
    if (!data || data.length < BATCH) break;
  }

  // 2) only the ones that still have units without a case number
  const open = allocs.filter(
    (a) => (a.quantity || 0) - (a.fulfilled_quantity || 0) > 0,
  );
  if (open.length === 0) return 0;

  // count details for the history rows
  const countIds = [...new Set(open.map((a) => a.count_id))];
  const countMap = {};
  for (let i = 0; i < countIds.length; i += 150) {
    const { data, error } = await supabase
      .from("service_case_counts")
      .select("id, product_id, client_id, subclient_id, work_date")
      .in("id", countIds.slice(i, i + 150));
    if (error) throw error;
    (data || []).forEach((c) => (countMap[String(c.id)] = c));
  }

  let returnedTotal = 0;
  for (const a of open) {
    const fulfilled = a.fulfilled_quantity || 0;
    const returnedQty = (a.quantity || 0) - fulfilled;
    const c = countMap[String(a.count_id)] || {};

    // history FIRST so a returned count can never lose its record
    const logRow = {
      organization_id: String(a.organization_id),
      count_id: String(a.count_id),
      product_id: c.product_id != null ? String(c.product_id) : null,
      client_id: c.client_id != null ? String(c.client_id) : null,
      subclient_id: c.subclient_id != null ? String(c.subclient_id) : null,
      work_date: c.work_date || null,
      employee_id: String(a.employee_id),
      allocated_at: a.allocated_at,
      returned_quantity: returnedQty,
    };
    const { error: logErr } = await supabase
      .from("case_count_carryover_log")
      .upsert(logRow, {
        onConflict: "count_id,employee_id,allocated_at",
        ignoreDuplicates: true,
      });
    if (logErr) throw logErr;

    // Return the units. Guarded on the exact quantity / fulfilled values we
    // read, so units the employee added a split-second ago are NOT lost.
    let moved = 0;
    if (fulfilled === 0) {
      let d = supabase
        .from("service_case_count_allocations")
        .delete()
        .eq("organization_id", a.organization_id)
        .eq("count_id", a.count_id)
        .eq("employee_id", a.employee_id)
        .eq("quantity", a.quantity)
        .lt("allocated_at", cutoff);
      d =
        a.fulfilled_quantity == null
          ? d.is("fulfilled_quantity", null)
          : d.eq("fulfilled_quantity", 0);
      const { data, error } = await d.select("count_id");
      if (error) throw error;
      moved = (data || []).length;
    } else {
      const { data, error } = await supabase
        .from("service_case_count_allocations")
        .update({ quantity: fulfilled })
        .eq("organization_id", a.organization_id)
        .eq("count_id", a.count_id)
        .eq("employee_id", a.employee_id)
        .eq("quantity", a.quantity)
        .eq("fulfilled_quantity", fulfilled)
        .lt("allocated_at", cutoff)
        .select("count_id");
      if (error) throw error;
      moved = (data || []).length;
    }

    if (moved > 0) {
      returnedTotal += returnedQty;
    } else {
      // changed under us (employee just added case numbers) — keep history truthful
      await supabase
        .from("case_count_carryover_log")
        .delete()
        .eq("count_id", String(a.count_id))
        .eq("employee_id", String(a.employee_id))
        .eq("allocated_at", a.allocated_at);
    }
  }
  return returnedTotal;
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

// Count-only work ("12 cases (count)" - units WITHOUT a case number) lives in
// service_case_count_allocations. It must go back to the pool exactly like
// numbered cases. Only the UNSUBMITTED units move: units the employee already
// fulfilled (added case numbers for) stay with them.
//   ALL  -> every open unit goes back (row deleted, or cut down to fulfilled)
//   HALF -> half of the open units (rounded up, newest allocation first)
async function releaseCountAllocationsForEmployee(
  organizationId,
  employeeId,
  mode,
) {
  const { data: rows, error } = await supabase
    .from("service_case_count_allocations")
    .select("count_id, quantity, fulfilled_quantity, allocated_at")
    .eq("organization_id", organizationId)
    .eq("employee_id", employeeId);
  if (error) throw error;

  const open = (rows || [])
    .filter((r) => (r.quantity || 0) - (r.fulfilled_quantity || 0) > 0)
    .sort((a, b) =>
      String(b.allocated_at).localeCompare(String(a.allocated_at)),
    );
  if (open.length === 0) return 0;

  const totalOpen = open.reduce(
    (s, r) => s + ((r.quantity || 0) - (r.fulfilled_quantity || 0)),
    0,
  );
  let remaining = mode === "HALF" ? Math.ceil(totalOpen / 2) : totalOpen;
  let returnedTotal = 0;

  for (const r of open) {
    if (remaining <= 0) break;
    const fulfilled = r.fulfilled_quantity || 0;
    const openQty = (r.quantity || 0) - fulfilled;
    const take = Math.min(openQty, remaining);
    const newQty = (r.quantity || 0) - take;

    // Guarded on the exact values we read, so units added a split-second
    // ago are not lost.
    let q =
      newQty <= 0
        ? supabase.from("service_case_count_allocations").delete()
        : supabase
            .from("service_case_count_allocations")
            .update({ quantity: newQty });
    q = q
      .eq("organization_id", organizationId)
      .eq("count_id", r.count_id)
      .eq("employee_id", employeeId)
      .eq("quantity", r.quantity);
    q =
      r.fulfilled_quantity == null
        ? q.is("fulfilled_quantity", null)
        : q.eq("fulfilled_quantity", r.fulfilled_quantity);

    const res = await q.select("count_id");
    if (res.error) throw res.error;
    if ((res.data || []).length > 0) {
      returnedTotal += take;
      remaining -= take;
    }
  }
  return returnedTotal;
}

// mode: "ALL" (leave) | "HALF" (half day). Returns number of cases + count
// units returned to the pool.
async function releaseCasesForEmployee(organizationId, employeeId, mode) {
  let total = 0;

  // 1) cases WITH case numbers
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
  if (ids.length > 0) {
    const toReturn =
      mode === "HALF" ? ids.slice(0, Math.ceil(ids.length / 2)) : ids;

    // Same guards as the end-of-day sweep: a case submitted a split-second
    // ago is NOT touched.
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
    total += (returned || []).length;
  }

  // 2) count-only work (no case number). A failure here must not undo (or
  //    hide) the numbered cases that were already released above.
  try {
    total += await releaseCountAllocationsForEmployee(
      organizationId,
      employeeId,
      mode,
    );
  } catch (err) {
    console.error(
      "releaseCasesForEmployee (counts) failed:",
      err?.message || err,
    );
  }

  return total;
}

async function rolloverAllOrgs() {
  const n = await rolloverPendingCases(null);
  if (n > 0) {
    console.log(`🔁 Rollover: ${n} pending case(s) returned to the pool.`);
  }
  // count-only work (no case number) follows the same rule; a failure here
  // (e.g. history table not created yet) must not break the case rollover.
  try {
    const c = await rolloverPendingCounts(null);
    if (c > 0) {
      console.log(
        `🔁 Rollover: ${c} pending count unit(s) returned to the pool.`,
      );
    }
  } catch (err) {
    console.error("rolloverPendingCounts failed:", err?.message || err);
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
  try {
    await rolloverPendingCounts(organizationId || null);
  } catch (err) {
    console.error("ensureRollover (counts) failed:", err?.message || err);
  }
}

module.exports = {
  rolloverPendingCases,
  rolloverPendingCounts,
  rolloverAllOrgs,
  ensureRollover,
  startOfTodayISO,
  todayYmdInAppTz,
  releaseCasesForEmployee,
  releaseCountAllocationsForEmployee,
};
