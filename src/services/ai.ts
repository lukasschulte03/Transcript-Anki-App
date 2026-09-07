import { z } from "zod";
import type {
  AppSettings,
  CardType,
  Flashcard,
  Marker,
  TranscriptSegment,
} from "../core/types";
import { netFetch } from "./platform";

export const aiModelSuggestions: Record<AppSettings["aiProvider"], readonly string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  custom: [],
};

const cardSchema = z.object({
  type: z
    .enum(["basic", "cloze", "concept", "definition", "problem"])
    .default("basic"),
  front: z.string().min(1),
  back: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
const responseSchema = z.object({ cards: z.array(cardSchema) });

async function providerError(response: Response) {
  const body = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
  return new Error(`API-fel ${response.status}${body ? `: ${body}` : ""}`);
}

function apiBaseUrl(settings: AppSettings) {
  const configured = settings.aiBaseUrl.trim().replace(/\/+$/, "");
  if (!settings.aiModel.trim()) throw new Error("Välj eller skriv ett modellnamn innan du genererar.");
  if (settings.aiProvider === "custom") {
    if (!configured) throw new Error("Ange en bas-URL för den OpenAI-kompatibla tjänsten.");
    try {
      new URL(configured);
    } catch {
      throw new Error("Bas-URL:en för AI-tjänsten är inte giltig.");
    }
    return configured;
  }
  return {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
  }[settings.aiProvider];
}

export interface CardRequest {
  lectureId: string;
  title: string;
  context: string;
  /** Explains which selected sources are complete versus partial. */
  sourceStatus?: string;
  notes: string;
  transcript: TranscriptSegment[];
  markers: Marker[];
  slideText: string;
  density?: "few" | "balanced" | "many";
  /** Technical ceiling derived from density; never a requested card quota. */
  count: number;
  types: CardType[];
  preferences: string[];
  cardStyle?: string;
  /** Compact course-level reference to prevent near-duplicate cards. */
  existingCards?: Array<Pick<Flashcard, "front" | "back">>;
}

/** Audio positions remain in Lectio for playback, but do not help AI card generation. */
export function transcriptTextForCardGeneration(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Keep this deliberately compact: inherited context and source material are the expensive parts. */
const CARD_PROMPT_VERSION = "1";
const cardTypeInstructions: Record<CardType, string> = {
  basic: "basic: en tydlig fråga och ett kort, exakt svar.",
  cloze: "cloze: front måste innehålla minst en giltig {{c1::...}}-markering; back förklarar kort.",
  concept: "concept: testa ett samband, en mekanism eller orsak–verkan med kort förklaring.",
  definition: "definition: testa en terms betydelse med tillräckligt sammanhang.",
  problem: "problem: testa en konkret tillämpning, beräkning eller ett beslut från underlaget.",
};

export function createCardPrompt(r: CardRequest) {
  const extraRules = [
    ...r.preferences.map((preference) => `- ${preference}`),
    ...(r.cardStyle ? [`- Följ denna lokala kortstil: ${r.cardStyle}`] : []),
  ].join("\n");
  const existingCards = (r.existingCards ?? [])
    .slice(0, 80)
    .map((card, index) => `${index + 1}. Fråga: ${card.front}\n   Svar: ${card.back}`)
    .join("\n");
  const densityInstruction = {
    few: "Var mycket selektiv och välj endast de mest centrala, examinationsrelevanta koncepten.",
    balanced: "Täck de tydliga, separata koncept som behöver repeteras utan att överlappa.",
    many: "Täck materialet brett när det finns många tydliga koncept, men undvik ändå variationer av samma kort.",
  }[r.density ?? "balanced"];
  const markerText = r.markers
    .map((marker) => marker.note.trim() || "Viktigt moment")
    .join("\n");
  const transcriptText = transcriptTextForCardGeneration(r.transcript);
  const allowedTypes = r.types.map((type) => cardTypeInstructions[type]).join("\n- ");
  return `Skapa Anki-kort på svenska. Promptversion: ${CARD_PROMPT_VERSION}.

UPPDRAG
- Repetitionsnivå: ${r.density === "few" ? "Få" : r.density === "many" ? "Många" : "Lagom"}. ${densityInstruction}
- Bedöm själv ett nyttigt antal kort, utan utfyllnad; högst ${r.count} (tekniskt tak).

REGLER
- Använd endast uttryckligt källstöd. Gissa inte.
- Ett atomärt, entydigt koncept per kort; tillräckligt sammanhang utan originalkällan.
- Prioritera förståelse, examination och markerade moment. Undvik trivialitet, dubbletter och långa osorterade listor.
- Skapa inte samma faktum som i BEFINTLIGA KORT. Skriv aldrig ljudtidsstämplar eller prefixet "Terminologi:".
- Använd varje vald källa självständigt. Saknad transkripttext är inte ett skäl att utelämna fakta som stöds av slides, anteckningar eller context.

KORTTYPER (använd endast dessa)
- ${allowedTypes}

FORMAT
Svara endast med giltig JSON: {"cards":[{"type":"${r.types.join("|")}","front":"...","back":"...","tags":["..."]}]}
${extraRules ? `\nEXTRA PREFERENSER\n${extraRules}\n` : ""}
FÖRELÄSNING: ${r.title}

KÄLLTÄCKNING:
${r.sourceStatus || "Använd endast de källor som har inkluderats nedan."}

BEFINTLIGA KORT I KURSEN (undvik att upprepa dem):
${existingCards || "(inga)"}

ÄRVD KONTEXT:
${r.context || "(ingen)"}

ANTECKNINGAR:
${r.notes || "(inga)"}

MARKERADE MOMENT:
${markerText || "(inga)"}

TEXT FRÅN SLIDES:
${r.slideText || "(ingen slide-text)"}

TRANSKRIPT:
${transcriptText || "(inget transcript)"}`;
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
    // "Terminologi:" adds no recall cue and makes the card front needlessly repetitive.
    front: c.front.replace(/^\s*terminologi:\s*/i, "").trim(),
    lectureId,
    status: "generated" as const,
  }));
}

export function likelyDuplicate(front: string, candidates: Array<{ id?: string; front: string }>) {
  const terms = (value: string) => new Set(value.toLocaleLowerCase("sv").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const query = terms(front);
  return candidates.find((candidate) => {
    const other = terms(candidate.front);
    const overlap = [...query].filter((term) => other.has(term)).length;
    return overlap >= 3 && overlap / Math.max(query.size, other.size, 1) >= 0.55;
  });
}

export function duplicateExplanation(front: string, candidate: { front: string }) {
  const terms = (value: string) =>
    new Set(value.toLocaleLowerCase("sv").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const matching = [...terms(front)].filter((term) => terms(candidate.front).has(term));
  return matching.slice(0, 4).join(", ");
}

export async function generateCardsWithApi(
  prompt: string,
  settings: AppSettings,
  apiKey: string,
) {
  const base = apiBaseUrl(settings);
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
    if (!response.ok) throw await providerError(response);
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
    if (!response.ok) throw await providerError(response);
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
  if (!response.ok) throw await providerError(response);
  const json = await response.json();
  return String(json.choices?.[0]?.message?.content ?? "");
}
