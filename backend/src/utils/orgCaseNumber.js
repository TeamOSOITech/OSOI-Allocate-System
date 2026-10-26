// src/utils/orgCaseNumber.js
//
// Org-level "Require case numbers" switch (Settings -> Work rules,
// organizations.case_number_required, default true).
//
//   ON  -> each service keeps its own Case Number Yes/No option
//          (service_master.has_case_number).
//   OFF -> every service is treated as "no case number", whatever is stored.
//          The stored per-service value is NOT changed, so switching the
//          setting back ON restores each service's own choice.

const supabase = require("../config/supabaseClient");

// true unless the org explicitly switched it off (missing column/row = required)
async function isCaseNumberRequired(orgId) {
  const { data } = await supabase
    .from("organizations")
    .select("case_number_required")
    .eq("id", orgId)
    .maybeSingle();
  return data?.case_number_required !== false;
}

// Applies the OFF override to one product row or an array of rows.
function withEffectiveCaseNumber(productOrList, required) {
  if (required) return productOrList;
  if (Array.isArray(productOrList)) {
    return productOrList.map((p) => ({ ...p, has_case_number: false }));
  }
  return productOrList
    ? { ...productOrList, has_case_number: false }
    : productOrList;
}

module.exports = { isCaseNumberRequired, withEffectiveCaseNumber };
