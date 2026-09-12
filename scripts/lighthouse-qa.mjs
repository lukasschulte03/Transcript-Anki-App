import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const port = process.env.LECTIO_TEST_MODE === "1" ? 4200 + (process.pid % 500) : 4174;
const url = `http://127.0.0.1:${port}`;
const outputDir = process.env.LECTIO_QA_OUTPUT_DIR
  ? path.join(process.env.LECTIO_QA_OUTPUT_DIR, "lighthouse")
  : "test-results/lighthouse";
const require = createRequire(import.meta.url);
const viteCli = path.resolve(path.dirname(require.resolve("vite")), "../../bin/vite.js");
const lighthouseCli = path.resolve(path.dirname(require.resolve("lighthouse")), "../cli/index.js");

function waitForExit(child, label, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} överskred ${Math.round(timeoutMs / 1_000)} sekunder.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

function waitForServer(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(url);
        if (response.ok) {
          clearInterval(timer);
          resolve();
        }
      } catch {
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          reject(new Error("Vite startade inte inom 30 sekunder."));
        }
      }
    }, 250);
  });
}

const server = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: "pipe",
  windowsHide: true,
});
try {
  await waitForServer();
  await mkdir(outputDir, { recursive: true });
  const lighthouse = spawn(
    process.execPath,
    [
      lighthouseCli,
      url,
      "--output=json",
      `--output-path=${path.join(outputDir, "report.json")}`,
      "--only-categories=performance",
      "--only-categories=accessibility",
      "--only-categories=best-practices",
      "--chrome-flags=--headless=new --no-sandbox",
      "--quiet",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  let lighthouseErrorOutput = "";
  lighthouse.stderr.on("data", (chunk) => {
    lighthouseErrorOutput += String(chunk);
  });
  const lighthouseExitCode = await waitForExit(lighthouse, "Lighthouse");
  let lhr;
  try {
    lhr = JSON.parse(await readFile(`${outputDir}/report.json`, "utf8"));
  } catch {
    throw new Error(`Lighthouse avslutades med kod ${lighthouseExitCode} utan att skapa en rapport.`);
  }
  if (lighthouseExitCode !== 0 && !/EPERM, Permission denied/.test(lighthouseErrorOutput))
    console.warn(`Lighthouse skapade en rapport men avslutades med kod ${lighthouseExitCode}: ${lighthouseErrorOutput.trim()}`);
  const scores = Object.fromEntries(
    Object.entries(lhr.categories).map(([id, category]) => [id, Math.round(category.score * 100)]),
  );
  console.log(`Lighthouse: prestanda ${scores.performance}, tillgänglighet ${scores.accessibility}, praxis ${scores["best-practices"]}`);
  const failed = Object.entries(scores).filter(([, score]) => score < 70);
  if (failed.length) {
    throw new Error(`Lighthouse-budget under 70: ${failed.map(([id, score]) => `${id}=${score}`).join(", ")}`);
  }
} finally {
  if (!server.killed) server.kill();
}
