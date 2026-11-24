import type { SessionMessageInfo, TokenUsageInfo } from "@opencode/client/promise";
import { describe, expect, it } from "vitest";

import { buildFleet, type FleetInput, type SessionSnapshot } from "../../src/model/fleet";
import type { LineStats, ModelLabel, Money } from "../../src/model/types";
import { makeAssistant, makeSession, makeTokens, makeTool, type SessionValues } from "../fixtures";

interface SnapshotValues extends SessionValues {
  running?: boolean;
  messages?: readonly SessionMessageInfo[];
  permissions?: number;
  forms?: number;
  lines?: LineStats;
}

function snapshot(values: SnapshotValues = {}): SessionSnapshot {
  return {
    info: makeSession(values),
    running: values.running ?? false,
    messages: values.messages ?? [],
    permissions: values.permissions ?? 0,
    forms: values.forms ?? 0,
    lines: values.lines,
  };
}

function fleetInput(overrides: Partial<FleetInput> = {}): FleetInput {
  return {
    root: snapshot(),
    children: [],
    currentID: "ses-root",
    agentName: (id) => id,
    modelLabel: () => undefined,
    contextLimit: () => undefined,
    price: () => undefined,
    familyCost: 0,
    ...overrides,
  };
}

function subagentCall(id: string, childID: string, description: string) {
  return makeTool({
    id,
    name: "subagent",
    input: { agent: "designer", description, prompt: `${description} prompt` },
    metadata: { sessionID: childID },
  });
}

describe("buildFleet", () => {
  it("shows a just-created child as running and starting", () => {
    const input = fleetInput({
      children: [snapshot({ id: "ses-child", created: 500, running: true })],
    });
    const fleet = buildFleet(input);
    const child = fleet.active[0];

    expect(child).toMatchObject({
      sessionID: "ses-child",
      status: "running",
      activity: "Starting…",
      startedAt: 500,
      endedAt: undefined,
    });
  });

  it("leaves context unknown when the model has no usable limit", () => {
    const label: ModelLabel = { providerID: "p", modelID: "m", name: "M" };
    const input = fleetInput({
      root: snapshot({
        messages: [makeAssistant({ tokens: makeTokens({ input: 10 }) })],
        model: { id: "m", providerID: "p" },
      }),
      contextLimit: () => 0,
      modelLabel: () => label,
    });
    const fleet = buildFleet(input);

    expect(fleet.root.context).toBeUndefined();
    expect(fleet.root.model).toStrictEqual(label);
  });

  it("leaves cost unknown when nothing can be priced", () => {
    const input = fleetInput({
      children: [snapshot({ id: "ses-child", tokens: makeTokens({ input: 100 }), cost: 0 })],
    });
    const fleet = buildFleet(input);

    expect(fleet.active[0]?.cost).toBeUndefined();
  });

  it("uses the latest delegation for the task text", () => {
    const rootMessages = [
      makeAssistant({ content: [subagentCall("tool-1", "ses-child", "First pass")] }),
      makeAssistant({ content: [subagentCall("tool-2", "ses-child", "Final pass")] }),
    ];
    const input = fleetInput({
      root: snapshot({ messages: rootMessages }),
      children: [snapshot({ id: "ses-child", running: true })],
    });
    const fleet = buildFleet(input);

    expect(fleet.active).toHaveLength(1);
    expect(fleet.active[0]?.task).toBe("Final pass");
    expect(fleet.active[0]?.prompt).toBe("Final pass prompt");
  });

  it("sorts active children oldest first and inactive children newest first", () => {
    const input = fleetInput({
      children: [
        snapshot({ id: "ses-a", created: 100, idle: 900, outcome: "succeeded" }),
        snapshot({ id: "ses-b", created: 100, idle: 500, outcome: "succeeded" }),
        snapshot({ id: "ses-c", created: 100, running: true }),
        snapshot({ id: "ses-d", created: 50, running: true }),
        snapshot({ id: "ses-e", created: 100 }),
      ],
    });
    const fleet = buildFleet(input);

    expect(fleet.active.map((agent) => agent.sessionID)).toStrictEqual(["ses-d", "ses-c"]);
    expect(fleet.inactive.map((agent) => agent.sessionID)).toStrictEqual([
      "ses-a",
      "ses-b",
      "ses-e",
    ]);
  });

  it("reports the family cost when every member is reported", () => {
    const input = fleetInput({
      root: snapshot({ id: "ses-root", cost: 0.7 }),
      children: [
        snapshot({ id: "ses-child", created: 1, outcome: "succeeded", cost: 0.3, idle: 2 }),
      ],
      familyCost: 1,
    });
    const fleet = buildFleet(input);

    expect(fleet.totalCost).toStrictEqual({ usd: 1, estimated: false });
  });

  it("re-estimates the whole family when any member is estimated", () => {
    const price = (tokens: TokenUsageInfo): Money | undefined =>
      tokens.input > 0 ? { usd: tokens.input / 1_000, estimated: true } : undefined;
    const input = fleetInput({
      root: snapshot({ id: "ses-root", tokens: makeTokens({ input: 1_000 }) }),
      children: [
        snapshot({
          id: "ses-child",
          created: 1,
          running: true,
          tokens: makeTokens({ input: 3_000 }),
        }),
      ],
      price,
    });
    const fleet = buildFleet(input);

    expect(fleet.totalCost).toStrictEqual({ usd: 4, estimated: true });
  });

  it("leaves the family total unknown when an estimated member cannot be priced", () => {
    const price = (tokens: TokenUsageInfo): Money | undefined =>
      tokens.input > 0 ? { usd: tokens.input / 1_000, estimated: true } : undefined;
    const input = fleetInput({
      root: snapshot({ id: "ses-root", tokens: makeTokens({ input: 1_000 }) }),
      children: [snapshot({ id: "ses-child", created: 1, running: true })],
      price,
    });
    const fleet = buildFleet(input);

    expect(fleet.totalCost).toBeUndefined();
  });

  it("marks only the routed session as current", () => {
    const input = fleetInput({
      children: [snapshot({ id: "ses-child", running: true })],
      currentID: "ses-child",
    });
    const fleet = buildFleet(input);

    expect(fleet.root.current).toBe(false);
    expect(fleet.active[0]?.current).toBe(true);
  });

  it("passes line stats through", () => {
    const lines = { added: 12, removed: 3 };
    const fleet = buildFleet(fleetInput({ root: snapshot({ lines }) }));

    expect(fleet.root.lines).toStrictEqual(lines);
  });
});
