// src/utils/excelValidation.js
//
// Helpers to put Excel "Data Validation" (dropdowns, email / date rules)
// on a column of an exceljs worksheet, for the downloadable bulk-upload
// templates.
//
// WHY THIS EXISTS: the exceljs version used by the backend (3.x) cannot
// write a validation keyed by a range ("B2:B500") — it only accepts
// per-cell validations and merges equal neighbouring cells into ranges
// itself when saving. That merge sorts addresses as TEXT ("B10" < "B2"),
// so one long column of identical rules comes out as OVERLAPPING ranges
// (B10:B500 and B2:B500), which makes Excel offer to "repair" the file.
// To avoid it, rows are applied in chunks with the same digit count
// (2-9, 10-99, 100-999, 1000+), and each chunk carries a distinct,
// invisible promptTitle so neighbouring chunks are never merged together.

const CHUNKS = [
  [2, 9],
  [10, 99],
  [100, 999],
  [1000, Infinity],
];

// `rule` = a normal exceljs dataValidation object, except `formulae` may
// also be a function (firstRowOfChunk) => string[] for relative formulas
// like custom rules that refer to the cell itself.
function applyColumnValidation(ws, colLetter, rule, maxRow = 2000) {
  CHUNKS.forEach(([from, to], idx) => {
    if (from > maxRow) return;
    const last = Math.min(to, maxRow);
    const formulae =
      typeof rule.formulae === "function" ? rule.formulae(from) : rule.formulae;
    const chunkRule = {
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: "stop",
      ...rule,
      formulae,
      promptTitle: `rows-${idx}`,
    };
    for (let row = from; row <= last; row++) {
      ws.getCell(`${colLetter}${row}`).dataValidation = chunkRule;
    }
  });
}

// Fixed dropdown, e.g. ["Active", "Inactive"] (short lists only — an
// inline list is limited to 255 characters in total).
function addInlineListValidation(ws, colLetter, values, label, maxRow) {
  applyColumnValidation(
    ws,
    colLetter,
    {
      type: "list",
      formulae: [`"${values.join(",")}"`],
      errorTitle: "Invalid value",
      error: `Please pick a ${label} from the dropdown list.`,
    },
    maxRow,
  );
}

// Dropdown fed from a hidden "Lists" sheet (no length limit).
function addRangeListValidation(
  ws,
  listsSheet,
  listColIndex,
  colLetter,
  values,
  label,
  maxRow,
) {
  values.forEach((v, i) => {
    listsSheet.getCell(i + 1, listColIndex).value = v;
  });
  if (values.length === 0) return;
  const listCol = listsSheet.getColumn(listColIndex).letter;
  applyColumnValidation(
    ws,
    colLetter,
    {
      type: "list",
      formulae: [`Lists!$${listCol}$1:$${listCol}$${values.length}`],
      errorTitle: "Invalid value",
      error: `Please pick a ${label} from the dropdown list.`,
    },
    maxRow,
  );
}

// Email cells must at least look like an address (contain "@" and a dot
// after it).
function addEmailValidation(ws, colLetter, maxRow) {
  applyColumnValidation(
    ws,
    colLetter,
    {
      type: "custom",
      formulae: (first) => [
        `OR(${colLetter}${first}="",AND(ISNUMBER(FIND("@",${colLetter}${first})),ISNUMBER(FIND(".",${colLetter}${first},FIND("@",${colLetter}${first})))))`,
      ],
      errorTitle: "Invalid email",
      error: "Enter a valid email address.",
    },
    maxRow,
  );
}

module.exports = {
  applyColumnValidation,
  addInlineListValidation,
  addRangeListValidation,
  addEmailValidation,
};
