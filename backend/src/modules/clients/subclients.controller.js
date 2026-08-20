// src/modules/clients/subclients.controller.js
//
// Req/res handling + response shaping for the subclients module. All raw
// Supabase/DB access lives in subclients.service.js — this file
// validates input, calls the service, builds the Excel template/upload,
// and shapes responses. Wired up by subclients.routes.js.

const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const subclientsService = require("./subclients.service");

// REVERSED MAPPING: a Subclient now picks which existing Products it uses,
// linked via the subclient_products junction table.
const productsService = require("../products/products.service");

// ---------- brand theme (matches clients.controller.js) ----------
const BRAND = {
  blue: "FF204297", // RGB(32,66,151)
  lightBlue: "FF08A1CE", // RGB(8,161,206)
  green: "FF2EBBA8", // RGB(46,187,168)
  orange: "FFEA580C", // used for the Secondary Contact group
  white: "FFFFFFFF",
};

function styleHeaderCell(cell, colorHex) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: colorHex },
  };
  cell.font = { bold: true, color: { argb: BRAND.white }, size: 11 };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: BRAND.white } },
    left: { style: "thin", color: { argb: BRAND.white } },
    bottom: { style: "thin", color: { argb: BRAND.white } },
    right: { style: "thin", color: { argb: BRAND.white } },
  };
}

// ---------------------------------------------------------------------
// Shared field map — single source of truth for every place that reads or
// writes the "extra" Subclient fields (Country / Website / Main contact /
// Primary contact / Secondary contact), so the DB columns, the Excel
// template, the bulk-upload parser, and the Add/Edit endpoints can never
// drift out of parity with each other (or with clients.controller.js)
// again.
//
// `db`     -> actual Supabase/Postgres column name (snake_case)
// `api`    -> camelCase field name used in JSON request/response bodies
// `header` -> column header text used in the Excel template/upload
// ---------------------------------------------------------------------
const CONTACT_FIELD_MAP = [
  { db: "country", api: "country", header: "Country" },
  { db: "website", api: "website", header: "Website" },
  { db: "main_email", api: "mainEmail", header: "Main Email" },
  { db: "main_phone", api: "mainPhone", header: "Main Phone" },
  {
    db: "primary_contact_name",
    api: "primaryContactName",
    header: "Primary Contact Name",
  },
  {
    db: "primary_contact_email",
    api: "primaryContactEmail",
    header: "Primary Contact Email",
  },
  {
    db: "primary_contact_phone",
    api: "primaryContactPhone",
    header: "Primary Contact Phone",
  },
  {
    db: "secondary_contact_name",
    api: "secondaryContactName",
    header: "Secondary Contact Name",
  },
  {
    db: "secondary_contact_email",
    api: "secondaryContactEmail",
    header: "Secondary Contact Email",
  },
  {
    db: "secondary_contact_phone",
    api: "secondaryContactPhone",
    header: "Secondary Contact Phone",
  },
];

// Builds the { db_column: value } object used for Supabase insert/update,
// pulling from a camelCase request body. Missing/empty values become null
// rather than being omitted, so clearing a field in Edit actually clears it.
function toDbContactFields(body) {
  const out = {};
  for (const f of CONTACT_FIELD_MAP) {
    const val = body[f.api];
    out[f.db] = val === undefined || val === "" ? null : val;
  }
  return out;
}

// Builds the camelCase API fields from a raw Supabase row.
function toApiContactFields(row) {
  const out = {};
  for (const f of CONTACT_FIELD_MAP) {
    out[f.api] = row[f.db] ?? null;
  }
  return out;
}

// ---------- GET /api/subclients ----------

async function listSubclients(req, res) {
  try {
    const orgId = req.user.organizationId;

    const subclients = await subclientsService.getAllSubclients(orgId);
    const clients = await subclientsService.getClientNamesForOrg(orgId);
    const branches = await subclientsService.getBranchesForOrg(orgId);
    const subclientProductLinks =
      await subclientsService.getSubclientProductLinksForOrg(orgId);

    const formatted = subclients.map((subclient) => {
      const products = (subclientProductLinks || [])
        .filter(
          (row) => row.subclient_id === subclient.id && row.service_master,
        )
        .map((row) => ({
          ...row.service_master,
          amount: row.amount,
          currency: row.currency,
        }));

      return {
        id: subclient.id,
        name: subclient.name,
        status: subclient.status,
        clientId: subclient.client_id,
        clientName:
          clients.find((c) => c.id === subclient.client_id)?.name || "",
        branches: branches.filter((b) => b.subclient_id === subclient.id)
          .length,
        users: 0, // placeholder until a users table/relation exists
        // REVERSED MAPPING: products this subclient is linked to, with the
        // per-subclient rate for each.
        products,
        productRates: products.map((p) => ({
          productId: p.id,
          amount: p.amount,
          currency: p.currency,
        })),
        ...toApiContactFields(subclient),
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch subclients" });
  }
}

// ---------- POST /api/subclients ----------
// Body: { name, clientId, status, country, website, mainEmail, mainPhone,
//         primaryContactName, primaryContactEmail, primaryContactPhone,
//         secondaryContactName, secondaryContactEmail, secondaryContactPhone }
async function createSubclient(req, res) {
  try {
    const orgId = req.user.organizationId;
    const { name, clientId, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Subclient name is required" });
    }
    if (!clientId) {
      return res.status(400).json({ message: "Client is required" });
    }

    const ownedClient = await subclientsService.clientBelongsToOrg(
      Number(clientId),
      orgId,
    );
    if (!ownedClient) {
      return res.status(404).json({ message: "Client not found" });
    }

    const subclient = await subclientsService.createSubclient({
      name: name.trim(),
      client_id: Number(clientId),
      status: status === "Inactive" ? "Inactive" : "Active",
      organization_id: orgId,
      ...toDbContactFields(req.body),
    });

    // REVERSED MAPPING: link whichever existing Products were picked in
    // the Add Subclient form — req.body.productRates is
    // [{ productId, amount, currency }].
    let products = [];
    if (Array.isArray(req.body.productRates) && req.body.productRates.length) {
      await productsService.syncSubclientProducts(
        subclient.id,
        req.body.productRates,
        orgId,
      );
      products = await productsService.getProductsForSubclient(
        subclient.id,
        orgId,
      );
    }

    res.status(201).json({
      ...subclient,
      ...toApiContactFields(subclient),
      products,
      productRates: products.map((p) => ({
        productId: p.id,
        amount: p.amount,
        currency: p.currency,
      })),
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to create subclient", detail: err.message });
  }
}

// ---------- Excel template download (styled) ----------
// Column groups mirror clients.controller.js: core identity (blue),
// company info (light blue), primary contact (green), secondary contact
// (orange) — so the Subclient template visually matches the Client
// template while adding the Client Name lookup column that's unique to
// Subclients.

const SUBCLIENT_TEMPLATE_COLUMNS = [
  { header: "Client Name", key: "clientName", width: 24, color: BRAND.blue },
  {
    header: "Subclient Name",
    key: "subclientName",
    width: 24,
    color: BRAND.blue,
  },
  { header: "Country", key: "country", width: 16, color: BRAND.blue },
  {
    header: "Subclient Status",
    key: "subclientStatus",
    width: 16,
    color: BRAND.blue,
  },

  { header: "Website", key: "website", width: 26, color: BRAND.lightBlue },
  { header: "Main Email", key: "mainEmail", width: 26, color: BRAND.lightBlue },
  { header: "Main Phone", key: "mainPhone", width: 18, color: BRAND.lightBlue },

  {
    header: "Primary Contact Name",
    key: "primaryContactName",
    width: 22,
    color: BRAND.green,
  },
  {
    header: "Primary Contact Email",
    key: "primaryContactEmail",
    width: 28,
    color: BRAND.green,
  },
  {
    header: "Primary Contact Phone",
    key: "primaryContactPhone",
    width: 20,
    color: BRAND.green,
  },

  {
    header: "Secondary Contact Name",
    key: "secondaryContactName",
    width: 22,
    color: BRAND.orange,
  },
  {
    header: "Secondary Contact Email",
    key: "secondaryContactEmail",
    width: 28,
    color: BRAND.orange,
  },
  {
    header: "Secondary Contact Phone",
    key: "secondaryContactPhone",
    width: 20,
    color: BRAND.orange,
  },
];

async function downloadTemplate(req, res) {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Subclients");

    sheet.columns = SUBCLIENT_TEMPLATE_COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    SUBCLIENT_TEMPLATE_COLUMNS.forEach((col, idx) =>
      styleHeaderCell(headerRow.getCell(idx + 1), col.color),
    );

    sheet.addRows([
      {
        clientName: "Acme Corp",
        subclientName: "Acme North",
        country: "India",
        subclientStatus: "Active",
        website: "https://acmenorth.com",
        mainEmail: "hello@acmenorth.com",
        mainPhone: "+91 98765 43210",
        primaryContactName: "Ravi Kumar",
        primaryContactEmail: "ravi.kumar@acmenorth.com",
        primaryContactPhone: "+91 98765 43211",
        secondaryContactName: "Priya Singh",
        secondaryContactEmail: "priya.singh@acmenorth.com",
        secondaryContactPhone: "+91 98765 43212",
      },
    ]);

    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=subclient_bulk_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
}

// ---------- Excel bulk upload ----------
// POST /api/subclients/bulk/upload
//
// Response shape (matches the "Bulk Add Users" results list on the
// frontend, and mirrors clients.controller.js): every row in the sheet
// gets ONE entry in `results`, whether it succeeded or failed, so the UI
// can render a full row-by-row list instead of only showing errors.
async function bulkUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const orgId = req.user.organizationId;

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
    });

    if (!rows.length) {
      return res
        .status(400)
        .json({ message: "Uploaded file has no data rows" });
    }

    const clientCache = new Map();

    // Per-row results — pushed exactly once per row, either "created" or
    // "failed" — plus running totals for the created/failed counters shown
    // in the summary line ("X created · Y failed").
    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    const norm = (v) => (v || "").toString().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const clientNameRaw = norm(row["Client Name"]);
      const subNameRaw = norm(row["Subclient Name"]);
      // Best-effort identifier shown in the UI even if the row fails before
      // both names are known to be valid.
      const rowIdentifier =
        clientNameRaw && subNameRaw
          ? `${subNameRaw} (${clientNameRaw})`
          : subNameRaw || clientNameRaw || `Row ${rowNum}`;

      try {
        const clientName = clientNameRaw;
        const subName = subNameRaw;
        const subStatus =
          norm(row["Subclient Status"]) === "Inactive" ? "Inactive" : "Active";

        if (!clientName) {
          failedCount++;
          results.push({
            row: rowNum,
            identifier: rowIdentifier,
            status: "failed",
            message: "Client Name is required",
          });
          continue;
        }
        if (!subName) {
          failedCount++;
          results.push({
            row: rowNum,
            identifier: rowIdentifier,
            status: "failed",
            message: "Subclient Name is required",
          });
          continue;
        }

        // ---- resolve client (must already exist — no auto-create here) ----
        const clientKey = clientName.toLowerCase();
        let client = clientCache.get(clientKey);

        if (!client) {
          const existing = await subclientsService.findClientByName(
            orgId,
            clientName,
          );

          if (!existing) {
            failedCount++;
            results.push({
              row: rowNum,
              identifier: rowIdentifier,
              status: "failed",
              message: `Client "${clientName}" not found. Create the client first.`,
            });
            continue;
          }
          client = existing;
          clientCache.set(clientKey, client);
        }

        // ---- pull the extra contact/company fields straight from the
        // sheet's header text, using the same map that drives the
        // template, so column coverage always stays in sync. ----
        const contactFields = {};
        for (const f of CONTACT_FIELD_MAP) {
          const val = norm(row[f.header]);
          contactFields[f.db] = val === "" ? null : val;
        }

        // ---- resolve/create subclient ----
        const existingSub = await subclientsService.findSubclientByName(
          orgId,
          client.id,
          subName,
        );

        if (!existingSub) {
          await subclientsService.insertSubclientRow({
            name: subName,
            client_id: client.id,
            status: subStatus,
            organization_id: orgId,
            ...contactFields,
          });
        }

        // Row processed without throwing -> counts as "created" for this
        // row, whether the subclient was brand-new or already existed.
        createdCount++;
        results.push({
          row: rowNum,
          identifier: rowIdentifier,
          status: "created",
        });
      } catch (rowErr) {
        console.error(`Row ${rowNum} error:`, rowErr);
        failedCount++;
        results.push({
          row: rowNum,
          identifier: rowIdentifier,
          status: "failed",
          message: rowErr.message || "Unknown error",
        });
      }
    }

    res.status(200).json({
      message: "Bulk upload processed",
      totalRows: rows.length,
      createdCount,
      failedCount,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to process bulk upload" });
  }
}

// ---------- GET /api/subclients/:id ----------
// Single-record fetch, always current — used by the Edit modal so it
// never edits against stale list-state (e.g. right after a product link
// was just added/changed elsewhere).
async function getSubclientById(req, res) {
  try {
    const orgId = req.user.organizationId;
    const id = Number(req.params.id);

    const subclient = await subclientsService.getSubclientById(id, orgId);
    if (!subclient) {
      return res.status(404).json({ message: "Subclient not found" });
    }

    const client = await subclientsService.getClientForSubclient(
      subclient.client_id,
      orgId,
    );
    const branches = await subclientsService.getBranchesForSubclient(id, orgId);
    const products = await productsService.getProductsForSubclient(id, orgId);

    res.json({
      id: subclient.id,
      name: subclient.name,
      status: subclient.status,
      clientId: subclient.client_id,
      clientName: client?.name || "",
      branches: branches?.length || 0,
      users: 0,
      products,
      productRates: products.map((p) => ({
        productId: p.id,
        amount: p.amount,
        currency: p.currency,
      })),
      ...toApiContactFields(subclient),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch subclient" });
  }
}

// ---------- PUT /api/subclients/:id ----------
// Body: { name, clientId, status, country, website, mainEmail, mainPhone,
//         primaryContactName, primaryContactEmail, primaryContactPhone,
//         secondaryContactName, secondaryContactEmail, secondaryContactPhone }
async function updateSubclient(req, res) {
  try {
    const orgId = req.user.organizationId;
    const id = Number(req.params.id);
    const { name, clientId, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Subclient name is required" });
    }
    if (!clientId) {
      return res.status(400).json({ message: "Client is required" });
    }

    // Make sure the (possibly reassigned) client belongs to this org too.
    const ownedClient = await subclientsService.clientBelongsToOrg(
      Number(clientId),
      orgId,
    );
    if (!ownedClient) {
      return res.status(404).json({ message: "Client not found" });
    }

    const subclient = await subclientsService.updateSubclient(id, orgId, {
      name: name.trim(),
      client_id: Number(clientId),
      status: status === "Inactive" ? "Inactive" : "Active",
      ...toDbContactFields(req.body),
    });
    if (!subclient)
      return res.status(404).json({ message: "Subclient not found" });

    // REVERSED MAPPING: only touch product links if productRates was
    // actually sent, so other PUT callers can't accidentally wipe them.
    if (req.body.productRates !== undefined) {
      await productsService.syncSubclientProducts(
        id,
        req.body.productRates,
        orgId,
      );
    }
    const products = await productsService.getProductsForSubclient(id, orgId);

    res.json({
      ...subclient,
      ...toApiContactFields(subclient),
      products,
      productRates: products.map((p) => ({
        productId: p.id,
        amount: p.amount,
        currency: p.currency,
      })),
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to update subclient", detail: err.message });
  }
}

// ---------- DELETE /api/subclients/:id ----------

async function deleteSubclient(req, res) {
  try {
    const orgId = req.user.organizationId;
    const id = Number(req.params.id);

    const exists = await subclientsService.subclientExists(id, orgId);
    if (!exists)
      return res.status(404).json({ message: "Subclient not found" });

    try {
      await subclientsService.deleteSubclient(id, orgId);
    } catch (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          message:
            "Cannot delete this subclient because it still has branches. Delete those first.",
        });
      }
      throw error;
    }

    res.json({ message: "Subclient deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete subclient" });
  }
}

module.exports = {
  listSubclients,
  createSubclient,
  downloadTemplate,
  bulkUpload,
  getSubclientById,
  updateSubclient,
  deleteSubclient,
};
