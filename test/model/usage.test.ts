import { describe, expect, it } from "vitest";

import { contextUsage, sessionInterval } from "../../src/model/usage";
import {
  makeAssistant,
  makeCompactionCompleted,
  makeCompactionRunning,
  makeIdle,
  makeSession,
  makeTokens,
} from "../fixtures";

const used = makeTokens({ input: 10, output: 20, reasoning: 5, cacheRead: 3, cacheWrite: 2 });

interface UsageCase {
  readonly name: string;
  readonly messages: Parameters<typeof contextUsage>[0];
  readonly limit: number | undefined;
  readonly expected: ReturnType<typeof contextUsage>;
}

const usageCases: readonly UsageCase[] = [
  {
    name: "sums every token kind of the latest assistant",
    messages: [makeAssistant({ tokens: used })],
    limit: 200,
    expected: { used: 40, limit: 200 },
  },
  {
    name: "skips assistants without tokens",
    messages: [makeAssistant({ created: 1, tokens: used }), makeAssistant({ created: 2 })],
    limit: 200,
    expected: { used: 40, limit: 200 },
  },
  {
    name: "a completed compaction resets context",
    messages: [
      makeAssistant({ created: 1, tokens: used }),
      makeCompactionCompleted({ created: 2 }),
    ],
    limit: 200,
    expected: undefined,
  },
  {
    name: "a running compaction is not a reset",
    messages: [makeAssistant({ created: 1, tokens: used }), makeCompactionRunning(2)],
    limit: 200,
    expected: { used: 40, limit: 200 },
  },
  {
    name: "an assistant newer than a compaction reports usage",
    messages: [
      makeCompactionCompleted({ created: 1 }),
      makeAssistant({ created: 2, tokens: used }),
    ],
    limit: 200,
    expected: { used: 40, limit: 200 },
  },
  {
    name: "a zero limit is unknown, never a percentage",
    messages: [makeAssistant({ tokens: used })],
    limit: 0,
    expected: undefined,
  },
  {
    name: "a missing limit is unknown",
    messages: [makeAssistant({ tokens: used })],
    limit: undefined,
    expected: undefined,
  },
  {
    name: "no assistant tokens is unknown",
    messages: [],
    limit: 200,
    expected: undefined,
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
  readonly messages: Parameters<typeof sessionInterval>[2];
  readonly endedAt: number | undefined;
}

const intervalCases: readonly IntervalCase[] = [
  {
    name: "a running session has no end",
    info: makeSession({ created: 100, idle: 900 }),
    running: true,
    messages: [],
    endedAt: undefined,
  },
  {
    name: "an idle timestamp after creation ends the session",
    info: makeSession({ created: 100, idle: 900 }),
    running: false,
    messages: [makeIdle("succeeded", undefined, 500)],
    endedAt: 900,
  },
  {
    name: "an idle timestamp before creation falls back to the latest message",
    info: makeSession({ created: 900, idle: 100 }),
    running: false,
    messages: [makeIdle("succeeded", undefined, 950), makeAssistant({ created: 1_000 })],
    endedAt: 1_000,
  },
  {
    name: "a missing idle timestamp falls back to the latest message",
    info: makeSession({ created: 100 }),
    running: false,
    messages: [makeAssistant({ created: 400 })],
    endedAt: 400,
  },
  {
    name: "no idle timestamp and no messages is unknown",
    info: makeSession({ created: 100 }),
    running: false,
    messages: [],
    endedAt: undefined,
  },
];

describe("sessionInterval", () => {
  it.each(intervalCases)("$name", ({ info, running, messages, endedAt }) => {
    expect(sessionInterval(info, running, messages)).toStrictEqual({
      startedAt: info.time.created,
      endedAt,
    });
  });
});
