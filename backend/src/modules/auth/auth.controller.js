const { login, forgotPassword, refreshSession } = require("./auth.service");
const {
  setAuthCookies,
  clearAuthCookies,
} = require("../../config/authCookies");
const supabase = require("../../config/supabaseClient");

//
// LOGIN HANDLER
//
const loginHandler = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const data = await login(email, password);

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
      data: { ...safeData, csrfToken },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(401).json({
      success: false,
      message: err.message || "Invalid email or password",
    });
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

  if (accessToken) {
    const { error } = await supabase.auth.admin.signOut(accessToken, "local");
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
    return res.status(401).json({
      success: false,
      message: err.message || "Session expired. Please log in again.",
    });
  }
};

//
// FORGOT PASSWORD HANDLER
//
const forgotPasswordHandler = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
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
