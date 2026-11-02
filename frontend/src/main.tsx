import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "./app/AuthGate";
import { ScreenErrorBoundary } from "./app/ErrorBoundary";
// Self-hosted OFL fonts (no request leaves the origin), then the design tokens.
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/source-sans-3/index.css";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      {/* The last resort: a crash in the shell itself (inside it, App catches each screen). */}
      <ScreenErrorBoundary>
        <AuthGate />
      </ScreenErrorBoundary>
    </React.StrictMode>
  );
}
