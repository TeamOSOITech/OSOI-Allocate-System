const crypto = require("crypto");
const supabase = require("../config/supabaseClient");
// getUser() mutates the calling client's internal session state, so it
// must run on the isolated auth client, never on the shared service-role
// `supabase` client used for .from(...) queries elsewhere — see the
// comment in supabaseAuthClient.js.
const supabaseAuthClient = require("../config/supabaseAuthClient");

// ---------------------------------------------------------------------
// PERF: short-lived in-memory cache of "token -> resolved user".
//
// Before this, EVERY API request cost two sequential network round trips
// (Supabase Auth getUser + a user_master lookup) before the real work even
// started, and a page like Profile fires 5+ requests at once. Now:
//   - a verified token is remembered for AUTH_CACHE_TTL_MS (default 60s,
//     never longer than the token's own expiry), and
//   - parallel requests carrying the same token share ONE lookup.
// Trade-off: a role/organization change (or a disabled account) can take up
// to the TTL to be noticed. Logout clears the entry immediately
// (invalidateAuthCache, called from the logout handler).
// Set AUTH_CACHE_TTL_MS=0 to switch the cache off completely.
// ---------------------------------------------------------------------
const AUTH_CACHE_TTL_MS = Number.isFinite(Number(process.env.AUTH_CACHE_TTL_MS))
  ? Number(process.env.AUTH_CACHE_TTL_MS)
  : 60 * 1000;
const AUTH_CACHE_MAX = 5000;
const authCache = new Map(); // key -> { user, expiresAt }
const authPending = new Map(); // key -> Promise<result>

const cacheKey = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// Expiry (ms) of the JWT itself, read WITHOUT verifying — it is only used to
// make sure we never cache past the token's lifetime; Supabase has already
// verified the token by the time this is used.
function tokenExpiryMs(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function cacheGet(key) {
  const hit = authCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    authCache.delete(key);
    return null;
  }
  return hit.user;
}

function cacheSet(key, token, user) {
  if (AUTH_CACHE_TTL_MS <= 0) return;
  let expiresAt = Date.now() + AUTH_CACHE_TTL_MS;
  const tokExp = tokenExpiryMs(token);
  if (tokExp) expiresAt = Math.min(expiresAt, tokExp);
  if (expiresAt <= Date.now()) return;
  if (authCache.size >= AUTH_CACHE_MAX) {
    // drop the oldest ~10% (Map keeps insertion order)
    let n = Math.ceil(AUTH_CACHE_MAX / 10);
    for (const k of authCache.keys()) {
      authCache.delete(k);
      if (--n <= 0) break;
    }
  }
  authCache.set(key, { user, expiresAt });
}

// Call on logout so a revoked token stops working immediately.
function invalidateAuthCache(token) {
  if (token) authCache.delete(cacheKey(token));
}

// The original (uncached) verification. Returns { user } on success, or
// { status, message } for a failure — failures are never cached.
async function verifyToken(token) {
  const { data, error } = await supabaseAuthClient.auth.getUser(token);

  if (error || !data?.user) {
    console.error("AUTH: token verification failed:", error?.message);
    return { status: 401, message: "Invalid or expired token" };
  }

  // MULTI-TENANCY: organization_id is resolved server-side from the
  // authenticated user's own row, never trusted from the request — every
  // org-scoped route reads req.user.organizationId from here.
  //
  // A plain list query (not .single()) so a stray duplicate user_master row
  // degrades gracefully instead of failing the request with a 500.
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
    return { status: 500, message: "Could not resolve user role" };
  }

  if (!profiles || profiles.length === 0) {
    console.error("AUTH: no user_master row found for user", data.user.id);
    return { status: 403, message: "No role assigned to this account" };
  }

  if (profiles.length > 1) {
    console.warn(
      `AUTH: ${profiles.length} duplicate user_master rows found for user ${data.user.id} — using the first one returned. Please de-duplicate this table (see the "Auth User Id" column).`,
    );
  }

  const profile = profiles[0];

  if (!profile?.Role) {
    console.error("AUTH: no role found for user", data.user.id);
    return { status: 403, message: "No role assigned to this account" };
  }

  if (!profile?.organization_id) {
    console.error("AUTH: no organization_id found for user", data.user.id);
    return { status: 403, message: "No organization assigned to this account" };
  }

  // Roles are checked as SNAKE_CASE codes (TEAM_MEMBER, VERTICAL_HEAD,
  // PROCESS_LEAD, OPS_MANAGER, AUDIT_MANAGER, SUPER_ADMIN) — see
  // src/config/permissions.js. Collapse spaces so a display-style value
  // like "Team Member" still normalizes to "TEAM_MEMBER".
  return {
    user: {
      userId: data.user.id,
      email: data.user.email,
      role: String(profile.Role).trim().toUpperCase().replace(/\s+/g, "_"),
      organizationId: profile.organization_id,
    },
  };
}

const CLIENT_ALLOWED_PREFIXES = [
  "/api/client-portal",
  "/api/auth/",
  "/api/organization/logo",
];

const authenticate = async (req, res, next) => {
  // COOKIE-AUTH: the browser sends the httpOnly accessToken cookie. The
  // Authorization header is checked first (Postman, mobile app,
  // server-to-server callers), falling back to the cookie.
  const headerToken = req.headers.authorization?.replace("Bearer ", "");
  const cookieToken = req.cookies?.accessToken;
  const token = headerToken || cookieToken;

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  try {
    const key = cacheKey(token);

    let user = AUTH_CACHE_TTL_MS > 0 ? cacheGet(key) : null;

    if (!user) {
      // share one lookup between requests that arrive together
      let pending = authPending.get(key);
      if (!pending) {
        pending = verifyToken(token).finally(() => authPending.delete(key));
        authPending.set(key, pending);
      }
      const result = await pending;

      if (!result.user) {
        return res
          .status(result.status)
          .json({ success: false, message: result.message });
      }
      user = result.user;
      cacheSet(key, token, user);
    }

    // CLIENT LOCKDOWN: an external client login may ONLY reach the client
    // portal API (+ auth/logout and the org logo). Many internal endpoints
    // only require "any logged-in user", so without this check a client
    // could read internal data straight from the API even though the UI
    // has every tab disabled.
    if (
      user.role === "CLIENT" &&
      !CLIENT_ALLOWED_PREFIXES.some((p) => req.originalUrl.startsWith(p))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // hand each request its own copy so a handler can't mutate the cached one
    req.user = { ...user };
    next();
  } catch (err) {
    console.error("MIDDLEWARE AUTH ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Authentication check failed" });
  }
};

module.exports = { authenticate, invalidateAuthCache };
