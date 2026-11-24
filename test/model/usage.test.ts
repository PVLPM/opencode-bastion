import { describe, expect, it } from "vitest";

import { contextUsage, sessionInterval } from "../../src/model/usage";
import {
  makeAssistant,
  makeCompactionCompleted,
  makeCompactionRunning,
  makeSession,
  makeTokens,
} from "../fixtures";

const used = makeTokens({ input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2 });

interface UsageCase {
  readonly name: string;
  readonly messages: Parameters<typeof contextUsage>[0];
  readonly limit: (ref: { id: string; providerID: string }) => number | undefined;
  readonly expected: ReturnType<typeof contextUsage>;
}

const constant = (limit: number | undefined) => (_ref: { id: string; providerID: string }) => limit;

const usageCases: readonly UsageCase[] = [
  {
    name: "sums every token kind of the latest assistant",
    messages: [makeAssistant({ tokens: used })],
    limit: constant(200),
    expected: { used: 40, limit: 200 },
  },
  {
    name: "skips assistants without tokens",
    messages: [makeAssistant({ created: 1, tokens: used }), makeAssistant({ created: 2 })],
    limit: constant(200),
    expected: { used: 40, limit: 200 },
  },
  {
    name: "a completed compaction resets context",
    messages: [
      makeAssistant({ created: 1, tokens: used }),
      makeCompactionCompleted({ created: 2 }),
    ],
    limit: constant(200),
    expected: undefined,
  },
  {
    name: "a running compaction is not a reset",
    messages: [makeAssistant({ created: 1, tokens: used }), makeCompactionRunning(2)],
    limit: constant(200),
    expected: { used: 40, limit: 200 },
  },
  {
    name: "an assistant newer than a compaction reports usage",
    messages: [
      makeCompactionCompleted({ created: 1 }),
      makeAssistant({ created: 2, tokens: used }),
    ],
    limit: constant(200),
    expected: { used: 40, limit: 200 },
  },
  {
    name: "a zero limit is unknown, never a percentage",
    messages: [makeAssistant({ tokens: used })],
    limit: constant(0),
    expected: undefined,
  },
  {
    name: "a missing limit is unknown",
    messages: [makeAssistant({ tokens: used })],
    limit: constant(undefined),
    expected: undefined,
  },
  {
    name: "a non-finite limit is unknown",
    messages: [makeAssistant({ tokens: used })],
    limit: constant(Number.POSITIVE_INFINITY),
    expected: undefined,
  },
  {
    name: "a non-finite token total is unknown",
    messages: [makeAssistant({ tokens: makeTokens({ input: Number.NaN }) })],
    limit: constant(200),
    expected: undefined,
  },
  {
    name: "no assistant tokens is unknown",
    messages: [],
    limit: constant(200),
    expected: undefined,
  },
  {
    name: "limits the token-bearing assistant by its own model",
    messages: [
      makeAssistant({ created: 1, tokens: used, model: { id: "claude", providerID: "anthropic" } }),
      makeAssistant({ created: 2, model: { id: "gpt", providerID: "openai" } }),
    ],
    limit: (ref) => (ref.id === "claude" ? 100 : 200),
    expected: { used: 40, limit: 100 },
  },
];

describe("contextUsage", () => {
  it.each(usageCases)("$name", ({ messages, limit, expected }) => {
    expect(contextUsage(messages, limit)).toStrictEqual(expected);
  });
});

interface IntervalCase {
  readonly name: string;
  readonly info: ReturnType<typeof makeSession>;
  readonly running: boolean;
  readonly startedAt: number | undefined;
  readonly endedAt: number | undefined;
}

const intervalCases: readonly IntervalCase[] = [
  {
    name: "a running session has no end",
    info: makeSession({ created: 100, idle: 900 }),
    running: true,
    startedAt: 100,
    endedAt: undefined,
  },
  {
    name: "an idle timestamp after creation ends the session",
    info: makeSession({ created: 100, idle: 900 }),
    running: false,
    startedAt: 100,
    endedAt: 900,
  },
  {
    name: "an idle timestamp before creation is not an end",
    info: makeSession({ created: 900, idle: 100 }),
    running: false,
    startedAt: 900,
    endedAt: undefined,
  },
  {
    name: "a missing idle timestamp leaves an inactive session without an end",
    info: makeSession({ created: 100 }),
    running: false,
    startedAt: 100,
    endedAt: undefined,
  },
  {
    name: "a non-finite creation time has no start",
    info: makeSession({ created: Number.NaN }),
    running: false,
    startedAt: undefined,
    endedAt: undefined,
  },
];

describe("sessionInterval", () => {
  it.each(intervalCases)("$name", ({ info, running, startedAt, endedAt }) => {
    expect(sessionInterval(info, running)).toStrictEqual({ startedAt, endedAt });
  });
});
