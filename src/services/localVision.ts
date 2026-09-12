import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "./diagnosticLog";
import { isTauri } from "./platform";

export type LocalVisionStatus = {
  nvidiaDetected: boolean;
  nvidiaName: string | null;
  nvidiaVramTotalMb: number | null;
  runtimeInstalled: boolean;
  modelInstalled: boolean;
  ready: boolean;
};

export type VisualDescriptionProvider = {
  id: "local-nvidia";
  label: string;
  describe(
    image: Blob,
    signal?: AbortSignal,
    context?: string,
  ): Promise<{ description: string; keywords: string[] }>;
};

export async function getLocalVisionStatus(): Promise<LocalVisionStatus> {
  if (!isTauri()) return {
    nvidiaDetected: false,
    nvidiaName: null,
    nvidiaVramTotalMb: null,
    runtimeInstalled: false,
    modelInstalled: false,
    ready: false,
  };
  return invoke<LocalVisionStatus>("local_vision_status");
}

export async function installLocalVisionModel() {
  if (!isTauri()) throw new Error("Automatiska bilder kräver desktopappen.");
  return invoke<LocalVisionStatus>("install_local_vision_model");
}

const asBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(value);
};

export const parseVisionResult = (raw: string) => {
  const stripped = raw.trim().replace(/^```json\s*|```$/gim, "");
  // llama.cpp may echo the prompt, which itself contains our JSON schema. Scan
  // every shallow object and prefer the final valid response instead of joining
  // prompt text and model output into one invalid JSON string.
  const objects = stripped.match(/\{[^{}]*\}/g) ?? [stripped];
  for (const object of [...objects].reverse()) {
    try {
      const parsed = JSON.parse(object) as { description?: unknown; keywords?: unknown };
      const description = String(parsed.description ?? "").replace(/\s+/g, " ").trim();
      const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12)
        : [];
      if (description) return { description: conciseDescription(description), keywords };
    } catch {
      // Keep searching: console output and an echoed schema are expected.
    }
  }
  return { description: conciseDescription(stripped), keywords: [] };
};

/** The local model can be verbose; a short first sentence is enough as visual context for Anki. */
function conciseDescription(value: string, limit = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sentence = clean.slice(0, limit + 1).match(/^.*?[.!?](?:\s|$)/)?.[0];
  if (sentence?.trim()) return sentence.trim();
  const boundary = clean.lastIndexOf(" ", limit);
  return `${clean.slice(0, boundary > 70 ? boundary : limit).trim()}…`;
}

export const localNvidiaVisionProvider: VisualDescriptionProvider = {
  id: "local-nvidia",
  label: "Automatisk lokal Nvidia-bildmotor",
  async describe(image, signal, context = "") {
    if (signal?.aborted) throw new DOMException("Avbruten", "AbortError");
    if (!image.size) throw new Error("Bildutklippet saknar bilddata.");
    const result = await invoke<{ description?: string; keywords?: string[] }>(
      "describe_local_visual",
      { imageBase64: await asBase64(image), context },
    ).catch((error) => {
      const message = `Den lokala Nvidia-bildmotorn kunde inte beskriva bilden: ${String(error)}`;
      logDiagnostic("vision", message, { level: "error" });
      throw new Error(message);
    });
    if (signal?.aborted) throw new DOMException("Avbruten", "AbortError");
    const parsed = parseVisionResult(JSON.stringify(result));
    if (!parsed.description) throw new Error("Den lokala visionsmodellen gav ingen beskrivning.");
    return parsed;
  },
};
