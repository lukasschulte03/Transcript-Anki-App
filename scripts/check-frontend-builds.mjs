import { spawnSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspace = process.cwd();
const outputRoot = path.join(workspace, "test-results", "frontend-builds");

async function javascript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return javascript(target);
      return entry.name.endsWith(".js") || entry.name.endsWith(".mjs")
        ? readFile(target, "utf8")
        : "";
    }),
  );
  return chunks.join("\n");
}

function build(variant) {
  const outDir = path.join(outputRoot, variant);
  const result = spawnSync(
    process.execPath,
    [
      path.join(workspace, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--outDir",
      outDir,
      "--emptyOutDir",
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        LECTIO_FRONTEND: variant,
        LECTIO_DATA_PROFILE: variant === "next" ? "next" : "main",
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(
      result.error?.message ||
        result.stderr ||
        result.stdout ||
        `${variant} build failed`,
    );
  return outDir;
}

await rm(outputRoot, { recursive: true, force: true });
try {
  const legacySource = await javascript(build("legacy"));
  const nextSource = await javascript(build("next"));
  if (!legacySource.includes("Öppnar ditt bibliotek"))
    throw new Error("Legacy-entrypointen saknas i legacy-bundlen.");
  if (legacySource.includes("next-tree-row-selected"))
    throw new Error("Next-frontenden läckte in i legacy-bundlen.");
  if (!nextSource.includes("next-tree-row-selected"))
    throw new Error("Next-entrypointen saknas i Next-bundlen.");
  if (nextSource.includes("Öppnar ditt bibliotek"))
    throw new Error("Legacy-frontenden läckte in i Next-bundlen.");
  console.log("Frontend bundles: isolated");
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
