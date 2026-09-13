import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = process.cwd();
const violations = [];

function sourceFiles(directory) {
  if (!statSync(directory).isDirectory()) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.[cm]?[jt]sx?$/.test(entry)
        ? [path]
        : [];
  });
}

for (const file of sourceFiles(join(projectRoot, "src", "services"))) {
  const source = readFileSync(file, "utf8");
  if (/from\s+["'][^"']*core\/store["']/.test(source))
    violations.push(
      `${relative(projectRoot, file)} imports the concrete Zustand store`,
    );
}

for (const file of sourceFiles(join(projectRoot, "src", "application"))) {
  if (/\.test\.[cm]?[jt]sx?$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  if (
    /from\s+["'][^"']*(react|zustand|radix|@tauri-apps|\.css)["']/.test(source)
  )
    violations.push(
      `${relative(projectRoot, file)} makes the headless application layer framework-dependent`,
    );
}

for (const file of sourceFiles(join(projectRoot, "src", "frontends"))) {
  const source = readFileSync(file, "utf8");
  if (
    /from\s+["'][^"']*(core\/store|core\/database|services\/|infrastructure\/|src-tauri|@tauri-apps)["']/.test(
      source,
    )
  )
    violations.push(
      `${relative(projectRoot, file)} bypasses the public LectioClient contract`,
    );
}

for (const file of sourceFiles(join(projectRoot, "src", "infrastructure"))) {
  const source = readFileSync(file, "utf8");
  if (/from\s+["'][^"']*frontends\//.test(source))
    violations.push(
      `${relative(projectRoot, file)} imports a frontend from infrastructure`,
    );
}

if (violations.length) {
  console.error("State boundary violations:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("State boundaries: OK");
