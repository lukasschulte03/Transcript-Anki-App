import { isTauri as runtimeIsTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isStabilityTest = () =>
  import.meta.env.VITE_STABILITY_TEST === "true";

/** Use Tauri's public runtime check; internal globals are version-dependent. */
export const isTauri = () => typeof window !== "undefined" && runtimeIsTauri();

export function netFetch(input: string | URL | Request, init?: RequestInit) {
  // Vitest replaces fetch with an in-memory fake. Keep those contract tests
  // useful while blocking real providers in browser and desktop QA builds.
  if (isStabilityTest() && import.meta.env.MODE !== "test") {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = new URL(
      rawUrl,
      globalThis.location?.href ?? "http://127.0.0.1",
    );
    const loopbackFakeAllowed =
      url.hostname === "127.0.0.1" &&
      (
        globalThis as typeof globalThis & {
          __LECTIO_STABILITY_ALLOW_LOOPBACK__?: boolean;
        }
      ).__LECTIO_STABILITY_ALLOW_LOOPBACK__ === true;
    if (
      !loopbackFakeAllowed &&
      (!globalThis.location || url.origin !== globalThis.location.origin)
    ) {
      return Promise.reject(
        new Error("Externa nätverksanrop är avstängda i stability-testläget."),
      );
    }
  }
  return isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init);
}

export async function openExternal(url: string) {
  if (isStabilityTest()) return;
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
