// src/modules/servicecases/servicecases.routes.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const supabase = require("../../config/supabaseClient");
const { getOwnTeam } = require("../../utils/teamScope");
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
  notifyUrgent,
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
  // NEW (ROLLOVER)
  listMyMissedCases,
  // NEW: manager popup — open queries of my team (role-checked inside).
  listTeamQueries,
  // NEW: manager popup — reportees (+ me) who did not submit yesterday.
  listTeamMissedYesterday,
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
  listMyMissedCounts,
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap — was unlimited
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".csv"];
    const ext = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Only .xlsx or .csv files are allowed"));
  },
});

// Viewing ANOTHER employee's data (?employeeId=<someone else>) needs
// allocation permission (manager / lead roles). An employee's own id,
// or no employeeId at all, stays open to them.
// Vertical Head holds the TEAM-scope allocation permission, so on top of
// that they may only look at people in their OWN team (same rule as
// their Employees list); every org-wide role is unrestricted.
const viewOtherEmployee = (req, res, next) => {
  const raw = req.query.employeeId;
  if (!raw || String(raw) === String(req.user.userId)) return next();

  allocPerm(req, res, async () => {
    if (req.user.role !== "VERTICAL_HEAD") return next();
    try {
      // an array / object employeeId can never be a single valid target
      if (typeof raw !== "string") {
        return res
          .status(403)
          .json({ success: false, message: "Access denied" });
      }
      const [ownTeam, targetRes] = await Promise.all([
        getOwnTeam(req),
        supabase
          .from("user_master")
          .select('"Worked In Teams"')
          .eq("Auth User Id", raw)
          .eq("organization_id", req.user.organizationId)
          .maybeSingle(),
      ]);
      if (targetRes.error) throw targetRes.error;
      const targetTeam = String(targetRes.data?.["Worked In Teams"] || "")
        .trim()
        .toLowerCase();
      if (!ownTeam || !targetTeam || ownTeam !== targetTeam) {
        return res.status(403).json({
          success: false,
          message: "You can only view employees in your own team.",
        });
      }
      next();
    } catch (err) {
      console.error("viewOtherEmployee check failed:", err);
      res.status(500).json({ success: false, message: "Access check failed" });
    }
  });
};

router.use(authenticate);

router.get("/", viewOtherEmployee, listServiceCases);
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
// Viewing ANOTHER employee's counts (?employeeId=) needs allocation
// permission; the employee's own counts stay open to them.
router.get("/my-counts", viewOtherEmployee, listMyCounts);
// Count units (no case number) left pending at day end — read-only history.
router.get("/my-missed-counts", viewOtherEmployee, listMyMissedCounts);
// NEW (ROLLOVER): cases left pending at day end (read-only history).
router.get("/my-missed", listMyMissedCases);
// NEW: managers — open queries of their team + which are over 48h.
router.get("/team-queries", listTeamQueries);
router.get("/team-missed-yesterday", listTeamMissedYesterday);
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
// NEW (URGENT): "Anything Urgent" mail — sent right after urgent cases are allocated.
router.post("/notify-urgent", allocPerm, notifyUrgent);
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
