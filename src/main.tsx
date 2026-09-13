import "./index.css";
import { DATA_PROFILE, FRONTEND_VARIANT } from "./runtimeProfile";
import { markStartup } from "./services/startupMetrics";

// The WebDriver bridge is compiled into the isolated desktop QA binary only.
if (import.meta.env.VITE_DESKTOP_E2E === "true")
  void import("@wdio/tauri-plugin");

markStartup("bootstrap");
document.documentElement.dataset.lectioFrontend = FRONTEND_VARIANT;
document.documentElement.dataset.lectioDataProfile = DATA_PROFILE;

const recordEarlyDiagnostic = (area: string, error: unknown) => {
  void import("./services/diagnostics").then(({ recordDiagnostic }) =>
    recordDiagnostic(area, error),
  );
};
window.addEventListener("error", (event) =>
  recordEarlyDiagnostic("window", event.error ?? event.message),
);
window.addEventListener("unhandledrejection", (event) =>
  recordEarlyDiagnostic("promise", event.reason),
);

async function start() {
  // Lock before importing the store adapter: a rejected second process must
  // never hydrate and accidentally persist into the same real profile.
  const { acquireDataProfileLock } =
    await import("./infrastructure/profileLock");
  const profileLock = await acquireDataProfileLock(DATA_PROFILE);
  window.addEventListener("pagehide", () => profileLock.release(), {
    once: true,
  });

  const [{ lectioClient }, { mountReactFrontend }, frontendModule] =
    await Promise.all([
      import("./infrastructure/lectioClientAdapter"),
      import("./bootstrap/mountReactFrontend"),
      import("@lectio-frontend"),
    ]);
  const root = document.getElementById("root");
  if (!root) throw new Error("Lectio saknar en monteringspunkt.");
  mountReactFrontend(root, frontendModule.default, lectioClient);
  markStartup(`frontend:${FRONTEND_VARIANT}:mounted`);

  requestAnimationFrame(() => {
    markStartup("first-frame");
    requestAnimationFrame(() => {
      markStartup("app-shell-painted");
      void import("./services/diagnostics").then(({ initializeDiagnostics }) =>
        initializeDiagnostics(),
      );
    });
  });
}

void start().catch((error) => {
  recordEarlyDiagnostic("bootstrap", error);
  const root = document.getElementById("root");
  if (root) {
    root.replaceChildren();
    const main = document.createElement("main");
    const section = document.createElement("section");
    const title = document.createElement("strong");
    const message = document.createElement("p");
    main.className = "lectio-bootstrap";
    title.textContent = "Lectio kunde inte starta";
    message.textContent =
      error instanceof Error ? error.message : "Ett okänt fel inträffade.";
    section.append(title, message);
    main.append(section);
    root.append(main);
  }
});
