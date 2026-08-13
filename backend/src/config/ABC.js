// src/config/frontendUrl.js
//
// SECURITY / BUG FIX: FRONTEND_URL is documented (see server.js's CORS
// setup) as a comma-separated list — e.g.
//   FRONTEND_URL=https://your-app.vercel.app,http://localhost:5173
// so multiple origins (prod + local dev) are all allowed by CORS.
//
// Several places (password-reset link generation in auth.service.js,
// registerOrganization.controller.js, user.routes.js) were building a
// redirect URL by directly interpolating the RAW env var:
//   `${process.env.FRONTEND_URL}/reset-password`
// If FRONTEND_URL held more than one origin, this produced a broken,
// malformed link like:
//   "https://your-app.vercel.app,http://localhost:5173/reset-password"
// which would fail for every user resetting their password in
// production. This helper always returns just the FIRST origin in the
// list — the primary/production one should be listed first in the env
// var — so redirect links are always a single, valid URL.
function getPrimaryFrontendUrl() {
  const raw = process.env.FRONTEND_URL || "http://localhost:5173";
  const first = raw.split(",")[0].trim();
  return first || "http://localhost:5173";
}

module.exports = { getPrimaryFrontendUrl };
