import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;
const frontend = process.env.LECTIO_FRONTEND === "next" ? "next" : "legacy";
const dataProfile =
  process.env.LECTIO_DATA_PROFILE ?? (frontend === "next" ? "next" : "main");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@lectio-frontend": path.resolve(
        import.meta.dirname,
        `./src/frontends/${frontend}/entry.tsx`,
      ),
    },
  },
  clearScreen: false,
  optimizeDeps: {
    // Vite's default waits for the complete dependency crawl before exposing
    // the first optimized result. Lectio has several large, lazy-only modules
    // (PDF, OCR and diagnostics), so a cold dev cache could leave Tauri on its
    // plain bootstrap background while that crawl completed. Let WebView2
    // render the shell and eager React graph as soon as they are ready.
    holdUntilCrawlEnd: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**", "**/release/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    __LECTIO_FRONTEND__: JSON.stringify(frontend),
    __LECTIO_DATA_PROFILE__: JSON.stringify(dataProfile),
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
