import path from "node:path";

export const STABILITY_FOLDER = "lectio-stability";

function normalize(candidate) {
  return path
    .resolve(candidate)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

export function assertSafeStabilityRoot(candidate, options) {
  const resolved = path.resolve(candidate);
  const normalized = normalize(resolved);
  const allowedParent = normalize(path.join(options.tempDir, STABILITY_FOLDER));
  const forbidden = [
    options.tempDir,
    options.homeDir,
    options.workspaceDir,
    options.regularAppDataDir,
    path.parse(resolved).root,
  ]
    .filter(Boolean)
    .map(normalize);

  if (forbidden.includes(normalized)) {
    throw new Error(`Osäker stability-testrot: ${resolved}`);
  }
  if (!normalized.startsWith(`${allowedParent}${path.sep}`)) {
    throw new Error(`Testroten måste ligga under ${allowedParent}`);
  }
  const relative = path.relative(
    path.join(options.tempDir, STABILITY_FOLDER),
    resolved,
  );
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Testroten saknar ett unikt run-id: ${resolved}`);
  }
  return resolved;
}

export function safeArtifactName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
