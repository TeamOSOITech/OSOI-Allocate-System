// src/modules/dailyWork/dailyWork.controller.js
//
// PAGE 2 (Daily Work). Yahi flow ka entry point hai: koi log karta hai
// "aaj `product` ka `total_qty` units aaya", aur yahi batch hai jise
// baad me SmartAutoAllocation / Manual Allocation present employees
// me split karte hain.
//
// Req/res handling only — all Supabase/DB access lives in
// dailywork.service.js. Wired up by dailywork.routes.js.

const dailyWorkService = require("./dailywork.service");

// ------------------------------------------------------------
// GET /api/daily-work?date=YYYY-MM-DD
// allocatedQty/pendingQty per batch bhi compute karta hai, taaki
// Dashboard ka pending table aur SmartAutoAllocation dropdown dono
// yahi ek endpoint use kar sakein.
// ------------------------------------------------------------
async function listDailyWork(req, res) {
  try {
    const { date } = req.query;
    const orgId = req.user.organizationId;

    const batches = await dailyWorkService.fetchDailyWorkBatches(orgId, date);

    const ids = batches.map((b) => b.id);
    const productNames = await dailyWorkService.getProductNameMap(
      batches.map((b) => b.product_id),
    );
    const allocatedByBatch = await dailyWorkService.fetchAllocatedByBatch(
      orgId,
      ids,
    );

    const data = batches.map((b) => {
      const allocatedQty = allocatedByBatch[b.id] || 0;
      return dailyWorkService.mapRow(b, {
        productName: productNames[b.product_id] || null,
        allocatedQty,
        pendingQty: b.total_qty - allocatedQty,
      });
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/daily-work/:id
// ------------------------------------------------------------
async function getDailyWorkById(req, res) {
  try {
    const { id } = req.params;
    const orgId = req.user.organizationId;

    const data = await dailyWorkService.fetchDailyWorkById(id, orgId);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    const productNames = await dailyWorkService.getProductNameMap([
      data.product_id,
    ]);

    res.json({
      success: true,
      data: dailyWorkService.mapRow(data, {
        productName: productNames[data.product_id] || null,
      }),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/daily-work
// body: { workDate, productId, totalQty }
// ------------------------------------------------------------
async function createDailyWork(req, res) {
  try {
    const { workDate, productId, totalQty } = req.body;
    const orgId = req.user.organizationId;

    if (!workDate || !productId || totalQty === undefined) {
      return res.status(400).json({
        success: false,
        message: "workDate, productId, and totalQty are required",
      });
    }

    const qty = Number(totalQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: "totalQty must be a positive number",
      });
    }

    const isDuplicate = await dailyWorkService.findDuplicateBatch(
      orgId,
      workDate,
      productId,
    );
    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        message:
          "A daily work batch for this date and product already exists. Edit that entry instead of creating a new one.",
      });
    }

    const data = await dailyWorkService.insertDailyWork({
      organization_id: orgId,
      work_date: workDate,
      product_id: productId,
      total_qty: qty,
      status: "PENDING",
      created_by: req.user.userId,
    });

    const productNames = await dailyWorkService.getProductNameMap([
      data.product_id,
    ]);

    res.status(201).json({
      success: true,
      data: dailyWorkService.mapRow(data, {
        productName: productNames[data.product_id] || null,
        allocatedQty: 0,
        pendingQty: data.total_qty,
      }),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PUT/PATCH /api/daily-work/:id
// body: { workDate?, productId?, totalQty? }
// ------------------------------------------------------------
async function updateDailyWork(req, res) {
  try {
    const { id } = req.params;
    const { workDate, productId, totalQty } = req.body;
    const orgId = req.user.organizationId;

    const existing = await dailyWorkService.fetchDailyWorkForUpdate(id, orgId);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    const updatePayload = {};
    if (workDate !== undefined) updatePayload.work_date = workDate;
    if (productId !== undefined) updatePayload.product_id = productId;

    let alreadyAllocated = 0;
    if (totalQty !== undefined) {
      const qty = Number(totalQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "totalQty must be a positive number",
        });
      }

      alreadyAllocated = await dailyWorkService.fetchAllocatedSum(orgId, id);

      if (qty < alreadyAllocated) {
        return res.status(409).json({
          success: false,
          message: `Cannot set totalQty below ${alreadyAllocated} — that much is already allocated for this batch.`,
        });
      }

      updatePayload.total_qty = qty;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid fields to update" });
    }

    const data = await dailyWorkService.updateDailyWorkRow(
      id,
      orgId,
      updatePayload,
    );

    const productNames = await dailyWorkService.getProductNameMap([
      data.product_id,
    ]);

    res.json({
      success: true,
      data: dailyWorkService.mapRow(data, {
        productName: productNames[data.product_id] || null,
        allocatedQty: alreadyAllocated,
        pendingQty: data.total_qty - alreadyAllocated,
      }),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/daily-work/:id
// ------------------------------------------------------------
async function deleteDailyWork(req, res) {
  try {
    const { id } = req.params;
    const orgId = req.user.organizationId;

    const hasAllocations = await dailyWorkService.hasAllocations(orgId, id);
    if (hasAllocations) {
      return res.status(409).json({
        success: false,
        message:
          "This batch already has allocations. Clear them first (see /api/allocations/by-daily-work/:id) before deleting.",
      });
    }

    await dailyWorkService.deleteDailyWorkRow(id, orgId);

    res.json({ success: true, message: "Daily work batch deleted" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/daily-work/seed-dummy
// body: { date? }  (defaults to today)
//
// "Load Test Cases" button on the Allocation page. Creates one
// daily_work "case" per service/product this org has, for the given
// date, so the allocation flow (select a service -> see its case ->
// Auto/Manual allocate) has something to work with without anyone
// manually typing in Daily Work batches first.
//
// - Skips any product that already has a daily_work row for this date
//   (never overwrites/duplicates real data).
// - total_qty is a random dummy number (50-500) per case.
// - If nobody has marked attendance for this date yet, also marks
//   every employee PRESENT for it — otherwise Auto Allocate has no
//   one to split against and always fails with "No employees marked
//   PRESENT". Real attendance for the date is left untouched.
// ------------------------------------------------------------
async function seedDummyCases(req, res) {
  try {
    const orgId = req.user.organizationId;
    const workDate = req.body?.date || new Date().toISOString().slice(0, 10);

    const productsList = await dailyWorkService.fetchServicesForOrg(orgId);
    if (!productsList || productsList.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No services found for this organization yet — add a service first, then load test cases.",
      });
    }

    const existingProductIds =
      await dailyWorkService.fetchExistingBatchProductIds(orgId, workDate);
    const alreadyHasCase = new Set(existingProductIds);

    const toCreate = productsList.filter((p) => !alreadyHasCase.has(p.id));
    const newRows = toCreate.map((p) => ({
      organization_id: orgId,
      work_date: workDate,
      product_id: p.id,
      total_qty: 50 + Math.floor(Math.random() * 451), // 50-500
      status: "PENDING",
      created_by: req.user.userId,
    }));

    const inserted = await dailyWorkService.insertDailyWorkRows(newRows);

    // Seed attendance too, but only if this date has none at all yet —
    // never touch a date someone has already marked for real.
    let attendanceSeeded = false;
    const attendanceExists = await dailyWorkService.hasAttendanceForDate(
      orgId,
      workDate,
    );

    if (!attendanceExists) {
      const employeeRows = await dailyWorkService.fetchEmployeesForOrg(orgId);

      const attRows = employeeRows
        .map((e) => e["Auth User Id"])
        .filter(Boolean)
        .map((employeeId) => ({
          organization_id: orgId,
          employee_id: employeeId,
          attendance_date: workDate,
          status: "PRESENT",
          marked_by: req.user.userId,
        }));

      if (attRows.length > 0) {
        await dailyWorkService.upsertAttendanceRows(attRows);
        attendanceSeeded = true;
      }
    }

    const productNames = productsList.reduce((acc, p) => {
      acc[p.id] = p.product_name;
      return acc;
    }, {});

    const data = inserted.map((row) =>
      dailyWorkService.mapRow(row, {
        productName: productNames[row.product_id] || null,
        allocatedQty: 0,
        pendingQty: row.total_qty,
      }),
    );

    const skipped = productsList.length - toCreate.length;
    res.status(201).json({
      success: true,
      message:
        `Created ${inserted.length} test case(s)` +
        (skipped > 0
          ? ` (${skipped} service${skipped === 1 ? "" : "s"} already had a case for this date)`
          : "") +
        (attendanceSeeded
          ? ". Marked all employees Present for this date so Auto Allocate works."
          : ""),
      data,
      attendanceSeeded,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/daily-work/bulk
// body: { workDate, rows: [{ serviceName, quantity }] }
//
// Bulk version of createDailyWork for the "Log Production" form — lets
// someone log today's quantity for many services (100+) in one Excel
// upload instead of one dropdown submission per service. Each row is
// matched against service_master by product_name (case-insensitive,
// scoped to this organization). Anything not found is reported back as
// "not listed" rather than created, exactly like the row-by-row bulk
// upload pattern used for Products/Clients — one bad row never blocks
// the rest of the sheet.
// ------------------------------------------------------------
async function bulkCreateDailyWork(req, res) {
  try {
    const orgId = req.user.organizationId;
    const { workDate, rows } = req.body;

    if (!workDate) {
      return res
        .status(400)
        .json({ success: false, message: "workDate is required" });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No rows provided" });
    }

    // Load every service once up front instead of querying per row —
    // 100+ rows would otherwise mean 100+ round trips just to resolve
    // names to ids.
    const services = await dailyWorkService.fetchServicesForOrg(orgId);
    const serviceByName = new Map(
      services.map((s) => [
        String(s.product_name || "")
          .trim()
          .toLowerCase(),
        s,
      ]),
    );

    // Existing (date, product) pairs for this org — same duplicate rule
    // createDailyWork enforces one row at a time, checked in bulk here
    // instead so a batch of 100 doesn't mean 100 duplicate-check queries.
    const existingProductIds =
      await dailyWorkService.fetchExistingBatchProductIds(orgId, workDate);
    const alreadyLoggedProductIds = new Set(existingProductIds);

    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || {};
      const rowNumber = index + 2; // +2: header row + 1-indexing, matches the Products bulk pattern
      const serviceNameRaw = String(row.serviceName || "").trim();
      const identifier = serviceNameRaw || `Row ${rowNumber}`;

      if (!serviceNameRaw) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: "Missing Service Name",
        });
        failedCount++;
        continue;
      }

      const qty = Number(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `Could not parse Quantity value: "${row.quantity}"`,
        });
        failedCount++;
        continue;
      }

      const matchedService = serviceByName.get(serviceNameRaw.toLowerCase());
      if (!matchedService) {
        // This is the "not listed" case the person asked for — the
        // service in the sheet doesn't exist in this org's service
        // list, so nothing gets created for it.
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `"${serviceNameRaw}" not listed`,
        });
        failedCount++;
        continue;
      }

      if (alreadyLoggedProductIds.has(matchedService.id)) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `A daily work batch for "${serviceNameRaw}" on this date already exists.`,
        });
        failedCount++;
        continue;
      }

      const insertError = await dailyWorkService.insertSingleDailyWorkRow({
        organization_id: orgId,
        work_date: workDate,
        product_id: matchedService.id,
        total_qty: qty,
        status: "PENDING",
        created_by: req.user.userId,
      });

      if (insertError) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: insertError.message || "Failed to create this row.",
        });
        failedCount++;
        continue;
      }

      // Mark this product as logged now so a later duplicate row in the
      // SAME sheet (same service listed twice) is caught too, not just
      // duplicates against pre-existing rows.
      alreadyLoggedProductIds.add(matchedService.id);
      results.push({ identifier, row: rowNumber, success: true });
      createdCount++;
    }

    res.status(201).json({
      success: true,
      data: {
        totalRows: rows.length,
        createdCount,
        failedCount,
        results,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

module.exports = {
  listDailyWork,
  getDailyWorkById,
  createDailyWork,
  bulkCreateDailyWork,
  updateDailyWork,
  deleteDailyWork,
  seedDummyCases,
};
