const getSupabaseClient = require("../../config/db");

const login = async (email, password) => {
  const supabase = getSupabaseClient();

  console.log("==================================");
  console.log("Login attempt for real email:", email);

  // Look up every account registered under this real email
  // (there may be multiple — one per role, per the new multi-role rule)
  const { data: candidates, error: candidatesError } = await supabase
    .from("user_master")
    .select("*")
    .eq("Email", email);

  if (candidatesError || !candidates || candidates.length === 0) {
    console.error("NO CANDIDATES FOUND:", candidatesError);
    throw new Error("Invalid email or password");
  }

  console.log(`Found ${candidates.length} account(s) for this email`);

  // Try each candidate's tagged login email against Supabase Auth
  // with the password the user typed. Only the matching role's
  // password will succeed — Supabase Auth itself does the real
  // password verification, we're just trying each tagged identity.
  let authData = null;
  let matchedUser = null;

  for (const candidate of candidates) {
    const loginEmail = candidate["Login Email"];
    if (!loginEmail) continue; // skip rows created before this migration

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (!error && data?.session) {
      authData = data;
      matchedUser = candidate;
      console.log("Matched role account:", candidate["Role"], loginEmail);
      break;
    }
  }

  if (!authData || !matchedUser) {
    console.error("NO MATCHING ROLE ACCOUNT FOR PASSWORD");
    throw new Error("Invalid email or password");
  }

  const rawRole = matchedUser["Role"];

  if (!rawRole) {
    console.error("ROLE MISSING for user:", matchedUser["Auth User Id"]);
    throw new Error("No role assigned to this account. Contact an administrator.");
  }

  const normalizedRole = String(rawRole).trim().toUpperCase();

  console.log("=================================");
  console.log("LOGIN USER:", matchedUser);
  console.log("ROLE:", normalizedRole);
  console.log("=================================");

  return {
    accessToken: authData.session.access_token,
    refreshToken: authData.session.refresh_token,

    user: {
      id: authData.user.id,
      email: matchedUser["Email"],
      role: normalizedRole,
      firstName: matchedUser["First Name"],
      lastName: matchedUser["Last Name"],
      department: matchedUser["Department"],
      designation: matchedUser["Designation"],
    },
  };
};

module.exports = {
  login,
};