// src/modules/dailyWork/dailyWork.controller.js
//
// PAGE 2 (Daily Work). Yahi flow ka entry point hai: koi log karta hai
// "aaj `product` ka `total_qty` units aaya", aur yahi batch hai jise
// baad me SmartAutoAllocation / Manual Allocation present employees
// me split karte hain.
//
// Table: daily_work(id, organization_id, work_date, product_id,
//                    total_qty, status, created_by, created_at)
//
// NOTE: product_id -> products.id ka embedded Supabase select
// (".select('*, products(product_name)')") FAIL hota hai jab tak DB
// me ek actual foreign key constraint na ho — PostgREST apna
// "schema cache" isi constraint se banata hai. Migration se guarantee
// nahi tha ki FK bana hi hoga, isliye yahan product name manually,
// alag query se, application code me hi join kiya ja raha hai —
// isse FK exist kare ya na kare, dono cases me kaam karega.
//
// Har query req.user.organizationId se scoped hai — same tenant
// enforcement pattern jo modules/allocations/allocations.controller.js
// use karta hai.

const supabase = require("../../config/supabaseClient");

// ------------------------------------------------------------
// Given a list of daily_work rows, fetch matching product names in
// ONE extra query and return a { [productId]: productName } map.
// ------------------------------------------------------------
async function getProductNameMap(productIds) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .in("id", uniqueIds);

  if (error) {
    console.error("Failed to fetch product names:", error);
    return {};
  }

  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

function mapRow(row, extra = {}) {
  return {
    id: row.id,
    workDate: row.work_date,
    productId: row.product_id,
    productName: extra.productName ?? null,
    totalQty: row.total_qty,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    allocatedQty: extra.allocatedQty,
    pendingQty: extra.pendingQty,
  };
}

// ------------------------------------------------------------
// GET /api/daily-work?date=YYYY-MM-DD
// allocatedQty/pendingQty per batch bhi compute karta hai, taaki
// Dashboard ka pending table aur SmartAutoAllocation dropdown dono
// yahi ek endpoint use kar sakein.
// ------------------------------------------------------------
async function listDailyWork(req, res) {
  try {
    const { date } = req.query;

    let query = supabase
      .from("daily_work")
      .select("*")
      .eq("organization_id", req.user.organizationId)
      .order("work_date", { ascending: false });

    if (date) {
      query = query.eq("work_date", date);
    }

    const { data: batches, error } = await query;
    if (error) throw error;

    const ids = (batches || []).map((b) => b.id);
    const productNames = await getProductNameMap(
      (batches || []).map((b) => b.product_id),
    );

    let allocatedByBatch = {};
    if (ids.length > 0) {
      const { data: allocRows, error: allocError } = await supabase
        .from("allocations")
        .select("daily_work_id, allocated_qty")
        .eq("organization_id", req.user.organizationId)
        .in("daily_work_id", ids);
      if (allocError) throw allocError;

      allocatedByBatch = (allocRows || []).reduce((acc, r) => {
        acc[r.daily_work_id] = (acc[r.daily_work_id] || 0) + r.allocated_qty;
        return acc;
      }, {});
    }

    const data = (batches || []).map((b) => {
      const allocatedQty = allocatedByBatch[b.id] || 0;
      return mapRow(b, {
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

    const { data, error } = await supabase
      .from("daily_work")
      .select("*")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .single();

    if (error || !data) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    const productNames = await getProductNameMap([data.product_id]);

    res.json({
      success: true,
      data: mapRow(data, {
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

    const { data: dup, error: dupError } = await supabase
      .from("daily_work")
      .select("id")
      .eq("organization_id", req.user.organizationId)
      .eq("work_date", workDate)
      .eq("product_id", productId)
      .limit(1);
    if (dupError) throw dupError;
    if (dup && dup.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "A daily work batch for this date and product already exists. Edit that entry instead of creating a new one.",
      });
    }

    const { data, error } = await supabase
      .from("daily_work")
      .insert({
        organization_id: req.user.organizationId,
        work_date: workDate,
        product_id: productId,
        total_qty: qty,
        status: "PENDING",
        created_by: req.user.userId,
      })
      .select("*")
      .single();

    if (error) throw error;

    const productNames = await getProductNameMap([data.product_id]);

    res.status(201).json({
      success: true,
      data: mapRow(data, {
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

    const { data: existing, error: fetchError } = await supabase
      .from("daily_work")
      .select("id, total_qty")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .single();

    if (fetchError || !existing) {
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

      const { data: allocRows, error: allocError } = await supabase
        .from("allocations")
        .select("allocated_qty")
        .eq("organization_id", req.user.organizationId)
        .eq("daily_work_id", id);
      if (allocError) throw allocError;

      alreadyAllocated = (allocRows || []).reduce(
        (sum, r) => sum + r.allocated_qty,
        0,
      );

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

    const { data, error } = await supabase
      .from("daily_work")
      .update(updatePayload)
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select("*")
      .single();

    if (error) throw error;

    const productNames = await getProductNameMap([data.product_id]);

    res.json({
      success: true,
      data: mapRow(data, {
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

    const { data: allocRows, error: allocError } = await supabase
      .from("allocations")
      .select("id")
      .eq("organization_id", req.user.organizationId)
      .eq("daily_work_id", id)
      .limit(1);
    if (allocError) throw allocError;

    if (allocRows && allocRows.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "This batch already has allocations. Clear them first (see /api/allocations/by-daily-work/:id) before deleting.",
      });
    }

    const { error } = await supabase
      .from("daily_work")
      .delete()
      .eq("id", id)
      .eq("organization_id", req.user.organizationId);

    if (error) throw error;

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

    const { data: productsList, error: productsError } = await supabase
      .from("service_master")
      .select("id, product_name")
      .eq("organization_id", orgId);
    if (productsError) throw productsError;

    if (!productsList || productsList.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No services found for this organization yet — add a service first, then load test cases.",
      });
    }

    const { data: existingBatches, error: existingError } = await supabase
      .from("daily_work")
      .select("product_id")
      .eq("organization_id", orgId)
      .eq("work_date", workDate);
    if (existingError) throw existingError;
    const alreadyHasCase = new Set(
      (existingBatches || []).map((b) => b.product_id),
    );

    const toCreate = productsList.filter((p) => !alreadyHasCase.has(p.id));
    const newRows = toCreate.map((p) => ({
      organization_id: orgId,
      work_date: workDate,
      product_id: p.id,
      total_qty: 50 + Math.floor(Math.random() * 451), // 50-500
      status: "PENDING",
      created_by: req.user.userId,
    }));

    let inserted = [];
    if (newRows.length > 0) {
      const { data, error } = await supabase
        .from("daily_work")
        .insert(newRows)
        .select("*");
      if (error) throw error;
      inserted = data || [];
    }

    // Seed attendance too, but only if this date has none at all yet —
    // never touch a date someone has already marked for real.
    let attendanceSeeded = false;
    const { data: existingAttendance, error: attCheckError } = await supabase
      .from("attendance")
      .select("id")
      .eq("organization_id", orgId)
      .eq("attendance_date", workDate)
      .limit(1);
    if (attCheckError) throw attCheckError;

    if (!existingAttendance || existingAttendance.length === 0) {
      const { data: employeeRows, error: empError } = await supabase
        .from("user_master")
        .select("*")
        .eq("organization_id", orgId);
      if (empError) throw empError;

      const attRows = (employeeRows || [])
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
        const { error: attInsertError } = await supabase
          .from("attendance")
          .upsert(attRows, { onConflict: "employee_id,attendance_date" });
        if (attInsertError) throw attInsertError;
        attendanceSeeded = true;
      }
    }

    const productNames = productsList.reduce((acc, p) => {
      acc[p.id] = p.product_name;
      return acc;
    }, {});

    const data = inserted.map((row) =>
      mapRow(row, {
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

module.exports = {
  listDailyWork,
  getDailyWorkById,
  createDailyWork,
  updateDailyWork,
  deleteDailyWork,
  seedDummyCases,
};
