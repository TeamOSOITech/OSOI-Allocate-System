// Escape % _ \ so user text can be used in .ilike() as an EXACT
// (case-insensitive) match instead of a wildcard pattern.
const escapeLike = (s) => String(s ?? "").replace(/[\\%_]/g, "\\$&");
module.exports = { escapeLike };
