// src/utils/auth.ts
//
// Central place for reading/writing the logged-in user's session data.
// Every page was previously doing its own `JSON.parse(localStorage.getItem("user"))`
// with slightly different fallback handling — this is the one source of
// truth, and AuthContext (context/AuthContext.tsx) wraps it for
// component use.

export interface CurrentUser {
    id: string;
    email: string;
    role: string;
    organizationId: string;
    firstName?: string;
    lastName?: string;
    department?: string;
    designation?: string;
}

export function getCurrentUser(): CurrentUser | null {
    try {
        const raw = localStorage.getItem("user");
        return raw ? (JSON.parse(raw) as CurrentUser) : null;
    } catch {
        return null;
    }
}

// FIX (Finding #05): tokens now live only in httpOnly cookies (never
// readable by JS, never in localStorage) — "authenticated" is
// determined by having a user profile cached client-side; the actual
// session is proven server-side by the cookie on the next API call.
export function isAuthenticated(): boolean {
    return Boolean(getCurrentUser());
}

export function saveSession(session: { user: CurrentUser }) {
    localStorage.setItem("user", JSON.stringify(session.user));
}

export function clearSession() {
    localStorage.removeItem("user");
}

// Role-group helpers — single source of truth for "who counts as
// admin-tier" on the frontend, matching backend src/config/permissions.js.
export const ADMIN_TIER_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "AUDIT_MANAGER", "PROCESS_LEAD"];
export const ADMIN_AND_VERTICAL_HEAD_ROLES = [...ADMIN_TIER_ROLES, "VERTICAL_HEAD"];

export function hasRole(user: CurrentUser | null, allowed: string[]): boolean {
    return Boolean(user?.role && allowed.includes(user.role));
}
