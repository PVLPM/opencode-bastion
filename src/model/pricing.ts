import type {
  JsonValue,
  ModelCost,
  ModelInfo,
  ModelRef,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";

import type { Money } from "./types";
import { tokenTotal } from "./usage";

/** USD per million tokens for one request, before cache fallbacks. */
interface PriceRate {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** A context tier replaces the base rates once the request context passes its size. */
interface PriceTier extends PriceRate {
  readonly size: number;
}

interface PriceModel {
  readonly cost?: PriceRate;
  readonly tiers?: readonly PriceTier[];
  /** Catalog display name, used only for explicit unversioned aliases. */
  readonly name?: string;
}

/** The same entry while the decoder fills it in. */
interface MutablePriceModel {
  cost?: PriceRate;
  tiers?: PriceTier[];
  name?: string;
}

export type PriceTable = Record<string, { readonly models?: Record<string, PriceModel> }>;

/** The rates that apply to one model route. */
export interface ModelTariff {
  readonly base: PriceRate;
  readonly tiers: readonly PriceTier[];
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

/** A finite, non-negative price or token count; anything else is unusable data. */
function amount(value: JsonValue | undefined): number | undefined {
  if (Object.prototype.toString.call(value) !== "[object Number]") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalAmount(value: JsonValue | undefined): number | undefined {
  // models.dev uses null for an unpublished cache rate; the input rate applies.
  return value === undefined || value === null ? undefined : amount(value);
}

function parseRate(value: JsonValue | undefined): PriceRate | undefined {
  if (!isJsonObject(value)) return undefined;
  const input = amount(value["input"]);
  const output = amount(value["output"]);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = optionalAmount(value["cache_read"]);
  const cacheWrite = optionalAmount(value["cache_write"]);
  if (cacheRead === undefined) {
    return cacheWrite === undefined ? { input, output } : { input, output, cacheWrite };
  }
  return cacheWrite === undefined
    ? { input, output, cacheRead }
    : { input, output, cacheRead, cacheWrite };
}

function parseTier(value: JsonValue | undefined): PriceTier | undefined {
  if (!isJsonObject(value)) return undefined;
  const meta = value["tier"];
  if (!isJsonObject(meta) || meta["type"] !== "context") return undefined;
  const size = amount(meta["size"]);
  if (size === undefined || size <= 0) return undefined;
  const rate = parseRate(value);
  return rate === undefined ? undefined : { ...rate, size: Math.trunc(size) };
}

/** Ascending, one tier per threshold; upstream order never changes the result. */
function sortedTiers(tiers: readonly PriceTier[]): PriceTier[] {
  return [...tiers]
    .sort((a, b) => a.size - b.size)
    .filter((tier, index, list) => list.findIndex((entry) => entry.size === tier.size) === index);
}

function parseModel(value: JsonValue | undefined): PriceModel | undefined {
  if (!isJsonObject(value)) return undefined;
  const model: MutablePriceModel = {};
  const name = value["name"];
  if (Object.prototype.toString.call(name) === "[object String]") {
    const text = String(name);
    if (text.trim() !== "") model.name = text;
  }
  const rawCost = value["cost"];
  const cost = parseRate(rawCost);
  if (cost !== undefined) model.cost = cost;
  // models.dev publishes context tiers inside the same cost object.
  if (isJsonObject(rawCost)) {
    const rawTiers = rawCost["tiers"];
    if (Array.isArray(rawTiers)) {
      const tiers = rawTiers.flatMap((tier) => {
        const parsed = parseTier(tier);
        return parsed === undefined ? [] : [parsed];
      });
      if (tiers.length > 0) model.tiers = sortedTiers(tiers);
    }
  }
  return model.name === undefined && model.cost === undefined && model.tiers === undefined
    ? undefined
    : model;
}

function parseModels(value: JsonValue | undefined): Record<string, PriceModel> | undefined {
  if (!isJsonObject(value)) return undefined;
  const models: [string, PriceModel][] = [];
  for (const [modelID, raw] of Object.entries(value)) {
    const model = parseModel(raw);
    if (model !== undefined) models.push([modelID, model]);
  }
  return Object.fromEntries(models);
}

/** Decode the models.dev body once; an unreadable root or provider yields no price. */
export function parsePriceTable(value: JsonValue | undefined): PriceTable | undefined {
  if (!isJsonObject(value)) return undefined;
  const providers: [string, { models: Record<string, PriceModel> }][] = [];
  for (const [providerID, raw] of Object.entries(value)) {
    if (!isJsonObject(raw)) continue;
    const models = parseModels(raw["models"]);
    if (models === undefined) continue;
    providers.push([providerID, { models }]);
  }
  return Object.fromEntries(providers);
}

function allZero(rates: readonly PriceRate[]): boolean {
  return rates.every(
    (rate) =>
      rate.input === 0 &&
      rate.output === 0 &&
      (rate.cacheRead ?? 0) === 0 &&
      (rate.cacheWrite ?? 0) === 0,
  );
}

function nativeRate(cost: ModelCost): PriceRate | undefined {
  const input = amount(cost.input);
  const output = amount(cost.output);
  const cacheRead = amount(cost.cache?.read);
  const cacheWrite = amount(cost.cache?.write);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

/**
 * The host's own rates are authoritative when they carry a real price. An
 * all-zero native cost cannot distinguish free from a subscription route, so
 * it falls through to models.dev instead of claiming zero spend.
 */
export function nativeTariff(costs: readonly ModelCost[] | undefined): ModelTariff | undefined {
  if (costs === undefined) return undefined;
  const baseCost = costs.find((cost) => cost.tier === undefined);
  if (baseCost === undefined) return undefined;
  const base = nativeRate(baseCost);
  if (base === undefined) return undefined;
  const tiers: PriceTier[] = [];
  for (const cost of costs) {
    if (cost.tier?.type !== "context") continue;
    const size = amount(cost.tier.size);
    if (size === undefined || size <= 0) continue;
    const rate = nativeRate(cost);
    if (rate !== undefined) tiers.push({ ...rate, size: Math.trunc(size) });
  }
  const ordered = sortedTiers(tiers);
  if (allZero([base, ...ordered])) return undefined;
  return { base, tiers: ordered };
}

function catalogTariff(model: PriceModel | undefined): ModelTariff | undefined {
  // A catalog entry without a cost is known but unpriced, not free.
  if (model?.cost === undefined) return undefined;
  return { base: model.cost, tiers: model.tiers ?? [] };
}

type CatalogLookup =
  | { readonly found: false; readonly tariff: undefined }
  | { readonly found: true; readonly tariff: ModelTariff | undefined };

/** Distinguishes "not listed" (fall through) from "listed but unpriced" (stop). */
function lookupCatalog(
  table: PriceTable | undefined,
  providerID: string | undefined,
  modelID: string,
): CatalogLookup {
  const model = providerID === undefined ? undefined : table?.[providerID]?.models?.[modelID];
  return model === undefined
    ? { found: false, tariff: undefined }
    : { found: true, tariff: catalogTariff(model) };
}

/**
 * Match a native display name against the provider's catalog exactly or as its
 * vendor-prefixed form ("Sonnet 5.5" against "Claude Sonnet 5.5"). The suffix
 * must start at a word boundary and "(latest)" is never stripped, so an alias
 * cannot silently borrow a different pinned version.
 */
function displayNameTariff(
  table: PriceTable | undefined,
  providerID: string,
  nativeName: string,
): ModelTariff | undefined {
  const name = nativeName.trim();
  if (table === undefined || name === "") return undefined;
  let matched: PriceModel | undefined;
  let matches = 0;
  for (const model of Object.values(table[providerID]?.models ?? {})) {
    if (model.name === undefined) continue;
    const catalogName = model.name.trim();
    if (catalogName !== name && !catalogName.endsWith(` ${name}`)) continue;
    matches += 1;
    matched = model;
  }
  // The name itself must be unique, priced or not; a second listing is ambiguity.
  return matches === 1 && matched !== undefined ? catalogTariff(matched) : undefined;
}

export interface TariffLookup {
  readonly table: PriceTable | undefined;
  readonly ref: ModelRef;
  /** The host's model record for this exact route, when the location lists it. */
  readonly native: ModelInfo | undefined;
}

/** An unversioned alias such as "sonnet"; a concrete id carries a version digit. */
function unversioned(modelID: string): boolean {
  return !/\d/u.test(modelID);
}

/**
 * Resolve one route's tariff, strongest evidence first:
 * 1. the host's own usable rates for the exact route;
 * 2. the catalog's exact provider/model entry;
 * 3. the canonical provider with the same explicit model id;
 * 4. the host's resolved model id against the canonical catalog;
 * 5. for an unversioned alias only, an exact display-name match.
 *
 * No other provider's price is borrowed by model id alone, and an ambiguous
 * display name stays unknown.
 */
export function resolveTariff(lookup: TariffLookup): ModelTariff | undefined {
  const { table, ref, native } = lookup;
  const nativeRates = nativeTariff(native?.cost);
  if (nativeRates !== undefined) return nativeRates;

  const direct = lookupCatalog(table, ref.providerID, ref.id);
  if (direct.found) return direct.tariff;

  const explicitCanonical = canonicalPriceProvider(ref.providerID);
  const nativeCanonical =
    native?.canonical === undefined || native.canonical === "" ? undefined : native.canonical;
  const canonical = explicitCanonical ?? nativeCanonical;
  if (canonical !== undefined && canonical !== ref.providerID) {
    const explicit = lookupCatalog(table, canonical, ref.id);
    if (explicit.found) return explicit.tariff;
  }

  if (native !== undefined && native.modelID !== ref.id) {
    const resolved = lookupCatalog(table, canonical, native.modelID);
    if (resolved.found) return resolved.tariff;
  }

  if (explicitCanonical !== undefined && unversioned(ref.id) && native?.name !== undefined) {
    return displayNameTariff(table, explicitCanonical, native.name);
  }
  return undefined;
}

function usableTokens(tokens: TokenUsageInfo): TokenUsageInfo | undefined {
  const { input, output, reasoning } = tokens;
  const { read, write } = tokens.cache;
  const values = [input, output, reasoning, read, write];
  return values.every((value) => Number.isFinite(value) && value >= 0) ? tokens : undefined;
}

function selectRate(tariff: ModelTariff, context: number | undefined): PriceRate {
  if (context === undefined) return tariff.base;
  // The host selects the highest tier strictly below the request context.
  let selected: PriceTier | undefined;
  for (const tier of tariff.tiers) {
    if (context > tier.size) selected = tier;
  }
  return selected ?? tariff.base;
}

/**
 * One request's cost. A tier is applied only when the request's own context is
 * known; aggregated compaction usage passes no context and keeps base rates.
 */
export function usageCost(
  tariff: ModelTariff,
  tokens: TokenUsageInfo,
  aggregated = false,
): number | undefined {
  const usable = usableTokens(tokens);
  if (usable === undefined) return undefined;
  if (tokenTotal(usable) === 0) return 0;
  const context = usable.input + usable.cache.read + usable.cache.write;
  const rate = selectRate(tariff, aggregated ? undefined : context);
  const output = usable.output + usable.reasoning;
  // models.dev omits cache prices for some providers; those tokens bill at input.
  const cacheRead = rate.cacheRead ?? rate.input;
  const cacheWrite = rate.cacheWrite ?? rate.input;
  const cost =
    (usable.input * rate.input +
      output * rate.output +
      usable.cache.read * cacheRead +
      usable.cache.write * cacheWrite) /
    1_000_000;
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/** One completed request's usage; compaction may aggregate several calls. */
export interface UsageRecord {
  readonly tokens: TokenUsageInfo;
  readonly cost: number | undefined;
  readonly model: ModelRef | undefined;
  readonly aggregated: boolean;
}

/**
 * Only completed assistant turns and finished compaction attempts carry final
 * usage. A streaming assistant has partial tokens and is skipped. A message id
 * appears once: the host filters loaded pages against the window but not
 * duplicates inside one fetched batch, so the last payload of a repeated id
 * wins.
 */
export function usageRecords(messages: readonly SessionMessageInfo[]): UsageRecord[] {
  const records = new Map<string, UsageRecord>();
  for (const message of messages) {
    if (message.type === "assistant") {
      if (message.time.completed === undefined || message.tokens === undefined) continue;
      records.set(message.id, {
        tokens: message.tokens,
        cost: message.cost,
        model: message.model,
        aggregated: false,
      });
      continue;
    }
    if (message.type !== "compaction" || message.status === "running") continue;
    if (message.tokens === undefined) continue;
    records.set(message.id, {
      tokens: message.tokens,
      cost: message.cost,
      model: "model" in message ? message.model : undefined,
      aggregated: true,
    });
  }
  return [...records.values()];
}

export interface SessionPrice {
  readonly money: Money | undefined;
  /**
   * Estimated dollars for loaded zero-cost records, not already present in the
   * store's cumulative cost. The loaded window may be incomplete.
   */
  readonly extra: number | undefined;
}

export interface SessionPriceInput {
  /** The store's cumulative reported cost for this session. */
  readonly base: number;
  /**
   * The store's cumulative tokens; not a completeness proof, because the ledger
   * also includes usage with no message record.
   */
  readonly tokens: TokenUsageInfo;
  /** Usage from the loaded message window only. */
  readonly records: readonly UsageRecord[];
  price(ref: ModelRef | undefined, tokens: TokenUsageInfo, aggregated: boolean): number | undefined;
}

/**
 * The reported cumulative cost is authoritative for priced requests. Only
 * zero-cost records are estimated, so a subscription route adds on top instead
 * of replacing what the host already charged. Every loaded record is priced;
 * token coverage is not proof that the window is complete, because the ledger
 * also includes title, generate and reverted usage that has no message. The
 * result therefore covers loaded messages only and may be incomplete.
 *
 * A session with nothing reported and no loaded request that carries usage is
 * unknown rather than priced at one model's tariff.
 */
export function priceSession(input: SessionPriceInput): SessionPrice {
  if (!Number.isFinite(input.base) || input.base < 0) {
    return { money: undefined, extra: undefined };
  }

  let recorded = 0;
  let estimated = 0;
  let covered = 0;
  let estimatedApplied = false;
  let unknown = false;

  for (const record of input.records) {
    const tokens = usableTokens(record.tokens);
    const reported = record.cost;
    if (reported !== undefined && (!Number.isFinite(reported) || reported < 0)) {
      unknown = true;
      continue;
    }
    if (tokens === undefined) {
      unknown = true;
      continue;
    }
    const total = tokenTotal(tokens);
    covered += total;
    if (reported !== undefined && reported > 0) {
      recorded += reported;
      continue;
    }
    if (total === 0) continue;
    const quote = input.price(record.model, record.tokens, record.aggregated);
    if (quote === undefined || !Number.isFinite(quote) || quote < 0) {
      unknown = true;
      continue;
    }
    estimated += quote;
    estimatedApplied = true;
  }

  if (unknown) return { money: undefined, extra: undefined };

  const reported = input.base > 0 ? input.base : recorded;
  if (reported === 0) {
    const sessionTokens = usableTokens(input.tokens);
    if (sessionTokens === undefined) return { money: undefined, extra: undefined };
    // No loaded request carries usage, but the ledger does: title, generate or
    // reverted calls may be the only usage, and none of them has a message.
    if (covered === 0 && tokenTotal(sessionTokens) > 0) {
      return { money: undefined, extra: undefined };
    }
  }

  const usd = reported + estimated;
  if (!Number.isFinite(usd) || usd < 0) return { money: undefined, extra: undefined };
  return {
    money: {
      usd,
      // Free records add nothing to a reported cost, so the total stays exact.
      estimated: estimatedApplied && (estimated > 0 || reported === 0),
    },
    extra: estimated,
  };
}
