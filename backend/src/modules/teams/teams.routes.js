const express = require("express");
const router = express.Router();
const teamController = require("./teams.controller.js");
const { authenticate } = require("../../middlewares/auth");
const { authorize } = require("../../middlewares/rbac");

router.use(authenticate);

// Everyone needs to read this — it powers the Teams dropdown on the
// Add/Edit Service modal, which any authenticated user may open in a
// read-only capacity (e.g. View Details).
router.get("/", teamController.getAllTeams);
router.get("/:id", teamController.getTeamById);

// Managing the Teams list itself is Super-Admin-only, same gate as
// creating/deleting Products.
router.post("/", authorize("SUPER_ADMIN"), teamController.createTeam);
router.put("/:id", authorize("SUPER_ADMIN"), teamController.updateTeam);
router.delete("/:id", authorize("SUPER_ADMIN"), teamController.deleteTeam);

module.exports = router;
