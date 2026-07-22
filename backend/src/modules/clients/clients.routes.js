const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const supabase = require("../../config/supabaseClient");

const upload = multer({ storage: multer.memoryStorage() });

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

function toClientResponse(client, subclientsCount, branchesCount) {
  return {
    id: client.id,
    name: client.name,
    country: client.country,
    status: client.status,
    subclients: subclientsCount,
    branches: branchesCount,
    users: 0, // placeholder until a users table/relation exists
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
}

// ---------- GET /api/clients ----------

router.get("/", async (req, res) => {
  try {
    const { data: clients, error } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const { data: subclients } = await supabase.from("subclients").select("*");
    const { data: branches } = await supabase.from("branches").select("*");

    const formatted = clients.map((client) =>
      toClientResponse(
        client,
        subclients.filter((s) => s.client_id === client.id).length,
        branches.filter((b) => b.client_id === client.id).length,
      ),
    );

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
      .insert(fromClientBody(req.body))
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(toClientResponse(client, 0, 0));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create client" });
  }
});

// ---------- Excel template download (styled) ----------
// MUST be declared above "/:id" so it isn't shadowed by the param route.

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

// GET /api/clients/bulk/template
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

// POST /api/clients/bulk/upload
//
// Response shape (matches the "Bulk Add Users" results list on the
// frontend): every row in the sheet gets ONE entry in `results`, whether it
// succeeded or failed, so the UI can render a full row-by-row list instead
// of only showing errors.
router.post("/bulk/upload", upload.single("file"), async (req, res) => {
  try {
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

    // Per-row results — pushed exactly once per row, either "created" or
    // "failed" — plus running totals for the created/failed counters shown
    // in the summary line ("X created · Y failed").
    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    const norm = (v) => (v || "").toString().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // account for header row in Excel
      const clientNameRaw = norm(row["Client Name"]);
      // Best-effort identifier shown in the UI even if the row fails before
      // the client name is known to be valid.
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

        // ---- resolve client ----
        const clientKey = clientName.toLowerCase();
        let client = clientCache.get(clientKey);

        if (!client) {
          const { data: existing } = await supabase
            .from("clients")
            .select("*")
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
              })
              .select()
              .single();

            if (clientErr) throw clientErr;
            client = newClient;
          }
          clientCache.set(clientKey, client);
        }

        // ---- resolve subclient (optional) ----
        if (subName) {
          const subKey = `${client.id}::${subName.toLowerCase()}`;
          let subclient = subclientCache.get(subKey);

          if (!subclient) {
            const { data: existingSub } = await supabase
              .from("subclients")
              .select("*")
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
                })
                .select()
                .single();

              if (subErr) throw subErr;
              subclient = newSub;
            }
            subclientCache.set(subKey, subclient);
          }
        }

        // ---- resolve branch (optional) ----
        if (branchName) {
          const branchKey = `${client.id}::${branchName.toLowerCase()}`;
          let branch = branchCache.get(branchKey);

          if (!branch) {
            const { data: existingBranch } = await supabase
              .from("branches")
              .select("*")
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
                })
                .select()
                .single();

              if (branchErr) throw branchErr;
              branch = newBranch;
            }
            branchCache.set(branchKey, branch);
          }
        }

        // Row processed without throwing -> counts as "created" for this
        // row, whether the client itself was brand-new or already existed
        // and this row just added a subclient/branch under it.
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
    const id = Number(req.params.id);

    const { data: client, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const { data: subclients } = await supabase
      .from("subclients")
      .select("*")
      .eq("client_id", id);
    const { data: branches } = await supabase
      .from("branches")
      .select("*")
      .eq("client_id", id);

    res.json({
      ...toClientResponse(
        client,
        subclients?.length || 0,
        branches?.length || 0,
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
    const id = Number(req.params.id);

    if (!req.body?.name || !req.body.name.trim()) {
      return res.status(400).json({ message: "Client name is required" });
    }

    const { data: client, error } = await supabase
      .from("clients")
      .update(fromClientBody(req.body))
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!client) return res.status(404).json({ message: "Client not found" });

    const { data: subclients } = await supabase
      .from("subclients")
      .select("id")
      .eq("client_id", id);
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("client_id", id);

    res.json(
      toClientResponse(client, subclients?.length || 0, branches?.length || 0),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update client" });
  }
});

// ---------- DELETE /api/clients/:id ----------

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: existing, error: findErr } = await supabase
      .from("clients")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) return res.status(404).json({ message: "Client not found" });

    const { error } = await supabase.from("clients").delete().eq("id", id);

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
