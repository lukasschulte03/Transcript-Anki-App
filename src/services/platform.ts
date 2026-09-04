import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export function netFetch(input: string | URL | Request, init?: RequestInit) {
  return isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init);
}

export async function openExternal(url: string) {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
