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
    if (!response.ok || !html.includes(expectedEntry)) return null;

    return {
      frontend: response.headers.get("x-lectio-frontend"),
      dataProfile: response.headers.get("x-lectio-data-profile"),
    };
  } catch {
    return null;
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

const expectedFrontend = process.env.LECTIO_FRONTEND ?? "legacy";
const expectedDataProfile =
  process.env.LECTIO_DATA_PROFILE ??
  (expectedFrontend === "next" ? "next" : "main");
const existingServer = await existingLectioServer();

if (existingServer) {
  if (
    existingServer.frontend === expectedFrontend &&
    existingServer.dataProfile === expectedDataProfile
  ) {
    console.log(
      `[Lectio] Återanvänder ${expectedFrontend}-Vite på port 1420.`,
    );
    process.exit(0);
  }

  const runningVariant = existingServer.frontend
    ? `${existingServer.frontend} (dataprofil: ${existingServer.dataProfile ?? "okänd"})`
    : "en äldre Lectio-server utan variantinformation";
  console.error(
    `[Lectio] Port 1420 används redan av ${runningVariant}. ` +
      `Stoppa den servern med Ctrl+C och kör sedan pnpm desktop:dev:${expectedFrontend}.`,
  );
  process.exit(1);
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
