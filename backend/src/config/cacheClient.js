const Redis = require("ioredis");

// Render's managed "Key Value" service is Valkey under the hood, but it
// speaks the exact same wire protocol as Redis — so the standard `ioredis`
// client works unchanged. Point REDIS_URL / VALKEY_URL at whichever one
// you provision; no code here needs to know which it actually is.
//
// Add to your backend .env:
//   REDIS_URL=rediss://default:<password>@<host>:<port>
// (Render gives you this as the "Internal Redis URL" / "Internal Key
// Value URL" on the instance's dashboard page — use the INTERNAL url
// when this service and the cache are both on Render, it's free and
// faster than the external one.)
//
// CACHE_DISABLED=true lets you run the app with caching fully skipped
// (e.g. local dev without Valkey installed) — every cache helper below
// just becomes a no-op and falls through to the DB every time.

const cacheUrl = process.env.REDIS_URL || process.env.VALKEY_URL;
const cacheDisabled = process.env.CACHE_DISABLED === "true" || !cacheUrl;

let client = null;

if (!cacheDisabled) {
  client = new Redis(cacheUrl, {
    // Don't let a slow/unreachable cache hang requests — fail fast and
    // let callers fall back to Supabase instead.
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: false,
  });

  client.on("error", (err) => {
    // Log and move on — cache.js treats a broken client the same as "no
    // cache configured" (see getJson/setJson try/catch), so a Valkey
    // outage degrades to "every request hits Supabase directly" instead
    // of taking the whole API down.
    console.error("[cache] Valkey/Redis connection error:", err.message);
  });

  client.on("connect", () => {
    console.log("[cache] Connected to Valkey/Redis");
  });
} else {
  console.log(
    "[cache] No REDIS_URL/VALKEY_URL set (or CACHE_DISABLED=true) — running without a cache.",
  );
}

module.exports = client; // null when disabled — src/utils/cache.js handles that
