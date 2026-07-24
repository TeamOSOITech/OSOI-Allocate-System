// src/middlewares/rbac.js
//
// Two guards:
//   authorize(...roles)        -> "must be one of these exact roles"
//   requirePermission(code)    -> "must hold this permission" (preferred —
//                                  matches the doc's matrix, not a role name)
//
// Prefer requirePermission() for anything business-logic related.
// Use authorize() only for simple role-gated UI-support endpoints.

const { hasPermission } = require("../config/permissions");

const authorize =
  (...roles) =>
  (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    next();
  };

const requirePermission = (permissionCode) => (req, res, next) => {
  const userRole = req.user?.role;
  if (!userRole || !hasPermission(userRole, permissionCode)) {
    return res.status(403).json({
      success: false,
      message: `Access denied — missing permission: ${permissionCode}`,
    });
  }
  next();
};

// Use when either of two permissions is acceptable, e.g. a Vertical Head
// (team-scope) OR a Process Lead/Ops Manager/Super Admin (org-scope) can
// both hit the same "allocate a task" endpoint, just scoped differently
// inside the controller.
const requireAnyPermission =
  (...codes) =>
  (req, res, next) => {
    const userRole = req.user?.role;
    const ok = userRole && codes.some((c) => hasPermission(userRole, c));
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: `Access denied — requires one of: ${codes.join(", ")}`,
      });
    }
    next();
  };

module.exports = { authorize, requirePermission, requireAnyPermission };
