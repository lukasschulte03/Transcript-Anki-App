import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const port = 4174;
const url = `http://127.0.0.1:${port}`;
const outputDir = "test-results/lighthouse";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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

const server = spawn(pnpmCommand, ["vite", "preview", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: "pipe",
  windowsHide: true,
  shell: process.platform === "win32",
});
try {
  await waitForServer();
  await mkdir(outputDir, { recursive: true });
  const lighthouseExitCode = await new Promise((resolve, reject) => {
    const lighthouse = spawn(
      pnpmCommand,
      [
        "exec",
        "lighthouse",
        url,
        "--output=json",
        `--output-path=${outputDir}/report.json`,
        "--only-categories=performance",
        "--only-categories=accessibility",
        "--only-categories=best-practices",
        "--chrome-flags=--headless=new --no-sandbox",
        "--quiet",
      ],
      { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" },
    );
    lighthouse.once("error", reject);
    lighthouse.once("exit", resolve);
  });
  let lhr;
  try {
    lhr = JSON.parse(await readFile(`${outputDir}/report.json`, "utf8"));
  } catch {
    throw new Error(`Lighthouse avslutades med kod ${lighthouseExitCode} utan att skapa en rapport.`);
  }
  if (lighthouseExitCode !== 0)
    console.warn(`Lighthouse skapade en rapport men avslutades med kod ${lighthouseExitCode}; vanligt vid Windows-rensning av Chromes temporära profil.`);
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
