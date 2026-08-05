// Shared fetch wrapper for every authenticated backend call.
//
// COOKIE-AUTH REWRITE: the backend now issues accessToken/refreshToken as
// httpOnly cookies (see backend/src/config/authCookies.js) instead of
// returning them in the login response body. That means:
//   - This file can no longer read/attach an Authorization: Bearer header
//     — httpOnly cookies are invisible to JS by design. The browser sends
//     them automatically as long as `credentials: "include"` is set.
//   - Every state-changing request (anything not GET/HEAD/OPTIONS) must
//     also carry an `X-CSRF-Token` header that matches the non-httpOnly
//     `csrfToken` cookie (double-submit pattern — see
//     backend/src/middlewares/csrf.js). Without it, the backend's
//     csrfProtection middleware will reject the request with 403.
//   - On a 401, we can no longer refresh the session ourselves (we have
//     no token to hand Supabase) — we instead call the backend's own
//     refresh endpoint, which reads the httpOnly refreshToken cookie and
//     re-issues fresh cookies for us. Adjust REFRESH_ENDPOINT below if
//     your route is named differently.
//
// The cold-start retry behavior (Render free tier spinning down after
// ~15 min idle) is unchanged from before.

const API_BASE = import.meta.env.VITE_API_URL;
const REFRESH_ENDPOINT = `${API_BASE}/api/auth/refresh`;
const LOGOUT_ENDPOINT = `${API_BASE}/api/auth/logout`;
const CSRF_STORAGE_KEY = "csrfToken";

const COLD_START_RETRY_DELAYS_MS = [2000, 5000, 10000, 15000]; // ~32s total budget

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// CROSS-DOMAIN FIX: this used to read the csrfToken cookie directly via
// document.cookie (the textbook "double-submit cookie" pattern). That only
// works when frontend and backend share a registrable domain (e.g.
// app.example.com + api.example.com). Here they're on entirely different
// domains (vercel.app vs onrender.com) — a browser will NEVER expose a
// cookie set by one site's Set-Cookie header to JS running on a different
// site, regardless of the cookie's httpOnly flag. That's exactly why
// every non-GET request was failing with "CSRF check failed" in
// production despite working fine anywhere frontend/backend share a
// domain (or in local dev, where both can be localhost).
//
// Fix: the backend already returns the SAME csrfToken value in the login
// and refresh response BODIES (see auth.controller.js), not just as a
// cookie. A same-origin fetch() response body is always readable by our
// own JS no matter what domain the server is on — so we capture it there
// instead, keep it in memory, and mirror it to localStorage purely so a
// page refresh doesn't lose it (a browser refresh clears JS memory but
// not localStorage). It's safe to store like this: a CSRF token isn't a
// secret credential — its only job is proving "this request came from JS
// running on our own frontend," which localStorage already guarantees
// just as well as a cookie would (a malicious cross-site page can't read
// either one).
let csrfToken: string | null =
    typeof window !== "undefined" ? localStorage.getItem(CSRF_STORAGE_KEY) : null;

export function setCsrfToken(token: string | null) {
    csrfToken = token;
    if (typeof window === "undefined") return;
    if (token) localStorage.setItem(CSRF_STORAGE_KEY, token);
    else localStorage.removeItem(CSRF_STORAGE_KEY);
}

function getCsrfToken(): string | null {
    return csrfToken;
}

let refreshInFlight: Promise<boolean> | null = null;

// Calls the backend's refresh route. On success the backend has already
// set fresh Set-Cookie headers on the response — there is nothing for us
// to store locally, we just signal "ok, retry the original request now".
async function refreshSession(): Promise<boolean> {
    // De-dupe: if 3 requests 401 at once, only refresh once, not 3 times.
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        try {
            const csrf = getCsrfToken();
            const res = await fetch(REFRESH_ENDPOINT, {
                method: "POST",
                credentials: "include",
                headers: csrf ? { "X-CSRF-Token": csrf } : {},
            });
            if (!res.ok) return false;

            // The refreshed csrfToken cookie is a NEW value (see
            // authCookies.js — generateCsrfToken() runs again on every
            // setAuthCookies call) — capture it from the body so our next
            // header send matches what the browser will now attach as the
            // cookie, instead of sending the stale pre-refresh value.
            try {
                const data = await res.json();
                if (data?.data?.csrfToken) setCsrfToken(data.data.csrfToken);
            } catch {
                // Non-fatal — worst case the next request's CSRF check
                // fails and triggers another refresh cycle.
            }

            return true;
        } catch (err) {
            console.error("authFetch: session refresh failed:", err);
            return false;
        }
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

function goToLogin() {
    // Best-effort: ask the backend to clear the httpOnly cookies too,
    // rather than just wiping local state and leaving dead cookies
    // sitting in the browser. Fire-and-forget — we're navigating away
    // regardless of whether this call succeeds.
    fetch(LOGOUT_ENDPOINT, { method: "POST", credentials: "include" }).catch(() => {});

    // "user" here is just cached profile info for UI (name/role display),
    // never a credential — safe to keep in localStorage, but stale on
    // logout so it should still be cleared.
    localStorage.removeItem("user");
    setCsrfToken(null);
    window.location.href = "/login";
}

// Optional global hook so a page can show "Waking up server…" instead of
// a generic spinner during a cold-start retry. Purely cosmetic — safe to
// ignore if no page sets it.
export let onColdStartRetry: ((attempt: number, max: number) => void) | null = null;
export function setColdStartRetryHandler(fn: typeof onColdStartRetry) {
    onColdStartRetry = fn;
}

async function fetchWithColdStartRetry(url: string, init: RequestInit): Promise<Response> {
    for (let i = 0; i <= COLD_START_RETRY_DELAYS_MS.length; i++) {
        try {
            return await fetch(url, init);
        } catch (networkErr) {
            // fetch() only throws for genuine network-level failures
            // (server unreachable, DNS, CORS-blocked, connection refused)
            // — never for a normal HTTP error status. That's exactly what
            // "server still cold-booting" looks like from the browser.
            if (i === COLD_START_RETRY_DELAYS_MS.length) {
                throw new Error(
                    "Could not reach the server. It may be waking up from sleep — please try again in a moment."
                );
            }
            console.warn(
                `authFetch: network error (attempt ${i + 1}), retrying in ${COLD_START_RETRY_DELAYS_MS[i]}ms — likely a cold-starting backend`,
                networkErr
            );
            onColdStartRetry?.(i + 1, COLD_START_RETRY_DELAYS_MS.length + 1);
            await sleep(COLD_START_RETRY_DELAYS_MS[i]);
        }
    }
    // Unreachable, but keeps TypeScript happy.
    throw new Error("Could not reach the server.");
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const method = (options.method || "GET").toUpperCase();

    const buildInit = (): RequestInit => {
        const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };

        // CSRF header only needed (and only checked by the backend) on
        // state-changing requests — GET/HEAD/OPTIONS are exempt.
        if (!SAFE_METHODS.has(method)) {
            const csrf = getCsrfToken();
            if (csrf) headers["X-CSRF-Token"] = csrf;
        }

        return {
            ...options,
            method,
            headers,
            // REQUIRED for cookie-based auth across the frontend (Vercel) /
            // backend (Render) domain split — without this, the browser
            // won't send or accept the auth cookies at all.
            credentials: "include",
        };
    };

    let res = await fetchWithColdStartRetry(url, buildInit());

    if (res.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) {
            goToLogin();
            // goToLogin navigates away; throw so callers' .then()/await
            // chains don't keep running against a dead response.
            throw new Error("Session expired. Redirecting to login.");
        }
        res = await fetchWithColdStartRetry(url, buildInit());
        if (res.status === 401) {
            // Refreshed successfully but STILL 401 — this is a real
            // permission/role problem, not a stale-token problem. Don't
            // loop forever; let the caller handle the response as-is.
            return res;
        }
    }

    return res;
}
