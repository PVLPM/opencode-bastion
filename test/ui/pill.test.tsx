import { describe, expect, it } from "vitest";

import type { FleetView } from "../../src/model/types";
import { pillView } from "../../src/ui/pill";
import { runningChild, testFleet, testRoot, waitingChild } from "./fixtures";

interface Case {
  readonly name: string;
  readonly fleet: FleetView | undefined;
  readonly expected: ReturnType<typeof pillView>;
}

const cases: readonly Case[] = [
  {
    name: "returns nothing without a fleet",
    fleet: undefined,
    expected: undefined,
  },
  {
    name: "returns nothing without subagents",
    fleet: testFleet(testRoot(), []),
    expected: undefined,
  },
  {
    name: "reports running subagents",
    fleet: testFleet(testRoot({ status: "done", endedAt: 1 }), [runningChild()]),
    expected: { label: "2 agents · 1 running", icon: "sessions-stack" },
  },
  {
    name: "puts waiting before running",
    fleet: testFleet(testRoot(), [runningChild(), waitingChild()]),
    expected: { label: "3 agents · 1 needs you", icon: "circle-exclamation", tone: "warning" },
  },
  {
    name: "counts plural waiting grammatically",
    fleet: testFleet(testRoot(), [
      waitingChild(),
      waitingChild({ sessionID: "ses_child_c", agent: "Planner" }),
    ]),
    expected: { label: "3 agents · 2 need you", icon: "circle-exclamation", tone: "warning" },
  },
  {
    name: "reports a failure when nothing needs the user",
    fleet: testFleet(testRoot(), [runningChild({ status: "failed", endedAt: 2 })]),
    expected: { label: "2 agents · 1 failed", icon: "circle-x", tone: "danger" },
  },
  {
    name: "settles to a done state when nothing runs",
    fleet: testFleet(testRoot({ status: "done", endedAt: 2 }), [
      runningChild({ status: "done", endedAt: 2 }),
    ]),
    expected: { label: "2 agents", icon: "check-small", tone: "success" },
  },
  {
    name: "stays neutral when an outcome is unknown",
    fleet: testFleet(testRoot({ status: "unknown", statusDetail: "Interrupted" }), [
      runningChild({ status: "done", endedAt: 2 }),
    ]),
    expected: { label: "2 agents", icon: "sessions-stack" },
  },
];

describe("pillView", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(pillView(testCase.fleet)).toEqual(testCase.expected);
    });
  }
});
