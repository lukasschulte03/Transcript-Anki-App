import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, remove, writeFile } from "@tauri-apps/plugin-fs";
import { uid } from "../lib/utils";
import { isTauri } from "./platform";
import type { TranscriptionResult } from "./transcription";

export type LocalModel =
  "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3";
export type LocalAcceleration = "auto" | "cpu" | "nvidia";
export interface LocalModelStatus {
  model: LocalModel;
  installed: boolean;
  size: number;
  path: string;
}

export interface LocalEngineStatus {
  nvidiaDetected: boolean;
  nvidiaName: string | null;
  nvidiaRuntimeInstalled: boolean;
  nvidiaRuntimeSize: number;
}

export async function getLocalEngineStatus() {
  if (!isTauri())
    return {
      nvidiaDetected: false,
      nvidiaName: null,
      nvidiaRuntimeInstalled: false,
      nvidiaRuntimeSize: 0,
    } satisfies LocalEngineStatus;
  return invoke<LocalEngineStatus>("local_engine_status");
}

export async function installNvidiaRuntime() {
  if (!isTauri())
    throw new Error("NVIDIA-stöd kan bara installeras i desktopappen.");
  return invoke<LocalEngineStatus>("install_nvidia_runtime");
}

export async function removeNvidiaRuntime() {
  return invoke<void>("remove_nvidia_runtime");
}

export async function getLocalModelStatus(model: LocalModel) {
  if (!isTauri()) return { model, installed: false, size: 0, path: "" };
  return invoke<LocalModelStatus>("local_model_status", { model });
}

export async function downloadLocalModel(model: LocalModel) {
  if (!isTauri())
    throw new Error("Modeller kan bara installeras i desktopappen.");
  return invoke<LocalModelStatus>("download_local_model", { model });
}

export async function removeLocalModel(model: LocalModel) {
  return invoke<void>("remove_local_model", { model });
}

export async function transcribeWithLocalWhisper(
  audio: Blob,
  model: LocalModel,
  acceleration: LocalAcceleration = "auto",
  jobId = `transcription:${uid()}`,
  initialPrompt = "",
): Promise<TranscriptionResult> {
  if (!isTauri()) throw new Error("Lokal transkribering kräver desktopappen.");
  const directory = await join(await appDataDir(), "stt-input");
  await mkdir(directory, { recursive: true });
  const extension = audio.type.includes("mpeg")
    ? "mp3"
    : audio.type.includes("ogg")
      ? "ogg"
      : audio.type.includes("wav")
        ? "wav"
        : "webm";
  const inputPath = await join(directory, `${uid()}.${extension}`);
  await writeFile(inputPath, new Uint8Array(await audio.arrayBuffer()));
  try {
    const raw = await invoke<string>("transcribe_local", {
      inputPath,
      model,
      language: "auto",
      acceleration,
      jobId,
      initialPrompt: initialPrompt || null,
    });
    return parseWhisperJson(raw);
  } finally {
    await remove(inputPath).catch(() => undefined);
  }
}

export function parseWhisperJson(raw: string): TranscriptionResult {
  const parsed = JSON.parse(raw) as {
    transcription?: Array<{
      text?: string;
      offsets?: { from?: number; to?: number };
      timestamps?: { from?: string; to?: string };
    }>;
  };
  const segments = (parsed.transcription ?? [])
    .map((entry, index) => ({
      start: Number(entry.offsets?.from ?? index * 10_000) / 1000,
      end: Number(entry.offsets?.to ?? (index + 1) * 10_000) / 1000,
      text: String(entry.text ?? "").trim(),
    }))
    .filter((segment) => segment.text.length > 0);
  if (!segments.length) throw new Error("Whisper returnerade inget tal.");
  return { segments };
}
