// src/modules/employeeleaves/employeeleaves.routes.js
//
// Mount in your app (same place as the other routers):
//   app.use("/api/employee-leaves", require("./modules/employeeleaves/employeeleaves.routes"));

const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listLeaves,
  createLeaves,
  deleteLeave,
} = require("./employeeleaves.controller");

const allocPerm = requireAnyPermission(
  "tasks.allocate.team",
  "tasks.allocate.org",
);

router.use(authenticate);

router.get("/", allocPerm, listLeaves);
router.post("/", allocPerm, createLeaves);
router.delete("/:id", allocPerm, deleteLeave);

module.exports = router;
