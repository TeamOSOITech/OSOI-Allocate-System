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
//   GET    /role-services                  Location / Role / Service rows
//   GET    /role-services/template         Excel template download
//   POST   /role-services/upload           Excel upload (Location, Role, Service)
//   DELETE /role-services/:id              remove one mapping
//   GET    /team-view?date=                managers -> teams -> people + attendance
//   PUT    /team-requirements              how many people a team needs
//   PATCH  /employees/:id/assign           move a person to another team / location
//   GET    /my-services                    the logged-in employee's tick-list
//   POST   /submissions                    employee submits ticked services
//   GET    /submissions?date=              admin view of submissions

const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");
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
        .select("id, location_id, role_name, service_name")
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
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Role Services");
      ws.columns = [
        { header: "Location", key: "location", width: 22 },
        { header: "Role", key: "role", width: 22 },
        { header: "Service", key: "service", width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      [
        ["Plant A", "Office Boy", "Jhadoo"],
        ["Plant A", "Office Boy", "Pocha"],
        ["Plant A", "Office Boy", "Washroom saaf"],
        ["Plant A", "Office Boy", "Utensil cleaning"],
      ].forEach((r) => ws.addRow(r));
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
      const pick = (row, name) => {
        const key = Object.keys(row).find((k) => norm(k) === name);
        return key ? clean(row[key]) : "";
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
        toInsert.set(`${norm(location)}|${norm(role)}|${norm(service)}`, {
          location,
          role,
          service,
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

      const rows = [...toInsert.values()].map((r) => ({
        organization_id: orgId,
        location_id: locIdByName.get(norm(r.location)),
        role_name: r.role,
        service_name: r.service,
      }));

      let added = 0;
      if (rows.length) {
        // ignoreDuplicates: a re-upload of the same sheet is harmless
        const { data: inserted, error } = await supabase
          .from("blue_role_services")
          .upsert(rows, {
            onConflict: "organization_id,location_id,role_name,service_name",
            ignoreDuplicates: true,
          })
          .select("id");
        if (error) throw error;
        added = (inserted || []).length;
      }

      res.json({
        success: true,
        data: {
          rowsInFile: rawRows.length,
          added,
          alreadyExisted: Math.max(rows.length - added, 0),
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
    return { role: "", locationId: null, locationName: "", services: [] };

  const role = clean(row.Designation);
  const locationId = row.blue_location_id || null;

  let q = supabase
    .from("blue_role_services")
    .select("id, location_id, role_name, service_name")
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
        locationName: locName[r.location_id] || "",
      });
    });
  services.sort((a, b) => a.name.localeCompare(b.name));

  return {
    role,
    locationId,
    locationName: locationId ? locName[locationId] || "" : "",
    services,
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

module.exports = router;
