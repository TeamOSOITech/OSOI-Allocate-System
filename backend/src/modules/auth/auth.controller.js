const { sendError } = require("../../utils/response");
const { login, forgotPassword, refreshSession } = require("./auth.service");
const {
  setAuthCookies,
  clearAuthCookies,
  setMfaPendingCookie,
} = require("../../config/authCookies");
const { sealPending, PENDING_TTL_MS, isMfaRequired } = require("./mfa.service");
const supabase = require("../../config/supabaseClient");
const { invalidateAuthCache } = require("../../middlewares/auth");

//
// LOGIN HANDLER
//
const loginHandler = async (req, res) => {
  try {
    const { email, password } = req.body;

    // typeof check: a JSON body like {"email": {"$ne": 1}} must never reach
    // the query layer as an object.
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const data = await login(email, password);

    // 2FA: password was right but a code is still needed. NO session cookies
    // yet - the password-only session is parked in an encrypted, 5-minute
    // cookie until POST /api/auth/mfa/verify-login succeeds.
    if (data.mfa) {
      setMfaPendingCookie(
        res,
        sealPending({
          accessToken: data.accessToken,
          factorId: data.mfa.factorId,
          user: data.user,
          attempts: 0,
        }),
        PENDING_TTL_MS,
      );
      return res.status(200).json({
        success: true,
        mfaRequired: true,
        message: "Enter the 6-digit code from your authenticator app.",
      });
    }

    // SECURITY: tokens go into httpOnly cookies (not readable by JS, so
    // an XSS bug can no longer steal them). FIX (Finding #05): they were
    // ALSO being spread into the JSON response body on every login —
    // verified live, the tokens showed up in the response every time,
    // which defeats most of the point of httpOnly cookies (anything that
    // can read the response, e.g. an XSS payload, could still grab them).
    // Cookies are the only place the tokens should live now; the body
    // only carries the user profile + the CSRF token (which is meant to
    // be readable by JS — see csrf.js).
    const csrfToken = setAuthCookies(res, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    const { accessToken, refreshToken, ...safeData } = data;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      // mfaSetupRequired: this account must use 2FA but has not set it up yet,
      // so the frontend sends the user straight to the setup page.
      data: {
        ...safeData,
        csrfToken,
        mfaSetupRequired: isMfaRequired(data.user.role),
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return sendError(res, err, 401, "Invalid email or password");
  }
};

//
// LOGOUT HANDLER
//
// FIX (Finding #04): this previously only cleared the browser's cookies
// — it never told Supabase the session should die. A token captured
// before logout (screen share, server logs, an XSS bug) stayed valid
// until it naturally expired, "logout" or not. We now also revoke the
// session server-side using the access token cookie itself before
// clearing it, via the admin API (scope: "local" — only THIS session,
// not every device the user is logged into elsewhere).
const logoutHandler = async (req, res) => {
  const accessToken = req.cookies?.accessToken;

  // PERF cache: stop honouring this token immediately
  invalidateAuthCache(accessToken);

  // SECURITY: the access cookie lives 1 hour but the refresh cookie 30 days.
  // If the access cookie has already expired, logout used to revoke nothing,
  // so a stolen/copied refresh token kept working for weeks after "logout".
  // Exchange the refresh token for a fresh access token just to revoke it.
  let tokenToRevoke = accessToken;
  if (!tokenToRevoke && req.cookies?.refreshToken) {
    try {
      const s = await refreshSession(req.cookies.refreshToken);
      tokenToRevoke = s?.accessToken;
    } catch {
      // refresh token already invalid/expired - nothing left to revoke
    }
  }

  if (tokenToRevoke) {
    const { error } = await supabase.auth.admin.signOut(tokenToRevoke, "local");
    if (error) {
      // Don't fail the logout over this — the cookies still get cleared
      // below either way — but log it so a broken revoke doesn't go
      // unnoticed.
      console.error(
        "LOGOUT: failed to revoke session server-side:",
        error.message,
      );
    }
  }

  clearAuthCookies(res);
  return res.status(200).json({ success: true, message: "Logged out" });
};

//
// REFRESH HANDLER
//
const refreshHandler = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    const session = await refreshSession(refreshToken);

    const csrfToken = setAuthCookies(res, session);

    // FIX (Finding #05): same issue as loginHandler — tokens must only
    // live in the httpOnly cookies, not in the JSON body. (session's own
    // accessToken/refreshToken shadow the outer refreshToken cookie
    // value, so this destructure uses distinct names.)
    const { accessToken: _at, refreshToken: _rt, ...safeSession } = session;

    return res.status(200).json({
      success: true,
      data: { ...safeSession, csrfToken },
    });
  } catch (err) {
    clearAuthCookies(res);
    return sendError(res, err, 401, "Session expired. Please log in again.");
  }
};

//
// FORGOT PASSWORD HANDLER
//
const forgotPasswordHandler = async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const result = await forgotPassword(email);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }
};

module.exports = {
  loginHandler,
  logoutHandler,
  refreshHandler,
  forgotPasswordHandler,
};
