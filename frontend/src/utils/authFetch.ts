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

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const attempt = (token: string | null) =>
        fetch(url, {
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
