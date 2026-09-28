import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilityDir = path.join(root, "src-tauri/capabilities");
const capabilities = await Promise.all(
  (await readdir(capabilityDir))
    .filter((name) => name.endsWith(".json"))
    .map(async (name) =>
      JSON.parse(await readFile(path.join(capabilityDir, name), "utf8")),
    ),
);
const capability = capabilities.find((item) => item.identifier === "default");
const tauri = JSON.parse(
  await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
);

test("Tauri capability is limited to the main application window", () => {
  assert.ok(capability);
  assert.ok(capabilities.length > 0);
  for (const item of capabilities) {
    assert.deepEqual(item.windows, ["main"]);
    assert.equal(item.remote, undefined);
  }
  assert.equal(tauri.app.security.capabilities, undefined);
});

test("HTTP plugin scopes stay within required local and provider endpoints", () => {
  const http = capability.permissions.find(
    (permission) =>
      typeof permission === "object" &&
      permission.identifier === "http:default",
  );
  assert.ok(http, "explicit HTTP permission scope is required");
  assert.ok(Array.isArray(http.allow));

  const allowedHosts = new Set([
    "127.0.0.1",
    "localhost",
    "www.googleapis.com",
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.groq.com",
  ]);
  for (const rule of http.allow) {
    const url = new URL(rule.url);
    assert.ok(
      allowedHosts.has(url.hostname),
      `unexpected HTTP host: ${url.hostname}`,
    );
    assert.ok(
      !url.username && !url.password,
      "URL scopes must not embed credentials",
    );
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      assert.equal(url.protocol, "http:");
      assert.ok(["8765", "11434"].includes(url.port));
      assert.equal(url.pathname, "/");
    } else {
      assert.equal(url.protocol, "https:");
      assert.equal(url.pathname, "/*");
    }
  }
});

test("production CSP only allows the app's required network endpoints", () => {
  const directives = new Map(
    tauri.app.security.csp
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name, values]),
  );
  const connect = directives.get("connect-src");
  assert.ok(connect, "CSP must define connect-src explicitly");

  const allowedOrigins = new Set([
    "ipc:",
    "http://ipc.localhost",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "https://www.googleapis.com",
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://generativelanguage.googleapis.com",
    "https://api.groq.com",
  ]);
  assert.ok(connect.every((origin) => allowedOrigins.has(origin)));
  for (const origin of allowedOrigins) assert.ok(connect.includes(origin));
  assert.ok(!connect.includes("https:"), "CSP must not allow arbitrary HTTPS hosts");
  assert.ok(!connect.includes("*"), "CSP must not use wildcard network hosts");
  assert.ok(
    !(directives.get("script-src") ?? []).some((value) =>
      value.includes("unsafe-") || value === "*",
    ),
    "scripts must not allow unsafe execution or wildcard sources",
  );
});

test("filesystem permissions remain scoped to Lectio app data", () => {
  const fsPermissions = capability.permissions.filter(
    (permission) =>
      typeof permission === "string" && permission.startsWith("fs:"),
  );
  assert.ok(
    fsPermissions.length > 0,
    "filesystem permissions must be explicit",
  );
  assert.ok(
    fsPermissions.every((permission) => permission.includes("appdata")),
  );
  assert.ok(
    !fsPermissions.some((permission) =>
      /(?:^|[-:])(home|desktop|documents|download|all)(?:[-:]|$)/i.test(
        permission,
      ),
    ),
  );
});
