// src/modules/qualitychecks/qc.controller.js
//
// "Quality Scores" page (Page 7) — was previously a stub (listQcChecks
// always returned an empty array, createQcCheck never actually wrote
// anything). This is the real implementation, backed by a `qc_checks`
// table.
//
// Every check now records THREE things together, per the redesign:
//   - pass_qty  (units that passed inspection)
//   - fail_qty  (units that failed inspection)
//   - quality_score (a 0–100 numeric rating for the batch, independent
//     of the raw counts — e.g. a supervisor's overall quality rating)
//
// Every query is scoped to req.user.organizationId, same multi-tenant
// pattern as allocations.controller.js / dailywork.controller.js.

const supabase = require("../../config/supabaseClient");

// ------------------------------------------------------------
// Shared helper: given a list of employee/product ids, fetch their
// display names in one query each — same manual-join pattern used
// elsewhere (no FK embedding, since PostgREST needs an actual DB
// constraint for that, and these tables don't have one defined).
// ------------------------------------------------------------
async function getEmployeeNameMap(employeeIds) {
  const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name", "Employee ID"')
    .in('"Auth User Id"', uniqueIds);
  if (error) {
    console.error("Failed to fetch employee names for QC:", error);
    return {};
  }

  return (data || []).reduce((acc, row) => {
    const name = [row["First Name"], row["Last Name"]]
      .filter(Boolean)
      .join(" ")
      .trim();
    acc[row["Auth User Id"]] = {
      name: name || null,
      employeeCode: row["Employee ID"] || null,
    };
    return acc;
  }, {});
}

async function getProductNameMap(productIds) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("Failed to fetch product names for QC:", error);
    return {};
  }

  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// GET /api/qc — recent QC checks for the caller's organization, newest
// first. Optional ?employeeId= / ?productId= query filters (used by the
// redesigned frontend's summary cards, and available for anyone who
// wants to filter the table down to one person/service).
// ------------------------------------------------------------
async function listQcChecks(req, res) {
  try {
    let query = supabase
      .from("qc_checks")
      .select("*")
      .eq("organization_id", req.user.organizationId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (req.query.employeeId) {
      query = query.eq("employee_id", req.query.employeeId);
    }
    if (req.query.productId) {
      query = query.eq("product_id", req.query.productId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const [employeeMap, productMap] = await Promise.all([
      getEmployeeNameMap(rows.map((r) => r.employee_id)),
      getProductNameMap(rows.map((r) => r.product_id)),
    ]);

    const enriched = rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: employeeMap[r.employee_id]?.name || null,
      employeeCode: employeeMap[r.employee_id]?.employeeCode || null,
      productId: r.product_id,
      productName: productMap[r.product_id] || null,
      passQty: r.pass_qty,
      failQty: r.fail_qty,
      qualityScore: r.quality_score,
      createdAt: r.created_at,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error("listQcChecks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/qc
// body: { employeeId, productId, passQty, failQty, qualityScore }
//
// passQty/failQty: whole-number counts, at least one must be > 0.
// qualityScore: a required 0–100 numeric rating — separate from the
// pass/fail counts, so a check always carries both a hard count AND a
// score, per the redesign.
// ------------------------------------------------------------
async function createQcCheck(req, res) {
  try {
    const { employeeId, productId } = req.body;
    const passQty = Number(req.body.passQty) || 0;
    const failQty = Number(req.body.failQty) || 0;
    const qualityScore = Number(req.body.qualityScore);

    if (!employeeId || !productId) {
      return res.status(400).json({
        success: false,
        message: "employeeId and productId are required",
      });
    }
    if (passQty < 0 || failQty < 0) {
      return res.status(400).json({
        success: false,
        message: "passQty and failQty cannot be negative",
      });
    }
    if (passQty === 0 && failQty === 0) {
      return res.status(400).json({
        success: false,
        message: "Enter a Pass or Fail quantity greater than 0",
      });
    }
    if (
      !Number.isFinite(qualityScore) ||
      qualityScore < 0 ||
      qualityScore > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "qualityScore is required and must be a number between 0 and 100",
      });
    }

    const { data, error } = await supabase
      .from("qc_checks")
      .insert({
        organization_id: req.user.organizationId,
        employee_id: employeeId,
        product_id: productId,
        pass_qty: passQty,
        fail_qty: failQty,
        quality_score: qualityScore,
        created_by: req.user.userId,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "QC result saved.",
      data,
    });
  } catch (err) {
    console.error("createQcCheck error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listQcChecks,
  createQcCheck,
};
