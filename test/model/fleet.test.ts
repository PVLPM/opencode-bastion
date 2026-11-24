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
    descendants: [],
    currentID: "ses-root",
    agentName: (info) => info.id,
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
    input: { agent: "designer", description },
    metadata: { sessionID: childID },
  });
}

const perThousand = (tokens: TokenUsageInfo): Money | undefined =>
  tokens.input > 0 ? { usd: tokens.input / 1_000, estimated: true } : undefined;

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

  it("limits the token-bearing assistant by its own model, not the session model", () => {
    const input = fleetInput({
      root: snapshot({
        messages: [
          makeAssistant({
            tokens: makeTokens({ input: 10 }),
            model: { id: "assistant-model", providerID: "p" },
          }),
        ],
        model: { id: "session-model", providerID: "p" },
      }),
      contextLimit: (_location, ref) => (ref?.id === "assistant-model" ? 100 : 200),
    });

    expect(buildFleet(input).root.context).toStrictEqual({ used: 10, limit: 100 });
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

  it("reports the exact family cost without double counting children", () => {
    const child = snapshot({ id: "ses-child", created: 1, cost: 0.3 });
    const input = fleetInput({
      root: snapshot({ id: "ses-root", cost: 0.7 }),
      children: [child],
      descendants: [child],
      familyCost: 1,
    });
    const fleet = buildFleet(input);

    expect(fleet.totalCost).toStrictEqual({ usd: 1, estimated: false });
    expect(fleet.root.cost).toStrictEqual({ usd: 0.7, estimated: false });
    expect(fleet.inactive[0]?.cost).toStrictEqual({ usd: 0.3, estimated: false });
  });

  it("adds an estimate only for an unpriced member and keeps reported costs", () => {
    const child = snapshot({
      id: "ses-child",
      created: 1,
      running: true,
      tokens: makeTokens({ input: 3_000 }),
    });
    const input = fleetInput({
      root: snapshot({ id: "ses-root", cost: 0.7 }),
      children: [child],
      descendants: [child],
      familyCost: 0.7,
      price: perThousand,
    });
    const fleet = buildFleet(input);

    expect(fleet.totalCost).toStrictEqual({ usd: 3.7, estimated: true });
    expect(fleet.root.cost).toStrictEqual({ usd: 0.7, estimated: false });
    expect(fleet.active[0]?.cost).toStrictEqual({ usd: 3, estimated: true });
  });

  it("includes a grandchild in the family total", () => {
    const child = snapshot({ id: "ses-child", created: 1, cost: 0.3 });
    const grandchild = snapshot({
      id: "ses-grandchild",
      parentID: "ses-child",
      created: 2,
      tokens: makeTokens({ input: 50 }),
    });
    const input = fleetInput({
      root: snapshot({ id: "ses-root", cost: 0.4 }),
      children: [child],
      descendants: [child, grandchild],
      familyCost: 0.7,
      price: perThousand,
    });

    expect(buildFleet(input).totalCost).toStrictEqual({ usd: 0.75, estimated: true });
  });

  it("leaves the family total unknown when an unpriced member cannot be priced", () => {
    const input = fleetInput({
      root: snapshot({ id: "ses-root", cost: 0.7 }),
      descendants: [
        snapshot({ id: "ses-child", created: 1, running: true, tokens: makeTokens({ input: 3 }) }),
      ],
      familyCost: 0.7,
    });

    expect(buildFleet(input).totalCost).toBeUndefined();
  });

  it("reports an exact zero for a member without tokens", () => {
    const input = fleetInput({
      children: [snapshot({ id: "ses-child", created: 1, tokens: makeTokens() })],
    });

    expect(buildFleet(input).inactive[0]?.cost).toStrictEqual({ usd: 0, estimated: false });
  });

  it("never reprices a reported cost", () => {
    const input = fleetInput({
      root: snapshot({
        id: "ses-root",
        cost: 0.7,
        tokens: makeTokens({ input: 1_000 }),
      }),
      price: () => ({ usd: 99, estimated: true }),
      familyCost: 0.7,
    });
    const fleet = buildFleet(input);

    expect(fleet.root.cost).toStrictEqual({ usd: 0.7, estimated: false });
    expect(fleet.totalCost).toStrictEqual({ usd: 0.7, estimated: false });
  });

  it("prices each member exactly once per build", () => {
    const calls: string[] = [];
    const child = snapshot({
      id: "ses-child",
      running: true,
      tokens: makeTokens({ input: 10 }),
      model: { id: "m", providerID: "p" },
    });
    const input = fleetInput({
      children: [child],
      descendants: [child],
      price: (_tokens, ref) => {
        calls.push(ref?.id ?? "missing");
        return { usd: 1, estimated: true };
      },
    });

    buildFleet(input);

    expect(calls).toStrictEqual(["m"]);
  });

  it("leaves a non-finite family total unknown", () => {
    const input = fleetInput({ familyCost: Number.NaN });

    expect(buildFleet(input).totalCost).toBeUndefined();
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

interface TitleCase {
  readonly name: string;
  readonly title: string | undefined;
  readonly expected: string | undefined;
}

const titleCases: readonly TitleCase[] = [
  {
    name: "strips the persisted subagent suffix",
    title: "Review the diff (@reviewer subagent)",
    expected: "Review the diff",
  },
  {
    name: "keeps a plain title",
    title: "Review the diff",
    expected: "Review the diff",
  },
  {
    name: "strips a hyphenated agent name",
    title: "Audit the flow (@release-engineer subagent)",
    expected: "Audit the flow",
  },
  {
    name: "keeps the suffix when it is not at the end",
    title: "Review (@reviewer subagent) notes",
    expected: "Review (@reviewer subagent) notes",
  },
  {
    name: "keeps an absent title",
    title: undefined,
    expected: undefined,
  },
];

describe("AgentView.title", () => {
  it.each(titleCases)("$name", ({ title, expected }) => {
    const values: SnapshotValues = { id: "ses-child", running: true };
    if (title !== undefined) values.title = title;
    const input = fleetInput({ children: [snapshot(values)] });

    expect(buildFleet(input).active[0]?.title).toBe(expected);
  });
});
