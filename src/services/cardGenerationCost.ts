import type { AppSettings } from "../core/types";

/**
 * Versioned reference prices for models Lectio suggests by default. Prices are
 * deliberately kept outside the UI so the catalogue can be reviewed and
 * updated without changing generation behaviour.
 */
export const CARD_GENERATION_PRICE_CATALOG_VERSION = "2026-09-08";

type PricedModel = {
  provider: Exclude<AppSettings["aiProvider"], "custom">;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const pricedModels: readonly PricedModel[] = [
  { provider: "openai", model: "gpt-4.1-mini", inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
  { provider: "openai", model: "gpt-4.1", inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  { provider: "anthropic", model: "claude-haiku-4-5", inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  { provider: "anthropic", model: "claude-sonnet-4-5", inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  { provider: "gemini", model: "gemini-2.5-flash", inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
];

export type CardGenerationCostEstimate = {
  inputTokens: number;
  outputTokens: number;
  usd?: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
};

/** A conservative local estimate: compact JSON cards commonly need ~110 output tokens each. */
export function estimateCardOutputTokens(cardCeiling: number) {
  return Math.max(250, Math.ceil(Math.max(0, cardCeiling) * 110));
}

export function estimateCardGenerationCost(
  provider: AppSettings["aiProvider"],
  model: string,
  inputTokens: number,
  outputTokens: number,
): CardGenerationCostEstimate {
  const estimate = {
    inputTokens: Math.max(0, Math.ceil(inputTokens)),
    outputTokens: Math.max(0, Math.ceil(outputTokens)),
  };
  const pricedModel = pricedModels.find(
    (entry) => entry.provider === provider && entry.model === model.trim(),
  );
  if (!pricedModel) return estimate;
  return {
    ...estimate,
    inputUsdPerMillion: pricedModel.inputUsdPerMillion,
    outputUsdPerMillion: pricedModel.outputUsdPerMillion,
    usd:
      (estimate.inputTokens / 1_000_000) * pricedModel.inputUsdPerMillion +
      (estimate.outputTokens / 1_000_000) * pricedModel.outputUsdPerMillion,
  };
}

export function formatCardGenerationCost(estimate: CardGenerationCostEstimate) {
  return estimate.usd === undefined
    ? undefined
    : new Intl.NumberFormat("sv-SE", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: estimate.usd < 0.01 ? 3 : 2,
        maximumFractionDigits: estimate.usd < 0.01 ? 3 : 2,
      }).format(estimate.usd);
}
