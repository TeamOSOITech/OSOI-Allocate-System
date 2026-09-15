// SECURITY FIX: replaces the `xlsx` (SheetJS) npm package, which was
// used across clients/subclients/products/service-cases bulk upload to
// parse USER-UPLOADED files. xlsx@0.18.5 (the last version SheetJS
// published to npm) has known, unpatched Prototype Pollution and ReDoS
// advisories — since this package is fed attacker-controlled files by
// any authenticated user with bulk-upload access, a crafted file could
// hang the whole Node process (every tenant affected, single process)
// or pollute Object.prototype. SheetJS's own fix requires installing
// from their CDN instead of npm, which isn't something this project can
// depend on. `exceljs` was already a dependency (used for generating
// the upload templates) and only reads the modern OOXML/CSV formats —
// no legacy-binary-.xls parser, which is exactly the surface those
// advisories live in. Net effect: same parsing behavior for the .xlsx/
// .csv files these upload flows actually expect, minus the vulnerable
// dependency and minus .xls support (see fileFilter changes in each
// routes.js — old-format .xls is now rejected at upload with a message
// asking for .xlsx/.csv instead, rather than silently mis-parsed).
const ExcelJS = require("exceljs");
const { Readable } = require("stream");

// A rich-text/hyperlink/formula cell in ExcelJS is an object, not a
// plain value — unwrap it the same way XLSX.utils.sheet_to_json's
// plain-value cells behaved (so downstream `.toString().trim()` calls
// in the four callers keep working unchanged). Dates become an ISO
// "YYYY-MM-DD" string rather than a JS Date object or Excel's raw
// serial-number, since none of the four bulk templates use date
// columns today — this is just a sane, stringifiable default should
// someone add one, or paste an auto-formatted date into a free-text
// cell.
function cellToPlainValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "object") {
    if (Array.isArray(raw.richText)) {
      return raw.richText.map((part) => part.text).join("");
    }
    if (raw.text !== undefined) return raw.text; // hyperlink cell
    if (raw.result !== undefined) return raw.result; // formula cell
  }
  return raw;
}

// Row 1 is always the header in every template this project generates
// (see each module's downloadTemplate/downloadUploadTemplate) — same
// assumption XLSX.utils.sheet_to_json made by default.
function worksheetToRows(worksheet, defval) {
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const columnCount = Math.max(worksheet.columnCount, headerRow.cellCount);
  const headers = [];
  for (let col = 1; col <= columnCount; col++) {
    const value = cellToPlainValue(headerRow.getCell(col).value);
    headers[col] = value === null || value === undefined ? "" : String(value);
  }

  const rows = [];
  const lastRow = worksheet.lastRow ? worksheet.lastRow.number : 1;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const obj = {};
    let hasAnyValue = false;

    for (let col = 1; col <= columnCount; col++) {
      const key = headers[col];
      if (!key) continue;
      const value = cellToPlainValue(row.getCell(col).value);
      if (value !== null && value !== undefined && value !== "") {
        hasAnyValue = true;
      }
      obj[key] = value === null || value === undefined ? defval : value;
    }

    // Skip fully blank rows — matches how every caller already treats
    // them (they'd fail their own "row identifier is required" checks
    // anyway; this just avoids counting/reporting ghost rows for the
    // trailing blank rows Excel often leaves in a saved sheet).
    if (hasAnyValue) rows.push(obj);
  }

  return rows;
}

/**
 * Parses an uploaded spreadsheet buffer into an array of plain row
 * objects keyed by the header row — a drop-in replacement for
 * `XLSX.utils.sheet_to_json(sheet, { defval })`.
 *
 * @param {Buffer} buffer - the uploaded file's raw bytes (multer
 *   memoryStorage gives this directly via req.file.buffer; disk-storage
 *   uploads should fs.readFile the path first).
 * @param {string} originalFilename - req.file.originalname, used only
 *   to decide the CSV vs. XLSX parser (by extension).
 * @param {{ defval?: any }} [options] - defval is substituted for
 *   empty/missing cells, matching each caller's previous defval
 *   ("" for clients/subclients/service-cases, null for products).
 */
async function parseSpreadsheetRows(buffer, originalFilename, options = {}) {
  const { defval = "" } = options;
  const ext = String(originalFilename || "")
    .toLowerCase()
    .slice(String(originalFilename || "").lastIndexOf("."));

  if (ext === ".xls") {
    throw new Error(
      "Legacy .xls files are no longer supported — please save the file as .xlsx or .csv and upload again.",
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    if (ext === ".csv") {
      await workbook.csv.read(Readable.from(buffer));
    } else {
      await workbook.xlsx.load(buffer);
    }
  } catch (err) {
    throw new Error(
      "Could not read this file — make sure it's a valid .xlsx or .csv export and try again.",
    );
  }

  return worksheetToRows(workbook.worksheets[0], defval);
}

module.exports = { parseSpreadsheetRows };
