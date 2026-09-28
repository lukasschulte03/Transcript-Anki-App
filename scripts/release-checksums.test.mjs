import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReleaseChecksums } from "./release-checksums.mjs";

test("release checksums cover nested Windows installers and portable archives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lectio-checksum-test-"));
  try {
    await mkdir(path.join(root, "msi"));
    const exe = path.join(root, "nsis", "Lectio-setup.exe");
    const msi = path.join(root, "msi", "Lectio.msi");
    const zip = path.join(root, "Lectio-portable.zip");
    await mkdir(path.dirname(exe));
    await writeFile(exe, "fake exe bytes");
    await writeFile(msi, "fake msi bytes");
    await writeFile(zip, "fake zip bytes");

    const { manifestPath, artifactCount } = await createReleaseChecksums(root);
    const manifest = await readFile(manifestPath, "utf8");
    assert.equal(artifactCount, 3);
    for (const [file, relative] of [
      [exe, "nsis/Lectio-setup.exe"],
      [msi, "msi/Lectio.msi"],
      [zip, "Lectio-portable.zip"],
    ]) {
      const expected = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
      assert.ok(manifest.includes(`${expected}  ${relative}`));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release checksum generation fails clearly when no installer exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lectio-checksum-empty-"));
  try {
    await assert.rejects(createReleaseChecksums(root), /Inga \.exe, \.msi eller \.zip/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release checksums only include artifacts matching the requested version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lectio-checksum-version-"));
  try {
    const current = path.join(root, "msi", "Lectio_0.4.13_x64_en-US.msi");
    const old = path.join(root, "nsis", "Lectio_0.4.12_x64-setup.exe");
    await mkdir(path.dirname(current), { recursive: true });
    await mkdir(path.dirname(old), { recursive: true });
    await writeFile(current, "current release");
    await writeFile(old, "old release");

    const { manifestPath, artifactCount } = await createReleaseChecksums(root, "0.4.13");
    const manifest = await readFile(manifestPath, "utf8");
    assert.equal(artifactCount, 1);
    assert.match(manifest, /Lectio_0\.4\.13_x64_en-US\.msi/);
    assert.doesNotMatch(manifest, /0\.4\.12/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
