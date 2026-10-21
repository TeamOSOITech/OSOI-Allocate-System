// users/bulkTemplate.js
//
// GET /api/users/bulk-add-user/template
//
// Bulk Add Users sample sheet WITH Excel dropdown validation. The old
// template was built in the browser with SheetJS, which cannot write data
// validation, so nothing was validated. Same exceljs helpers the Client /
// Subclient / Service-case templates use.
//
//   Role               -> only roles THIS requester may assign (hard stop)
//   Teams              -> org teams (hard stop)
//   Reporting Manager  -> org user emails + added managers (hard stop)
//   Department / Designation -> org values, but WARNING only (typing a new
//                         one is allowed - bulk upload accepts new values)
//   Email / Contact Number / DOB (18+) / DOJ -> format checks
const ExcelJS = require("exceljs");
const supabase = require("../../config/supabaseClient");
const { ASSIGNABLE_ROLES } = require("../../config/permissions");
const { getAllTeams } = require("../teams/teams.service");
const {
  applyColumnValidation,
  addRangeListValidation,
  addEmailValidation,
} = require("../../utils/excelValidation");

const clean = (v) => String(v || "").trim();
const uniqSorted = (arr) =>
  [...new Set(arr.map(clean).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

async function loadLists(orgId) {
  const [dep, des, rm, um, teams] = await Promise.all([
    supabase.from("departments").select("name").eq("organization_id", orgId),
    supabase.from("designations").select("name").eq("organization_id", orgId),
    supabase
      .from("reporting_managers")
      .select("name")
      .eq("organization_id", orgId),
    supabase
      .from("user_master")
      .select('"Email","Department","Designation"')
      .eq("organization_id", orgId),
    getAllTeams(orgId),
  ]);
  const users = um.data || [];
  return {
    departments: uniqSorted([
      ...(dep.data || []).map((r) => r.name),
      ...users.map((u) => u["Department"]),
    ]),
    designations: uniqSorted([
      ...(des.data || []).map((r) => r.name),
      ...users.map((u) => u["Designation"]),
    ]),
    managers: uniqSorted([
      ...users.map((u) => u["Email"]),
      ...(rm.data || []).map((r) => r.name),
    ]),
    teams: uniqSorted(
      (teams || []).map((t) => (typeof t === "string" ? t : t.name)),
    ),
  };
}

async function downloadBulkUserTemplate(req, res) {
  try {
    const lists = await loadLists(req.user.organizationId);
    const roles = ASSIGNABLE_ROLES[req.user.role] || [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Users");
    ws.columns = [
      { header: "Full Name", key: "n", width: 22 }, // A
      { header: "Email", key: "e", width: 30 }, // B
      { header: "Contact Number", key: "c", width: 16 }, // C
      { header: "Employee ID", key: "id", width: 14 }, // D
      { header: "Designation", key: "des", width: 22 }, // E
      { header: "Department", key: "dep", width: 18 }, // F
      { header: "Date of Birth", key: "dob", width: 16 }, // G
      { header: "Date of Joining", key: "doj", width: 16 }, // H
      { header: "Reporting Manager", key: "rm", width: 30 }, // I
      { header: "Teams", key: "t", width: 18 }, // J
      { header: "Password", key: "p", width: 16 }, // K
      { header: "Role", key: "r", width: 18 }, // L
    ];
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2F5597" },
      };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // text format for phone / ids / password, date format for the dates
    ["C", "D", "K"].forEach((c) => (ws.getColumn(c).numFmt = "@"));
    ["G", "H"].forEach((c) => (ws.getColumn(c).numFmt = "yyyy-mm-dd"));

    ws.addRow({
      n: "John Doe",
      e: "john.doe@company.com",
      c: "9876543210",
      id: "EMP12345",
      des: lists.designations[0] || "Senior Developer",
      dep: lists.departments[0] || "Tech",
      dob: new Date(Date.UTC(1995, 4, 10)),
      doj: new Date(Date.UTC(2023, 0, 15)),
      rm: lists.managers[0] || "manager@company.com",
      t: lists.teams[0] || "Tech",
      p: "",
      r: roles.includes("TEAM_MEMBER") ? "TEAM_MEMBER" : roles[0] || "",
    });

    // hidden Lists sheet: A roles | B teams | C managers | D departments | E designations
    const L = wb.addWorksheet("Lists", { state: "hidden" });
    addRangeListValidation(ws, L, 1, "L", roles, "Role");
    addRangeListValidation(ws, L, 2, "J", lists.teams, "Team");
    addRangeListValidation(ws, L, 3, "I", lists.managers, "Reporting Manager");

    // Department / Designation: dropdown, but new values only warn
    [
      ["F", 4, lists.departments, "Department"],
      ["E", 5, lists.designations, "Designation"],
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

    addEmailValidation(ws, "B");

    applyColumnValidation(ws, "C", {
      type: "custom",
      formulae: (r) => [`OR(C${r}="",AND(LEN(C${r})=10,ISNUMBER(--C${r})))`],
      errorTitle: "Invalid contact number",
      error: "Contact number must be exactly 10 digits.",
    });
    // DOB: a real date and the person must be 18+
    applyColumnValidation(ws, "G", {
      type: "custom",
      formulae: (r) => [
        `OR(G${r}="",AND(ISNUMBER(G${r}),G${r}<=EDATE(TODAY(),-216)))`,
      ],
      errorTitle: "Invalid Date of Birth",
      error:
        "Enter a valid date (yyyy-mm-dd). The employee must be 18 or older.",
    });
    applyColumnValidation(ws, "H", {
      type: "custom",
      formulae: (r) => [`OR(H${r}="",AND(ISNUMBER(H${r}),H${r}>36526))`],
      errorTitle: "Invalid Date of Joining",
      error: "Enter a valid date (yyyy-mm-dd).",
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bulk_add_users_template.xlsx"',
    );
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error("downloadBulkUserTemplate error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

module.exports = { downloadBulkUserTemplate };
