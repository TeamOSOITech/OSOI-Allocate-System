// src/context/roleLabelsContext.tsx
//
// Every place in the app that prints a role name (Add User's Role
// dropdown, the Employees list/drawer, Profile, Home's greeting, etc.)
// reads through this context instead of a hardcoded label — so once a
// Super Admin renames a role for their org (see the "Manage Roles" popup
// on the Home page), the new name shows up everywhere automatically,
// with no per-page changes needed beyond swapping in useRoleLabels().
//
// The underlying role VALUE (TEAM_MEMBER, etc.) never changes — this is
// a display-only layer on top of it, backed by GET/POST /api/role-labels.

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { authFetch } from "../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;

// Baked-in fallback so every page has a sensible label to show
// immediately on first render, before the API call resolves (and if it
// ever fails) — matches the backend's DEFAULT_ROLE_LABELS exactly.
export const DEFAULT_ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: "Super Admin",
    OPS_MANAGER: "Ops Manager",
    AUDIT_MANAGER: "Audit Manager",
    PROCESS_LEAD: "Process Lead",
    VERTICAL_HEAD: "Vertical Head",
    TEAM_MEMBER: "Team Member",
};

// Only these can be given a custom label — SUPER_ADMIN is fixed (also
// enforced on the backend; kept here too so the UI never even offers it).
export const CUSTOMIZABLE_ROLES: string[] = [
    "TEAM_MEMBER",
    "VERTICAL_HEAD",
    "PROCESS_LEAD",
    "OPS_MANAGER",
    "AUDIT_MANAGER",
];

interface RoleLabelsContextValue {
    roleLabels: Record<string, string>;
    getRoleLabel: (roleCode?: string | null) => string;
    refreshRoleLabels: () => Promise<void>;
    loading: boolean;
}

const RoleLabelsContext = createContext<RoleLabelsContextValue | undefined>(undefined);

export function RoleLabelsProvider({ children }: { children: ReactNode }) {
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>(DEFAULT_ROLE_LABELS);
    const [loading, setLoading] = useState(true);

    const fetchLabels = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/role-labels`);
            if (!res.ok) return; // keep whatever we already have (defaults, or the last good fetch)
            const data = await res.json();
            setRoleLabels((prev) => ({ ...prev, ...DEFAULT_ROLE_LABELS, ...data }));
        } catch (err) {
            // Non-fatal — every consumer keeps working off the defaults.
            console.error("Failed to load custom role labels:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLabels();
    }, [fetchLabels]);

    const getRoleLabel = useCallback(
        (roleCode?: string | null) => {
            if (!roleCode) return "—";
            return roleLabels[roleCode] || roleCode;
        },
        [roleLabels]
    );

    const value = useMemo(
        () => ({ roleLabels, getRoleLabel, refreshRoleLabels: fetchLabels, loading }),
        [roleLabels, getRoleLabel, fetchLabels, loading]
    );

    return <RoleLabelsContext.Provider value={value}>{children}</RoleLabelsContext.Provider>;
}

export function useRoleLabels() {
    const ctx = useContext(RoleLabelsContext);
    if (!ctx) {
        throw new Error("useRoleLabels() must be used inside a <RoleLabelsProvider>");
    }
    return ctx;
}
