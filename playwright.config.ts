import { defineConfig, devices } from "@playwright/test";

const qaOutput = process.env.LECTIO_QA_OUTPUT_DIR;
const playwrightOutput = qaOutput
  ? `${qaOutput}/playwright`
  : "test-results/playwright";
const playwrightReport = qaOutput
  ? `${qaOutput}/playwright-report`
  : "test-results/playwright-report";

export default defineConfig({
  testDir: "./e2e",
  timeout: process.env.LECTIO_TEST_MODE === "1" ? 60_000 : 30_000,
  fullyParallel: false,
  workers: 1,
  outputDir: playwrightOutput,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: playwrightReport, open: "never" }],
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer:
      !process.env.CI && process.env.LECTIO_TEST_MODE !== "1",
  },
});
