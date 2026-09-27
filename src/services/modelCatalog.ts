import type { AppSettings } from "../core/types";
import { netFetch } from "./platform";

export type ModelTask = "cards" | "transcription" | "vision";
export type ModelTier = "recommended" | "budget" | "powerful" | "available";

export type ModelOption = {
  id: string;
  label: string;
  tier: ModelTier;
  description?: string;
};

export type ModelCatalogResult = {
  models: ModelOption[];
  source: "fallback" | "provider";
  error?: string;
};

type AiProvider = AppSettings["aiProvider"];
type Provider = AiProvider | "openai" | "groq";

const cardModels: Partial<Record<Provider, readonly ModelOption[]>> = {
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "recommended", description: "Stark och prisvärd för kortgenerering." },
    { id: "gpt-5.5", label: "GPT-5.5", tier: "powerful", description: "Högsta kvalitet för komplicerat kursmaterial." },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano", tier: "budget", description: "Snabbast och billigast för enklare underlag." },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "available", description: "Snabbt alternativ med god kvalitet." },
    { id: "gpt-4.1", label: "GPT-4.1", tier: "available", description: "Stark modell med bildstöd." },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", tier: "recommended", description: "Senaste balanserade Claude-modellen." },
    { id: "claude-opus-5", label: "Claude Opus 5", tier: "powerful", description: "För svåra och omfattande underlag." },
    { id: "claude-fable-5", label: "Claude Fable 5", tier: "available" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", tier: "powerful" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "available" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "budget" },
  ],
  gemini: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", tier: "recommended", description: "Snabb multimodal modell för vardagsbruk." },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro · preview", tier: "powerful", description: "För större och mer komplexa underlag." },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", tier: "budget" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", tier: "available" },
  ],
  groq: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", tier: "recommended", description: "Hög kvalitet med snabb inferens." },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tier: "budget", description: "Snabbt och kostnadseffektivt." },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", tier: "available" },
    { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B · preview", tier: "available" },
  ],
  custom: [],
};

const transcriptionModels: Partial<Record<Provider, readonly ModelOption[]>> = {
  openai: [
    { id: "gpt-transcribe", label: "GPT-Transcribe · utan tidsstämplar", tier: "recommended", description: "Nyast och bäst för löpande text; visar inte segmenttider." },
    { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe · utan tidsstämplar", tier: "powerful" },
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe · utan tidsstämplar", tier: "budget" },
    { id: "whisper-1", label: "Whisper 1 · med tidsstämplar", tier: "available", description: "OpenAI Whisper med segmenttider." },
  ],
  groq: [
    { id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo", tier: "recommended" },
    { id: "whisper-large-v3", label: "Whisper Large v3", tier: "powerful" },
  ],
};

const visionModels: Partial<Record<Provider, readonly ModelOption[]>> = {
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "recommended", description: "Bra kvalitet och kostnad för bildbeskrivningar." },
    { id: "gpt-5.5", label: "GPT-5.5", tier: "powerful", description: "Mer kapabel analys för komplicerade bilder." },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "budget" },
    { id: "gpt-4.1", label: "GPT-4.1", tier: "available" },
    { id: "gpt-4o", label: "GPT-4o", tier: "available" },
  ],
};

const catalogs: Record<ModelTask, Partial<Record<Provider, readonly ModelOption[]>>> = {
  cards: cardModels,
  transcription: transcriptionModels,
  vision: visionModels,
};

const knownProviders = new Set<Provider>([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "custom",
]);

function safeProvider(provider: Provider | string | undefined): Provider {
  return provider && knownProviders.has(provider as Provider)
    ? (provider as Provider)
    : "openai";
}

export function fallbackModelOptions(
  provider: Provider | string | undefined,
  task: ModelTask = "cards",
) {
  return [...(catalogs[task][safeProvider(provider)] ?? [])];
}

export const aiModelSuggestions = {
  openai: fallbackModelOptions("openai").map((model) => model.id),
  anthropic: fallbackModelOptions("anthropic").map((model) => model.id),
  gemini: fallbackModelOptions("gemini").map((model) => model.id),
  groq: fallbackModelOptions("groq").map((model) => model.id),
  custom: [],
} satisfies Record<AiProvider, readonly string[]>;

function normalizedBaseUrl(provider: Provider, baseUrl: string) {
  const configured = baseUrl.trim().replace(/\/+$/, "");
  if (provider === "custom") return configured;
  return {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
  }[provider];
}

function acceptsModel(task: ModelTask, provider: Provider, id: string) {
  const model = id.toLowerCase();
  if (task === "transcription") {
    if (provider === "openai")
      return /^(gpt-transcribe|gpt-4o-(mini-)?transcribe|whisper-1)$/.test(model);
    if (provider === "groq") return /^whisper-large-v3(-turbo)?$/.test(model);
    return false;
  }
  if (task === "vision") {
    return provider === "openai" && /^gpt-(5(?:\.|$)|4\.1|4o)/.test(model) &&
      !/(audio|transcribe|tts|realtime|embedding|moderation)/.test(model);
  }
  if (provider === "openai")
    return /^(gpt-5(?:\.|$)|gpt-4\.1(?:-|$)|gpt-4o(?:-|$)|o[1-9](?:-|$))/.test(model) &&
      !/(audio|transcribe|tts|realtime|image|embedding|moderation|codex|deep-research|search)/.test(model);
  if (provider === "anthropic") return /^claude-/.test(model);
  if (provider === "gemini")
    return /^gemini-/.test(model) &&
      !/(audio|tts|live|embedding|robotics|veo|imagen)/.test(model);
  if (provider === "groq")
    return !/(whisper|transcrib|speech|audio|tts|guard|embedding|compound)/.test(model);
  return !/(audio|transcrib|speech|tts|embedding|moderation)/.test(model);
}

function mergeModels(
  provider: Provider,
  task: ModelTask,
  fetched: string[],
) {
  const fallback = fallbackModelOptions(provider, task);
  const known = new Map(fallback.map((model) => [model.id, model]));
  const available = new Map<string, ModelOption>();
  fetched.forEach((id) => {
    const normalized = id.trim();
    if (normalized && !available.has(normalized))
      available.set(normalized, known.get(normalized) ?? {
        id: normalized,
        label: normalized,
        tier: "available",
        description: "Tillgänglig via ditt providerkonto.",
      });
  });
  const tierOrder: Record<ModelTier, number> = {
    recommended: 0,
    budget: 1,
    powerful: 2,
    available: 3,
  };
  return [...available.values()].sort(
    (left, right) =>
      tierOrder[left.tier] - tierOrder[right.tier] ||
      left.label.localeCompare(right.label),
  );
}

/** Fetch only model metadata. Audio, slides and study material are never sent. */
export async function fetchProviderModelOptions(
  provider: Provider,
  apiKey: string | null,
  baseUrl: string,
  task: ModelTask = "cards",
): Promise<ModelCatalogResult> {
  const fallback = fallbackModelOptions(provider, task);
  if (!apiKey?.trim()) return { models: fallback, source: "fallback" };
  const base = normalizedBaseUrl(provider, baseUrl);
  if (!base) return { models: fallback, source: "fallback" };
  try {
    let ids: string[] = [];
    if (provider === "anthropic") {
      const response = await netFetch(`${base}/models`, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      ids = json.data?.map((model) => model.id ?? "") ?? [];
    } else if (provider === "gemini") {
      const response = await netFetch(`${base}/models`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      ids = json.models
        ?.filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => model.name?.replace(/^models\//, "") ?? "") ?? [];
    } else {
      const response = await netFetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      ids = json.data?.map((model) => model.id ?? "") ?? [];
    }
    const compatible = ids.filter((id) => acceptsModel(task, provider, id));
    const models = mergeModels(provider, task, compatible);
    return {
      models: models.length ? models : fallback,
      source: models.length ? "provider" : "fallback",
      ...(models.length ? {} : { error: "Inga kompatibla modeller hittades i kontot." }),
    };
  } catch (error) {
    return {
      models: fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : "okänt fel",
    };
  }
}

export const MODEL_PRICE_CATALOG_VERSION = "2026-09-27";
