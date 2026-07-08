const { login } = require("./auth.service");

//
// LOGIN HANDLER
//
const loginHandler = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Login using Supabase Authentication
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

module.exports = {
  loginHandler,
};