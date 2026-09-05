import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const developmentUrl = "http://localhost:1420/";
const expectedEntry = 'src="/src/main.tsx"';

async function existingLectioServer() {
  try {
    const response = await fetch(developmentUrl, {
      signal: AbortSignal.timeout(1_000),
    });
    const html = await response.text();
    return response.ok && html.includes(expectedEntry);
  } catch {
    return false;
  }
}

async function portIsInUse() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "localhost", port: 1420 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (await existingLectioServer()) {
  console.log("[Lectio] Återanvänder Vite på port 1420.");
  process.exit(0);
}

if (await portIsInUse()) {
  console.error(
    "[Lectio] Port 1420 används av en annan server. Stoppa den processen eller starta om den här Lectio-Vite-servern.",
  );
  process.exit(1);
}

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => vite.kill(signal));
}

vite.once("exit", (code) => process.exit(code ?? 1));
