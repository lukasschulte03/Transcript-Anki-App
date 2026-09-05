import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

/**
 * Secrets are deliberately kept outside Zustand and IndexedDB. In the
 * desktop app Windows Credential Manager encrypts and scopes them to the
 * current Windows account; the browser preview never persists them.
 */
export async function readCredential(key: string) {
  if (!isTauri()) return null;
  return invoke<string | null>("read_credential", { key });
}

export async function writeCredential(key: string, secret: string) {
  if (!isTauri()) throw new Error("Säker nyckellagring kräver desktopappen.");
  return invoke<void>("write_credential", { key, secret });
}

export async function deleteCredential(key: string) {
  if (!isTauri()) return;
  return invoke<void>("delete_credential", { key });
}
