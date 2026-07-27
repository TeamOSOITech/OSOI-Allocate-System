const router = require("express").Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "QC module working",
  });
});

module.exports = router;
