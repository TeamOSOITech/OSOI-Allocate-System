import { createContext, useContext, useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

/* ---------------------------------------------------------------------- */
/*  Available theme colors                                                 */
/* ---------------------------------------------------------------------- */

export type ThemeName =
    "default" | "purple" | "brown" | "red" | "yellow" | "pink" | "green" | "orange" | "white";

export type DisplayMode = "light" | "dark" | "system";

type ThemePalette = {
    label: string;
    blue: string; // primary
    lightBlue: string; // secondary / accent
    green: string; // tertiary (kept as "green" for back-compat with BRAND.green)
};

// Each palette keeps the same 3-stop shape the app already uses
// (BRAND.blue / BRAND.lightBlue / BRAND.green) so every existing
// `linear-gradient(135deg, ${BRAND.lightBlue}, ${BRAND.blue})` call
// keeps working unchanged — only the color values move.
export const THEMES: Record<ThemeName, ThemePalette> = {
    default: { label: "Default", blue: "#204297", lightBlue: "#08A1CE", green: "#2EBBA8" },
    purple: { label: "Purple", blue: "#5B21B6", lightBlue: "#8B5CF6", green: "#A78BFA" },
    brown: { label: "Brown", blue: "#5D4037", lightBlue: "#8D6E63", green: "#BCAAA4" },
    red: { label: "Red", blue: "#B91C1C", lightBlue: "#EF4444", green: "#F87171" },
    yellow: { label: "Yellow", blue: "#B45309", lightBlue: "#F59E0B", green: "#FBBF24" },
    pink: { label: "Pink", blue: "#BE185D", lightBlue: "#EC4899", green: "#F472B6" },
    green: { label: "Green", blue: "#15803D", lightBlue: "#22C55E", green: "#86EFAC" },
    orange: { label: "Orange", blue: "#C2410C", lightBlue: "#F97316", green: "#FDBA74" },
    white: { label: "White", blue: "#E5E7EB", lightBlue: "#F3F4F6", green: "#FFFFFF" },
};

const STORAGE_KEY_THEME = "app_theme_color";
const STORAGE_KEY_MODE = "app_display_mode";

/* ---------------------------------------------------------------------- */
/*  Context                                                                 */
/* ---------------------------------------------------------------------- */

interface ThemeContextValue {
    themeName: ThemeName;
    colors: ThemePalette;
    setThemeName: (t: ThemeName) => void;
    displayMode: DisplayMode;
    setDisplayMode: (m: DisplayMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [themeName, setThemeNameState] = useState<ThemeName>(() => {
        if (typeof window === "undefined") return "default";
        const saved = localStorage.getItem(STORAGE_KEY_THEME) as ThemeName | null;
        return saved && THEMES[saved] ? saved : "default";
    });

    const [displayMode, setDisplayModeState] = useState<DisplayMode>(() => {
        if (typeof window === "undefined") return "light";
        return (localStorage.getItem(STORAGE_KEY_MODE) as DisplayMode) || "light";
    });

    const setThemeName = (t: ThemeName) => {
        setThemeNameState(t);
        localStorage.setItem(STORAGE_KEY_THEME, t);
    };

    const setDisplayMode = (m: DisplayMode) => {
        setDisplayModeState(m);
        localStorage.setItem(STORAGE_KEY_MODE, m);
    };

    // Expose the active palette as CSS variables on <html> too, so plain
    // CSS files (not just inline React styles) can react to theme changes
    // via `var(--brand-blue)` etc. without every component needing the hook.
    useEffect(() => {
        const c = THEMES[themeName];
        const root = document.documentElement;
        root.style.setProperty("--brand-blue", c.blue);
        root.style.setProperty("--brand-light-blue", c.lightBlue);
        root.style.setProperty("--brand-green", c.green);
    }, [themeName]);

    useEffect(() => {
        const root = document.documentElement;
        if (displayMode === "dark") root.setAttribute("data-mode", "dark");
        else if (displayMode === "light") root.setAttribute("data-mode", "light");
        else root.removeAttribute("data-mode"); // "system" — let prefers-color-scheme decide
    }, [displayMode]);

    const value = useMemo(
        () => ({
            themeName,
            colors: THEMES[themeName],
            setThemeName,
            displayMode,
            setDisplayMode,
        }),
        [themeName, displayMode]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
    return ctx;
}
