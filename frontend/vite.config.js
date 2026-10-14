import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [react()],

    // iPhone FIX (Safari AND Chrome on iOS both use WebKit): login worked but the
    // user was logged out ~1 second later. The login cookies are set by the
    // backend on onrender.com while the app lives on vercel.app, so they are
    // "third-party" cookies and iOS blocks them. The next API call then has no
    // cookie, gets 401, the refresh fails too, and the app sends the user to /login.
    //
    // vercel.json already forwards /api/* to the Render backend. In the
    // production build we therefore make every API call a RELATIVE "/api/..."
    // call (VITE_API_URL = ""), so the browser talks only to the Vercel domain
    // and the cookies become normal first-party cookies. This overrides any
    // VITE_API_URL value set in the Vercel dashboard. Local dev is unchanged.
    define: mode === "production" ? { "import.meta.env.VITE_API_URL": JSON.stringify("") } : {},

    // Older iPhones (iOS 14/15) blank-screen on newer JS syntax. Vite 8's default
    // target needs Safari 16.4+, so compile down for Safari 14 / es2020.
    build: {
        target: ["es2020", "safari14"],
        cssTarget: "safari14",
    },

    server: {
        proxy: {
            "/api": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
        },
    },
}));
