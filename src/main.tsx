import "./index.css";
import { DATA_PROFILE, FRONTEND_VARIANT } from "./runtimeProfile";
import { markStartup } from "./services/startupMetrics";

const startupPalette = (id: string) => {
  const palettes: Record<
    string,
    {
      chrome: [string, string, string];
      ink: string;
      muted: string;
      accent: string;
      background: string;
      tone: "light" | "dark";
    }
  > = {
    "blue-light": {
      chrome: ["#9bc8ef", "#73a7dc", "#6679c7"],
      ink: "#14283b",
      muted: "#526b80",
      accent: "#245f9e",
      background: "#edf4fa",
      tone: "light",
    },
    "orange-light": {
      chrome: ["#f6b17e", "#e87d5b", "#bd5367"],
      ink: "#34251d",
      muted: "#755d4e",
      accent: "#a94720",
      background: "#faf1e8",
      tone: "light",
    },
    "blue-dark": {
      chrome: ["#2b4f6d", "#234361", "#1b3651"],
      ink: "#f4f8fc",
      muted: "#afc0cf",
      accent: "#75b8f0",
      background: "#101923",
      tone: "dark",
    },
    "orange-dark": {
      chrome: ["#71452f", "#623824", "#512d20"],
      ink: "#fff8f3",
      muted: "#d2b8a8",
      accent: "#f29a62",
      background: "#211713",
      tone: "dark",
    },
  };
  const palette = palettes[id];
  if (!palette) return false;
  const root = document.documentElement;
  root.dataset.lectioStartupPalette = id;
  root.style.colorScheme = palette.tone;
  root.style.backgroundColor = palette.background;
  root.style.setProperty("--startup-coral", palette.chrome[0]);
  root.style.setProperty("--startup-rose", palette.chrome[1]);
  root.style.setProperty("--startup-plum", palette.chrome[2]);
  root.style.setProperty("--startup-ink", palette.ink);
  root.style.setProperty("--startup-muted", palette.muted);
  root.style.setProperty("--startup-accent", palette.accent);
  return true;
};

let startupShellPainted = false;
let startupPaletteReady = FRONTEND_VARIANT !== "next";
const revealStartup = () => {
  if (startupShellPainted && startupPaletteReady)
    document.documentElement.dataset.lectioReady = "true";
};

try {
  const savedPalette = window.localStorage.getItem(
    `lectio-startup-palette:${DATA_PROFILE}`,
  );
  if (savedPalette) startupPaletteReady = startupPalette(savedPalette);
} catch {
  // The loader remains usable if browser storage is unavailable.
}

window.addEventListener("lectio:startup-palette", (event) => {
  const paletteId = (event as CustomEvent<string>).detail;
  if (paletteId) startupPalette(paletteId);
  revealStartup();
});
window.addEventListener(
  "lectio:library-hydrated",
  () => {
    if (!startupPaletteReady) {
      try {
        const savedPalette = window.localStorage.getItem(
          `lectio-startup-palette:${DATA_PROFILE}`,
        );
        if (savedPalette) startupPalette(savedPalette);
      } catch {
        // Fall back to the shell colors from index.html.
      }
      startupPaletteReady = true;
    }
    revealStartup();
  },
  { once: true },
);

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
      startupShellPainted = true;
      revealStartup();
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
    main.className = "lectio-startup-error";
    title.textContent = "Lectio kunde inte starta";
    message.textContent =
      error instanceof Error ? error.message : "Ett okänt fel inträffade.";
    section.append(title, message);
    main.append(section);
    root.append(main);
    startupShellPainted = true;
    startupPaletteReady = true;
    revealStartup();
  }
});
