import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_EXTENSIONS = new Set([".exe", ".msi", ".zip"]);

async function listReleaseArtifacts(directory, version) {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await listReleaseArtifacts(fullPath, version)));
    } else if (
      entry.isFile() &&
      RELEASE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
      (!version || entry.name.includes(version))
    ) {
      artifacts.push(fullPath);
    }
  }
  return artifacts.sort((a, b) => a.localeCompare(b));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

export async function createReleaseChecksums(bundleDirectory, version) {
  const root = path.resolve(bundleDirectory);
  const artifacts = await listReleaseArtifacts(root, version);
  if (artifacts.length === 0) {
    throw new Error(
      version
        ? `Inga .exe, .msi eller .zip-releasefiler för ${version} hittades i ${root}`
        : `Inga .exe, .msi eller .zip-releasefiler hittades i ${root}`,
    );
  }

  const lines = await Promise.all(
    artifacts.map(async (artifact) => {
      const relativePath = path.relative(root, artifact).split(path.sep).join("/");
      return `${await sha256File(artifact)}  ${relativePath}`;
    }),
  );
  const manifestPath = path.join(root, "SHA256SUMS.txt");
  await writeFile(manifestPath, `${lines.join("\n")}\n`, "utf8");
  return { manifestPath, artifactCount: artifacts.length };
}

async function main() {
  const bundleDirectory = path.resolve("src-tauri/target/release/bundle");
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const { manifestPath, artifactCount } =
    await createReleaseChecksums(bundleDirectory, version);
  console.log(
    `SHA-256-checksummor skapade för ${artifactCount} releasefiler: ${manifestPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
