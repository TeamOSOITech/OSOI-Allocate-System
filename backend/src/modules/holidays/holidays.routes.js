// src/modules/holidays/holidays.routes.js
//
// Company holiday calendar for the Home page ("Holidays" card, mirrors the
// Birthdays card next to it). Anyone logged in can VIEW the list; only
// SUPER_ADMIN can add/bulk-upload/delete — same shape as options.routes.js
// (single-file module, no separate service/controller split needed for
// something this small).
//
// ASSUMED table: "holidays"
//   id              uuid, primary key, default gen_random_uuid()
//   organization_id uuid, not null
//   name            text, not null   (festival/holiday name)
//   date            date, not null   (the holiday's date — year matters
//                                     only for "which year was this
//                                     uploaded for"; recurrence below is
//                                     computed from month+day so the same
//                                     row keeps showing up every year)
//   created_by      uuid, nullable
//   created_at      timestamptz, not null, default now()
//
// Run once in the Supabase SQL editor if this table doesn't exist yet:
//
//   create table if not exists holidays (
//     id uuid primary key default gen_random_uuid(),
//     organization_id uuid not null,
//     name text not null,
//     date date not null,
//     created_by uuid,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists holidays_org_date_idx on holidays (organization_id, date);

const express = require("express");
const router = express.Router();
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");
const { authorize } = require("../../middlewares/rbac");

router.use(authenticate);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/* ------------------------------------------------------------------ */
/*  Flexible date parsing — "koi bhi format" (any format) requirement  */
/* ------------------------------------------------------------------ */

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeYear(y) {
  const n = Number(y);
  if (n < 100) return n < 50 ? 2000 + n : 1900 + n; // "26" -> 2026, "78" -> 1978
  return n;
}

function isValidYMD(y, m, d) {
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// Accepts: ISO (2026-10-02), Excel serial numbers, "02/10/2026",
// "02-10-2026" (day-first, matches the rest of this app's d-m-y
// convention), "2 October 2026", "October 2, 2026", "02-Oct-2026", and
// falls back to JS's native Date parser for anything else. Returns
// "YYYY-MM-DD" or null if nothing could be made of it.
function parseFlexibleDate(raw) {
  if (raw === null || raw === undefined) return null;

  // Excel serial date (e.g. from a bulk-upload sheet where the cell
  // wasn't formatted as a date) — plausible range ~1950-2150.
  const asNumber = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (
    !Number.isNaN(asNumber) &&
    String(raw).trim() !== "" &&
    asNumber > 18000 &&
    asNumber < 91000
  ) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + asNumber * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // yyyy-mm-dd / yyyy/mm/dd
  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return isValidYMD(+y, +mo, +d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  // "2 October 2026" / "2-Oct-2026" / "2 Oct, 2026"
  m = str.match(/^(\d{1,2})[\s\-/]+([A-Za-z]+)[\s,\-/]+(\d{2,4})$/);
  if (m) {
    const [, d, monName, y] = m;
    const mo = MONTHS[monName.toLowerCase()];
    if (mo !== undefined) {
      const year = normalizeYear(y);
      return isValidYMD(year, mo + 1, +d)
        ? `${year}-${pad2(mo + 1)}-${pad2(d)}`
        : null;
    }
  }

  // "October 2, 2026" / "Oct 2 2026"
  m = str.match(/^([A-Za-z]+)[\s,\-/]+(\d{1,2}),?[\s\-/]+(\d{2,4})$/);
  if (m) {
    const [, monName, d, y] = m;
    const mo = MONTHS[monName.toLowerCase()];
    if (mo !== undefined) {
      const year = normalizeYear(y);
      return isValidYMD(year, mo + 1, +d)
        ? `${year}-${pad2(mo + 1)}-${pad2(d)}`
        : null;
    }
  }

  // Fully numeric: dd/mm/yyyy or dd-mm-yyyy (day-first). Falls back to
  // swapping day/month if the "month" slot is >12 (so mm/dd sheets still
  // parse instead of silently failing).
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    let day = +a;
    let month = +b;
    const year = normalizeYear(y);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return isValidYMD(year, month, day)
      ? `${year}-${pad2(month)}-${pad2(day)}`
      : null;
  }

  // Last resort — native parser (handles things like "October 2 2026",
  // "2026/10/02T00:00:00.000Z", etc.)
  const native = new Date(str);
  if (!Number.isNaN(native.getTime())) {
    return `${native.getFullYear()}-${pad2(native.getMonth() + 1)}-${pad2(native.getDate())}`;
  }

  return null;
}

// Days from today to this year's (or, if already passed, next year's)
// occurrence of the holiday's month/day — this is what makes an uploaded
// "2026-10-02" row keep surfacing as "coming up" every year, not just in
// 2026.
function daysUntilNextOccurrence(isoDate) {
  const [, mo, d] = isoDate.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), mo - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, mo - 1, d);
  const diffMs = next.getTime() - today.getTime();
  return {
    nextOccurrence: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`,
    daysUntil: Math.round(diffMs / 86400000),
  };
}

function mapRow(row) {
  const { nextOccurrence, daysUntil } = daysUntilNextOccurrence(row.date);
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    nextOccurrence,
    daysUntil,
  };
}

/* ------------------------------------------------------------------ */
/*  GET /api/holidays — anyone logged in can view                     */
/* ------------------------------------------------------------------ */
router.get("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const { data, error } = await supabase
      .from("holidays")
      .select("id,name,date")
      .eq("organization_id", orgId);

    if (error) throw error;

    const mapped = (data || [])
      .map(mapRow)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    res.json({ success: true, data: mapped });
  } catch (err) {
    console.error("Failed to fetch holidays:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch holidays" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/holidays — SUPER_ADMIN only, single holiday             */
/* ------------------------------------------------------------------ */
router.post("/", authorize("SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const name = (req.body?.name || "").toString().trim();
    const parsedDate = parseFlexibleDate(req.body?.date);

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Festival/holiday name is required" });
    }
    if (!parsedDate) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Could not understand date "${req.body?.date}"`,
        });
    }

    const { data, error } = await supabase
      .from("holidays")
      .insert({
        organization_id: orgId,
        name,
        date: parsedDate,
        created_by: req.user.userId,
      })
      .select("id,name,date")
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: mapRow(data) });
  } catch (err) {
    console.error("Failed to add holiday:", err);
    res.status(500).json({ success: false, message: "Failed to add holiday" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/holidays/bulk — SUPER_ADMIN only, bulk upload           */
/*  Body: { holidays: [{ name, date }, ...] } — date in ANY format,   */
/*  parsed row-by-row via parseFlexibleDate above.                    */
/* ------------------------------------------------------------------ */
router.post("/bulk", authorize("SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const rows = Array.isArray(req.body?.holidays) ? req.body.holidays : [];

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No rows to upload" });
    }

    const results = [];
    const toInsert = [];

    rows.forEach((row, idx) => {
      const name = (row?.name || "").toString().trim();
      const rawDate = row?.date;
      const parsedDate = parseFlexibleDate(rawDate);

      if (!name) {
        results.push({
          row: idx + 1,
          name: name || "(blank)",
          date: rawDate,
          success: false,
          message: "Festival name is required",
        });
        return;
      }
      if (!parsedDate) {
        results.push({
          row: idx + 1,
          name,
          date: rawDate,
          success: false,
          message: `Could not understand date "${rawDate}"`,
        });
        return;
      }

      toInsert.push({
        organization_id: orgId,
        name,
        date: parsedDate,
        created_by: req.user.userId,
      });
      results.push({
        row: idx + 1,
        name,
        date: parsedDate,
        success: true,
        message: "Queued",
      });
    });

    if (toInsert.length > 0) {
      const { data, error } = await supabase
        .from("holidays")
        .insert(toInsert)
        .select("id,name,date");
      if (error) throw error;

      // Line up inserted rows back onto the queued results, in order.
      let insertedIdx = 0;
      for (const result of results) {
        if (result.success && result.message === "Queued") {
          const inserted = data[insertedIdx++];
          result.message = "Added";
          result.id = inserted?.id;
        }
      }
    }

    const addedCount = results.filter((r) => r.success).length;
    res.status(201).json({
      success: true,
      addedCount,
      failedCount: results.length - addedCount,
      results,
    });
  } catch (err) {
    console.error("Failed to bulk-upload holidays:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to bulk-upload holidays" });
  }
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/holidays/:id — SUPER_ADMIN only                       */
/* ------------------------------------------------------------------ */
router.delete("/:id", authorize("SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const { error } = await supabase
      .from("holidays")
      .delete()
      .eq("id", req.params.id)
      .eq("organization_id", orgId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete holiday:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete holiday" });
  }
});

module.exports = router;
