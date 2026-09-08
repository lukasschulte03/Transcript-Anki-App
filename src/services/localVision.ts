import { invoke } from "@tauri-apps/api/core";
import { isTauri, netFetch } from "./platform";

export const LOCAL_VISION_MODEL = "moondream";

export type LocalVisionStatus = {
  ollamaInstalled: boolean;
  modelInstalled: boolean;
};

export type VisualDescriptionProvider = {
  id: "local-ollama";
  label: string;
  describe(image: Blob, signal?: AbortSignal): Promise<{ description: string; keywords: string[] }>;
};

export async function getLocalVisionStatus(): Promise<LocalVisionStatus> {
  if (!isTauri()) return { ollamaInstalled: false, modelInstalled: false };
  return invoke<LocalVisionStatus>("local_vision_status");
}

export async function installLocalVisionModel() {
  if (!isTauri()) throw new Error("Lokal bildbeskrivning kräver desktopappen.");
  return invoke<LocalVisionStatus>("install_local_vision_model");
}

const asBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(value);
};

const parseResult = (raw: string) => {
  const normalized = raw.trim().replace(/^```json\s*|```$/gim, "");
  try {
    const parsed = JSON.parse(normalized) as { description?: unknown; keywords?: unknown };
    const description = String(parsed.description ?? "").replace(/\s+/g, " ").trim();
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12)
      : [];
    if (description) return { description, keywords };
  } catch {
    // A concise plain-text fall-back is safer than throwing away a useful local result.
  }
  return { description: normalized.replace(/\s+/g, " ").slice(0, 360), keywords: [] };
};

export const localOllamaVisionProvider: VisualDescriptionProvider = {
  id: "local-ollama",
  label: "Lokal Moondream",
  async describe(image, signal) {
    const response = await netFetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_VISION_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        prompt: "Beskriv endast bildens pedagogiskt viktiga innehåll på svenska. Gissa inte diagnoser eller detaljer som inte syns. Svara som JSON: {\\\"description\\\":\\\"kort beskrivning\\\",\\\"keywords\\\":[\\\"nyckelord\\\"]}.",
        images: [await asBase64(image)],
      }),
    });
    if (!response.ok) throw new Error(`Den lokala visionsmotorn svarade ${response.status}.`);
    const body = await response.json() as { response?: string };
    const result = parseResult(String(body.response ?? ""));
    if (!result.description) throw new Error("Den lokala visionsmodellen gav ingen beskrivning.");
    return result;
  },
};
