/**
 * Versioned reference prices for the models Lectio offers by default.
 * Update this catalogue after checking the provider's official pricing page.
 */
export const TRANSCRIPTION_PRICE_CATALOG_VERSION = "2026-09-07";

type PricedModel = {
  provider: "openai" | "groq";
  model: string;
  usdPerMinute: number;
};

const pricedModels: readonly PricedModel[] = [
  { provider: "openai", model: "whisper-1", usdPerMinute: 0.006 },
  { provider: "groq", model: "whisper-large-v3", usdPerMinute: 0.111 / 60 },
  { provider: "groq", model: "whisper-large-v3-turbo", usdPerMinute: 0.04 / 60 },
];

export type TranscriptionCostEstimate = {
  durationSeconds: number;
  usd?: number;
  usdPerMinute?: number;
};

export function estimateTranscriptionCost(
  provider: "openai" | "groq" | "manual",
  model: string,
  durationSeconds: number,
): TranscriptionCostEstimate {
  const duration = Math.max(0, durationSeconds);
  const pricedModel = pricedModels.find(
    (entry) => entry.provider === provider && entry.model === model.trim(),
  );
  if (!pricedModel) return { durationSeconds: duration };
  return {
    durationSeconds: duration,
    usdPerMinute: pricedModel.usdPerMinute,
    usd: (duration / 60) * pricedModel.usdPerMinute,
  };
}

export function formatTranscriptionCost(estimate: TranscriptionCostEstimate) {
  return estimate.usd === undefined
    ? undefined
    : new Intl.NumberFormat("sv-SE", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: estimate.usd < 0.01 ? 3 : 2,
        maximumFractionDigits: estimate.usd < 0.01 ? 3 : 2,
      }).format(estimate.usd);
}
