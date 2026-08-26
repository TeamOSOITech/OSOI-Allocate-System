// src/modules/servicecases/servicecases.controller.js
//
// "Case Register" — the second tab on the Daily Work page. Where Daily
// Work logs one BATCH row per service+date (e.g. "Billing, 10 units,
// 2026-08-19"), this logs one row PER INDIVIDUAL UNIT — so entering
// qty=10 for Billing creates 10 separate case rows, each with its own
// running case number like CASEB011, CASEB012, ... CASEB020.
//
// Numbering rules:
//   - Format: CASE + first letter of the service name (uppercased) +
//     a zero-padded sequence number, e.g. Billing -> CASEB001, TC -> CASET001.
//   - The sequence is a RUNNING COUNTER per organization+service — it
//     never resets by date. If Billing reached 10 yesterday, the next
//     case created today (for Billing) starts at 11, not 1.
//
// This is intentionally a completely separate table/module from
// dailywork.controller.js — Daily Work's own batches/allocations are
// untouched by any of this.

const supabase = require("../../config/supabaseClient");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

// ---------- brand theme (same palette as clients.controller.js) ----------
const BRAND = {
  blue: "FF204297",
  lightBlue: "FF08A1CE",
  white: "FFFFFFFF",
};

function styleHeaderCell(cell) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND.blue },
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

function firstLetterOf(name) {
  const trimmed = (name || "").toString().trim();
  const firstAlpha = trimmed.match(/[A-Za-z]/);
  return (firstAlpha ? firstAlpha[0] : "X").toUpperCase();
}

function formatCaseNumber(letter, sequenceNumber) {
  return `CASE${letter}${String(sequenceNumber).padStart(3, "0")}`;
}

// NEW: Case Register — Client column. Same shape as getProductNameMap
// above, just pointed at the clients table instead of service_master.
async function getClientNameMap(clientIds, organizationId) {
  const uniqueIds = [...new Set(clientIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) throw error;
  return (data || []).reduce((acc, c) => {
    acc[c.id] = c.name;
    return acc;
  }, {});
}

// NEW: same idea as getClientNameMap, for the Subclient column.
async function getSubclientNameMap(subclientIds, organizationId) {
  const uniqueIds = [...new Set(subclientIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("subclients")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) throw error;
  return (data || []).reduce((acc, s) => {
    acc[s.id] = s.name;
    return acc;
  }, {});
}

// NEW: validates a subclient exists, belongs to this org, and (if
// clientId is given) belongs to that specific client — used by both
// the client/subclient edit endpoint and the create endpoints so a
// case can never end up with a subclient that doesn't match its client.
async function validateSubclient(subclientId, organizationId, clientId) {
  const { data: subclient, error } = await supabase
    .from("subclients")
    .select("id, client_id")
    .eq("id", subclientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!subclient) return { ok: false, message: "Subclient not found" };
  if (clientId && String(subclient.client_id) !== String(clientId)) {
    return {
      ok: false,
      message: "Subclient does not belong to the selected client",
    };
  }
  return { ok: true };
}

async function getProduct(productId, organizationId) {
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// NEW: resolves ids of every service_master/clients/subclients row in
// this org whose name matches `term` (case-insensitive, partial) — used
// by listServiceCases' generic search box below so typing a client or
// service NAME (not just a case number) still finds matching cases.
async function findMatchingIds(table, nameColumn, term, organizationId) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("organization_id", organizationId)
    .ilike(nameColumn, `%${term}%`);
  if (error) throw error;
  return (data || []).map((r) => r.id);
}

// NEW: the Case Register search box accepts either the ISO date
// (2026-08-26) or the display date (26-08-2026) the table itself
// shows — this normalizes either into ISO so it can be matched
// exactly against the work_date column. Returns null if `term`
// doesn't look like a full date in either format.
function tryParseSearchDate(term) {
  const iso = term.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return term;
  const display = term.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  return null;
}

async function getProductNameMap(productIds, organizationId) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) throw error;
  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// NEW: Today's Allocation — "Cases" + "Employees" tabs.
//
// Cases created here (service_cases) can now be ALLOCATED to an
// employee, either one at a time (manual, from the Cases tab's per-row
// dropdown) or all at once (auto/smart, splitting every still-PENDING
// case for a service as evenly as possible across whoever is marked
// PRESENT for the day on the Employees tab — same `attendance` table
// Daily Work's Smart Allocation already reads).
//
// Requires two new columns on service_cases (see migration note below):
//   assigned_employee_id  uuid, nullable, references user_master
//   allocation_status     text, default 'PENDING' ('PENDING' | 'ALLOCATED')
//   allocated_at          timestamptz, nullable
// ------------------------------------------------------------

// Same manual-join pattern as allocations.controller.js's getUserInfoMap
// — user_master has no PostgREST FK relationship set up for service_cases
// to embed through, so names are fetched separately and merged in code.
async function getEmployeeNameMap(employeeIds, organizationId) {
  const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name"')
    .eq("organization_id", organizationId)
    .in("Auth User Id", uniqueIds);
  if (error) {
    console.error("Failed to fetch user_master for service cases:", error);
    return {};
  }
  return (data || []).reduce((acc, u) => {
    const firstName = u["First Name"] ?? "";
    const lastName = u["Last Name"] ?? "";
    acc[u["Auth User Id"]] = `${firstName} ${lastName}`.trim() || null;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// GET /api/service-cases
// Query params:
//   productId  (optional) — filter to one service
//   page       (default 1)
//   pageSize   (default 20)
// Returns newest-first, with total count for pagination.
// ------------------------------------------------------------
async function listServiceCases(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    // "mine=true" (the employee's own allocation page) loads everything
    // assigned to them in one go rather than paginating — that page
    // does its own today/past split and filtering client-side, same as
    // it already did for the old allocations-based table.
    const maxPageSize = req.query.mine === "true" ? 2000 : 100;
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
      maxPageSize,
    );

    // NEW: Case Register search box resolves to a few extra OR
    // conditions (matching service/client/subclient ids, matching
    // date) — computed once up front so both the count query and the
    // data query below can apply the exact same filters.
    let searchOrParts = null;
    if (req.query.search && req.query.search.trim()) {
      const term = req.query.search.trim();
      const [matchingProductIds, matchingClientIds, matchingSubclientIds] =
        await Promise.all([
          findMatchingIds(
            "service_master",
            "product_name",
            term,
            req.user.organizationId,
          ),
          findMatchingIds("clients", "name", term, req.user.organizationId),
          findMatchingIds("subclients", "name", term, req.user.organizationId),
        ]);
      const matchedDate = tryParseSearchDate(term);

      searchOrParts = [`case_number.ilike.%${term}%`];
      if (matchingProductIds.length) {
        searchOrParts.push(`product_id.in.(${matchingProductIds.join(",")})`);
      }
      if (matchingClientIds.length) {
        searchOrParts.push(`client_id.in.(${matchingClientIds.join(",")})`);
      }
      if (matchingSubclientIds.length) {
        searchOrParts.push(
          `subclient_id.in.(${matchingSubclientIds.join(",")})`,
        );
      }
      if (matchedDate) {
        searchOrParts.push(`work_date.eq.${matchedDate}`);
      }
    }

    // Applies every filter (productId, date range, client/subclient,
    // the search box's OR clause, etc.) to a freshly-created query
    // builder. Supabase-js query builders aren't cloneable, so this
    // gets called twice below — once for a count-only query, once for
    // the actual page of data — rather than trying to reuse one
    // builder instance for both.
    const applyFilters = (q) => {
      let filtered = q.eq("organization_id", req.user.organizationId);
      if (req.query.productId) {
        filtered = filtered.eq("product_id", req.query.productId);
      }
      // NEW: Cases tab filters — same work_date the Employees tab marks
      // attendance for, and allocation_status so "show only unallocated"
      // works without pulling every case ever logged.
      if (req.query.workDate) {
        filtered = filtered.eq("work_date", req.query.workDate);
      }
      // NEW: Production Reports — History (case-number) view filters.
      // Date-RANGE variant of the exact-match workDate above, so a
      // report page can pull "everything between two dates" instead of
      // one day at a time. Independent of workDate — pass whichever fits.
      if (req.query.workDateFrom) {
        filtered = filtered.gte("work_date", req.query.workDateFrom);
      }
      if (req.query.workDateTo) {
        filtered = filtered.lte("work_date", req.query.workDateTo);
      }
      // NEW: case-number search for the same History view — partial,
      // case-insensitive match so "b011" finds "CASEB011".
      if (req.query.caseNumber) {
        filtered = filtered.ilike("case_number", `%${req.query.caseNumber}%`);
      }
      if (req.query.clientId) {
        filtered = filtered.eq("client_id", req.query.clientId);
      }
      // NEW: Subclient filter — same idea as clientId above.
      if (req.query.subclientId) {
        filtered = filtered.eq("subclient_id", req.query.subclientId);
      }
      if (req.query.allocationStatus) {
        filtered = filtered.eq("allocation_status", req.query.allocationStatus);
      }
      // NEW: Case Register search box — one input that searches Case
      // Number, Service, Client, and Subclient (and the work date, in
      // either 2026-08-26 or 26-08-2026 form) all at once, across the
      // FULL result set (not just whatever page happens to be on
      // screen), same as the productId dropdown filter above. Runs as
      // one .or() so it stays an AND with every other filter applied.
      if (searchOrParts) {
        filtered = filtered.or(searchOrParts.join(","));
      }
      // NEW: "mine=true" — the employee's own Today's/Past Allocation
      // table on the Profile page. Scoped server-side to whoever is
      // authenticated (never trusts a client-supplied employee id),
      // same pattern as /api/allocations/self.
      if (req.query.mine === "true") {
        filtered = filtered.eq("assigned_employee_id", req.user.userId);
      }
      if (req.query.submissionStatus) {
        filtered = filtered.eq("submission_status", req.query.submissionStatus);
      }
      return filtered;
    };

    // NEW: guards against a 416 "Requested range not satisfiable" from
    // PostgREST — this can happen when a filter/search narrows the
    // result set out from under a page number the client had picked
    // for the previous (unfiltered/wider) view, e.g. a stale request
    // that still asks for page 2 right as a filter change on the
    // frontend cuts total results down to 4. Rather than surface that
    // as an error, clamp the requested page down to the last valid one
    // for this filtered set — the frontend's own page-reset logic
    // handles the common case, this is just a server-side safety net
    // for any request that still slips through with a stale page.
    const { count: filteredCount, error: countError } = await applyFilters(
      supabase
        .from("service_cases")
        .select("*", { count: "exact", head: true }),
    );
    if (countError) throw countError;

    const totalCount = filteredCount || 0;
    const lastValidPage = Math.max(Math.ceil(totalCount / pageSize), 1);
    const effectivePage = Math.min(page, lastValidPage);
    const from = (effectivePage - 1) * pageSize;
    const to = from + pageSize - 1;

    const query = applyFilters(
      supabase.from("service_cases").select("*", { count: "exact" }),
    )
      // FIX: ordering by created_at alone left ties unresolved when a
      // whole batch (e.g. 10 cases) was inserted in the same instant —
      // Postgres/PostgREST doesn't guarantee any particular order among
      // equal timestamps, so CASET010 could sort before CASET001. Adding
      // sequence_number as a tiebreaker (also descending, so within a
      // batch the highest/newest case number still shows first) makes
      // the order deterministic and correct every time.
      .order("created_at", { ascending: false })
      .order("sequence_number", { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = data || [];
    const productMap = await getProductNameMap(
      rows.map((r) => r.product_id),
      req.user.organizationId,
    );
    const employeeMap = await getEmployeeNameMap(
      rows.map((r) => r.assigned_employee_id),
      req.user.organizationId,
    );
    // NEW: Client column — resolves client_id on each case to its name,
    // same pattern as productMap/employeeMap above.
    const clientMap = await getClientNameMap(
      rows.map((r) => r.client_id),
      req.user.organizationId,
    );
    // NEW: Subclient column.
    const subclientMap = await getSubclientNameMap(
      rows.map((r) => r.subclient_id),
      req.user.organizationId,
    );

    const enriched = rows.map((r) => ({
      id: r.id,
      caseNumber: r.case_number,
      productId: r.product_id,
      productName: productMap[r.product_id] || null,
      clientId: r.client_id || null,
      clientName: clientMap[r.client_id] || null,
      subclientId: r.subclient_id || null,
      subclientName: subclientMap[r.subclient_id] || null,
      workDate: r.work_date,
      sequenceNumber: r.sequence_number,
      createdAt: r.created_at,
      assignedEmployeeId: r.assigned_employee_id || null,
      assignedEmployeeName: employeeMap[r.assigned_employee_id] || null,
      allocationStatus: r.allocation_status || "PENDING",
      allocatedAt: r.allocated_at || null,
      profile: r.profile || "",
      // NEW: employee's own submission of their work on this case —
      // separate from allocation_status (which just means "assigned to
      // someone"). 'SUBMITTED' once the assigned employee marks it done.
      submissionStatus: r.submission_status || "PENDING",
      submissionType: r.submission_type || null,
      queryText: r.query_text || "",
      submittedAt: r.submitted_at || null,
    }));

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page: effectivePage,
        pageSize,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / pageSize), 1),
      },
    });
  } catch (err) {
    console.error("listServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases
// body: { productId, quantity, workDate? }
//
// Creates `quantity` individual case rows for the service, continuing
// the running per-service sequence from wherever it last left off.
// ------------------------------------------------------------
async function createServiceCases(req, res) {
  try {
    const { productId } = req.body;
    const quantity = Number(req.body.quantity);
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);
    // NEW: Client can now be picked at creation time too (still editable
    // later from the table). Optional — null is fine, same as before.
    const clientId = req.body.clientId || null;
    // NEW: Subclient — only meaningful alongside a client, validated
    // below to actually belong to it.
    const subclientId = req.body.subclientId || null;

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a whole number greater than 0",
      });
    }
    // Sane upper bound on a single submission — protects against a
    // fat-fingered quantity trying to insert tens of thousands of rows
    // in one request.
    if (quantity > 2000) {
      return res.status(400).json({
        success: false,
        message: "quantity cannot exceed 2000 in a single submission",
      });
    }

    const product = await getProduct(productId, req.user.organizationId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }
    if (clientId) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (clientError) throw clientError;
      if (!client) {
        return res
          .status(404)
          .json({ success: false, message: "Client not found" });
      }
    }
    if (subclientId) {
      const subclientCheck = await validateSubclient(
        subclientId,
        req.user.organizationId,
        clientId,
      );
      if (!subclientCheck.ok) {
        return res
          .status(404)
          .json({ success: false, message: subclientCheck.message });
      }
    }
    const letter = firstLetterOf(product.product_name);

    // Running counter: highest sequence_number ever used for this
    // service in this org, regardless of date — that's what makes
    // numbering continue across days instead of resetting.
    const { data: maxRow, error: maxError } = await supabase
      .from("service_cases")
      .select("sequence_number")
      .eq("organization_id", req.user.organizationId)
      .eq("product_id", productId)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;

    const startSeq = (maxRow?.sequence_number || 0) + 1;

    const rowsToInsert = Array.from({ length: quantity }, (_, i) => {
      const seq = startSeq + i;
      return {
        organization_id: req.user.organizationId,
        product_id: productId,
        client_id: clientId,
        subclient_id: subclientId,
        work_date: workDate,
        sequence_number: seq,
        case_number: formatCaseNumber(letter, seq),
        created_by: req.user.userId,
      };
    });

    const { data, error } = await supabase
      .from("service_cases")
      .insert(rowsToInsert)
      .select();
    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `${quantity} case(s) created (${rowsToInsert[0].case_number} to ${
        rowsToInsert[rowsToInsert.length - 1].case_number
      }).`,
      data,
    });
  } catch (err) {
    console.error("createServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/upload
// multipart/form-data: file (.xlsx/.xls/.csv), productId, workDate
//
// Alternative to createServiceCases above for orgs that already have
// their own case numbering (e.g. a client-provided case ID) — instead
// of auto-generating CASEB001, CASEB002, ..., this reads a "Case
// Number" column from the uploaded sheet and creates one row per
// value, verbatim, all under the one Service + Date picked in the
// form (same as the quantity-based form — those two still come from
// the dropdown/date picker, not from the sheet).
//
// Case numbers are unique per organization (case_number is used as a
// lookup key elsewhere, e.g. bulkUpdateServiceCaseProfiles), so any
// value that already exists anywhere in this org, or repeats within
// the sheet itself, is skipped and reported back rather than failing
// the whole upload — same "row-by-row results" shape as the other
// bulk endpoints in this codebase (see subclients.controller.js).
// sequence_number still needs a value (NOT NULL, used for ordering),
// so it just continues this service's running counter same as the
// auto-generate flow — it's an internal ordinal only, it doesn't need
// to match anything in the case number text itself.
// ------------------------------------------------------------
// ------------------------------------------------------------
// GET /api/service-cases/upload/template
//
// NEW: sample .xlsx for Upload mode — "Case Number" column (required)
// plus the "Client Name" / "Subclient Name" columns uploadCustomServiceCases
// below reads. Client/Subclient are optional in the actual upload; the
// sample just shows the expected header names and one example row.
// ------------------------------------------------------------
async function downloadUploadTemplate(req, res) {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Cases");

    sheet.columns = [
      { header: "Case Number", key: "caseNumber", width: 22 },
      { header: "Client Name", key: "clientName", width: 26 },
      { header: "Subclient Name", key: "subclientName", width: 26 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    [1, 2, 3].forEach((col) => styleHeaderCell(headerRow.getCell(col)));

    sheet.addRows([
      {
        caseNumber: "CASEB011",
        clientName: "Acme Corp",
        subclientName: "Acme West",
      },
      { caseNumber: "CASEB012", clientName: "", subclientName: "" },
    ]);

    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=case_register_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("downloadUploadTemplate error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to generate template" });
  }
}

async function uploadCustomServiceCases(req, res) {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const { productId } = req.body;
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }

    const product = await getProduct(productId, req.user.organizationId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
    });

    if (!sheetRows.length) {
      return res
        .status(400)
        .json({ success: false, message: "Uploaded file has no data rows" });
    }

    const norm = (v) => (v || "").toString().trim();

    // Column is case-insensitive/whitespace-tolerant: accepts "Case
    // Number", "case number", "CaseNumber", etc. Falls back to the
    // first column in the sheet if nothing matches that header, so a
    // simple single-column sheet with any header still works.
    const firstRowKeys = Object.keys(sheetRows[0] || {});
    const caseNumberKey =
      firstRowKeys.find(
        (k) => k.replace(/\s+/g, "").toLowerCase() === "casenumber",
      ) || firstRowKeys[0];
    // NEW: optional "Client Name" / "Subclient Name" columns — bulk
    // upload now resolves Client + Subclient per row from the sheet
    // instead of one value picked for the whole batch. Both columns
    // are optional; a row with neither still creates fine, same as
    // before.
    const clientNameKey = firstRowKeys.find((k) =>
      ["clientname", "client"].includes(k.replace(/\s+/g, "").toLowerCase()),
    );
    const subclientNameKey = firstRowKeys.find((k) =>
      ["subclientname", "subclient"].includes(
        k.replace(/\s+/g, "").toLowerCase(),
      ),
    );

    const results = [];
    let createdCount = 0;
    let skippedCount = 0;

    if (sheetRows.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Upload cannot exceed 5000 rows at a time.",
      });
    }

    // Dedupe within the sheet itself first, keeping the first
    // occurrence's row number for reporting.
    const seenInFile = new Set();
    const candidates = [];
    sheetRows.forEach((row, i) => {
      const rowNum = i + 2;
      const caseNumber = norm(row[caseNumberKey]);
      if (!caseNumber) {
        skippedCount++;
        results.push({
          row: rowNum,
          caseNumber: "",
          status: "skipped",
          message: "Empty case number",
        });
        return;
      }
      if (seenInFile.has(caseNumber)) {
        skippedCount++;
        results.push({
          row: rowNum,
          caseNumber,
          status: "skipped",
          message: "Duplicate within uploaded file",
        });
        return;
      }
      seenInFile.add(caseNumber);
      candidates.push({
        row: rowNum,
        caseNumber,
        clientName: clientNameKey ? norm(row[clientNameKey]) : "",
        subclientName: subclientNameKey ? norm(row[subclientNameKey]) : "",
      });
    });

    // Check which of the surviving candidates already exist for THIS
    // service (product_id) — same case number is fine under a
    // different service, it only clashes within the same service.
    let existingSet = new Set();
    if (candidates.length > 0) {
      const { data: existingRows, error: existingErr } = await supabase
        .from("service_cases")
        .select("case_number")
        .eq("organization_id", req.user.organizationId)
        .eq("product_id", productId)
        .in(
          "case_number",
          candidates.map((c) => c.caseNumber),
        );
      if (existingErr) throw existingErr;
      existingSet = new Set((existingRows || []).map((r) => r.case_number));
    }

    const toInsert = [];
    candidates.forEach((c) => {
      if (existingSet.has(c.caseNumber)) {
        skippedCount++;
        results.push({
          row: c.row,
          caseNumber: c.caseNumber,
          status: "skipped",
          message: "Case number already exists for this service",
        });
      } else {
        toInsert.push(c);
      }
    });

    // NEW: resolve each row's Client Name / Subclient Name against the
    // org's actual clients/subclients — loaded once here rather than
    // per-row, since a sheet can be thousands of rows. A row whose
    // Client Name doesn't match anything is skipped outright (rather
    // than silently created client-less) so a typo'd name gets caught
    // instead of quietly losing its client link. A Subclient Name that
    // doesn't resolve is more forgiving — the case still gets created,
    // just without that subclient.
    let clientNameToId = new Map();
    let subclientKeyToId = new Map();
    const needsClientLookup = toInsert.some((c) => c.clientName);
    const needsSubclientLookup = toInsert.some((c) => c.subclientName);
    if (needsClientLookup || needsSubclientLookup) {
      const { data: orgClients, error: clientsErr } = await supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", req.user.organizationId);
      if (clientsErr) throw clientsErr;
      (orgClients || []).forEach((cl) => {
        clientNameToId.set(cl.name.trim().toLowerCase(), cl.id);
      });

      if (needsSubclientLookup) {
        const { data: orgSubclients, error: subErr } = await supabase
          .from("subclients")
          .select("id, name, client_id")
          .eq("organization_id", req.user.organizationId);
        if (subErr) throw subErr;
        (orgSubclients || []).forEach((s) => {
          subclientKeyToId.set(
            `${s.client_id}::${s.name.trim().toLowerCase()}`,
            s.id,
          );
        });
      }
    }

    const resolved = [];
    toInsert.forEach((c) => {
      let clientId = null;
      if (c.clientName) {
        clientId = clientNameToId.get(c.clientName.toLowerCase()) || null;
        if (!clientId) {
          skippedCount++;
          results.push({
            row: c.row,
            caseNumber: c.caseNumber,
            status: "skipped",
            message: `Client not found: "${c.clientName}"`,
          });
          return;
        }
      }
      let subclientId = null;
      if (c.subclientName && clientId) {
        subclientId =
          subclientKeyToId.get(
            `${clientId}::${c.subclientName.toLowerCase()}`,
          ) || null;
      }
      resolved.push({ ...c, clientId, subclientId });
    });

    if (resolved.length > 0) {
      const { data: maxRow, error: maxError } = await supabase
        .from("service_cases")
        .select("sequence_number")
        .eq("organization_id", req.user.organizationId)
        .eq("product_id", productId)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError) throw maxError;

      const startSeq = (maxRow?.sequence_number || 0) + 1;

      const rowsToInsert = resolved.map((c, i) => ({
        organization_id: req.user.organizationId,
        product_id: productId,
        client_id: c.clientId,
        subclient_id: c.subclientId,
        work_date: workDate,
        sequence_number: startSeq + i,
        case_number: c.caseNumber,
        created_by: req.user.userId,
      }));

      const { error: insertError } = await supabase
        .from("service_cases")
        .insert(rowsToInsert);
      if (insertError) throw insertError;

      createdCount = resolved.length;
      resolved.forEach((c) => {
        results.push({
          row: c.row,
          caseNumber: c.caseNumber,
          status: "created",
        });
      });
    }

    res.status(201).json({
      success: true,
      message: `${createdCount} case(s) created.${
        skippedCount ? ` ${skippedCount} row(s) skipped.` : ""
      }`,
      data: {
        totalRows: sheetRows.length,
        createdCount,
        skippedCount,
        results,
      },
    });
  } catch (err) {
    console.error("uploadCustomServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/manual
// application/json: { productId, workDate, clientId, subclientId, caseNumbers: string[] }
//
// Replaces the old quantity-based "Auto-generate" flow (createServiceCases
// above). Instead of the system inventing CASEB001, CASEB002, ... on its
// own, the person types the actual case numbers themselves — one per
// line/comma in the textarea on the frontend, sent here as an array.
// Supports at least 10 case numbers typed in at once (the frontend caps
// the textarea at 10 lines; this endpoint itself allows up to 500 so a
// slightly larger paste still works).
//
// Same uniqueness rule as uploadCustomServiceCases: case_number is
// unique per organization, so duplicates (within the request or already
// in the DB) are skipped and reported back rather than failing the
// whole submission.
// ------------------------------------------------------------
async function manualCreateServiceCases(req, res) {
  try {
    const { productId } = req.body;
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);
    const clientId = req.body.clientId || null;
    const subclientId = req.body.subclientId || null;
    const rawCaseNumbers = Array.isArray(req.body.caseNumbers)
      ? req.body.caseNumbers
      : [];

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }
    if (!rawCaseNumbers.length) {
      return res
        .status(400)
        .json({ success: false, message: "Enter at least one case number" });
    }
    if (rawCaseNumbers.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Cannot submit more than 500 case numbers at a time",
      });
    }

    const product = await getProduct(productId, req.user.organizationId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }
    if (clientId) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (clientError) throw clientError;
      if (!client) {
        return res
          .status(404)
          .json({ success: false, message: "Client not found" });
      }
    }
    if (subclientId) {
      const subclientCheck = await validateSubclient(
        subclientId,
        req.user.organizationId,
        clientId,
      );
      if (!subclientCheck.ok) {
        return res
          .status(404)
          .json({ success: false, message: subclientCheck.message });
      }
    }

    const norm = (v) => (v || "").toString().trim();

    // Dedupe within the submitted list first, keeping the first
    // occurrence — same pattern as the Upload flow.
    const seen = new Set();
    const results = [];
    const candidates = [];
    rawCaseNumbers.forEach((raw, i) => {
      const caseNumber = norm(raw);
      if (!caseNumber) return; // silently skip blank lines
      if (seen.has(caseNumber)) {
        results.push({
          caseNumber,
          status: "skipped",
          message: "Duplicate in this submission",
        });
        return;
      }
      seen.add(caseNumber);
      candidates.push({ row: i + 1, caseNumber });
    });

    if (!candidates.length) {
      return res
        .status(400)
        .json({ success: false, message: "Enter at least one case number" });
    }

    // Duplicate check is scoped to THIS service only (product_id) —
    // the same case number is allowed to exist under a different
    // service in the same org; it only clashes if it already exists
    // for this same service.
    let existingSet = new Set();
    const { data: existingRows, error: existingErr } = await supabase
      .from("service_cases")
      .select("case_number")
      .eq("organization_id", req.user.organizationId)
      .eq("product_id", productId)
      .in(
        "case_number",
        candidates.map((c) => c.caseNumber),
      );
    if (existingErr) throw existingErr;
    existingSet = new Set((existingRows || []).map((r) => r.case_number));

    const toInsert = [];
    candidates.forEach((c) => {
      if (existingSet.has(c.caseNumber)) {
        results.push({
          caseNumber: c.caseNumber,
          status: "skipped",
          message: "Case number already exists for this service",
        });
      } else {
        toInsert.push(c);
      }
    });

    let createdCount = 0;
    if (toInsert.length > 0) {
      const { data: maxRow, error: maxError } = await supabase
        .from("service_cases")
        .select("sequence_number")
        .eq("organization_id", req.user.organizationId)
        .eq("product_id", productId)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError) throw maxError;

      const startSeq = (maxRow?.sequence_number || 0) + 1;

      const rowsToInsert = toInsert.map((c, i) => ({
        organization_id: req.user.organizationId,
        product_id: productId,
        client_id: clientId,
        subclient_id: subclientId,
        work_date: workDate,
        sequence_number: startSeq + i,
        case_number: c.caseNumber,
        created_by: req.user.userId,
      }));

      const { error: insertError } = await supabase
        .from("service_cases")
        .insert(rowsToInsert);
      if (insertError) throw insertError;

      createdCount = toInsert.length;
      toInsert.forEach((c) => {
        results.push({ caseNumber: c.caseNumber, status: "created" });
      });
    }

    const skippedCount = results.filter((r) => r.status === "skipped").length;
    // NEW: spell out exactly WHY things were skipped instead of just a
    // bare count — the already-exists case in particular is the one
    // people keep re-typing by mistake, so it gets called out by
    // case number rather than left as a generic "X skipped".
    const alreadyExisting = results
      .filter(
        (r) =>
          r.status === "skipped" && r.message === "Case number already exists",
      )
      .map((r) => r.caseNumber);
    const duplicateInRequest = results
      .filter(
        (r) =>
          r.status === "skipped" &&
          r.message === "Duplicate in this submission",
      )
      .map((r) => r.caseNumber);

    let message = `${createdCount} case(s) created.`;
    if (alreadyExisting.length) {
      message += ` This case number already exists: ${alreadyExisting.join(", ")}.`;
    }
    if (duplicateInRequest.length) {
      message += ` Typed more than once: ${duplicateInRequest.join(", ")}.`;
    }

    res.status(201).json({
      success: true,
      message,
      data: {
        totalRows: rawCaseNumbers.length,
        createdCount,
        skippedCount,
        results,
      },
    });
  } catch (err) {
    console.error("manualCreateServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/service-cases/:id
// Removes a single case row. Deliberately does NOT touch or renumber
// any other case for that service — sequence numbers are a running,
// ever-increasing log (like an invoice number), not a dense 1..N range,
// so deleting #7 leaves a gap rather than shifting #8, #9, ... down.
// ------------------------------------------------------------
async function deleteServiceCase(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("service_cases")
      .delete()
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    res.json({ success: true, message: `${data.case_number} deleted.` });
  } catch (err) {
    console.error("deleteServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/allocate
// body: { employeeId }  — employeeId: null/"" un-allocates the case
// back to PENDING; any other value must be a real user_master row in
// this org (checked below) and assigns the case to them.
//
// This is the "Cases" tab's per-row manual allocate dropdown.
// ------------------------------------------------------------
async function allocateServiceCase(req, res) {
  try {
    const { id } = req.params;
    const employeeId = req.body.employeeId || null;

    if (employeeId) {
      const { data: emp, error: empError } = await supabase
        .from("user_master")
        .select('"Auth User Id"')
        .eq("Auth User Id", employeeId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (empError) throw empError;
      if (!emp) {
        return res
          .status(404)
          .json({ success: false, message: "Employee not found" });
      }
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        assigned_employee_id: employeeId,
        allocation_status: employeeId ? "ALLOCATED" : "PENDING",
        allocated_at: employeeId ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    const employeeMap = await getEmployeeNameMap(
      [data.assigned_employee_id],
      req.user.organizationId,
    );

    res.json({
      success: true,
      message: employeeId
        ? `${data.case_number} allocated.`
        : `${data.case_number} un-allocated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        assignedEmployeeId: data.assigned_employee_id || null,
        assignedEmployeeName: employeeMap[data.assigned_employee_id] || null,
        allocationStatus: data.allocation_status || "PENDING",
        allocatedAt: data.allocated_at || null,
      },
    });
  } catch (err) {
    console.error("allocateServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/auto-allocate
// body: { productId, workDate, employeeIds: [...] }
//
// "Smart Allocation" for the Cases tab: takes every still-PENDING case
// for the given service+date and splits them as evenly as possible,
// round-robin, across the given employee list — the same people marked
// PRESENT on the Employees tab. Case #1 to employee #1, #2 to #2, ...
// wrapping back to #1 once the employee list is exhausted, so counts
// differ by at most 1 across employees.
// ------------------------------------------------------------
async function autoAllocateServiceCases(req, res) {
  try {
    const { productId, workDate } = req.body;
    const employeeIds = Array.isArray(req.body.employeeIds)
      ? [...new Set(req.body.employeeIds.filter(Boolean))]
      : [];

    if (!productId || !workDate) {
      return res.status(400).json({
        success: false,
        message: "productId and workDate are required",
      });
    }
    if (employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No employees found to allocate to.",
      });
    }

    const { data: pendingCases, error } = await supabase
      .from("service_cases")
      .select("id, case_number, sequence_number")
      .eq("organization_id", req.user.organizationId)
      .eq("product_id", productId)
      .eq("work_date", workDate)
      .eq("allocation_status", "PENDING")
      .order("sequence_number", { ascending: true });
    if (error) throw error;

    if (!pendingCases || pendingCases.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending cases to allocate for this service/date.",
      });
    }

    const now = new Date().toISOString();
    const updates = pendingCases.map((c, idx) => ({
      id: c.id,
      caseNumber: c.case_number,
      employeeId: employeeIds[idx % employeeIds.length],
    }));

    // Supabase JS has no bulk "update many rows with different values"
    // in one call, so this fires one update per case — fine at the
    // scale a single day's case list runs at (Daily Work caps a single
    // submission at 2000 cases).
    await Promise.all(
      updates.map((u) =>
        supabase
          .from("service_cases")
          .update({
            assigned_employee_id: u.employeeId,
            allocation_status: "ALLOCATED",
            allocated_at: now,
          })
          .eq("id", u.id)
          .eq("organization_id", req.user.organizationId),
      ),
    );

    const employeeMap = await getEmployeeNameMap(
      employeeIds,
      req.user.organizationId,
    );
    // Per-employee summary — how many cases + which case numbers each
    // employee ended up with, so the UI can show it right after running
    // Smart Allocation without a second fetch.
    const perEmployee = employeeIds.map((empId) => {
      const cases = updates.filter((u) => u.employeeId === empId);
      return {
        employeeId: empId,
        employeeName: employeeMap[empId] || null,
        caseCount: cases.length,
        caseNumbers: cases.map((c) => c.caseNumber),
      };
    });

    res.json({
      success: true,
      message: `${updates.length} case(s) allocated across ${employeeIds.length} employee(s).`,
      data: { allocatedCount: updates.length, perEmployee },
    });
  } catch (err) {
    console.error("autoAllocateServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// NEW: Profile — free-text value attached to a case, keyed by case
// number (same way employee allocation works, just a plain text field
// instead of a dropdown). Two ways to set it, both from the Case
// Register page:
//   1. Single — PATCH /:id/profile, one case at a time.
//   2. Bulk upload — POST /bulk-profile, a CSV of (case number,
//      profile) pairs parsed on the frontend and sent as JSON here,
//      matched by case_number within the org and updated together.
//
// Requires a new column on service_cases (see migration note below):
//   profile  text, nullable
// ------------------------------------------------------------

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/profile
// body: { profile: string }
// ------------------------------------------------------------
async function updateServiceCaseProfile(req, res) {
  try {
    const { id } = req.params;
    const profile = (req.body.profile ?? "").toString().trim();

    const { data, error } = await supabase
      .from("service_cases")
      .update({ profile })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    res.json({
      success: true,
      message: `${data.case_number} profile updated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        profile: data.profile || "",
      },
    });
  } catch (err) {
    console.error("updateServiceCaseProfile error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/client
// body: { clientId }
//
// NEW: Case Register table's inline-editable Client column. Only the
// client link is editable in place — case number, service, and date
// stay read-only, set once at creation time. Passing clientId: null
// (or "") clears the client on the case.
// ------------------------------------------------------------
// ------------------------------------------------------------
// PATCH /api/service-cases/:id/client
// body: { clientId?, subclientId? }
//
// Case Register table's inline-editable Client + Subclient columns.
// Only these two are editable in place — case number, service, and
// date stay read-only, set once at creation time. Either field is
// optional in the body; only the ones actually sent get changed.
// Passing clientId: null (or "") clears the client (and, per the rule
// below, the subclient along with it — a subclient can't outlive the
// client it belongs to).
// ------------------------------------------------------------
async function updateServiceCaseClient(req, res) {
  try {
    const { id } = req.params;

    const { data: existing, error: existingError } = await supabase
      .from("service_cases")
      .select("id, case_number, client_id, subclient_id")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    const bodyHasClient = Object.prototype.hasOwnProperty.call(
      req.body,
      "clientId",
    );
    const bodyHasSubclient = Object.prototype.hasOwnProperty.call(
      req.body,
      "subclientId",
    );

    const nextClientId = bodyHasClient
      ? req.body.clientId || null
      : existing.client_id;

    if (bodyHasClient && nextClientId) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", nextClientId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (clientError) throw clientError;
      if (!client) {
        return res
          .status(404)
          .json({ success: false, message: "Client not found" });
      }
    }

    // NEW: Subclient — a client change with no explicit subclient in
    // the same request clears the old subclient (it belonged to the
    // previous client and can't be assumed valid under the new one).
    let nextSubclientId = bodyHasSubclient
      ? req.body.subclientId || null
      : bodyHasClient && String(nextClientId) !== String(existing.client_id)
        ? null
        : existing.subclient_id;

    if (nextSubclientId) {
      const subclientCheck = await validateSubclient(
        nextSubclientId,
        req.user.organizationId,
        nextClientId,
      );
      if (!subclientCheck.ok) {
        return res
          .status(404)
          .json({ success: false, message: subclientCheck.message });
      }
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ client_id: nextClientId, subclient_id: nextSubclientId })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    const clientMap = await getClientNameMap(
      [data.client_id],
      req.user.organizationId,
    );
    const subclientMap = await getSubclientNameMap(
      [data.subclient_id],
      req.user.organizationId,
    );

    res.json({
      success: true,
      message: `${data.case_number} updated.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        clientId: data.client_id || null,
        clientName: clientMap[data.client_id] || null,
        subclientId: data.subclient_id || null,
        subclientName: subclientMap[data.subclient_id] || null,
      },
    });
  } catch (err) {
    console.error("updateServiceCaseClient error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/bulk-profile
// body: { rows: [{ caseNumber, profile }, ...] }
//
// Bulk-upload counterpart of the above — matches each row to an
// existing case by case_number (within this org) and sets its
// profile value. Case numbers that don't match any row are reported
// back as "notFound" rather than failing the whole request, so one
// typo in a 200-row CSV doesn't block the other 199.
// ------------------------------------------------------------
async function bulkUpdateServiceCaseProfiles(req, res) {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const cleaned = rows
      .map((r) => ({
        caseNumber: (r.caseNumber || "").toString().trim(),
        profile: (r.profile ?? "").toString().trim(),
      }))
      .filter((r) => r.caseNumber);

    if (cleaned.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid rows to upload — each row needs a case number.",
      });
    }
    if (cleaned.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Bulk upload cannot exceed 5000 rows at a time.",
      });
    }

    const caseNumbers = cleaned.map((r) => r.caseNumber);
    const { data: existing, error: fetchError } = await supabase
      .from("service_cases")
      .select("id, case_number")
      .eq("organization_id", req.user.organizationId)
      .in("case_number", caseNumbers);
    if (fetchError) throw fetchError;

    const idByCaseNumber = (existing || []).reduce((acc, row) => {
      acc[row.case_number] = row.id;
      return acc;
    }, {});

    const notFound = [];
    const toUpdate = [];
    cleaned.forEach((r) => {
      const id = idByCaseNumber[r.caseNumber];
      if (!id) {
        notFound.push(r.caseNumber);
      } else {
        toUpdate.push({ id, caseNumber: r.caseNumber, profile: r.profile });
      }
    });

    await Promise.all(
      toUpdate.map((u) =>
        supabase
          .from("service_cases")
          .update({ profile: u.profile })
          .eq("id", u.id)
          .eq("organization_id", req.user.organizationId),
      ),
    );

    res.json({
      success: true,
      message: `${toUpdate.length} case(s) updated.${
        notFound.length ? ` ${notFound.length} case number(s) not found.` : ""
      }`,
      data: {
        updatedCount: toUpdate.length,
        notFound,
      },
    });
  } catch (err) {
    console.error("bulkUpdateServiceCaseProfiles error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// NEW: Employee self-submit — the "Today's Allocation"/"Past
// Allocation" table on the Profile page now lists individual cases
// (case-number wise, like the admin Cases tab) instead of quantity
// batches. Since a case is one atomic unit of work, submitting it is
// a single click — no partial quantity or mismatch-reason step like
// the old daily_work batch flow needed.
//
// Requires four columns on service_cases (see migration note):
//   submission_status  text, default 'PENDING' ('PENDING' | 'SUBMITTED')
//   submission_type    text ('COMPLETED' | 'DONE_BY_TEAM' | 'QUERY')
//   query_text         text, nullable
//   submitted_at       timestamptz, nullable
// ------------------------------------------------------------

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/submit
// body: { submissionType: 'COMPLETED' | 'DONE_BY_TEAM' | 'QUERY', queryText?: string }
//
// Every submission records an outcome, not just "submitted":
//   'COMPLETED'    — completed (by the employee themself).
//   'DONE_BY_TEAM' — completed, but by the team rather than the
//                    employee directly. Kept separate from 'COMPLETED'.
//   'QUERY'        — couldn't be completed as-is; queryText carries
//                    what the query actually is (required in this case).
// ------------------------------------------------------------
async function submitServiceCase(req, res) {
  try {
    const { id } = req.params;
    const submissionType = (req.body.submissionType || "").toString().trim();
    const queryText = (req.body.queryText || "").toString().trim();

    if (!["COMPLETED", "DONE_BY_TEAM", "QUERY"].includes(submissionType)) {
      return res.status(400).json({
        success: false,
        message:
          "submissionType must be 'COMPLETED', 'DONE_BY_TEAM' or 'QUERY'.",
      });
    }
    if (submissionType === "QUERY" && !queryText) {
      return res.status(400).json({
        success: false,
        message: "queryText is required when submissionType is 'QUERY'.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        submission_status: "SUBMITTED",
        submission_type: submissionType,
        query_text: submissionType === "QUERY" ? queryText : null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      // Self-service — can only ever submit a case assigned to you,
      // regardless of what id is in the URL.
      .eq("assigned_employee_id", req.user.userId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Case not found or not assigned to you.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} submitted.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        submissionStatus: data.submission_status,
        submissionType: data.submission_type,
        queryText: data.query_text,
        submittedAt: data.submitted_at,
      },
    });
  } catch (err) {
    console.error("submitServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/bulk-submit
// body: { items: [{ id, submissionType, queryText }, ...] }
// Same as above but for many cases at once — the "Bulk Submit" button
// on the Profile page. Each case picks its own outcome (every row in
// the modal has its own dropdown), so this takes an items array rather
// than a flat list of ids.
// ------------------------------------------------------------
async function bulkSubmitServiceCases(req, res) {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const cleaned = items
      .map((it) => ({
        id: (it.id || "").toString(),
        submissionType: (it.submissionType || "").toString().trim(),
        queryText: (it.queryText || "").toString().trim(),
      }))
      .filter((it) => it.id);

    if (cleaned.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No cases provided." });
    }
    for (const it of cleaned) {
      if (!["COMPLETED", "DONE_BY_TEAM", "QUERY"].includes(it.submissionType)) {
        return res.status(400).json({
          success: false,
          message:
            "Every case needs a status of 'Completed', 'Done by Team' or 'Query'.",
        });
      }
      if (it.submissionType === "QUERY" && !it.queryText) {
        return res.status(400).json({
          success: false,
          message: "Every case marked 'Query' needs its query text filled in.",
        });
      }
    }

    const now = new Date().toISOString();
    let submittedCount = 0;
    // One update per case since each can have a different outcome —
    // still all scoped to (org, caller) so this can only ever touch
    // the caller's own cases, same guarantee as the single-submit path.
    await Promise.all(
      cleaned.map(async (it) => {
        const { data, error } = await supabase
          .from("service_cases")
          .update({
            submission_status: "SUBMITTED",
            submission_type: it.submissionType,
            query_text: it.submissionType === "QUERY" ? it.queryText : null,
            submitted_at: now,
          })
          .eq("id", it.id)
          .eq("organization_id", req.user.organizationId)
          .eq("assigned_employee_id", req.user.userId)
          .select("id");
        if (error) throw error;
        if (data && data.length > 0) submittedCount++;
      }),
    );

    res.json({
      success: true,
      message: `${submittedCount} case(s) submitted.`,
      data: { submittedCount },
    });
  } catch (err) {
    console.error("bulkSubmitServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listServiceCases,
  createServiceCases,
  manualCreateServiceCases,
  uploadCustomServiceCases,
  downloadUploadTemplate,
  deleteServiceCase,
  allocateServiceCase,
  autoAllocateServiceCases,
  updateServiceCaseProfile,
  updateServiceCaseClient,
  bulkUpdateServiceCaseProfiles,
  submitServiceCase,
  bulkSubmitServiceCases,
};
