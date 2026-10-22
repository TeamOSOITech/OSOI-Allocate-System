const { sendError } = require("../../utils/response");
const router = require("express").Router();
const multer = require("multer");
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");
const { authorize } = require("../../middlewares/rbac");

// SETUP REQUIRED (one-time, same as the "avatars" bucket in
// profiles/profile.route.js):
//   1. In Supabase: Table Editor -> organizations -> add a column
//        logo_url   text   (nullable)
//   2. In Supabase: Storage -> create a PUBLIC bucket named "org-logos"
// Neither of these is created by this code automatically.

// Same raster-only whitelist as profile photos — SVG is deliberately
// excluded (a public bucket serving an uploaded .svg is a stored-XSS
// vector, since SVGs can embed <script> tags).
const ALLOWED_LOGO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();
    if (ALLOWED_LOGO_EXTENSIONS.includes(ext)) return cb(null, true);
    cb(new Error("Only .jpg, .jpeg, .png, .gif, .webp files are allowed"));
  },
});

const LOGO_BUCKET = "org-logos";

const contentTypeByExt = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

// GET /api/organization/logo — any authenticated user (of any role) can
// read their own organization's logo, since the header showing it is
// shared by every role, not just SUPER_ADMIN.
router.get("/organization/logo", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("logo_url")
      .eq("id", req.user.organizationId)
      .maybeSingle();

    if (error) throw error;

    res.json({ success: true, data: { logoUrl: data?.logo_url || null } });
  } catch (err) {
    sendError(res, err, 400);
  }
});

// PATCH /api/organization/logo — SUPER_ADMIN only. Replaces the logo
// image for their own organization; the oval/rounded frame it sits in
// is fixed in the frontend (header.tsx) and never changes here — only
// the image itself does.
router.patch(
  "/organization/logo",
  authenticate,
  authorize("SUPER_ADMIN"),
  upload.single("logo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No logo file uploaded" });
      }
      if (!req.file.mimetype.startsWith("image/")) {
        return res
          .status(400)
          .json({ success: false, message: "File must be an image" });
      }

      const ext = ALLOWED_LOGO_EXTENSIONS.includes(
        `.${(req.file.originalname.split(".").pop() || "").toLowerCase()}`,
      )
        ? req.file.originalname.split(".").pop().toLowerCase()
        : "jpg"; // fileFilter already guarantees this branch is never hit

      // One logo per organization (fixed filename, upsert:true) so
      // re-uploading just replaces the old one instead of piling up.
      const path = `${req.user.organizationId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, req.file.buffer, {
          contentType: contentTypeByExt[ext] || "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Logo upload failed: ${uploadError.message}. Make sure a public Storage bucket named "${LOGO_BUCKET}" exists in this Supabase project.`,
        );
      }

      const { data: publicUrlData } = supabase.storage
        .from(LOGO_BUCKET)
        .getPublicUrl(path);

      // Cache-bust so the browser doesn't keep showing the old cached
      // image after an upsert to the same filename.
      const logoUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("organizations")
        .update({ logo_url: logoUrl })
        .eq("id", req.user.organizationId);

      if (updateError) throw updateError;

      res.json({ success: true, data: { logoUrl } });
    } catch (err) {
      sendError(res, err, 400);
    }
  },
);

// ---------------------------------------------------------------
// Org-level settings — currently one flag:
//   case_number_required (boolean, default true)
//     true  -> employees must type real case numbers when they complete
//              units of a count-only entry (existing behaviour)
//     false -> case numbers are optional for count-only work; units can
//              be completed without typing any (the server generates an
//              internal number for them).
// SETUP REQUIRED (one-time): run in Supabase SQL editor
//   alter table organizations
//     add column if not exists case_number_required boolean not null default true;
// ---------------------------------------------------------------
const SETTINGS_EDITOR_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "PROCESS_LEAD"];

// GET /api/organization/settings — any authenticated user (the Profile
// page needs it to know whether to ask for case numbers).
router.get("/organization/settings", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("case_number_required")
      .eq("id", req.user.organizationId)
      .maybeSingle();
    // Column not created yet -> behave exactly as before (required).
    if (error && !/case_number_required/i.test(error.message || ""))
      throw error;
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        caseNumberRequired: error ? true : data?.case_number_required !== false,
      },
    });
  } catch (err) {
    sendError(res, err, 400);
  }
});

// PATCH /api/organization/settings — Super Admin / managers only.
router.patch(
  "/organization/settings",
  authenticate,
  authorize(...SETTINGS_EDITOR_ROLES),
  async (req, res) => {
    try {
      const { caseNumberRequired } = req.body || {};
      if (typeof caseNumberRequired !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "caseNumberRequired must be true or false",
        });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ case_number_required: caseNumberRequired })
        .eq("id", req.user.organizationId);
      if (error) throw error;
      res.json({ success: true, data: { caseNumberRequired } });
    } catch (err) {
      sendError(res, err, 400);
    }
  },
);

// ---------------------------------------------------------------
// CREATE A NEW TENANT (organization) FROM INSIDE THE APP
//   Settings -> "Create tenant": email + password + plan.
//
//   GET  /api/platform/tenant-access -> { canCreateTenant }
//   POST /api/platform/tenants       -> creates org + its first SUPER_ADMIN
//        body: { email, password, plan, role?, organizationName? }
//        role: SUPER_ADMIN (default) | OPS_MANAGER | AUDIT_MANAGER |
//              PROCESS_LEAD | VERTICAL_HEAD | TEAM_MEMBER
//   GET   /api/platform/tenants            -> all tenants + their users + plan
//   PATCH /api/platform/tenants/users/:userId/role  body: { role }
//         -> change a tenant user's role later (never your own org's users)
//        plan: "free" (up to 5 users) | "basic" | "professional" | "enterprise"
//
// Only the PLATFORM OWNER's Super Admin can do this — i.e. a SUPER_ADMIN
// of the platform organization. That is the org whose id is in the
// PLATFORM_ORG_ID env var, or (if not set) the OLDEST organization (the
// first tenant). A Super Admin of any other tenant gets 403, so tenants
// can't create tenants.
//
// Free = no subscriptions row (the app already treats "no active
// subscription" as Free, 5 users). Paid plans get an active subscriptions
// row, same as the paid signup flow, so the existing seat limit applies.
// ---------------------------------------------------------------
const {
  PLAN_USER_LIMITS,
  getPlanByName,
} = require("../billings/billing.service");

const TENANT_PLANS = ["free", "basic", "professional", "enterprise"];
// Roles the platform owner can give a tenant's login (CLIENT is excluded —
// it needs a client link, so it's created from the client portal instead).
const TENANT_ROLES = [
  "SUPER_ADMIN",
  "OPS_MANAGER",
  "AUDIT_MANAGER",
  "PROCESS_LEAD",
  "VERTICAL_HEAD",
  "TEAM_MEMBER",
];

async function getPlatformOrgId() {
  const fromEnv = (process.env.PLATFORM_ORG_ID || "").trim();
  if (fromEnv) return fromEnv;
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
}

async function isPlatformSuperAdmin(user) {
  if (!user || user.role !== "SUPER_ADMIN") return false;
  const platformOrgId = await getPlatformOrgId();
  return !!platformOrgId && String(user.organizationId) === platformOrgId;
}

router.get("/platform/tenant-access", authenticate, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: { canCreateTenant: await isPlatformSuperAdmin(req.user) },
    });
  } catch (err) {
    sendError(res, err, 400);
  }
});

router.post(
  "/platform/tenants",
  authenticate,
  authorize("SUPER_ADMIN"),
  async (req, res) => {
    let organization = null;
    let authUserId = null;
    try {
      if (!(await isPlatformSuperAdmin(req.user))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to create tenants.",
        });
      }

      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      const plan = String(req.body?.plan || "free")
        .trim()
        .toLowerCase();
      const orgName =
        String(req.body?.organizationName || "").trim() || email.split("@")[0];
      const role = String(req.body?.role || "SUPER_ADMIN")
        .trim()
        .toUpperCase();
      if (!TENANT_ROLES.includes(role)) {
        return res
          .status(400)
          .json({ success: false, message: "Choose a valid role." });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res
          .status(400)
          .json({ success: false, message: "Enter a valid email." });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters.",
        });
      }
      if (!TENANT_PLANS.includes(plan)) {
        return res
          .status(400)
          .json({ success: false, message: "Choose a valid plan." });
      }

      // email already used (login accounts are unique across all tenants)
      // (filters on "Email" only — same check as the public signup; a filter
      // on the spaced "Login Email" column made this query fail -> HTTP 500.
      // Auth-level duplicates are still caught by createUser below.)
      const { data: existing, error: exErr } = await supabase
        .from("user_master")
        .select('"Auth User Id"')
        .eq("Email", email)
        .limit(1);
      if (exErr) throw exErr;
      if (existing && existing.length > 0) {
        return res.status(409).json({
          success: false,
          message: "An account with this email already exists.",
        });
      }

      // paid plan must exist in the plans table BEFORE anything is created
      let planRow = null;
      if (plan !== "free") {
        planRow = await getPlanByName(supabase, plan);
        if (!planRow) {
          return res.status(400).json({
            success: false,
            message: `The "${plan}" plan is not set up in the plans table yet.`,
          });
        }
      }

      // 1. organization
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert({ name: orgName, status: "ACTIVE" })
        .select()
        .single();
      if (orgErr) throw orgErr;
      organization = org;

      // 2. login (Supabase Auth) with the password given here
      const { data: authData, error: authErr } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (authErr) {
        if (/already|registered|exists/i.test(authErr.message || "")) {
          await supabase.from("organizations").delete().eq("id", org.id);
          organization = null;
          return res.status(409).json({
            success: false,
            message: "An account with this email already exists.",
          });
        }
        throw authErr;
      }
      authUserId = authData.user.id;

      // 3. its first user, with the role chosen by the platform owner
      const { error: profileErr } = await supabase.from("user_master").insert({
        "Auth User Id": authUserId,
        "First Name": orgName,
        "Last Name": null,
        Email: email,
        "Login Email": email,
        Role: role,
        organization_id: org.id,
      });
      if (profileErr) throw profileErr;

      // 4. subscription (paid plans only; Free = no row)
      if (planRow) {
        const { error: subErr } = await supabase.from("subscriptions").insert({
          organization_id: org.id,
          plan_id: planRow.id,
          status: "active",
          price_per_user_snapshot: planRow.price_per_user,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        });
        if (subErr) throw subErr;
      }

      const limit = PLAN_USER_LIMITS[plan];
      res.status(201).json({
        success: true,
        message: `Tenant "${orgName}" created on the ${plan} plan.`,
        data: {
          organizationId: org.id,
          organizationName: orgName,
          email,
          plan,
          role,
          userLimit: Number.isFinite(limit) ? limit : null, // null = unlimited
        },
      });
    } catch (err) {
      console.error("CREATE TENANT ERROR:", err);
      // roll back so no half-made tenant is left behind
      if (authUserId) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
      }
      if (organization) {
        await supabase
          .from("organizations")
          .delete()
          .eq("id", organization.id)
          .then(
            () => {},
            () => {},
          );
      }
      // This endpoint is platform-owner only, so show the real reason
      // instead of a generic message (easier to fix setup problems).
      res.status(500).json({
        success: false,
        message: `Could not create the tenant: ${err?.message || "unknown error"}`,
      });
    }
  },
);

// GET /api/platform/tenants — every tenant except the platform org itself,
// with its plan and (up to 20) users, so roles can be changed from Settings.
router.get(
  "/platform/tenants",
  authenticate,
  authorize("SUPER_ADMIN"),
  async (req, res) => {
    try {
      if (!(await isPlatformSuperAdmin(req.user))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to view tenants.",
        });
      }
      const platformOrgId = await getPlatformOrgId();

      const { data: orgs, error: oErr } = await supabase
        .from("organizations")
        .select("id, name, created_at")
        .neq("id", platformOrgId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (oErr) throw oErr;
      const orgIds = (orgs || []).map((o) => o.id);
      if (orgIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const [usersRes, subsRes] = await Promise.all([
        supabase
          .from("user_master")
          .select('"Auth User Id", "Email", "Role", organization_id')
          .in("organization_id", orgIds)
          .order("Email", { ascending: true })
          .limit(5000),
        supabase
          .from("subscriptions")
          .select("organization_id, current_period_start, plans ( name )")
          .eq("status", "active")
          .in("organization_id", orgIds)
          .order("current_period_start", { ascending: false }),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (subsRes.error) throw subsRes.error;

      const usersByOrg = new Map();
      (usersRes.data || []).forEach((u) => {
        const k = String(u.organization_id);
        if (!usersByOrg.has(k)) usersByOrg.set(k, []);
        usersByOrg.get(k).push(u);
      });
      const planByOrg = new Map();
      (subsRes.data || []).forEach((sub) => {
        const k = String(sub.organization_id);
        // rows are newest-first, keep the first seen
        if (!planByOrg.has(k))
          planByOrg.set(k, String(sub.plans?.name || "free").toLowerCase());
      });

      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        data: orgs.map((o) => {
          const users = usersByOrg.get(String(o.id)) || [];
          return {
            organizationId: o.id,
            name: o.name,
            createdAt: o.created_at,
            plan: planByOrg.get(String(o.id)) || "free",
            userCount: users.length,
            users: users.slice(0, 20).map((u) => ({
              userId: u["Auth User Id"],
              email: u.Email,
              role: u.Role,
            })),
          };
        }),
      });
    } catch (err) {
      console.error("LIST TENANTS ERROR:", err);
      sendError(res, err, 400);
    }
  },
);

// PATCH /api/platform/tenants/users/:userId/role  body: { role }
router.patch(
  "/platform/tenants/users/:userId/role",
  authenticate,
  authorize("SUPER_ADMIN"),
  async (req, res) => {
    try {
      if (!(await isPlatformSuperAdmin(req.user))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to change tenant roles.",
        });
      }
      const role = String(req.body?.role || "")
        .trim()
        .toUpperCase();
      if (!TENANT_ROLES.includes(role)) {
        return res
          .status(400)
          .json({ success: false, message: "Choose a valid role." });
      }

      const { data: target, error: tErr } = await supabase
        .from("user_master")
        .select('"Auth User Id", "Email", organization_id')
        .eq("Auth User Id", req.params.userId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!target) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      // only OTHER tenants' users — never your own organization's
      const platformOrgId = await getPlatformOrgId();
      if (String(target.organization_id) === String(platformOrgId)) {
        return res.status(403).json({
          success: false,
          message: "Roles of your own organization are managed from Add User.",
        });
      }

      const { error: uErr } = await supabase
        .from("user_master")
        .update({ Role: role })
        .eq("Auth User Id", target["Auth User Id"]);
      if (uErr) throw uErr;

      res.json({
        success: true,
        message: `${target.Email} is now ${role}.`,
        data: { userId: target["Auth User Id"], role },
      });
    } catch (err) {
      console.error("CHANGE TENANT ROLE ERROR:", err);
      sendError(res, err, 400);
    }
  },
);

module.exports = router;
