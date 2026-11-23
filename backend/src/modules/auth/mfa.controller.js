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
const { sendMail } = require("../../mailer");

const tokenOf = (req) =>
  req.headers.authorization?.replace("Bearer ", "") || req.cookies?.accessToken;

const fail = (res, err, fallback) => {
  const status = err?.status >= 400 && err?.status < 500 ? err.status : 400;
  return res.status(status).json({ success: false, message: fallback });
};

// Recovery codes are ONLY for the Global Admin (SUPER_ADMIN). Everyone else
// who loses their authenticator asks the Global Admin to reset their 2FA.
const canHaveRecoveryCodes = (role) => role === "SUPER_ADMIN";

// GET /api/auth/mfa/status
const status = async (req, res) => {
  try {
    const factors = await mfa.listFactors(req.user.userId);
    const verified = factors.find(mfa.isVerifiedTotp);
    let recoveryCodesRemaining = null; // null = could not be read
    if (verified && canHaveRecoveryCodes(req.user.role)) {
      try {
        recoveryCodesRemaining = await mfa.countRecoveryCodes(req.user.userId);
      } catch (e) {
        console.error("MFA recovery count error:", e?.message);
      }
    }
    return res.json({
      success: true,
      data: {
        enabled: !!verified,
        required: mfa.isMfaRequired(req.user.role),
        recoveryCodesSupported: canHaveRecoveryCodes(req.user.role),
        recoveryCodesRemaining,
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
    // Recovery codes: shown to the user ONCE, right now. If creating them
    // fails, 2FA is still on - the user can generate codes from Settings.
    // Only the Global Admin gets codes - other roles get none.
    let recoveryCodes = null;
    if (canHaveRecoveryCodes(req.user.role)) {
      try {
        recoveryCodes = await mfa.replaceRecoveryCodes(req.user.userId);
      } catch (e) {
        console.error("MFA recovery codes error:", e?.message);
      }
    }
    return res.json({
      success: true,
      message: "Two-factor authentication is now on.",
      data: { csrfToken, recoveryCodes },
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
    return registerWrongAttempt(
      res,
      pending,
      "That code is not correct. Please try again.",
    );
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
    await mfa.deleteRecoveryCodes(req.user.userId).catch(() => {});
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
    await mfa.deleteRecoveryCodes(targetId).catch(() => {});
    invalidateAuthCacheForUser(targetId);
    console.log(`MFA reset: ${req.user.userId} reset 2FA for ${targetId}`);
    notifyUser(
      targetId,
      "Your two-factor authentication was reset",
      "A Global Admin of your organization reset the two-factor authentication on your account. Sign in with your password and set it up again. If you did not ask for this, contact your Global Admin right away.",
    );
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

// Best-effort security e-mail ("your 2FA was reset / a recovery code was
// used"). Never blocks or fails the request it belongs to.
const notifyUser = async (userId, subject, text) => {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const to = data?.user?.email;
    if (!to) return;
    await sendMail({
      to,
      subject,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#17181C"><p>${text}</p></div>`,
    });
  } catch (e) {
    console.error("MFA notify error:", e?.message);
  }
};

// One wrong attempt inside the sealed pending cookie (shared by the 6-digit
// code and the recovery code, 5 in total, same deadline).
const registerWrongAttempt = (res, pending, message) => {
  const attempts = (pending.attempts || 0) + 1;
  if (attempts >= mfa.MAX_CODE_ATTEMPTS) {
    clearMfaPendingCookie(res);
    return res.status(401).json({
      success: false,
      message: "Too many wrong codes. Please log in again.",
    });
  }
  setMfaPendingCookie(
    res,
    mfa.sealPending({ ...pending, attempts }),
    Math.max(1000, pending.exp - Date.now()),
  );
  return res.status(401).json({ success: false, message });
};

// POST /api/auth/mfa/verify-recovery { code }   (public - uses the pending cookie)
// Lost authenticator: ONE recovery code (a) signs the user in and (b) removes
// the old authenticator, so the user is sent to set up a new one (and gets a
// fresh set of recovery codes). The used code is burned first.
const verifyRecovery = async (req, res) => {
  const pending = mfa.openPending(req.cookies?.mfaPending);
  if (!pending || !pending.refreshToken || !pending.user?.id) {
    clearMfaPendingCookie(res);
    return res.status(401).json({
      success: false,
      message: "Your sign-in expired. Please log in again.",
    });
  }
  const userId = pending.user.id;
  try {
    const code = req.body?.code;
    const ok = mfa.isRecoveryCode(code)
      ? await mfa.consumeRecoveryCode(userId, code)
      : false;
    if (!ok) {
      return registerWrongAttempt(
        res,
        pending,
        "That recovery code is not valid or was already used.",
      );
    }

    // valid: drop the lost authenticator (and any leftover codes)
    const factors = await mfa.listFactors(userId);
    for (const f of factors) await mfa.deleteFactor(userId, f.id);
    await mfa.deleteRecoveryCodes(userId).catch(() => {});
    invalidateAuthCacheForUser(userId);
    console.log(`MFA recovery code used: 2FA removed for ${userId}`);

    clearMfaPendingCookie(res);
    const csrfToken = setAuthCookies(res, {
      accessToken: pending.accessToken,
      refreshToken: pending.refreshToken,
    });
    notifyUser(
      userId,
      "A recovery code was used on your account",
      "A recovery code was just used to sign in to your account, and your old authenticator was removed. You will set up a new one now. If this was not you, change your password and contact your Global Admin immediately.",
    );
    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: pending.user,
        csrfToken,
        // the old authenticator is gone -> the app sends the user to set up a new one
        mfaSetupRequired: mfa.isMfaRequired(pending.user.role),
        recoveryUsed: true,
      },
    });
  } catch (err) {
    console.error("MFA recovery error:", err?.message);
    return res.status(500).json({
      success: false,
      message: "Could not use the recovery code. Please try again.",
    });
  }
};

// POST /api/auth/mfa/recovery-codes { code }   (logged in, 2FA on)
// New set of recovery codes (the old ones stop working). Needs a current
// authenticator code. Returns the plain codes ONCE.
const regenerateRecoveryCodes = async (req, res) => {
  try {
    if (!canHaveRecoveryCodes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message:
          "Recovery codes are only for the Global Admin. Ask your Global Admin to reset your 2FA if you lose your authenticator.",
      });
    }
    const factors = await mfa.listFactors(req.user.userId);
    const verified = factors.find(mfa.isVerifiedTotp);
    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "Turn on two-factor authentication first.",
      });
    }
    await mfa.challengeAndVerify(tokenOf(req), verified.id, req.body?.code);
    const recoveryCodes = await mfa.replaceRecoveryCodes(req.user.userId);
    return res.json({ success: true, data: { recoveryCodes } });
  } catch (err) {
    return fail(res, err, "That code is not correct. Please try again.");
  }
};

module.exports = {
  status,
  enroll,
  enrollVerify,
  verifyLogin,
  verifyRecovery,
  regenerateRecoveryCodes,
  disable,
  reset,
};
