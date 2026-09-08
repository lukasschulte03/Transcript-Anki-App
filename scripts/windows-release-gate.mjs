import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const fail = (message) => {
  console.error(`\nRELEASE GATE BLOCKED: ${message}`);
  process.exit(1);
};
const run = (command, args) => {
  // pnpm is a Windows .cmd shim. Commands/arguments here are fixed constants,
  // never user input, so shell dispatch is safe and works on clean Windows hosts.
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} misslyckades.`);
};

const packageJson = await readJson("package.json");
const tauri = await readJson("src-tauri/tauri.conf.json");
const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!packageJson.version || packageJson.version !== tauri.version || packageJson.version !== cargoVersion)
  fail(`Versionsnummer måste matcha: package=${packageJson.version}, tauri=${tauri.version}, cargo=${cargoVersion}.`);

for (const path of ["src-tauri/resources/whisper", "src-tauri/resources/ffmpeg", "src-tauri/capabilities/default.json"])
  await stat(path).catch(() => fail(`Saknar release-resurs: ${path}`));

const capabilities = await readJson("src-tauri/capabilities/default.json");
const permissions = JSON.stringify(capabilities.permissions);
for (const permission of ["opener:allow-open-url", "core:window:allow-close", "core:event:allow-listen"])
  if (!permissions.includes(permission)) fail(`Tauri-behörighet saknas: ${permission}.`);

console.log("Windows release-gate: versionsnummer, resurser och Tauri-behörigheter godkända.");
run("pnpm", ["lint"]);
run("pnpm", ["test"]);
run("pnpm", ["build"]);
console.log("\nAutomatiska kontroller godkända. Följ docs/WINDOWS_RELEASE_CHECKLIST.md innan extern publicering.");
