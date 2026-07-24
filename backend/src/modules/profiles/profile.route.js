const router = require("express").Router();
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");

// FIX: this endpoint had NO auth at all — anyone could pass any userId
// in the query string and read that person's profile. Now requires
// login, and only allows reading your OWN profile unless you're
// Super Admin (full report/admin access per the approval doc).
router.get("/profile", authenticate, async (req, res) => {
  try {
    const requestedUserId = req.query.userId || req.user.userId;

    if (
      requestedUserId !== req.user.userId &&
      req.user.role !== "SUPER_ADMIN"
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own profile",
      });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", requestedUserId)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
