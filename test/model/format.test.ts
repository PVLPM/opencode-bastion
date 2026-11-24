import { describe, expect, it } from "vitest";

import { formatDuration, formatMoney, formatTokens } from "../../src/model/format";
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

describe("formatDuration", () => {
  it.each(durationCases)("formats %i ms as %s", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
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
