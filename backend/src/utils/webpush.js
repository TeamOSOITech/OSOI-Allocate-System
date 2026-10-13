// src/utils/webpush.js
// Free browser push (Web Push + VAPID) — works even when the employee is
// logged out / the browser is closed, once they allowed notifications.
//
// .env (backend):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT   (optional, e.g. mailto:team@osoitech.com)
//
// Supabase SQL (run once):
//   create table if not exists push_subscriptions (
//     id uuid primary key default gen_random_uuid(),
//     organization_id uuid not null,
//     user_id uuid not null,
//     endpoint text not null unique,
//     p256dh text not null,
//     auth text not null,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists push_subscriptions_user_idx
//     on push_subscriptions (user_id);

const webpush = require("web-push");
const supabase = require("../config/supabaseClient");

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:team@osoitech.com";
const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn(
    "[webpush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — browser push is disabled (in-app bell still works).",
  );
}

// Never throws: a push problem must never break allocation.
async function sendPushToUsers({ organizationId, userIds, title, body, url }) {
  if (!pushEnabled) {
    console.warn("[webpush] skipped: VAPID keys are not set in .env");
    return { sent: 0, removed: 0 };
  }
  if (!userIds?.length) return { sent: 0, removed: 0 };
  try {
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("organization_id", organizationId)
      .in("user_id", userIds);
    if (error) throw error;
    if (!subs?.length) {
      console.log(
        `[webpush] no subscribed device for ${userIds.length} user(s) — employee has not clicked "Turn on alerts" yet`,
      );
      return { sent: 0, removed: 0 };
    }

    const payload = JSON.stringify({ title, body, url: url || "/" });
    const dead = [];
    let sent = 0;

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 * 12 }, // keep for 12h if the device is offline
          );
          sent += 1;
        } catch (err) {
          // 404/410 = the browser dropped this subscription
          if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.id);
          else
            console.error("[webpush] send failed:", err.statusCode, err.body);
        }
      }),
    );

    if (dead.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", dead);
    }
    console.log(
      `[webpush] devices: ${subs.length}, sent: ${sent}, removed: ${dead.length}`,
    );
    return { sent, removed: dead.length };
  } catch (err) {
    console.error("[webpush] sendPushToUsers error:", err);
    return { sent: 0, removed: 0 };
  }
}

module.exports = { sendPushToUsers, pushEnabled, PUBLIC_KEY };
