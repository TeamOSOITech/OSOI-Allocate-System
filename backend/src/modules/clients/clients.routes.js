const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const supabase = require("../../config/supabaseClient");

// MULTI-TENANCY + SECURITY FIX: this file previously had NO auth
// middleware at all — every endpoint below was reachable by anyone,
// logged in or not. `authenticate` also resolves req.user.organizationId,
// which every query below now filters on.
const { authenticate } = require("../../middlewares/auth");

// PERMISSIONS FIX: POST/PUT/DELETE here used to be gated with
// `authorize("SUPER_ADMIN")` — a hardcoded role check that completely
// blocked Process Lead, Ops Manager, and Audit Manager even though
// permissions.js already grants all three the "clients.manage"
// permission. Switched to requireAnyPermission("clients.manage") so the
// route-level gate actually matches the permission matrix. Process Lead
// still doesn't get to act immediately, though — see approvalGate below.
const { requireAnyPermission } = require("../../middlewares/rbac");

// APPROVAL: intercepts Process Lead's create/update/delete here and
// files it as a pending approval instead of letting it reach the route
// handler — see src/middlewares/approvalGate.js and the CLIENT_CREATE /
// CLIENT_UPDATE / CLIENT_DELETE rules in src/config/permissions.js. Ops
// Manager / Audit Manager / Super Admin are unaffected (act immediately).
const { approvalGate } = require("../../middlewares/approvalGate");

// REVERSED MAPPING: Products no longer carry client/subclient on
// themselves — a Client instead picks which existing Products it uses.
// That link lives in the client_products junction table, managed here via
// productsService.syncClientProducts / getProductsForClient.
const productsService = require("../products/products.service");

const upload = multer({ storage: multer.memoryStorage() });

// Require a valid session for every route in this file, and make
// req.user (incl. organizationId) available to every handler below.
router.use(authenticate);

// Prevent browser caching
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- brand theme ----------
const BRAND = {
  blue: "FF204297", // RGB(32,66,151)
  lightBlue: "FF08A1CE", // RGB(8,161,206)
  green: "FF2EBBA8", // RGB(46,187,168)
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

// ---------- helpers: map between frontend (camelCase) <-> db (snake_case) ----------

// APPROVAL: `approvalStatus` (added by attachPendingApprovals below) is
// deliberately spread in here too so the frontend can badge a client
// that has a pending Edit/Delete without touching every call site that
// builds a response.
// FIX: the "branches" table was removed from the database, but this
// still took a branchesCount and echoed it back — every call site had
// to query a table that no longer exists just to satisfy this
// signature, which is what was throwing (querying a dropped table
// returns null, and the old code then called .filter()/.length on
// that null). branches is now just a hardcoded 0 for API-shape
// compatibility with any frontend still reading client.branches.
function toClientResponse(client, subclientsCount, products) {
  return {
    id: client.id,
    name: client.name,
    country: client.country,
    status: client.status,
    subclients: subclientsCount,
    branches: 0, // "branches" table no longer exists — kept for API shape only
    users: 0, // placeholder until a users table/relation exists
    // REVERSED MAPPING: products this client is linked to, via the
    // client_products junction table. `productRates` is what the Add/Edit
    // form reads back to prefill (productId + per-client amount/currency);
    // `products` is the full row for display.
    products: products || [],
    productRates: (products || []).map((p) => ({
      productId: p.id,
      amount: p.amount,
      currency: p.currency,
    })),
    website: client.website,
    mainEmail: client.main_email,
    mainPhone: client.main_phone,
    primaryContactName: client.primary_contact_name,
    primaryContactEmail: client.primary_contact_email,
    primaryContactPhone: client.primary_contact_phone,
    secondaryContactName: client.secondary_contact_name,
    secondaryContactEmail: client.secondary_contact_email,
    secondaryContactPhone: client.secondary_contact_phone,
  };
}

// Turns a raw Postgres unique-constraint violation (code 23505) into a
// clean, specific message instead of leaking the constraint name and SQL
// wording straight to the user (e.g. `duplicate key value violates unique
// constraint "uq_client_name"`). Returns null for any other kind of
// error, so callers can fall back to their own generic message.
function friendlyDuplicateClientNameError(err, name) {
  if (
    err?.code === "23505" &&
    String(err?.message || "").includes("uq_client_name")
  ) {
    return `A client named "${name}" already exists. Please use a different name.`;
  }
  return null;
}

function fromClientBody(body) {
  const {
    name,
    country,
    status,
    website,
    mainEmail,
    mainPhone,
    primaryContactName,
    primaryContactEmail,
    primaryContactPhone,
    secondaryContactName,
    secondaryContactEmail,
    secondaryContactPhone,
  } = body;

  return {
    name: name?.trim(),
    country: country || null,
    status: status === "Inactive" ? "Inactive" : "Active",
    website: website || null,
    main_email: mainEmail || null,
    main_phone: mainPhone || null,
    primary_contact_name: primaryContactName || null,
    primary_contact_email: primaryContactEmail || null,
    primary_contact_phone: primaryContactPhone || null,
    secondary_contact_name: secondaryContactName || null,
    secondary_contact_email: secondaryContactEmail || null,
    secondary_contact_phone: secondaryContactPhone || null,
  };
  // NOTE: organization_id is intentionally NOT read from the body
  // anywhere in this file — it always comes from req.user.organizationId,
  // set server-side by the authenticate middleware.
}

// APPROVAL: same merge pattern as products.controller.js —
//   - CLIENT_CREATE: no real row yet, synthesize a placeholder client
//     card from the request payload (id prefixed "pending-").
//   - CLIENT_UPDATE / CLIENT_DELETE: stamp approvalStatus onto the real,
//     already-existing client so the UI can badge it in place.
async function attachPendingClientApprovals(formattedClients, organizationId) {
  const { data: pending } = await supabase
    .from("approval_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "PENDING")
    .in("type", ["CLIENT_CREATE", "CLIENT_UPDATE", "CLIENT_DELETE"]);

  if (!pending || pending.length === 0) return formattedClients;

  const updateOrDeleteById = new Map();
  const pendingCreates = [];

  for (const req of pending) {
    if (req.type === "CLIENT_CREATE") {
      pendingCreates.push(req);
    } else {
      updateOrDeleteById.set(String(req.payload?.id), req.type);
    }
  }

  const withBadges = formattedClients.map((c) => {
    const pendingType = updateOrDeleteById.get(String(c.id));
    if (!pendingType) return c;
    return {
      ...c,
      approvalStatus:
        pendingType === "CLIENT_UPDATE" ? "PENDING_UPDATE" : "PENDING_DELETE",
    };
  });

  const placeholders = pendingCreates.map((req) => ({
    id: `pending-${req.id}`,
    name: req.payload?.name || "(untitled)",
    country: req.payload?.country || null,
    status: req.payload?.status === "Inactive" ? "Inactive" : "Active",
    subclients: 0,
    branches: 0,
    users: 0,
    products: [],
    productRates: [],
    website: req.payload?.website || null,
    mainEmail: req.payload?.mainEmail || null,
    mainPhone: req.payload?.mainPhone || null,
    primaryContactName: req.payload?.primaryContactName || null,
    primaryContactEmail: req.payload?.primaryContactEmail || null,
    primaryContactPhone: req.payload?.primaryContactPhone || null,
    secondaryContactName: req.payload?.secondaryContactName || null,
    secondaryContactEmail: req.payload?.secondaryContactEmail || null,
    secondaryContactPhone: req.payload?.secondaryContactPhone || null,
    approvalStatus: "PENDING_CREATE",
    approvalRequestId: req.id,
  }));

  return [...placeholders, ...withBadges];
}

// ---------- GET /api/clients ----------

router.get("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    const { data: clients, error } = await supabase
      .from("clients")
      .select("*")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    if (error) throw error;

    const { data: subclients } = await supabase
      .from("subclients")
      .select("*")
      .eq("organization_id", orgId);

    // One query for every client->product link in this org, then group
    // in memory — avoids an N+1 query per client in the list view.
    const { data: clientProductLinks } = await supabase
      .from("client_products")
      .select("client_id, amount, currency, service_master(*)")
      .eq("organization_id", orgId);

    const formatted = clients.map((client) => {
      const products = (clientProductLinks || [])
        .filter((row) => row.client_id === client.id && row.service_master)
        .map((row) => ({
          ...row.service_master,
          amount: row.amount,
          currency: row.currency,
        }));

      return toClientResponse(
        client,
        subclients.filter((s) => s.client_id === client.id).length,
        products,
      );
    });

    const withPending = await attachPendingClientApprovals(formatted, orgId);

    res.json(withPending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// ---------- POST /api/clients ----------

router.post(
  "/",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_CREATE"),
  async (req, res) => {
    try {
      if (!req.body?.name || !req.body.name.trim()) {
        return res.status(400).json({ message: "Client name is required" });
      }

      const { data: client, error } = await supabase
        .from("clients")
        .insert({
          ...fromClientBody(req.body),
          organization_id: req.user.organizationId, // stamped server-side, never from body
        })
        .select()
        .single();

      if (error) throw error;

      // REVERSED MAPPING: link whichever existing Products were picked in
      // the Add Client form — req.body.productRates is
      // [{ productId, amount, currency }], since the rate is per client, not
      // fixed on the product itself.
      let products = [];
      if (
        Array.isArray(req.body.productRates) &&
        req.body.productRates.length
      ) {
        await productsService.syncClientProducts(
          client.id,
          req.body.productRates,
          req.user.organizationId,
        );
        products = await productsService.getProductsForClient(
          client.id,
          req.user.organizationId,
        );
      }

      res.status(201).json(toClientResponse(client, 0, products));
    } catch (err) {
      console.error(err);
      const friendly = friendlyDuplicateClientNameError(err, req.body?.name);
      if (friendly) {
        return res.status(409).json({ message: friendly });
      }
      res
        .status(500)
        .json({ message: "Failed to create client", detail: err.message });
    }
  },
);

// ---------- Excel template download (styled) ----------
// MUST be declared above "/:id" so it isn't shadowed by the param route.
// (Unchanged from the original — a static template has nothing tenant-
// specific to leak.)

const CLIENT_TEMPLATE_COLUMNS = [
  { header: "Client Name", key: "clientName", width: 22, color: BRAND.blue },
  {
    header: "Client Country",
    key: "clientCountry",
    width: 18,
    color: BRAND.blue,
  },
  {
    header: "Client Status",
    key: "clientStatus",
    width: 16,
    color: BRAND.blue,
  },
  { header: "Website", key: "website", width: 26, color: BRAND.lightBlue },
  {
    header: "Company Email",
    key: "companyEmail",
    width: 26,
    color: BRAND.lightBlue,
  },
  {
    header: "Company Phone",
    key: "companyPhone",
    width: 20,
    color: BRAND.lightBlue,
  },
  {
    header: "Primary Contact Name",
    key: "primaryContactName",
    width: 22,
    color: BRAND.green,
  },
  {
    header: "Primary Contact Email",
    key: "primaryContactEmail",
    width: 26,
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
    color: BRAND.green,
  },
  {
    header: "Secondary Contact Email",
    key: "secondaryContactEmail",
    width: 26,
    color: BRAND.green,
  },
  {
    header: "Secondary Contact Phone",
    key: "secondaryContactPhone",
    width: 20,
    color: BRAND.green,
  },
  {
    header: "Subclient Name",
    key: "subclientName",
    width: 22,
    color: BRAND.blue,
  },
  {
    header: "Subclient Status",
    key: "subclientStatus",
    width: 16,
    color: BRAND.blue,
  },
  // "Branch Name"/"Branch Status" columns removed — the branches table
  // no longer exists.
];

router.get("/bulk/template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Clients");

    sheet.columns = CLIENT_TEMPLATE_COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    CLIENT_TEMPLATE_COLUMNS.forEach((col, idx) =>
      styleHeaderCell(headerRow.getCell(idx + 1), col.color),
    );

    sheet.addRows([
      {
        clientName: "Acme Corp",
        clientCountry: "India",
        clientStatus: "Active",
        website: "https://acme.com",
        companyEmail: "hello@acme.com",
        companyPhone: "+91 98765 43210",
        primaryContactName: "Jordan Lee",
        primaryContactEmail: "jordan@acme.com",
        primaryContactPhone: "+91 90000 00001",
        secondaryContactName: "Sam Rao",
        secondaryContactEmail: "sam@acme.com",
        secondaryContactPhone: "+91 90000 00002",
      },
    ]);

    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=client_bulk_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ---------- Excel bulk upload ----------
// MUST be declared above "/:id" so it isn't shadowed by the param route.
// NOTE: bulk upload is NOT approval-gated (same reasoning as products'
// bulk upload) — it always creates directly regardless of caller's role.

router.post(
  "/bulk/upload",
  requireAnyPermission("clients.manage"),
  upload.single("file"),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

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
      const subclientCache = new Map();

      const results = [];
      let createdCount = 0;
      let failedCount = 0;

      const norm = (v) => (v || "").toString().trim();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const clientNameRaw = norm(row["Client Name"]);
        const rowIdentifier = clientNameRaw || `Row ${rowNum}`;

        try {
          const clientName = clientNameRaw;
          const clientCountry = norm(row["Client Country"]) || null;
          const clientStatus =
            norm(row["Client Status"]) === "Inactive" ? "Inactive" : "Active";

          const website = norm(row["Website"]) || null;
          const companyEmail = norm(row["Company Email"]) || null;
          const companyPhone = norm(row["Company Phone"]) || null;

          const primaryContactName = norm(row["Primary Contact Name"]) || null;
          const primaryContactEmail =
            norm(row["Primary Contact Email"]) || null;
          const primaryContactPhone =
            norm(row["Primary Contact Phone"]) || null;

          const secondaryContactName =
            norm(row["Secondary Contact Name"]) || null;
          const secondaryContactEmail =
            norm(row["Secondary Contact Email"]) || null;
          const secondaryContactPhone =
            norm(row["Secondary Contact Phone"]) || null;

          const subName = norm(row["Subclient Name"]);
          const subStatus =
            norm(row["Subclient Status"]) === "Inactive"
              ? "Inactive"
              : "Active";

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

          // ---- resolve client (scoped to this org — a same-named client
          // in another org must NOT be matched or reused here) ----
          const clientKey = clientName.toLowerCase();
          let client = clientCache.get(clientKey);

          if (!client) {
            const { data: existing } = await supabase
              .from("clients")
              .select("*")
              .eq("organization_id", orgId)
              .ilike("name", clientName)
              .maybeSingle();

            if (existing) {
              client = existing;
            } else {
              const { data: newClient, error: clientErr } = await supabase
                .from("clients")
                .insert({
                  name: clientName,
                  country: clientCountry,
                  status: clientStatus,
                  website,
                  main_email: companyEmail,
                  main_phone: companyPhone,
                  primary_contact_name: primaryContactName,
                  primary_contact_email: primaryContactEmail,
                  primary_contact_phone: primaryContactPhone,
                  secondary_contact_name: secondaryContactName,
                  secondary_contact_email: secondaryContactEmail,
                  secondary_contact_phone: secondaryContactPhone,
                  organization_id: orgId,
                })
                .select()
                .single();

              if (clientErr) throw clientErr;
              client = newClient;
            }
            clientCache.set(clientKey, client);
          }

          // ---- resolve subclient (optional), scoped to org + client ----
          if (subName) {
            const subKey = `${client.id}::${subName.toLowerCase()}`;
            let subclient = subclientCache.get(subKey);

            if (!subclient) {
              const { data: existingSub } = await supabase
                .from("subclients")
                .select("*")
                .eq("organization_id", orgId)
                .eq("client_id", client.id)
                .ilike("name", subName)
                .maybeSingle();

              if (existingSub) {
                subclient = existingSub;
              } else {
                const { data: newSub, error: subErr } = await supabase
                  .from("subclients")
                  .insert({
                    name: subName,
                    client_id: client.id,
                    status: subStatus,
                    organization_id: orgId,
                  })
                  .select()
                  .single();

                if (subErr) throw subErr;
                subclient = newSub;
              }
              subclientCache.set(subKey, subclient);
            }
          }

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
  },
);

// ---------- GET /api/clients/:id ----------
// Declared below the /bulk/* routes since this is a param route.

router.get("/:id", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const id = Number(req.params.id);

    const { data: client, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId) // cross-org requests get a 404, not a 403 —
      .single(); // don't reveal that the id exists elsewhere

    if (error || !client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const { data: subclients } = await supabase
      .from("subclients")
      .select("*")
      .eq("organization_id", orgId)
      .eq("client_id", id);

    const products = await productsService.getProductsForClient(id, orgId);

    res.json({
      ...toClientResponse(client, subclients?.length || 0, products),
      subclients,
      branches: [], // "branches" table no longer exists — kept for API shape only
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch client" });
  }
});

// ---------- PUT /api/clients/:id ----------

router.put(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_UPDATE", { includeParamsId: true }),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;
      const id = Number(req.params.id);

      if (!req.body?.name || !req.body.name.trim()) {
        return res.status(400).json({ message: "Client name is required" });
      }

      const { data: client, error } = await supabase
        .from("clients")
        .update(fromClientBody(req.body))
        .eq("id", id)
        .eq("organization_id", orgId) // can't update a row belonging to another org
        .select()
        .single();

      if (error) throw error;
      if (!client) return res.status(404).json({ message: "Client not found" });

      // REVERSED MAPPING: only touch the product links if productRates was
      // actually sent — this lets other PUT callers (e.g. a status-only
      // toggle) update a client without accidentally wiping its products.
      if (req.body.productRates !== undefined) {
        await productsService.syncClientProducts(
          id,
          req.body.productRates,
          orgId,
        );
      }
      const products = await productsService.getProductsForClient(id, orgId);

      const { data: subclients } = await supabase
        .from("subclients")
        .select("id")
        .eq("organization_id", orgId)
        .eq("client_id", id);

      res.json(toClientResponse(client, subclients?.length || 0, products));
    } catch (err) {
      console.error(err);
      const friendly = friendlyDuplicateClientNameError(err, req.body?.name);
      if (friendly) {
        return res.status(409).json({ message: friendly });
      }
      res
        .status(500)
        .json({ message: "Failed to update client", detail: err.message });
    }
  },
);

// ---------- DELETE /api/clients/:id ----------

router.delete(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_DELETE", { includeParamsId: true }),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;
      const id = Number(req.params.id);

      const { data: existing, error: findErr } = await supabase
        .from("clients")
        .select("id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (findErr) throw findErr;
      if (!existing)
        return res.status(404).json({ message: "Client not found" });

      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);

      if (error) {
        if (error.code === "23503") {
          return res.status(409).json({
            message:
              "Cannot delete this client because it still has subclients. Delete those first.",
          });
        }
        throw error;
      }

      res.json({ message: "Client deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete client" });
    }
  },
);

module.exports = router;
