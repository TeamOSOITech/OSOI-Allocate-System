// src/modules/qcaudit/qcaudit.controller.js
//
// QC + Audit workflow, built on top of the existing `service_cases`
// table (same table servicecases.controller.js writes to) — this is a
// deliberately separate module rather than adding more functions to
// the already-large servicecases.controller.js.
//
// Flow this implements:
//
//   Employee submits case        (service_cases.submission_status = 'SUBMITTED')
//           |
//   Vertical Head assigns to a   (qc_status = 'QC_PENDING', qc_employee_id set)
//   QC-team member                       |
//           |                    QC person records PASS/FAIL + notes
//           v                    (qc_status = 'QC_PASS' / 'QC_FAIL', qc_notes)
//   [only QC_PASS cases can go to audit]
//           |
//   Audit Manager manually       (audit_status = 'AUDIT_PENDING', audit_employee_id set)
//   picks a case + an auditor            |
//           |                    Auditor records PASS/FAIL + notes
//           v                    (audit_status = 'AUDIT_PASS' / 'AUDIT_FAIL', audit_notes)
//
// Per business decision (not every QC_PASS case is audited — Audit
// Manager hand-picks which ones), and a FAIL at either stage is simply
// recorded with notes and the case is considered closed — it does NOT
// automatically go back into allocation for rework. (If that's wanted
// later, it's a small change: reset allocation_status/submission_status
// on FAIL instead of leaving them as-is.)
//
// "QC team" = any user with a row in qc_assignments for this org (the
// existing QC_PERMISSION_GRANT approval flow already writes to this
// table — see approvals.controller.js). No new role was added for QC,
// per the spec doc's note that a dedicated pool might be needed instead
// of overloading an existing role.
//
// Auditors are simply any user with the AUDIT_MANAGER role — that role
// already exists in full for this purpose, no new role/table needed.

const supabase = require("../../config/supabaseClient");
const { hasPermission } = require("../../config/permissions");

// ---------- shared name-lookup helper (same pattern/columns as
// servicecases.controller.js's getEmployeeNameMap — user_master's join
// key is the quoted, spaced "Auth User Id" column, and display name is
// built from "First Name" + "Last Name", not a single "Name" column) ----------
async function getUserNameMap(userIds, organizationId) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name"')
    .eq("organization_id", organizationId)
    .in("Auth User Id", uniqueIds);
  if (error) {
    console.error("Failed to fetch user_master for QC/Audit:", error);
    return {};
  }
  return (data || []).reduce((acc, u) => {
    const firstName = u["First Name"] ?? "";
    const lastName = u["Last Name"] ?? "";
    acc[u["Auth User Id"]] = `${firstName} ${lastName}`.trim() || null;
    return acc;
  }, {});
}

// Same idea for service (product_master) and client names, so the
// queue tables can show readable names instead of raw ids.
async function getProductNameMap(productIds, organizationId) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) {
    console.error("Failed to fetch service_master for QC/Audit:", error);
    return {};
  }
  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

async function getClientNameMap(clientIds, organizationId) {
  const uniqueIds = [...new Set(clientIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) {
    console.error("Failed to fetch clients for QC/Audit:", error);
    return {};
  }
  return (data || []).reduce((acc, c) => {
    acc[c.id] = c.name;
    return acc;
  }, {});
}

function mapCaseRow(row, userNameMap, productNameMap, clientNameMap) {
  return {
    id: row.id,
    caseNumber: row.case_number,
    workDate: row.work_date,
    productId: row.product_id,
    productName: productNameMap[row.product_id] || null,
    clientId: row.client_id != null ? String(row.client_id) : null,
    clientName: row.client_id ? clientNameMap[row.client_id] || null : null,
    subclientId: row.subclient_id != null ? String(row.subclient_id) : null,
    assignedEmployeeId: row.assigned_employee_id,
    assignedEmployeeName: row.assigned_employee_id
      ? userNameMap[row.assigned_employee_id] || null
      : null,
    submissionStatus: row.submission_status,
    submittedAt: row.submitted_at,
    qcStatus: row.qc_status,
    qcEmployeeId: row.qc_employee_id,
    qcEmployeeName: row.qc_employee_id
      ? userNameMap[row.qc_employee_id] || null
      : null,
    qcReviewedAt: row.qc_reviewed_at,
    qcNotes: row.qc_notes,
    qcMarks: row.qc_marks,
    auditStatus: row.audit_status,
    auditEmployeeId: row.audit_employee_id,
    auditEmployeeName: row.audit_employee_id
      ? userNameMap[row.audit_employee_id] || null
      : null,
    auditReviewedAt: row.audit_reviewed_at,
    auditNotes: row.audit_notes,
    auditMarks: row.audit_marks,
  };
}

// ------------------------------------------------------------
// GET /api/qc-audit/qc-team
// Employees eligible to be assigned as a QC reviewer — anyone with a
// row in qc_assignments for this org (granted via the existing
// QC_PERMISSION_GRANT approval flow).
// ------------------------------------------------------------
async function listQcTeam(req, res) {
  try {
    const { data: assignments, error: assignErr } = await supabase
      .from("qc_assignments")
      .select("user_id")
      .eq("organization_id", req.user.organizationId);
    if (assignErr) throw assignErr;

    const userIds = [...new Set((assignments || []).map((a) => a.user_id))];
    if (userIds.length === 0) return res.json({ success: true, data: [] });

    const { data: users, error: userErr } = await supabase
      .from("user_master")
      .select('"Auth User Id", "First Name", "Last Name"')
      .eq("organization_id", req.user.organizationId)
      .in("Auth User Id", userIds);
    if (userErr) throw userErr;

    res.json({
      success: true,
      data: (users || []).map((u) => ({
        id: u["Auth User Id"],
        name: `${u["First Name"] ?? ""} ${u["Last Name"] ?? ""}`.trim(),
      })),
    });
  } catch (err) {
    console.error("listQcTeam error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/qc-audit/audit-managers
// Employees eligible to be assigned as an auditor — anyone holding the
// AUDIT_MANAGER role in this org. AUDIT_MANAGER already exists as a
// full role, so no separate membership table is needed here (unlike QC
// above, which has no dedicated role).
// ------------------------------------------------------------
async function listAuditManagers(req, res) {
  try {
    const { data: users, error } = await supabase
      .from("user_master")
      .select('"Auth User Id", "First Name", "Last Name"')
      .eq("organization_id", req.user.organizationId)
      .eq("Role", "AUDIT_MANAGER");
    if (error) throw error;

    res.json({
      success: true,
      data: (users || []).map((u) => ({
        id: u["Auth User Id"],
        name: `${u["First Name"] ?? ""} ${u["Last Name"] ?? ""}`.trim(),
      })),
    });
  } catch (err) {
    console.error("listAuditManagers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/qc-audit/qc-queue
// Every case the employee has submitted (submission_status='SUBMITTED')
// for this org — regardless of qc_status — so one table shows both
// "not yet sent to QC" (qc_status null, needs Assign action) and
// "waiting on QC person X" (qc_status='QC_PENDING') and already-decided
// ones, same pagination shape as listServiceCases.
// ------------------------------------------------------------
// ------------------------------------------------------------
// GET /api/qc-audit/summary
// Aggregate counts for the Quality Manager Dashboard — how many cases
// are sitting at each stage, org-wide. Cheap count-only queries
// (head: true), not the full paginated rows the queue tables use.
// ------------------------------------------------------------
async function getSummary(req, res) {
  try {
    const orgId = req.user.organizationId;
    const countWhere = async (col, val, extra) => {
      let q = supabase
        .from("service_cases")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId);
      q = val === null ? q.is(col, null) : q.eq(col, val);
      if (extra) q = extra(q);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    };

    const [
      submittedTotal,
      qcPendingNull,
      qcPendingAssigned,
      qcPass,
      qcFail,
      auditPending,
      auditPass,
      auditFail,
    ] = await Promise.all([
      countWhere("submission_status", "SUBMITTED"),
      supabase
        .from("service_cases")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("submission_status", "SUBMITTED")
        .is("qc_status", null)
        .then((r) => {
          if (r.error) throw r.error;
          return r.count || 0;
        }),
      countWhere("qc_status", "PENDING"),
      countWhere("qc_status", "PASSED"),
      countWhere("qc_status", "FAILED"),
      countWhere("audit_status", "AUDIT_PENDING"),
      countWhere("audit_status", "AUDIT_PASS"),
      countWhere("audit_status", "AUDIT_FAIL"),
    ]);

    // Average marks, computed client-side from the small set of
    // decided rows (org-wide QC/Audit volume is not expected to be
    // huge enough to need a DB-side aggregate for this).
    const { data: qcMarksRows, error: qcMarksErr } = await supabase
      .from("service_cases")
      .select("qc_marks")
      .eq("organization_id", orgId)
      .not("qc_marks", "is", null);
    if (qcMarksErr) throw qcMarksErr;
    const { data: auditMarksRows, error: auditMarksErr } = await supabase
      .from("service_cases")
      .select("audit_marks")
      .eq("organization_id", orgId)
      .not("audit_marks", "is", null);
    if (auditMarksErr) throw auditMarksErr;

    const avg = (rows, key) =>
      rows.length
        ? Math.round(
            (rows.reduce((s, r) => s + Number(r[key] || 0), 0) / rows.length) *
              10,
          ) / 10
        : null;

    res.json({
      success: true,
      data: {
        submittedTotal,
        qcNotSent: qcPendingNull,
        qcPending: qcPendingAssigned,
        qcPass,
        qcFail,
        qcAvgMarks: avg(qcMarksRows || [], "qc_marks"),
        auditPending,
        auditPass,
        auditFail,
        auditAvgMarks: avg(auditMarksRows || [], "audit_marks"),
      },
    });
  } catch (err) {
    console.error("getSummary error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listQcQueue(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      100,
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("service_cases")
      .select("*", { count: "exact" })
      .eq("organization_id", req.user.organizationId)
      .eq("submission_status", "SUBMITTED");

    // SECURITY FIX: this endpoint used to return the FULL org-wide QC
    // queue to anyone merely logged in — including qc_notes/remarks
    // written about other employees' work, visible to a plain Team
    // Member who has never been granted any QC role. Only someone
    // eligible to actually MANAGE the queue (Vertical Head, Process
    // Lead, or a QC-team member — the same eligibility assignQc already
    // enforces) gets the full picture; everyone else only sees cases
    // specifically assigned to THEM, which is empty unless they're the
    // assigned QC reviewer on something.
    if (!(await canAssignQc(req))) {
      query = query.eq("qc_employee_id", req.user.userId);
    }

    // Optional: "pending" view = not yet decided (null/QC_PENDING),
    // vs "all" = everything ever submitted. Defaults to pending-only
    // so the queue doesn't fill up with old resolved cases forever.
    if (req.query.status === "pending") {
      query = query.or("qc_status.is.null,qc_status.eq.QC_PENDING");
    } else if (req.query.status) {
      query = query.eq("qc_status", req.query.status);
    }

    const { data, error, count } = await query
      .order("submitted_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const userIds = [];
    const productIds = [];
    const clientIds = [];
    (data || []).forEach((r) => {
      if (r.assigned_employee_id) userIds.push(r.assigned_employee_id);
      if (r.qc_employee_id) userIds.push(r.qc_employee_id);
      if (r.product_id) productIds.push(r.product_id);
      if (r.client_id) clientIds.push(r.client_id);
    });
    const [userNameMap, productNameMap, clientNameMap] = await Promise.all([
      getUserNameMap(userIds, req.user.organizationId),
      getProductNameMap(productIds, req.user.organizationId),
      getClientNameMap(clientIds, req.user.organizationId),
    ]);

    res.json({
      success: true,
      data: (data || []).map((r) =>
        mapCaseRow(r, userNameMap, productNameMap, clientNameMap),
      ),
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / pageSize), 1),
      },
    });
  } catch (err) {
    console.error("listQcQueue error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/qc-audit/:id/qc-assign
// body: { qcEmployeeId }
// Vertical Head (tasks.qc_allocate.team) pushes a submitted case into
// the QC queue by picking a QC-team member. Only works on a case that
// hasn't already been assigned/decided (qc_status must currently be
// null) — re-assigning a decided case needs a deliberate separate
// action, not this endpoint, to avoid accidentally overwriting a
// PASS/FAIL someone already recorded.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Who is allowed to push a submitted case into the QC queue —
// Vertical Head or Process Lead (both hold tasks.qc_allocate.team), OR
// a QC-team member themselves (a row in qc_assignments — could be any
// base role, since QC permission is granted per-person, not tied to a
// role). A plain Team Member with no QC grant is never eligible.
// ------------------------------------------------------------
async function canAssignQc(req) {
  if (hasPermission(req.user.role, "tasks.qc_allocate.team")) return true;
  const { data, error } = await supabase
    .from("qc_assignments")
    .select("id")
    .eq("organization_id", req.user.organizationId)
    .eq("user_id", req.user.userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function assignQc(req, res) {
  try {
    const { id } = req.params;
    const { qcEmployeeId } = req.body;
    if (!qcEmployeeId) {
      return res
        .status(400)
        .json({ success: false, message: "qcEmployeeId is required" });
    }

    if (!(await canAssignQc(req))) {
      return res.status(403).json({
        success: false,
        message:
          "Only a QC-team member, Vertical Head, or Process Lead can assign cases to QC.",
      });
    }

    // Confirm this person is actually on the QC team for this org.
    const { data: membership, error: memErr } = await supabase
      .from("qc_assignments")
      .select("id")
      .eq("organization_id", req.user.organizationId)
      .eq("user_id", qcEmployeeId)
      .limit(1)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) {
      return res.status(400).json({
        success: false,
        message: "Selected employee is not on the QC team",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ qc_status: "QC_PENDING", qc_employee_id: qcEmployeeId })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .eq("submission_status", "SUBMITTED")
      .is("qc_status", null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(409).json({
        success: false,
        message:
          "Case not found, not yet submitted by the employee, or already sent to QC.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} sent to QC.`,
      data: { id: data.id, qcStatus: data.qc_status },
    });
  } catch (err) {
    console.error("assignQc error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/qc-audit/:id/qc-result
// body: { result: 'PASS' | 'FAIL', notes }
// Recorded by whoever the case was assigned to (self-action, same
// pattern as the employee's own submitServiceCase), OR a Vertical Head
// (tasks.qc_allocate.team) as an override — e.g. covering for someone
// on leave. Route-level middleware only checks "is logged in"; the
// self-or-override check happens here since it depends on both the
// caller AND the specific case's qc_employee_id.
// ------------------------------------------------------------
async function recordQcResult(req, res) {
  try {
    const { id } = req.params;
    const result = (req.body.result || "").toString().trim().toUpperCase();
    const notes = (req.body.notes || "").toString().trim();
    // NEW: 0-100 numeric rating recorded alongside PASS/FAIL — same
    // scale as the existing standalone Quality Scores page. Optional:
    // some orgs may only want a Pass/Fail without a number.
    const marksRaw = req.body.marks;
    let marks = null;
    if (marksRaw !== undefined && marksRaw !== null && marksRaw !== "") {
      marks = Number(marksRaw);
      if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
        return res.status(400).json({
          success: false,
          message: "marks must be a number between 0 and 100",
        });
      }
    }

    if (!["PASS", "FAIL"].includes(result)) {
      return res
        .status(400)
        .json({ success: false, message: "result must be 'PASS' or 'FAIL'" });
    }

    const isOverride = hasPermission(req.user.role, "tasks.qc_allocate.team");

    let query = supabase
      .from("service_cases")
      .select("id, case_number, qc_employee_id, qc_status")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    const { data: existing, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }
    if (existing.qc_status !== "QC_PENDING") {
      return res.status(409).json({
        success: false,
        message: "This case is not currently waiting on a QC decision.",
      });
    }
    if (existing.qc_employee_id !== req.user.userId && !isOverride) {
      return res.status(403).json({
        success: false,
        message: "This case is assigned to a different QC reviewer.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        qc_status: result === "PASS" ? "QC_PASS" : "QC_FAIL",
        qc_notes: notes || null,
        qc_marks: marks,
        qc_reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;

    res.json({
      success: true,
      message: `${data.case_number} marked QC ${result}.`,
      data: {
        id: data.id,
        qcStatus: data.qc_status,
        qcNotes: data.qc_notes,
        qcMarks: data.qc_marks,
      },
    });
  } catch (err) {
    console.error("recordQcResult error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/qc-audit/audit-queue
// Every case that passed QC (qc_status='QC_PASS') for this org —
// regardless of audit_status — so one table shows the whole pool: cases
// not yet picked for audit (audit_status null, Audit Manager can Assign
// them), cases picked and waiting on an auditor (AUDIT_PENDING), and
// already-decided ones.
// ------------------------------------------------------------
async function listAuditQueue(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      100,
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("service_cases")
      .select("*", { count: "exact" })
      .eq("organization_id", req.user.organizationId)
      // FIX: this was checking qc_status = 'QC_PASS', but the
      // service_cases_qc_status_check constraint in Supabase only
      // allows 'PENDING' / 'PASSED' / 'FAILED' — so a case marked
      // Passed on the Quality Check page (qc_status = 'PASSED') was
      // never matching this filter and could never reach the Audit
      // Queue. Confirmed via `pg_get_constraintdef` on the constraint.
      .eq("qc_status", "PASSED");

    if (req.query.status === "pending") {
      query = query.or("audit_status.is.null,audit_status.eq.AUDIT_PENDING");
    } else if (req.query.status) {
      query = query.eq("audit_status", req.query.status);
    }

    const { data, error, count } = await query
      .order("qc_reviewed_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const userIds = [];
    const productIds = [];
    const clientIds = [];
    (data || []).forEach((r) => {
      if (r.assigned_employee_id) userIds.push(r.assigned_employee_id);
      if (r.qc_employee_id) userIds.push(r.qc_employee_id);
      if (r.audit_employee_id) userIds.push(r.audit_employee_id);
      if (r.product_id) productIds.push(r.product_id);
      if (r.client_id) clientIds.push(r.client_id);
    });
    const [userNameMap, productNameMap, clientNameMap] = await Promise.all([
      getUserNameMap(userIds, req.user.organizationId),
      getProductNameMap(productIds, req.user.organizationId),
      getClientNameMap(clientIds, req.user.organizationId),
    ]);

    res.json({
      success: true,
      data: (data || []).map((r) =>
        mapCaseRow(r, userNameMap, productNameMap, clientNameMap),
      ),
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / pageSize), 1),
      },
    });
  } catch (err) {
    console.error("listAuditQueue error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/qc-audit/:id/audit-assign
// body: { auditEmployeeId }
// Audit Manager (qc.oversee / qc.assignments.modify) hand-picks a
// QC_PASS case and assigns it to an auditor — this IS the sampling
// step (manual pick, not automatic %, per business decision).
// ------------------------------------------------------------
async function assignAudit(req, res) {
  try {
    const { id } = req.params;
    const { auditEmployeeId } = req.body;
    if (!auditEmployeeId) {
      return res
        .status(400)
        .json({ success: false, message: "auditEmployeeId is required" });
    }

    const { data: auditor, error: auditorErr } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("Auth User Id", auditEmployeeId)
      .eq("organization_id", req.user.organizationId)
      .eq("Role", "AUDIT_MANAGER")
      .maybeSingle();
    if (auditorErr) throw auditorErr;
    if (!auditor) {
      return res.status(400).json({
        success: false,
        message: "Selected employee does not hold the Audit Manager role",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        audit_status: "AUDIT_PENDING",
        audit_employee_id: auditEmployeeId,
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .eq("qc_status", "QC_PASS")
      .is("audit_status", null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(409).json({
        success: false,
        message:
          "Case not found, did not pass QC, or has already been picked for audit.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} sent for audit.`,
      data: { id: data.id, auditStatus: data.audit_status },
    });
  } catch (err) {
    console.error("assignAudit error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/qc-audit/:id/audit-result
// body: { result: 'PASS' | 'FAIL', notes }
// Any Audit Manager (qc.oversee / qc.assignments.modify) can record the
// result — not restricted to only the specific auditor it was assigned
// to, since Audit Manager is a small, trusted management-level pool
// (unlike QC, which is a bigger team where self-only makes more sense).
// ------------------------------------------------------------
async function recordAuditResult(req, res) {
  try {
    const { id } = req.params;
    const result = (req.body.result || "").toString().trim().toUpperCase();
    const notes = (req.body.notes || "").toString().trim();
    const marksRaw = req.body.marks;
    let marks = null;
    if (marksRaw !== undefined && marksRaw !== null && marksRaw !== "") {
      marks = Number(marksRaw);
      if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
        return res.status(400).json({
          success: false,
          message: "marks must be a number between 0 and 100",
        });
      }
    }

    if (!["PASS", "FAIL"].includes(result)) {
      return res
        .status(400)
        .json({ success: false, message: "result must be 'PASS' or 'FAIL'" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("service_cases")
      .select("id, case_number, audit_status")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }
    if (existing.audit_status !== "AUDIT_PENDING") {
      return res.status(409).json({
        success: false,
        message: "This case is not currently waiting on an audit decision.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        audit_status: result === "PASS" ? "AUDIT_PASS" : "AUDIT_FAIL",
        audit_notes: notes || null,
        audit_marks: marks,
        audit_reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;

    res.json({
      success: true,
      message: `${data.case_number} marked Audit ${result}.`,
      data: {
        id: data.id,
        auditStatus: data.audit_status,
        auditNotes: data.audit_notes,
        auditMarks: data.audit_marks,
      },
    });
  } catch (err) {
    console.error("recordAuditResult error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listQcTeam,
  listAuditManagers,
  listQcQueue,
  assignQc,
  recordQcResult,
  listAuditQueue,
  assignAudit,
  recordAuditResult,
  getSummary,
};
