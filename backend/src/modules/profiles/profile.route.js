const router = require("express").Router();
const multer = require("multer");
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — matches the frontend's own check
});

// Storage bucket for profile photos. Must be a PUBLIC bucket named
// "avatars" in this Supabase project (Storage tab in the dashboard) —
// create it once if it doesn't exist yet; this code doesn't create it
// for you.
const AVATAR_BUCKET = "avatars";

// SECURITY: a SUPER_ADMIN could previously view ANY user's profile by
// passing their userId in the query string — the check only verified
// the role, not that the target user belongs to the SAME organization.
// SUPER_ADMIN is an org-level role here, not a platform-operator
// concept (see permissions.js), so this must be scoped.
async function isSameOrg(targetUserId, organizationId) {
  const { data } = await supabase
    .from("user_master")
    .select("organization_id")
    .eq("Auth User Id", targetUserId)
    .maybeSingle();
  return !!data && data.organization_id === organizationId;
}

router.get("/profile", authenticate, async (req, res) => {
  try {
    const requestedUserId = req.query.userId || req.user.userId;
    const isSelf = requestedUserId === req.user.userId;

    if (!isSelf) {
      if (req.user.role !== "SUPER_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You can only view your own profile",
        });
      }
      const sameOrg = await isSameOrg(requestedUserId, req.user.organizationId);
      if (!sameOrg) {
        return res.status(403).json({
          success: false,
          message: "You can only view profiles within your own organization",
        });
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", requestedUserId)
      .maybeSingle();

    if (error) throw error;

    // FIX: some users (esp. ones onboarded before the profiles table
    // existed, or via Add User flows that never insert a profiles row)
    // have NO matching row here. .single() used to throw Postgrest's
    // "Cannot coerce the result to a single JSON object" (PGRST116) in
    // that case, which surfaced as a hard error on the Profile page
    // instead of an empty, editable form. Fall back to sensible blank
    // defaults — the PATCH handler below now upserts, so the very next
    // save creates the row for real.
    res.json({
      success: true,
      data: data || { user_id: requestedUserId, phone: null, bio: null },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

// PATCH /api/profile — update your own bio/phone. Was previously
// missing entirely (the frontend called this and got Express's
// default HTML 404 page back, which the JSON parser choked on).
router.patch("/profile", authenticate, async (req, res) => {
  try {
    const { phone, bio } = req.body || {};
    const updatePayload = {};
    if (phone !== undefined) updatePayload.phone = phone;
    if (bio !== undefined) updatePayload.bio = bio;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    // FIX: a bare upsert with only {user_id, phone, bio} fails on INSERT
    // (the first-ever save for a user with no existing profiles row)
    // because profiles.first_name/last_name are NOT NULL — Postgres
    // rejects the insert with "null value in column ... violates
    // not-null constraint". Check whether the row exists first: if it
    // does, a plain update (phone/bio only, never touching name) is
    // enough; if it doesn't, seed the required NOT NULL columns from
    // user_master before inserting.
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", req.user.userId)
      .maybeSingle();

    if (existingError) throw existingError;

    let data, error;

    if (existing) {
      ({ data, error } = await supabase
        .from("profiles")
        .update(updatePayload) // can only ever touch your OWN row
        .eq("user_id", req.user.userId)
        .select()
        .single());
    } else {
      const { data: userRow, error: userRowError } = await supabase
        .from("user_master")
        .select('"First Name", "Last Name", "Email"')
        .eq("Auth User Id", req.user.userId)
        .eq("organization_id", req.user.organizationId)
        .maybeSingle();

      if (userRowError) throw userRowError;

      ({ data, error } = await supabase
        .from("profiles")
        .insert({
          user_id: req.user.userId,
          first_name: userRow?.["First Name"] || "",
          last_name: userRow?.["Last Name"] || "",
          email: userRow?.["Email"] || null,
          ...updatePayload,
        })
        .select()
        .single());
    }

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

// PATCH /api/profile/photo — was missing entirely on the backend, which
// is why changing your photo threw "Unexpected token '<' ... is not
// valid JSON": the frontend hit a route that didn't exist, Express
// returned its default HTML 404 page, and res.json() choked trying to
// parse HTML as JSON.
router.patch(
  "/profile/photo",
  authenticate,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No photo file uploaded" });
      }
      if (!req.file.mimetype.startsWith("image/")) {
        return res
          .status(400)
          .json({ success: false, message: "File must be an image" });
      }

      const ext = (
        req.file.originalname.split(".").pop() || "jpg"
      ).toLowerCase();
      // Scoped under organizationId/userId so no cross-tenant filename
      // collisions, and one photo per user (fixed name, upsert:true) so
      // re-uploading just replaces the old one instead of piling up.
      const path = `${req.user.organizationId}/${req.user.userId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Photo upload failed: ${uploadError.message}. Make sure a public Storage bucket named "${AVATAR_BUCKET}" exists in this Supabase project.`,
        );
      }

      const { data: publicUrlData } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(path);

      // Cache-bust so the browser doesn't keep showing the old cached
      // image after an upsert to the same filename.
      const photoUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("user_master")
        .update({ photo_url: photoUrl })
        .eq("Auth User Id", req.user.userId)
        .eq("organization_id", req.user.organizationId);

      if (updateError) throw updateError;

      res.json({ success: true, data: { photoUrl } });
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  },
);

module.exports = router;
