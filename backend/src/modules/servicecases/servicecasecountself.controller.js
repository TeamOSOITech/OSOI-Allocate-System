// src/modules/servicecases/servicecasecountself.controller.js
//
// Employee-side (Profile page) endpoints for COUNT-ONLY entries
// (service_case_counts — "20 cases pending", no case numbers yet):
//
//   GET   /api/service-cases/my-counts
//         -> { mine: counts allocated to ME that still need case numbers,
//              available: counts with units nobody has taken yet }
//   POST  /api/service-cases/my-counts/self-allocate
//         -> take some units of a count for myself
//   POST  /api/service-cases/my-counts/add-case-numbers
//         -> type the real case numbers for units allocated to me; real
//            service_cases rows are created (assigned to me) and the
//            fulfilled counters are bumped. Each case number can also
//            carry a status: "WIP" (just add, stays pending) or a real
//            submission type (added AND submitted right away).
//   PATCH /api/service-cases/:id/client-fill
//         -> employee can ONLY fill an EMPTY client / subclient on their
//            own case. Changing one that's already set stays manager-only
//            (PATCH /:id/client, behind allocPerm).
//
// Everything is scoped to req.user.organizationId, and "me" is always
// req.user.userId — never taken from the request body.
//
// MODIFIED: my-counts now also returns `allocatedAt` (when the units were
// allocated to the caller) so the Profile page can show allocation time.

const supabase = require("../../config/supabaseClient");
const {
  getProductNameMap,
  getClientNameMap,
  getSubclientNameMap,
} = require("./servicecases.controller");
// NEW: a client can only be used on a service it is mapped to.
const { assertClientMappedToProduct } = require("./serviceClients");

const orgIdOf = (req) => req.user.organizationId;
const userIdOf = (req) => req.user.userId;

// Max case numbers typed in one go (frontend caps lower; this is a safety net).
const MAX_CASE_NUMBERS_AT_ONCE = 200;

// Same outcomes as servicecases.controller.js. "WIP" is NOT stored — it
// simply means "add the case, don't submit it yet".
const SUBMISSION_TYPES = [
  "COMPLETED",
  "DONE_BY_TEAM",
  "DONE_BY_CLIENT",
  "QUERY",
];

const strId = (v) =>
  v === null || v === undefined || v === "" ? null : String(v);

function validYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null;
}

// ---- same escaping rules as servicecases.controller.js ----
function escapeLikeWildcards(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
function escapeOrFilterValue(value) {
  if (/[,()"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Case-insensitive, organization-wide duplicate check (case numbers are
// unique per organization).
async function findExistingCaseNumbersCI(caseNumbers, organizationId) {
  const found = new Set();
  const results = await Promise.all(
    chunkArray(caseNumbers, 150).map(async (chunk) => {
      const orExpr = chunk
        .map(
          (cn) =>
            `case_number.ilike.${escapeOrFilterValue(escapeLikeWildcards(cn))}`,
        )
        .join(",");
      const { data, error } = await supabase
        .from("service_cases")
        .select("case_number")
        .eq("organization_id", organizationId)
        .or(orExpr);
      if (error) throw error;
      return data || [];
    }),
  );
  results.flat().forEach((r) => found.add(r.case_number.toUpperCase()));
  return found;
}

// Client exists in this org?
async function clientExists(clientId, organizationId) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Subclient exists in this org and belongs to `clientId`?
async function validateSubclient(subclientId, organizationId, clientId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("id, client_id")
    .eq("id", subclientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, message: "Subclient not found" };
  if (clientId && String(data.client_id) !== String(clientId)) {
    return {
      ok: false,
      message: "Subclient does not belong to the selected client",
    };
  }
  return { ok: true };
}

// All still-open counts (fulfilled < quantity) up to `workDate` (backlog
// included — same rule as the manager's Today's Allocation page) plus
// every allocation row on them.
async function loadOpenCountsWithAllocations(orgId, workDate) {
  const { data, error } = await supabase
    .from("service_case_counts")
    .select("*")
    .eq("organization_id", orgId)
    .lte("work_date", workDate)
    .order("work_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw error;

  const open = (data || []).filter(
    (c) => (c.fulfilled_count || 0) < c.quantity,
  );
  let allocs = [];
  const ids = open.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: a, error: aErr } = await supabase
      .from("service_case_count_allocations")
      // MODIFIED: allocated_at added so the Profile page can show the time.
      .select(
        "count_id, employee_id, quantity, fulfilled_quantity, allocated_at",
      )
      .eq("organization_id", orgId)
      .in("count_id", ids.slice(i, i + 150));
    if (aErr) throw aErr;
    allocs = allocs.concat(a || []);
  }
  return { open, allocs };
}

// ------------------------------------------------------------
// GET /api/service-cases/my-counts?workDate=YYYY-MM-DD&productId=
// `productId` only narrows `available` (the self-allocate picker);
// `mine` is always everything allocated to the caller.
// ------------------------------------------------------------
async function listMyCounts(req, res) {
  try {
    const orgId = orgIdOf(req);
    const me = userIdOf(req);
    const workDate =
      validYmd(req.query.workDate) || new Date().toISOString().slice(0, 10);
    const productId = req.query.productId ? String(req.query.productId) : null;

    const { open, allocs } = await loadOpenCountsWithAllocations(
      orgId,
      workDate,
    );

    const [productMap, clientMap, subclientMap] = await Promise.all([
      getProductNameMap(
        open.map((c) => c.product_id),
        orgId,
      ),
      getClientNameMap(
        open.map((c) => c.client_id),
        orgId,
      ),
      getSubclientNameMap(
        open.map((c) => c.subclient_id),
        orgId,
      ),
    ]);

    const base = (c) => ({
      id: c.id,
      productId: String(c.product_id),
      productName: productMap[c.product_id] || null,
      clientId: strId(c.client_id),
      clientName: clientMap[c.client_id] || null,
      subclientId: strId(c.subclient_id),
      subclientName: subclientMap[c.subclient_id] || null,
      workDate: c.work_date,
      quantity: c.quantity,
    });

    const mine = [];
    const available = [];
    open.forEach((c) => {
      const forCount = allocs.filter((a) => a.count_id === c.id);
      const myAlloc = forCount.find((a) => a.employee_id === me);
      const allocatedTotal = forCount.reduce((s, a) => s + a.quantity, 0);
      const unallocated = c.quantity - allocatedTotal;

      if (myAlloc) {
        const added = myAlloc.fulfilled_quantity || 0;
        const remaining = myAlloc.quantity - added;
        if (remaining > 0) {
          mine.push({
            ...base(c),
            allocatedToMe: myAlloc.quantity,
            addedByMe: added,
            remaining,
            // NEW: when these units were allocated to the caller
            allocatedAt: myAlloc.allocated_at || null,
          });
        }
      }
      if (
        unallocated > 0 &&
        (!productId || String(c.product_id) === productId)
      ) {
        available.push({
          ...base(c),
          unallocated,
          allocatedToMe: myAlloc ? myAlloc.quantity : 0,
        });
      }
    });

    res.json({ success: true, data: { mine, available } });
  } catch (err) {
    console.error("listMyCounts error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/my-counts/self-allocate
// body: { items: [{ countId, quantity }] }
//
// Takes `quantity` still-unallocated units of each count for the caller
// (added on top of anything they already hold). A request bigger than
// what is left is trimmed to what is left; a count with nothing left is
// skipped — units someone else grabbed a moment earlier are never stolen.
// ------------------------------------------------------------
async function selfAllocateCounts(req, res) {
  try {
    const orgId = orgIdOf(req);
    const me = userIdOf(req);

    const wanted = new Map();
    (Array.isArray(req.body?.items) ? req.body.items : []).forEach((i) => {
      const countId = (i?.countId || "").toString();
      const quantity = Number(i?.quantity);
      if (countId && Number.isInteger(quantity) && quantity > 0) {
        wanted.set(countId, (wanted.get(countId) || 0) + quantity);
      }
    });
    if (wanted.size === 0) {
      return res.status(400).json({
        success: false,
        message: "Enter how many cases you want to take.",
      });
    }

    const table = () => supabase.from("service_case_count_allocations");
    const now = new Date().toISOString();
    let allocatedCount = 0;
    const done = [];

    // One count at a time so the same request can't race with itself.
    for (const [countId, qty] of wanted) {
      const { data: count, error: cErr } = await supabase
        .from("service_case_counts")
        .select("id, quantity")
        .eq("id", countId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!count) continue;

      const { data: allocs, error: aErr } = await table()
        .select("employee_id, quantity")
        .eq("organization_id", orgId)
        .eq("count_id", countId);
      if (aErr) throw aErr;

      const total = (allocs || []).reduce((s, a) => s + a.quantity, 0);
      const mineBefore =
        (allocs || []).find((a) => a.employee_id === me)?.quantity || 0;
      const take = Math.min(qty, count.quantity - total);
      if (take <= 0) continue;

      const { error: uErr } = await table().upsert(
        {
          organization_id: orgId,
          count_id: countId,
          employee_id: me,
          quantity: mineBefore + take,
          allocated_by: me,
          allocated_at: now,
        },
        { onConflict: "count_id,employee_id" },
      );
      if (uErr) throw uErr;

      // Two people taking at the same instant could overshoot — re-check
      // and roll back our own part if so.
      const { data: after, error: rErr } = await table()
        .select("quantity")
        .eq("organization_id", orgId)
        .eq("count_id", countId);
      if (rErr) throw rErr;
      const totalAfter = (after || []).reduce((s, a) => s + a.quantity, 0);
      if (totalAfter > count.quantity) {
        if (mineBefore > 0) {
          await table()
            .update({ quantity: mineBefore })
            .eq("organization_id", orgId)
            .eq("count_id", countId)
            .eq("employee_id", me);
        } else {
          await table()
            .delete()
            .eq("organization_id", orgId)
            .eq("count_id", countId)
            .eq("employee_id", me);
        }
        continue;
      }

      allocatedCount += take;
      done.push({ countId, quantity: take });
    }

    if (allocatedCount === 0) {
      return res.status(409).json({
        success: false,
        message:
          "Those case(s) are no longer available — someone else may have already taken them.",
      });
    }

    res.status(201).json({
      success: true,
      message: `You've allocated ${allocatedCount} case(s) to yourself.`,
      data: { allocatedCount, items: done },
    });
  } catch (err) {
    console.error("selfAllocateCounts error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/my-counts/add-case-numbers
// body: {
//   countId,
//   caseNumbers: string[],
//   statuses?: { [UPPERCASED_CASE_NUMBER]: { submissionType, queryText? } },
//   clientId?, subclientId?
// }
//
// For units of a count that are allocated to the caller: creates one
// real service_cases row per typed case number, already allocated to
// the caller, and bumps service_case_counts.fulfilled_count + the
// caller's fulfilled_quantity.
//
// Status per case number:
//   "WIP" (or missing)  -> case is just added, stays PENDING for submit later
//   COMPLETED / DONE_BY_TEAM / DONE_BY_CLIENT / QUERY
//                       -> case is added AND submitted right away
//                          (QUERY needs queryText)
//
// Client / Subclient: if the count already has one it is used as-is
// (employee can't change it); only a MISSING one is taken from the body.
// A client taken from the body must be mapped to the count's service.
// Case numbers that already exist in the organization (or repeat in the
// request) are skipped and reported back.
// ------------------------------------------------------------
async function addCaseNumbersToCount(req, res) {
  try {
    const orgId = orgIdOf(req);
    const me = userIdOf(req);
    const countId = (req.body?.countId || "").toString();
    const rawCaseNumbers = Array.isArray(req.body?.caseNumbers)
      ? req.body.caseNumbers
      : [];

    if (!countId) {
      return res
        .status(400)
        .json({ success: false, message: "countId is required" });
    }

    // clean + dedupe (case-insensitive; original casing is what's stored)
    const seen = new Set();
    const candidates = [];
    const results = [];
    rawCaseNumbers.forEach((raw) => {
      const caseNumber = (raw || "").toString().trim();
      if (!caseNumber) return;
      if (caseNumber.length > 50) {
        results.push({
          caseNumber,
          status: "skipped",
          reason: "too_long",
          message: "Longer than 50 characters",
        });
        return;
      }
      const key = caseNumber.toUpperCase();
      if (seen.has(key)) {
        results.push({
          caseNumber,
          status: "skipped",
          reason: "duplicate_in_request",
          message: "Typed more than once",
        });
        return;
      }
      seen.add(key);
      candidates.push(caseNumber);
    });
    if (candidates.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Enter at least one case number." });
    }
    if (candidates.length > MAX_CASE_NUMBERS_AT_ONCE) {
      return res.status(400).json({
        success: false,
        message: `You can add up to ${MAX_CASE_NUMBERS_AT_ONCE} case numbers at once.`,
      });
    }

    // ---- per-case status (WIP / submit) ----
    const statuses =
      req.body?.statuses && typeof req.body.statuses === "object"
        ? req.body.statuses
        : {};
    const statusFor = (cn) => {
      const s = statuses[cn.toUpperCase()] || {};
      const type = (s.submissionType || "WIP").toString().trim();
      const queryText = (s.queryText || "").toString().trim();
      return { type, queryText };
    };
    for (const cn of candidates) {
      const { type, queryText } = statusFor(cn);
      if (type !== "WIP" && !SUBMISSION_TYPES.includes(type)) {
        return res
          .status(400)
          .json({ success: false, message: `Invalid status for ${cn}.` });
      }
      if (type === "QUERY" && !queryText) {
        return res.status(400).json({
          success: false,
          message: `Query text is required for ${cn}.`,
        });
      }
    }

    const { data: count, error: cErr } = await supabase
      .from("service_case_counts")
      .select("*")
      .eq("id", countId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!count) {
      return res
        .status(404)
        .json({ success: false, message: "Count entry not found" });
    }

    const { data: myAlloc, error: aErr } = await supabase
      .from("service_case_count_allocations")
      .select("quantity, fulfilled_quantity")
      .eq("organization_id", orgId)
      .eq("count_id", countId)
      .eq("employee_id", me)
      .maybeSingle();
    if (aErr) throw aErr;

    const remaining = myAlloc
      ? myAlloc.quantity - (myAlloc.fulfilled_quantity || 0)
      : 0;
    if (remaining <= 0) {
      return res.status(403).json({
        success: false,
        message: "No cases from this count are waiting on you.",
      });
    }
    if (candidates.length > remaining) {
      return res.status(400).json({
        success: false,
        message: `Only ${remaining} case(s) are allocated to you here — you entered ${candidates.length}.`,
      });
    }

    // ---- client / subclient: keep what the count has, fill what's missing ----
    let clientId = strId(count.client_id);
    let subclientId = strId(count.subclient_id);
    const bodyClientId = strId(req.body?.clientId);
    const bodySubclientId = strId(req.body?.subclientId);

    if (!clientId && bodyClientId) {
      if (!(await clientExists(bodyClientId, orgId))) {
        return res
          .status(404)
          .json({ success: false, message: "Client not found" });
      }
      // NEW: the client must be mapped to this count's service.
      const mapCheck = await assertClientMappedToProduct(
        bodyClientId,
        count.product_id,
        orgId,
      );
      if (!mapCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: mapCheck.message });
      }
      clientId = bodyClientId;
    }
    if (!subclientId && bodySubclientId) {
      if (!clientId) {
        return res
          .status(400)
          .json({ success: false, message: "Pick a client first." });
      }
      const check = await validateSubclient(bodySubclientId, orgId, clientId);
      if (!check.ok) {
        return res.status(404).json({ success: false, message: check.message });
      }
      subclientId = bodySubclientId;
    }

    // ---- duplicates already in the organization ----
    const existingSet = await findExistingCaseNumbersCI(candidates, orgId);
    const toInsert = [];
    candidates.forEach((cn) => {
      if (existingSet.has(cn.toUpperCase())) {
        results.push({
          caseNumber: cn,
          status: "skipped",
          reason: "already_exists",
          message: "Case number already exists",
        });
      } else {
        toInsert.push(cn);
      }
    });

    let createdCount = 0;
    let submittedNow = 0;
    if (toInsert.length > 0) {
      const { data: maxRow, error: maxError } = await supabase
        .from("service_cases")
        .select("sequence_number")
        .eq("organization_id", orgId)
        .eq("product_id", count.product_id)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError) throw maxError;
      const startSeq = (maxRow?.sequence_number || 0) + 1;
      const now = new Date().toISOString();

      const rows = toInsert.map((caseNumber, i) => {
        const { type, queryText } = statusFor(caseNumber);
        const row = {
          organization_id: orgId,
          product_id: count.product_id,
          client_id: clientId,
          subclient_id: subclientId,
          // keeps the date the work was logged for (backlog counts stay backlog)
          work_date: count.work_date,
          sequence_number: startSeq + i,
          case_number: caseNumber,
          created_by: me,
          // already allocated to the person who typed the number
          assigned_employee_id: me,
          allocation_status: "ALLOCATED",
          allocated_at: now,
          allocated_by: me,
        };
        // anything other than WIP is submitted right away
        if (type !== "WIP") {
          row.submission_status = "SUBMITTED";
          row.submission_type = type;
          row.query_text = type === "QUERY" ? queryText : null;
          row.submitted_at = now;
          submittedNow++;
        }
        return row;
      });

      const { error: insErr } = await supabase
        .from("service_cases")
        .insert(rows);
      if (insErr) {
        if (insErr.code === "23505") {
          return res.status(409).json({
            success: false,
            message:
              "One of these case numbers was just taken by someone else — please try again.",
          });
        }
        throw insErr;
      }
      createdCount = rows.length;
      toInsert.forEach((cn) =>
        results.push({ caseNumber: cn, status: "created" }),
      );

      // bump the counters. The cases themselves are already saved, so a
      // failure here is logged rather than reported as a failed request.
      const { error: b1 } = await supabase
        .from("service_case_counts")
        .update({
          fulfilled_count: (count.fulfilled_count || 0) + createdCount,
        })
        .eq("id", countId)
        .eq("organization_id", orgId);
      if (b1) console.error("addCaseNumbersToCount: fulfilled_count bump:", b1);
      const { error: b2 } = await supabase
        .from("service_case_count_allocations")
        .update({
          fulfilled_quantity: (myAlloc.fulfilled_quantity || 0) + createdCount,
        })
        .eq("organization_id", orgId)
        .eq("count_id", countId)
        .eq("employee_id", me);
      if (b2)
        console.error("addCaseNumbersToCount: fulfilled_quantity bump:", b2);
    }

    const skipped = results.filter((r) => r.status === "skipped");
    let message = `${createdCount} case number(s) added.`;
    if (submittedNow) message += ` ${submittedNow} submitted.`;
    const existing = skipped
      .filter((r) => r.reason === "already_exists")
      .map((r) => r.caseNumber);
    if (existing.length) {
      message += ` Already exists: ${existing.join(", ")}.`;
    }
    const dupes = skipped
      .filter((r) => r.reason === "duplicate_in_request")
      .map((r) => r.caseNumber);
    if (dupes.length) message += ` Typed more than once: ${dupes.join(", ")}.`;

    // nothing created -> not a success, so the UI keeps the form open
    if (createdCount === 0) {
      return res
        .status(409)
        .json({ success: false, message, data: { results } });
    }
    res.status(201).json({
      success: true,
      message,
      data: {
        createdCount,
        submittedCount: submittedNow,
        skippedCount: skipped.length,
        results,
      },
    });
  } catch (err) {
    console.error("addCaseNumbersToCount error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/client-fill
// body: { clientId?, subclientId? }
//
// Employee version of "set client / subclient" — add only, never edit:
//   * only the caller's OWN cases
//   * a client / subclient that is already set can't be changed (403) —
//     that stays manager-only via PATCH /:id/client
//   * a new client must be mapped to the case's service
//   * a subclient must belong to the case's client
// ------------------------------------------------------------
async function fillCaseClient(req, res) {
  try {
    const orgId = orgIdOf(req);
    const me = userIdOf(req);
    const { id } = req.params;
    const bodyClientId = strId(req.body?.clientId);
    const bodySubclientId = strId(req.body?.subclientId);

    if (!bodyClientId && !bodySubclientId) {
      return res
        .status(400)
        .json({ success: false, message: "Pick a client or a subclient." });
    }

    // NEW: product_id is selected too, for the client-service mapping check.
    const { data: existing, error: exErr } = await supabase
      .from("service_cases")
      .select(
        "id, case_number, product_id, client_id, subclient_id, assigned_employee_id",
      )
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }
    if (existing.assigned_employee_id !== me) {
      return res.status(403).json({
        success: false,
        message: "You can only add a client to your own cases.",
      });
    }

    let nextClientId = strId(existing.client_id);
    let nextSubclientId = strId(existing.subclient_id);

    if (bodyClientId) {
      if (nextClientId) {
        if (nextClientId !== bodyClientId) {
          return res.status(403).json({
            success: false,
            message: "Client is already set — only a manager can change it.",
          });
        }
      } else {
        if (!(await clientExists(bodyClientId, orgId))) {
          return res
            .status(404)
            .json({ success: false, message: "Client not found" });
        }
        // NEW: the client must be mapped to this case's service.
        const mapCheck = await assertClientMappedToProduct(
          bodyClientId,
          existing.product_id,
          orgId,
        );
        if (!mapCheck.ok) {
          return res
            .status(400)
            .json({ success: false, message: mapCheck.message });
        }
        nextClientId = bodyClientId;
      }
    }

    if (bodySubclientId) {
      if (nextSubclientId) {
        if (nextSubclientId !== bodySubclientId) {
          return res.status(403).json({
            success: false,
            message: "Subclient is already set — only a manager can change it.",
          });
        }
      } else {
        if (!nextClientId) {
          return res
            .status(400)
            .json({ success: false, message: "Pick a client first." });
        }
        const check = await validateSubclient(
          bodySubclientId,
          orgId,
          nextClientId,
        );
        if (!check.ok) {
          return res
            .status(404)
            .json({ success: false, message: check.message });
        }
        nextSubclientId = bodySubclientId;
      }
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ client_id: nextClientId, subclient_id: nextSubclientId })
      .eq("id", id)
      .eq("organization_id", orgId)
      .eq("assigned_employee_id", me)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    const [clientMap, subclientMap] = await Promise.all([
      getClientNameMap([data.client_id], orgId),
      getSubclientNameMap([data.subclient_id], orgId),
    ]);

    res.json({
      success: true,
      message: `${data.case_number} updated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        clientId: data.client_id || null,
        clientName: clientMap[data.client_id] || null,
        subclientId: data.subclient_id || null,
        subclientName: subclientMap[data.subclient_id] || null,
      },
    });
  } catch (err) {
    console.error("fillCaseClient error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listMyCounts,
  selfAllocateCounts,
  addCaseNumbersToCount,
  fillCaseClient,
};
