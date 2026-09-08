import { isTauri as runtimeIsTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Use Tauri's public runtime check; internal globals are version-dependent. */
export const isTauri = () =>
  typeof window !== "undefined" && runtimeIsTauri();

export function netFetch(input: string | URL | Request, init?: RequestInit) {
  return isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init);
}

export async function openExternal(url: string) {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
