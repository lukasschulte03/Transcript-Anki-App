import { z } from "zod";
import type {
  AppSettings,
  CardType,
  Flashcard,
  Marker,
  TranscriptSegment,
  VisualCandidate,
} from "../core/types";
import { netFetch } from "./platform";
import { visualPromptLines } from "./visualIndex";

export const aiModelSuggestions: Record<
  AppSettings["aiProvider"],
  readonly string[]
> = {
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
  visualId: z.string().min(1).optional(),
});
const responseSchema = z.object({ cards: z.array(cardSchema) });

async function providerError(response: Response) {
  const body = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
  return new Error(`API-fel ${response.status}${body ? `: ${body}` : ""}`);
}

function apiBaseUrl(settings: AppSettings) {
  const configured = settings.aiBaseUrl.trim().replace(/\/+$/, "");
  if (!settings.aiModel.trim())
    throw new Error("Välj eller skriv ett modellnamn innan du genererar.");
  if (settings.aiProvider === "custom") {
    if (!configured)
      throw new Error("Ange en bas-URL för den OpenAI-kompatibla tjänsten.");
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
  /** Locally retrieved visual descriptions; never image bytes. */
  visualCandidates?: VisualCandidate[];
  /** A hard, approximate input ceiling. The default fits inexpensive models. */
  contextBudget?: number;
}

/** Audio positions remain in Lectio for playback, but do not help AI card generation. */
export function transcriptTextForCardGeneration(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Keep this deliberately compact: inherited context and source material are the expensive parts. */
const CARD_PROMPT_VERSION = "2";
const cardTypeInstructions: Record<CardType, string> = {
  basic: "basic: en tydlig fråga och ett kort, exakt svar.",
  cloze:
    "cloze: front måste innehålla minst en giltig {{c1::...}}-markering; back förklarar kort.",
  concept:
    "concept: testa ett samband, en mekanism eller orsak–verkan med kort förklaring.",
  definition:
    "definition: testa en terms betydelse med tillräckligt sammanhang.",
  problem:
    "problem: testa en konkret tillämpning, beräkning eller ett beslut från underlaget.",
};

const terms = (value: string) =>
  new Set(value.toLocaleLowerCase("sv").match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** Pick only locally relevant cards. Full course history does not belong in every prompt. */
export function selectRelevantExistingCards(
  cards: Array<Pick<Flashcard, "front" | "back">>,
  query: string,
  limit = 12,
) {
  const queryTerms = terms(query);
  return cards
    .map((card) => {
      const cardTerms = terms(`${card.front}\n${card.back}`);
      const overlap = [...queryTerms].filter((term) =>
        cardTerms.has(term),
      ).length;
      return {
        card,
        score: overlap / Math.max(cardTerms.size, 1) + overlap * 0.1,
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.card.front.localeCompare(right.card.front, "sv"),
    )
    .slice(0, limit)
    .map(({ card }) => card);
}

function withinBudget(value: string, maxCharacters: number) {
  const normalized = value.trim();
  if (normalized.length <= maxCharacters)
    return { text: normalized, omitted: false };
  const boundary = normalized.lastIndexOf(" ", Math.max(0, maxCharacters - 1));
  return {
    text: `${normalized.slice(0, boundary > 0 ? boundary : maxCharacters).trim()}\n[Förkortat för att hålla prompten inom budget]`,
    omitted: true,
  };
}

export function cardPromptSummary(r: CardRequest) {
  const budgetTokens = r.contextBudget ?? 24_000;
  const sourceText = [
    r.title,
    r.notes,
    r.slideText,
    transcriptTextForCardGeneration(r.transcript),
    r.context,
  ].join("\n");
  const relevantCards = selectRelevantExistingCards(
    r.existingCards ?? [],
    sourceText,
  );
  const maximum = budgetTokens * 4;
  const notes = withinBudget(r.notes, Math.floor(maximum * 0.09));
  const slides = withinBudget(r.slideText, Math.floor(maximum * 0.2));
  const transcript = withinBudget(
    transcriptTextForCardGeneration(r.transcript),
    Math.floor(maximum * 0.3),
  );
  const context = withinBudget(r.context, Math.floor(maximum * 0.14));
  const markers = withinBudget(
    r.markers
      .map((marker) => marker.note.trim() || "Viktigt moment")
      .join("\n"),
    Math.floor(maximum * 0.035),
  );
  const existing = withinBudget(
    relevantCards.map((card) => card.front).join("\n"),
    Math.floor(maximum * 0.045),
  );
  // Visual candidates are only compact local descriptions. Still reserve a
  // bounded part of the prompt so the displayed token/cost estimate is honest.
  const visuals = withinBudget(
    visualPromptLines(r.visualCandidates ?? []),
    Math.floor(maximum * 0.1),
  );
  const omitted = [
    notes,
    slides,
    transcript,
    context,
    markers,
    existing,
    visuals,
  ].filter((item) => item.omitted).length;
  return {
    budgetTokens,
    notes: notes.text,
    slides: slides.text,
    transcript: transcript.text,
    context: context.text,
    markers: markers.text,
    existing: existing.text,
    visuals: visuals.text,
    relevantCardCount: relevantCards.length,
    omitted,
    estimatedTokens: Math.ceil(
      (notes.text.length +
        slides.text.length +
        transcript.text.length +
        context.text.length +
        markers.text.length +
        existing.text.length +
        visuals.text.length) /
        4,
    ),
  };
}

export function createCardPrompt(r: CardRequest) {
  const extraRules = [
    ...r.preferences.map((preference) => `- ${preference}`),
    ...(r.cardStyle ? [`- Följ denna lokala kortstil: ${r.cardStyle}`] : []),
  ].join("\n");
  const summary = cardPromptSummary(r);
  const densityInstruction = {
    few: "Var mycket selektiv och välj endast de mest centrala, examinationsrelevanta koncepten.",
    balanced:
      "Täck de tydliga, separata koncept som behöver repeteras utan att överlappa.",
    many: "Täck materialet brett när det finns många tydliga koncept, men undvik ändå variationer av samma kort.",
  }[r.density ?? "balanced"];
  const allowedTypes = r.types
    .map((type) => cardTypeInstructions[type])
    .join("\n- ");
  const prompt = `Skapa Anki-kort på svenska. Promptversion: ${CARD_PROMPT_VERSION}.

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
Svara endast med giltig JSON: {"cards":[{"type":"${r.types.join("|")}","front":"...","back":"...","tags":["..."],"visualId":"valfritt-id"}]}
${extraRules ? `\nEXTRA PREFERENSER\n${extraRules}\n` : ""}
FÖRELÄSNING: ${r.title}

KÄLLTÄCKNING:
${r.sourceStatus || "Använd endast de källor som har inkluderats nedan."}

NÄRLIGGANDE BEFINTLIGA KORT (undvik att upprepa dem):
${summary.existing || "(inga relevanta)"}

ÄRVD KONTEXT:
${summary.context || "(ingen)"}

ANTECKNINGAR:
${summary.notes || "(inga)"}

MARKERADE MOMENT:
${summary.markers || "(inga)"}

TEXT FRÅN SLIDES:
${summary.slides || "(ingen slide-text)"}

TILLGÄNGLIGA BILDER:
${summary.visuals || "(inga säkra bildkandidater)"}
Välj endast ett visualId från listan när bilden materiellt förbättrar förståelse. Välj ingen bild vid osäkerhet; hitta aldrig på ett ID.

TRANSKRIPT:
${summary.transcript || "(inget transcript)"}`;
  return withinBudget(prompt, (r.contextBudget ?? 24_000) * 4).text;
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

export function likelyDuplicate(
  front: string,
  candidates: Array<{ id?: string; front: string }>,
) {
  const terms = (value: string) =>
    new Set(value.toLocaleLowerCase("sv").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const query = terms(front);
  return candidates.find((candidate) => {
    const other = terms(candidate.front);
    const overlap = [...query].filter((term) => other.has(term)).length;
    return (
      overlap >= 3 && overlap / Math.max(query.size, other.size, 1) >= 0.55
    );
  });
}

export function duplicateExplanation(
  front: string,
  candidate: { front: string },
) {
  const terms = (value: string) =>
    new Set(value.toLocaleLowerCase("sv").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const matching = [...terms(front)].filter((term) =>
    terms(candidate.front).has(term),
  );
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
