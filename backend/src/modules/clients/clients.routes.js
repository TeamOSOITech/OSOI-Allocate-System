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

function toClientResponse(client, subclientsCount, branchesCount, products) {
  return {
    id: client.id,
    name: client.name,
    country: client.country,
    status: client.status,
    subclients: subclientsCount,
    branches: branchesCount,
    users: 0, // placeholder until a users table/relation exists
    // REVERSED MAPPING: products this client is linked to, via the
    // client_products junction table. `productIds` is what the Add/Edit
    // form sends back on submit; `products` is the full row for display.
    products: products || [],
    productIds: (products || []).map((p) => p.id),
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
    const { data: branches } = await supabase
      .from("branches")
      .select("*")
      .eq("organization_id", orgId);

    // One query for every client->product link in this org, then group
    // in memory — avoids an N+1 query per client in the list view.
    const { data: clientProductLinks } = await supabase
      .from("client_products")
      .select("client_id, product_master(*)")
      .eq("organization_id", orgId);

    const formatted = clients.map((client) => {
      const products = (clientProductLinks || [])
        .filter((row) => row.client_id === client.id)
        .map((row) => row.product_master)
        .filter(Boolean);

      return toClientResponse(
        client,
        subclients.filter((s) => s.client_id === client.id).length,
        branches.filter((b) => b.client_id === client.id).length,
        products,
      );
    });

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// ---------- POST /api/clients ----------

router.post("/", async (req, res) => {
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
    // the Add Client form (req.body.productIds), instead of a Product
    // pointing back at this client.
    let products = [];
    if (Array.isArray(req.body.productIds) && req.body.productIds.length) {
      await productsService.syncClientProducts(
        client.id,
        req.body.productIds,
        req.user.organizationId,
      );
      products = await productsService.getProductsForClient(
        client.id,
        req.user.organizationId,
      );
    }

    res.status(201).json(toClientResponse(client, 0, 0, products));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create client" });
  }
});

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
  {
    header: "Branch Name",
    key: "branchName",
    width: 22,
    color: BRAND.lightBlue,
  },
  {
    header: "Branch Status",
    key: "branchStatus",
    width: 16,
    color: BRAND.lightBlue,
  },
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
        subclientName: "Acme North",
        subclientStatus: "Active",
        branchName: "Gurugram Branch",
        branchStatus: "Active",
      },
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
        subclientName: "Acme North",
        subclientStatus: "Active",
        branchName: "Delhi Branch",
        branchStatus: "Active",
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

router.post("/bulk/upload", upload.single("file"), async (req, res) => {
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
    const branchCache = new Map();

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
        const primaryContactEmail = norm(row["Primary Contact Email"]) || null;
        const primaryContactPhone = norm(row["Primary Contact Phone"]) || null;

        const secondaryContactName =
          norm(row["Secondary Contact Name"]) || null;
        const secondaryContactEmail =
          norm(row["Secondary Contact Email"]) || null;
        const secondaryContactPhone =
          norm(row["Secondary Contact Phone"]) || null;

        const subName = norm(row["Subclient Name"]);
        const subStatus =
          norm(row["Subclient Status"]) === "Inactive" ? "Inactive" : "Active";

        const branchName = norm(row["Branch Name"]);
        const branchStatus =
          norm(row["Branch Status"]) === "Inactive" ? "Inactive" : "Active";

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

        // ---- resolve branch (optional), scoped to org + client ----
        if (branchName) {
          const branchKey = `${client.id}::${branchName.toLowerCase()}`;
          let branch = branchCache.get(branchKey);

          if (!branch) {
            const { data: existingBranch } = await supabase
              .from("branches")
              .select("*")
              .eq("organization_id", orgId)
              .eq("client_id", client.id)
              .ilike("name", branchName)
              .maybeSingle();

            if (existingBranch) {
              branch = existingBranch;
            } else {
              const { data: newBranch, error: branchErr } = await supabase
                .from("branches")
                .insert({
                  name: branchName,
                  client_id: client.id,
                  status: branchStatus,
                  organization_id: orgId,
                })
                .select()
                .single();

              if (branchErr) throw branchErr;
              branch = newBranch;
            }
            branchCache.set(branchKey, branch);
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
});

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
    const { data: branches } = await supabase
      .from("branches")
      .select("*")
      .eq("organization_id", orgId)
      .eq("client_id", id);

    const products = await productsService.getProductsForClient(id, orgId);

    res.json({
      ...toClientResponse(
        client,
        subclients?.length || 0,
        branches?.length || 0,
        products,
      ),
      subclients,
      branches,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch client" });
  }
});

// ---------- PUT /api/clients/:id ----------

router.put("/:id", async (req, res) => {
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

    // REVERSED MAPPING: only touch the product links if productIds was
    // actually sent — this lets other PUT callers (e.g. a status-only
    // toggle) update a client without accidentally wiping its products.
    if (req.body.productIds !== undefined) {
      await productsService.syncClientProducts(id, req.body.productIds, orgId);
    }
    const products = await productsService.getProductsForClient(id, orgId);

    const { data: subclients } = await supabase
      .from("subclients")
      .select("id")
      .eq("organization_id", orgId)
      .eq("client_id", id);
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organization_id", orgId)
      .eq("client_id", id);

    res.json(
      toClientResponse(
        client,
        subclients?.length || 0,
        branches?.length || 0,
        products,
      ),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update client" });
  }
});

// ---------- DELETE /api/clients/:id ----------

router.delete("/:id", async (req, res) => {
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
    if (!existing) return res.status(404).json({ message: "Client not found" });

    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          message:
            "Cannot delete this client because it still has subclients or branches. Delete those first.",
        });
      }
      throw error;
    }

    res.json({ message: "Client deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete client" });
  }
});

module.exports = router;
