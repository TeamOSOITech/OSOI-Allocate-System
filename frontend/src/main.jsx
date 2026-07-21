import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { scan } from "react-scan";

import "./index.css";
import App from "./App.jsx";

// Enable React Scan only in development
if (import.meta.env.DEV) {
    scan();
}

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App />
    </StrictMode>
);
