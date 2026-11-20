// mfa.controller.js - HTTP handlers for TOTP two-factor authentication.
const supabase = require("../../config/supabaseClient");
const {
  setAuthCookies,
  setMfaPendingCookie,
  clearMfaPendingCookie,
} = require("../../config/authCookies");
const {
  invalidateAuthCache,
  invalidateAuthCacheForUser,
} = require("../../middlewares/auth");
const mfa = require("./mfa.service");

const tokenOf = (req) =>
  req.headers.authorization?.replace("Bearer ", "") || req.cookies?.accessToken;

const fail = (res, err, fallback) => {
  const status = err?.status >= 400 && err?.status < 500 ? err.status : 400;
  return res.status(status).json({ success: false, message: fallback });
};

// GET /api/auth/mfa/status
const status = async (req, res) => {
  try {
    const factors = await mfa.listFactors(req.user.userId);
    const verified = factors.find(mfa.isVerifiedTotp);
    return res.json({
      success: true,
      data: {
        enabled: !!verified,
        required: mfa.isMfaRequired(req.user.role),
      },
    });
  } catch (err) {
    console.error("MFA status error:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: "Could not load 2FA status." });
  }
};

// POST /api/auth/mfa/enroll   -> { factorId, qrCode, secret }
const enroll = async (req, res) => {
  try {
    const factors = await mfa.listFactors(req.user.userId);
    if (factors.some(mfa.isVerifiedTotp)) {
      return res.status(409).json({
        success: false,
        message: "Two-factor authentication is already enabled.",
      });
    }
    // an abandoned, never-confirmed enrollment must not block a new one
    for (const f of factors.filter((x) => x.status !== "verified")) {
      await mfa.deleteFactor(req.user.userId, f.id);
    }
    const data = await mfa.enrollTotp(tokenOf(req));
    return res.json({ success: true, data });
  } catch (err) {
    console.error("MFA enroll error:", err?.message);
    return fail(res, err, "Could not start 2FA setup. Please try again.");
  }
};

// POST /api/auth/mfa/enroll/verify { factorId, code }
// Confirms the first code. The returned session is aal2, so the cookies are
// replaced right away - otherwise the user would be locked out by the very
// 2FA they just switched on.
const enrollVerify = async (req, res) => {
  try {
    const { factorId, code } = req.body || {};
    if (typeof factorId !== "string" || !factorId) {
      return res
        .status(400)
        .json({ success: false, message: "factorId is required." });
    }
    // the factor must belong to THIS user
    const factors = await mfa.listFactors(req.user.userId);
    if (!factors.some((f) => f.id === factorId)) {
      return res
        .status(404)
        .json({ success: false, message: "2FA setup not found." });
    }
    const oldToken = tokenOf(req);
    const session = await mfa.challengeAndVerify(oldToken, factorId, code);
    invalidateAuthCache(oldToken);
    const csrfToken = setAuthCookies(res, {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
    return res.json({
      success: true,
      message: "Two-factor authentication is now on.",
      data: { csrfToken },
    });
  } catch (err) {
    return fail(res, err, "That code is not correct. Please try again.");
  }
};

// POST /api/auth/mfa/verify-login { code }   (public - uses the pending cookie)
const verifyLogin = async (req, res) => {
  const pending = mfa.openPending(req.cookies?.mfaPending);
  if (!pending) {
    clearMfaPendingCookie(res);
    return res.status(401).json({
      success: false,
      message: "Your sign-in expired. Please log in again.",
    });
  }
  try {
    const session = await mfa.challengeAndVerify(
      pending.accessToken,
      pending.factorId,
      req.body?.code,
    );
    clearMfaPendingCookie(res);
    const csrfToken = setAuthCookies(res, {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
    return res.status(200).json({
      success: true,
      message: "Login successful",
      // same shape as the normal login response: { user, csrfToken }
      data: { user: pending.user, csrfToken },
    });
  } catch (err) {
    // count wrong codes INSIDE the sealed cookie; too many -> start over
    const attempts = (pending.attempts || 0) + 1;
    if (attempts >= mfa.MAX_CODE_ATTEMPTS) {
      clearMfaPendingCookie(res);
      return res.status(401).json({
        success: false,
        message: "Too many wrong codes. Please log in again.",
      });
    }
    // keep the ORIGINAL deadline: wrong codes must not extend the 1-minute window
    setMfaPendingCookie(
      res,
      mfa.sealPending({ ...pending, attempts }),
      Math.max(1000, pending.exp - Date.now()),
    );
    return res.status(401).json({
      success: false,
      message: "That code is not correct. Please try again.",
    });
  }
};

// POST /api/auth/mfa/disable { code }
const disable = async (req, res) => {
  try {
    if (mfa.isMfaRequired(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Two-factor authentication is required for your role.",
      });
    }
    const factors = await mfa.listFactors(req.user.userId);
    const verified = factors.find(mfa.isVerifiedTotp);
    if (!verified) {
      return res
        .status(400)
        .json({ success: false, message: "2FA is not enabled." });
    }
    // re-prove possession of the device before turning protection off
    await mfa.challengeAndVerify(tokenOf(req), verified.id, req.body?.code);
    for (const f of factors) await mfa.deleteFactor(req.user.userId, f.id);
    invalidateAuthCacheForUser(req.user.userId);
    return res.json({
      success: true,
      message: "Two-factor authentication is off.",
    });
  } catch (err) {
    return fail(res, err, "That code is not correct. Please try again.");
  }
};

// POST /api/auth/mfa/reset/:userId   (SUPER_ADMIN, same organization only)
// For a lost / replaced phone: removes the target's 2FA so they can log in
// with their password and set it up again.
const reset = async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const targetId = String(req.params.userId || "");
    const { data: rows, error } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("Auth User Id", targetId)
      .eq("organization_id", req.user.organizationId)
      .limit(1);
    if (error) throw error;
    if (!rows?.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    const factors = await mfa.listFactors(targetId);
    for (const f of factors) await mfa.deleteFactor(targetId, f.id);
    invalidateAuthCacheForUser(targetId);
    console.log(`MFA reset: ${req.user.userId} reset 2FA for ${targetId}`);
    return res.json({
      success: true,
      message: "Two-factor authentication was reset.",
    });
  } catch (err) {
    console.error("MFA reset error:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: "Could not reset 2FA." });
  }
};

module.exports = { status, enroll, enrollVerify, verifyLogin, disable, reset };
