const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const supabase = require("../../config/supabaseClient");

const upload = multer({ storage: multer.memoryStorage() });

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- existing routes (unchanged) ----------

router.get("/", async (req, res) => {
  try {
    const { data: subclients, error } = await supabase
      .from("subclients")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const { data: clients } = await supabase.from("clients").select("id,name");
    const { data: branches } = await supabase.from("branches").select("*");

    const formatted = subclients.map((subclient) => ({
      id: subclient.id,
      name: subclient.name,
      status: subclient.status,
      clientId: subclient.client_id,
      clientName: clients.find((c) => c.id === subclient.client_id)?.name || "",
      branches: branches.filter((b) => b.subclient_id === subclient.id).length,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch subclients" });
  }
});

// POST /api/subclients
// Body: { name, clientId, status }
router.post("/", async (req, res) => {
  try {
    const { name, clientId, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Subclient name is required" });
    }
    if (!clientId) {
      return res.status(400).json({ message: "Client is required" });
    }

    const { data: subclient, error } = await supabase
      .from("subclients")
      .insert({
        name: name.trim(),
        client_id: Number(clientId),
        status: status === "Inactive" ? "Inactive" : "Active",
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(subclient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create subclient" });
  }
});

// ---------- NEW: Excel template download ----------

// GET /api/subclients/bulk/template
router.get("/bulk/template", (req, res) => {
  try {
    const headers = ["Client Name", "Subclient Name", "Subclient Status"];

    const sampleRows = [
      {
        "Client Name": "Acme Corp",
        "Subclient Name": "Acme North",
        "Subclient Status": "Active",
      },
      {
        "Client Name": "Acme Corp",
        "Subclient Name": "Acme South",
        "Subclient Status": "Active",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    worksheet["!cols"] = headers.map(() => ({ wch: 22 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subclients");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=subclient_bulk_upload_template.xlsx",
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ---------- NEW: Excel bulk upload ----------

// POST /api/subclients/bulk/upload
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

    const clientCache = new Map(); // name(lower) -> client row
    const results = { created: { subclients: 0 }, rowErrors: [] };
    const norm = (v) => (v || "").toString().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      try {
        const clientName = norm(row["Client Name"]);
        const subName = norm(row["Subclient Name"]);
        const subStatus =
          norm(row["Subclient Status"]) === "Inactive" ? "Inactive" : "Active";

        if (!clientName) {
          results.rowErrors.push({
            row: rowNum,
            message: "Client Name is required",
          });
          continue;
        }
        if (!subName) {
          results.rowErrors.push({
            row: rowNum,
            message: "Subclient Name is required",
          });
          continue;
        }

        // ---- resolve client (must already exist — no auto-create here) ----
        const clientKey = clientName.toLowerCase();
        let client = clientCache.get(clientKey);

        if (!client) {
          const { data: existing } = await supabase
            .from("clients")
            .select("*")
            .ilike("name", clientName)
            .maybeSingle();

          if (!existing) {
            results.rowErrors.push({
              row: rowNum,
              message: `Client "${clientName}" not found. Create the client first.`,
            });
            continue;
          }
          client = existing;
          clientCache.set(clientKey, client);
        }

        // ---- resolve/create subclient ----
        const { data: existingSub } = await supabase
          .from("subclients")
          .select("*")
          .eq("client_id", client.id)
          .ilike("name", subName)
          .maybeSingle();

        if (!existingSub) {
          const { error: subErr } = await supabase
            .from("subclients")
            .insert({ name: subName, client_id: client.id, status: subStatus });

          if (subErr) throw subErr;
          results.created.subclients++;
        }
      } catch (rowErr) {
        console.error(`Row ${rowNum} error:`, rowErr);
        results.rowErrors.push({
          row: rowNum,
          message: rowErr.message || "Unknown error",
        });
      }
    }

    res.status(200).json({
      message: "Bulk upload processed",
      totalRows: rows.length,
      ...results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to process bulk upload" });
  }
});

module.exports = router;
