const fs = require("fs");
const xlsx = require("xlsx");
const productService = require("./products.service");
const supabase = require("../../config/supabaseClient");
const { getAllTeams } = require("../teams/teams.service");

// APPROVAL: merges any PENDING SERVICE_* approval requests into the
// normal product list so the person who just submitted one sees it right
// away, badge and all, instead of the list looking like nothing
// happened until an Ops Manager approves it (which could be hours/days
// later). Two shapes get merged in:
//   - SERVICE_CREATE: no real row exists yet — synthesize a placeholder
//     product from the request's payload, id prefixed "pending-" so the
//     frontend can tell it apart from a real numeric id and disable
//     edit/delete on it.
//   - SERVICE_UPDATE / SERVICE_DELETE: the real row already exists —
//     just stamp `approvalStatus` onto it so the UI can show a badge
//     without changing what's actually displayed underneath.
async function attachPendingApprovals(products, organizationId) {
  const { data: pending } = await supabase
    .from("approval_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "PENDING")
    .in("type", ["SERVICE_CREATE", "SERVICE_UPDATE", "SERVICE_DELETE"]);

  if (!pending || pending.length === 0) return products;

  const updateOrDeleteById = new Map();
  const pendingCreates = [];

  for (const req of pending) {
    if (req.type === "SERVICE_CREATE") {
      pendingCreates.push(req);
    } else {
      // SERVICE_UPDATE / SERVICE_DELETE — payload.id is the real product id.
      updateOrDeleteById.set(String(req.payload?.id), req.type);
    }
  }

  const withBadges = products.map((p) => {
    const pendingType = updateOrDeleteById.get(String(p.id));
    if (!pendingType) return p;
    return {
      ...p,
      approvalStatus:
        pendingType === "SERVICE_UPDATE" ? "PENDING_UPDATE" : "PENDING_DELETE",
    };
  });

  const placeholders = pendingCreates.map((req) => ({
    id: `pending-${req.id}`,
    product_name: req.payload?.product_name || "(untitled)",
    time_taken: req.payload?.time_taken ?? null,
    time_unit: req.payload?.time_unit ?? null,
    teams: req.payload?.teams || [],
    hidden: false,
    approvalStatus: "PENDING_CREATE",
    approvalRequestId: req.id,
  }));

  return [...placeholders, ...withBadges];
}

// NEW: Vertical Head only sees the service(s) their OWN team is linked
// to (product_master's `teams` array) — same "own team, not the whole
// org" scope Vertical Head holds everywhere else. Looks up their own
// Team once from user_master; a service is "theirs" if their team name
// appears (case-insensitively) in that service's `teams` list. Every
// other role is unaffected — full catalog as before.
async function scopeProductsForVerticalHead(products, req) {
  if (req.user.role !== "VERTICAL_HEAD") return products;

  const { data: self } = await supabase
    .from("user_master")
    .select('"Worked In Teams"')
    .eq("Auth User Id", req.user.userId)
    .eq("organization_id", req.user.organizationId)
    .maybeSingle();

  const ownTeam = (self?.["Worked In Teams"] || "").trim().toLowerCase();
  if (!ownTeam) return [];

  return products.filter((p) =>
    (p.teams || []).some((t) => (t || "").trim().toLowerCase() === ownTeam),
  );
}

const getAllProducts = async (req, res) => {
  try {
    const products = await productService.getAllProducts(
      req.user.organizationId,
    );
    const withPending = await attachPendingApprovals(
      products,
      req.user.organizationId,
    );
    const scoped = await scopeProductsForVerticalHead(withPending, req);
    return res.status(200).json({ success: true, data: scoped });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productService.getProductById(
      id,
      req.user.organizationId,
    );

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// REVERSED MAPPING: a Product is now a standalone catalog entry — it no
// longer takes `client` / `subclient` at creation time. Instead, Clients
// and Subclients pick which existing Products they use (see
// modules/clients/clients.routes.js and subclients.routes.js).
//
// `teams` (array of team names, e.g. ["Tech", "SD"]) is optional and just
// tags the service — no validation beyond making sure it's an array if
// present, since the dropdown on the frontend already constrains values
// to real team names.
const createProduct = async (req, res) => {
  try {
    const { product_name, time_taken, time_unit, teams } = req.body;

    if (!product_name) {
      return res
        .status(400)
        .json({ success: false, message: "product_name is required" });
    }

    if (!time_unit || !["minutes", "hours"].includes(time_unit)) {
      return res.status(400).json({
        success: false,
        message: "time_unit is required and must be 'minutes' or 'hours'",
      });
    }

    if (teams !== undefined && !Array.isArray(teams)) {
      return res
        .status(400)
        .json({ success: false, message: "teams must be an array" });
    }

    const product = await productService.createProduct(
      { product_name, time_taken, time_unit, teams },
      req.user.organizationId,
    );

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Extracts { value, unit } from strings like "2 hours", "1.5 hrs", "30 mins".
// Bare numbers default to "minutes".
const parseTimeTaken = (raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return { value: null, unit: null };
  }

  if (typeof raw === "number") {
    return { value: raw, unit: "minutes" };
  }

  const str = raw.toString().trim().toLowerCase();
  const match = str.match(/[\d.]+/);
  if (!match) return { value: null, unit: null };

  const value = parseFloat(match[0]);
  if (isNaN(value)) return { value: null, unit: null };

  if (str.includes("hr") || str.includes("hour")) {
    return { value, unit: "hours" };
  }
  return { value, unit: "minutes" };
};

// Bulk upload sheet no longer needs Client / Subclient columns — a product
// is standalone. "Service Name" and "Time Taken" are required; "Teams" is
// an optional, comma-separated column (e.g. "Tech, SD") so a service can
// be assigned to multiple teams straight from the sheet instead of every
// bulk-created service starting with an empty teams list that had to be
// tagged manually afterwards from Edit.
//
// NOTE: bulk upload is NOT approval-gated — it's intentionally not routed
// through approvalGate() in products.routes.js, so it always creates
// directly regardless of the caller's role.
const bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const orgId = req.user.organizationId;

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    fs.unlink(req.file.path, () => {});

    if (!rows.length) {
      return res
        .status(400)
        .json({ success: false, message: "Excel file is empty" });
    }

    // Load this org's known teams ONCE up front — reuses getAllTeams()
    // directly so this list is IDENTICAL to what the Add/Edit Service
    // form's Teams multi-select shows (curated `teams` table rows PLUS
    // any team name already in use on an employee's "Worked In Teams"
    // field — see teams.service.js). Querying the `teams` table alone
    // here used to accept fewer names than the dropdown actually offers.
    const orgTeams = await getAllTeams(orgId);

    const teamNameByLower = new Map(
      (orgTeams || []).map((t) => [
        String(t.name || "")
          .trim()
          .toLowerCase(),
        t.name,
      ]),
    );

    // Splits a "Teams" cell like "Tech, SD" into ["Tech","SD"], validates
    // every piece against teamNameByLower, and returns either the
    // resolved (correctly-cased) team names or a list of anything not
    // recognized so the caller can fail that row with a clear reason.
    function resolveTeamsCell(raw) {
      const trimmed = (raw || "").toString().trim();
      if (!trimmed) return { teams: [], unknown: [] };

      const pieces = trimmed
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean);

      const teams = [];
      const unknown = [];
      for (const piece of pieces) {
        const match = teamNameByLower.get(piece.toLowerCase());
        if (match) teams.push(match);
        else unknown.push(piece);
      }
      return { teams, unknown };
    }

    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    // Process one row at a time so a single bad row doesn't sink the
    // whole batch, and so we can report exactly which row failed and why.
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2; // +2 accounts for header row + 1-indexing

      // FIX: sample-sheet template (frontend's handleDownloadTemplate,
      // PRODUCT_NAME_COLUMN) generates the column as "Service Name" — this
      // was reading "Product Name" instead, a header that never existed in
      // the actual uploaded sheet, so every single row failed with
      // "Missing Product Name" no matter what was in the file.
      const product_name = row["Service Name"]?.toString().trim() || null;
      const { value: time_taken, unit: time_unit } = parseTimeTaken(
        row["Time Taken"],
      );

      const identifier = product_name || `Row ${rowNumber}`;

      if (!product_name) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: "Missing Service Name",
        });
        failedCount++;
        continue;
      }

      if (time_taken === null || !time_unit) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `Could not parse "Time Taken" value: "${row["Time Taken"]}"`,
        });
        failedCount++;
        continue;
      }

      // NEW: optional Teams column — "Tech, SD" etc. Every team named
      // must already exist for this org (same rule as the employee bulk
      // upload's Teams check); an unrecognized team fails the row rather
      // than silently being dropped or auto-created.
      const { teams, unknown: unknownTeams } = resolveTeamsCell(row["Teams"]);
      if (unknownTeams.length > 0) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `Team(s) not listed: ${unknownTeams.join(", ")}`,
        });
        failedCount++;
        continue;
      }

      try {
        await productService.createProduct(
          { product_name, time_taken, time_unit, teams },
          orgId,
        );
        results.push({ identifier, row: rowNumber, success: true });
        createdCount++;
      } catch (err) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: err.message,
        });
        failedCount++;
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        totalRows: rows.length,
        createdCount,
        failedCount,
        results,
      },
    });
  } catch (error) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, time_taken, time_unit, teams } = req.body;

    if (time_unit && !["minutes", "hours"].includes(time_unit)) {
      return res.status(400).json({
        success: false,
        message: "time_unit must be 'minutes' or 'hours'",
      });
    }

    if (teams !== undefined && !Array.isArray(teams)) {
      return res
        .status(400)
        .json({ success: false, message: "teams must be an array" });
    }

    const product = await productService.updateProduct(
      id,
      { product_name, time_taken, time_unit, teams },
      req.user.organizationId,
    );

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productService.deleteProduct(
      id,
      req.user.organizationId,
    );

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    // FIX: deleting a service that already has Daily Work batches
    // logged against it violates the daily_work.product_id foreign
    // key — Postgres was returning that raw constraint error straight
    // to the user ('update or delete on table "service_master"
    // violates foreign key constraint "daily_work_product_id_fkey" on
    // table "daily_work"'). Same pattern as the duplicate-name check
    // in clients.controller.js: catch the FK violation (code 23503)
    // and turn it into a message someone without DB knowledge can
    // actually act on.
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message:
          "This service can't be deleted because it already has Daily Work logged against it. Delete or reassign those entries first.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  bulkUploadProducts,
  updateProduct,
  deleteProduct,
};
