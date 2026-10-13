// src/modules/notifications/notifications.controller.js
//
// In-app notifications (bell icon in the header).
//
// Run this SQL once in Supabase:
//
//   create table if not exists app_notifications (
//     id uuid primary key default gen_random_uuid(),
//     organization_id uuid not null,
//     user_id uuid not null,            -- the employee's "Auth User Id"
//     type text not null,               -- e.g. 'OVERLOAD'
//     title text not null,
//     message text not null,
//     work_date date,
//     is_read boolean not null default false,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists app_notifications_user_idx
//     on app_notifications (user_id, is_read, created_at desc);

const supabase = require("../../config/supabaseClient");
const { pushEnabled, PUBLIC_KEY } = require("../../utils/webpush");

// GET /api/notifications  -> latest 30 + unread count (caller's own only)
async function listMyNotifications(req, res) {
  try {
    const { userId, organizationId } = req.user;

    const { data, error } = await supabase
      .from("app_notifications")
      .select("id, type, title, message, work_date, is_read, created_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;

    const { count, error: countError } = await supabase
      .from("app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_read", false);
    if (countError) throw countError;

    res.json({
      success: true,
      data: { items: data || [], unreadCount: count || 0 },
    });
  } catch (err) {
    console.error("listMyNotifications error:", err);
    res.status(500).json({
      success: false,
      message: "Could not load notifications.",
    });
  }
}

// PATCH /api/notifications/read   body: { ids?: string[] }  (no ids = all)
async function markRead(req, res) {
  try {
    const { userId, organizationId } = req.user;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => String(x)).filter(Boolean)
      : [];

    let q = supabase
      .from("app_notifications")
      .update({ is_read: true })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_read", false);
    if (ids.length > 0) q = q.in("id", ids);

    const { error } = await q;
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("markRead error:", err);
    res.status(500).json({
      success: false,
      message: "Could not update notifications.",
    });
  }
}

// GET /api/notifications/push-key -> public VAPID key for the browser
function getPushKey(req, res) {
  if (!pushEnabled) {
    return res
      .status(503)
      .json({ success: false, message: "Push is not configured." });
  }
  res.json({ success: true, data: { publicKey: PUBLIC_KEY } });
}

// POST /api/notifications/push-subscribe  body: { endpoint, keys:{p256dh,auth} }
// Upsert by endpoint: if another employee logs in on the same browser, the
// device simply moves to that employee.
async function subscribePush(req, res) {
  try {
    const { userId, organizationId } = req.user;
    const endpoint = String(req.body?.endpoint || "");
    const p256dh = String(req.body?.keys?.p256dh || "");
    const auth = String(req.body?.keys?.auth || "");
    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid subscription." });
    }
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        endpoint,
        p256dh,
        auth,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    console.log(
      `[webpush] device saved for user ${userId} (org ${organizationId}) endpoint …${endpoint.slice(-20)}`,
    );
    res.json({ success: true });
  } catch (err) {
    console.error("subscribePush error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not save subscription." });
  }
}

// GET /api/notifications/push-status?endpoint=<this device's endpoint>
// Lets the browser CONFIRM that the server really saved this device for the
// logged-in user (browser permission "Allow" alone does not prove that).
async function getPushStatus(req, res) {
  try {
    const { userId, organizationId } = req.user;
    const endpoint = String(req.query?.endpoint || "");

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint")
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    if (error) throw error;

    const devices = data || [];
    res.json({
      success: true,
      data: {
        deviceCount: devices.length,
        thisDeviceSaved: endpoint
          ? devices.some((d) => d.endpoint === endpoint)
          : null,
      },
    });
  } catch (err) {
    console.error("getPushStatus error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not check alert status." });
  }
}

// POST /api/notifications/push-error  body: { message, permission, userAgent }
// The browser reports WHY it could not turn on alerts, so it shows up in the
// backend logs without anyone having to screenshot or open the console.
function reportPushError(req, res) {
  const clip = (v, n) => String(v || "").slice(0, n);
  console.warn(
    `[webpush][client-error] user ${req.user.userId} (org ${req.user.organizationId}) permission=${clip(req.body?.permission, 20)} :: ${clip(req.body?.message, 500)} :: ${clip(req.body?.userAgent, 300)}`,
  );
  res.json({ success: true });
}

module.exports = {
  reportPushError,
  listMyNotifications,
  markRead,
  getPushKey,
  subscribePush,
  getPushStatus,
};
