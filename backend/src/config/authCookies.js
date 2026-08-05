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
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CSRF_TOKEN_MAX_AGE_MS = REFRESH_TOKEN_MAX_AGE_MS;

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
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
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
    maxAge: CSRF_TOKEN_MAX_AGE_MS,
  });

  return csrfToken;
}

function clearAuthCookies(res) {
  const clearOpts = { ...baseCookieOpts };
  res.clearCookie("accessToken", clearOpts);
  res.clearCookie("refreshToken", clearOpts);
  res.clearCookie("csrfToken", { ...clearOpts, httpOnly: false });
}

module.exports = { setAuthCookies, clearAuthCookies, generateCsrfToken };
