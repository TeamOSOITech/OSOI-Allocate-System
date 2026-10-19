// src/context/collarmode.tsx
//
// White Collar (service-based) vs Blue Collar (manpower-based) mode.
//
//  - Admin-side roles (anyone except TEAM_MEMBER / CLIENT) can flip the
//    toggle on the Home page; their pick is remembered in localStorage.
//  - A Team Member is locked to their own world (the collarType their
//    account was created with) — they never see the toggle.
//
// The effective mode is recomputed from the cached user on every read, so
// it is always right straight after login/logout without any extra wiring.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentUser } from "../utils/auth";

export type CollarMode = "WHITE" | "BLUE";

const STORAGE_KEY = "collarMode";

const readStored = (): CollarMode | null => {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === "BLUE" || v === "WHITE" ? v : null;
    } catch {
        return null;
    }
};

interface Ctx {
    stored: CollarMode | null;
    setStored: (m: CollarMode) => void;
}

const CollarModeContext = createContext<Ctx | undefined>(undefined);

export function CollarModeProvider({ children }: { children: ReactNode }) {
    const [stored, setStoredState] = useState<CollarMode | null>(readStored);

    const setStored = useCallback((m: CollarMode) => {
        try {
            localStorage.setItem(STORAGE_KEY, m);
        } catch {
            /* storage blocked — the mode still works for this session */
        }
        setStoredState(m);
    }, []);

    const value = useMemo(() => ({ stored, setStored }), [stored, setStored]);
    return <CollarModeContext.Provider value={value}>{children}</CollarModeContext.Provider>;
}

export function useCollarMode() {
    const ctx = useContext(CollarModeContext);
    if (!ctx) throw new Error("useCollarMode must be used inside <CollarModeProvider>");

    const user = getCurrentUser();
    const own: CollarMode = user?.collarType === "BLUE" ? "BLUE" : "WHITE";
    const canToggle =
        Boolean(user?.role) && user?.role !== "TEAM_MEMBER" && user?.role !== "CLIENT";
    const mode: CollarMode = canToggle ? (ctx.stored ?? own) : own;

    return {
        mode,
        isBlue: mode === "BLUE",
        canToggle,
        setMode: ctx.setStored,
    };
}
