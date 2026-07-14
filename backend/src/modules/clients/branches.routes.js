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
    const { data: branches, error } = await supabase
      .from("branches")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const { data: clients } = await supabase.from("clients").select("id,name");
    const { data: subclients } = await supabase
      .from("subclients")
      .select("id,name");

    const formatted = branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      status: branch.status,
      clientId: branch.client_id,
      clientName: clients.find((c) => c.id === branch.client_id)?.name || "",
      subclientId: branch.subclient_id,
      subclientName:
        subclients.find((s) => s.id === branch.subclient_id)?.name || "",
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch branches" });
  }
});

// POST /api/branches
router.post("/", async (req, res) => {
  try {
    const { name, clientId, subclientId, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Branch name is required" });
    }
    if (!clientId) {
      return res.status(400).json({ message: "Client is required" });
    }
    if (!subclientId) {
      return res.status(400).json({ message: "Subclient is required" });
    }

    const { data: branch, error } = await supabase
      .from("branches")
      .insert({
        name: name.trim(),
        client_id: Number(clientId),
        subclient_id: Number(subclientId),
        status: status === "Inactive" ? "Inactive" : "Active",
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(branch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create branch" });
  }
});

// ---------- NEW: Excel template download ----------

// GET /api/branches/bulk/template
router.get("/bulk/template", (req, res) => {
  try {
    const headers = [
      "Client Name",
      "Subclient Name",
      "Branch Name",
      "Branch Status",
    ];

    const sampleRows = [
      {
        "Client Name": "Acme Corp",
        "Subclient Name": "Acme North",
        "Branch Name": "Gurugram Branch",
        "Branch Status": "Active",
      },
      {
        "Client Name": "Acme Corp",
        "Subclient Name": "Acme North",
        "Branch Name": "Delhi Branch",
        "Branch Status": "Active",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    worksheet["!cols"] = headers.map(() => ({ wch: 22 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Branches");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=branch_bulk_upload_template.xlsx",
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ---------- NEW: Excel bulk upload ----------

// POST /api/branches/bulk/upload
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
    const subclientCache = new Map(); // `${clientId}::name(lower)` -> subclient row
    const results = { created: { branches: 0 }, rowErrors: [] };
    const norm = (v) => (v || "").toString().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      try {
        const clientName = norm(row["Client Name"]);
        const subName = norm(row["Subclient Name"]);
        const branchName = norm(row["Branch Name"]);
        const branchStatus =
          norm(row["Branch Status"]) === "Inactive" ? "Inactive" : "Active";

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
        if (!branchName) {
          results.rowErrors.push({
            row: rowNum,
            message: "Branch Name is required",
          });
          continue;
        }

        // ---- resolve client (must already exist) ----
        const clientKey = clientName.toLowerCase();
        let client = clientCache.get(clientKey);

        if (!client) {
          const { data: existingClient } = await supabase
            .from("clients")
            .select("*")
            .ilike("name", clientName)
            .maybeSingle();

          if (!existingClient) {
            results.rowErrors.push({
              row: rowNum,
              message: `Client "${clientName}" not found. Create the client first.`,
            });
            continue;
          }
          client = existingClient;
          clientCache.set(clientKey, client);
        }

        // ---- resolve subclient (must already exist, under this client) ----
        const subKey = `${client.id}::${subName.toLowerCase()}`;
        let subclient = subclientCache.get(subKey);

        if (!subclient) {
          const { data: existingSub } = await supabase
            .from("subclients")
            .select("*")
            .eq("client_id", client.id)
            .ilike("name", subName)
            .maybeSingle();

          if (!existingSub) {
            results.rowErrors.push({
              row: rowNum,
              message: `Subclient "${subName}" not found under client "${clientName}". Create the subclient first.`,
            });
            continue;
          }
          subclient = existingSub;
          subclientCache.set(subKey, subclient);
        }

        // ---- resolve/create branch ----
        const { data: existingBranch } = await supabase
          .from("branches")
          .select("*")
          .eq("client_id", client.id)
          .eq("subclient_id", subclient.id)
          .ilike("name", branchName)
          .maybeSingle();

        if (!existingBranch) {
          const { error: branchErr } = await supabase.from("branches").insert({
            name: branchName,
            client_id: client.id,
            subclient_id: subclient.id,
            status: branchStatus,
          });

          if (branchErr) throw branchErr;
          results.created.branches++;
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

// ---------- NEW: Update branch ----------

// PUT /api/branches/:id
// Body: { name, clientId, subclientId, status }
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, clientId, subclientId, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Branch name is required" });
    }
    if (!clientId) {
      return res.status(400).json({ message: "Client is required" });
    }
    if (!subclientId) {
      return res.status(400).json({ message: "Subclient is required" });
    }

    const { data: branch, error } = await supabase
      .from("branches")
      .update({
        name: name.trim(),
        client_id: Number(clientId),
        subclient_id: Number(subclientId),
        status: status === "Inactive" ? "Inactive" : "Active",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    res.json(branch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update branch" });
  }
});

// ---------- NEW: Delete branch ----------

// DELETE /api/branches/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: existing, error: findErr } = await supabase
      .from("branches")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) return res.status(404).json({ message: "Branch not found" });

    const { error } = await supabase.from("branches").delete().eq("id", id);

    if (error) throw error;

    res.json({ message: "Branch deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete branch" });
  }
});

module.exports = router;
