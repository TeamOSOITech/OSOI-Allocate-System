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

    // MULTI-TENANCY: now also fetches organization_id alongside Role.
    // Every org-scoped route reads req.user.organizationId from here —
    // this is the single source of truth for "which tenant is this
    // request allowed to touch", so it must be resolved server-side
    // from the authenticated user's own row, never trusted from the
    // request body/query string (that would let a client claim to be
    // any organization it wants).
    //
    // FIX: this used to be `.single()`, which throws "Cannot coerce the
    // result to a single JSON object" (and hard-fails the request with a
    // 500) the moment MORE THAN ONE row in user_master shares this
    // "Auth User Id" — e.g. from a duplicate insert during onboarding.
    // Switched to a plain list query + manual handling so a stray
    // duplicate row degrades gracefully (pick the most recent one, log a
    // warning) instead of taking the account down entirely. The
    // underlying duplicate should still be cleaned up in the DB — see
    // the console.warn below when it happens.
    const { data: profiles, error: profileError } = await supabase
      .from("user_master")
      .select("Role, organization_id")
      .eq("Auth User Id", data.user.id);

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

    if (!profiles || profiles.length === 0) {
      console.error("AUTH: no user_master row found for user", data.user.id);
      return res
        .status(403)
        .json({ success: false, message: "No role assigned to this account" });
    }

    if (profiles.length > 1) {
      console.warn(
        `AUTH: ${profiles.length} duplicate user_master rows found for user ${data.user.id} — using the first one returned. Please de-duplicate this table (see the "Auth User Id" column).`,
      );
    }

    const profile = profiles[0];

    if (!profile?.Role) {
      console.error("AUTH: no role found for user", data.user.id);
      return res
        .status(403)
        .json({ success: false, message: "No role assigned to this account" });
    }

    if (!profile?.organization_id) {
      console.error("AUTH: no organization_id found for user", data.user.id);
      return res.status(403).json({
        success: false,
        message: "No organization assigned to this account",
      });
    }

    // Roles are checked as SNAKE_CASE codes (TEAM_MEMBER, VERTICAL_HEAD,
    // PROCESS_LEAD, OPS_MANAGER, AUDIT_MANAGER, SUPER_ADMIN) — see
    // src/config/permissions.js. Collapse spaces so a display-style value
    // like "Team Member" still normalizes to "TEAM_MEMBER".
    req.user = {
      userId: data.user.id,
      email: data.user.email,
      role: String(profile.Role).trim().toUpperCase().replace(/\s+/g, "_"),
      organizationId: profile.organization_id,
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
