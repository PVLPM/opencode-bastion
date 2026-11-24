import { describe, expect, it } from "vitest";

import { estimateCost, resolveCost, type PriceTable } from "../../src/model/pricing";
import { makeTokens } from "../fixtures";

const table = {
  anthropic: {
    models: {
      "claude-x": {
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
  gateway: {
    models: {
      "claude-x": { cost: { input: 4, output: 20 } },
      solo: { cost: { input: 1, output: 2 } },
      "unique-model": { cost: { input: 1, output: 2 } },
    },
  },
  "no-cost": { models: { "claude-x": {} } },
  other: { models: { solo: { cost: { input: 9, output: 9 } } } },
} satisfies PriceTable;

const claude = { providerID: "anthropic", modelID: "claude-x" };
const million = makeTokens({ input: 1_000_000, output: 1_000_000 });

interface EstimateCase {
  readonly name: string;
  readonly tokens: ReturnType<typeof makeTokens>;
  readonly model: { providerID: string; modelID: string };
  readonly canonical: string | undefined;
  readonly expected: number | undefined;
}

const estimateCases: readonly EstimateCase[] = [
  {
    name: "prices input and output per million",
    tokens: million,
    model: claude,
    canonical: undefined,
    expected: 18,
  },
  {
    name: "prices cache reads at the cache rate",
    tokens: makeTokens({ cacheRead: 1_000_000 }),
    model: claude,
    canonical: undefined,
    expected: 0.3,
  },
  {
    name: "prices cache writes at the cache rate",
    tokens: makeTokens({ cacheWrite: 1_000_000 }),
    model: claude,
    canonical: undefined,
    expected: 3.75,
  },
  {
    name: "falls back to the input price for unpriced cache reads",
    tokens: makeTokens({ cacheRead: 1_000_000 }),
    model: { providerID: "gateway", modelID: "claude-x" },
    canonical: undefined,
    expected: 4,
  },
  {
    name: "prices reasoning at the output rate",
    tokens: makeTokens({ reasoning: 1_000_000 }),
    model: claude,
    canonical: undefined,
    expected: 15,
  },
  {
    name: "uses the canonical provider when the direct one is missing",
    tokens: million,
    model: { providerID: "anthropic-direct", modelID: "claude-x" },
    canonical: "anthropic",
    expected: 18,
  },
  {
    name: "uses a model id that is unique across providers",
    tokens: million,
    model: { providerID: "missing", modelID: "unique-model" },
    canonical: undefined,
    expected: 3,
  },
  {
    name: "refuses an ambiguous model id",
    tokens: million,
    model: { providerID: "missing", modelID: "solo" },
    canonical: undefined,
    expected: undefined,
  },
  {
    name: "returns undefined when nothing matches",
    tokens: million,
    model: { providerID: "missing", modelID: "unknown" },
    canonical: undefined,
    expected: undefined,
  },
];

describe("estimateCost", () => {
  it.each(estimateCases)("$name", ({ tokens, model, canonical, expected }) => {
    expect(estimateCost(tokens, model, table, canonical)).toBe(expected);
  });
});

interface ResolveCase {
  readonly name: string;
  readonly reported: number;
  readonly tokens: ReturnType<typeof makeTokens>;
  readonly model: { providerID: string; modelID: string };
  readonly expected: { usd: number; estimated: boolean } | undefined;
}

const resolveCases: readonly ResolveCase[] = [
  {
    name: "keeps a reported cost",
    reported: 0.5,
    tokens: million,
    model: claude,
    expected: { usd: 0.5, estimated: false },
  },
  {
    name: "reports zero for an unused session",
    reported: 0,
    tokens: makeTokens(),
    model: claude,
    expected: { usd: 0, estimated: false },
  },
  {
    name: "estimates when tokens exist but no cost was reported",
    reported: 0,
    tokens: million,
    model: claude,
    expected: { usd: 18, estimated: true },
  },
  {
    name: "is unknown when tokens cannot be priced",
    reported: 0,
    tokens: million,
    model: { providerID: "missing", modelID: "unknown" },
    expected: undefined,
  },
];

describe("resolveCost", () => {
  it.each(resolveCases)("$name", ({ reported, tokens, model, expected }) => {
    expect(resolveCost(reported, tokens, model, table)).toStrictEqual(expected);
  });
});
