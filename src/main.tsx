import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { initializeDiagnostics, recordDiagnostic } from "./services/diagnostics.ts";

// The WebDriver bridge is compiled into the isolated desktop QA binary only.
// It is excluded from normal development and release builds.
if (import.meta.env.VITE_DESKTOP_E2E === "true") void import("@wdio/tauri-plugin");

initializeDiagnostics();
window.addEventListener("error", (event) => recordDiagnostic("window", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => recordDiagnostic("promise", event.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
