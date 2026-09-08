import path from "node:path";
import type { Options } from "@wdio/types";

// The standalone Tauri manifest uses its own target directory. The QA script
// builds this exact release binary immediately before launching WebDriver.
const appBinaryPath = path.resolve("src-tauri/target/release/lectio.exe");
const isolatedAppData = path.resolve("test-results/desktop/appdata");

// The spawned Tauri binary inherits this environment. It therefore cannot
// read or mutate the developer's actual Lectio library during desktop E2E.
process.env.LOCALAPPDATA = isolatedAppData;
process.env.APPDATA = isolatedAppData;

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./desktop-e2e/**/*.spec.ts"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath,
    driverProvider: "external",
    autoInstallTauriDriver: true,
    autoDownloadEdgeDriver: true,
    captureBackendLogs: true,
    // The external WebDriver provider exercises the real shipped binary. It
    // cannot use the optional in-process WDIO plugin, so browser DOM failures
    // are reported by the runner while Rust logs remain captured separately.
    captureFrontendLogs: false,
    backendLogLevel: "warn",
    frontendLogLevel: "warn",
    logDir: "test-results/desktop/logs",
    startTimeout: 90_000,
    commandTimeout: 30_000,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application: appBinaryPath },
  }],
  logLevel: "error",
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  reporters: ["spec"],
};
