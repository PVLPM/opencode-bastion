import type { TokenUsageInfo } from "@opencode/client/promise";

import type { Money } from "./types";
import { tokenTotal } from "./usage";

interface PriceCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export type PriceTable = Record<string, { models: Record<string, { cost?: PriceCost }> }>;

interface PricedModel {
  providerID: string;
  modelID: string;
}

function findCost(
  table: PriceTable,
  model: PricedModel,
  canonical: string | undefined,
): PriceCost | undefined {
  const direct = table[model.providerID]?.models[model.modelID]?.cost;
  if (direct !== undefined) return direct;
  if (canonical !== undefined) {
    const canonicalCost = table[canonical]?.models[model.modelID]?.cost;
    if (canonicalCost !== undefined) return canonicalCost;
  }
  const matches = Object.values(table).filter(
    (provider) => provider.models[model.modelID]?.cost !== undefined,
  );
  const [only] = matches;
  return matches.length === 1 && only !== undefined ? only.models[model.modelID]?.cost : undefined;
}

export function estimateCost(
  tokens: TokenUsageInfo,
  model: PricedModel,
  table: PriceTable,
  canonical?: string,
): number | undefined {
  const cost = findCost(table, model, canonical);
  if (cost === undefined) return undefined;
  // models.dev omits cache prices for some providers; their cache tokens bill at the input rate.
  const cacheRead = cost.cache_read ?? cost.input;
  const cacheWrite = cost.cache_write ?? cost.input;
  // models.dev has no reasoning price; providers bill reasoning at the output rate.
  const output = tokens.output + tokens.reasoning;
  return (
    (tokens.input * cost.input +
      output * cost.output +
      tokens.cache.read * cacheRead +
      tokens.cache.write * cacheWrite) /
    1_000_000
  );
}

export function resolveCost(
  reported: number,
  tokens: TokenUsageInfo,
  model: PricedModel,
  table: PriceTable,
): Money | undefined {
  if (reported > 0) return { usd: reported, estimated: false };
  if (tokenTotal(tokens) === 0) return { usd: 0, estimated: false };
  const estimate = estimateCost(tokens, model, table);
  return estimate === undefined ? undefined : { usd: estimate, estimated: true };
}
