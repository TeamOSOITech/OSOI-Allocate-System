// src/modules/verticals/verticals.controller.js
 
const { getVerticalCaseCounts } = require("./verticals.service");
 
async function getVerticalCaseCountsHandler(req, res) {
  try {
    const data = await getVerticalCaseCounts();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.json(data);
  } catch (err) {
  console.error("Full Error:", err);
   res.status(500).json({ error: "Failed to fetch vertical case counts" });

  res.status(500).json({
    message: err.message,
    stack: err.stack,
  });
}
}
 
module.exports = { getVerticalCaseCountsHandler };