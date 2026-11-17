// hrDetails.js
//
// Optional "HR details" captured on the Add User form (Super Admin only).
// Lives in its own table (employee_hr_details, see backend/sql/
// hr_employee_details.sql) because it holds sensitive data (PAN, Aadhaar).
//
//   - HR_FIELDS      : the ONE place that maps request key -> DB column.
//   - sanitizeHrDetails() : trims, validates, drops empty values.
//   - saveHrDetails()     : inserts the row for a freshly created user.
//
// IMPORTANT: values here are never logged (no console.log of the payload).

// Roles that may see / fill the HR details section. Change here if HR gets
// its own role later. Keep in sync with HR_ALLOWED_ROLES in adduser.tsx.
const HR_ALLOWED_ROLES = ["SUPER_ADMIN"];

const canEditHrDetails = (role) => HR_ALLOWED_ROLES.includes(role);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// type: "text" | "date"; max = max length for text; pattern = extra check
const HR_FIELDS = {
  panNo: {
    column: "pan_no",
    label: "PAN",
    type: "text",
    max: 10,
    upper: true,
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    patternMsg: "PAN must look like ABCDE1234F.",
  },
  nameOnPan: {
    column: "name_on_pan",
    label: "Name on PAN",
    type: "text",
    max: 100,
  },
  aadhaarNo: {
    column: "aadhaar_no",
    label: "Aadhaar",
    type: "text",
    max: 12,
    pattern: /^\d{12}$/,
    patternMsg: "Aadhaar must be exactly 12 digits.",
  },
  nameOnAadhaar: {
    column: "name_on_aadhaar",
    label: "Name on Aadhaar",
    type: "text",
    max: 100,
  },
  uanNo: {
    column: "uan_no",
    label: "UAN",
    type: "text",
    max: 12,
    pattern: /^\d{12}$/,
    patternMsg: "UAN must be exactly 12 digits.",
  },
  pfNo: {
    column: "pf_no",
    label: "PF No.",
    type: "text",
    max: 40,
    upper: true,
  },
  esiNo: { column: "esi_no", label: "ESI No.", type: "text", max: 40 },
  voterId: {
    column: "voter_id",
    label: "Voter ID",
    type: "text",
    max: 20,
    upper: true,
  },
  passportNo: {
    column: "passport_no",
    label: "Passport No.",
    type: "text",
    max: 20,
    upper: true,
  },
  drivingLicenceNo: {
    column: "driving_licence_no",
    label: "Driving Licence No.",
    type: "text",
    max: 30,
    upper: true,
  },
  drivingLicenceValidUpto: {
    column: "driving_licence_valid_upto",
    label: "Driving Licence valid upto",
    type: "date",
  },
  maritalStatus: {
    column: "marital_status",
    label: "Marital Status",
    type: "text",
    max: 20,
    oneOf: ["Single", "Married", "Divorced", "Widowed"],
  },
  marriageDate: {
    column: "marriage_date",
    label: "Marriage Date",
    type: "date",
  },
  grade: { column: "grade", label: "Grade", type: "text", max: 30 },
  level: { column: "level", label: "Level", type: "text", max: 30 },

  applicationDate: {
    column: "application_date",
    label: "Application Date",
    type: "date",
  },
  interviewDate: {
    column: "interview_date",
    label: "Interview Date",
    type: "date",
  },
  confirmationDate: {
    column: "confirmation_date",
    label: "Confirmation Date",
    type: "date",
  },
  lastIncrementDate: {
    column: "last_increment_date",
    label: "Last Increment Date",
    type: "date",
  },
  pfStartDate: {
    column: "pf_start_date",
    label: "PF Start Date",
    type: "date",
  },
  epsStartDate: {
    column: "eps_start_date",
    label: "EPS Start Date",
    type: "date",
  },
  esiStartDate: {
    column: "esi_start_date",
    label: "ESI Start Date",
    type: "date",
  },
  terminationReason: {
    column: "termination_reason",
    label: "Termination Reason",
    type: "text",
    max: 200,
  },
  pfLeftReason: {
    column: "pf_left_reason",
    label: "PF Left Reason",
    type: "text",
    max: 200,
  },
  esiLeftReason: {
    column: "esi_left_reason",
    label: "ESI Left Reason",
    type: "text",
    max: 200,
  },
};

/**
 * @returns {{ clean: object, error: string|null }}
 *   clean = { <dbColumn>: value } for the filled fields only.
 */
function sanitizeHrDetails(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object") return { clean, error: null };

  for (const [key, def] of Object.entries(HR_FIELDS)) {
    let v = raw[key];
    if (v === undefined || v === null) continue;
    v = String(v).trim();
    if (!v) continue;

    if (def.type === "date") {
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
        return { clean: {}, error: `${def.label} must be a valid date.` };
      }
    } else {
      if (def.upper) v = v.toUpperCase();
      if (v.length > def.max) {
        return { clean: {}, error: `${def.label} is too long.` };
      }
      if (def.oneOf && !def.oneOf.includes(v)) {
        return { clean: {}, error: `Please pick a valid ${def.label}.` };
      }
      if (def.pattern && !def.pattern.test(v)) {
        return { clean: {}, error: def.patternMsg };
      }
    }
    clean[def.column] = v;
  }

  // Cross-field date sanity
  if (
    clean.marriage_date &&
    clean.marriage_date > new Date().toISOString().slice(0, 10)
  ) {
    return { clean: {}, error: "Marriage Date can't be in the future." };
  }

  return { clean, error: null };
}

/**
 * Inserts the HR row for a freshly created user. Never throws: HR details
 * are optional, so a failure here must not undo the account. Returns
 * { saved, error }.
 */
async function saveHrDetails({
  supabaseAdmin,
  authUserId,
  organizationId,
  clean,
}) {
  if (!clean || Object.keys(clean).length === 0) {
    return { saved: false, error: null };
  }
  try {
    const { error } = await supabaseAdmin.from("employee_hr_details").insert({
      auth_user_id: authUserId,
      organization_id: organizationId,
      ...clean,
    });
    if (error) throw error;
    return { saved: true, error: null };
  } catch (err) {
    console.error(
      "[add-user] HR details NOT saved (run backend/sql/hr_employee_details.sql?):",
      err?.message || err,
    );
    return {
      saved: false,
      error: err?.message || "Could not save HR details.",
    };
  }
}

module.exports = {
  HR_ALLOWED_ROLES,
  HR_FIELDS,
  canEditHrDetails,
  sanitizeHrDetails,
  saveHrDetails,
};
