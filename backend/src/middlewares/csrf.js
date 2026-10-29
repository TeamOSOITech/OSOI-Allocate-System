// src/middlewares/csrf.js
//
// Double-submit CSRF check. Needed because auth lives in cookies with
// SameSite=None (required for the cross-domain frontend/backend setup),
// which on its own does NOT stop a malicious site from making a browser
// fire an authenticated request with our cookies.
//
// How it works: the frontend sends the csrfToken it got from the login/
// refresh response body back as the `X-CSRF-Token` header on every
// state-changing request. A cross-site attacker's page can make the browser
// send our cookies, but cannot read the token to set a matching header.
//
// Only state-changing methods are checked; GET/HEAD/OPTIONS are exempt
// (they must never mutate anything).
const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Constant-time comparison so the token cannot be guessed byte by byte
// from response timing.
function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (!tokensMatch(req.cookies?.csrfToken, req.headers["x-csrf-token"])) {
    return res.status(403).json({
      success: false,
      message: "CSRF check failed. Please refresh the page and try again.",
    });
  }

  next();
}

module.exports = { csrfProtection };
