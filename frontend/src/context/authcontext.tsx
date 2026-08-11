// src/context/AuthContext.tsx
//
// Central auth state for the whole app. Pages currently read
// localStorage directly (e.g. clients.tsx, employees.tsx, products.tsx
// each parse "user" themselves) — this context is the replacement:
// wrap the app in <AuthProvider> once, then any component can call
// useAuth() instead of re-parsing localStorage.
//
// NOT wired into App.jsx yet on purpose — swapping every page over is
// a separate, mechanical step so it can be reviewed/tested on its own
// rather than bundled into this one. For now this is available to use
// in new pages (Daily Work, Allocation, Attendance, QC, Reports —
// Steps 4 onward) without having to touch every existing page today.

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { getCurrentUser, saveSession, clearSession, type CurrentUser } from "../utils/auth";
import { authFetch } from "../utils/authFetch";

interface AuthContextValue {
    user: CurrentUser | null;
    organizationId: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<CurrentUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Hydrate from localStorage on first load (survives page refresh —
        // no server round-trip needed since the token itself already
        // proves the session, verified lazily on the first API call).
        setUser(getCurrentUser());
        setLoading(false);
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
                // FIX (Finding #05 follow-up): tokens now arrive as httpOnly
                // cookies via Set-Cookie, not in the response body. Without
                // credentials: "include" on this cross-domain request
                // (frontend/backend are different origins), the browser
                // discards those Set-Cookie headers entirely — login would
                // look successful (user data still comes back) but no
                // session cookie would ever actually be stored.
                credentials: "include",
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, message: data.message || "Login failed" };
            }

            // FIX (Finding #05 follow-up): saveSession only takes { user }
            // now — accessToken/refreshToken no longer exist on data.data
            // (stripped server-side) and passing them here was a stale
            // leftover from before the cookie-auth migration.
            saveSession({ user: data.data.user });
            setUser(data.data.user);
            return { success: true };
        } catch (err: any) {
            return { success: false, message: err?.message || "Login failed" };
        }
    }, []);

    const logout = useCallback(() => {
        clearSession();
        setUser(null);
        window.location.href = "/login";
    }, []);

    return (
        <AuthContext.Provider
            value={{
                user,
                organizationId: user?.organizationId ?? null,
                loading,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth() must be used inside <AuthProvider>");
    }
    return ctx;
}

// Re-export so callers of useAuth() don't need a second import for
// authenticated API calls.
export { authFetch };
