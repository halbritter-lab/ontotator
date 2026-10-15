import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "./app/AuthGate";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <AuthGate />
    </React.StrictMode>
  );
}
