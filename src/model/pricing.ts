import type { JsonValue, TokenUsageInfo } from "@opencode/client/promise";

import type { Money } from "./types";
import { tokenTotal } from "./usage";

interface PriceCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export type PriceTable = Record<string, { models?: Record<string, { cost?: PriceCost }> }>;

interface PricedModel {
  providerID: string;
  modelID: string;
}

/**
 * Billing aliases that are not models.dev providers but use another provider's
 * list price. `claude-agent` is Anthropic's CLI routing for subscription use;
 * its model ids are Anthropic ids, so the estimate is API-list-price equivalent,
 * not subscription spend. Keep this explicit: a model id alone cannot price.
 */
export function canonicalPriceProvider(providerID: string): string | undefined {
  switch (providerID.toLowerCase()) {
    case "claude-agent":
    case "google-vertex-anthropic":
      return "anthropic";
    default:
      return undefined;
  }
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** A finite, non-negative list price; anything else is unusable data. */
function priceNumber(value: JsonValue | undefined): number | undefined {
  if (Object.prototype.toString.call(value) !== "[object Number]") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function costFrom(
  input: JsonValue | undefined,
  output: JsonValue | undefined,
  cacheRead: JsonValue | undefined,
  cacheWrite: JsonValue | undefined,
): PriceCost | undefined {
  const parsedInput = priceNumber(input);
  const parsedOutput = priceNumber(output);
  if (parsedInput === undefined || parsedOutput === undefined) return undefined;
  const parsedRead = cacheRead === undefined ? undefined : priceNumber(cacheRead);
  const parsedWrite = cacheWrite === undefined ? undefined : priceNumber(cacheWrite);
  if (
    (cacheRead !== undefined && parsedRead === undefined) ||
    (cacheWrite !== undefined && parsedWrite === undefined)
  ) {
    return undefined;
  }
  const cost: PriceCost = { input: parsedInput, output: parsedOutput };
  if (parsedRead !== undefined) cost.cache_read = parsedRead;
  if (parsedWrite !== undefined) cost.cache_write = parsedWrite;
  return cost;
}

function decodeCost(value: JsonValue | undefined): PriceCost | undefined {
  if (!isJsonObject(value)) return undefined;
  return costFrom(value["input"], value["output"], value["cache_read"], value["cache_write"]);
}

/** Revalidate a table entry supplied through the type system but not by the decoder. */
function checkedCost(value: PriceCost | undefined): PriceCost | undefined {
  if (value === undefined || Object.prototype.toString.call(value) !== "[object Object]") {
    return undefined;
  }
  return costFrom(value.input, value.output, value.cache_read, value.cache_write);
}

function parseModels(
  value: JsonValue | undefined,
): Record<string, { cost?: PriceCost }> | undefined {
  if (!isJsonObject(value)) return undefined;
  const models: [string, { cost?: PriceCost }][] = [];
  for (const [modelID, model] of Object.entries(value)) {
    if (!isJsonObject(model)) continue;
    const rawCost = model["cost"];
    if (rawCost === undefined) {
      models.push([modelID, {}]);
      continue;
    }
    const cost = decodeCost(rawCost);
    if (cost !== undefined) models.push([modelID, { cost }]);
  }
  return Object.fromEntries(models);
}

/** Decode the models.dev body once; an unreadable root or entry yields no price. */
export function parsePriceTable(value: JsonValue | undefined): PriceTable | undefined {
  if (!isJsonObject(value)) return undefined;
  const providers: [string, { models: Record<string, { cost?: PriceCost }> }][] = [];
  for (const [providerID, provider] of Object.entries(value)) {
    if (!isJsonObject(provider)) continue;
    const models = parseModels(provider["models"]);
    if (models === undefined) continue;
    providers.push([providerID, { models }]);
  }
  return Object.fromEntries(providers);
}

function costAt(table: PriceTable, providerID: string, modelID: string): PriceCost | undefined {
  return checkedCost(table[providerID]?.models?.[modelID]?.cost);
}

function findCost(
  table: PriceTable,
  model: PricedModel,
  canonical: string | undefined,
): PriceCost | undefined {
  const direct = costAt(table, model.providerID, model.modelID);
  if (direct !== undefined) return direct;
  if (canonical !== undefined) {
    const canonicalCost = costAt(table, canonical, model.modelID);
    if (canonicalCost !== undefined) return canonicalCost;
  }
  let match: PriceCost | undefined;
  let count = 0;
  for (const providerID of Object.keys(table)) {
    const cost = costAt(table, providerID, model.modelID);
    if (cost === undefined) continue;
    match = cost;
    count += 1;
  }
  return count === 1 ? match : undefined;
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
  canonical?: string,
): Money | undefined {
  if (reported > 0) return { usd: reported, estimated: false };
  if (tokenTotal(tokens) === 0) return { usd: 0, estimated: false };
  const estimate = estimateCost(tokens, model, table, canonical);
  return estimate === undefined ? undefined : { usd: estimate, estimated: true };
}
