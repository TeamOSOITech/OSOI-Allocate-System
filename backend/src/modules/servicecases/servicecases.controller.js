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
//
// MODIFIED in this version:
//   - NEW (NOTIFY): POST /api/service-cases/notify-allocation
//     (notifyAllocation below). Sends every employee who got new work ONE
//     email: "Your work has been allocated today. Please login to check."
//     It never contains how many cases they got.
//   - NEW (NOTIFY ONCE): an employee is mailed only the FIRST time work is
//     allocated to them for a given work date. Later allocations on the
//     same date (Smart Allocation run again, more cases added) send no
//     new mail. Tracked in the allocation_notifications table (see the
//     SQL in the comment above notifyAllocation).
//   - Email redesign: "Work Allocated Today" heading, pill button
//     "Login to Alookate", Logo2.png above the message, "Alookate" branding.

const supabase = require("../../config/supabaseClient");
// MODIFIED: fair rotation (extra case goes to whoever got the least work
// in the last 30 days) — now used by the case-number Smart Allocation too.
const { getRecentLoad, orderByLeastLoad } = require("./fairness");
// SECURITY FIX: replaced the `xlsx` (SheetJS) package — see
// src/utils/parseSpreadsheet.js for why.
const { parseSpreadsheetRows } = require("../../utils/parseSpreadsheet");
const ExcelJS = require("exceljs");
// NEW: a client can only be used on a service it is mapped to.
const {
  getMappedClientIds,
  assertClientMappedToProduct,
} = require("./serviceClients");
// NEW (NOTIFY): self-contained Brevo mail sender (no extra file/package
// needed — Node 18+ has fetch built in). Uses the same Brevo account as
// reset-password / signup emails. .env keys used:
//   BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME (optional)
// Agar tumhare .env mein in keys ke naam alag hain to yaha badal do.
async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) {
    throw new Error("BREVO_API_KEY / BREVO_SENDER_EMAIL missing in .env");
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        // CHANGED: "Allocate" -> "Alookate"
        name: process.env.BREVO_SENDER_NAME || "Alookate",
      },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

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

// NEW: Auto Generate mode — person types their own prefix (e.g. "12F")
// instead of using the default CASE+letter format, and numbering for
// THAT prefix starts at 001 (padded to at least 3 digits, grows past
// 999 automatically). Escapes regex-special characters so a prefix
// like "A.B" can't break the lookup below.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Looks at every case_number already used in this org that starts with
// `prefix` immediately followed by digits (e.g. prefix "12F0" matches
// "12F0001", "12F0002", ... but not "12F0OO1"), and returns one past the
// highest number found — or 1 if this prefix has never been used before.
async function getNextPrefixNumber(
  prefix,
  organizationId /*, productId (unused) */,
) {
  // Case numbers are unique per ORGANIZATION (not per service), so the
  // counter is org-wide. Paged because Supabase returns max 1000 rows
  // per request — without this the max could be under-counted and a
  // duplicate generated once a prefix passes 1000 cases.
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, "i");
  let max = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("service_cases")
      .select("case_number")
      .eq("organization_id", organizationId)
      .ilike("case_number", `${prefix}%`)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    (data || []).forEach((row) => {
      const m = (row.case_number || "").match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    });
    if (!data || data.length < PAGE) break;
  }
  return max + 1;
}

// NEW: automatic prefix = first 3 letters of the company (organization)
// name + 3-letter month + 4-digit year of the selected work date,
// e.g. "Northstar Consulting", 30-09-2026 -> "NORSEP2026", so the
// generated case numbers look like NORSEP2026001, NORSEP2026002, ...
const MONTH_ABBR = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
async function buildAutoPrefix(organizationId, workDate) {
  const { data: org, error } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  const letters = (org?.name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const company = (letters || "ORG").slice(0, 3);
  const d = /^\d{4}-\d{2}-\d{2}/.test(workDate || "")
    ? new Date(`${workDate.slice(0, 10)}T00:00:00Z`)
    : new Date();
  return `${company}${MONTH_ABBR[d.getUTCMonth()]}${d.getUTCFullYear()}`;
}

// GET /api/service-cases/auto-prefix?workDate=YYYY-MM-DD
// Preview for the Auto Generate form: the prefix + next free number.
async function getAutoPrefix(req, res) {
  try {
    const prefix = await buildAutoPrefix(
      req.user.organizationId,
      req.query.workDate,
    );
    const next = await getNextPrefixNumber(prefix, req.user.organizationId);
    res.json({
      success: true,
      data: {
        prefix,
        nextCaseNumber: `${prefix}${String(next).padStart(3, "0")}`,
      },
    });
  } catch (err) {
    console.error("getAutoPrefix error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// NEW: Case Register — Client column. Same shape as getProductNameMap
// below, just pointed at the clients table instead of service_master.
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

// NEW: splits an array into fixed-size chunks — used below so a huge
// case-number list doesn't get crammed into one giant query filter.
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// FIX: guards the exact-match use of `ilike` below (no % added) against
// SQL LIKE's own wildcard characters appearing INSIDE a real case
// number ("_" = any one char, "%" = any run of chars). Escaping them
// with a backslash makes the match exact-character, case-insensitive
// only (as intended for a duplicate check).
function escapeLikeWildcards(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// FIX: case-insensitive duplicate detection for case numbers. `ilike`
// WITHOUT any % wildcards does an exact but case-insensitive match, so
// "CASEB021" and "caseb021" are treated as the same case number while
// still storing whatever casing the person actually typed. Batches
// candidates into chunks of 150 so a large upload doesn't build one
// unworkably long filter string.
//
// MODIFIED: now checks the WHOLE ORGANIZATION (product_id filter removed).
// Case numbers are unique per organization everywhere else in this file
// (updateServiceCaseNumber, getNextPrefixNumber, the DB unique constraint),
// so a per-service check let a duplicate through and then the insert failed
// with a 23505 -> HTTP 500 for the whole batch. `productId` is kept in the
// signature only so existing callers don't change.
async function findExistingCaseNumbersCI(
  caseNumbers,
  productId, // unused — case numbers are org-wide unique
  organizationId,
) {
  const found = new Set();
  const chunks = chunkArray(caseNumbers, 150);
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const orExpr = chunk
        .map(
          (cn) =>
            `case_number.ilike.${escapeOrFilterValue(escapeLikeWildcards(cn))}`,
        )
        .join(",");
      const { data, error } = await supabase
        .from("service_cases")
        .select("case_number")
        .eq("organization_id", organizationId)
        .or(orExpr);
      if (error) throw error;
      return data || [];
    }),
  );
  results.flat().forEach((r) => found.add(r.case_number.toUpperCase()));
  return found;
}

async function getProduct(productId, organizationId) {
  const { data, error } = await supabase
    .from("service_master")
    // NEW: `teams` too — needed by assertVerticalHeadCanUseProduct below
    // to check a Vertical Head is only ever creating cases against a
    // service their own team is assigned to.
    .select("id, product_name, teams")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// NEW: Vertical Head can create cases (Log Cases — Manual Entry, Auto
// Generate, Upload) same as Ops Manager/Process Lead/Super Admin
// (tasks.allocate.team grants the route), but ONLY for a service their
// own team is assigned to — never any other team's service. The Service
// dropdown on the frontend already only ever shows their team's
// services (GET /api/products scopes the list the same way — see
// products.controller.js's scopeProductsForVerticalHead), so this is
// belt-and-suspenders: it stops a Vertical Head from creating a case
// for an out-of-team service by calling the API directly with a
// productId that was never actually in their dropdown. Every other
// role is unaffected — returns true immediately for them.
async function assertVerticalHeadCanUseProduct(req, product) {
  if (req.user.role !== "VERTICAL_HEAD") return { ok: true };

  const { data: self } = await supabase
    .from("user_master")
    .select('"Worked In Teams"')
    .eq("Auth User Id", req.user.userId)
    .eq("organization_id", req.user.organizationId)
    .maybeSingle();

  const ownTeam = (self?.["Worked In Teams"] || "").trim().toLowerCase();
  const productTeams = (product?.teams || []).map((t) =>
    (t || "").trim().toLowerCase(),
  );

  if (!ownTeam || !productTeams.includes(ownTeam)) {
    return {
      ok: false,
      message: "Access denied — this service isn't assigned to your team.",
    };
  }
  return { ok: true };
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

// NEW: the Case Register search box passes its raw text straight into a
// PostgREST `.or()` filter string below, where commas and parentheses
// are the DSL's own separators/grouping characters. Per PostgREST's
// escaping rules, wrapping the value in double quotes (and escaping any
// literal double quote inside it) makes it safe again.
function escapeOrFilterValue(value) {
  if (/[,()"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

// FIX: accepts '-', '/', or '.' as the separator in either order (ISO
// year-first, or day-first — the convention the rest of this app's
// date-tag search already used).
function tryParseSearchDate(term) {
  const t = term.trim();
  // Year-first: 2026-09-02 / 2026/09/02 / 2026.09.02
  const iso = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    if (isValidYmd(y, m, d))
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Day-first: 02-09-2026 / 02/09/2026 / 02.09.2026
  const display = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (display) {
    const [, d, m, y] = display;
    if (isValidYmd(y, m, d))
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function isValidYmd(y, m, d) {
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
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
// Today's Allocation — "Cases" + "Employees" tabs.
//
// Cases created here (service_cases) can be ALLOCATED to an employee,
// either one at a time (manual, from the Cases tab's per-row dropdown)
// or all at once (auto/smart).
//
// Requires columns on service_cases:
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
    const maxPageSize =
      req.query.mine === "true" || req.query.employeeId ? 2000 : 100;
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

      searchOrParts = [`case_number.ilike.${escapeOrFilterValue(`%${term}%`)}`];
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
      // NEW: Cases tab's Smart Allocation/Clear row search — also
      // matches allocation_status by typing "pending" or "allocated",
      // so the same one box covers Case/Client/Subclient/Service/Date
      // AND Status.
      const lowerTerm = term.toLowerCase();
      if (
        "pending".startsWith(lowerTerm) ||
        "unallocated".startsWith(lowerTerm)
      ) {
        searchOrParts.push("allocation_status.eq.PENDING");
      }
      if ("allocated".startsWith(lowerTerm)) {
        searchOrParts.push("allocation_status.eq.ALLOCATED");
      }
    }

    // Applies every filter (productId, date range, client/subclient,
    // the search box's OR clause, etc.) to a freshly-created query
    // builder. Supabase-js query builders aren't cloneable, so this
    // gets called twice below — once for a count-only query, once for
    // the actual page of data.
    const applyFilters = (q) => {
      let filtered = q.eq("organization_id", req.user.organizationId);
      if (req.query.productId) {
        filtered = filtered.eq("product_id", req.query.productId);
      }
      // Cases tab filters — same work_date the Employees tab marks
      // attendance for, and allocation_status so "show only unallocated"
      // works without pulling every case ever logged.
      //
      // includeBacklog=true (sent only by the Cases/Today's Allocation
      // tab) widens the exact-date match into: this exact date (any
      // status) OR an earlier date that's STILL PENDING. Other pages
      // (Case Register, History, QC, Audit) don't send this flag, so
      // they keep the exact-date behaviour.
      if (req.query.workDate) {
        if (req.query.includeBacklog === "true") {
          filtered = filtered.or(
            `work_date.eq.${req.query.workDate},and(work_date.lt.${req.query.workDate},allocation_status.eq.PENDING)`,
          );
        } else {
          filtered = filtered.eq("work_date", req.query.workDate);
        }
      }
      // Production Reports — History (case-number) view filters.
      // Date-RANGE variant of the exact-match workDate above.
      if (req.query.workDateFrom) {
        filtered = filtered.gte("work_date", req.query.workDateFrom);
      }
      if (req.query.workDateTo) {
        filtered = filtered.lte("work_date", req.query.workDateTo);
      }
      // case-number search for the same History view — partial,
      // case-insensitive match so "b011" finds "CASEB011".
      if (req.query.caseNumber) {
        filtered = filtered.ilike("case_number", `%${req.query.caseNumber}%`);
      }
      if (req.query.clientId) {
        filtered = filtered.eq("client_id", req.query.clientId);
      }
      // Subclient filter — same idea as clientId above.
      if (req.query.subclientId) {
        filtered = filtered.eq("subclient_id", req.query.subclientId);
      }
      if (req.query.allocationStatus) {
        filtered = filtered.eq("allocation_status", req.query.allocationStatus);
      }
      // Quality Scores (QC) page — filter to one employee's cases.
      if (req.query.employeeId) {
        filtered = filtered.eq("assigned_employee_id", req.query.employeeId);
      }
      // Case Register search box — one input that searches Case
      // Number, Service, Client, and Subclient (and the work date, in
      // either 2026-08-26 or 26-08-2026 form) all at once, across the
      // FULL result set. Runs as one .or() so it stays an AND with
      // every other filter applied.
      if (searchOrParts) {
        filtered = filtered.or(searchOrParts.join(","));
      }
      // "mine=true" — the employee's own Today's/Past Allocation
      // table on the Profile page. Scoped server-side to whoever is
      // authenticated (never trusts a client-supplied employee id),
      // same pattern as /api/allocations/self.
      if (req.query.mine === "true") {
        filtered = filtered.eq("assigned_employee_id", req.user.userId);
      }
      if (req.query.submissionStatus) {
        filtered = filtered.eq("submission_status", req.query.submissionStatus);
      }
      // Quality Scores (QC) page filter. qc_status only ever holds the
      // plain values 'PENDING' / 'PASSED' / 'FAILED'.
      if (req.query.qcStatus === "PENDING") {
        filtered = filtered.or("qc_status.is.null,qc_status.eq.PENDING");
      } else if (req.query.qcStatus === "PASSED") {
        filtered = filtered.eq("qc_status", "PASSED");
      } else if (req.query.qcStatus === "FAILED") {
        filtered = filtered.eq("qc_status", "FAILED");
      }
      // Audit — second pass over cases that already passed QC. Same
      // PENDING/PASSED/FAILED convention as qc_status above.
      if (req.query.auditStatus === "PENDING") {
        filtered = filtered.or("audit_status.is.null,audit_status.eq.PENDING");
      } else if (req.query.auditStatus === "PASSED") {
        filtered = filtered.eq("audit_status", "PASSED");
      } else if (req.query.auditStatus === "FAILED") {
        filtered = filtered.eq("audit_status", "FAILED");
      }
      return filtered;
    };

    // Guards against a 416 "Requested range not satisfiable" from
    // PostgREST — clamp the requested page down to the last valid one
    // for this filtered set.
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
      // FIX: sequence_number as a tiebreaker (also descending) makes the
      // order deterministic when a whole batch is inserted in the same
      // instant.
      .order("created_at", { ascending: false })
      .order("sequence_number", { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = data || [];
    // PERF FIX: these 4 lookups don't depend on each other, so they run
    // concurrently instead of back-to-back.
    const [productMap, employeeMap, clientMap, subclientMap] =
      await Promise.all([
        getProductNameMap(
          rows.map((r) => r.product_id),
          req.user.organizationId,
        ),
        // Every employee id that can appear on a row.
        getEmployeeNameMap(
          rows.flatMap((r) => [
            r.assigned_employee_id,
            r.qc_employee_id,
            r.audit_employee_id,
            // "Allocated By" — who ran the allocate/auto-allocate
            // action, not just who it landed on.
            r.allocated_by,
            // "Submitted By" — who actually pressed Submit (the employee,
            // or a Super Admin / Ops Manager submitting on their behalf).
            r.submitted_by,
          ]),
          req.user.organizationId,
        ),
        // Client column — resolves client_id on each case to its name.
        getClientNameMap(
          rows.map((r) => r.client_id),
          req.user.organizationId,
        ),
        // Subclient column.
        getSubclientNameMap(
          rows.map((r) => r.subclient_id),
          req.user.organizationId,
        ),
      ]);

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
      // who performed the allocation (manual or auto) — shown next to
      // the assigned employee.
      allocatedById: r.allocated_by || null,
      allocatedByName: employeeMap[r.allocated_by] || null,
      profile: r.profile || "",
      // employee's own submission of their work on this case — separate
      // from allocation_status. 'SUBMITTED' once the assigned employee
      // marks it done.
      submissionStatus: r.submission_status || "PENDING",
      submissionType: r.submission_type || null,
      queryText: r.query_text || "",
      submittedAt: r.submitted_at || null,
      // who actually submitted it (Production Report -> "Submitted By" /
      // "On behalf" chip). Null for rows submitted before this column existed.
      submittedById: r.submitted_by || null,
      submittedByName: employeeMap[r.submitted_by] || null,
      // Quality Scores (QC) page — direct passthrough.
      qcStatus: r.qc_status || "PENDING",
      marks: r.qc_marks ?? null,
      // exposed so the Audit tab's "QC Result" summary (reviewer /
      // marks / remarks) can actually show something instead of "—".
      qcMarks: r.qc_marks ?? null,
      qcNotes: r.qc_notes || null,
      qcEmployeeId: r.qc_employee_id || null,
      qcEmployeeName: employeeMap[r.qc_employee_id] || null,
      qcReviewedAt: r.qc_reviewed_at || null,
      // Audit — second pass over QC-passed cases, same shape as QC.
      auditStatus: r.audit_status || null,
      auditMarks: r.audit_marks ?? null,
      auditNotes: r.audit_notes || null,
      auditEmployeeId: r.audit_employee_id || null,
      auditEmployeeName: employeeMap[r.audit_employee_id] || null,
      auditReviewedAt: r.audit_reviewed_at || null,
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
// body: { productId, quantity, workDate?, clientId?, subclientId?, casePrefix?, autoPrefix? }
//
// Creates `quantity` individual case rows for the service, continuing
// the running per-service sequence from wherever it last left off.
// ------------------------------------------------------------
async function createServiceCases(req, res) {
  try {
    const { productId } = req.body;
    const quantity = Number(req.body.quantity);
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);
    // Client can be picked at creation time too (still editable later
    // from the table). Optional — null is fine.
    const clientId = req.body.clientId || null;
    // Subclient — only meaningful alongside a client, validated below
    // to actually belong to it.
    const subclientId = req.body.subclientId || null;
    // Auto Generate mode — optional custom prefix. When given, case
    // numbers are "<prefix><number>" (numbering restarts at 001 for a
    // never-before-used prefix) instead of CASE+service-letter format.
    let rawCasePrefix = (req.body.casePrefix || "").toString().trim();
    // autoPrefix=true -> server builds <ORG3><MON><YEAR> itself
    // (client-supplied prefix is ignored so it can't be spoofed).
    if (req.body.autoPrefix === true) {
      rawCasePrefix = await buildAutoPrefix(req.user.organizationId, workDate);
    }
    let casePrefix = null;
    if (rawCasePrefix) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(rawCasePrefix)) {
        return res.status(400).json({
          success: false,
          message:
            "Prefix can only contain letters, numbers, - and _, up to 20 characters.",
        });
      }
      casePrefix = rawCasePrefix;
    }

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
    const vhScope = await assertVerticalHeadCanUseProduct(req, product);
    if (!vhScope.ok) {
      return res.status(403).json({ success: false, message: vhScope.message });
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
      // NEW: the client must be mapped to this service.
      const mapCheck = await assertClientMappedToProduct(
        clientId,
        productId,
        req.user.organizationId,
      );
      if (!mapCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: mapCheck.message });
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

    // When a custom prefix is given, the visible case NUMBER is numbered
    // independently of `sequence_number` (which stays a plain internal
    // running counter used only for ordering) — this is what makes a
    // fresh prefix start at 001.
    const startCaseNum = casePrefix
      ? await getNextPrefixNumber(
          casePrefix,
          req.user.organizationId,
          productId,
        )
      : null;

    const buildRows = (caseNumStart) =>
      Array.from({ length: quantity }, (_, i) => {
        const seq = startSeq + i;
        const caseNumber = casePrefix
          ? `${casePrefix}${String(caseNumStart + i).padStart(3, "0")}`
          : formatCaseNumber(letter, seq);
        return {
          organization_id: req.user.organizationId,
          product_id: productId,
          client_id: clientId,
          subclient_id: subclientId,
          work_date: workDate,
          sequence_number: seq,
          case_number: caseNumber,
          created_by: req.user.userId,
        };
      });

    // If two people generate at the same moment, the DB's unique
    // constraint (23505) rejects the second batch — recompute the next
    // free number and retry so duplicates can never get in.
    let rowsToInsert = buildRows(startCaseNum);
    let data;
    for (let attempt = 0; ; attempt++) {
      const result = await supabase
        .from("service_cases")
        .insert(rowsToInsert)
        .select();
      if (!result.error) {
        data = result.data;
        break;
      }
      if (result.error.code === "23505" && casePrefix && attempt < 3) {
        const next = await getNextPrefixNumber(
          casePrefix,
          req.user.organizationId,
        );
        rowsToInsert = buildRows(next);
        continue;
      }
      throw result.error;
    }

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
// GET /api/service-cases/upload/template
//
// Sample .xlsx for Upload mode — "Case Number" column (required) plus
// the "Client Name" / "Subclient Name" columns uploadCustomServiceCases
// below reads. Client/Subclient are optional in the actual upload.
// ------------------------------------------------------------
async function downloadUploadTemplate(req, res) {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cases");
    ws.columns = [
      { header: "Case Number", key: "caseNumber", width: 18 },
      { header: "Service", key: "service", width: 22 },
      { header: "Client Name", key: "client", width: 24 },
      { header: "Subclient Name", key: "subclient", width: 24 },
    ];
    ws.getRow(1).eachCell((cell) => styleHeaderCell(cell));
    ws.addRow(["CASE-1001", "Income Tax", "ABC Ltd", "ABC North"]);
    ws.addRow(["CASE-1002", "GST", "XYZ Pvt Ltd", ""]);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="case_register_upload_template.xlsx"',
    );
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error("downloadUploadTemplate error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}
// ------------------------------------------------------------
// POST /api/service-cases/upload
// multipart/form-data: file (.xlsx/.csv), productId, workDate
//
// Alternative to createServiceCases for orgs that already have their
// own case numbering — reads a "Case Number" column from the uploaded
// sheet and creates one row per value, verbatim, all under the one
// Service + Date picked in the form.
//
// Case numbers are unique per organization, so any value that already
// exists anywhere in this org, or repeats within the sheet itself, is
// skipped and reported back rather than failing the whole upload.
// A row whose client isn't mapped to the selected service is skipped too.
// ------------------------------------------------------------
async function uploadCustomServiceCases(req, res) {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const orgId = req.user.organizationId;
    // CHANGED: productId ab optional hai — sirf default service hai
    // (un rows ke liye jinka Service cell khali ho).
    const defaultProductId = req.body.productId
      ? String(req.body.productId)
      : null;
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);

    let sheetRows;
    try {
      sheetRows = await parseSpreadsheetRows(
        req.file.buffer,
        req.file.originalname,
        { defval: "" },
      );
    } catch (parseErr) {
      return res
        .status(400)
        .json({ success: false, message: parseErr.message });
    }

    if (!sheetRows.length) {
      return res
        .status(400)
        .json({ success: false, message: "Uploaded file has no data rows" });
    }
    if (sheetRows.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Upload cannot exceed 5000 rows at a time.",
      });
    }

    const norm = (v) => (v || "").toString().trim();
    const squash = (k) => k.replace(/\s+/g, "").toLowerCase();

    // Columns case-insensitive / whitespace-tolerant.
    const firstRowKeys = Object.keys(sheetRows[0] || {});
    const caseNumberKey =
      firstRowKeys.find((k) => squash(k) === "casenumber") || firstRowKeys[0];
    // NEW: "Service" column
    const serviceKey = firstRowKeys.find((k) =>
      ["service", "servicename", "product"].includes(squash(k)),
    );
    const clientNameKey = firstRowKeys.find((k) =>
      ["clientname", "client"].includes(squash(k)),
    );
    const subclientNameKey = firstRowKeys.find((k) =>
      ["subclientname", "subclient"].includes(squash(k)),
    );

    if (!serviceKey && !defaultProductId) {
      return res.status(400).json({
        success: false,
        message:
          "Add a Service column in the file or select a default service.",
      });
    }

    // ---- services of this org (ek baar) ----
    const { data: orgProducts, error: prodErr } = await supabase
      .from("service_master")
      .select("*")
      .eq("organization_id", orgId);
    if (prodErr) throw prodErr;
    const productById = new Map(
      (orgProducts || []).map((p) => [String(p.id), p]),
    );
    const productByName = new Map(
      (orgProducts || []).map((p) => [
        norm(p.product_name).toLowerCase(),
        String(p.id),
      ]),
    );

    if (defaultProductId && !productById.has(defaultProductId)) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }

    // Vertical-head scope: har service jo is file me use hogi, uske liye
    // ek hi baar check (cache).
    const scopeCache = new Map();
    const canUseProduct = async (pid) => {
      if (!scopeCache.has(pid)) {
        const scope = await assertVerticalHeadCanUseProduct(
          req,
          productById.get(pid),
        );
        scopeCache.set(pid, scope);
      }
      return scopeCache.get(pid);
    };

    const results = [];
    let createdCount = 0;
    let skippedCount = 0;
    const skip = (row, caseNumber, message) => {
      skippedCount++;
      results.push({ row, caseNumber, status: "skipped", message });
    };

    // ---- pass 1: empty / duplicate-in-file / service resolve ----
    const seenInFile = new Set();
    const candidates = [];
    for (let i = 0; i < sheetRows.length; i++) {
      const row = sheetRows[i];
      const rowNum = i + 2;
      const caseNumber = norm(row[caseNumberKey]);

      if (!caseNumber) {
        skip(rowNum, "", "Empty case number");
        continue;
      }
      const key = caseNumber.toUpperCase();
      if (seenInFile.has(key)) {
        skip(rowNum, caseNumber, "Duplicate within uploaded file");
        continue;
      }

      // service for THIS row
      const serviceName = serviceKey ? norm(row[serviceKey]) : "";
      let rowProductId = defaultProductId;
      if (serviceName) {
        rowProductId = productByName.get(serviceName.toLowerCase()) || null;
        if (!rowProductId) {
          skip(rowNum, caseNumber, `Service not found: "${serviceName}"`);
          continue;
        }
      } else if (!rowProductId) {
        skip(
          rowNum,
          caseNumber,
          "Service missing (no Service in row and no default selected)",
        );
        continue;
      }

      const scope = await canUseProduct(rowProductId);
      if (!scope.ok) {
        skip(
          rowNum,
          caseNumber,
          scope.message || "You can't add cases to this service",
        );
        continue;
      }

      seenInFile.add(key);
      candidates.push({
        row: rowNum,
        caseNumber,
        productId: rowProductId,
        clientName: clientNameKey ? norm(row[clientNameKey]) : "",
        subclientName: subclientNameKey ? norm(row[subclientNameKey]) : "",
      });
    }

    // ---- org-wide, case-insensitive duplicate check ----
    const existingSet =
      candidates.length > 0
        ? await findExistingCaseNumbersCI(
            candidates.map((c) => c.caseNumber),
            candidates[0].productId,
            orgId,
          )
        : new Set();

    const toInsert = [];
    candidates.forEach((c) => {
      if (existingSet.has(c.caseNumber.toUpperCase())) {
        skip(c.row, c.caseNumber, "Case number already exists");
      } else {
        toInsert.push(c);
      }
    });

    // ---- client / subclient lookup (ek baar) ----
    const clientNameToId = new Map();
    const subclientKeyToId = new Map();
    const needsClientLookup = toInsert.some((c) => c.clientName);
    const needsSubclientLookup = toInsert.some((c) => c.subclientName);
    if (needsClientLookup || needsSubclientLookup) {
      const { data: orgClients, error: clientsErr } = await supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", orgId);
      if (clientsErr) throw clientsErr;
      (orgClients || []).forEach((cl) => {
        clientNameToId.set(cl.name.trim().toLowerCase(), cl.id);
      });

      if (needsSubclientLookup) {
        const { data: orgSubclients, error: subErr } = await supabase
          .from("subclients")
          .select("id, name, client_id")
          .eq("organization_id", orgId);
        if (subErr) throw subErr;
        (orgSubclients || []).forEach((s) => {
          subclientKeyToId.set(
            `${s.client_id}::${s.name.trim().toLowerCase()}`,
            s.id,
          );
        });
      }
    }

    // CHANGED: client mapping ab HAR ROW KI service ke against check hota
    // hai — har service ka mapped-clients set ek baar load hoke cache hota hai.
    const mappedCache = new Map();
    const getMappedSet = async (pid) => {
      if (!mappedCache.has(pid)) {
        const ids = await getMappedClientIds(pid, orgId);
        mappedCache.set(pid, new Set((ids || []).map((x) => String(x))));
      }
      return mappedCache.get(pid);
    };

    const resolved = [];
    for (const c of toInsert) {
      let clientId = null;
      if (c.clientName) {
        clientId = clientNameToId.get(c.clientName.toLowerCase()) || null;
        if (!clientId) {
          skip(c.row, c.caseNumber, `Client not found: "${c.clientName}"`);
          continue;
        }
        const mapped = await getMappedSet(c.productId);
        if (!mapped.has(String(clientId))) {
          const pName = productById.get(c.productId)?.product_name || "this";
          skip(
            c.row,
            c.caseNumber,
            `Client "${c.clientName}" is not mapped to service "${pName}"`,
          );
          continue;
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
    }

    // ---- insert (sequence_number har service ka apna) ----
    if (resolved.length > 0) {
      const nextSeq = new Map();
      for (const pid of new Set(resolved.map((c) => c.productId))) {
        const { data: maxRow, error: maxError } = await supabase
          .from("service_cases")
          .select("sequence_number")
          .eq("organization_id", orgId)
          .eq("product_id", pid)
          .order("sequence_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (maxError) throw maxError;
        nextSeq.set(pid, (maxRow?.sequence_number || 0) + 1);
      }

      const rowsToInsert = resolved.map((c) => {
        const seq = nextSeq.get(c.productId);
        nextSeq.set(c.productId, seq + 1);
        return {
          organization_id: orgId,
          product_id: c.productId,
          client_id: c.clientId,
          subclient_id: c.subclientId,
          work_date: workDate,
          sequence_number: seq,
          case_number: c.caseNumber,
          created_by: req.user.userId,
        };
      });

      for (let i = 0; i < rowsToInsert.length; i += 500) {
        const { error: insertError } = await supabase
          .from("service_cases")
          .insert(rowsToInsert.slice(i, i + 500));
        if (insertError) throw insertError;
      }

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
        // frontend ki skip-reasons list isi se banti hai
        skipped: results
          .filter((r) => r.status === "skipped")
          .slice(0, 100)
          .map((r) => ({
            row: r.row,
            caseNumber: r.caseNumber,
            reason: r.message,
          })),
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
// The person types the actual case numbers themselves — one per
// line/comma in the textarea on the frontend, sent here as an array.
// (the frontend caps the textarea at 10; this endpoint allows up to 500).
//
// Duplicates (within the request or already in the DB) are skipped and
// reported back rather than failing the whole submission.
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
    const vhScope = await assertVerticalHeadCanUseProduct(req, product);
    if (!vhScope.ok) {
      return res.status(403).json({ success: false, message: vhScope.message });
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
      // NEW: the client must be mapped to this service.
      const mapCheck = await assertClientMappedToProduct(
        clientId,
        productId,
        req.user.organizationId,
      );
      if (!mapCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: mapCheck.message });
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

    // Dedupe within the submitted list is case-insensitive. The ORIGINAL
    // casing the person typed is still what gets stored.
    const seen = new Set();
    const results = [];
    const candidates = [];
    rawCaseNumbers.forEach((raw, i) => {
      const caseNumber = norm(raw);
      if (!caseNumber) return; // silently skip blank lines
      const key = caseNumber.toUpperCase();
      if (seen.has(key)) {
        results.push({
          caseNumber,
          status: "skipped",
          reason: "duplicate_in_request",
          message: "Duplicate in this submission",
        });
        return;
      }
      seen.add(key);
      candidates.push({ row: i + 1, caseNumber });
    });

    if (!candidates.length) {
      return res
        .status(400)
        .json({ success: false, message: "Enter at least one case number" });
    }

    // MODIFIED: org-wide, case-insensitive duplicate check (see
    // findExistingCaseNumbersCI).
    const existingSet = await findExistingCaseNumbersCI(
      candidates.map((c) => c.caseNumber),
      productId,
      req.user.organizationId,
    );

    const toInsert = [];
    candidates.forEach((c) => {
      if (existingSet.has(c.caseNumber.toUpperCase())) {
        results.push({
          caseNumber: c.caseNumber,
          status: "skipped",
          reason: "already_exists",
          message: "Case number already exists",
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
    // Spell out exactly WHY things were skipped. Matches on the stable
    // `reason` CODE, not the display `message` text.
    const alreadyExisting = results
      .filter((r) => r.status === "skipped" && r.reason === "already_exists")
      .map((r) => r.caseNumber);
    const duplicateInRequest = results
      .filter(
        (r) => r.status === "skipped" && r.reason === "duplicate_in_request",
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
// POST /api/service-cases/count-only
// body: { productId, quantity, workDate?, clientId?, subclientId? }
//
// "Manual (Count)" mode — case numbers aren't available yet, so NO
// rows are created in service_cases. Only the count is recorded in
// service_case_counts. Service is required; Client/Subclient are
// optional. Case numbers get attached later (at submit time) by
// bumping fulfilled_count.
// ------------------------------------------------------------
async function createCountOnlyEntry(req, res) {
  try {
    const { productId } = req.body;
    const quantity = Number(req.body.quantity);
    const workDate = req.body.workDate || new Date().toISOString().slice(0, 10);
    const clientId = req.body.clientId || null;
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
    const vhScope = await assertVerticalHeadCanUseProduct(req, product);
    if (!vhScope.ok) {
      return res.status(403).json({ success: false, message: vhScope.message });
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
      // NEW: the client must be mapped to this service.
      const mapCheck = await assertClientMappedToProduct(
        clientId,
        productId,
        req.user.organizationId,
      );
      if (!mapCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: mapCheck.message });
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

    const { data, error } = await supabase
      .from("service_case_counts")
      .insert({
        organization_id: req.user.organizationId,
        product_id: productId,
        client_id: clientId,
        subclient_id: subclientId,
        work_date: workDate,
        quantity,
        created_by: req.user.userId,
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `${quantity} case(s) recorded for ${product.product_name}. Case numbers can be added later at submit time.`,
      data: {
        id: data.id,
        productId: data.product_id,
        quantity: data.quantity,
        workDate: data.work_date,
      },
    });
  } catch (err) {
    console.error("createCountOnlyEntry error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/service-cases/count-only
// Query params: productId (optional)
//
// Lists count-only entries that still have cases left to attach case
// numbers to (fulfilled_count < quantity), newest first — shown in the
// "Pending Counts" card on the Case Register page.
// ------------------------------------------------------------
async function listCountOnlyEntries(req, res) {
  try {
    let query = supabase
      .from("service_case_counts")
      .select("*")
      .eq("organization_id", req.user.organizationId);
    if (req.query.productId) {
      query = query.eq("product_id", req.query.productId);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const rows = (data || []).filter(
      (r) => (r.fulfilled_count || 0) < r.quantity,
    );

    const [productMap, clientMap, subclientMap] = await Promise.all([
      getProductNameMap(
        rows.map((r) => r.product_id),
        req.user.organizationId,
      ),
      getClientNameMap(
        rows.map((r) => r.client_id),
        req.user.organizationId,
      ),
      getSubclientNameMap(
        rows.map((r) => r.subclient_id),
        req.user.organizationId,
      ),
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productName: productMap[r.product_id] || null,
        clientId: r.client_id || null,
        clientName: clientMap[r.client_id] || null,
        subclientId: r.subclient_id || null,
        subclientName: subclientMap[r.subclient_id] || null,
        workDate: r.work_date,
        quantity: r.quantity,
        fulfilledCount: r.fulfilled_count || 0,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("listCountOnlyEntries error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/service-cases/count-only/:id
// Removes a count-only entry (e.g. entered by mistake).
// ------------------------------------------------------------
async function deleteCountOnlyEntry(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("service_case_counts")
      .delete()
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Count entry not found" });
    }
    res.json({ success: true, message: "Count entry deleted." });
  } catch (err) {
    console.error("deleteCountOnlyEntry error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/service-cases/:id
// Removes a single case row. Deliberately does NOT touch or renumber
// any other case for that service — sequence numbers are a running,
// ever-increasing log (like an invoice number), not a dense 1..N range.
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

    // Fetch the current row BEFORE overwriting it — the only chance to
    // see who this case was assigned to prior to a "Clear".
    const { data: existing, error: existingError } = await supabase
      .from("service_cases")
      .select(
        "case_number, product_id, work_date, assigned_employee_id, allocated_at",
      )
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }

    // Only a real "Clear" (someone assigned -> nobody) gets logged.
    if (!employeeId && existing.assigned_employee_id) {
      const [productMap, prevEmployeeMap] = await Promise.all([
        getProductNameMap([existing.product_id], req.user.organizationId),
        getEmployeeNameMap(
          [existing.assigned_employee_id],
          req.user.organizationId,
        ),
      ]);
      const { error: logError } = await supabase
        .from("allocation_clear_log")
        .insert({
          organization_id: req.user.organizationId,
          case_id: id,
          case_number: existing.case_number,
          product_id: existing.product_id,
          product_name: productMap[existing.product_id] || null,
          work_date: existing.work_date,
          employee_id: existing.assigned_employee_id,
          employee_name: prevEmployeeMap[existing.assigned_employee_id] || null,
          allocated_at: existing.allocated_at,
          cleared_by: req.user.userId,
        });
      // Don't let a logging failure block the actual clear action.
      if (logError) {
        console.error("Failed to write allocation_clear_log:", logError);
      }
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        assigned_employee_id: employeeId,
        allocation_status: employeeId ? "ALLOCATED" : "PENDING",
        allocated_at: employeeId ? new Date().toISOString() : null,
        // who performed THIS allocation — cleared back to null on "Clear".
        allocated_by: employeeId ? req.user.userId : null,
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
      [data.assigned_employee_id, data.allocated_by],
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
        allocatedById: data.allocated_by || null,
        allocatedByName: employeeMap[data.allocated_by] || null,
      },
    });
  } catch (err) {
    console.error("allocateServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/service-cases/clear-log
// Query params: dateFrom, dateTo, productId, employeeId, page, pageSize
//
// Read side of allocation_clear_log: a past record of every clear
// action (who had the case, who cleared it, and when), newest first.
// ------------------------------------------------------------
async function listAllocationClearLog(req, res) {
  try {
    const orgId = req.user.organizationId;
    const { dateFrom, dateTo, productId, employeeId } = req.query;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || 50, 1),
      200,
    );

    let query = supabase
      .from("allocation_clear_log")
      .select("*", { count: "exact" })
      .eq("organization_id", orgId);

    if (dateFrom) query = query.gte("work_date", dateFrom);
    if (dateTo) query = query.lte("work_date", dateTo);
    if (productId) query = query.eq("product_id", productId);
    if (employeeId) query = query.eq("employee_id", employeeId);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await query
      .order("cleared_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = data || [];
    // Product/employee names are snapshotted at clear-time in the log
    // row itself. Only "cleared_by" needs a fresh lookup here.
    const clearedByMap = await getEmployeeNameMap(
      rows.map((r) => r.cleared_by),
      orgId,
    );

    const enriched = rows.map((r) => ({
      id: r.id,
      caseId: r.case_id,
      caseNumber: r.case_number,
      productId: r.product_id,
      productName: r.product_name,
      workDate: r.work_date,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      allocatedAt: r.allocated_at,
      clearedById: r.cleared_by,
      clearedByName: clearedByMap[r.cleared_by] || null,
      clearedAt: r.cleared_at,
    }));

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(Math.ceil((count || 0) / pageSize), 1),
      },
    });
  } catch (err) {
    console.error("listAllocationClearLog error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/auto-allocate
// body: { productId, workDate, employeeIds: [...] }
//
// "Smart Allocation" for the Cases tab: takes every still-PENDING case
// for the given service (this date + earlier backlog) and works out an
// even split across the given employee list.
//
// MODIFIED: the "extra" cases (when it doesn't split evenly) now go to
// whoever got the LEAST work for this service in the last 30 days
// (same rule the count-only Smart Allocation uses) instead of always
// going to the first people in the list.
//
// IMPORTANT: this is a PREVIEW only — it does NOT write anything to the
// database. Nothing is actually allocated until the person presses the
// page's own "Allocate" button, which saves each row through the normal
// single-case PATCH (/api/service-cases/:id/allocate).
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
      // lte() carries unallocated backlog forward, matching the Cases
      // tab's list view (includeBacklog).
      .lte("work_date", workDate)
      .eq("allocation_status", "PENDING")
      .order("sequence_number", { ascending: true });
    if (error) throw error;

    if (!pendingCases || pendingCases.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending cases to allocate for this service/date.",
      });
    }

    // MODIFIED: least-loaded employees first, so they are the ones
    // who receive the extra case(s) of the round-robin.
    const load = await getRecentLoad(
      req.user.organizationId,
      productId,
      workDate,
      employeeIds,
    );
    const ordered = orderByLeastLoad(employeeIds, load);

    // NOTE: preview only — no DB write here.
    const updates = pendingCases.map((c, idx) => ({
      id: c.id,
      caseNumber: c.case_number,
      employeeId: ordered[idx % ordered.length],
    }));

    const employeeMap = await getEmployeeNameMap(
      employeeIds,
      req.user.organizationId,
    );
    // Per-employee summary — how many cases + which case numbers each
    // employee WOULD get.
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
      message: `${updates.length} case(s) distributed across ${employeeIds.length} employee(s) — review below and press Allocate to confirm.`,
      data: {
        // Full case -> employee map so the frontend can seed each row's
        // dropdown without a second lookup.
        assignments: updates.map((u) => ({
          caseId: u.id,
          caseNumber: u.caseNumber,
          employeeId: u.employeeId,
        })),
        allocatedCount: updates.length,
        perEmployee,
      },
    });
  } catch (err) {
    console.error("autoAllocateServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// NEW (NOTIFY): POST /api/service-cases/notify-allocation
// body: { employeeIds: string[], workDate? }
//
// Called by the Today's Allocation page right after "Allocate" is
// saved. Every employee who got NEW work receives ONE email:
//   "Your work has been allocated today. Please login to check."
//
//   - The message never contains how many cases/what work they got.
//   - The text is fixed on the server (a message sent by the client
//     is ignored), so this endpoint can't be used to send custom mail.
//   - Each employee is mailed only once per call, even if their id is
//     repeated in the request.
//   - NEW (NOTIFY ONCE): an employee is mailed only the FIRST time work
//     is allocated to them for a given work date. Allocating again on
//     the same date (Smart Allocation re-run, more cases added) sends
//     NO new mail. The next work date counts as a fresh "first time".
//   - Only employees of the caller's own organization are mailed.
//   - A mail failure never affects the allocation itself (it is
//     already saved); the page just shows a small toast.
//
// Requires this table (run once in the Supabase SQL editor):
//
//   create table if not exists allocation_notifications (
//     id uuid primary key default gen_random_uuid(),
//     organization_id uuid not null,
//     employee_id uuid not null,
//     work_date date not null,
//     created_at timestamptz not null default now(),
//     unique (organization_id, employee_id, work_date)
//   );
//
// (Use the same type for organization_id as your other tables.)
// ------------------------------------------------------------
// CHANGED: "allocated today"
const ALLOC_MESSAGE =
  "Your work has been allocated today. Please login to check.";

// App link shown in the email button. Set FRONTEND_URL in .env
// (e.g. https://your-app.vercel.app). Falls back to "#" if missing.
const APP_URL = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const APP_LOGIN_URL = APP_URL ? `${APP_URL}/login` : "#";
// NEW: Logo2.png must be in the frontend's public/ folder so it opens at
// https://your-app.vercel.app/Logo2.png (email needs a full public URL).
// EMAIL_LOGO_URL (optional .env) overrides the default <FRONTEND_URL>/Logo2.png
const LOGO_URL =
  process.env.EMAIL_LOGO_URL || (APP_URL ? `${APP_URL}/Logo2.png` : "");

// Email-safe HTML (tables + inline styles only — works in Gmail/Outlook).
// Brand colours match the app (#08A1CE -> #204297). Contains NO case counts.
function buildAllocationEmailHtml() {
  return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- Tell mail apps: this email is light-only, don't convert it to dark -->
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    /* Apple Mail / Outlook.com: even in dark mode keep the SAME light colours */
    @media (prefers-color-scheme: dark) {
      .bg-page { background-color: #eef6fb !important; background-image: linear-gradient(#eef6fb,#eef6fb) !important; }
      .bg-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff,#ffffff) !important; }
      .bg-head { background-color: #204297 !important; background-image: linear-gradient(135deg,#08A1CE,#204297) !important; }
      .bg-btn  { background-color: #204297 !important; background-image: linear-gradient(135deg,#08A1CE,#204297) !important; }
      .txt-title { color: #1e2a4a !important; }
      .txt-sub   { color: #6b7690 !important; }
      .txt-white { color: #ffffff !important; }
      .txt-foot  { color: #9aa3b5 !important; }
    }
  </style>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body class="bg-page" style="margin:0;padding:0;background:#eef6fb;">
  <table class="bg-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef6fb" style="background:#eef6fb;background-image:linear-gradient(#eef6fb,#eef6fb);padding:32px 12px;">
    <tr>
      <td align="center">
        <table class="bg-card" role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:480px;width:100%;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(32,66,151,0.15);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

          <!-- Header -->
          <tr>
            <td class="bg-head" align="center" bgcolor="#204297" style="background:#204297;background-image:linear-gradient(135deg,#08A1CE,#204297);padding:36px 24px;">
              <div style="width:60px;height:60px;line-height:60px;border-radius:16px;background:rgba(255,255,255,0.2);color:#ffffff;font-size:30px;text-align:center;margin:0 auto 14px;">&#9989;</div>
              <div class="txt-white" style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.3px;">Work Allocated Today</div>
            </td>
          </tr>

          <!-- White section: logo + message + button, all in ONE cell (no row seams) -->
          <tr>
            <td class="bg-card" align="center" bgcolor="#ffffff" style="background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);padding:28px 32px 22px;">
              ${
                LOGO_URL
                  ? `<img src="${LOGO_URL}" alt="Alookate" width="120" style="display:block;margin:0 auto 22px;width:120px;max-width:120px;height:auto;border:0;outline:none;text-decoration:none;" />`
                  : ""
              }
              <p class="txt-title" style="margin:0 0 10px;color:#1e2a4a;font-size:18px;font-weight:700;">Your work has been allocated.</p>
              <p class="txt-sub" style="margin:0 0 26px;color:#6b7690;font-size:15px;line-height:1.6;">Please login to check.</p>

              <!-- Outlook desktop: real rounded button (VML) -->
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${APP_LOGIN_URL}" style="height:48px;v-text-anchor:middle;width:230px;" arcsize="50%" stroke="f" fillcolor="#204297">
                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Login to Alookate</center>
              </v:roundrect>
              <![endif]-->
              <!-- Gmail / Apple Mail / Outlook.com / phones -->
              <!--[if !mso]><!-- -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td class="bg-btn" align="center" bgcolor="#204297" style="background:#204297;background-image:linear-gradient(135deg,#08A1CE,#204297);border-radius:30px;padding:14px 40px;">
                    <a class="txt-white" href="${APP_LOGIN_URL}" target="_blank" style="color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;display:inline-block;">Login to Alookate</a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->

               </td>
          </tr>

        </table>
        <p class="txt-foot" style="margin:16px 0 0;color:#9aa3b5;font-size:11px;font-family:Arial,sans-serif;">This is an automated message from Alookate.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
async function notifyAllocation(req, res) {
  console.log("[notify] hit, body:", JSON.stringify(req.body));
  try {
    const employeeIds = Array.isArray(req.body.employeeIds)
      ? [
          ...new Set(
            req.body.employeeIds
              .map((x) => (x || "").toString().trim())
              .filter(Boolean),
          ),
        ]
      : [];

    if (employeeIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No employees provided." });
    }
    if (employeeIds.length > 500) {
      return res
        .status(400)
        .json({ success: false, message: "Too many employees." });
    }

    // the work date this allocation is for (falls back to today)
    const rawDate = (req.body.workDate || "").toString().slice(0, 10);
    const workDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

    // only people who belong to THIS organization
    const { data: members, error } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("organization_id", req.user.organizationId)
      .in("Auth User Id", employeeIds);
    if (error) throw error;

    const validIds = [
      ...new Set((members || []).map((m) => m["Auth User Id"])),
    ];

    if (validIds.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No matching employees found." });
    }

    // NEW (NOTIFY ONCE): try to "claim" (employee, date). Rows that
    // already exist are ignored, so .select() returns ONLY the employees
    // who have NOT been mailed yet for this date. The unique key does the
    // check, so two people pressing Allocate at the same moment can't
    // both mail the same employee.
    const { data: claimed, error: claimError } = await supabase
      .from("allocation_notifications")
      .upsert(
        validIds.map((id) => ({
          organization_id: req.user.organizationId,
          employee_id: id,
          work_date: workDate,
        })),
        {
          onConflict: "organization_id,employee_id,work_date",
          ignoreDuplicates: true,
        },
      )
      .select("employee_id");
    if (claimError) throw claimError;

    const toSend = (claimed || []).map((r) => r.employee_id);
    const skipped = validIds.length - toSend.length;

    // everyone was already mailed earlier for this date — nothing to
    // do, and NOT an error (the frontend must not show a failure toast)
    if (toSend.length === 0) {
      return res.json({ success: true, data: { sent: 0, failed: 0, skipped } });
    }

    const results = await Promise.allSettled(
      toSend.map(async (authId) => {
        const { data, error: userErr } =
          await supabase.auth.admin.getUserById(authId);
        if (userErr || !data?.user?.email) {
          throw userErr || new Error(`No email for ${authId}`);
        }

        // NOTE: agar tagged-email scheme (multi-role-per-email) use ho raha
        // hai to yaha wahi "real mailbox nikalne wala" helper lagao jo
        // reset-password mail bhejte waqt use hota hai.
        const to = data.user.email;
        console.log("[notify] sending to:", to);

        await sendEmail({
          to,
          // CHANGED: "Work allocated today"
          subject: "Work allocated today",
          text: `${ALLOC_MESSAGE} ${APP_LOGIN_URL}`,
          html: buildAllocationEmailHtml(),
        });
        console.log("[notify] sent to:", to);
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;
    if (failed > 0) {
      console.error(
        "notifyAllocation failures:",
        results.filter((r) => r.status === "rejected").map((r) => r.reason),
      );
      // a mail that FAILED must not count as "already mailed" — release
      // the claim so the next Allocate can try that employee again.
      const failedIds = toSend.filter(
        (_, i) => results[i].status === "rejected",
      );
      const { error: releaseError } = await supabase
        .from("allocation_notifications")
        .delete()
        .eq("organization_id", req.user.organizationId)
        .eq("work_date", workDate)
        .in("employee_id", failedIds);
      if (releaseError) {
        console.error("Failed to release notification claim:", releaseError);
      }
    }

    // koi bhi mail chali gayi to success; sab fail hui to frontend ko toast dikhe
    if (sent === 0) {
      return res
        .status(502)
        .json({ success: false, message: "Could not send messages." });
    }

    res.json({ success: true, data: { sent, failed, skipped } });
  } catch (err) {
    console.error("notifyAllocation error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// Profile — free-text value attached to a case, keyed by case number.
//   1. Single — PATCH /:id/profile, one case at a time.
//   2. Bulk upload — POST /bulk-profile, (case number, profile) pairs.
//
// Requires a column on service_cases:  profile  text, nullable
// ------------------------------------------------------------

// PATCH /api/service-cases/:id/profile   body: { profile: string }
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
// PATCH /api/service-cases/:id/case-number
// body: { caseNumber }
//
// Cases can be generated first (auto number / placeholder) and the real
// case number added later. Case numbers stay unique per organization,
// so a value already used by another case is rejected.
// ------------------------------------------------------------
async function updateServiceCaseNumber(req, res) {
  try {
    const { id } = req.params;
    const caseNumber = (req.body.caseNumber ?? "").toString().trim();
    if (!caseNumber) {
      return res
        .status(400)
        .json({ success: false, message: "Case number cannot be empty." });
    }
    if (caseNumber.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Case number cannot be longer than 50 characters.",
      });
    }

    // Duplicate check (case-insensitive, exact match, other rows only).
    const { data: dupes, error: dupError } = await supabase
      .from("service_cases")
      .select("id")
      .eq("organization_id", req.user.organizationId)
      .ilike("case_number", caseNumber.replace(/[\\%_]/g, "\\$&"))
      .neq("id", id)
      .limit(1);
    if (dupError) throw dupError;
    if (dupes && dupes.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Case number "${caseNumber}" already exists.`,
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ case_number: caseNumber })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          message: `Case number "${caseNumber}" already exists.`,
        });
      }
      throw error;
    }
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found" });
    }
    res.json({
      success: true,
      message: `Case number updated to ${data.case_number}.`,
      data: { id: data.id, caseNumber: data.case_number },
    });
  } catch (err) {
    console.error("updateServiceCaseNumber error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/client
// body: { clientId?, subclientId? }
//
// Case Register table's inline-editable Client + Subclient columns.
// Either field is optional in the body; only the ones actually sent get
// changed. Passing clientId: null (or "") clears the client (and the
// subclient along with it — a subclient can't outlive its client).
// A client being SET must be mapped to the case's service.
// ------------------------------------------------------------
async function updateServiceCaseClient(req, res) {
  try {
    const { id } = req.params;

    // NEW: product_id is selected too, for the client-service mapping check.
    const { data: existing, error: existingError } = await supabase
      .from("service_cases")
      .select("id, case_number, product_id, client_id, subclient_id")
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
      // NEW: the client must be mapped to this case's service.
      const mapCheck = await assertClientMappedToProduct(
        nextClientId,
        existing.product_id,
        req.user.organizationId,
      );
      if (!mapCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: mapCheck.message });
      }
    }

    // A client change with no explicit subclient in the same request
    // clears the old subclient.
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

    const [clientMap, subclientMap] = await Promise.all([
      getClientNameMap([data.client_id], req.user.organizationId),
      getSubclientNameMap([data.subclient_id], req.user.organizationId),
    ]);

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
// Matches each row to an existing case by case_number (within this org)
// and sets its profile value. Case numbers that don't match are
// reported back as "notFound" rather than failing the whole request.
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
// Employee self-submit — the "Today's Allocation"/"Past Allocation"
// table on the Profile page lists individual cases. A case is one
// atomic unit of work, so submitting it is a single click.
//
// Requires columns on service_cases:
//   submission_status  text, default 'PENDING' ('PENDING' | 'SUBMITTED')
//   submission_type    text ('COMPLETED' | 'DONE_BY_TEAM' | 'DONE_BY_CLIENT' | 'QUERY')
//   query_text         text, nullable
//   submitted_at       timestamptz, nullable
// ------------------------------------------------------------

// Every outcome an employee can report when submitting a case:
//   COMPLETED      -> "Completed"
//   QUERY          -> "Query"
//   DONE_BY_TEAM   -> "Completed by Team"
//   DONE_BY_CLIENT -> "Completed by Client"
const SUBMISSION_TYPES = [
  "COMPLETED",
  "DONE_BY_TEAM",
  "DONE_BY_CLIENT",
  "QUERY",
];
// What an open Query can be turned into once it's sorted out.
const QUERY_RESOLUTION_TYPES = SUBMISSION_TYPES.filter((t) => t !== "QUERY");

// NEW: Super Admin / Ops Manager can submit work on behalf of another
// employee (Profile page -> search employee -> open their profile).
// The frontend sends the employee's id as `onBehalfOf`. Everyone else
// can only ever act on their OWN cases — a non-privileged caller who
// sends onBehalfOf for someone else gets a 403, never a silent fallback.
const ON_BEHALF_ROLES = ["SUPER_ADMIN", "OPS_MANAGER"];
function getActingEmployeeId(req) {
  const target = (req.body?.onBehalfOf || "").toString().trim();
  if (!target || target === req.user.userId) {
    return { ok: true, employeeId: req.user.userId };
  }
  if (!ON_BEHALF_ROLES.includes(req.user.role)) {
    return {
      ok: false,
      message: "You can't submit work on behalf of another employee.",
    };
  }
  return { ok: true, employeeId: target };
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/submit
// body: { submissionType, queryText?, onBehalfOf? }
// ------------------------------------------------------------
async function submitServiceCase(req, res) {
  try {
    const { id } = req.params;
    const submissionType = (req.body.submissionType || "").toString().trim();
    const queryText = (req.body.queryText || "").toString().trim();

    if (!SUBMISSION_TYPES.includes(submissionType)) {
      return res.status(400).json({
        success: false,
        message:
          "submissionType must be 'COMPLETED', 'DONE_BY_TEAM', 'DONE_BY_CLIENT' or 'QUERY'.",
      });
    }
    if (submissionType === "QUERY" && !queryText) {
      return res.status(400).json({
        success: false,
        message: "queryText is required when submissionType is 'QUERY'.",
      });
    }

    // Whose case is this being submitted for? (yourself, or — for Super
    // Admin / Ops Manager — the employee whose profile is open.)
    const acting = getActingEmployeeId(req);
    if (!acting.ok) {
      return res.status(403).json({ success: false, message: acting.message });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        submission_status: "SUBMITTED",
        submission_type: submissionType,
        query_text: submissionType === "QUERY" ? queryText : null,
        submitted_at: new Date().toISOString(),
        // the person who pressed Submit (may differ from the assigned
        // employee when a Super Admin / Ops Manager submits on behalf).
        submitted_by: req.user.userId,
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      // Self-service — can only ever submit a case assigned to you
      // (or, for Super Admin / Ops Manager, to the employee they are
      // acting for), regardless of what id is in the URL.
      .eq("assigned_employee_id", acting.employeeId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        success: false,
        message:
          acting.employeeId === req.user.userId
            ? "Case not found or not assigned to you."
            : "Case not found or not assigned to this employee.",
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
// PATCH /api/service-cases/:id/resolve-query
// body: { resolutionType: 'COMPLETED' | 'DONE_BY_TEAM' | 'DONE_BY_CLIENT' }
//
// Profile page -> "All Query": once a query has been sorted out, the
// employee marks that case as completed. Only a case that is CURRENTLY
// a 'QUERY' and assigned to the caller can be resolved.
//
// query_text is deliberately KEPT here — that is how "Query Completed"
// is told apart from a case that was never a query.
// ------------------------------------------------------------
async function resolveQueryServiceCase(req, res) {
  try {
    const { id } = req.params;
    const resolutionType = (req.body.resolutionType || "").toString().trim();

    if (!QUERY_RESOLUTION_TYPES.includes(resolutionType)) {
      return res.status(400).json({
        success: false,
        message:
          "resolutionType must be 'COMPLETED', 'DONE_BY_TEAM' or 'DONE_BY_CLIENT'.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ submission_type: resolutionType })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      // Self-service — can only ever resolve your own query.
      .eq("assigned_employee_id", req.user.userId)
      .eq("submission_status", "SUBMITTED")
      .eq("submission_type", "QUERY")
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // Nothing was updated. If it's the caller's own case and it is no
      // longer a 'QUERY', someone else already completed it.
      const { data: current, error: currentError } = await supabase
        .from("service_cases")
        .select("submission_type, assigned_employee_id")
        .eq("id", id)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (
        current &&
        current.assigned_employee_id === req.user.userId &&
        current.submission_type &&
        current.submission_type !== "QUERY"
      ) {
        return res.status(409).json({
          success: false,
          alreadyCompleted: true,
          message: "This query was already completed by someone else.",
          data: { submissionType: current.submission_type },
        });
      }
      return res.status(404).json({
        success: false,
        message: "Query not found or not assigned to you.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} query marked completed.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        submissionStatus: data.submission_status,
        submissionType: data.submission_type,
        queryText: data.query_text,
      },
    });
  } catch (err) {
    console.error("resolveQueryServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/complete-query
// body (optional): { resolutionType: 'DONE_BY_TEAM' | 'COMPLETED' | 'DONE_BY_CLIENT' }
//
// A manager / admin marks SOMEONE ELSE's open query as completed
// (Production Reports -> "Mark completed", and the Profile page when a
// Super Admin / Ops Manager has another employee's profile open).
// Defaults to 'DONE_BY_TEAM'. Like resolve-query, query_text is KEPT.
// ------------------------------------------------------------
async function completeQueryServiceCase(req, res) {
  try {
    const { id } = req.params;
    const resolutionType = (req.body?.resolutionType || "DONE_BY_TEAM")
      .toString()
      .trim();

    if (!QUERY_RESOLUTION_TYPES.includes(resolutionType)) {
      return res.status(400).json({
        success: false,
        message:
          "resolutionType must be 'COMPLETED', 'DONE_BY_TEAM' or 'DONE_BY_CLIENT'.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({ submission_type: resolutionType })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .eq("submission_status", "SUBMITTED")
      .eq("submission_type", "QUERY")
      .select()
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const { data: current, error: currentError } = await supabase
        .from("service_cases")
        .select("submission_type")
        .eq("id", id)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (
        current &&
        current.submission_type &&
        current.submission_type !== "QUERY"
      ) {
        return res.status(409).json({
          success: false,
          alreadyCompleted: true,
          message: "This query was already completed.",
          data: { submissionType: current.submission_type },
        });
      }
      return res.status(404).json({
        success: false,
        message: "Query not found.",
      });
    }

    res.json({
      success: true,
      message: `${data.case_number} query marked completed.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        submissionStatus: data.submission_status,
        submissionType: data.submission_type,
        queryText: data.query_text,
      },
    });
  } catch (err) {
    console.error("completeQueryServiceCase error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/qc
// Quality Scores (QC) page — Pass/Fail a case + optional marks + an
// optional remarks note.
//   body: { qcStatus: "PASSED" | "FAILED", marks: number | null, notes?: string }
// Requires a column on service_cases:  qc_notes  text, nullable
// ------------------------------------------------------------
async function updateServiceCaseQc(req, res) {
  try {
    const { id } = req.params;
    const qcStatus = (req.body.qcStatus || "").toString().trim().toUpperCase();
    const rawMarks = req.body.marks;
    const marks =
      rawMarks === undefined || rawMarks === null || rawMarks === ""
        ? null
        : Number(rawMarks);
    const notes = (req.body.notes ?? "").toString().trim();

    if (!["PASSED", "FAILED"].includes(qcStatus)) {
      return res.status(400).json({
        success: false,
        message: "qcStatus must be 'PASSED' or 'FAILED'.",
      });
    }
    if (marks !== null && (Number.isNaN(marks) || marks < 0 || marks > 100)) {
      return res.status(400).json({
        success: false,
        message: "marks must be a number between 0 and 100.",
      });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("service_cases")
      .select("id, submission_status")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        qc_status: qcStatus,
        qc_marks: marks,
        qc_notes: notes,
        qc_employee_id: req.user.userId,
        qc_reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }

    res.json({
      success: true,
      message: `${data.case_number} marked ${qcStatus === "PASSED" ? "Passed" : "Failed"}.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        qcStatus,
        marks: data.qc_marks,
        notes: data.qc_notes,
      },
    });
  } catch (err) {
    console.error("updateServiceCaseQc error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/service-cases/:id/audit
// QC & Audit page — second pass; only meaningful on a case that has
// already passed QC.
//   body: { auditStatus: "PASSED" | "FAILED", marks: number | null, notes?: string }
// ------------------------------------------------------------
async function updateServiceCaseAudit(req, res) {
  try {
    const { id } = req.params;
    const auditStatus = (req.body.auditStatus || "")
      .toString()
      .trim()
      .toUpperCase();
    const rawMarks = req.body.marks;
    const marks =
      rawMarks === undefined || rawMarks === null || rawMarks === ""
        ? null
        : Number(rawMarks);
    const notes = (req.body.notes ?? "").toString().trim();

    if (!["PASSED", "FAILED"].includes(auditStatus)) {
      return res.status(400).json({
        success: false,
        message: "auditStatus must be 'PASSED' or 'FAILED'.",
      });
    }
    if (marks !== null && (Number.isNaN(marks) || marks < 0 || marks > 100)) {
      return res.status(400).json({
        success: false,
        message: "marks must be a number between 0 and 100.",
      });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("service_cases")
      .select("id, qc_status")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }
    if (existing.qc_status !== "PASSED") {
      return res.status(400).json({
        success: false,
        message: "Only QC-passed cases can be audited.",
      });
    }

    const { data, error } = await supabase
      .from("service_cases")
      .update({
        audit_status: auditStatus,
        audit_marks: marks,
        audit_notes: notes,
        audit_employee_id: req.user.userId,
        audit_reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Case not found." });
    }

    res.json({
      success: true,
      message: `${data.case_number} marked ${auditStatus === "PASSED" ? "Passed" : "Failed"}.`,
      data: {
        id: data.id,
        caseNumber: data.case_number,
        auditStatus,
        marks: data.audit_marks,
        notes: data.audit_notes,
      },
    });
  } catch (err) {
    console.error("updateServiceCaseAudit error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/service-cases/bulk-submit
// body: { items: [{ id, submissionType, queryText }, ...], onBehalfOf? }
// Same as submit but for many cases at once — each case picks its own
// outcome, so this takes an items array rather than a flat list of ids.
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
      if (!SUBMISSION_TYPES.includes(it.submissionType)) {
        return res.status(400).json({
          success: false,
          message:
            "Every case needs a status of 'Completed', 'Query', 'Completed by Team' or 'Completed by Client'.",
        });
      }
      if (it.submissionType === "QUERY" && !it.queryText) {
        return res.status(400).json({
          success: false,
          message: "Every case marked 'Query' needs its query text filled in.",
        });
      }
    }

    // Whose cases are these? (yourself, or — for Super Admin / Ops
    // Manager — the employee whose profile is open.)
    const acting = getActingEmployeeId(req);
    if (!acting.ok) {
      return res.status(403).json({ success: false, message: acting.message });
    }

    const now = new Date().toISOString();
    let submittedCount = 0;
    // One update per case since each can have a different outcome —
    // all scoped to (org, acting employee) so this can only ever touch
    // that one employee's own cases.
    await Promise.all(
      cleaned.map(async (it) => {
        const { data, error } = await supabase
          .from("service_cases")
          .update({
            submission_status: "SUBMITTED",
            submission_type: it.submissionType,
            query_text: it.submissionType === "QUERY" ? it.queryText : null,
            submitted_at: now,
            // who pressed Submit (see submitServiceCase).
            submitted_by: req.user.userId,
          })
          .eq("id", it.id)
          .eq("organization_id", req.user.organizationId)
          .eq("assigned_employee_id", acting.employeeId)
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

// ------------------------------------------------------------
// POST /api/service-cases/self-allocate
// Body: { caseIds: string[] }
//
// Profile page's "Self Allocate" flow — an employee takes still-PENDING
// cases for themselves.
//   1. assigned_employee_id/allocated_by are always req.user.userId —
//      never taken from the request body.
//   2. Each case is only claimed if it is STILL pending and unassigned
//      at the moment of the update — a case someone else grabbed a
//      moment earlier is silently skipped.
// ------------------------------------------------------------
async function selfAllocateServiceCases(req, res) {
  try {
    const caseIds = Array.isArray(req.body.caseIds)
      ? req.body.caseIds.map((id) => (id || "").toString()).filter(Boolean)
      : [];

    if (caseIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Select at least one case first." });
    }

    const now = new Date().toISOString();
    let allocatedCount = 0;
    const allocatedCases = [];

    await Promise.all(
      caseIds.map(async (id) => {
        const { data, error } = await supabase
          .from("service_cases")
          .update({
            assigned_employee_id: req.user.userId,
            allocation_status: "ALLOCATED",
            allocated_at: now,
            allocated_by: req.user.userId,
          })
          .eq("id", id)
          .eq("organization_id", req.user.organizationId)
          .eq("allocation_status", "PENDING")
          .is("assigned_employee_id", null)
          .select("id, case_number")
          .maybeSingle();
        if (error) throw error;
        if (data) {
          allocatedCount++;
          allocatedCases.push(data);
        }
      }),
    );

    if (allocatedCount === 0) {
      return res.status(409).json({
        success: false,
        message:
          "Those case(s) are no longer pending — someone else may have already taken them.",
      });
    }

    res.status(201).json({
      success: true,
      message: `You've allocated ${allocatedCount} case(s) to yourself.`,
      data: { allocatedCount, cases: allocatedCases },
    });
  } catch (err) {
    console.error("selfAllocateServiceCases error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getAutoPrefix,
  updateServiceCaseNumber,
  listServiceCases,
  createServiceCases,
  manualCreateServiceCases,
  createCountOnlyEntry,
  listCountOnlyEntries,
  deleteCountOnlyEntry,
  uploadCustomServiceCases,
  downloadUploadTemplate,
  deleteServiceCase,
  allocateServiceCase,
  autoAllocateServiceCases,
  // NEW (NOTIFY)
  notifyAllocation,
  listAllocationClearLog,
  updateServiceCaseProfile,
  updateServiceCaseClient,
  bulkUpdateServiceCaseProfiles,
  submitServiceCase,
  resolveQueryServiceCase,
  completeQueryServiceCase,
  bulkSubmitServiceCases,
  selfAllocateServiceCases,
  updateServiceCaseQc,
  updateServiceCaseAudit,
  // MODIFIED: helpers exported for servicecasecountallocations.controller.js
  // (without these the count endpoints crashed with "undefined is not a function").
  getProduct,
  assertVerticalHeadCanUseProduct,
  getProductNameMap,
  getClientNameMap,
  getSubclientNameMap,
  getEmployeeNameMap,
};
