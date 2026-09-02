// src/modules/externalmembers/externalmembers.controller.js
//
// Req/res handling only — see externalmembers.service.js for the actual
// Supabase queries. Every query is scoped to req.user.organizationId,
// same tenant pattern as every other module in this codebase.

const externalMembersService = require("./externalmembers.service");

// ------------------------------------------------------------
// GET /api/external-members?productId=X&workDate=YYYY-MM-DD
// ------------------------------------------------------------
async function listExternalMembers(req, res) {
  try {
    const { productId, workDate } = req.query;
    if (!productId || !workDate) {
      return res.status(400).json({
        success: false,
        message: "productId and workDate query params are required",
      });
    }

    const employeeIds = await externalMembersService.fetchExternalMembers(
      req.user.organizationId,
      productId,
      workDate,
    );

    res.json({ success: true, data: employeeIds });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PUT /api/external-members
// body: { productId, workDate, employeeIds: [...] }
//
// Replaces the whole external-member set for this service+date —
// mirrors the frontend's Set<string> picker, which always has the
// complete list on hand rather than tracking individual add/remove
// diffs.
// ------------------------------------------------------------
async function saveExternalMembers(req, res) {
  try {
    const { productId, workDate, employeeIds } = req.body;
    if (!productId || !workDate || !Array.isArray(employeeIds)) {
      return res.status(400).json({
        success: false,
        message: "productId, workDate and employeeIds[] are required",
      });
    }

    const saved = await externalMembersService.replaceExternalMembers(
      req.user.organizationId,
      productId,
      workDate,
      employeeIds,
    );

    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

module.exports = { listExternalMembers, saveExternalMembers };
