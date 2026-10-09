// src/modules/servicecases/servicecases.routes.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  getAutoPrefix,
  updateServiceCaseNumber,
  listServiceCases,
  createServiceCases,
  manualCreateServiceCases,
  createCountOnlyEntry,
  listCountOnlyEntries,
  deleteCountOnlyEntry,
  uploadCustomServiceCases,
  downloadUploadTemplate,
  deleteServiceCase,
  allocateServiceCase,
  autoAllocateServiceCases,
  // NEW (NOTIFY)
  notifyAllocation,
  listAllocationClearLog,
  updateServiceCaseProfile,
  updateServiceCaseClient,
  bulkUpdateServiceCaseProfiles,
  submitServiceCase,
  resolveQueryServiceCase,
  completeQueryServiceCase,
  bulkSubmitServiceCases,
  selfAllocateServiceCases,
  updateServiceCaseQc,
  updateServiceCaseAudit,
} = require("./servicecases.controller");

// count-only allocation endpoints (Today's Allocation -> Counts)
const {
  listCountAllocations,
  autoPreviewCountAllocations,
  saveCountAllocations,
  clearCountAllocations,
} = require("./servicecasecountallocations.controller");

// NEW: employee-side (Profile page) count endpoints — self-allocate a
// count, add real case numbers to it, and fill an empty client/subclient.
const {
  listMyCounts,
  selfAllocateCounts,
  addCaseNumbersToCount,
  fillCaseClient,
} = require("./servicecasecountself.controller");

// NEW: Service <-> Client mapping (which clients belong to which service).
const {
  listClientsForProduct,
  setProductClients,
} = require("./serviceClients");

const allocPerm = requireAnyPermission(
  "tasks.allocate.team",
  "tasks.allocate.org",
);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".csv"];
    const ext = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx or .csv files are allowed"));
  },
});

router.use(authenticate);

router.get("/", listServiceCases);
router.get("/upload/template", downloadUploadTemplate);
router.get("/auto-prefix", getAutoPrefix);
router.get("/clear-log", allocPerm, listAllocationClearLog);

// ---- NEW: Service <-> Client mapping ----
// GET  -> clients mapped to a service (powers the Client dropdown in Log Cases)
// PUT  -> replace the set of clients mapped to a service
router.get("/product-clients/:productId", listClientsForProduct);
router.put("/product-clients/:productId", allocPerm, setProductClients);

router.post("/", allocPerm, createServiceCases);
router.post("/manual", allocPerm, manualCreateServiceCases);

// ---- count-only entries (Case Register -> Counts) ----
router.post("/count-only", allocPerm, createCountOnlyEntry);
router.get("/count-only", allocPerm, listCountOnlyEntries);
router.delete("/count-only/:id", allocPerm, deleteCountOnlyEntry);

// ---- count-only ALLOCATION (Today's Allocation -> Counts) ----
// Literal paths: must stay ABOVE every "/:id/..." route.
router.get("/count-allocations", allocPerm, listCountAllocations);
router.post(
  "/count-allocations/auto-preview",
  allocPerm,
  autoPreviewCountAllocations,
);
router.post("/count-allocations/save", allocPerm, saveCountAllocations);
router.post("/count-allocations/clear", allocPerm, clearCountAllocations);

// ---- NEW: employee's own counts (Profile page) ----
// Any logged-in employee; "me" is always req.user.userId inside the
// handlers, so these can only ever touch the caller's own allocations.
router.get("/my-counts", listMyCounts);
router.post("/my-counts/self-allocate", selfAllocateCounts);
router.post("/my-counts/add-case-numbers", addCaseNumbersToCount);

router.post(
  "/upload",
  allocPerm,
  upload.single("file"),
  uploadCustomServiceCases,
);
router.post("/auto-allocate", allocPerm, autoAllocateServiceCases);
// NEW (NOTIFY): "Your work has been allocated" email, sent after Allocate.
router.post("/notify-allocation", allocPerm, notifyAllocation);
router.post("/bulk-profile", allocPerm, bulkUpdateServiceCaseProfiles);
router.post("/bulk-submit", bulkSubmitServiceCases);
router.post("/self-allocate", selfAllocateServiceCases);

router.patch("/:id/submit", submitServiceCase);
router.patch("/:id/resolve-query", resolveQueryServiceCase);
router.patch("/:id/complete-query", allocPerm, completeQueryServiceCase);
router.patch("/:id/qc", allocPerm, updateServiceCaseQc);
router.patch("/:id/audit", allocPerm, updateServiceCaseAudit);
router.patch("/:id/profile", allocPerm, updateServiceCaseProfile);
router.patch("/:id/case-number", allocPerm, updateServiceCaseNumber);
// Manager edit (change/clear client + subclient).
router.patch("/:id/client", allocPerm, updateServiceCaseClient);
// NEW: employee ADD-only (fills an empty client/subclient on own case).
router.patch("/:id/client-fill", fillCaseClient);
router.patch("/:id/allocate", allocPerm, allocateServiceCase);
router.delete("/:id", allocPerm, deleteServiceCase);

module.exports = router;
