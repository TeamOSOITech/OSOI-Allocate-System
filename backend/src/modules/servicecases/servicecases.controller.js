// src/modules/servicecases/servicecases.controller.js
//
// "Case Register" — the second tab on the Daily Work page. Where Daily
// Work logs one BATCH row per service+date (e.g. "Billing, 10 units,
// 2026-08-19"), this logs one row PER INDIVIDUAL UNIT — so entering
// qty=10 for Billing creates 10 separate case rows, each with its own
// running case number like CASEB011, CASEB012, ... CASEB020.
//
// Numbering rules:
//   - Format: CASE + first letter of the service name (uppercased) +
//     a zero-padded sequence number, e.g. Billing -> CASEB001, TC -> CASET001.
//   - The sequence is a RUNNING COUNTER per organization+service — it
//     never resets by date. If Billing reached 10 yesterday, the next
//     case created today (for Billing) starts at 11, not 1.
//
// This is intentionally a completely separate table/module from
// dailywork.controller.js — Daily Work's own batches/allocations are
// untouched by any of this.

const supabase = require("../../config/supabaseClient");

function firstLetterOf(name) {
  const trimmed = (name || "").toString().trim();
  const firstAlpha = trimmed.match(/[A-Za-z]/);
  return (firstAlpha ? firstAlpha[0] : "X").toUpperCase();
}

function formatCaseNumber(letter, sequenceNumber) {
  return `CASE${letter}${String(sequenceNumber).padStart(3, "0")}`;
}

async function getProduct(productId, organizationId) {
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getProductNameMap(productIds, organizationId) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) throw error;
  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// NEW: Today's Allocation — "Cases" + "Employees" tabs.
//
// Cases created here (service_cases) can now be ALLOCATED to an
// employee, either one at a time (manual, from the Cases tab's per-row
// dropdown) or all at once (auto/smart, splitting every still-PENDING
// case for a service as evenly as possible across whoever is marked
// PRESENT for the day on the Employees tab — same `attendance` table
// Daily Work's Smart Allocation already reads).
//
// Requires two new columns on service_cases (see migration note below):
//   assigned_employee_id  uuid, nullable, references user_master
//   allocation_status     text, default 'PENDING' ('PENDING' | 'ALLOCATED')
//   allocated_at          timestamptz, nullable
// ------------------------------------------------------------

// Same manual-join pattern as allocations.controller.js's getUserInfoMap
// — user_master has no PostgREST FK relationship set up for service_cases
// to embed through, so names are fetched separately and merged in code.
async function getEmployeeNameMap(employeeIds, organizationId) {
  const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name"')
    .eq("organization_id", organizationId)
    .in("Auth User Id", uniqueIds);
  if (error) {
    console.error("Failed to fetch user_master for service cases:", error);
    return {};
  }
  return (data || []).reduce((acc, u) => {
    const firstName = u["First Name"] ?? "";
    const lastName = u["Last Name"] ?? "";
    acc[u["Auth User Id"]] = `${firstName} ${lastName}`.trim() || null;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// GET /api/service-cases
// Query params:
//   productId  (optional) — filter to one service
//   page       (default 1)
//   pageSize   (default 20)
// Returns newest-first, with total count for pagination.
// ------------------------------------------------------------
async function listServiceCases(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    // "mine=true" (the employee's own allocation page) loads everything
    // assigned to them in one go rather than paginating — that page
    // does its own today/past split and filtering client-side, same as
    // it already did for the old allocations-based table.
    const maxPageSize = req.query.mine === "true" ? 2000 : 100;
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      maxPageSize,
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("service_cases")
      .select("*", { count: "exact" })
      .eq("organization_id", req.user.organizationId)
      // FIX: ordering by created_at alone left ties unresolved when a
      // whole batch (e.g. 10 cases) was inserted in the same instant —
      // Postgres/PostgREST doesn't guarantee any particular order among
      // equal timestamps, so CASET010 could sort before CASET001. Adding
      // sequence_number as a tiebreaker (also descending, so within a
      // batch the highest/newest case number still shows first) makes
      // the order deterministic and correct every time.
      .order("created_at", { ascending: false })
      .order("sequence_number", { ascending: false })
      .range(from, to);

    if (req.query.productId) {
      query = query.eq("product_id", req.query.productId);
    }
    // NEW: Cases tab filters — same work_date the Employees tab marks
    // attendance for, and allocation_status so "show only unallocated"
    // works without pulling every case ever logged.
    if (req.query.workDate) {
      query = query.eq("work_date", req.query.workDate);
    }
    if (req.query.allocationStatus) {
      query = query.eq("allocation_status", req.query.allocationStatus);
    }
    // NEW: "mine=true" — the employee's own Today's/Past Allocation
    // table on the Profile page. Scoped server-side to whoever is
    // authenticated (never trusts a client-supplied employee id), same
    // pattern as /api/allocations/self.
    if (req.query.mine === "true") {
      query = query.eq("assigned_employee_id", req.user.userId);
    }
    if (req.query.submissionStatus) {
      query = query.eq("submission_status", req.query.submissionStatus);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = data || [];
    const productMap = await getProductNameMap(
      rows.map((r) => r.product_id),
      req.user.organizationId,
    );
    const employeeMap = await getEmployeeNameMap(
      rows.map((r) => r.assigned_employee_id),
      req.user.organizationId,
    );

    const enriched = rows.map((r) => ({
      id: r.id,
      caseNumber: r.case_number,
      productId: r.product_id,
      productName: productMap[r.product_id] || null,
      workDate: r.work_date,
      sequenceNumber: r.sequence_number,
      createdAt: r.created_at,
      assignedEmployeeId: r.assigned_employee_id || null,
      assignedEmployeeName: employeeMap[r.assigned_employee_id] || null,
      allocationStatus: r.allocation_status || "PENDING",
      allocatedAt: r.allocated_at || null,
      profile: r.profile || "",
      // NEW: employee's own submission of their work on this case —
      // separate from allocation_status (which just means "assigned to
      // someone"). 'SUBMITTED' once the assigned employee marks it done.
      submissionStatus: r.submission_status || "PENDING",
      submissionType: r.submission_type || null,
      queryText: r.query_text || "",
      submittedAt: r.submitted_at || null,
    }));

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / pageSize), 1),
      },
    });
  } catch (err) {
    console.error("listServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases
// body: { productId, quantity, workDate? }
//
// Creates `quantity` individual case rows for the service, continuing
// the running per-service sequence from wherever it last left off.
// ------------------------------------------------------------
async function createServiceCases(req, res) {
  try {
    const { productId } = req.body;
    const quantity = Number(req.body.quantity);
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a whole number greater than 0",
      });
    }
    // Sane upper bound on a single submission — protects against a
    // fat-fingered quantity trying to insert tens of thousands of rows
    // in one request.
    if (quantity > 2000) {
      return res.status(400).json({
        success: false,
        message: "quantity cannot exceed 2000 in a single submission",
      });
    }

    const product = await getProduct(productId, req.user.organizationId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }
    const letter = firstLetterOf(product.product_name);

    // Running counter: highest sequence_number ever used for this
    // service in this org, regardless of date — that's what makes
    // numbering continue across days instead of resetting.
    const { data: maxRow, error: maxError } = await supabase
      .from("service_cases")
      .select("sequence_number")
      .eq("organization_id", req.user.organizationId)
      .eq("product_id", productId)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;

    const startSeq = (maxRow?.sequence_number || 0) + 1;

    const rowsToInsert = Array.from({ length: quantity }, (_, i) => {
      const seq = startSeq + i;
      return {
        organization_id: req.user.organizationId,
        product_id: productId,
        work_date: workDate,
        sequence_number: seq,
        case_number: formatCaseNumber(letter, seq),
        created_by: req.user.userId,
      };
    });

    const { data, error } = await supabase
      .from("service_cases")
      .insert(rowsToInsert)
      .select();
    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `${quantity} case(s) created (${rowsToInsert[0].case_number} to ${
        rowsToInsert[rowsToInsert.length - 1].case_number
      }).`,
      data,
    });
  } catch (err) {
    console.error("createServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/service-cases/:id
// Removes a single case row. Deliberately does NOT touch or renumber
// any other case for that service — sequence numbers are a running,
// ever-increasing log (like an invoice number), not a dense 1..N range,
// so deleting #7 leaves a gap rather than shifting #8, #9, ... down.
// ------------------------------------------------------------
async function deleteServiceCase(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("service_cases")
      .delete()
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    res.json({ success: true, message: `${data.case_number} deleted.` });
  } catch (err) {
    console.error("deleteServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/allocate
// body: { employeeId }  — employeeId: null/"" un-allocates the case
// back to PENDING; any other value must be a real user_master row in
// this org (checked below) and assigns the case to them.
//
// This is the "Cases" tab's per-row manual allocate dropdown.
// ------------------------------------------------------------
async function allocateServiceCase(req, res) {
  try {
    const { id } = req.params;
    const employeeId = req.body.employeeId || null;

    if (employeeId) {
      const { data: emp, error: empError } = await supabase
        .from("user_master")
        .select('"Auth User Id"')
        .eq("Auth User Id", employeeId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (empError) throw empError;
      if (!emp) {
        return res
          .status(404)
          .json({ success: false, message: "Employee not found" });
      }
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        assigned_employee_id: employeeId,
        allocation_status: employeeId ? "ALLOCATED" : "PENDING",
        allocated_at: employeeId ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    const employeeMap = await getEmployeeNameMap(
      [data.assigned_employee_id],
      req.user.organizationId,
    );

    res.json({
      success: true,
      message: employeeId
        ? `${data.case_number} allocated.`
        : `${data.case_number} un-allocated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        assignedEmployeeId: data.assigned_employee_id || null,
        assignedEmployeeName: employeeMap[data.assigned_employee_id] || null,
        allocationStatus: data.allocation_status || "PENDING",
        allocatedAt: data.allocated_at || null,
      },
    });
  } catch (err) {
    console.error("allocateServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/auto-allocate
// body: { productId, workDate, employeeIds: [...] }
//
// "Smart Allocation" for the Cases tab: takes every still-PENDING case
// for the given service+date and splits them as evenly as possible,
// round-robin, across the given employee list — the same people marked
// PRESENT on the Employees tab. Case #1 to employee #1, #2 to #2, ...
// wrapping back to #1 once the employee list is exhausted, so counts
// differ by at most 1 across employees.
// ------------------------------------------------------------
async function autoAllocateServiceCases(req, res) {
  try {
    const { productId, workDate } = req.body;
    const employeeIds = Array.isArray(req.body.employeeIds)
      ? [...new Set(req.body.employeeIds.filter(Boolean))]
      : [];

    if (!productId || !workDate) {
      return res.status(400).json({
        success: false,
        message: "productId and workDate are required",
      });
    }
    if (employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No employees selected — mark at least one employee Present on the Employees tab first.",
      });
    }

    const { data: pendingCases, error } = await supabase
      .from("service_cases")
      .select("id, case_number, sequence_number")
      .eq("organization_id", req.user.organizationId)
      .eq("product_id", productId)
      .eq("work_date", workDate)
      .eq("allocation_status", "PENDING")
      .order("sequence_number", { ascending: true });
    if (error) throw error;

    if (!pendingCases || pendingCases.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending cases to allocate for this service/date.",
      });
    }

    const now = new Date().toISOString();
    const updates = pendingCases.map((c, idx) => ({
      id: c.id,
      caseNumber: c.case_number,
      employeeId: employeeIds[idx % employeeIds.length],
    }));

    // Supabase JS has no bulk "update many rows with different values"
    // in one call, so this fires one update per case — fine at the
    // scale a single day's case list runs at (Daily Work caps a single
    // submission at 2000 cases).
    await Promise.all(
      updates.map((u) =>
        supabase
          .from("service_cases")
          .update({
            assigned_employee_id: u.employeeId,
            allocation_status: "ALLOCATED",
            allocated_at: now,
          })
          .eq("id", u.id)
          .eq("organization_id", req.user.organizationId),
      ),
    );

    const employeeMap = await getEmployeeNameMap(
      employeeIds,
      req.user.organizationId,
    );
    // Per-employee summary — how many cases + which case numbers each
    // employee ended up with, so the UI can show it right after running
    // Smart Allocation without a second fetch.
    const perEmployee = employeeIds.map((empId) => {
      const cases = updates.filter((u) => u.employeeId === empId);
      return {
        employeeId: empId,
        employeeName: employeeMap[empId] || null,
        caseCount: cases.length,
        caseNumbers: cases.map((c) => c.caseNumber),
      };
    });

    res.json({
      success: true,
      message: `${updates.length} case(s) allocated across ${employeeIds.length} employee(s).`,
      data: { allocatedCount: updates.length, perEmployee },
    });
  } catch (err) {
    console.error("autoAllocateServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// NEW: Profile — free-text value attached to a case, keyed by case
// number (same way employee allocation works, just a plain text field
// instead of a dropdown). Two ways to set it, both from the Case
// Register page:
//   1. Single — PATCH /:id/profile, one case at a time.
//   2. Bulk upload — POST /bulk-profile, a CSV of (case number,
//      profile) pairs parsed on the frontend and sent as JSON here,
//      matched by case_number within the org and updated together.
//
// Requires a new column on service_cases (see migration note below):
//   profile  text, nullable
// ------------------------------------------------------------

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/profile
// body: { profile: string }
// ------------------------------------------------------------
async function updateServiceCaseProfile(req, res) {
  try {
    const { id } = req.params;
    const profile = (req.body.profile ?? "").toString().trim();

    const { data, error } = await supabase
      .from("service_cases")
      .update({ profile })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    res.json({
      success: true,
      message: `${data.case_number} profile updated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        profile: data.profile || "",
      },
    });
  } catch (err) {
    console.error("updateServiceCaseProfile error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/bulk-profile
// body: { rows: [{ caseNumber, profile }, ...] }
//
// Bulk-upload counterpart of the above — matches each row to an
// existing case by case_number (within this org) and sets its
// profile value. Case numbers that don't match any row are reported
// back as "notFound" rather than failing the whole request, so one
// typo in a 200-row CSV doesn't block the other 199.
// ------------------------------------------------------------
async function bulkUpdateServiceCaseProfiles(req, res) {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const cleaned = rows
      .map((r) => ({
        caseNumber: (r.caseNumber || "").toString().trim(),
        profile: (r.profile ?? "").toString().trim(),
      }))
      .filter((r) => r.caseNumber);

    if (cleaned.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid rows to upload — each row needs a case number.",
      });
    }
    if (cleaned.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Bulk upload cannot exceed 5000 rows at a time.",
      });
    }

    const caseNumbers = cleaned.map((r) => r.caseNumber);
    const { data: existing, error: fetchError } = await supabase
      .from("service_cases")
      .select("id, case_number")
      .eq("organization_id", req.user.organizationId)
      .in("case_number", caseNumbers);
    if (fetchError) throw fetchError;

    const idByCaseNumber = (existing || []).reduce((acc, row) => {
      acc[row.case_number] = row.id;
      return acc;
    }, {});

    const notFound = [];
    const toUpdate = [];
    cleaned.forEach((r) => {
      const id = idByCaseNumber[r.caseNumber];
      if (!id) {
        notFound.push(r.caseNumber);
      } else {
        toUpdate.push({ id, caseNumber: r.caseNumber, profile: r.profile });
      }
    });

    await Promise.all(
      toUpdate.map((u) =>
        supabase
          .from("service_cases")
          .update({ profile: u.profile })
          .eq("id", u.id)
          .eq("organization_id", req.user.organizationId),
      ),
    );

    res.json({
      success: true,
      message: `${toUpdate.length} case(s) updated.${
        notFound.length ? ` ${notFound.length} case number(s) not found.` : ""
      }`,
      data: {
        updatedCount: toUpdate.length,
        notFound,
      },
    });
  } catch (err) {
    console.error("bulkUpdateServiceCaseProfiles error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// NEW: Employee self-submit — the "Today's Allocation"/"Past
// Allocation" table on the Profile page now lists individual cases
// (case-number wise, like the admin Cases tab) instead of quantity
// batches. Since a case is one atomic unit of work, submitting it is
// a single click — no partial quantity or mismatch-reason step like
// the old daily_work batch flow needed.
//
// Requires four columns on service_cases (see migration note):
//   submission_status  text, default 'PENDING' ('PENDING' | 'SUBMITTED')
//   submission_type    text ('COMPLETED' | 'DONE_BY_TEAM' | 'QUERY')
//   query_text         text, nullable
//   submitted_at       timestamptz, nullable
// ------------------------------------------------------------

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/submit
// body: { submissionType: 'COMPLETED' | 'DONE_BY_TEAM' | 'QUERY', queryText?: string }
//
// Every submission records an outcome, not just "submitted":
//   'COMPLETED'    — completed (by the employee themself).
//   'DONE_BY_TEAM' — completed, but by the team rather than the
//                    employee directly. Kept separate from 'COMPLETED'.
//   'QUERY'        — couldn't be completed as-is; queryText carries
//                    what the query actually is (required in this case).
// ------------------------------------------------------------
async function submitServiceCase(req, res) {
  try {
    const { id } = req.params;
    const submissionType = (req.body.submissionType || "").toString().trim();
    const queryText = (req.body.queryText || "").toString().trim();

    if (!["COMPLETED", "DONE_BY_TEAM", "QUERY"].includes(submissionType)) {
      return res.status(400).json({
        success: false,
        message:
          "submissionType must be 'COMPLETED', 'DONE_BY_TEAM' or 'QUERY'.",
      });
    }
    if (submissionType === "QUERY" && !queryText) {
      return res.status(400).json({
        success: false,
        message: "queryText is required when submissionType is 'QUERY'.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        submission_status: "SUBMITTED",
        submission_type: submissionType,
        query_text: submissionType === "QUERY" ? queryText : null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      // Self-service — can only ever submit a case assigned to you,
      // regardless of what id is in the URL.
      .eq("assigned_employee_id", req.user.userId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Case not found or not assigned to you.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} submitted.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        submissionStatus: data.submission_status,
        submissionType: data.submission_type,
        queryText: data.query_text,
        submittedAt: data.submitted_at,
      },
    });
  } catch (err) {
    console.error("submitServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/bulk-submit
// body: { items: [{ id, submissionType, queryText }, ...] }
// Same as above but for many cases at once — the "Bulk Submit" button
// on the Profile page. Each case picks its own outcome (every row in
// the modal has its own dropdown), so this takes an items array rather
// than a flat list of ids.
// ------------------------------------------------------------
async function bulkSubmitServiceCases(req, res) {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const cleaned = items
      .map((it) => ({
        id: (it.id || "").toString(),
        submissionType: (it.submissionType || "").toString().trim(),
        queryText: (it.queryText || "").toString().trim(),
      }))
      .filter((it) => it.id);

    if (cleaned.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No cases provided." });
    }
    for (const it of cleaned) {
      if (!["COMPLETED", "DONE_BY_TEAM", "QUERY"].includes(it.submissionType)) {
        return res.status(400).json({
          success: false,
          message:
            "Every case needs a status of 'Completed', 'Done by Team' or 'Query'.",
        });
      }
      if (it.submissionType === "QUERY" && !it.queryText) {
        return res.status(400).json({
          success: false,
          message: "Every case marked 'Query' needs its query text filled in.",
        });
      }
    }

    const now = new Date().toISOString();
    let submittedCount = 0;
    // One update per case since each can have a different outcome —
    // still all scoped to (org, caller) so this can only ever touch
    // the caller's own cases, same guarantee as the single-submit path.
    await Promise.all(
      cleaned.map(async (it) => {
        const { data, error } = await supabase
          .from("service_cases")
          .update({
            submission_status: "SUBMITTED",
            submission_type: it.submissionType,
            query_text: it.submissionType === "QUERY" ? it.queryText : null,
            submitted_at: now,
          })
          .eq("id", it.id)
          .eq("organization_id", req.user.organizationId)
          .eq("assigned_employee_id", req.user.userId)
          .select("id");
        if (error) throw error;
        if (data && data.length > 0) submittedCount++;
      }),
    );

    res.json({
      success: true,
      message: `${submittedCount} case(s) submitted.`,
      data: { submittedCount },
    });
  } catch (err) {
    console.error("bulkSubmitServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listServiceCases,
  createServiceCases,
  deleteServiceCase,
  allocateServiceCase,
  autoAllocateServiceCases,
  updateServiceCaseProfile,
  bulkUpdateServiceCaseProfiles,
  submitServiceCase,
  bulkSubmitServiceCases,
};
