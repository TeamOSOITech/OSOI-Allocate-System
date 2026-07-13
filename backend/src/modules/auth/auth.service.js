const getSupabaseClient = require("../../config/db");

const login = async (email, password) => {
  const supabase = getSupabaseClient();

  console.log("==================================");
  console.log("Login attempt for real email:", email);

  const { data: candidates, error: candidatesError } = await supabase
    .from("user_master")
    .select("*")
    .eq("Email", email);

  if (candidatesError || !candidates || candidates.length === 0) {
    console.error("NO CANDIDATES FOUND:", candidatesError);
    throw new Error("Invalid email or password");
  }

  console.log(`Found ${candidates.length} account(s) for this email`);

  let authData = null;
  let matchedUser = null;

  for (const candidate of candidates) {
    const loginEmail = candidate["Login Email"];

    console.log("Trying Login Email:", loginEmail);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    console.log("Supabase Error:", error);

    if (!error && data?.session) {
      authData = data;
      matchedUser = candidate;
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
    throw new Error(
      "No role assigned to this account. Contact an administrator.",
    );
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

// NEW: Forgot password — sends a reset email for every role-account
// registered under this real email (there may be more than one,
// since this system allows multiple accounts per email under different roles).
const forgotPassword = async (email) => {
  const supabase = getSupabaseClient();

  console.log("==================================");
  console.log("Forgot password request for:", email);

  const { data: rows, error } = await supabase
    .from("user_master")
    .select('"Login Email", "Role"')
    .eq("Email", email);

  if (error) {
    console.error("FORGOT PASSWORD LOOKUP ERROR:", error);
    throw new Error(error.message);
  }

  // Always respond the same way whether or not the email exists —
  // this prevents leaking which emails have accounts to an attacker.
  if (!rows || rows.length === 0) {
    console.log(
      "No accounts found for this email (not revealing this to caller).",
    );
    return { message: "If an account exists, a reset link has been sent." };
  }

  for (const row of rows) {
    const loginEmail = row["Login Email"];
    if (!loginEmail) continue;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      loginEmail,
      {
        redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
      },
    );

    if (resetError) {
      console.error(`RESET EMAIL FAILED for ${loginEmail}:`, resetError);
    } else {
      console.log(`Reset email sent for role ${row["Role"]} -> ${loginEmail}`);
    }
  }

  return { message: "If an account exists, a reset link has been sent." };
};

module.exports = {
  login,
  forgotPassword,
};
