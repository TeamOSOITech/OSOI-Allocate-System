const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const supabase = require("../../config/supabaseClient");

router.use(authenticate);

// Submit daily report
router.post("/daily", async (req, res) => {
  try {
    const {
      tasksCompleted,
      tasksPending,
      hoursWorked,
      pendingReasons,
      remarks,
    } = req.body;
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("daily_reports")
      .upsert(
        {
          user_id: req.user.userId,
          report_date: today,
          tasks_completed: tasksCompleted,
          tasks_pending: tasksPending,
          hours_worked: hoursWorked,
          pending_reasons: pendingReasons,
          remarks,
        },
        { onConflict: "user_id,report_date" },
      )
      .select();

    if (error) throw error;
    res.status(201).json({ success: true, data: data[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get my report history
router.get("/my-history", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", req.user.userId)
      .order("report_date", { ascending: false })
      .limit(30);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get team/org reports — Vertical Head (team), Process Lead/Ops Manager/
// Super Admin (org-wide). See src/config/permissions.js.
router.get(
  "/team",
  requireAnyPermission(
    "materialisation.view.team",
    "reports.materialisation.view.org",
  ),
  async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("daily_reports")
        .select("*, users(email, profiles(first_name, last_name))")
        .eq("report_date", today);

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
