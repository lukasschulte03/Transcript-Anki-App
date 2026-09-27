import { netFetch } from "./platform";

export type VisualAnalysisResult = {
  description: string;
  extractedText: string;
  keywords: string[];
};

const compact = (value: unknown, limit: number) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function parseResult(raw: string): VisualAnalysisResult {
  const clean = raw.trim().replace(/^```(?:json)?\s*|```$/gim, "");
  const candidates = clean.match(/\{[\s\S]*\}/g) ?? [];
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as {
        description?: unknown;
        extractedText?: unknown;
        keywords?: unknown;
      };
      const description = compact(parsed.description, 240);
      if (!description) continue;
      return {
        description,
        extractedText: compact(parsed.extractedText, 900),
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.map((word) => compact(word, 40)).filter(Boolean).slice(0, 12)
          : [],
      };
    } catch {
      // Providers occasionally wrap valid JSON in prose or markdown fences.
    }
  }
  const description = compact(clean, 240);
  if (!description) throw new Error("Bildmodellen returnerade inget användbart svar.");
  return { description, extractedText: "", keywords: [] };
}

/** Sends only one locally extracted crop, never the full slide, audio or lecture. */
export async function analyzeVisualCrop(
  image: Blob,
  options: { apiKey: string; model: string; localOcrText?: string },
): Promise<VisualAnalysisResult> {
  if (!image.size) throw new Error("Bildutklippet saknar bilddata.");
  if (!options.apiKey.trim()) throw new Error("API-nyckeln för bildanalys saknas.");
  if (!options.model.trim()) throw new Error("Välj en modell för bildanalys.");

  const response = await netFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model.trim(),
      temperature: 0.1,
      max_tokens: 420,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Analysera detta beskurna bildområde från en föreläsningsslide.",
                "Svara på svenska som JSON med fälten description, extractedText och keywords.",
                "description: en kort, konkret mening om vad bilden visar och dess innehåll; beskriv inte bara formen.",
                "extractedText: läsbar text som faktiskt står i bilden, bevara viktiga etiketter och värden. Tom sträng om ingen text finns.",
                "Gissa aldrig otydlig text eller medicinska fakta.",
                options.localOcrText?.trim()
                  ? `Lokal OCR som stöd (kan innehålla fel): ${options.localOcrText.trim().slice(0, 900)}`
                  : "",
              ].filter(Boolean).join("\n"),
            },
            {
              type: "image_url",
              image_url: { url: `data:${image.type || "image/png"};base64,${await toBase64(image)}` },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Bildanalys-API svarade ${response.status}.`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  const raw = Array.isArray(content)
    ? content.map((part) => part.text ?? "").join("\n")
    : content ?? "";
  return parseResult(raw);
}
