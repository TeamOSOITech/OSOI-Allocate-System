const router = require("express").Router();
const { loginHandler } = require("./auth.controller");
const { forgotPasswordHandler } = require("./auth.controller");

// Login using Supabase Authentication
router.post("/login", loginHandler);

router.post("/forgot-password", forgotPasswordHandler);

module.exports = router;
