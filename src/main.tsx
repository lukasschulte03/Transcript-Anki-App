import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { initializeDiagnostics, recordDiagnostic } from "./services/diagnostics.ts";

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
