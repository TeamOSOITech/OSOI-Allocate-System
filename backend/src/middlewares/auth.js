const supabase = require("../config/supabaseClient");

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      console.error("AUTH: token verification failed:", error?.message);
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }

    // FIX: this was previously `.select('"Role"')` — the literal quote
    // characters get sent to PostgREST as part of the column name, so it
    // looked for a column literally called `"Role"` (with quotes in the
    // name) and always failed. That failure was then caught by the
    // generic catch block below and reported as "Invalid or expired
    // token" even though the real token was completely fine — very
    // misleading. Column name goes in unquoted; supabase-js/PostgREST
    // handles the exact case-sensitive name on its own.
    const { data: profile, error: profileError } = await supabase
      .from("user_master")
      .select("Role")
      .eq("Auth User Id", data.user.id)
      .single();

    if (profileError) {
      console.error(
        "AUTH: role lookup failed for user",
        data.user.id,
        profileError.message,
      );
      return res
        .status(500)
        .json({ success: false, message: "Could not resolve user role" });
    }

    if (!profile?.Role) {
      console.error("AUTH: no role found for user", data.user.id);
      return res
        .status(403)
        .json({ success: false, message: "No role assigned to this account" });
    }

    // Roles are checked as SNAKE_CASE codes (TEAM_MEMBER, VERTICAL_HEAD,
    // PROCESS_LEAD, OPS_MANAGER, AUDIT_MANAGER, SUPER_ADMIN) — see
    // src/config/permissions.js. Collapse spaces so a display-style value
    // like "Team Member" still normalizes to "TEAM_MEMBER".
    req.user = {
      userId: data.user.id,
      email: data.user.email,
      role: String(profile.Role).trim().toUpperCase().replace(/\s+/g, "_"),
    };

    next();
  } catch (err) {
    console.error("MIDDLEWARE AUTH ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Authentication check failed" });
  }
};

module.exports = { authenticate };
