import type { AppSettings, LibraryNode } from "../core/types";
import { netFetch } from "./platform";

export interface TranscriptionResult {
  segments: {
    start: number;
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
  }[];
}
export interface TranscriptionProvider {
  id: string;
  transcribe(
    audio: Blob,
    settings: AppSettings,
    apiKey: string,
    prompt?: string,
  ): Promise<TranscriptionResult>;
}

export function buildTranscriptionPrompt(
  nodes: LibraryNode[],
  lectureId: string,
  glossary?: string,
) {
  const chain: LibraryNode[] = [];
  let current = nodes.find((node) => node.id === lectureId);
  while (current) {
    chain.unshift(current);
    current = current.parentId
      ? nodes.find((node) => node.id === current?.parentId)
      : undefined;
  }
  const sections = [
    (glossary ?? "").trim(),
    ...chain
      .reverse()
      .map((node) =>
        (node.context ?? "").trim()
          ? `${node.title}: ${(node.context ?? "").trim()}`
          : "",
      ),
  ].filter(Boolean);
  return sections.join("\n").slice(0, 1_200);
}

export const cloudApiTranscription: TranscriptionProvider = {
  id: "cloud-api",
  async transcribe(audio, settings, apiKey, prompt = "") {
    const base = settings.transcriptionBaseUrl.replace(/\/$/, "");
    const form = new FormData();
    form.append("file", audio, "lecture.webm");
    form.append("model", settings.transcriptionModel);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (prompt.trim()) form.append("prompt", prompt);
    const response = await netFetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok)
      throw new Error(
        `Transkriptionsfel ${response.status}: ${await response.text()}`,
      );
    const data = await response.json();
    if (Array.isArray(data.segments))
      return {
        segments: data.segments.map((s: any) => ({
          start: Number(s.start),
          end: Number(s.end),
          text: String(s.text),
          confidence: s.confidence,
        })),
      };
    return { segments: [{ start: 0, end: 0, text: String(data.text ?? "") }] };
  },
};

export function parseTimestampedText(text: string): TranscriptionResult {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const segments = lines.map((line, index) => {
    const match = line.match(
      /^\s*\[?(?:(\d+):)?(\d{1,2}):(\d{2})(?:\s*[-–>]\s*(?:(\d+):)?(\d{1,2}):(\d{2}))?\]?\s*(.*)$/,
    );
    if (!match)
      return { start: index * 10, end: (index + 1) * 10, text: line.trim() };
    const start =
      Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    const end = match[5]
      ? Number(match[4] ?? 0) * 3600 + Number(match[5]) * 60 + Number(match[6])
      : start + 10;
    return { start, end, text: match[7].trim() };
  });
  return { segments };
}
