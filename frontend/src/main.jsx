import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.jsx";

// React Scan is a dev-only tool. It is loaded with a dynamic import inside the
// DEV check so it is NOT part of the production bundle (a static import kept it
// in the live build, where it can break the page on iPhone Safari / Chrome).
if (import.meta.env.DEV) {
    import("react-scan").then(({ scan }) => scan());
}

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App />
    </StrictMode>
);
