// src/modules/servicecases/servicecases.routes.js
//
// "Case Register" tab (second tab on the Daily Work page). Same
// permission gate as Daily Work itself (tasks.allocate.team/org), since
// this is logically the same "log today's work" action, just producing
// individual case rows instead of one batch row.

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listServiceCases,
  createServiceCases,
  manualCreateServiceCases,
  uploadCustomServiceCases,
  downloadUploadTemplate,
  deleteServiceCase,
  allocateServiceCase,
  autoAllocateServiceCases,
  updateServiceCaseProfile,
  updateServiceCaseClient,
  bulkUpdateServiceCaseProfiles,
  submitServiceCase,
  bulkSubmitServiceCases,
} = require("./servicecases.controller");

// Same memory-storage + extension-filter pattern as clients/subclients
// bulk upload — file never touches disk, only .xlsx/.xls/.csv accepted.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx, .xls, .csv files are allowed"));
  },
});

router.use(authenticate);

router.get("/", listServiceCases);
// NEW: sample .xlsx for Upload mode — literal path registered before
// "/:id/*" routes so it can never be shadowed.
router.get("/upload/template", downloadUploadTemplate);
router.post(
  "/",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  createServiceCases,
);
// NEW: manual case-number entry — person types the case numbers
// themselves (up to 10+ at once) instead of the system auto-generating
// them. Literal path registered before "/:id/*" routes so it can never
// be shadowed.
router.post(
  "/manual",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  manualCreateServiceCases,
);
// NEW: custom case-number upload — same Service + Date as the regular
// form, but case numbers come from an uploaded sheet instead of being
// auto-generated. Literal path registered before "/:id/*" routes so it
// can never be shadowed.
router.post(
  "/upload",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  upload.single("file"),
  uploadCustomServiceCases,
);
// NEW: Today's Allocation — Cases tab (manual, one case) + Employees tab
// flow (smart/auto, many cases at once). Literal path "/auto-allocate"
// registered before "/:id/allocate" so it can never be shadowed.
router.post(
  "/auto-allocate",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  autoAllocateServiceCases,
);
// NEW: Profile — Case Register page. Literal path "/bulk-profile"
// registered before "/:id/profile" so it can never be shadowed.
router.post(
  "/bulk-profile",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  bulkUpdateServiceCaseProfiles,
);
// NEW: employee self-submit on the Profile page — no special
// permission beyond being logged in, same as /api/allocations/self;
// the controller itself only ever touches cases assigned to the
// caller. Literal path "/bulk-submit" registered before "/:id/submit"
// so it can never be shadowed.
router.post("/bulk-submit", bulkSubmitServiceCases);
router.patch("/:id/submit", submitServiceCase);
router.patch(
  "/:id/profile",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  updateServiceCaseProfile,
);
// NEW: Case Register table's inline-editable Client column.
router.patch(
  "/:id/client",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  updateServiceCaseClient,
);
router.patch(
  "/:id/allocate",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  allocateServiceCase,
);
router.delete(
  "/:id",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  deleteServiceCase,
);

module.exports = router;
