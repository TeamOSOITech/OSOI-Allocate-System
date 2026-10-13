// Neutralises spreadsheet formula injection: a text cell starting with
// = + - @ (or tab/CR) is prefixed with ' so Excel shows it as plain text.
// Numbers and real formulas we write ourselves are untouched (only string
// cells of type "s" are changed).
import type { WorkSheet } from "xlsx";

export function safeSheet<T extends WorkSheet>(ws: T): T {
    for (const key of Object.keys(ws)) {
        if (key.startsWith("!")) continue;
        const cell = (ws as any)[key];
        if (cell && cell.t === "s" && typeof cell.v === "string" && /^[=+\-@\t\r]/.test(cell.v)) {
            cell.v = "'" + cell.v;
        }
    }
    return ws;
}
