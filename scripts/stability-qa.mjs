import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertSafeStabilityRoot,
  formatDuration,
  safeArtifactName,
  STABILITY_FOLDER,
} from "./stability-lib.mjs";

const workspaceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  await readFile(path.join(workspaceDir, "package.json"), "utf8"),
);
const startedAt = new Date();
const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const stabilityDir = path.join(workspaceDir, "test-results", "stability");
const artifactDir = path.join(stabilityDir, runId);
const tempParent = path.join(os.tmpdir(), STABILITY_FOLDER);
const regularAppDataDir = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
  "com.lectio.desktop",
);
const testRoot = assertSafeStabilityRoot(path.join(tempParent, runId), {
  tempDir: os.tmpdir(),
  homeDir: os.homedir(),
  workspaceDir,
  regularAppDataDir,
});
const logsDir = path.join(artifactDir, "logs");
const children = new Set();
const phases = [];
let interrupted = false;

async function purgeStaleTestRoots() {
  for (const entry of await readdir(tempParent, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    const candidate = path.join(tempParent, entry.name);
    const marker = path.join(candidate, ".lectio-stability-root");
    if (!(await stat(marker).then(() => true).catch(() => false))) continue;
    assertSafeStabilityRoot(candidate, {
      tempDir: os.tmpdir(),
      homeDir: os.homedir(),
      workspaceDir,
      regularAppDataDir,
    });
    await rm(candidate, { recursive: true, force: true });
  }
}

await purgeStaleTestRoots();
await mkdir(logsDir, { recursive: true });
await mkdir(path.join(testRoot, "appdata"), { recursive: true });
await mkdir(path.join(testRoot, "sync-sandbox"), { recursive: true });
await writeFile(path.join(testRoot, ".lectio-stability-root"), runId, "utf8");

const testEnvironment = {
  ...process.env,
  LECTIO_TEST_MODE: "1",
  LECTIO_STABILITY_ROOT: testRoot,
  LECTIO_QA_OUTPUT_DIR: artifactDir,
  VITE_STABILITY_TEST: "true",
  VITE_STABILITY_RUN_ID: safeArtifactName(runId),
  VITE_DISABLE_EXTERNAL_SERVICES: "true",
  NO_COLOR: "1",
};

function commandFor(program, args) {
  if (process.platform !== "win32") return { command: program, args };
  const commandLine = [program, ...args].join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
  };
}

async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function cleanupChildren() {
  await Promise.all([...children].map(stopProcessTree));
  children.clear();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    interrupted = true;
    await cleanupChildren();
  });
}

async function runPhase({
  id,
  label,
  program,
  args,
  timeoutMs = 10 * 60_000,
  when = true,
}) {
  const shouldRun = when && !interrupted;
  const phase = {
    id,
    label,
    command: `${program} ${args.join(" ")}`,
    status: shouldRun ? "running" : "skipped",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: null,
    log: shouldRun ? `logs/${safeArtifactName(id)}.log` : null,
  };
  phases.push(phase);
  if (!shouldRun) {
    console.log(`\n[SKIP] ${label}`);
    return phase;
  }

  console.log(`\n[RUN] ${label}`);
  const phaseStarted = Date.now();
  const logPath = path.join(artifactDir, phase.log);
  const log = createWriteStream(logPath, { flags: "w" });
  const invocation = commandFor(program, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: workspaceDir,
    env: testEnvironment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    await stopProcessTree(child);
  }, timeoutMs);

  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
  }

  const exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      log.write(`\n${error.stack ?? error.message}\n`);
      resolve(-1);
    });
    child.once("exit", (code) => resolve(code ?? -1));
  });
  clearTimeout(timer);
  children.delete(child);
  log.end();
  phase.durationMs = Date.now() - phaseStarted;
  phase.exitCode = exitCode;
  phase.status = timedOut ? "failed" : exitCode === 0 ? "passed" : "failed";
  if (timedOut)
    phase.error = `Tidsgränsen ${Math.round(timeoutMs / 60_000)} minuter överskreds.`;
  console.log(
    `[${phase.status.toUpperCase()}] ${label} (${formatDuration(phase.durationMs)})`,
  );
  return phase;
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory()
      ? await directorySize(target)
      : (await stat(target)).size;
  }
  return total;
}

async function purgeOldFailureBundles(currentId) {
  const candidates = [];
  for (const entry of await readdir(stabilityDir, {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name === currentId) continue;
    const target = path.join(stabilityDir, entry.name);
    const info = await stat(target);
    candidates.push({
      target,
      modified: info.mtimeMs,
      size: await directorySize(target),
    });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  let retainedBytes = 0;
  const maxAge = Date.now() - 14 * 24 * 60 * 60_000;
  for (const [index, candidate] of candidates.entries()) {
    retainedBytes += candidate.size;
    if (
      index >= 2 ||
      candidate.modified < maxAge ||
      retainedBytes > 500 * 1024 * 1024
    ) {
      await rm(candidate.target, { recursive: true, force: true });
    }
  }
}

function toolVersion(program, args = ["--version"]) {
  const result = spawnSync(program, args, {
    cwd: workspaceDir,
    encoding: "utf8",
    windowsHide: true,
  });
  return (result.stdout || result.stderr || "unavailable")
    .trim()
    .split(/\r?\n/)[0];
}

function gpuDescription() {
  if (process.platform !== "win32") return "not collected";
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '; '",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  return result.status === 0
    ? result.stdout.trim() || "unknown"
    : "unavailable";
}

function createSummary(status, finishedAt, cleanup) {
  const counts = {
    passed: phases.filter((phase) => phase.status === "passed").length,
    failed: phases.filter((phase) => phase.status === "failed").length,
    skipped: phases.filter((phase) => phase.status === "skipped").length,
    flaky: 0,
  };
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    counts,
    environment: {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      appVersion: packageJson.version,
      node: process.version,
      pnpm: toolVersion(process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
      rust: toolVersion("rustc"),
      cargo: toolVersion("cargo"),
      cpu: `${os.cpus()[0]?.model ?? "unknown"} (${os.cpus().length} threads)`,
      memoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      gpu: gpuDescription(),
      testRoot,
    },
    isolation: {
      enabled: true,
      externalServicesDisabled: true,
      database: "lectio-assets-stability",
      appData: path.join(testRoot, "appdata"),
      syncSandbox: path.join(testRoot, "sync-sandbox"),
      credentials: "disabled",
    },
    cleanup,
    phases: phases.map((phase) => ({
      ...phase,
      log: status === "READY" ? null : phase.log,
    })),
  };
}

function summaryMarkdown(summary) {
  const rows = summary.phases
    .map(
      (phase) =>
        `| ${phase.label} | ${phase.status} | ${formatDuration(phase.durationMs)} | ${phase.log ? `[logg](${phase.log.replaceAll("\\", "/")})` : "–"} |`,
    )
    .join("\n");
  return (
    `# Lectio stability QA\n\n**${summary.status}** · ${summary.runId} · ${formatDuration(summary.durationMs)}\n\n` +
    `Passed ${summary.counts.passed} · Failed ${summary.counts.failed} · Skipped ${summary.counts.skipped} · Flaky ${summary.counts.flaky}\n\n` +
    `| Fas | Resultat | Tid | Artefakt |\n| --- | --- | ---: | --- |\n${rows}\n\n` +
    `## Miljö\n\n- App: ${summary.environment.appVersion}\n- OS: ${summary.environment.os}\n- Node: ${summary.environment.node}\n- Rust: ${summary.environment.rust}\n- CPU: ${summary.environment.cpu}\n- GPU: ${summary.environment.gpu}\n\n` +
    `## Isolering och städning\n\n- Riktiga externa tjänster: avstängda\n- Separat databas: ${summary.isolation.database}\n- Temporär testrot borttagen: ${summary.cleanup.testRootRemoved ? "ja" : "nej"}\n- Kvarvarande child-processer: ${summary.cleanup.remainingChildProcesses}\n`
  );
}

let finalStatus = "BLOCKED";
let summary;
try {
  await runPhase({
    id: "isolation-safety",
    label: "Isoleringsskydd",
    program: "node",
    args: ["--test", "scripts/stability-lib.test.mjs"],
    timeoutMs: 60_000,
  });
  await runPhase({
    id: "lint",
    label: "Lint",
    program: "pnpm",
    args: ["lint"],
  });
  await runPhase({
    id: "unit",
    label: "Vitest",
    program: "pnpm",
    args: ["test"],
  });
  const build = await runPhase({
    id: "build",
    label: "TypeScript och Vite-build",
    program: "pnpm",
    args: ["build"],
  });
  await runPhase({
    id: "rust-format",
    label: "Rust-formatkontroll",
    program: "cargo",
    args: ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"],
  });
  await runPhase({
    id: "rust-check",
    label: "Cargo check",
    program: "cargo",
    args: ["check", "--manifest-path", "src-tauri/Cargo.toml"],
    timeoutMs: 15 * 60_000,
  });
  await runPhase({
    id: "rust-test",
    label: "Cargo test",
    program: "cargo",
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml"],
    timeoutMs: 15 * 60_000,
  });
  await runPhase({
    id: "playwright",
    label: "Playwright-regressioner",
    program: "pnpm",
    args: ["test:e2e"],
    timeoutMs: 15 * 60_000,
  });
  await runPhase({
    id: "lighthouse",
    label: "Lighthouse",
    program: "pnpm",
    args: ["qa:lighthouse"],
    timeoutMs: 5 * 60_000,
    when: build.status === "passed",
  });
  await runPhase({
    id: "desktop",
    label: "Tauri desktop-E2E",
    program: "pnpm",
    args: ["qa:desktop"],
    timeoutMs: 25 * 60_000,
    when: process.platform === "win32",
  });
  finalStatus = phases.some((phase) => phase.status === "failed")
    ? "BLOCKED"
    : phases.some((phase) => phase.status === "skipped")
      ? "WARNINGS"
      : "READY";
} finally {
  await cleanupChildren();
  const appLogs = path.join(testRoot, "appdata", "logs");
  if (
    finalStatus !== "READY" &&
    (await stat(appLogs)
      .then(() => true)
      .catch(() => false))
  ) {
    await cp(appLogs, path.join(artifactDir, "app-logs"), { recursive: true });
  }
  await rm(testRoot, { recursive: true, force: true });
  const cleanup = {
    testRootRemoved: !(await stat(testRoot)
      .then(() => true)
      .catch(() => false)),
    remainingChildProcesses: children.size,
    retainedFailureBundle: finalStatus !== "READY",
  };
  summary = createSummary(
    interrupted ? "BLOCKED" : finalStatus,
    new Date(),
    cleanup,
  );
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactDir, "summary.md"),
    summaryMarkdown(summary),
    "utf8",
  );
  await mkdir(stabilityDir, { recursive: true });
  await writeFile(
    path.join(stabilityDir, "latest-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(stabilityDir, "latest-summary.md"),
    summaryMarkdown(summary),
    "utf8",
  );
  if (summary.status === "READY") {
    await rm(artifactDir, { recursive: true, force: true });
  }
  await purgeOldFailureBundles(summary.status === "READY" ? "" : runId);
}

console.log(
  `\n${summary.status}: ${summary.counts.passed} godkända, ${summary.counts.failed} misslyckade, ${summary.counts.skipped} överhoppade.`,
);
console.log(`Rapport: ${path.join(stabilityDir, "latest-summary.md")}`);
if (summary.status === "BLOCKED") process.exitCode = 1;
