import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertSafeStabilityRoot } from "./stability-lib.mjs";

const windows = {
  tempDir: "C:\\Users\\qa\\AppData\\Local\\Temp",
  homeDir: "C:\\Users\\qa",
  workspaceDir: "C:\\code\\lectio",
  regularAppDataDir: "C:\\Users\\qa\\AppData\\Roaming\\com.lectio.desktop",
};

test("accepts a unique run directory below the stability temp folder", () => {
  const root = path.join(
    windows.tempDir,
    "lectio-stability",
    "20260912-abc123",
  );
  assert.equal(assertSafeStabilityRoot(root, windows), path.resolve(root));
});

test("rejects path traversal that escapes the stability parent", () => {
  const candidate = path.join(
    windows.tempDir,
    "lectio-stability",
    "..",
    "outside-run",
  );
  assert.throws(
    () => assertSafeStabilityRoot(candidate, windows),
    /måste ligga/,
  );
});

test("rejects a sibling whose name only shares the stability prefix", () => {
  const candidate = path.join(windows.tempDir, "lectio-stability-escape", "run");
  assert.throws(
    () => assertSafeStabilityRoot(candidate, windows),
    /måste ligga/,
  );
});

test("treats forbidden Windows paths as case-insensitive", () => {
  const candidate = "c:\\users\\QA\\APPDATA\\ROAMING\\com.lectio.desktop";
  assert.throws(
    () => assertSafeStabilityRoot(candidate, windows),
    /Osäker/,
  );
});

for (const [label, candidate] of [
  ["temporary directory", windows.tempDir],
  ["home directory", windows.homeDir],
  ["workspace", windows.workspaceDir],
  ["regular appdata", windows.regularAppDataDir],
  [
    "stability parent without run id",
    path.join(windows.tempDir, "lectio-stability"),
  ],
  ["a sibling directory", path.join(windows.tempDir, "other-test", "run")],
]) {
  test(`rejects ${label}`, () => {
    assert.throws(
      () => assertSafeStabilityRoot(candidate, windows),
      /Osäker|måste ligga|run-id/,
    );
  });
}
