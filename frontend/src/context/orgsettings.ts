// src/context/orgsettings.ts
//
// Tiny org-level settings hook (no provider needed). Currently one flag:
//   caseNumberRequired — when false, employees can complete count-only
//   work without typing case numbers (see Profile -> Add case numbers).
//
// Backed by GET/PATCH /api/organization/settings. The value is shared via
// a module-level cache + a window event, so flipping it in the header's
// Settings menu updates any open Profile page immediately.

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../utils/authFetch";

const API_BASE = import.meta.env.VITE_API_URL;
const EVENT = "org-settings-changed";

export interface OrgSettings {
    caseNumberRequired: boolean;
}

let cache: OrgSettings = { caseNumberRequired: true };

export async function fetchOrgSettings(): Promise<OrgSettings> {
    const res = await authFetch(`${API_BASE}/api/organization/settings`);
    if (!res.ok) throw new Error("Failed to load settings");
    const json = await res.json();
    cache = { caseNumberRequired: json?.data?.caseNumberRequired !== false };
    window.dispatchEvent(new Event(EVENT));
    return cache;
}

export async function saveCaseNumberRequired(value: boolean): Promise<void> {
    const res = await authFetch(`${API_BASE}/api/organization/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNumberRequired: value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.message || "Failed to save setting");
    cache = { caseNumberRequired: value };
    window.dispatchEvent(new Event(EVENT));
}

export function useOrgSettings(): OrgSettings {
    const [settings, setSettings] = useState<OrgSettings>(cache);
    const sync = useCallback(() => setSettings(cache), []);

    useEffect(() => {
        window.addEventListener(EVENT, sync);
        fetchOrgSettings().catch(() => {
            /* keep default (required) if the call fails */
        });
        return () => window.removeEventListener(EVENT, sync);
    }, [sync]);

    return settings;
}
