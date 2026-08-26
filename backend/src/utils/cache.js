const redis = require("../config/cacheClient");

// Thin wrapper around the Valkey/Redis client so route/service code never
// has to null-check the client itself or JSON.parse/stringify by hand.
// If Valkey isn't configured (or is down), every function here just
// behaves like a permanent cache miss — callers always fall back to
// Supabase, they just don't get the speed-up.

async function getJson(key) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error(`[cache] getJson(${key}) failed:`, err.message);
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  if (!redis) return;
  try {
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.set(key, raw, "EX", ttlSeconds);
    } else {
      await redis.set(key, raw);
    }
  } catch (err) {
    console.error(`[cache] setJson(${key}) failed:`, err.message);
  }
}

// Deletes one or more exact keys.
async function del(...keys) {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error(`[cache] del(${keys.join(",")}) failed:`, err.message);
  }
}

// Deletes every key matching a prefix, e.g. delByPrefix("options:org123:")
// Used when a write needs to invalidate a whole family of cached keys
// (e.g. "all cached option lists for this org") without tracking each
// exact key that was ever set.
async function delByPrefix(prefix) {
  if (!redis) return;
  try {
    const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
    const keys = [];
    for await (const batch of stream) {
      keys.push(...batch);
    }
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    console.error(`[cache] delByPrefix(${prefix}) failed:`, err.message);
  }
}

// Convenience wrapper: return the cached value if present, otherwise run
// `loader`, cache its result, and return it.
//   const data = await cached(`options:${orgId}`, 60, () => buildOptions(orgId));
async function cached(key, ttlSeconds, loader) {
  const hit = await getJson(key);
  if (hit !== null) return hit;

  const fresh = await loader();
  // Don't cache empty/undefined results indefinitely-shaped bugs — still
  // cache them (an empty list is a valid result), just don't cache `undefined`.
  if (fresh !== undefined) {
    await setJson(key, fresh, ttlSeconds);
  }
  return fresh;
}

module.exports = { getJson, setJson, del, delByPrefix, cached };
