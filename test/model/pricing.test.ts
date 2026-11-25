import type {
  JsonValue,
  ModelInfo,
  ModelRef,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";
import { describe, expect, it } from "vitest";

import {
  canonicalPriceProvider,
  nativeTariff,
  parsePriceTable,
  priceSession,
  resolveTariff,
  usageCost,
  usageRecords,
  type ModelTariff,
  type PriceTable,
} from "../../src/model/pricing";
import {
  makeAssistant,
  makeCompactionCompleted,
  makeCompactionRunning,
  makeModel,
  makeTokens,
} from "../fixtures";

const table: PriceTable = {
  anthropic: {
    models: {
      "claude-x": {
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        name: "Claude X",
      },
      "claude-sonnet-4-5": { cost: { input: 3, output: 15 }, name: "Claude Sonnet 4.5 (latest)" },
      "claude-sonnet-5-5": { cost: { input: 2, output: 10 }, name: "Claude Sonnet 5.5" },
      tiered: {
        cost: { input: 1, output: 2 },
        tiers: [
          { size: 200, input: 4, output: 8, cacheRead: 0.4, cacheWrite: 0.8 },
          { size: 100, input: 2, output: 4, cacheRead: 0.2, cacheWrite: 0.4 },
        ],
        name: "Tiered",
      },
      free: { cost: { input: 0, output: 0 }, name: "Free" },
      unpriced: { name: "Unpriced" },
    },
  },
  gateway: {
    models: {
      "claude-x": { cost: { input: 4, output: 20 } },
      solo: { cost: { input: 1, output: 2 } },
      "unique-model": { cost: { input: 1, output: 2 } },
    },
  },
  openrouter: {
    models: {
      "claude-sonnet-4-5": { cost: { input: 4, output: 20 } },
      "claude-sonnet-5-5": { cost: { input: 9, output: 9 } },
    },
  },
};

const ref = (providerID: string, id: string): ModelRef => ({ providerID, id });

function nativeModel(values: Partial<Parameters<typeof makeModel>[0]> = {}): ModelInfo {
  return makeModel({
    providerID: "claude-agent",
    modelID: "sonnet",
    id: "sonnet",
    name: "Sonnet 5.5",
    cost: [],
    ...values,
  });
}

const claudeTariff: ModelTariff = {
  base: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  tiers: [],
};

describe("parsePriceTable", () => {
  it("keeps names, context tiers and an explicit free price", () => {
    const parsed = parsePriceTable({
      anthropic: {
        models: {
          sonnet: {
            name: "Claude Sonnet 5.5",
            cost: {
              input: 2,
              output: 10,
              tiers: [
                { tier: { type: "context", size: 200 }, input: 4, output: 20 },
                { tier: { type: "context", size: 100 }, input: 3, output: 15 },
              ],
            },
          },
          free: { name: "Free", cost: { input: 0, output: 0 } },
          nullCache: {
            name: "Null cache",
            cost: { input: 1, output: 2, cache_read: null, cache_write: null },
          },
        },
      },
    });

    expect(parsed).toStrictEqual({
      anthropic: {
        models: {
          sonnet: {
            name: "Claude Sonnet 5.5",
            cost: { input: 2, output: 10 },
            tiers: [
              { size: 100, input: 3, output: 15 },
              { size: 200, input: 4, output: 20 },
            ],
          },
          free: { name: "Free", cost: { input: 0, output: 0 } },
          nullCache: { name: "Null cache", cost: { input: 1, output: 2 } },
        },
      },
    });
  });

  it("keeps a valid base cost when cache or tiers are unreadable", () => {
    const parsed = parsePriceTable({
      missing: 5,
      noModels: {},
      emptyModels: null,
      textModels: { models: "nope" },
      good: {
        models: {
          noCost: { name: "No cost" },
          textModel: "nope",
          badInput: { cost: { input: "free", output: 1 } },
          badCache: { cost: { input: 1, output: 2, cache_read: "cheap" } },
          badTier: { cost: { input: 1, output: 2, tiers: [{}] } },
          valid: { cost: { input: 1, output: 2 } },
        },
      },
    });

    expect(parsed).toStrictEqual({
      good: {
        models: {
          noCost: { name: "No cost" },
          badCache: { cost: { input: 1, output: 2 } },
          badTier: { cost: { input: 1, output: 2 } },
          valid: { cost: { input: 1, output: 2 } },
        },
      },
    } satisfies PriceTable);
  });

  it("rejects an unreadable root", () => {
    for (const payload of [undefined, null, ["p"], "p"] satisfies (JsonValue | undefined)[]) {
      expect(parsePriceTable(payload)).toBeUndefined();
    }
  });
});

describe("nativeTariff", () => {
  it("uses usable host rates and sorts their context tiers", () => {
    const tariff = nativeTariff([
      { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
      {
        tier: { type: "context", size: 200 },
        input: 4,
        output: 20,
        cache: { read: 0.4, write: 5 },
      },
      {
        tier: { type: "context", size: 100 },
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    ]);

    expect(tariff).toStrictEqual({
      base: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      tiers: [
        { size: 100, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        { size: 200, input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      ],
    });
  });

  it("treats an all-zero host tariff as ambiguous", () => {
    expect(
      nativeTariff([
        { input: 0, output: 0, cache: { read: 0, write: 0 } },
        {
          tier: { type: "context", size: 100 },
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        },
      ]),
    ).toBeUndefined();
  });

  it("keeps a free base when a tier is paid", () => {
    expect(
      nativeTariff([
        { input: 0, output: 0, cache: { read: 0, write: 0 } },
        {
          tier: { type: "context", size: 100 },
          input: 2,
          output: 4,
          cache: { read: 0, write: 0 },
        },
      ]),
    ).toStrictEqual({
      base: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      tiers: [{ size: 100, input: 2, output: 4, cacheRead: 0, cacheWrite: 0 }],
    });
  });

  it("requires a base entry", () => {
    expect(
      nativeTariff([
        {
          tier: { type: "context", size: 100 },
          input: 2,
          output: 4,
          cache: { read: 0, write: 0 },
        },
      ]),
    ).toBeUndefined();
  });

  it("rejects a tariff with an invalid rate", () => {
    expect(
      nativeTariff([{ input: Number.NaN, output: 1, cache: { read: 0, write: 0 } }]),
    ).toBeUndefined();
  });
});

describe("resolveTariff", () => {
  it("prefers the host's usable rates for the exact route", () => {
    const host = nativeModel({
      providerID: "anthropic",
      modelID: "claude-x",
      id: "claude-x",
      cost: [{ input: 7, output: 70, cache: { read: 0.7, write: 7 } }],
    });

    expect(resolveTariff({ table, ref: ref("anthropic", "claude-x"), native: host })).toStrictEqual(
      { base: { input: 7, output: 70, cacheRead: 0.7, cacheWrite: 7 }, tiers: [] },
    );
  });

  it("uses the catalog's exact provider and model", () => {
    expect(
      resolveTariff({ table, ref: ref("anthropic", "claude-x"), native: undefined }),
    ).toStrictEqual(claudeTariff);
  });

  it("prices an explicit versioned id through the canonical provider", () => {
    expect(
      resolveTariff({
        table,
        ref: ref("claude-agent", "claude-sonnet-4-5"),
        native: nativeModel({ modelID: "claude-sonnet-4-5", id: "claude-sonnet-4-5" }),
      }),
    ).toStrictEqual({ base: { input: 3, output: 15 }, tiers: [] });
  });

  it("uses the host's resolved model id against the canonical catalog", () => {
    expect(
      resolveTariff({
        table,
        ref: ref("claude-agent", "sonnet"),
        native: nativeModel({ modelID: "claude-sonnet-5-5" }),
      }),
    ).toStrictEqual({ base: { input: 2, output: 10 }, tiers: [] });
  });

  it("matches an unversioned alias by its native display name", () => {
    expect(
      resolveTariff({ table, ref: ref("claude-agent", "sonnet"), native: nativeModel() }),
    ).toStrictEqual({ base: { input: 2, output: 10 }, tiers: [] });
  });

  it("does not strip a (latest) suffix to find a price", () => {
    const host = nativeModel({ modelID: "sonnet", name: "Sonnet 4.5" });

    expect(
      resolveTariff({ table, ref: ref("claude-agent", "sonnet"), native: host }),
    ).toBeUndefined();
  });

  it("fails closed when a display name is ambiguous", () => {
    const ambiguous: PriceTable = {
      anthropic: {
        models: {
          a: { name: "Claude Sonnet 5.5", cost: { input: 1, output: 1 } },
          b: { name: "Sonnet 5.5" },
        },
      },
    };

    expect(
      resolveTariff({
        table: ambiguous,
        ref: ref("claude-agent", "sonnet"),
        native: nativeModel(),
      }),
    ).toBeUndefined();
  });

  it("does not borrow a canonical price for an explicitly unpriced route", () => {
    const unpriced: PriceTable = {
      "claude-agent": {
        models: { "claude-sonnet-4-5": { name: "Sonnet 4.5" } },
      },
      anthropic: {
        models: { "claude-sonnet-4-5": { cost: { input: 3, output: 15 } } },
      },
    };

    expect(
      resolveTariff({
        table: unpriced,
        ref: ref("claude-agent", "claude-sonnet-4-5"),
        native: nativeModel({ modelID: "claude-sonnet-4-5", id: "claude-sonnet-4-5" }),
      }),
    ).toBeUndefined();
  });

  it("never borrows a price from another provider by a unique model id", () => {
    expect(
      resolveTariff({ table, ref: ref("missing", "unique-model"), native: undefined }),
    ).toBeUndefined();
  });

  it("leaves a listed but unpriced model unknown", () => {
    expect(
      resolveTariff({ table, ref: ref("anthropic", "unpriced"), native: undefined }),
    ).toBeUndefined();
  });

  it("keeps an explicit free catalog price", () => {
    expect(
      resolveTariff({ table, ref: ref("anthropic", "free"), native: undefined }),
    ).toStrictEqual({ base: { input: 0, output: 0 }, tiers: [] });
  });

  it("falls back to the catalog when the host's tariff is all zero", () => {
    const host = nativeModel({
      providerID: "anthropic",
      modelID: "claude-x",
      id: "claude-x",
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    });

    expect(resolveTariff({ table, ref: ref("anthropic", "claude-x"), native: host })).toStrictEqual(
      claudeTariff,
    );
  });
});

describe("usageCost", () => {
  it("prices input, output, reasoning and cache buckets", () => {
    expect(
      usageCost(
        claudeTariff,
        makeTokens({
          input: 1_000_000,
          output: 1_000_000,
          reasoning: 1_000_000,
          cacheRead: 1_000_000,
          cacheWrite: 1_000_000,
        }),
      ),
    ).toBeCloseTo(3 + 15 + 15 + 0.3 + 3.75);
  });

  it("prices cache at the input rate when the tariff omits it", () => {
    expect(
      usageCost(
        { base: { input: 4, output: 20 }, tiers: [] },
        makeTokens({ cacheRead: 1_000_000, cacheWrite: 1_000_000 }),
      ),
    ).toBe(8);
  });

  it("uses a context tier only when the request context is strictly above its size", () => {
    const tariff: ModelTariff = {
      base: { input: 1, output: 2 },
      tiers: [
        { size: 100, input: 2, output: 4 },
        { size: 200, input: 4, output: 8 },
      ],
    };

    expect(usageCost(tariff, makeTokens({ input: 100 }))).toBeCloseTo(0.0001);
    expect(usageCost(tariff, makeTokens({ input: 101 }))).toBeCloseTo(0.000202);
    expect(usageCost(tariff, makeTokens({ input: 201 }))).toBeCloseTo(0.000804);
  });

  it("keeps base rates for aggregated compaction usage", () => {
    const tariff: ModelTariff = {
      base: { input: 1, output: 2 },
      tiers: [
        { size: 10, input: 2, output: 4 },
        { size: 200, input: 4, output: 8 },
      ],
    };

    expect(usageCost(tariff, makeTokens({ input: 1_000_000 }), true)).toBe(1);
    expect(usageCost(tariff, makeTokens({ input: 1_000_000 }))).toBe(4);
  });

  it("counts cache tokens in the request context", () => {
    const tariff: ModelTariff = {
      base: { input: 1, output: 2 },
      tiers: [{ size: 100, input: 9, output: 9 }],
    };

    expect(usageCost(tariff, makeTokens({ cacheRead: 101 }))).toBeCloseTo((101 * 9) / 1_000_000);
  });

  it("reports zero tokens as exact zero", () => {
    expect(usageCost(claudeTariff, makeTokens())).toBe(0);
  });

  it("rejects invalid token counters", () => {
    expect(usageCost(claudeTariff, makeTokens({ input: Number.NaN }))).toBeUndefined();
    expect(usageCost(claudeTariff, makeTokens({ output: -1 }))).toBeUndefined();
  });
});

describe("usageRecords", () => {
  it("keeps completed assistant turns and finished compaction attempts", () => {
    const records = usageRecords([
      makeAssistant({ tokens: makeTokens({ input: 1 }), completed: 10 }),
      makeAssistant({ tokens: makeTokens({ input: 2 }) }),
      makeCompactionCompleted({ tokens: makeTokens({ input: 3 }), cost: 0.5 }),
      makeCompactionRunning(),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ aggregated: false, cost: undefined });
    expect(records[1]).toMatchObject({ aggregated: true, cost: 0.5 });
  });
});

interface SessionCase {
  readonly name: string;
  readonly base: number;
  readonly sessionTokens: TokenUsageInfo;
  readonly records: readonly SessionMessageInfo[];
  readonly price?: (tokens: TokenUsageInfo, aggregated: boolean) => number | undefined;
  readonly expected: { usd: number; estimated: boolean } | undefined;
  readonly expectedExtra?: number;
}

const sessionCases: readonly SessionCase[] = [
  {
    name: "keeps a reported cost with no records",
    base: 0.7,
    sessionTokens: makeTokens({ input: 1_000 }),
    records: [],
    expected: { usd: 0.7, estimated: false },
    expectedExtra: 0,
  },
  {
    name: "adds an estimate for a zero-cost record",
    base: 0.7,
    sessionTokens: makeTokens({ input: 1_000 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 500 }), cost: 0, completed: 10 })],
    price: (tokens) => tokens.input / 1_000,
    expected: { usd: 1.2, estimated: true },
    expectedExtra: 0.5,
  },
  {
    name: "prices every record when nothing was reported",
    base: 0,
    sessionTokens: makeTokens({ input: 600 }),
    records: [
      makeAssistant({ tokens: makeTokens({ input: 100 }), completed: 10 }),
      makeAssistant({ tokens: makeTokens({ input: 500 }), completed: 20 }),
    ],
    price: (tokens) => tokens.input / 1_000,
    expected: { usd: 0.6, estimated: true },
    expectedExtra: 0.6,
  },
  {
    name: "leaves the total unknown when only part of an unreported session is loaded",
    base: 0,
    sessionTokens: makeTokens({ input: 900 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 500 }), completed: 10 })],
    price: (tokens) => tokens.input / 1_000,
    expected: undefined,
  },
  {
    name: "keeps the reported cost when the loaded window is partial",
    base: 0.7,
    sessionTokens: makeTokens({ input: 900 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 500 }), cost: 0.2, completed: 10 })],
    price: (tokens) => tokens.input / 1_000,
    expected: { usd: 0.7, estimated: false },
    expectedExtra: 0,
  },
  {
    name: "leaves the total unknown when a zero-cost record cannot be priced",
    base: 0.7,
    sessionTokens: makeTokens({ input: 500 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 500 }), completed: 10 })],
    expected: undefined,
  },
  {
    name: "keeps a positive record cost when the session total is zero",
    base: 0,
    sessionTokens: makeTokens({ input: 100 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 100 }), cost: 0.25, completed: 10 })],
    expected: { usd: 0.25, estimated: false },
    expectedExtra: 0,
  },
  {
    name: "treats an explicit free record as an estimated zero",
    base: 0,
    sessionTokens: makeTokens({ input: 100 }),
    records: [makeAssistant({ tokens: makeTokens({ input: 100 }), completed: 10 })],
    price: () => 0,
    expected: { usd: 0, estimated: true },
    expectedExtra: 0,
  },
  {
    name: "ignores a zero-token record",
    base: 0,
    sessionTokens: makeTokens(),
    records: [makeAssistant({ tokens: makeTokens(), completed: 10 })],
    price: () => 99,
    expected: { usd: 0, estimated: false },
    expectedExtra: 0,
  },
  {
    name: "leaves an invalid base unknown",
    base: Number.NaN,
    sessionTokens: makeTokens(),
    records: [],
    expected: undefined,
  },
];

describe("priceSession", () => {
  it.each(sessionCases)("$name", ({
    base,
    sessionTokens,
    records,
    price,
    expected,
    expectedExtra,
  }) => {
    const result = priceSession({
      base,
      tokens: sessionTokens,
      records: usageRecords(records),
      price: (_ref, tokens, aggregated) => price?.(tokens, aggregated),
    });

    expect(result.money).toStrictEqual(expected);
    if (expected !== undefined) expect(result.extra).toBe(expectedExtra);
  });

  it("passes compaction usage as aggregated", () => {
    const calls: boolean[] = [];
    priceSession({
      base: 0,
      tokens: makeTokens({ input: 10 }),
      records: usageRecords([makeCompactionCompleted({ tokens: makeTokens({ input: 10 }) })]),
      price: (_ref, _tokens, aggregated) => {
        calls.push(aggregated);
        return 0;
      },
    });

    expect(calls).toStrictEqual([true]);
  });
});

describe("canonicalPriceProvider", () => {
  it.each([
    ["claude-agent", "anthropic"],
    ["google-vertex-anthropic", "anthropic"],
    ["Claude-Agent", "anthropic"],
    ["openai", undefined],
  ] satisfies (readonly [
    string,
    string | undefined,
  ])[])("maps %s to %s", (providerID, expected) => {
    expect(canonicalPriceProvider(providerID)).toBe(expected);
  });
});
