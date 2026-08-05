const { login, forgotPassword, refreshSession } = require("./auth.service");
const {
  setAuthCookies,
  clearAuthCookies,
} = require("../../config/authCookies");

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

    // SECURITY: tokens now also go into httpOnly cookies (not readable
    // by JS, so an XSS bug can no longer steal them straight out of
    // localStorage). Still returned in the JSON body too, temporarily,
    // so the existing frontend keeps working during the migration —
    // see authCookies.js / csrf.js for the cookie + CSRF setup.
    const csrfToken = setAuthCookies(res, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { ...data, csrfToken },
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
const logoutHandler = async (_req, res) => {
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

    return res.status(200).json({
      success: true,
      data: { ...session, csrfToken },
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
