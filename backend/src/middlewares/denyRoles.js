// src/middlewares/denyRoles.js
//
// Hard-blocks the listed roles on a route (403), regardless of their
// permissions. Used to stop Process Lead from editing/deleting Services,
// Clients and Subclients (they can only ADD those).
function denyRoles(...roles) {
  return (req, res, next) => {
    const role = String(req.user?.role || "").toUpperCase();
    if (roles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to edit or delete this.",
      });
    }
    return next();
  };
}

module.exports = { denyRoles };
