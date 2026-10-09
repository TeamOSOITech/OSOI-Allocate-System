// src/modules/servicecases/servicecasereports.controller.js
//
// Production Report — client-wise cards.
//   GET /api/service-cases/client-summary
//     query: productId?, employeeId?, clientId? ("none" = cases with no
//            client), workDateFrom?, workDateTo?
//
// One row per client:
//   receiving = every case (service_cases row) in the range
//   allocated = allocation_status = 'ALLOCATED'
//   pending   = receiving - allocated   (not allocated yet)
//   submitted = submission_status = 'SUBMITTED'
//
// Only real cases (service_cases) are counted. Count-only entries that
// don't have case numbers yet live in service_case_counts and are NOT
// included here.

const supabase = require("../../config/supabaseClient");
const { getClientNameMap } = require("./servicecases.controller");

const PAGE = 1000;

async function clientSummary(req, res) {
  try {
    const orgId = req.user.organizationId;
    const { productId, employeeId, clientId, workDateFrom, workDateTo } =
      req.query;

    const buckets = new Map(); // key: client id, or "none"
    const bump = (key, row) => {
      const b = buckets.get(key) || {
        receiving: 0,
        allocated: 0,
        pending: 0,
        submitted: 0,
      };
      b.receiving += 1;
      if (row.allocation_status === "ALLOCATED") b.allocated += 1;
      else b.pending += 1;
      if (row.submission_status === "SUBMITTED") b.submitted += 1;
      buckets.set(key, b);
    };

    // Supabase returns max 1000 rows per request, so page through.
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("service_cases")
        .select("client_id, allocation_status, submission_status")
        .eq("organization_id", orgId);
      if (productId) q = q.eq("product_id", productId);
      if (employeeId) q = q.eq("assigned_employee_id", employeeId);
      if (clientId) {
        q =
          clientId === "none"
            ? q.is("client_id", null)
            : q.eq("client_id", clientId);
      }
      if (workDateFrom) q = q.gte("work_date", workDateFrom);
      if (workDateTo) q = q.lte("work_date", workDateTo);

      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;

      (data || []).forEach((r) =>
        bump(r.client_id ? String(r.client_id) : "none", r),
      );
      if (!data || data.length < PAGE) break;
    }

    const clientIds = [...buckets.keys()].filter((k) => k !== "none");
    const nameMap = await getClientNameMap(clientIds, orgId);

    const rows = [...buckets.entries()].map(([key, b]) => ({
      clientId: key === "none" ? null : key,
      clientName:
        key === "none" ? "No client" : nameMap[key] || "Unknown client",
      ...b,
    }));

    // biggest first, "No client" always last
    rows.sort((a, b) => {
      if (a.clientId === null) return 1;
      if (b.clientId === null) return -1;
      return (
        b.receiving - a.receiving || a.clientName.localeCompare(b.clientName)
      );
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("clientSummary error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { clientSummary };
