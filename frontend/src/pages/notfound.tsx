// src/pages/notfound.tsx
//
// FIX (#16 of the vibecoded-site checklist): there was no catch-all route
// at all — App.jsx's <Routes> had no path="*" entry, so visiting any
// unmatched URL (typo, old bookmark, stale link) rendered a completely
// blank page with no explanation and no way back in. This is that
// missing page, wired up as the last route in App.jsx.
//
// THEME FIX: the first version of this page hardcoded #aa3bff (the public
// landing page's own one-off accent color) for the "404" text and button.
// That doesn't match the app's actual theme system — see
// context/themecontext.tsx, which lets a logged-in user pick one of 9
// brand colors, applied everywhere else via useTheme().colors.blue. Now
// pulls the live theme color the same way every other authenticated page
// does, and uses the app's --bg/--text/--text-h CSS variables (from
// index.css) for background/text so it also follows light/dark mode
// correctly instead of being hardcoded white.

import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { useTheme } from "../context/themecontext";

export default function NotFound() {
    const { colors: themeColors } = useTheme();

    return (
        <div style={styles.wrap}>
            <div style={{ ...styles.code, color: themeColors.blue }}>404</div>
            <h1 style={styles.title}>Page not found</h1>
            <p style={styles.desc}>
                The page you're looking for doesn't exist, may have been moved, or the link you
                followed is out of date.
            </p>
            <Link
                to="/"
                style={{
                    ...styles.link,
                    background: `linear-gradient(135deg, ${themeColors.lightBlue}, ${themeColors.blue})`,
                }}
            >
                Go back home
            </Link>
        </div>
    );
}

// FIX: without this annotation, TypeScript infers plain `string` for
// values like flexDirection/textAlign — but React's CSSProperties needs
// the exact literal type (e.g. "column", not string), so it rejected
// this object with a type error. Typing it explicitly fixes that.
const styles: { [key: string]: CSSProperties } = {
    wrap: {
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "24px",
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
        background: "var(--bg)",
        color: "var(--text)",
    },
    code: {
        fontSize: "clamp(48px, 12vw, 96px)",
        fontWeight: 800,
        lineHeight: 1,
    },
    title: {
        fontSize: "clamp(20px, 5vw, 28px)",
        margin: "12px 0 8px",
        color: "var(--text-h)",
    },
    desc: {
        color: "var(--text)",
        maxWidth: "420px",
        marginBottom: "24px",
    },
    link: {
        padding: "10px 20px",
        borderRadius: "8px",
        color: "#fff",
        textDecoration: "none",
        fontWeight: 600,
    },
};
