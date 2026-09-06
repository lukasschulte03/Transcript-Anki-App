import { invoke } from "@tauri-apps/api/core";
import type { CloudSyncConfiguration, CloudSyncProvider } from "../core/types";
import { isTauri, openExternal } from "./platform";

/** Contract for direct OAuth providers. Tokens belong in the OS credential store. */
export interface SyncProvider {
  id: CloudSyncProvider;
  label: string;
  authorization: "oauth";
  connect(configuration: CloudSyncConfiguration): Promise<CloudSyncConfiguration>;
}

export const syncProviderOptions: Array<{
  id: CloudSyncProvider;
  label: string;
  description: string;
}> = [
  { id: "onedrive", label: "OneDrive", description: "Logga in direkt i Lectio. Ingen OneDrive-app eller lokal synkmapp behövs." },
  { id: "google-drive", label: "Google Drive", description: "Logga in direkt i Lectio. Ditt Google Drive används utan separat desktop-app." },
  { id: "dropbox", label: "Dropbox", description: "Logga in direkt i Lectio. Ditt Dropbox-konto används utan separat desktop-app." },
];

interface GoogleOAuthStart {
  sessionId: string;
  authorizationUrl: string;
}

interface GoogleDriveConnection {
  accountLabel: string;
  connectedAt: string;
}

export function syncErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

/** Opens the system browser and completes a PKCE OAuth flow via localhost. */
export async function connectGoogleDrive(): Promise<GoogleDriveConnection> {
  if (!isTauri())
    throw new Error("Google Drive kan bara kopplas i Lectios desktopapp.");
  const start = await invoke<GoogleOAuthStart>("start_google_drive_oauth");
  await openExternal(start.authorizationUrl);
  return invoke<GoogleDriveConnection>("complete_google_drive_oauth", {
    sessionId: start.sessionId,
  });
}

export async function disconnectGoogleDrive() {
  if (!isTauri()) return;
  await invoke<void>("disconnect_google_drive");
}
