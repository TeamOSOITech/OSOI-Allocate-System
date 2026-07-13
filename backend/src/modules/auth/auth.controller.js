const { login, forgotPassword } = require("./auth.service");

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

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data,
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
  forgotPasswordHandler,
};
