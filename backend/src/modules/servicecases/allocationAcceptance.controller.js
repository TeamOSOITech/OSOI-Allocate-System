// src/modules/servicecases/allocationAcceptance.controller.js
//
// Accept / Decline for work that someone ELSE allocated to an employee, plus
// the "not accepted after 2 hours" reminder mail.
//
//   GET  /api/service-cases/my-acceptances          -> what is waiting for me
//   POST /api/service-cases/my-acceptances/respond  -> accept / decline
//   runAcceptanceReminders()                        -> called from server.js
//
// How a row becomes "waiting": allocateServiceCase / saveCountAllocations set
// acceptance_status = 'PENDING' when a manager allocates to someone else.
// Self-allocated work, work that already existed, and everything created by
// other flows stay 'ACCEPTED' (the column default), so nothing else changes.
//
// Needs sql/allocation_acceptance.sql. Until it has been run every function
// here quietly does nothing (and logs once), so the app keeps working.

const supabase = require("../../config/supabaseClient");
const { fetchAll } = require("../../utils/fetchAll");
const { sendPushToUsers } = require("../../utils/webpush");
const { startOfTodayISO } = require("./caseRollover");
const {
  getProductNameMap,
  getClientNameMap,
  getSubclientNameMap,
  getEmployeeNameMap,
  buildAllocationEmailHtml,
  sendEmail,
  APP_LOGIN_URL,
} = require("./servicecases.controller");

// Shown in the Decline dropdown. The backend re-checks against this list, so
// a request can not save a reason that is not offered.
const DECLINE_REASONS = [
  "Already overloaded with work",
  "On leave / not available",
  "Don't have the required skills or training",
  "Wrongly allocated to me",
  "Not part of my team's work",
  "Other",
];

// how long an allocation may stay unanswered before the reminder goes out
const REMINDER_AFTER_HOURS = Number(process.env.ACCEPT_REMINDER_HOURS) || 2;
// never mail about allocations older than this (e.g. right after deploy)
const REMINDER_MAX_AGE_HOURS = 72;

const MAX_DECISIONS = 300;
// longest free-text reason kept for "Other"
const MAX_REASON_NOTE = 300;

const isMissingColumn = (err) =>
  !!err &&
  (err.code === "42703" ||
    err.code === "PGRST204" ||
    /acceptance_status|acceptance_reminder_sent_at|accepted_at/i.test(
      err.message || "",
    ));

let warnedMissingColumns = false;
function warnMissingColumns() {
  if (warnedMissingColumns) return;
  warnedMissingColumns = true;
  console.warn(
    "[acceptance] acceptance_* columns are missing — run sql/allocation_acceptance.sql in Supabase. Accept/Decline is switched off until then.",
  );
}

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// "submission_status is null or not SUBMITTED" (plain .neq would drop NULLs)
const NOT_SUBMITTED =
  "submission_status.is.null,submission_status.neq.SUBMITTED";
const NOTHING_DONE = "fulfilled_quantity.is.null,fulfilled_quantity.eq.0";

// ------------------------------------------------------------
// GET /api/service-cases/my-acceptances
// ------------------------------------------------------------
async function listMyPendingAcceptances(req, res) {
  try {
    const orgId = req.user.organizationId;
    const me = req.user.userId;

    const { data: caseRows, error: cErr } = await fetchAll(() =>
      supabase
        .from("service_cases")
        .select(
          "id, case_number, product_id, client_id, subclient_id, work_date, allocated_at, allocated_by",
        )
        .eq("organization_id", orgId)
        .eq("assigned_employee_id", me)
        .eq("allocation_status", "ALLOCATED")
        .eq("acceptance_status", "PENDING")
        .or(NOT_SUBMITTED)
        .order("allocated_at", { ascending: true })
        .order("id", { ascending: true }),
    );
    if (cErr) {
      if (isMissingColumn(cErr)) {
        warnMissingColumns();
        return res.json({
          success: true,
          data: { items: [], reasons: DECLINE_REASONS },
        });
      }
      throw cErr;
    }

    const { data: allocRows, error: aErr } = await supabase
      .from("service_case_count_allocations")
      .select(
        "count_id, quantity, fulfilled_quantity, allocated_at, allocated_by",
      )
      .eq("organization_id", orgId)
      .eq("employee_id", me)
      .eq("acceptance_status", "PENDING")
      .or(NOTHING_DONE)
      .order("allocated_at", { ascending: true });
    if (aErr && !isMissingColumn(aErr)) throw aErr;
    const allocs = (allocRows || []).filter((a) => (a.quantity || 0) > 0);

    let countMap = {};
    if (allocs.length) {
      const { data: counts, error: ctErr } = await supabase
        .from("service_case_counts")
        .select("id, product_id, client_id, subclient_id, work_date")
        .eq("organization_id", orgId)
        .in(
          "id",
          allocs.map((a) => a.count_id),
        );
      if (ctErr) throw ctErr;
      countMap = Object.fromEntries(
        (counts || []).map((c) => [String(c.id), c]),
      );
    }

    const cases = caseRows || [];
    const [productMap, clientMap, subclientMap, employeeMap] =
      await Promise.all([
        getProductNameMap(
          [
            ...cases.map((c) => c.product_id),
            ...Object.values(countMap).map((c) => c.product_id),
          ],
          orgId,
        ),
        getClientNameMap(
          [
            ...cases.map((c) => c.client_id),
            ...Object.values(countMap).map((c) => c.client_id),
          ],
          orgId,
        ),
        getSubclientNameMap(
          [
            ...cases.map((c) => c.subclient_id),
            ...Object.values(countMap).map((c) => c.subclient_id),
          ],
          orgId,
        ),
        getEmployeeNameMap(
          [
            ...cases.map((c) => c.allocated_by),
            ...allocs.map((a) => a.allocated_by),
          ],
          orgId,
        ),
      ]);

    const items = [
      ...cases.map((c) => ({
        kind: "CASE",
        id: String(c.id),
        caseNumber: c.case_number,
        quantity: 1,
        productName: productMap[c.product_id] || null,
        clientName: clientMap[c.client_id] || null,
        subclientName: subclientMap[c.subclient_id] || null,
        workDate: c.work_date,
        allocatedAt: c.allocated_at || null,
        allocatedByName: employeeMap[c.allocated_by] || null,
      })),
      ...allocs
        .filter((a) => countMap[String(a.count_id)])
        .map((a) => {
          const ct = countMap[String(a.count_id)];
          return {
            kind: "COUNT",
            id: String(a.count_id),
            caseNumber: null,
            quantity: a.quantity,
            productName: productMap[ct.product_id] || null,
            clientName: clientMap[ct.client_id] || null,
            subclientName: subclientMap[ct.subclient_id] || null,
            workDate: ct.work_date,
            allocatedAt: a.allocated_at || null,
            allocatedByName: employeeMap[a.allocated_by] || null,
          };
        }),
    ].sort((x, y) =>
      String(x.allocatedAt || "").localeCompare(String(y.allocatedAt || "")),
    );

    res.json({ success: true, data: { items, reasons: DECLINE_REASONS } });
  } catch (err) {
    console.error("listMyPendingAcceptances error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// GET /api/service-cases/acceptance-summary[?employeeId=...]
//
// Profile page: how much work allocated to this employee is still waiting
// for HIS Accept / Decline. "me" by default; a manager opening someone
// else's Profile sends ?employeeId= (the route's viewOtherEmployee check
// decides who may). Same filters as /my-acceptances, so the numbers match
// the popup the employee sees.
// ------------------------------------------------------------
async function getAcceptanceSummary(req, res) {
  try {
    const orgId = req.user.organizationId;
    const target = req.query.employeeId
      ? String(req.query.employeeId)
      : req.user.userId;
    const empty = { cases: 0, counts: 0, total: 0, since: null, byName: [] };

    const { data: caseRows, error: cErr } = await fetchAll(() =>
      supabase
        .from("service_cases")
        .select("id, allocated_at, allocated_by")
        .eq("organization_id", orgId)
        .eq("assigned_employee_id", target)
        .eq("allocation_status", "ALLOCATED")
        .eq("acceptance_status", "PENDING")
        .or(NOT_SUBMITTED)
        .order("id", { ascending: true }),
    );
    if (cErr) {
      if (isMissingColumn(cErr)) {
        warnMissingColumns();
        return res.json({ success: true, data: empty });
      }
      throw cErr;
    }

    const { data: allocRows, error: aErr } = await supabase
      .from("service_case_count_allocations")
      .select("quantity, allocated_at, allocated_by")
      .eq("organization_id", orgId)
      .eq("employee_id", target)
      .eq("acceptance_status", "PENDING")
      .or(NOTHING_DONE);
    if (aErr && !isMissingColumn(aErr)) throw aErr;

    const cases = caseRows || [];
    const allocs = (allocRows || []).filter((a) => (a.quantity || 0) > 0);
    const countUnits = allocs.reduce(
      (s, a) => s + (Number(a.quantity) || 0),
      0,
    );

    const stamps = [...cases, ...allocs]
      .map((r) => r.allocated_at)
      .filter(Boolean)
      .sort();
    const byIds = [
      ...new Set(
        [...cases, ...allocs].map((r) => r.allocated_by).filter(Boolean),
      ),
    ];
    const names = byIds.length ? await getEmployeeNameMap(byIds, orgId) : {};

    res.json({
      success: true,
      data: {
        cases: cases.length,
        counts: countUnits,
        total: cases.length + countUnits,
        since: stamps[0] || null,
        byName: byIds.map((id) => names[id]).filter(Boolean),
      },
    });
  } catch (err) {
    console.error("getAcceptanceSummary error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/my-acceptances/respond
// body: { decisions: [{ kind: "CASE"|"COUNT", id, action: "ACCEPT"|"DECLINE", reason?, reasonNote? }] }
// reasonNote is required when reason is "Other".
//
// Only ever touches work allocated to the logged-in user that is still
// waiting (acceptance_status = 'PENDING'); anything else is skipped.
//
// DECLINE puts the work back in the pool (a CASE becomes un-allocated again;
// a COUNT allocation is removed - or cut down to what was already added),
// saves the reason in allocation_decline_log and pings whoever allocated it.
// ------------------------------------------------------------
async function respondToAcceptances(req, res) {
  try {
    const orgId = req.user.organizationId;
    const me = req.user.userId;

    const raw = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    if (raw.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Nothing to accept or decline." });
    }
    if (raw.length > MAX_DECISIONS) {
      return res.status(400).json({
        success: false,
        message: `Please respond to at most ${MAX_DECISIONS} items at a time.`,
      });
    }

    const decisions = [];
    for (const d of raw) {
      const kind = String(d?.kind || "").toUpperCase();
      const action = String(d?.action || "").toUpperCase();
      const id = String(d?.id || "").trim();
      if (!["CASE", "COUNT"].includes(kind) || !id) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid item in the request." });
      }
      if (!["ACCEPT", "DECLINE"].includes(action)) {
        return res
          .status(400)
          .json({ success: false, message: "Choose Accept or Decline." });
      }
      let reason = null;
      if (action === "DECLINE") {
        const base = String(d?.reason || "").trim();
        if (!DECLINE_REASONS.includes(base)) {
          return res.status(400).json({
            success: false,
            message: "Select a reason from the list to decline.",
          });
        }
        if (base === "Other") {
          // "Other" needs the employee's own words (saved as "Other: <text>")
          const note = String(d?.reasonNote || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_REASON_NOTE);
          if (!note) {
            return res.status(400).json({
              success: false,
              message: 'Please write your reason when you choose "Other".',
            });
          }
          reason = `Other: ${note}`;
        } else {
          reason = base;
        }
      }
      decisions.push({ kind, id, action, reason });
    }

    const now = new Date().toISOString();
    let accepted = 0;
    let declined = 0;
    let skipped = 0;
    const logs = [];
    const declinedByAllocator = new Map(); // allocator id -> { n, reason }

    const [myNames] = await Promise.all([getEmployeeNameMap([me], orgId)]);
    const myName = myNames[me] || null;

    // ---------------- ACCEPT ----------------
    const acceptCaseIds = decisions
      .filter((d) => d.kind === "CASE" && d.action === "ACCEPT")
      .map((d) => d.id);
    if (acceptCaseIds.length) {
      const { data, error } = await supabase
        .from("service_cases")
        .update({ acceptance_status: "ACCEPTED", accepted_at: now })
        .eq("organization_id", orgId)
        .eq("assigned_employee_id", me)
        .eq("acceptance_status", "PENDING")
        .in("id", acceptCaseIds)
        .select("id");
      if (error) {
        if (isMissingColumn(error)) {
          warnMissingColumns();
          return res.status(503).json({
            success: false,
            message:
              "Accept / Decline is not set up yet. Please contact support.",
          });
        }
        throw error;
      }
      accepted += (data || []).length;
      skipped += acceptCaseIds.length - (data || []).length;
    }

    for (const d of decisions.filter(
      (x) => x.kind === "COUNT" && x.action === "ACCEPT",
    )) {
      const { data, error } = await supabase
        .from("service_case_count_allocations")
        .update({ acceptance_status: "ACCEPTED", accepted_at: now })
        .eq("organization_id", orgId)
        .eq("count_id", d.id)
        .eq("employee_id", me)
        .eq("acceptance_status", "PENDING")
        .select("count_id");
      if (error) throw error;
      if ((data || []).length) accepted++;
      else skipped++;
    }

    // ---------------- DECLINE ----------------
    const declineCases = decisions.filter(
      (d) => d.kind === "CASE" && d.action === "DECLINE",
    );
    const declineCounts = decisions.filter(
      (d) => d.kind === "COUNT" && d.action === "DECLINE",
    );

    const noteDecline = (allocatorId, reason) => {
      if (!allocatorId) return;
      const cur = declinedByAllocator.get(allocatorId) || {
        n: 0,
        reasons: new Set(),
      };
      cur.n++;
      cur.reasons.add(reason);
      declinedByAllocator.set(allocatorId, cur);
    };

    if (declineCases.length) {
      const { data: rows, error } = await supabase
        .from("service_cases")
        .select(
          "id, case_number, product_id, work_date, allocated_at, allocated_by",
        )
        .eq("organization_id", orgId)
        .eq("assigned_employee_id", me)
        .eq("acceptance_status", "PENDING")
        .in(
          "id",
          declineCases.map((d) => d.id),
        );
      if (error) throw error;
      const byId = Object.fromEntries(
        (rows || []).map((r) => [String(r.id), r]),
      );
      const productMap = await getProductNameMap(
        (rows || []).map((r) => r.product_id),
        orgId,
      );

      for (const d of declineCases) {
        const row = byId[d.id];
        if (!row) {
          skipped++;
          continue;
        }
        const { data: upd, error: uErr } = await supabase
          .from("service_cases")
          .update({
            assigned_employee_id: null,
            allocation_status: "PENDING",
            allocated_at: null,
            allocated_by: null,
            acceptance_status: "ACCEPTED", // back to the default for the next allocation
            accepted_at: null,
            acceptance_reminder_sent_at: null,
          })
          .eq("id", d.id)
          .eq("organization_id", orgId)
          .eq("assigned_employee_id", me)
          .eq("acceptance_status", "PENDING")
          .select("id");
        if (uErr) throw uErr;
        if (!(upd || []).length) {
          skipped++;
          continue;
        }
        declined++;
        noteDecline(row.allocated_by, d.reason);
        logs.push({
          organization_id: orgId,
          kind: "CASE",
          case_id: String(row.id),
          case_number: row.case_number,
          product_id: row.product_id ? String(row.product_id) : null,
          product_name: productMap[row.product_id] || null,
          work_date: row.work_date || null,
          quantity: 1,
          employee_id: me,
          employee_name: myName,
          allocated_by: row.allocated_by || null,
          allocated_at: row.allocated_at || null,
          reason: d.reason,
        });
      }
    }

    if (declineCounts.length) {
      const { data: rows, error } = await supabase
        .from("service_case_count_allocations")
        .select(
          "count_id, quantity, fulfilled_quantity, allocated_at, allocated_by",
        )
        .eq("organization_id", orgId)
        .eq("employee_id", me)
        .eq("acceptance_status", "PENDING")
        .in(
          "count_id",
          declineCounts.map((d) => d.id),
        );
      if (error) throw error;
      const byCount = Object.fromEntries(
        (rows || []).map((r) => [String(r.count_id), r]),
      );

      const { data: counts } = await supabase
        .from("service_case_counts")
        .select("id, product_id, work_date")
        .eq("organization_id", orgId)
        .in(
          "id",
          (rows || []).map((r) => r.count_id),
        );
      const countInfo = Object.fromEntries(
        (counts || []).map((c) => [String(c.id), c]),
      );
      const productMap = await getProductNameMap(
        (counts || []).map((c) => c.product_id),
        orgId,
      );

      for (const d of declineCounts) {
        const row = byCount[d.id];
        if (!row) {
          skipped++;
          continue;
        }
        const fulfilled = row.fulfilled_quantity || 0;
        // units that already got a case number stay with the employee
        let changed = 0;
        if (fulfilled > 0) {
          const { data: upd, error: uErr } = await supabase
            .from("service_case_count_allocations")
            .update({
              quantity: fulfilled,
              acceptance_status: "ACCEPTED",
              accepted_at: now,
              acceptance_reminder_sent_at: null,
            })
            .eq("organization_id", orgId)
            .eq("count_id", d.id)
            .eq("employee_id", me)
            .eq("acceptance_status", "PENDING")
            .select("count_id");
          if (uErr) throw uErr;
          changed = (upd || []).length;
        } else {
          const { data: del, error: dErr } = await supabase
            .from("service_case_count_allocations")
            .delete()
            .eq("organization_id", orgId)
            .eq("count_id", d.id)
            .eq("employee_id", me)
            .eq("acceptance_status", "PENDING")
            .select("count_id");
          if (dErr) throw dErr;
          changed = (del || []).length;
        }
        if (!changed) {
          skipped++;
          continue;
        }
        const returned = (row.quantity || 0) - fulfilled;
        declined++;
        noteDecline(row.allocated_by, d.reason);
        const info = countInfo[d.id] || {};
        logs.push({
          organization_id: orgId,
          kind: "COUNT",
          count_id: d.id,
          product_id: info.product_id ? String(info.product_id) : null,
          product_name: productMap[info.product_id] || null,
          work_date: info.work_date || null,
          quantity: returned,
          employee_id: me,
          employee_name: myName,
          allocated_by: row.allocated_by || null,
          allocated_at: row.allocated_at || null,
          reason: d.reason,
        });
      }
    }

    // who declined what, and why - a logging problem must not undo the decline
    if (logs.length) {
      const { error: logErr } = await supabase
        .from("allocation_decline_log")
        .insert(logs);
      if (logErr)
        console.error("[acceptance] decline log insert failed:", logErr);
    }

    // tell whoever allocated it (browser push, never throws)
    for (const [allocatorId, info] of declinedByAllocator) {
      await sendPushToUsers({
        organizationId: orgId,
        userIds: [allocatorId],
        title: "Allocation declined",
        body: `${myName || "An employee"} declined ${info.n} item${info.n > 1 ? "s" : ""}: ${[...info.reasons].join(", ")}`,
        url: "/",
      });
    }

    res.json({ success: true, data: { accepted, declined, skipped } });
  } catch (err) {
    console.error("respondToAcceptances error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// GET /api/service-cases/acceptance-status
//
// For the person who ALLOCATES: what became of the work I allocated TODAY,
// per employee - accepted / still waiting (and since when) / declined (and
// why). So there is no need to wait for the 2-hour mail to find out.
// Allocations I made to myself are not listed (nothing to accept).
// ------------------------------------------------------------
async function getAcceptanceStatus(req, res) {
  try {
    const orgId = req.user.organizationId;
    const me = req.user.userId;
    const since = startOfTodayISO(); // 00:00 today in APP_TIMEZONE

    const empty = { accepted: 0, waiting: 0, declined: 0 };

    const { data: caseRows, error: cErr } = await fetchAll(() =>
      supabase
        .from("service_cases")
        .select("assigned_employee_id, acceptance_status, allocated_at")
        .eq("organization_id", orgId)
        .eq("allocated_by", me)
        .eq("allocation_status", "ALLOCATED")
        .not("assigned_employee_id", "is", null)
        .gte("allocated_at", since)
        .order("id", { ascending: true }),
    );
    if (cErr) {
      if (isMissingColumn(cErr)) {
        warnMissingColumns();
        return res.json({
          success: true,
          data: { ready: false, rows: [], totals: empty },
        });
      }
      throw cErr;
    }

    const { data: countRows, error: ctErr } = await supabase
      .from("service_case_count_allocations")
      .select("employee_id, quantity, acceptance_status, allocated_at")
      .eq("organization_id", orgId)
      .eq("allocated_by", me)
      .gte("allocated_at", since);
    if (ctErr && !isMissingColumn(ctErr)) throw ctErr;

    // declined work leaves the lists, so the log is the only record of it
    const { data: declineRows, error: dErr } = await supabase
      .from("allocation_decline_log")
      .select("employee_id, employee_name, quantity, reason, declined_at")
      .eq("organization_id", orgId)
      .eq("allocated_by", me)
      .gte("declined_at", since);
    if (dErr)
      console.error("[acceptance] decline log read failed:", dErr.message);

    const byEmp = new Map();
    const row = (id) => {
      if (!byEmp.has(id)) {
        byEmp.set(id, {
          employeeId: id,
          name: null,
          accepted: 0,
          waiting: 0,
          declined: 0,
          waitingSince: null,
          declineReasons: [],
        });
      }
      return byEmp.get(id);
    };
    const markStatus = (id, status, units, allocatedAt) => {
      const r = row(id);
      if (status === "PENDING") {
        r.waiting += units;
        if (allocatedAt && (!r.waitingSince || allocatedAt < r.waitingSince)) {
          r.waitingSince = allocatedAt;
        }
      } else {
        r.accepted += units;
      }
    };

    (caseRows || []).forEach((c) => {
      if (String(c.assigned_employee_id) === String(me)) return;
      markStatus(
        c.assigned_employee_id,
        c.acceptance_status,
        1,
        c.allocated_at,
      );
    });
    (countRows || []).forEach((a) => {
      if (String(a.employee_id) === String(me)) return;
      markStatus(
        a.employee_id,
        a.acceptance_status,
        Number(a.quantity) || 0,
        a.allocated_at,
      );
    });
    (declineRows || []).forEach((d) => {
      if (String(d.employee_id) === String(me)) return;
      const r = row(d.employee_id);
      r.declined += Number(d.quantity) || 1;
      if (d.employee_name && !r.name) r.name = d.employee_name;
      if (d.reason && !r.declineReasons.includes(d.reason))
        r.declineReasons.push(d.reason);
    });

    const ids = [...byEmp.keys()];
    const names = ids.length ? await getEmployeeNameMap(ids, orgId) : {};
    const rows = ids
      .map((id) => ({
        ...byEmp.get(id),
        name: names[id] || byEmp.get(id).name || "Unknown",
      }))
      .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name));

    const totals = rows.reduce(
      (t, r) => ({
        accepted: t.accepted + r.accepted,
        waiting: t.waiting + r.waiting,
        declined: t.declined + r.declined,
      }),
      { ...empty },
    );

    res.json({ success: true, data: { ready: true, rows, totals } });
  } catch (err) {
    console.error("getAcceptanceStatus error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// 2-hour reminder
// ------------------------------------------------------------

// real mailbox of a login (same lookup notifyAllocation uses)
async function authEmailOf(authUserId) {
  if (!authUserId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

// "Reporting Manager" is stored as the manager's email (or, for manually
// added managers, whatever was typed). Prefer the manager's real login
// mailbox; fall back to the typed value if it looks like an email.
async function resolveManager(reportingManager, orgId) {
  const v = String(reportingManager || "").trim();
  if (!v) return { email: null, authId: null };
  if (v.includes("@")) {
    const { data } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("organization_id", orgId)
      .eq("Email", v.toLowerCase())
      .limit(1)
      .maybeSingle();
    const authId = data?.["Auth User Id"] || null;
    const real = authId ? await authEmailOf(authId) : null;
    return { email: real || v, authId };
  }
  return { email: null, authId: null };
}

// Label for one line: the service name (+ client when there is one). If the
// name can not be found we show the client, and only then a neutral "Other"
// (never the bare word "Service").
function itemLabel(productId, clientId, productMap, clientMap) {
  return (
    [productMap[productId], clientMap[clientId]]
      .filter(Boolean)
      .map(esc)
      .join(" · ") || "Other"
  );
}

// Lines look like "Data Export · Client — 10 cases" (name + how many cases).
function itemLines(cases, counts, productMap, clientMap) {
  const lines = [];
  const grouped = new Map();
  cases.forEach((c) => {
    const key = `${c.product_id}|${c.client_id || ""}`;
    const g = grouped.get(key) || { c, n: 0 };
    g.n += 1;
    grouped.set(key, g);
  });
  for (const { c, n } of grouped.values()) {
    lines.push(
      `${itemLabel(c.product_id, c.client_id, productMap, clientMap)} — ${n} case${n > 1 ? "s" : ""}`,
    );
  }
  counts.forEach((a) => {
    const q = Number(a.quantity) || 0;
    lines.push(
      `${itemLabel(a.product_id, a.client_id, productMap, clientMap)} — ${q} case${q > 1 ? "s" : ""}`,
    );
  });
  return lines;
}

// ---- Email-safe "waiting" cards (tables + inline styles only) ------------
// itemLines() gives strings like "Data Export · Client — 10 cases". Show each
// as a bold name with the count in orange.
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

function itemRow(line) {
  const m = String(line).match(/^(.*) — (\d+ cases?)(.*)$/);
  if (!m) {
    return `<div style="margin:0 0 8px;color:#1e2a4a;font-size:14px;font-weight:600;line-height:1.5;">${line}</div>`;
  }
  const detail = m[3].replace(/^:\s*/, "").trim();
  return `<div style="margin:0 0 10px;"><div style="color:#1e2a4a;font-size:14px;font-weight:700;line-height:1.5;">${m[1]} <span style="color:#C2410C;font-weight:800;">&middot; ${m[2]}</span></div>${
    detail
      ? `<div style="color:#8b8f9c;font-size:12.5px;line-height:1.5;">${detail}</div>`
      : ""
  }</div>`;
}

const CARD_OPEN = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;background:#FFFAF0;border:1px solid #F8DFB0;border-radius:14px;text-align:left;font-family:${FONT};"><tr><td style="padding:16px 18px 8px;">`;
const CARD_CLOSE = "</td></tr></table>";

// Employee mail: just how many cases are waiting.
function detailBlock(total) {
  return `${CARD_OPEN}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td style="color:#1e2a4a;font-size:15px;font-weight:800;">Waiting for your response</td><td align="right" style="color:#C2410C;font-size:13px;font-weight:800;white-space:nowrap;">${total} case${total > 1 ? "s" : ""}</td></tr></table>${CARD_CLOSE}`;
}

// ONE block for a manager: every team member who has not answered, with just
// their name and how many cases are waiting.
function managerDetailBlock(entries) {
  const MAX_PEOPLE = 40;
  const shown = entries.slice(0, MAX_PEOPLE);
  const more = entries.length - shown.length;
  const people = shown
    .map(
      (e, i) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${i === shown.length - 1 ? 8 : 0}px;"><tr><td style="padding:9px 0;${i ? "border-top:1px solid #F8DFB0;" : ""}color:#1e2a4a;font-size:15px;font-weight:800;">${esc(e.name)}</td><td align="right" style="padding:9px 0;${i ? "border-top:1px solid #F8DFB0;" : ""}color:#C2410C;font-size:13px;font-weight:800;white-space:nowrap;">${e.total} case${e.total > 1 ? "s" : ""}</td></tr></table>`,
    )
    .join("");
  return `${CARD_OPEN}${people}${
    more > 0
      ? `<div style="margin:0 0 10px;color:#C2410C;font-size:13px;font-weight:700;">+ ${more} more</div>`
      : ""
  }${CARD_CLOSE}`;
}

// A mail link that opens on EVERY device. "localhost" means "this phone itself"
// on iOS / Android, so a localhost link can never open (Safari: "can't open
// the page / localhost"). Reminders are only sent when the app link is a real
// public https address.
function isUsableAppLink(url) {
  if (!/^https:\/\//i.test(url || "")) return false;
  if (url.includes(",")) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host))
      return false;
    if (host.endsWith(".local") || host.endsWith(".localhost")) return false;
    return true;
  } catch {
    return false;
  }
}

let reminderRunning = false;
let warnedBadLink = false;

async function runAcceptanceReminders() {
  if (reminderRunning) return; // the previous tick is still mailing
  // Never mail a link that will not open (e.g. a local dev server whose
  // FRONTEND_URL is http://localhost:5173). Checked BEFORE claiming anything,
  // so the allocations stay waiting for a server that has the real link.
  if (
    !isUsableAppLink(APP_LOGIN_URL) &&
    process.env.ACCEPT_REMINDER_ALLOW_LOCAL !== "true"
  ) {
    if (!warnedBadLink) {
      warnedBadLink = true;
      console.warn(
        `[acceptance] reminders are OFF on this server: the app link "${APP_LOGIN_URL}" is not a public https address. Set FRONTEND_URL to the live site (e.g. https://your-app.vercel.app). For local testing only: ACCEPT_REMINDER_ALLOW_LOCAL=true.`,
      );
    }
    return;
  }
  reminderRunning = true;
  try {
    const nowMs = Date.now();
    const cutoff = new Date(
      nowMs - REMINDER_AFTER_HOURS * 3600 * 1000,
    ).toISOString();
    const oldest = new Date(
      nowMs - REMINDER_MAX_AGE_HOURS * 3600 * 1000,
    ).toISOString();
    const claimedAt = new Date(nowMs).toISOString();

    // CLAIM first (one atomic UPDATE ... RETURNING): whoever claims a row is the
    // only one that mails it, so a restart or a second server never double-mails.
    const { data: caseRows, error: cErr } = await supabase
      .from("service_cases")
      .update({ acceptance_reminder_sent_at: claimedAt })
      .eq("acceptance_status", "PENDING")
      .eq("allocation_status", "ALLOCATED")
      .is("acceptance_reminder_sent_at", null)
      .not("assigned_employee_id", "is", null)
      .lte("allocated_at", cutoff)
      .gte("allocated_at", oldest)
      .or(NOT_SUBMITTED)
      .select(
        "id, organization_id, assigned_employee_id, case_number, product_id, client_id",
      );
    if (cErr) {
      if (isMissingColumn(cErr)) return warnMissingColumns();
      throw cErr;
    }

    const { data: countRows, error: ctErr } = await supabase
      .from("service_case_count_allocations")
      .update({ acceptance_reminder_sent_at: claimedAt })
      .eq("acceptance_status", "PENDING")
      .is("acceptance_reminder_sent_at", null)
      .lte("allocated_at", cutoff)
      .gte("allocated_at", oldest)
      .or(NOTHING_DONE)
      .select("count_id, organization_id, employee_id, quantity");
    if (ctErr && !isMissingColumn(ctErr)) throw ctErr;

    const cases = caseRows || [];
    const allocs = countRows || [];
    if (!cases.length && !allocs.length) return;

    // count -> product / client
    const countInfo = {};
    if (allocs.length) {
      const { data: cts } = await supabase
        .from("service_case_counts")
        .select("id, product_id, client_id")
        .in(
          "id",
          allocs.map((a) => a.count_id),
        );
      (cts || []).forEach((c) => (countInfo[String(c.id)] = c));
    }
    const allocsFull = allocs.map((a) => ({
      ...a,
      product_id: countInfo[String(a.count_id)]?.product_id,
      client_id: countInfo[String(a.count_id)]?.client_id,
    }));

    // group per (organization, employee)
    const groups = new Map();
    const bucket = (org, emp) => {
      const k = `${org}|${emp}`;
      if (!groups.has(k)) groups.set(k, { org, emp, cases: [], counts: [] });
      return groups.get(k);
    };
    cases.forEach((c) =>
      bucket(c.organization_id, c.assigned_employee_id).cases.push(c),
    );
    allocsFull.forEach((a) =>
      bucket(a.organization_id, a.employee_id).counts.push(a),
    );

    const releaseClaim = async (g) => {
      // mail failed completely -> let the next run try again
      if (g.cases.length) {
        await supabase
          .from("service_cases")
          .update({ acceptance_reminder_sent_at: null })
          .in(
            "id",
            g.cases.map((c) => c.id),
          )
          .eq("acceptance_reminder_sent_at", claimedAt);
      }
      for (const a of g.counts) {
        await supabase
          .from("service_case_count_allocations")
          .update({ acceptance_reminder_sent_at: null })
          .eq("count_id", a.count_id)
          .eq("employee_id", g.emp)
          .eq("acceptance_reminder_sent_at", claimedAt);
      }
    };

    // names per organization (the helpers are organization scoped)
    const orgIds = [...new Set([...groups.values()].map((g) => g.org))];
    const nameMaps = {};
    for (const org of orgIds) {
      const gs = [...groups.values()].filter((g) => g.org === org);
      const prod = gs.flatMap((g) =>
        [...g.cases, ...g.counts].map((x) => x.product_id),
      );
      const cli = gs.flatMap((g) =>
        [...g.cases, ...g.counts].map((x) => x.client_id),
      );
      const [productMap, clientMap] = await Promise.all([
        getProductNameMap(prod, org),
        getClientNameMap(cli, org),
      ]);
      const { data: people } = await supabase
        .from("user_master")
        .select(
          '"Auth User Id", "First Name", "Last Name", "Reporting Manager"',
        )
        .eq("organization_id", org)
        .in(
          "Auth User Id",
          gs.map((g) => g.emp),
        );
      nameMaps[org] = {
        productMap,
        clientMap,
        people: Object.fromEntries(
          (people || []).map((p) => [p["Auth User Id"], p]),
        ),
      };
    }

    const waited = `${REMINDER_AFTER_HOURS} hour${REMINDER_AFTER_HOURS > 1 ? "s" : ""}`;
    const byManager = new Map(); // `${org}|${manager email}` -> { manager, entries[] }

    // ---- 1) each employee gets THEIR OWN reminder ----
    for (const g of groups.values()) {
      g.attempted = false;
      g.ok = false;
      try {
        const { productMap, clientMap, people } = nameMaps[g.org];
        const person = people[g.emp] || {};
        const name =
          `${person["First Name"] || ""} ${person["Last Name"] || ""}`.trim() ||
          "An employee";
        const total =
          g.cases.length +
          g.counts.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
        const lines = itemLines(g.cases, g.counts, productMap, clientMap);

        const [empEmail, manager] = await Promise.all([
          authEmailOf(g.emp),
          resolveManager(person["Reporting Manager"], g.org),
        ]);

        if (empEmail) {
          g.attempted = true;
          try {
            await sendEmail({
              to: empEmail,
              subject: "Reminder: you haven't accepted your allocation",
              text: `${total} item(s) allocated to you more than ${waited} ago are still waiting. Please login and accept or decline them. ${APP_LOGIN_URL}`,
              html: buildAllocationEmailHtml({
                icon: "&#9203;",
                heading: "Allocation Not Accepted",
                headline: "You haven't accepted your allocation yet.",
                subtext: `${total} item${total > 1 ? "s" : ""} allocated to you more than ${waited} ago ${total > 1 ? "are" : "is"} still waiting. Please login and accept or decline ${total > 1 ? "them" : "it"}.`,
                headSolid: "#EA6C0A",
                headGradient:
                  "linear-gradient(135deg,#FBBF24 0%,#F97316 55%,#EA580C 100%)",
                detailHtml: detailBlock(total),
              }),
            });
            g.ok = true;
          } catch (e) {
            console.error(
              "[acceptance] employee reminder failed:",
              e?.message || e,
            );
          }
        } else {
          console.warn(
            `[acceptance] no email for employee ${g.emp} — reminder skipped`,
          );
        }

        // the manager gets ONE mail for the whole team (phase 2)
        if (
          manager.email &&
          manager.email.toLowerCase() !== String(empEmail || "").toLowerCase()
        ) {
          const key = `${g.org}|${manager.email.toLowerCase()}`;
          const m = byManager.get(key) || { org: g.org, manager, entries: [] };
          m.entries.push({ g, name, total, lines });
          byManager.set(key, m);
        } else if (!manager.email) {
          console.warn(
            `[acceptance] no reporting manager email for ${g.emp} — manager mail skipped`,
          );
        }

        // browser push to the employee (never throws)
        await sendPushToUsers({
          organizationId: g.org,
          userIds: [g.emp],
          title: "Allocation not accepted yet",
          body: `You have ${total} allocated item${total > 1 ? "s" : ""} waiting for your response.`,
          url: "/",
        });
      } catch (e) {
        console.error("[acceptance] reminder group failed:", e?.message || e);
        await releaseClaim(g).catch(() => {});
        g.attempted = false;
        g.ok = true; // already released - do not release twice
      }
    }

    // ---- 2) each manager gets ONE mail listing everybody who has not answered ----
    for (const m of byManager.values()) {
      const n = m.entries.length;
      const items = m.entries.reduce((x, e) => x + e.total, 0);
      const first = m.entries[0].name;
      m.entries.forEach((e) => (e.g.attempted = true));
      try {
        await sendEmail({
          to: m.manager.email,
          subject:
            n === 1
              ? `${first} hasn't accepted their allocation`
              : `${n} team members haven't accepted their allocation`,
          text: `${n} team member${n > 1 ? "s have" : " has"} not accepted ${items} allocated item(s) after ${waited}: ${m.entries
            .map((e) => `${e.name} (${e.total})`)
            .join(", ")}. ${APP_LOGIN_URL}`,
          html: buildAllocationEmailHtml({
            icon: "&#9203;",
            heading: "Allocation Not Accepted",
            headline:
              n === 1
                ? `${esc(first)} hasn't accepted the allocation yet.`
                : `${n} team members haven't accepted their allocation yet.`,
            subtext: `${items} item${items > 1 ? "s" : ""} allocated more than ${waited} ago ${items > 1 ? "are" : "is"} still waiting for a response.`,
            headSolid: "#EA6C0A",
            headGradient:
              "linear-gradient(135deg,#FBBF24 0%,#F97316 55%,#EA580C 100%)",
            detailHtml: managerDetailBlock(m.entries),
          }),
        });
        m.entries.forEach((e) => (e.g.ok = true));
        await sendPushToUsers({
          organizationId: m.org,
          userIds: [m.manager.authId].filter(Boolean),
          title: "Allocation not accepted yet",
          body: `${n} team member${n > 1 ? "s have" : " has"} not accepted their allocation.`,
          url: "/",
        });
      } catch (e) {
        console.error("[acceptance] manager reminder failed:", e?.message || e);
      }
    }

    // anything we tried to mail where NO mail went out is released, so the
    // next run tries again (a row nobody could be mailed about stays claimed)
    for (const g of groups.values()) {
      if (g.attempted && !g.ok) await releaseClaim(g).catch(() => {});
    }
  } finally {
    reminderRunning = false;
  }
}

module.exports = {
  DECLINE_REASONS,
  listMyPendingAcceptances,
  respondToAcceptances,
  getAcceptanceStatus,
  getAcceptanceSummary,
  runAcceptanceReminders,
};
