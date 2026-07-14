const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const supabase = require("../../config/supabaseClient");

const upload = multer({ storage: multer.memoryStorage() });

// Prevent browser caching
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- existing routes (unchanged) ----------

// GET /api/clients
router.get("/", async (req, res) => {
  try {
    const { data: clients, error } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    const { data: subclients } = await supabase.from("subclients").select("*");
    const { data: branches } = await supabase.from("branches").select("*");

    const formatted = clients.map((client) => ({
      id: client.id,
      name: client.name,
      country: client.country,
      status: client.status,
      subclients: subclients.filter((s) => s.client_id === client.id).length,
      branches: branches.filter((b) => b.client_id === client.id).length,
      users: 0,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// POST /api/clients
router.post("/", async (req, res) => {
  try {
    const { name, country, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Client name is required" });
    }

    const { data: client, error } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        country: country || null,
        status: status === "Inactive" ? "Inactive" : "Active",
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create client" });
  }
});

// ---------- NEW: Excel template download ----------
// MOVED ABOVE "/:id" so it isn't shadowed by the param route

// GET /api/clients/bulk/template
router.get("/bulk/template", (req, res) => {
  try {
    const headers = [
      "Client Name",
      "Client Country",
      "Client Status",
      "Subclient Name",
      "Subclient Status",
      "Branch Name",
      "Branch Status",
    ];

    const sampleRows = [
      {
        "Client Name": "Acme Corp",
        "Client Country": "India",
        "Client Status": "Active",
        "Subclient Name": "Acme North",
        "Subclient Status": "Active",
        "Branch Name": "Gurugram Branch",
        "Branch Status": "Active",
      },
      {
        "Client Name": "Acme Corp",
        "Client Country": "India",
        "Client Status": "Active",
        "Subclient Name": "Acme North",
        "Subclient Status": "Active",
        "Branch Name": "Delhi Branch",
        "Branch Status": "Active",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    worksheet["!cols"] = headers.map(() => ({ wch: 20 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clients");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=client_bulk_upload_template.xlsx",
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ---------- NEW: Excel bulk upload ----------
// MOVED ABOVE "/:id" so it isn't shadowed by the param route

// POST /api/clients/bulk/upload
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

    // in-memory caches so we don't hit the DB repeatedly for the same name
    const clientCache = new Map(); // name(lower) -> client row
    const subclientCache = new Map(); // `${clientId}::name(lower)` -> subclient row
    const branchCache = new Map(); // `${clientId}::name(lower)` -> branch row

    const results = {
      created: { clients: 0, subclients: 0, branches: 0 },
      rowErrors: [],
    };

    const norm = (v) => (v || "").toString().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // account for header row in Excel

      try {
        const clientName = norm(row["Client Name"]);
        const clientCountry = norm(row["Client Country"]) || null;
        const clientStatus =
          norm(row["Client Status"]) === "Inactive" ? "Inactive" : "Active";

        const subName = norm(row["Subclient Name"]);
        const subStatus =
          norm(row["Subclient Status"]) === "Inactive" ? "Inactive" : "Active";

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
              })
              .select()
              .single();

            if (clientErr) throw clientErr;
            client = newClient;
            results.created.clients++;
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
              results.created.subclients++;
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
              results.created.branches++;
            }
            branchCache.set(branchKey, branch);
          }
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

// ---------- GET /api/clients/:id ----------
// MOVED BELOW the bulk routes — this is a catch-all-ish param route,
// so anything specific (like /bulk/*) must be declared before it.

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

    res.json({ ...client, subclients, branches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch client" });
  }
});

// ---------- NEW: Update client ----------

// PUT /api/clients/:id
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, country, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Client name is required" });
    }

    const { data: client, error } = await supabase
      .from("clients")
      .update({
        name: name.trim(),
        country: country || null,
        status: status === "Inactive" ? "Inactive" : "Active",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!client) return res.status(404).json({ message: "Client not found" });

    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update client" });
  }
});

// ---------- NEW: Delete client ----------

// DELETE /api/clients/:id
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
      // Likely a foreign key violation because subclients/branches still reference this client
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
