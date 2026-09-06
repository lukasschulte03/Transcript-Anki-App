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

async function providerError(response: Response) {
  const body = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
  return new Error(`API-fel ${response.status}${body ? `: ${body}` : ""}`);
}

export interface CardRequest {
  lectureId: string;
  title: string;
  context: string;
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
  return `Du är en noggrann studieassistent. Skapa högkvalitativa Anki-kort på svenska.\n\nREGLER:\n- Repetitionsnivå: ${r.density === "few" ? "Få" : r.density === "many" ? "Många" : "Lagom"}. ${densityInstruction}\n- Bedöm själv hur många kort materialet faktiskt motiverar. Fyll aldrig ut till en bestämd kvot. Välj bara sådant som en student sannolikt har nytta av att aktivt repetera senare.\n- Skapa aldrig fler än ${r.count} kort; detta är endast en teknisk säkerhetsgräns.\n- Använd ENDAST fakta som uttryckligen stöds av källmaterialet nedan. Gissa inte, fyll inte i luckor och avstå från kort om underlaget inte räcker.\n- Ett tydligt, atomärt koncept per kort. Frågan ska ha ett entydigt svar och innehålla tillräckligt sammanhang för att fungera utan sliden eller transkriptet.\n- Undvik triviala och duplicerade kort. Skapa inte förväxlingsbara syskonkort; gör närliggande frågor tydligt olika.\n- Fråga inte efter långa listor. Dela upp listor i separata kort, utom när ordning eller helheten är själva kunskapen.\n- Skapa inte ett kort som testar samma faktum eller begrepp som något i BEFINTLIGA KORT.\n- Prioritera förståelse, examinationsrelevans och markerade moment.\n- Välj korttyp efter kunskapen: basic/concept för definitioner, orsak–verkan och förståelse; cloze endast när en kort, naturlig sats blir tydligare; problem för beräkning, beslut eller tillämpning.\n- Om type är cloze MÅSTE front innehålla minst en giltig Anki-markering, exempelvis "Njurens viktigaste funktion är {{c1::filtrering av blodet}}.". Lägg en frivillig förklaring i back. Skapa aldrig ett cloze-kort utan {{c1::...}}-syntax.\n- Svara ENDAST med giltig JSON enligt: {"cards":[{"type":"basic|cloze|concept|definition|problem","front":"...","back":"...","tags":["..."]}]}\n- Tillåtna korttyper: ${r.types.join(", ")}.\n${extraRules}\n\nFÖRELÄSNING: ${r.title}\n\nBEFINTLIGA KORT I KURSEN (undvik att upprepa dem):\n${existingCards || "(inga)"}\n\nÄRVD KONTEXT:\n${r.context || "(ingen)"}\n\nANTECKNINGAR:\n${r.notes || "(inga)"}\n\nMARKERADE MOMENT:\n${r.markers.map((m) => `${m.time}s: ${m.note || "Viktigt moment"}`).join("\n") || "(inga)"}\n\nTEXT FRÅN SLIDES:\n${r.slideText || "(ingen slide-text)"}\n\nTRANSKRIPT:\n${r.transcript.map((s) => `[${s.start}-${s.end}s] ${s.text}`).join("\n") || "(inget transcript)"}`;
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
