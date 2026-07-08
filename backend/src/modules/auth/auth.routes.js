const router = require("express").Router();
const { loginHandler } = require("./auth.controller");

// Login using Supabase Authentication
router.post("/login", loginHandler);

module.exports = router;