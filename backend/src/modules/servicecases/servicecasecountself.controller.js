// src/modules/servicecases/servicecasecountself.controller.js
const { todayInTz } = require("../../utils/dates");
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
const { fetchAll } = require("../../utils/fetchAll");
const {
  getActingEmployeeId,
  getProductNameMap,
  getClientNameMap,
  getSubclientNameMap,
} = require("./servicecases.controller");
// NEW: a client can only be used on a service it is mapped to.
const { assertClientMappedToProduct } = require("./serviceClients");
// Counts left without case numbers at day end go back to the pool, like cases.
const { ensureRollover, startOfTodayISO } = require("./caseRollover");

const orgIdOf = (req) => req.user.organizationId;
const userIdOf = (req) => req.user.userId;
// NEW: a manager opening another employee's Profile sends ?employeeId=<id>.
// The route only lets that through for people with allocation permission
// (see servicecases.routes.js); without it this is always the caller.
const targetUserOf = (req) =>
  req.query.employeeId ? String(req.query.employeeId) : userIdOf(req);

// Max case numbers typed in one go (frontend caps lower; this is a safety net).
const MAX_CASE_NUMBERS_AT_ONCE = 200;

// A typed entry starting with this token means "no case number" — only
// accepted when the org has turned OFF "case number required"
// (organizations.case_number_required = false). The server swaps it for
// a generated internal number (AUTO00012) before saving.
const AUTO_TOKEN = "__AUTO__";

// true unless the org explicitly switched the requirement off. A missing
// column / row falls back to the old behaviour (required).
async function isCaseNumberRequired(orgId) {
  const { data, error } = await supabase
    .from("organizations")
    .select("case_number_required")
    .eq("id", orgId)
    .maybeSingle();
  if (error) return true;
  return data?.case_number_required !== false;
}

// Same outcomes as servicecases.controller.js. "WIP" is NOT stored — it
// simply means "add the case, don't submit it yet".
const SUBMISSION_TYPES = [
  "COMPLETED",
  "DONE_BY_TEAM",
  "DONE_BY_CLIENT",
  "QUERY",
  "OUT_OF_SCOPE",
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

// Case-insensitive duplicate check, PER SERVICE: the same case number may
// exist under a different service, but never twice under the same service.
async function findExistingCaseNumbersCI(
  caseNumbers,
  productId,
  organizationId,
) {
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
        .eq("product_id", productId)
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
  // FIX: paged — a plain .limit(1000) silently drops everything past the
  // first 1000 rows (oldest-first), which would hide TODAY's counts once
  // fulfilled rows pile up.
  const { data, error } = await fetchAll(() =>
    supabase
      .from("service_case_counts")
      .select("*")
      .eq("organization_id", orgId)
      .lte("work_date", workDate)
      .order("work_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
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
    const me = targetUserOf(req);
    const workDate = validYmd(req.query.workDate) || todayInTz();
    const productId = req.query.productId ? String(req.query.productId) : null;

    // anything allocated on an earlier day and still without case numbers
    // goes back to the pool before we answer
    await ensureRollover(orgId);

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
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
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
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/my-counts/add-case-numbers
// body: {
//   countId,
//   caseNumbers: string[],
//   statuses?: { [UPPERCASED_CASE_NUMBER]: { submissionType, queryText?, reasonText? } },
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
    // Super Admin / Ops Manager may add + submit on behalf of an employee
    // (body.onBehalfOf); anyone else always acts as themselves.
    const acting = getActingEmployeeId(req);
    if (!acting.ok) {
      return res.status(403).json({ success: false, message: acting.message });
    }
    const me = acting.employeeId;
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
      const reasonText = (s.reasonText || "").toString().trim();
      return { type, queryText, reasonText };
    };
    for (const cn of candidates) {
      const { type, queryText, reasonText } = statusFor(cn);
      if (type === "OUT_OF_SCOPE" && !reasonText) {
        return res.status(400).json({
          success: false,
          message: `Reason is required for ${cn} (Out of Scope).`,
        });
      }
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
      .select("quantity, fulfilled_quantity, allocated_at")
      .eq("organization_id", orgId)
      .eq("count_id", countId)
      .eq("employee_id", me)
      .maybeSingle();
    if (aErr) throw aErr;

    // Same rule as cases: units allocated on an EARLIER day that never got
    // their case numbers are returned to the pool and can't be submitted
    // any more (with or without a case number).
    if (myAlloc?.allocated_at && myAlloc.allocated_at < startOfTodayISO()) {
      return res.status(403).json({
        success: false,
        message:
          "These cases were allocated on an earlier day and are being returned to the pool — they can no longer be submitted.",
      });
    }

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

    // ---- NEW: services marked "no case number" (has_case_number = false) ----
    // Counts of such a service never take real case numbers — only
    // placeholder (__AUTO__) entries, which get a generated internal number.
    const { data: svcRow } = await supabase
      .from("service_master")
      .select("has_case_number")
      .eq("id", count.product_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    const noCaseService = svcRow?.has_case_number === false;
    if (
      noCaseService &&
      candidates.some((cn) => !cn.toUpperCase().startsWith(AUTO_TOKEN))
    ) {
      return res.status(400).json({
        success: false,
        message: "This service doesn't use case numbers.",
      });
    }

    // ---- "no case number" entries (when the org allows it, or the service has none) ----
    const autoCandidates = candidates.filter((cn) =>
      cn.toUpperCase().startsWith(AUTO_TOKEN),
    );
    if (autoCandidates.length > 0) {
      if (!noCaseService && (await isCaseNumberRequired(orgId))) {
        return res.status(400).json({
          success: false,
          message: "Case numbers are required — please type them in.",
        });
      }
      const { data: seqRow, error: seqErr } = await supabase
        .from("service_cases")
        .select("sequence_number")
        .eq("organization_id", orgId)
        .eq("product_id", count.product_id)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (seqErr) throw seqErr;
      const base = (seqRow?.sequence_number || 0) + 1;
      autoCandidates.forEach((token, k) => {
        const generated = `AUTO${String(base + k).padStart(5, "0")}`;
        const idx = candidates.indexOf(token);
        candidates[idx] = generated;
        const key = token.toUpperCase();
        if (statuses[key]) {
          statuses[generated.toUpperCase()] = statuses[key];
          delete statuses[key];
        }
      });
    }

    // ---- client / subclient PER CASE ----
    // Every case needs a client. Order: what the count already has, then the
    // client chosen for THAT case (statuses[caseNo].clientId), then a single
    // request-level clientId. Each distinct client / subclient is validated
    // once (exists in this org, mapped to the service, subclient belongs to
    // the client). Nothing is created unless every case has a valid client.
    const countClientId = strId(count.client_id);
    const countSubclientId = strId(count.subclient_id);
    const bodyClientId = strId(req.body?.clientId);
    const bodySubclientId = strId(req.body?.subclientId);
    const clientChecked = new Set();
    const subChecked = new Set();
    const clientPick = {}; // CASE NO (upper) -> { clientId, subclientId }
    for (const cn of candidates) {
      const st = statuses[cn.toUpperCase()] || {};
      const clientId = countClientId || strId(st.clientId) || bodyClientId;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: `Select a client for ${cn} before adding it.`,
        });
      }
      if (!countClientId && !clientChecked.has(clientId)) {
        if (!(await clientExists(clientId, orgId))) {
          return res
            .status(404)
            .json({ success: false, message: "Client not found" });
        }
        // the client must be mapped to this count's service
        const mapCheck = await assertClientMappedToProduct(
          clientId,
          count.product_id,
          orgId,
        );
        if (!mapCheck.ok) {
          return res
            .status(400)
            .json({ success: false, message: mapCheck.message });
        }
        clientChecked.add(clientId);
      }
      const subclientId =
        countSubclientId || strId(st.subclientId) || bodySubclientId || null;
      if (subclientId && !countSubclientId) {
        const pair = `${clientId}:${subclientId}`;
        if (!subChecked.has(pair)) {
          const check = await validateSubclient(subclientId, orgId, clientId);
          if (!check.ok) {
            return res
              .status(404)
              .json({ success: false, message: check.message });
          }
          subChecked.add(pair);
        }
      }
      clientPick[cn.toUpperCase()] = { clientId, subclientId };
    }

    // ---- duplicates already under the SAME service ----
    const existingSet = await findExistingCaseNumbersCI(
      candidates,
      count.product_id,
      orgId,
    );
    const toInsert = [];
    candidates.forEach((cn) => {
      if (existingSet.has(cn.toUpperCase())) {
        results.push({
          caseNumber: cn,
          status: "skipped",
          reason: "already_exists",
          message: "Case number already exists for this service",
        });
      } else {
        toInsert.push(cn);
      }
    });

    let createdCount = 0;
    let submittedNow = 0;
    // Slots reserved in ONE atomic database step (see reserve_count_slots in
    // sql/atomic_count_slots.sql). Two tabs / devices saving at the same
    // moment can then never create more cases than were allocated.
    let reservedSlots = 0;
    if (toInsert.length > 0) {
      const { data: reservedOk, error: reserveErr } = await supabase.rpc(
        "reserve_count_slots",
        {
          p_org: String(orgId),
          p_count: String(countId),
          p_employee: String(me),
          p_n: toInsert.length,
        },
      );
      if (reserveErr) {
        // function not created yet -> keep the old behaviour (counters are
        // bumped after the insert, below) and say so in the log
        if (reserveErr.code === "PGRST202" || reserveErr.code === "42883") {
          console.warn(
            "reserve_count_slots() is missing — run sql/atomic_count_slots.sql in Supabase. Using the non-atomic fallback.",
          );
        } else {
          throw reserveErr;
        }
      } else if (!reservedOk) {
        return res.status(409).json({
          success: false,
          message:
            "No cases from this count are waiting on you (it may have just been saved from another tab or device). Refresh and check.",
        });
      } else {
        reservedSlots = toInsert.length;
      }
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
        const { type, queryText, reasonText } = statusFor(caseNumber);
        const row = {
          organization_id: orgId,
          product_id: count.product_id,
          client_id: clientPick[caseNumber.toUpperCase()]?.clientId || null,
          subclient_id:
            clientPick[caseNumber.toUpperCase()]?.subclientId || null,
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
          row.out_of_scope_reason = type === "OUT_OF_SCOPE" ? reasonText : null;
          row.submitted_at = now;
          submittedNow++;
        }
        return row;
      });

      const { error: insErr } = await supabase
        .from("service_cases")
        .insert(rows);
      if (insErr) {
        // give the reserved slots back — nothing was created
        if (reservedSlots > 0) {
          const { error: relErr } = await supabase.rpc("release_count_slots", {
            p_org: String(orgId),
            p_count: String(countId),
            p_employee: String(me),
            p_n: reservedSlots,
          });
          if (relErr) console.error("release_count_slots failed:", relErr);
        }
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

      // (fallback only — with reserve_count_slots the counters are already
      // updated atomically.)
      if (reservedSlots === 0) {
        // bump the counters. The cases themselves are already saved, so a
        // failure here is logged rather than reported as a failed request.
        const { error: b1 } = await supabase
          .from("service_case_counts")
          .update({
            fulfilled_count: (count.fulfilled_count || 0) + createdCount,
          })
          .eq("id", countId)
          .eq("organization_id", orgId);
        if (b1)
          console.error("addCaseNumbersToCount: fulfilled_count bump:", b1);
        const { error: b2 } = await supabase
          .from("service_case_count_allocations")
          .update({
            fulfilled_quantity:
              (myAlloc.fulfilled_quantity || 0) + createdCount,
          })
          .eq("organization_id", orgId)
          .eq("count_id", countId)
          .eq("employee_id", me);
        if (b2)
          console.error("addCaseNumbersToCount: fulfilled_quantity bump:", b2);
      }
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
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
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
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

// ------------------------------------------------------------
// GET /api/service-cases/my-missed-counts
//
// Count units allocated to the caller on an earlier day that never got
// their case numbers and were returned to the pool (see caseRollover.js).
// READ-ONLY history for Profile -> Past Allocation (Counts view).
// ------------------------------------------------------------
async function listMyMissedCounts(req, res) {
  try {
    const orgId = orgIdOf(req);
    const me = targetUserOf(req);
    await ensureRollover(orgId);

    const { data, error } = await supabase
      .from("case_count_carryover_log")
      .select("*")
      .eq("organization_id", String(orgId))
      .eq("employee_id", String(me))
      .order("returned_at", { ascending: false })
      .limit(2000);
    if (error) throw error;

    // Hide history rows whose count has since been fully resolved (every
    // unit finally got its case number) — otherwise "carried forward" rows
    // keep showing for work that is already done. Counts that are still
    // open (fully or partly) keep their row.
    const logRows = data || [];
    const countIds = [...new Set(logRows.map((r) => String(r.count_id)))];
    const doneCountIds = new Set();
    for (let i = 0; i < countIds.length; i += 150) {
      const { data: cs, error: cErr } = await supabase
        .from("service_case_counts")
        .select("id, quantity, fulfilled_count")
        .eq("organization_id", String(orgId))
        .in("id", countIds.slice(i, i + 150));
      if (cErr) throw cErr;
      (cs || []).forEach((c) => {
        if ((c.fulfilled_count || 0) >= (c.quantity || 0)) {
          doneCountIds.add(String(c.id));
        }
      });
    }
    const rows = logRows.filter((r) => !doneCountIds.has(String(r.count_id)));
    const [productMap, clientMap, subclientMap] = await Promise.all([
      getProductNameMap(
        rows.map((r) => r.product_id),
        orgId,
      ),
      getClientNameMap(
        rows.map((r) => r.client_id),
        orgId,
      ),
      getSubclientNameMap(
        rows.map((r) => r.subclient_id),
        orgId,
      ),
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: `missed-count-${r.id}`,
        countId: r.count_id,
        productId: r.product_id,
        productName: productMap[r.product_id] || null,
        clientId: r.client_id || null,
        clientName: clientMap[r.client_id] || null,
        subclientId: r.subclient_id || null,
        subclientName: subclientMap[r.subclient_id] || null,
        workDate: r.work_date,
        allocatedAt: r.allocated_at,
        returnedAt: r.returned_at,
        returnedQuantity: r.returned_quantity,
      })),
    });
  } catch (err) {
    console.error("listMyMissedCounts error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

module.exports = {
  listMyMissedCounts,
  listMyCounts,
  selfAllocateCounts,
  addCaseNumbersToCount,
  fillCaseClient,
};
