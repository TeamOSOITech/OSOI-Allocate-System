// src/modules/servicecases/acceptanceFields.js
//
// Tiny helper so the allocate endpoints can write the acceptance_* columns
// (sql/allocation_acceptance.sql) WITHOUT breaking allocation on a database
// where that migration has not been run yet: try with the columns, and if the
// database says they do not exist, do the same write once more without them.

const isMissingAcceptanceColumn = (err) =>
  !!err &&
  (err.code === "42703" ||
    err.code === "PGRST204" ||
    /acceptance_status|acceptance_reminder_sent_at|accepted_at/i.test(
      err.message || "",
    ));

// run(extraFields) must perform the write and return the supabase result.
async function withAcceptanceFallback(run, acceptanceFields) {
  const first = await run(acceptanceFields);
  if (first && first.error && isMissingAcceptanceColumn(first.error)) {
    console.warn(
      "[acceptance] acceptance_* columns missing — run sql/allocation_acceptance.sql. Allocating without Accept/Decline.",
    );
    return run({});
  }
  return first;
}

// what a fresh allocation writes: waiting (PENDING) when someone else
// allocated it, already accepted when the person allocated it to himself.
function acceptanceForAllocation({ toEmployeeId, byUserId, now }) {
  if (!toEmployeeId) {
    // un-allocated / cleared: back to the default
    return {
      acceptance_status: "ACCEPTED",
      accepted_at: null,
      acceptance_reminder_sent_at: null,
    };
  }
  if (String(toEmployeeId) === String(byUserId)) {
    return {
      acceptance_status: "ACCEPTED",
      accepted_at: now,
      acceptance_reminder_sent_at: null,
    };
  }
  return {
    acceptance_status: "PENDING",
    accepted_at: null,
    acceptance_reminder_sent_at: null,
  };
}

module.exports = {
  isMissingAcceptanceColumn,
  withAcceptanceFallback,
  acceptanceForAllocation,
};
