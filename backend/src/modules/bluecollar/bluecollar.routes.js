// src/modules/bluecollar/bluecollar.routes.js
//
// Blue Collar (manpower-based) mode. Everything for it lives here so the
// existing service-based (White Collar) modules stay untouched.
//
// Tables (see backend/sql/blue_collar.sql): blue_locations,
// blue_role_services, blue_team_requirements, blue_submissions, plus the
// collar_type / blue_location_id columns on user_master.
//
//   GET    /locations                      list locations (+ headcount)
//   POST   /locations                      add a location
//   DELETE /locations/:id                  remove a location
//   GET    /role-services                  Location / Role / Service (+ Time) rows
//   GET    /role-services/template         Excel template download
//   POST   /role-services/upload           Excel upload (Location, Role, Service, optional Time)
//   DELETE /role-services/:id              remove one mapping
//   GET    /team-view?date=                managers -> teams -> people + attendance
//   PUT    /team-requirements              how many people a team needs
//   PATCH  /employees/:id/assign           move a person to another team / location
//   GET    /my-services                    the logged-in employee's tick-list
//   POST   /submissions                    employee submits ticked services
//   GET    /submissions?date=              admin view of submissions
//   GET    /allocations?date=              manager: who is allocated which services
//   PUT    /allocations                    manager: save a day's allocation
//   GET    /my-allocations                 a person's allocated work (Profile)
//
// Allocation table: blue_allocations (see blue_allocations.sql).
// Optional service time: column blue_role_services.service_time (text), e.g.
//   alter table public.blue_role_services add column if not exists service_time text;

const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");
const { applyColumnValidation } = require("../../utils/excelValidation");
const router = express.Router();

const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");
const { authorize, requirePermission } = require("../../middlewares/rbac");
const { isIsoDate } = require("../../utils/orgGuards");
const { parseSpreadsheetRows } = require("../../utils/parseSpreadsheet");
const employeesService = require("../employees/employees.service");
const attendanceService = require("../attendance/attendance.service");
const { todayYmdInAppTz } = require("../servicecases/caseRollover");

const MANAGER_ROLES = [
  "SUPER_ADMIN",
  "OPS_MANAGER",
  "AUDIT_MANAGER",
  "PROCESS_LEAD",
  "VERTICAL_HEAD",
];
const STANDBY_TEAM = "Standby";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|csv)$/i.test(file.originalname || "");
    if (!ok) return cb(new Error("Please upload an .xlsx or .csv file."));
    cb(null, true);
  },
});

router.use(authenticate);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const fail = (res, err, status = 500, message = "Something went wrong.") => {
  console.error(`[bluecollar] ${res.req.method} ${res.req.originalUrl}:`, err);
  const detail =
    process.env.NODE_ENV !== "production" ||
    process.env.EXPOSE_ERROR_DETAIL === "true"
      ? { detail: err?.message }
      : {};
  return res.status(status).json({ success: false, message, ...detail });
};

const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v) => clean(v).toLowerCase();

/* ------------------------------------------------------------------ */
/*  Optional service time: "10:00 AM" or "10:00 AM - 11:00 AM"        */
/* ------------------------------------------------------------------ */

function parseOneTime(str) {
  const m = String(str)
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase() : "";
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return { h, min };
}

const fmtOneTime = ({ h, min }) =>
  `${((h + 11) % 12) + 1}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;

// -> { ok: true, value: "" | "10:00 AM" | "10:00 AM - 11:00 AM" } or { ok: false }
function normalizeServiceTime(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: "" };
  }
  let parts;
  if (typeof raw === "number") {
    // an Excel time cell read as a day fraction
    if (!(raw >= 0 && raw < 1)) return { ok: false };
    const total = Math.round(raw * 1440) % 1440;
    parts = [{ h: Math.floor(total / 60), min: total % 60 }];
  } else {
    const t = clean(raw);
    if (!t) return { ok: true, value: "" };
    // Excel turned a time cell into a date string -> the time is lost
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false };
    const bits = t.split(/\s*(?:-|–|—|\bto\b)\s*/i);
    if (bits.length > 2) return { ok: false };
    parts = bits.map(parseOneTime);
    if (parts.some((x) => !x)) return { ok: false };
  }
  return { ok: true, value: parts.map(fmtOneTime).join(" - ") };
}

// minutes since midnight of the first time in the text (no time -> last)
function timeSortKey(text) {
  const first = clean(text).split(" - ")[0];
  const p = first ? parseOneTime(first) : null;
  return p ? p.h * 60 + p.min : 99999;
}

/* ------------------------------------------------------------------ */
/*  Locations                                                          */
/* ------------------------------------------------------------------ */

async function fetchLocations(orgId) {
  const { data, error } = await supabase
    .from("blue_locations")
    .select("id, name")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

router.get("/locations", authorize(...MANAGER_ROLES), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const [locations, people] = await Promise.all([
      fetchLocations(orgId),
      employeesService.fetchAllEmployees(orgId, "BLUE"),
    ]);
    const counts = {};
    people.forEach((p) => {
      if (p.locationId) counts[p.locationId] = (counts[p.locationId] || 0) + 1;
    });
    res.json({
      success: true,
      data: locations.map((l) => ({ ...l, employeeCount: counts[l.id] || 0 })),
    });
  } catch (err) {
    fail(res, err, 500, "Failed to load locations.");
  }
});

router.post(
  "/locations",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const name = clean(req.body?.name);
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "Location name is required." });
      }
      const existing = (await fetchLocations(req.user.organizationId)).find(
        (l) => norm(l.name) === norm(name),
      );
      if (existing) {
        return res
          .status(409)
          .json({ success: false, message: "This location already exists." });
      }
      const { data, error } = await supabase
        .from("blue_locations")
        .insert({ organization_id: req.user.organizationId, name })
        .select("id, name")
        .single();
      if (error) throw error;
      res.status(201).json({ success: true, data });
    } catch (err) {
      fail(res, err, 500, "Failed to add location.");
    }
  },
);

router.delete(
  "/locations/:id",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;
      const { id } = req.params;
      // people at this location are simply "unassigned" afterwards
      await supabase
        .from("user_master")
        .update({ blue_location_id: null })
        .eq("organization_id", orgId)
        .eq("blue_location_id", id);
      const { error } = await supabase
        .from("blue_locations")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      fail(res, err, 500, "Failed to delete location.");
    }
  },
);

/* ------------------------------------------------------------------ */
/*  Role -> services (Excel upload)                                    */
/* ------------------------------------------------------------------ */

router.get("/role-services", authorize(...MANAGER_ROLES), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const [{ data, error }, locations] = await Promise.all([
      supabase
        .from("blue_role_services")
        .select("id, location_id, role_name, service_name, service_time")
        .eq("organization_id", orgId)
        .order("role_name", { ascending: true })
        .order("service_name", { ascending: true }),
      fetchLocations(orgId),
    ]);
    if (error) throw error;
    const locName = Object.fromEntries(locations.map((l) => [l.id, l.name]));
    res.json({
      success: true,
      data: (data || []).map((r) => ({
        id: r.id,
        locationId: r.location_id,
        locationName: locName[r.location_id] || "",
        role: r.role_name,
        service: r.service_name,
        time: r.service_time || "",
      })),
    });
  } catch (err) {
    fail(res, err, 500, "Failed to load role services.");
  }
});

router.get(
  "/role-services/template",
  authorize(...MANAGER_ROLES),
  async (req, res) => {
    try {
      // Live org data on every download: current locations + roles already
      // in use. New values are still allowed by the upload (it creates
      // them), so these dropdowns only WARN instead of blocking.
      const orgId = req.user.organizationId;
      const [locs, roleRows] = await Promise.all([
        fetchLocations(orgId),
        supabase
          .from("blue_role_services")
          .select("role_name")
          .eq("organization_id", orgId),
      ]);
      const locNames = [
        ...new Set(locs.map((l) => clean(l.name)).filter(Boolean)),
      ];
      const roleNames = [
        ...new Set(
          (roleRows.data || []).map((r) => clean(r.role_name)).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b));

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Role Services");
      ws.columns = [
        { header: "Location", key: "location", width: 22 },
        { header: "Role", key: "role", width: 22 },
        { header: "Service", key: "service", width: 30 },
        { header: "Time (optional)", key: "time", width: 24 },
      ];
      ws.getRow(1).font = { bold: true };
      // keep Time as plain text so Excel does not turn "10:00 AM" into a date
      ws.getColumn(4).numFmt = "@";
      [
        ["Plant A", "Office Boy", "Jhadoo", "09:00 AM"],
        ["Plant A", "Office Boy", "Pocha", "09:30 AM"],
        ["Plant A", "Office Boy", "Washroom saaf", "11:00 AM - 12:00 PM"],
        ["Plant A", "Office Boy", "Utensil cleaning", ""],
      ].forEach((r) => ws.addRow(r));

      // hidden Lists sheet: A locations | B roles
      const L = wb.addWorksheet("Lists", { state: "hidden" });
      [
        ["A", 1, locNames, "Location"],
        ["B", 2, roleNames, "Role"],
      ].forEach(([col, idx, values, label]) => {
        if (!values.length) return;
        values.forEach((v, i) => (L.getCell(i + 1, idx).value = v));
        const colL = String.fromCharCode(64 + idx);
        applyColumnValidation(ws, col, {
          type: "list",
          formulae: [`Lists!$${colL}$1:$${colL}$${values.length}`],
          errorStyle: "warning",
          errorTitle: `New ${label}`,
          error: `"${label}" isn't in the list. Keep it only if you want to add a new one.`,
        });
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="role-services-template.xlsx"',
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      fail(res, err, 500, "Failed to build the template.");
    }
  },
);

router.post(
  "/role-services/upload",
  requirePermission("employees.manage"),
  (req, res, next) =>
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "Please choose a file." });
      }
      const orgId = req.user.organizationId;
      const rawRows = await parseSpreadsheetRows(
        req.file.buffer,
        req.file.originalname,
        { defval: "" },
      );

      // headers are matched case-insensitively ("location", "LOCATION", ...)
      const pickRaw = (row, name) => {
        const key = Object.keys(row).find((k) => norm(k) === name);
        return key ? row[key] : "";
      };
      const pick = (row, name) => clean(pickRaw(row, name));
      // "Time" or "Time (optional)" both work
      const pickTime = (row) => {
        const key = Object.keys(row).find((k) => /^time\b/.test(norm(k)));
        return key ? row[key] : "";
      };

      const locations = await fetchLocations(orgId);
      const locIdByName = new Map(locations.map((l) => [norm(l.name), l.id]));

      const toInsert = new Map(); // dedupe inside the file
      const errors = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const location = pick(row, "location");
        const role = pick(row, "role");
        const service = pick(row, "service");
        const line = i + 2; // header is row 1
        if (!location || !role || !service) {
          errors.push({
            line,
            message: "Location, Role and Service are all required.",
          });
          continue;
        }
        const tm = normalizeServiceTime(pickTime(row));
        if (!tm.ok) {
          errors.push({
            line,
            message:
              'Time must look like "10:00 AM" or "10:00 AM - 11:00 AM" (type it as text).',
          });
          continue;
        }
        toInsert.set(`${norm(location)}|${norm(role)}|${norm(service)}`, {
          location,
          role,
          service,
          time: tm.value,
        });
      }

      // create any location that does not exist yet
      const newLocations = [];
      for (const r of toInsert.values()) {
        if (
          !locIdByName.has(norm(r.location)) &&
          !newLocations.some((n) => norm(n) === norm(r.location))
        ) {
          newLocations.push(r.location);
        }
      }
      if (newLocations.length) {
        const { data: created, error } = await supabase
          .from("blue_locations")
          .insert(
            newLocations.map((name) => ({ organization_id: orgId, name })),
          )
          .select("id, name");
        if (error) throw error;
        (created || []).forEach((l) => locIdByName.set(norm(l.name), l.id));
      }

      // what is already saved, so we can tell new rows from updated times
      const { data: existing, error: exErr } = await supabase
        .from("blue_role_services")
        .select("location_id, role_name, service_name, service_time")
        .eq("organization_id", orgId);
      if (exErr) throw exErr;
      const existingByKey = new Map(
        (existing || []).map((r) => [
          `${r.location_id}|${norm(r.role_name)}|${norm(r.service_name)}`,
          r,
        ]),
      );

      const withTime = [];
      const withoutTime = [];
      let added = 0;
      let updated = 0;
      for (const r of toInsert.values()) {
        const locationId = locIdByName.get(norm(r.location));
        const base = {
          organization_id: orgId,
          location_id: locationId,
          role_name: r.role,
          service_name: r.service,
        };
        const prev = existingByKey.get(
          `${locationId}|${norm(r.role)}|${norm(r.service)}`,
        );
        if (!prev) added++;
        if (r.time) {
          withTime.push({ ...base, service_time: r.time });
          if (prev && (prev.service_time || "") !== r.time) updated++;
        } else {
          withoutTime.push(base);
        }
      }
      const total = withTime.length + withoutTime.length;
      const onConflict = "organization_id,location_id,role_name,service_name";

      // rows with a time: insert, or update the time of an existing service
      if (withTime.length) {
        const { error } = await supabase
          .from("blue_role_services")
          .upsert(withTime, { onConflict });
        if (error) throw error;
      }
      // rows without a time: a re-upload of the same sheet is harmless and
      // never wipes a time that was set earlier
      if (withoutTime.length) {
        const { error } = await supabase
          .from("blue_role_services")
          .upsert(withoutTime, { onConflict, ignoreDuplicates: true });
        if (error) throw error;
      }

      res.json({
        success: true,
        data: {
          rowsInFile: rawRows.length,
          added,
          updated,
          alreadyExisted: Math.max(total - added, 0),
          newLocations: newLocations.length,
          errors,
        },
      });
    } catch (err) {
      fail(res, err, 400, err?.message || "Upload failed.");
    }
  },
);

router.delete(
  "/role-services/:id",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("blue_role_services")
        .delete()
        .eq("id", req.params.id)
        .eq("organization_id", req.user.organizationId);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      fail(res, err, 500, "Failed to delete.");
    }
  },
);

/* ------------------------------------------------------------------ */
/*  Team view                                                          */
/* ------------------------------------------------------------------ */

router.get("/team-view", authorize(...MANAGER_ROLES), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const date = isIsoDate(req.query.date) ? req.query.date : todayYmdInAppTz();

    const [everyone, locations, attendance] = await Promise.all([
      employeesService.fetchAllEmployees(orgId, "ALL"),
      fetchLocations(orgId),
      attendanceService.fetchAttendanceForDate(orgId, date),
    ]);

    let requirements = [];
    let submissions = [];
    try {
      const [reqRes, subRes] = await Promise.all([
        supabase
          .from("blue_team_requirements")
          .select("team_name, required_count")
          .eq("organization_id", orgId),
        supabase
          .from("blue_submissions")
          .select("employee_id, services")
          .eq("organization_id", orgId)
          .eq("work_date", date),
      ]);
      if (reqRes.error) throw reqRes.error;
      if (subRes.error) throw subRes.error;
      requirements = reqRes.data || [];
      submissions = subRes.data || [];
    } catch (e) {
      console.error("[bluecollar] team-view extras skipped:", e?.message || e);
    }

    const attById = new Map(attendance.map((a) => [a.employee_id, a.status]));
    const subById = new Map(
      submissions.map((s) => [s.employee_id, (s.services || []).length]),
    );
    const locName = Object.fromEntries(locations.map((l) => [l.id, l.name]));
    const nameByEmail = new Map(
      everyone.map((e) => [norm(e.email), e.name || e.email]),
    );

    let blue = everyone.filter((e) => e.collarType === "BLUE");

    // Vertical Head only sees their own team (same rule as /api/employees)
    if (req.user.role === "VERTICAL_HEAD") {
      const self = everyone.find((e) => e.id === req.user.userId);
      const ownTeam = norm(self?.team);
      blue = blue.filter(
        (e) =>
          e.id === req.user.userId || (ownTeam && norm(e.team) === ownTeam),
      );
    }

    const people = blue.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      role: e.role,
      designation: e.designation,
      team: clean(e.team) || "Unassigned",
      managerEmail: clean(e.reportingManager),
      managerName:
        nameByEmail.get(norm(e.reportingManager)) ||
        clean(e.reportingManager) ||
        "No manager",
      locationId: e.locationId,
      locationName: e.locationId ? locName[e.locationId] || "" : "",
      status: attById.get(e.id) || "PRESENT",
      submittedCount: subById.get(e.id) || 0,
    }));

    res.json({
      success: true,
      data: {
        date,
        standbyTeam: STANDBY_TEAM,
        people,
        locations,
        requirements: requirements.map((r) => ({
          team: r.team_name,
          required: r.required_count,
        })),
      },
    });
  } catch (err) {
    fail(res, err, 500, "Failed to load team view.");
  }
});

router.put(
  "/team-requirements",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const teamName = clean(req.body?.teamName);
      const required = Number(req.body?.requiredCount);
      if (!teamName || !Number.isInteger(required) || required < 0) {
        return res.status(400).json({
          success: false,
          message: "teamName and a whole-number requiredCount are required.",
        });
      }
      const { error } = await supabase.from("blue_team_requirements").upsert(
        {
          organization_id: req.user.organizationId,
          team_name: teamName,
          required_count: required,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,team_name" },
      );
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      fail(res, err, 500, "Failed to save requirement.");
    }
  },
);

router.patch(
  "/employees/:id/assign",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;
      const { id } = req.params;
      const { team, locationId } = req.body || {};

      const { data: target, error: tErr } = await supabase
        .from("user_master")
        .select('"Auth User Id", collar_type')
        .eq("Auth User Id", id)
        .eq("organization_id", orgId)
        .limit(1);
      if (tErr) throw tErr;
      if (!target?.length || target[0].collar_type !== "BLUE") {
        return res.status(404).json({
          success: false,
          message: "Blue Collar employee not found.",
        });
      }

      const update = {};
      if (team !== undefined) update["Worked In Teams"] = clean(team) || null;
      if (locationId !== undefined) {
        if (locationId) {
          const ok = (await fetchLocations(orgId)).some(
            (l) => l.id === locationId,
          );
          if (!ok) {
            return res
              .status(404)
              .json({ success: false, message: "Location not found." });
          }
        }
        update.blue_location_id = locationId || null;
      }
      if (!Object.keys(update).length) {
        return res
          .status(400)
          .json({ success: false, message: "Nothing to change." });
      }

      const { error } = await supabase
        .from("user_master")
        .update(update)
        .eq("Auth User Id", id)
        .eq("organization_id", orgId);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      fail(res, err, 500, "Failed to move this person.");
    }
  },
);

/* ------------------------------------------------------------------ */
/*  Employee side: tick-list + submit                                  */
/* ------------------------------------------------------------------ */

// Services this employee may tick: those mapped to THEIR role (Designation)
// at THEIR location. An employee with no location yet sees the role's
// services from every location.
async function servicesForEmployee(orgId, userId) {
  const { data: me, error } = await supabase
    .from("user_master")
    .select('"Designation", blue_location_id, collar_type')
    .eq("Auth User Id", userId)
    .eq("organization_id", orgId)
    .limit(1);
  if (error) throw error;
  const row = me?.[0];
  if (!row)
    return {
      role: "",
      locationId: null,
      locationName: "",
      services: [],
      allocated: false,
    };

  const role = clean(row.Designation);
  const locationId = row.blue_location_id || null;

  let q = supabase
    .from("blue_role_services")
    .select("id, location_id, role_name, service_name, service_time")
    .eq("organization_id", orgId)
    .ilike(
      "role_name",
      role.replace(/[\\%_]/g, (c) => `\\${c}`),
    );
  if (locationId) q = q.eq("location_id", locationId);
  const [{ data, error: sErr }, locations] = await Promise.all([
    role ? q : Promise.resolve({ data: [], error: null }),
    fetchLocations(orgId),
  ]);
  if (sErr) throw sErr;

  const locName = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const seen = new Set();
  const services = [];
  (data || [])
    .filter((r) => norm(r.role_name) === norm(role))
    .forEach((r) => {
      const key = norm(r.service_name);
      if (seen.has(key)) return;
      seen.add(key);
      services.push({
        id: r.id,
        name: r.service_name,
        time: r.service_time || "",
        locationName: locName[r.location_id] || "",
      });
    });
  // timed services first (earliest first), then the rest A-Z
  services.sort(
    (a, b) =>
      timeSortKey(a.time) - timeSortKey(b.time) || a.name.localeCompare(b.name),
  );

  // Duties are automatic: a present person always has their own role's
  // services. A manager may add EXTRA duties for today (e.g. the pantry
  // cleaner is absent, so the office boy covers it); those are appended.
  let extraNames = [];
  try {
    const { data: al } = await supabase
      .from("blue_allocations")
      .select("services")
      .eq("organization_id", orgId)
      .eq("employee_id", userId)
      .eq("work_date", todayYmdInAppTz())
      .limit(1);
    if (al?.[0] && Array.isArray(al[0].services)) extraNames = al[0].services;
  } catch (e) {
    console.error("[bluecollar] extra duty lookup skipped:", e?.message || e);
  }
  const ownKeys = new Set(services.map((s) => norm(s.name)));
  const extraKeys = extraNames.map(norm).filter((k) => !ownKeys.has(k));
  let extras = [];
  if (extraKeys.length) {
    let eq = supabase
      .from("blue_role_services")
      .select("id, location_id, service_name, service_time")
      .eq("organization_id", orgId);
    if (locationId) eq = eq.eq("location_id", locationId);
    const { data: er } = await eq;
    const seenE = new Set();
    (er || []).forEach((r) => {
      const key = norm(r.service_name);
      if (!extraKeys.includes(key) || seenE.has(key)) return;
      seenE.add(key);
      extras.push({
        id: r.id,
        name: r.service_name,
        time: r.service_time || "",
        locationName: locName[r.location_id] || "",
        extra: true,
      });
    });
    extras.sort((a, b) => a.name.localeCompare(b.name));
  }
  const visible = [...services, ...extras];

  return {
    role,
    locationId,
    locationName: locationId ? locName[locationId] || "" : "",
    services: visible,
    allocated: extras.length > 0,
  };
}

router.get("/my-services", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const today = todayYmdInAppTz();
    const info = await servicesForEmployee(orgId, req.user.userId);

    let submitted = null;
    const { data: sub } = await supabase
      .from("blue_submissions")
      .select("services, note, updated_at")
      .eq("employee_id", req.user.userId)
      .eq("work_date", today)
      .limit(1);
    if (sub?.[0]) {
      submitted = {
        services: sub[0].services || [],
        note: sub[0].note || "",
        updatedAt: sub[0].updated_at,
      };
    }

    res.json({ success: true, data: { ...info, workDate: today, submitted } });
  } catch (err) {
    fail(res, err, 500, "Failed to load your services.");
  }
});

router.post("/submissions", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const today = todayYmdInAppTz();
    const picked = Array.isArray(req.body?.services) ? req.body.services : [];
    const note = clean(req.body?.note).slice(0, 500);

    if (picked.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tick at least one service before submitting.",
      });
    }

    // only services mapped to this employee's role/location are accepted
    const info = await servicesForEmployee(orgId, req.user.userId);
    const allowed = new Map(info.services.map((s) => [norm(s.name), s.name]));
    const services = [];
    for (const p of picked) {
      const hit = allowed.get(norm(p));
      if (!hit) {
        return res.status(400).json({
          success: false,
          message: `"${clean(p)}" is not available for your role.`,
        });
      }
      if (!services.includes(hit)) services.push(hit);
    }

    const { error } = await supabase.from("blue_submissions").upsert(
      {
        organization_id: orgId,
        employee_id: req.user.userId,
        location_id: info.locationId,
        work_date: today,
        services,
        note: note || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,work_date" },
    );
    if (error) throw error;
    res
      .status(201)
      .json({ success: true, data: { workDate: today, services } });
  } catch (err) {
    fail(res, err, 500, "Failed to submit.");
  }
});

// A person's own submission history (last N days). A manager may pass
// ?employeeId= to see someone else's (used by the Profile page).
router.get("/my-submissions", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const wanted = clean(req.query.employeeId);
    const targetId =
      wanted && wanted !== req.user.userId ? wanted : req.user.userId;
    if (
      targetId !== req.user.userId &&
      !MANAGER_ROLES.includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own submissions.",
      });
    }
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const [y, m, d] = todayYmdInAppTz().split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, d - days))
      .toISOString()
      .slice(0, 10);

    const [{ data, error }, info] = await Promise.all([
      supabase
        .from("blue_submissions")
        .select("work_date, services, note, updated_at")
        .eq("organization_id", orgId)
        .eq("employee_id", targetId)
        .gte("work_date", from)
        .order("work_date", { ascending: false }),
      servicesForEmployee(orgId, targetId),
    ]);
    if (error) throw error;
    res.json({
      success: true,
      data: {
        role: info.role,
        locationName: info.locationName,
        submissions: (data || []).map((r) => ({
          workDate: r.work_date,
          services: r.services || [],
          note: r.note || "",
          updatedAt: r.updated_at,
        })),
      },
    });
  } catch (err) {
    fail(res, err, 500, "Failed to load submissions.");
  }
});

router.get("/submissions", authorize(...MANAGER_ROLES), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const date = isIsoDate(req.query.date) ? req.query.date : todayYmdInAppTz();
    const [{ data, error }, people] = await Promise.all([
      supabase
        .from("blue_submissions")
        .select("employee_id, location_id, services, note, updated_at")
        .eq("organization_id", orgId)
        .eq("work_date", date),
      employeesService.fetchAllEmployees(orgId, "BLUE"),
    ]);
    if (error) throw error;
    const nameById = Object.fromEntries(people.map((p) => [p.id, p.name]));
    res.json({
      success: true,
      data: (data || []).map((s) => ({
        employeeId: s.employee_id,
        employeeName: nameById[s.employee_id] || "Unknown",
        services: s.services || [],
        note: s.note || "",
        updatedAt: s.updated_at,
      })),
    });
  } catch (err) {
    fail(res, err, 500, "Failed to load submissions.");
  }
});

/* ------------------------------------------------------------------ */
/*  Work allocation: a manager gives each person their services       */
/* ------------------------------------------------------------------ */

// Services a person may be given = those mapped to their Designation at
// their location (or every location when they have none yet).
function allowedServiceNames(roleServiceRows, designation, locationId) {
  const role = norm(designation);
  if (!role) return [];
  const seen = new Set();
  const out = [];
  (roleServiceRows || [])
    .filter(
      (r) =>
        norm(r.role_name) === role &&
        (!locationId || r.location_id === locationId),
    )
    .forEach((r) => {
      const k = norm(r.service_name);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(r.service_name);
    });
  return out.sort((a, b) => a.localeCompare(b));
}

// Services a person can be given AS AN EXTRA: every service at their
// location that is not already part of their own role.
function extraServiceOptions(roleServiceRows, designation, locationId) {
  const own = new Set(
    allowedServiceNames(roleServiceRows, designation, locationId).map(norm),
  );
  const seen = new Set();
  const out = [];
  (roleServiceRows || [])
    .filter((r) => !locationId || r.location_id === locationId)
    .forEach((r) => {
      const k = norm(r.service_name);
      if (own.has(k) || seen.has(k)) return;
      seen.add(k);
      out.push(r.service_name);
    });
  return out.sort((a, b) => a.localeCompare(b));
}

// Same visibility rule as /team-view: a Vertical Head only sees own team.
function visibleBluePeople(req, everyone) {
  let blue = everyone.filter((e) => e.collarType === "BLUE");
  if (req.user.role === "VERTICAL_HEAD") {
    const self = everyone.find((e) => e.id === req.user.userId);
    const ownTeam = norm(self?.team);
    blue = blue.filter(
      (e) => e.id === req.user.userId || (ownTeam && norm(e.team) === ownTeam),
    );
  }
  return blue;
}

router.get("/allocations", authorize(...MANAGER_ROLES), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const today = todayYmdInAppTz();
    const date = isIsoDate(req.query.date) ? req.query.date : today;

    const [everyone, locations, attendance, rs, al, sub] = await Promise.all([
      employeesService.fetchAllEmployees(orgId, "ALL"),
      fetchLocations(orgId),
      attendanceService.fetchAttendanceForDate(orgId, date),
      supabase
        .from("blue_role_services")
        .select("location_id, role_name, service_name")
        .eq("organization_id", orgId),
      supabase
        .from("blue_allocations")
        .select("employee_id, services")
        .eq("organization_id", orgId)
        .eq("work_date", date),
      supabase
        .from("blue_submissions")
        .select("employee_id, services")
        .eq("organization_id", orgId)
        .eq("work_date", date),
    ]);
    if (rs.error) throw rs.error;
    if (al.error) throw al.error;
    if (sub.error) throw sub.error;

    const attById = new Map(attendance.map((a) => [a.employee_id, a.status]));
    const allocById = new Map(
      (al.data || []).map((r) => [r.employee_id, r.services || []]),
    );
    const doneById = new Map(
      (sub.data || []).map((r) => [r.employee_id, r.services || []]),
    );
    const locName = Object.fromEntries(locations.map((l) => [l.id, l.name]));

    const people = visibleBluePeople(req, everyone).map((e) => ({
      id: e.id,
      name: e.name || e.email,
      designation: clean(e.designation),
      team: clean(e.team) || "Unassigned",
      locationId: e.locationId || "",
      locationName: e.locationId ? locName[e.locationId] || "" : "",
      status: attById.get(e.id) || "PRESENT",
      services: allowedServiceNames(rs.data, e.designation, e.locationId),
      extraOptions: extraServiceOptions(rs.data, e.designation, e.locationId),
      extras: allocById.get(e.id) || [],
      done: doneById.get(e.id) || [],
    }));

    res.json({ success: true, data: { date, today, locations, people } });
  } catch (err) {
    fail(res, err, 500, "Failed to load allocation.");
  }
});

router.put(
  "/allocations",
  requirePermission("employees.manage"),
  async (req, res) => {
    try {
      const orgId = req.user.organizationId;
      const date = req.body?.date;
      if (!isIsoDate(date)) {
        return res
          .status(400)
          .json({ success: false, message: "A valid date is required." });
      }
      if (date < todayYmdInAppTz()) {
        return res.status(400).json({
          success: false,
          message: "You cannot change the allocation of a past date.",
        });
      }
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0 || items.length > 500) {
        return res
          .status(400)
          .json({ success: false, message: "Nothing to save." });
      }

      const [everyone, rs] = await Promise.all([
        employeesService.fetchAllEmployees(orgId, "ALL"),
        supabase
          .from("blue_role_services")
          .select("location_id, role_name, service_name")
          .eq("organization_id", orgId),
      ]);
      if (rs.error) throw rs.error;
      const byId = new Map(
        visibleBluePeople(req, everyone).map((e) => [e.id, e]),
      );

      const nowIso = new Date().toISOString();
      const upserts = [];
      const clearIds = [];
      for (const it of items) {
        const emp = byId.get(clean(it?.employeeId));
        if (!emp) {
          return res.status(404).json({
            success: false,
            message: "A Blue Collar employee in the list was not found.",
          });
        }
        const allowed = new Map(
          extraServiceOptions(rs.data, emp.designation, emp.locationId).map(
            (n) => [norm(n), n],
          ),
        );
        const picked = Array.isArray(it.extras)
          ? it.extras
          : Array.isArray(it.services)
            ? it.services
            : [];
        const services = [];
        for (const p of picked) {
          const hit = allowed.get(norm(p));
          if (!hit) {
            return res.status(400).json({
              success: false,
              message: `"${clean(p)}" cannot be given to ${emp.name} as an extra duty.`,
            });
          }
          if (!services.includes(hit)) services.push(hit);
        }
        if (services.length) {
          upserts.push({
            organization_id: orgId,
            employee_id: emp.id,
            location_id: emp.locationId || null,
            work_date: date,
            services,
            allocated_by: req.user.userId,
            updated_at: nowIso,
          });
        } else {
          clearIds.push(emp.id);
        }
      }

      if (upserts.length) {
        const { error } = await supabase
          .from("blue_allocations")
          .upsert(upserts, { onConflict: "employee_id,work_date" });
        if (error) throw error;
      }
      if (clearIds.length) {
        const { error } = await supabase
          .from("blue_allocations")
          .delete()
          .eq("organization_id", orgId)
          .eq("work_date", date)
          .in("employee_id", clearIds);
        if (error) throw error;
      }
      res.json({
        success: true,
        data: { saved: upserts.length, cleared: clearIds.length },
      });
    } catch (err) {
      fail(res, err, 500, "Failed to save allocation.");
    }
  },
);

// A person's allocated work: the last N days plus the next two weeks, with
// how much of each day they have ticked as done. A manager may pass
// ?employeeId= to see someone else's (used by the Profile page).
router.get("/my-allocations", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const wanted = clean(req.query.employeeId);
    const targetId =
      wanted && wanted !== req.user.userId ? wanted : req.user.userId;
    if (
      targetId !== req.user.userId &&
      !MANAGER_ROLES.includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own allocation.",
      });
    }
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const today = todayYmdInAppTz();
    const [y, m, d] = today.split("-").map(Number);
    const ymd = (offset) =>
      new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);

    const [alloc, subs] = await Promise.all([
      supabase
        .from("blue_allocations")
        .select("work_date, services")
        .eq("organization_id", orgId)
        .eq("employee_id", targetId)
        .gte("work_date", ymd(-days))
        .lte("work_date", ymd(14))
        .order("work_date", { ascending: false }),
      supabase
        .from("blue_submissions")
        .select("work_date, services")
        .eq("organization_id", orgId)
        .eq("employee_id", targetId)
        .gte("work_date", ymd(-days))
        .lte("work_date", today),
    ]);
    if (alloc.error) throw alloc.error;
    if (subs.error) throw subs.error;

    const doneByDate = new Map(
      (subs.data || []).map((s) => [s.work_date, (s.services || []).map(norm)]),
    );
    const subServices = new Map(
      (subs.data || []).map((s) => [s.work_date, s.services || []]),
    );
    const extraByDate = new Map(
      (alloc.data || []).map((r) => [r.work_date, r.services || []]),
    );
    // today = own role duties (automatic) + today's extras; any other day =
    // extras given for that day plus whatever the person actually submitted.
    const info = await servicesForEmployee(orgId, targetId);
    const dates = new Set([
      ...extraByDate.keys(),
      ...subServices.keys(),
      today,
    ]);
    const rows = [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map((workDate) => {
        let services;
        if (workDate === today) {
          services = info.services.map((s) => s.name);
        } else {
          services = [...(extraByDate.get(workDate) || [])];
          (subServices.get(workDate) || []).forEach((n) => {
            if (!services.some((x) => norm(x) === norm(n))) services.push(n);
          });
        }
        const done = doneByDate.get(workDate) || [];
        return {
          workDate,
          services,
          extras: extraByDate.get(workDate) || [],
          done: services.filter((s) => done.includes(norm(s))),
        };
      })
      .filter((r) => r.services.length > 0);
    res.json({ success: true, data: { today, allocations: rows } });
  } catch (err) {
    fail(res, err, 500, "Failed to load allocation.");
  }
});

module.exports = router;
