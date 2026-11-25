import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatDuration,
  formatElapsed,
  formatMoney,
  formatTokenMetric,
  formatTokens,
} from "../../src/model/format";
import type { Money } from "../../src/model/types";

const durationCases: readonly (readonly [number, string])[] = [
  [0, "0s"],
  [12_000, "12s"],
  [59_900, "59s"],
  [245_000, "4m 05s"],
  [3_720_000, "1h 02m"],
  [7_500_000, "2h 05m"],
];

const moneyCases: readonly (readonly [Money, string])[] = [
  [{ usd: 0.29, estimated: false }, "$0.29"],
  [{ usd: 0.29, estimated: true }, "~$0.29"],
  [{ usd: 0, estimated: false }, "$0.00"],
  [{ usd: 0.004, estimated: false }, "<$0.01"],
  [{ usd: 0.004, estimated: true }, "~<$0.01"],
];

const tokenCases: readonly (readonly [number, string])[] = [
  [0, "0"],
  [999, "999"],
  [1_000, "1.0k"],
  [12_400, "12.4k"],
  [1_200_000, "1.2M"],
];

interface ElapsedCase {
  readonly name: string;
  readonly startedAt: number | undefined;
  readonly endedAt: number | undefined;
  readonly now: number;
  readonly active: boolean;
  readonly expected: string | undefined;
}

const elapsedCases: readonly ElapsedCase[] = [
  {
    name: "an active member without an end uses now",
    startedAt: 1_000,
    endedAt: undefined,
    now: 13_000,
    active: true,
    expected: "12s",
  },
  {
    name: "an inactive member without an end has no duration",
    startedAt: 1_000,
    endedAt: undefined,
    now: 13_000,
    active: false,
    expected: undefined,
  },
  {
    name: "an ended member uses its end",
    startedAt: 1_000,
    endedAt: 6_000,
    now: 99_000,
    active: false,
    expected: "5s",
  },
  {
    name: "a missing start has no duration",
    startedAt: undefined,
    endedAt: 6_000,
    now: 99_000,
    active: true,
    expected: undefined,
  },
  {
    name: "an end before the start has no duration",
    startedAt: 6_000,
    endedAt: 5_000,
    now: 99_000,
    active: false,
    expected: undefined,
  },
  {
    name: "a non-finite now has no duration",
    startedAt: 1_000,
    endedAt: undefined,
    now: Number.POSITIVE_INFINITY,
    active: true,
    expected: undefined,
  },
];

describe("formatDuration", () => {
  it.each(durationCases)("formats %i ms as %s", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });
});

describe("formatElapsed", () => {
  it.each(elapsedCases)("$name", ({ startedAt, endedAt, now, active, expected }) => {
    expect(formatElapsed(startedAt, endedAt, now, active)).toBe(expected);
  });
});

describe("formatMoney", () => {
  it.each(moneyCases)("formats %o as %s", (money, expected) => {
    expect(formatMoney(money)).toBe(expected);
  });
});

describe("formatTokens", () => {
  it.each(tokenCases)("formats %i as %s", (count, expected) => {
    expect(formatTokens(count)).toBe(expected);
  });
});

describe("formatTokenMetric", () => {
  const metricCases: readonly (readonly [number, string])[] = [
    [0, "0 tok"],
    [12_400, "12.4k tok"],
    [1_200_000, "1.2M tok"],
  ];

  it.each(metricCases)("formats %i as %s", (count, expected) => {
    expect(formatTokenMetric(count)).toBe(expected);
  });
});

describe("formatClock", () => {
  it("renders a local time", () => {
    expect(formatClock(0)).toContain(":");
  });
});
