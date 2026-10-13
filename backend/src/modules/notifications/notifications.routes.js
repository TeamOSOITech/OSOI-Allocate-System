// src/modules/notifications/notifications.routes.js
const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const {
  listMyNotifications,
  markRead,
  getPushKey,
  subscribePush,
} = require("./notifications.controller");

// Any logged-in user; handlers only ever touch req.user's own rows.
router.use(authenticate);
router.get("/", listMyNotifications);
router.patch("/read", markRead);
router.get("/push-key", getPushKey);
router.post("/push-subscribe", subscribePush);

module.exports = router;
