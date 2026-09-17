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
    res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
