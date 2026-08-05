// src/middlewares/csrf.js
//
// Double-submit CSRF check. Needed because auth now lives in cookies
// with SameSite=None (required for the frontend/backend cross-domain
// setup), which on its own does NOT stop a malicious site from making
// a browser fire an authenticated request using our cookies.
//
// How it works: the frontend reads the (non-httpOnly) `csrfToken`
// cookie via JS and sends it back as the `X-CSRF-Token` header on
// every state-changing request. A cross-site attacker's page can send
// our cookies automatically, but same-origin policy stops it from
// ever reading the cookie's value to also set the matching header —
// so the two won't match.
//
// Only applied to state-changing methods; GET/HEAD/OPTIONS are exempt
// (they shouldn't mutate anything and browsers don't protect against
// simple GETs the same way).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.headers["x-csrf-token"];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      message: "CSRF check failed. Please refresh the page and try again.",
    });
  }

  next();
}

module.exports = { csrfProtection };
