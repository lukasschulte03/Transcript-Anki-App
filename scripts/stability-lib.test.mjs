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
