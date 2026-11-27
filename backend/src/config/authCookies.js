// src/config/authCookies.js
//
// Single source of truth for how the access/refresh/CSRF cookies are
// set and cleared. Frontend (Vercel) and backend (Render) live on
// different domains, so these cookies MUST be cross-site — which means
// SameSite=None + Secure is required (browsers reject SameSite=None
// without Secure). Because SameSite=None does NOT protect against CSRF
// by itself, we also issue a separate, non-httpOnly "csrfToken" cookie
// (double-submit pattern) — see middlewares/csrf.js.

const crypto = require("crypto");

const ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — matches Supabase's access token lifetime

// HOW LONG A LOGIN SURVIVES AFTER THE USER LEAVES
//   AUTH_SESSION_MODE=browser    (default) the login is a "session cookie":
//                                closing the browser (all windows) logs the
//                                user out. Closing just one tab does not.
//   AUTH_SESSION_MODE=timed      logged out after AUTH_IDLE_HOURS (default 12)
//                                of no activity. The timer restarts every time
//                                the session is refreshed (about hourly while
//                                the app is in use).
//   AUTH_SESSION_MODE=persistent old behaviour: stays logged in 30 days.
// NOTE: this controls the browser's cookies. To also expire the session on the
// SERVER side (a copied token), use Supabase -> Authentication -> Sessions
// (inactivity timeout / time-box; Pro plan).
const SESSION_MODE = String(process.env.AUTH_SESSION_MODE || "browser")
  .trim()
  .toLowerCase();
const IDLE_HOURS = Math.max(1, Number(process.env.AUTH_IDLE_HOURS) || 12);

// undefined => no maxAge => a browser-session cookie
const REFRESH_TOKEN_MAX_AGE_MS =
  SESSION_MODE === "persistent"
    ? 30 * 24 * 60 * 60 * 1000
    : SESSION_MODE === "timed"
      ? IDLE_HOURS * 60 * 60 * 1000
      : undefined;
const CSRF_TOKEN_MAX_AGE_MS = REFRESH_TOKEN_MAX_AGE_MS;

// spread helper: adds maxAge only when there is one
const withAge = (ms) => (ms === undefined ? {} : { maxAge: ms });

const isProd = process.env.NODE_ENV === "production";

const baseCookieOpts = {
  httpOnly: true,
  secure: isProd, // must be true in production (SameSite=None requires it); relaxed in local http dev
  sameSite: isProd ? "none" : "lax",
  path: "/",
};

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie("accessToken", accessToken, {
    ...baseCookieOpts,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
  res.cookie("refreshToken", refreshToken, {
    ...baseCookieOpts,
    ...withAge(REFRESH_TOKEN_MAX_AGE_MS),
  });

  // NOT httpOnly on purpose — the frontend JS needs to read this value
  // and echo it back in an X-CSRF-Token header on every state-changing
  // request. It is not a secret; it only proves the request originated
  // from JS running on our own frontend origin (same-origin policy
  // stops a malicious site from reading it), not from a forged
  // cross-site form/image/etc.
  const csrfToken = generateCsrfToken();
  res.cookie("csrfToken", csrfToken, {
    ...baseCookieOpts,
    httpOnly: false,
    ...withAge(CSRF_TOKEN_MAX_AGE_MS),
  });

  return csrfToken;
}

// Short-lived, encrypted cookie that carries a "password OK, 2FA code still
// needed" login between the two steps (see modules/auth/mfa.service.js).
function setMfaPendingCookie(res, sealed, maxAgeMs = 60 * 1000) {
  res.cookie("mfaPending", sealed, {
    ...baseCookieOpts,
    maxAge: maxAgeMs,
  });
}

function clearMfaPendingCookie(res) {
  res.clearCookie("mfaPending", { ...baseCookieOpts });
}

function clearAuthCookies(res) {
  const clearOpts = { ...baseCookieOpts };
  res.clearCookie("mfaPending", clearOpts);
  res.clearCookie("accessToken", clearOpts);
  res.clearCookie("refreshToken", clearOpts);
  res.clearCookie("csrfToken", { ...clearOpts, httpOnly: false });
}

module.exports = {
  setAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
  setMfaPendingCookie,
  clearMfaPendingCookie,
};
