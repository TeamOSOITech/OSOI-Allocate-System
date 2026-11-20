// mfa.service.js
//
// TOTP two-factor authentication (Google Authenticator / Authy / Microsoft
// Authenticator ...) on top of Supabase Auth's built-in MFA.
//
// Why direct REST calls (fetch) instead of supabase.auth.mfa.*?
// The SDK keeps the "current session" inside the client object. This backend
// is stateless and shares clients between requests, so we talk to GoTrue
// directly and pass the *user's own* access token on every call.
const crypto = require("crypto");
const supabase = require("../../config/supabaseClient");

const SUPABASE_URL = process.env.SUPABASE_URL;
const API_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ISSUER = process.env.MFA_ISSUER || "Allookate";
// password OK -> the 6-digit code must follow within this many minutes.
// Change with MFA_PENDING_MINUTES in .env (default 1 for now; 5 is a comfortable
// value once testing is over).
const PENDING_TTL_MS =
  (Number(process.env.MFA_PENDING_MINUTES) > 0
    ? Number(process.env.MFA_PENDING_MINUTES)
    : 1) *
  60 *
  1000;
const MAX_CODE_ATTEMPTS = 5; // wrong codes before the user must log in again

const isCode = (v) => typeof v === "string" && /^\d{6}$/.test(v.trim());

// ---------------------------------------------------------------- GoTrue REST
async function gotrue(path, { method = "POST", token, body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(
      json?.msg ||
        json?.message ||
        json?.error_description ||
        "MFA request failed",
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------- factors
const isVerifiedTotp = (f) =>
  f && f.factor_type === "totp" && f.status === "verified";

// All factors of a user (service role). Used for status / cleanup / reset.
async function listFactors(userId) {
  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  return data?.factors || [];
}

// The user's verified TOTP factor, or null.
// Always asks Supabase's admin API (the source of truth) instead of trusting
// the `factors` array inside the sign-in response, which can be missing or
// out of date. One extra call per login is a fair price for never skipping
// 2FA by mistake. FAILS CLOSED: if we cannot find out, the caller gets an
// error (never "no 2FA").
async function getVerifiedTotpFactor(user) {
  const factors = await listFactors(user.id);
  const verified = factors.find(isVerifiedTotp) || null;
  console.log(
    `MFA check: ${factors.length} factor(s), 2FA ${verified ? "ON" : "off"} for this login`,
  );
  return verified;
}

async function deleteFactor(userId, factorId) {
  const { error } = await supabase.auth.admin.mfa.deleteFactor({
    id: factorId,
    userId,
  });
  if (error) throw error;
}

// Starts enrollment: returns the QR code (SVG data URL) + manual secret.
async function enrollTotp(token) {
  const f = await gotrue("/factors", {
    token,
    body: {
      factor_type: "totp",
      friendly_name: `${ISSUER}-${Date.now()}`, // must be unique per user
      issuer: ISSUER,
    },
  });
  return {
    factorId: f.id,
    qrCode: f.totp?.qr_code,
    secret: f.totp?.secret,
    uri: f.totp?.uri,
  };
}

// challenge + verify in one go. Returns the NEW session (aal2).
async function challengeAndVerify(token, factorId, code) {
  if (!isCode(code)) {
    const e = new Error("Enter the 6-digit code from your authenticator app.");
    e.status = 400;
    throw e;
  }
  const challenge = await gotrue(`/factors/${factorId}/challenge`, { token });
  return gotrue(`/factors/${factorId}/verify`, {
    token,
    body: { challenge_id: challenge.id, code: code.trim() },
  });
}

// ---------------------------------------------------------------- pending login
// Between "password correct" and "code correct" the user has an aal1 session
// that must NOT become a login. We keep it in a short-lived, ENCRYPTED,
// httpOnly cookie (AES-256-GCM) - nothing is stored on the server, so this
// works with several server instances too.
const sealKey = () =>
  crypto
    .createHash("sha256")
    .update(`${process.env.MFA_PENDING_SECRET || API_KEY}|mfa-pending`)
    .digest();

function sealPending(payload) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([
    c.update(
      JSON.stringify({
        ...payload,
        exp: payload.exp || Date.now() + PENDING_TTL_MS,
      }),
    ),
    c.final(),
  ]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

function openPending(value) {
  try {
    const buf = Buffer.from(String(value || ""), "base64url");
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv(
      "aes-256-gcm",
      sealKey(),
      buf.subarray(0, 12),
    );
    d.setAuthTag(buf.subarray(12, 28));
    const json = JSON.parse(
      Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"),
    );
    return json.exp > Date.now() ? json : null;
  } catch {
    return null; // tampered / expired / wrong key
  }
}

// WHO MUST USE 2FA - set MFA_REQUIRED_ROLES in .env:
//   (not set) or ALL   -> everyone, every role (the default)
//   SUPER_ADMIN,OPS_MANAGER -> only those roles
//   NONE               -> nobody (2FA stays optional)
// A user who must use 2FA but has not turned it on can ONLY reach the 2FA
// setup endpoints and logout until they do (enforced in middlewares/auth.js).
const requiredRoles = () =>
  String(process.env.MFA_REQUIRED_ROLES || "ALL")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);

const isMfaRequired = (role) => {
  const list = requiredRoles();
  if (list.includes("NONE")) return false;
  if (list.includes("ALL") || list.includes("*")) return true;
  return list.includes(String(role || "").toUpperCase());
};

module.exports = {
  PENDING_TTL_MS,
  MAX_CODE_ATTEMPTS,
  isCode,
  isVerifiedTotp,
  listFactors,
  getVerifiedTotpFactor,
  deleteFactor,
  enrollTotp,
  challengeAndVerify,
  sealPending,
  openPending,
  requiredRoles,
  isMfaRequired,
};
