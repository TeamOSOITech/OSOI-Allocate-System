// src/modules/verticals/verticals.routes.js
 
const express = require("express");
const router = express.Router();
const { getVerticalCaseCountsHandler } = require("./verticals.controller");
 
// GET /api/verticals/case-counts
router.get("/case-counts", getVerticalCaseCountsHandler);
 
module.exports = router;
 
// In your main app.js / server.js, mount this with:
//   const verticalsRoutes = require("./modules/verticals/verticals.routes");
//   app.use("/api/verticals", verticalsRoutes);
 