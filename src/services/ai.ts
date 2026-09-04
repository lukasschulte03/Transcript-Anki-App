import { z } from "zod";
import type {
  AppSettings,
  CardType,
  Flashcard,
  Marker,
  TranscriptSegment,
} from "../core/types";
import { netFetch } from "./platform";

const cardSchema = z.object({
  type: z
    .enum(["basic", "cloze", "concept", "definition", "problem"])
    .default("basic"),
  front: z.string().min(1),
  back: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
const responseSchema = z.object({ cards: z.array(cardSchema) });

export interface CardRequest {
  lectureId: string;
  title: string;
  context: string;
  notes: string;
  transcript: TranscriptSegment[];
  markers: Marker[];
  slideText: string;
  count: number;
  types: CardType[];
  preferences: string[];
  cardStyle?: string;
}

export function createCardPrompt(r: CardRequest) {
  const extraRules = [
    ...r.preferences.map((preference) => `- ${preference}`),
    ...(r.cardStyle ? [`- Följ denna lokala kortstil: ${r.cardStyle}`] : []),
  ].join("\n");
  return `Du är en noggrann studieassistent. Skapa ${r.count} högkvalitativa Anki-kort på svenska.\n\nREGLER:\n- Ett koncept per kort.\n- Undvik triviala och duplicerade kort.\n- Prioritera förståelse, examinationsrelevans och markerade moment.\n- Svara ENDAST med giltig JSON enligt: {"cards":[{"type":"basic|cloze|concept|definition|problem","front":"...","back":"...","tags":["..."]}]}\n- Tillåtna korttyper: ${r.types.join(", ")}.\n${extraRules}\n\nFÖRELÄSNING: ${r.title}\n\nÄRVD KONTEXT:\n${r.context || "(ingen)"}\n\nANTECKNINGAR:\n${r.notes || "(inga)"}\n\nMARKERADE MOMENT:\n${r.markers.map((m) => `${m.time}s: ${m.note || "Viktigt moment"}`).join("\n") || "(inga)"}\n\nTEXT FRÅN SLIDES:\n${r.slideText || "(ingen slide-text)"}\n\nTRANSKRIPT:\n${r.transcript.map((s) => `[${s.start}-${s.end}s] ${s.text}`).join("\n") || "(inget transcript)"}`;
}

export function parseCardResponse(
  raw: string,
  lectureId: string,
): Omit<Flashcard, "id">[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const json =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
  const parsed = responseSchema.parse(JSON.parse(json));
  return parsed.cards.map((c) => ({
    ...c,
    lectureId,
    status: "generated" as const,
  }));
}

export async function generateCardsWithApi(
  prompt: string,
  settings: AppSettings,
  apiKey: string,
) {
  const base = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
  }[settings.aiProvider];
  if (settings.aiProvider === "anthropic") {
    const response = await netFetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings.aiModel,
        max_tokens: 8192,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok)
      throw new Error(`API-fel ${response.status}: ${await response.text()}`);
    const json = await response.json();
    return String(json.content?.[0]?.text ?? "");
  }
  if (settings.aiProvider === "gemini") {
    const response = await netFetch(
      `${base}/models/${encodeURIComponent(settings.aiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(`API-fel ${response.status}: ${await response.text()}`);
    const json = await response.json();
    return String(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  }
  const response = await netFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok)
    throw new Error(`API-fel ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return String(json.choices?.[0]?.message?.content ?? "");
}
