// dailywork/bulkTemplate.js
//
// GET /api/daily-work/bulk/template
//
// Daily Work bulk sample sheet WITH Excel validation. The old sheet was
// built in the browser (SheetJS) and validated nothing.
//
//   Service Name -> dropdown of THIS org's services as they are right now
//                   (same list the Daily Work page's Service dropdown
//                   shows) - hard stop on anything else
//   Quantity     -> must be a number greater than 0
const ExcelJS = require("exceljs");
const dailyWorkService = require("./dailywork.service");
const {
  applyColumnValidation,
  addRangeListValidation,
} = require("../../utils/excelValidation");

async function downloadBulkTemplate(req, res) {
  try {
    const services = await dailyWorkService.fetchServicesForOrg(
      req.user.organizationId,
    );
    const names = [
      ...new Set(
        services
          .map((s) => String(s.product_name || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Daily Work");
    ws.columns = [
      { header: "Service Name", key: "s", width: 34 }, // A
      { header: "Quantity", key: "q", width: 14 }, // B
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
    ws.addRow({ s: names[0] || "Example Service", q: 100 });

    const L = wb.addWorksheet("Lists", { state: "hidden" });
    addRangeListValidation(ws, L, 1, "A", names, "Service");

    applyColumnValidation(ws, "B", {
      type: "decimal",
      operator: "greaterThan",
      formulae: [0],
      errorTitle: "Invalid quantity",
      error: "Quantity must be a number greater than 0.",
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="daily_work_bulk_upload_template.xlsx"',
    );
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error("downloadBulkTemplate (daily work) error:", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong on our end. Please try again.",
    });
  }
}

module.exports = { downloadBulkTemplate };
