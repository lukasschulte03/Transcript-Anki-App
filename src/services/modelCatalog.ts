import type { AppSettings } from "../core/types";
import { netFetch } from "./platform";

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

const knownProviders = new Set<AiProvider>([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "custom",
]);

function safeProvider(provider: AiProvider | string | undefined): AiProvider {
  return provider && knownProviders.has(provider as AiProvider)
    ? (provider as AiProvider)
    : "openai";
}

/**
 * A compact, reviewed fallback that works without a network request. Provider
 * model APIs are used only as an optional supplement for accounts that have a
 * saved key; neither keys nor library material leave the app for this list.
 */
const fallbackCatalog: Record<AiProvider, readonly ModelOption[]> = {
  openai: [
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "recommended", description: "Bra balans för kortgenerering." },
    { id: "gpt-4.1", label: "GPT-4.1", tier: "powerful", description: "Mer kapabel för svårare underlag." },
    { id: "o4-mini", label: "o4-mini", tier: "budget", description: "Prisvärt resonemangsalternativ." },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "budget", description: "Snabbt och billigare." },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tier: "recommended", description: "Bra kvalitet för studieunderlag." },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "recommended", description: "Snabb och kostnadseffektiv." },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "powerful", description: "För mer komplexa föreläsningar." },
  ],
  groq: [
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tier: "budget", description: "Mycket låg kostnad och hög hastighet." },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", tier: "recommended", description: "Stark kvalitet till låg kostnad." },
  ],
  custom: [],
};

export const aiModelSuggestions = {
  openai: fallbackCatalog.openai.map((model) => model.id),
  anthropic: fallbackCatalog.anthropic.map((model) => model.id),
  gemini: fallbackCatalog.gemini.map((model) => model.id),
  groq: fallbackCatalog.groq.map((model) => model.id),
  custom: fallbackCatalog.custom.map((model) => model.id),
} satisfies Record<AiProvider, readonly string[]>;

export function fallbackModelOptions(provider: AiProvider | string | undefined) {
  return [...fallbackCatalog[safeProvider(provider)]];
}

const providerOrder = (provider: AiProvider, model: ModelOption) => {
  const fallbackIndex = fallbackCatalog[provider].findIndex(
    (entry) => entry.id === model.id,
  );
  return fallbackIndex === -1 ? 10_000 : fallbackIndex;
};

function mergeModels(provider: AiProvider, fetched: string[]) {
  const fallback = fallbackModelOptions(provider);
  const known = new Map(fallback.map((model) => [model.id, model]));
  fetched.forEach((id) => {
    const normalized = id.trim();
    if (normalized && !known.has(normalized))
      known.set(normalized, {
        id: normalized,
        label: normalized,
        tier: "available",
        description: "Tillgänglig via ditt providerkonto.",
      });
  });
  return [...known.values()].sort(
    (left, right) =>
      providerOrder(provider, left) - providerOrder(provider, right) ||
      left.label.localeCompare(right.label),
  );
}

function acceptsChatModel(provider: AiProvider, id: string) {
  const model = id.toLowerCase();
  if (provider === "groq")
    return !/(whisper|guard|embedding|tts|audio)/.test(model);
  if (provider === "openai")
    return /^(gpt|o[1-9]|chatgpt)/.test(model) &&
      !/(audio|transcribe|tts|realtime|image|embedding|moderation)/.test(model);
  return true;
}

function normalizedBaseUrl(provider: AiProvider, baseUrl: string) {
  const configured = baseUrl.trim().replace(/\/+$/, "");
  if (provider === "custom") return configured;
  return {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    groq: "https://api.groq.com/openai/v1",
  }[provider];
}

/** Fetches only model metadata from the provider associated with the saved key. */
export async function fetchProviderModelOptions(
  provider: AiProvider,
  apiKey: string | null,
  baseUrl: string,
): Promise<ModelCatalogResult> {
  const fallback = fallbackModelOptions(provider);
  if (!apiKey?.trim()) return { models: fallback, source: "fallback" };
  const base = normalizedBaseUrl(provider, baseUrl);
  if (!base) return { models: fallback, source: "fallback" };
  try {
    let ids: string[] = [];
    if (provider === "anthropic") {
      const response = await netFetch(`${base}/models`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      ids = json.data?.map((model) => model.id ?? "") ?? [];
    } else if (provider === "gemini") {
      const response = await netFetch(
        `${base}/models?key=${encodeURIComponent(apiKey)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      ids =
        json.models
          ?.filter((model) =>
            model.supportedGenerationMethods?.includes("generateContent"),
          )
          .map((model) => model.name?.replace(/^models\//, "") ?? "") ?? [];
    } else {
      const response = await netFetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      ids = json.data?.map((model) => model.id ?? "") ?? [];
    }
    return {
      models: mergeModels(provider, ids.filter((id) => acceptsChatModel(provider, id))),
      source: "provider",
    };
  } catch (error) {
    return {
      models: fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : "okänt fel",
    };
  }
}

export const MODEL_PRICE_CATALOG_VERSION = "2026-09-10";
