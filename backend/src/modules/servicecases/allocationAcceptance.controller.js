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

function itemLines(cases, counts, productMap, clientMap) {
  const lines = [];
  const grouped = new Map();
  cases.forEach((c) => {
    const key = `${c.product_id}|${c.client_id || ""}`;
    const g = grouped.get(key) || { c, numbers: [] };
    g.numbers.push(c.case_number);
    grouped.set(key, g);
  });
  for (const { c, numbers } of grouped.values()) {
    const shown = numbers.slice(0, 8).map(esc).join(", ");
    const extra = numbers.length > 8 ? ` +${numbers.length - 8} more` : "";
    lines.push(
      `${esc(productMap[c.product_id] || "Service")}${
        clientMap[c.client_id] ? ` · ${esc(clientMap[c.client_id])}` : ""
      } — ${numbers.length} case${numbers.length > 1 ? "s" : ""}: ${shown}${extra}`,
    );
  }
  counts.forEach((a) => {
    lines.push(
      `${esc(productMap[a.product_id] || "Service")}${
        clientMap[a.client_id] ? ` · ${esc(clientMap[a.client_id])}` : ""
      } — ${a.quantity} case${a.quantity > 1 ? "s" : ""} (case numbers not added yet)`,
    );
  });
  return lines;
}

function detailBlock(lines) {
  return `<div style="margin:0 0 26px;padding:12px 14px;background:#FFF7E6;border:1px solid #F5D58A;border-radius:12px;color:#7A4B00;font-size:14px;font-weight:600;line-height:1.7;text-align:left;">${lines
    .map((l) => `<div>• ${l}</div>`)
    .join("")}</div>`;
}

let reminderRunning = false;

async function runAcceptanceReminders() {
  if (reminderRunning) return; // the previous tick is still mailing
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

    for (const g of groups.values()) {
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
        const detailHtml = detailBlock(lines);
        const waited = `${REMINDER_AFTER_HOURS} hour${REMINDER_AFTER_HOURS > 1 ? "s" : ""}`;

        const [empEmail, manager] = await Promise.all([
          authEmailOf(g.emp),
          resolveManager(person["Reporting Manager"], g.org),
        ]);

        const jobs = [];
        if (empEmail) {
          jobs.push(
            sendEmail({
              to: empEmail,
              subject: "Reminder: you haven't accepted your allocation",
              text: `${total} item(s) allocated to you more than ${waited} ago are still waiting. Please login and accept or decline them. ${APP_LOGIN_URL}`,
              html: buildAllocationEmailHtml({
                icon: "&#9203;",
                heading: "Allocation Not Accepted",
                headline: "You haven't accepted your allocation yet.",
                subtext: `${total} item${total > 1 ? "s" : ""} allocated to you more than ${waited} ago ${total > 1 ? "are" : "is"} still waiting. Please login and accept or decline ${total > 1 ? "them" : "it"}.`,
                headSolid: "#D97706",
                headGradient: "linear-gradient(135deg,#F59E0B,#D97706)",
                detailHtml,
              }),
            }),
          );
        } else {
          console.warn(
            `[acceptance] no email for employee ${g.emp} — reminder skipped`,
          );
        }
        if (
          manager.email &&
          manager.email.toLowerCase() !== String(empEmail || "").toLowerCase()
        ) {
          jobs.push(
            sendEmail({
              to: manager.email,
              subject: `${name} hasn't accepted their allocation`,
              text: `${name} has not accepted ${total} allocated item(s) after ${waited}. ${APP_LOGIN_URL}`,
              html: buildAllocationEmailHtml({
                icon: "&#9203;",
                heading: "Allocation Not Accepted",
                headline: `${esc(name)} hasn't accepted the allocation yet.`,
                subtext: `${total} item${total > 1 ? "s" : ""} allocated to ${esc(name)} more than ${waited} ago ${total > 1 ? "are" : "is"} still waiting for a response.`,
                headSolid: "#D97706",
                headGradient: "linear-gradient(135deg,#F59E0B,#D97706)",
                detailHtml,
              }),
            }),
          );
        } else if (!manager.email) {
          console.warn(
            `[acceptance] no reporting manager email for ${g.emp} — manager mail skipped`,
          );
        }

        if (jobs.length) {
          const results = await Promise.allSettled(jobs);
          const ok = results.filter((r) => r.status === "fulfilled").length;
          results
            .filter((r) => r.status === "rejected")
            .forEach((r) =>
              console.error(
                "[acceptance] reminder mail failed:",
                r.reason?.message || r.reason,
              ),
            );
          if (ok === 0) await releaseClaim(g);
        }

        // browser push too (never throws)
        await sendPushToUsers({
          organizationId: g.org,
          userIds: [g.emp, manager.authId].filter(Boolean),
          title: "Allocation not accepted yet",
          body: `${name} has ${total} allocated item${total > 1 ? "s" : ""} waiting for a response.`,
          url: "/",
        });
      } catch (e) {
        console.error("[acceptance] reminder group failed:", e?.message || e);
        await releaseClaim(g).catch(() => {});
      }
    }
  } finally {
    reminderRunning = false;
  }
}

module.exports = {
  DECLINE_REASONS,
  listMyPendingAcceptances,
  respondToAcceptances,
  runAcceptanceReminders,
};
