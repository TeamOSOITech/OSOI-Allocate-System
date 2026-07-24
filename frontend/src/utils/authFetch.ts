import { supabase } from "../config/supabaseClient";

// Shared fetch wrapper for every authenticated backend call.
//
// Why this exists: pages were manually reading `accessToken` from
// localStorage and attaching it per-call. That works fine most of the
// time, but the access token Supabase issues on login is short-lived
// (~1 hour) — once it's borderline expired, whichever request happens
// to land in that window gets a 401, even while a sibling request
// fired milliseconds earlier/later succeeds. That's exactly the
// "clients loads, subclients 401s" symptom.
//
// Fix: on any 401, use the refresh_token (saved at login) to get a
// fresh access_token from Supabase directly, save it, and retry the
// ORIGINAL request once. Only redirect to /login if the refresh
// itself fails (i.e. the session is truly dead, not just stale).
//
// Separately: on Render's free tier the backend spins down after
// ~15 minutes idle, and the first request after that has to wait for
// it to cold-boot (can take 30–50s). During that window, fetch()
// itself throws ("Failed to fetch") rather than returning any HTTP
// status — a completely different failure mode from a 401, so it
// needs its own retry loop with backoff instead of failing instantly.

const COLD_START_RETRY_DELAYS_MS = [2000, 5000, 10000, 15000]; // ~32s total budget

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
    // De-dupe: if 3 requests 401 at once, only refresh once, not 3 times.
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) return null;

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token: refreshToken,
        });

        if (error || !data.session) {
            console.error("authFetch: session refresh failed:", error?.message);
            return null;
        }

        localStorage.setItem("accessToken", data.session.access_token);
        localStorage.setItem("refreshToken", data.session.refresh_token);
        return data.session.access_token;
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

function goToLogin() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
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
    const attempt = (token: string | null) =>
        fetchWithColdStartRetry(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });

    const token = localStorage.getItem("accessToken");
    let res = await attempt(token);

    if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
            goToLogin();
            // goToLogin navigates away; throw so callers' .then()/await
            // chains don't keep running against a dead response.
            throw new Error("Session expired. Redirecting to login.");
        }
        res = await attempt(newToken);
        if (res.status === 401) {
            // Refreshed successfully but STILL 401 — this is a real
            // permission/role problem, not a stale-token problem. Don't
            // loop forever; let the caller handle the response as-is.
            return res;
        }
    }

    return res;
}
