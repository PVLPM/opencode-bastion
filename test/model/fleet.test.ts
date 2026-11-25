import type { ModelRef, SessionMessageInfo, TokenUsageInfo } from "@opencode/client/promise";
import { describe, expect, it } from "vitest";

import { buildFleet, type FleetInput, type SessionSnapshot } from "../../src/model/fleet";
import type { AgentStatus, LineStats, ModelLabel, Money } from "../../src/model/types";
import { pillView } from "../../src/ui/pill";
import {
  makeAssistant,
  makeError,
  makeSession,
  makeTokens,
  makeTool,
  makeUser,
  type SessionValues,
} from "../fixtures";

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
    const label: ModelLabel = { providerID: "p", providerName: "P", modelID: "m", name: "M" };
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

  it("carries the full native subagent description beside its first line", () => {
    const rootMessages = [
      makeAssistant({
        content: [subagentCall("tool-1", "ses-child", "First line\nMore native detail")],
      }),
    ];
    const input = fleetInput({
      root: snapshot({ messages: rootMessages }),
      children: [snapshot({ id: "ses-child", running: true })],
    });
    const child = buildFleet(input).active[0];

    expect(child?.task).toBe("First line");
    expect(child?.taskText).toBe("First line\nMore native detail");
  });

  it("keeps a blank subagent description out of both task fields", () => {
    const rootMessages = [
      makeAssistant({ content: [subagentCall("tool-1", "ses-child", "  \n ")] }),
    ];
    const input = fleetInput({
      root: snapshot({ messages: rootMessages }),
      children: [snapshot({ id: "ses-child", running: true })],
    });
    const child = buildFleet(input).active[0];

    expect(child?.task).toBeUndefined();
    expect(child?.taskText).toBeUndefined();
  });

  interface TaskCase {
    readonly name: string;
    readonly messages: readonly SessionMessageInfo[];
    readonly expected: string | undefined;
    readonly expectedText: string | undefined;
  }

  const mention = (text: string, token: string) => {
    const start = text.indexOf(token);
    return { start, end: start + token.length, text: token };
  };

  const mentionedPrompt = "@Fixer @skill-name @src/a.ts Fix the login flow";

  const taskCases: readonly TaskCase[] = [
    {
      name: "uses the first non-empty line of the latest user prompt and keeps the full text",
      messages: [makeUser(10, "Old prompt"), makeUser(20, "Fix the bug\nwith details")],
      expected: "Fix the bug",
      expectedText: "Fix the bug\nwith details",
    },
    {
      name: "ignores a latest prompt with no text",
      messages: [makeUser(10, "Old prompt"), makeUser(20, "  \n ")],
      expected: undefined,
      expectedText: undefined,
    },
    {
      name: "has no task without a user prompt",
      messages: [makeAssistant()],
      expected: undefined,
      expectedText: undefined,
    },
    {
      name: "prefers the native display text over the formatted message text",
      messages: [
        makeUser(20, "Fix the bug\n\n@src/a.ts", {
          displayText: "Fix the bug",
        }),
      ],
      expected: "Fix the bug",
      expectedText: "Fix the bug",
    },
    {
      name: "removes matching file, agent and skill mention spans",
      messages: [
        makeUser(20, "Fallback text", {
          displayText: mentionedPrompt,
          files: [
            {
              data: "",
              mime: "text/plain",
              source: { type: "inline" },
              mention: mention(mentionedPrompt, "@src/a.ts"),
            },
          ],
          agents: [{ name: "Fixer", mention: mention(mentionedPrompt, "@Fixer") }],
          skills: [
            {
              id: "skill-name",
              name: "skill-name",
              mention: mention(mentionedPrompt, "@skill-name"),
            },
          ],
        }),
      ],
      expected: "Fix the login flow",
      expectedText: "Fix the login flow",
    },
    {
      name: "leaves a mention span that no longer matches intact",
      messages: [
        makeUser(20, "Fallback text", {
          displayText: "Keep @src/a.ts here",
          files: [
            {
              data: "",
              mime: "text/plain",
              source: { type: "inline" },
              mention: { start: 5, end: 14, text: "@other.ts" },
            },
          ],
        }),
      ],
      expected: "Keep @src/a.ts here",
      expectedText: "Keep @src/a.ts here",
    },
  ];

  it.each(taskCases)("orchestrator task $name", ({ messages, expected, expectedText }) => {
    const fleet = buildFleet(fleetInput({ root: snapshot({ messages }) }));

    expect(fleet.root.task).toBe(expected);
    expect(fleet.root.taskText).toBe(expectedText);
  });

  interface EffortCase {
    readonly name: string;
    readonly sessionModel: ModelRef | undefined;
    readonly messages: readonly SessionMessageInfo[];
    readonly expected: string | undefined;
  }

  const model = (variant?: string): ModelRef => {
    const ref: ModelRef = { id: "claude", providerID: "anthropic" };
    if (variant !== undefined) ref.variant = variant;
    return ref;
  };

  const effortCases: readonly EffortCase[] = [
    {
      name: "uses the latest assistant's variant",
      sessionModel: model("low"),
      messages: [
        makeAssistant({ model: model("high") }),
        makeAssistant({ model: model("medium") }),
      ],
      expected: "medium",
    },
    {
      name: "does not fall back to the session model variant",
      sessionModel: model("medium"),
      messages: [makeAssistant({ model: model() })],
      expected: undefined,
    },
    {
      name: "is undefined before the first assistant",
      sessionModel: model("medium"),
      messages: [],
      expected: undefined,
    },
    {
      name: "does not inherit an older assistant's variant",
      sessionModel: undefined,
      messages: [makeAssistant({ model: model("high") }), makeAssistant({ model: model() })],
      expected: undefined,
    },
  ];

  it.each(effortCases)("effort $name", ({ sessionModel, messages, expected }) => {
    const values: SnapshotValues = { messages };
    if (sessionModel !== undefined) values.model = sessionModel;
    const fleet = buildFleet(fleetInput({ root: snapshot(values) }));

    expect(fleet.root.effort).toBe(expected);
  });

  interface ModelSourceCase {
    readonly name: string;
    readonly sessionModel: ModelRef;
    readonly messages: readonly SessionMessageInfo[];
    readonly expectedRef: ModelRef;
    readonly expectedEffort: string | undefined;
  }

  const modelSourceCases: readonly ModelSourceCase[] = [
    {
      name: "uses the latest assistant ref for both model and effort",
      sessionModel: model("session"),
      messages: [makeAssistant({ model: model("assistant") })],
      expectedRef: model("assistant"),
      expectedEffort: "assistant",
    },
    {
      name: "uses the session ref before the first assistant and no effort",
      sessionModel: model("session"),
      messages: [],
      expectedRef: model("session"),
      expectedEffort: undefined,
    },
  ];

  it.each(modelSourceCases)("$name", ({ sessionModel, messages, expectedRef, expectedEffort }) => {
    const refs: (ModelRef | undefined)[] = [];
    const root = buildFleet(
      fleetInput({
        root: snapshot({ model: sessionModel, messages }),
        modelLabel: (_location, ref) => {
          refs.push(ref);
          return {
            providerID: "anthropic",
            providerName: "Anthropic",
            modelID: "claude",
            name: "claude",
          };
        },
      }),
    ).root;

    expect(refs).toStrictEqual([expectedRef]);
    expect(root.effort).toBe(expectedEffort);
  });

  interface CardStatusCase {
    readonly name: string;
    readonly values: SnapshotValues;
    readonly status: AgentStatus;
    readonly detail: string | undefined;
  }

  const cardStatusCases: readonly CardStatusCase[] = [
    {
      name: "permission waits for approval",
      values: { permissions: 1, running: true },
      status: "waiting",
      detail: "Waiting for permission",
    },
    {
      name: "form waits for an answer",
      values: { forms: 1, running: true },
      status: "waiting",
      detail: "Waiting for your answer",
    },
    {
      name: "retry keeps running with a detail",
      values: {
        running: true,
        messages: [
          makeAssistant({ retry: { attempt: 2, at: 0, error: makeError("rate limited") } }),
        ],
      },
      status: "running",
      detail: "Retrying (attempt 2)",
    },
    {
      name: "interrupted is unknown",
      values: { outcome: "interrupted" },
      status: "unknown",
      detail: "Interrupted",
    },
  ];

  it.each(cardStatusCases)("card status: $name", ({ values, status, detail }) => {
    const root = buildFleet(fleetInput({ root: snapshot(values) })).root;

    expect(root.status).toBe(status);
    expect(root.statusDetail).toBe(detail);
  });

  it("keeps the pill reporting running while the root is done and a child runs", () => {
    const input = fleetInput({
      root: snapshot({ outcome: "succeeded", idle: 100 }),
      children: [snapshot({ id: "ses-child", created: 50, running: true })],
    });
    const fleet = buildFleet(input);

    expect(fleet.root.status).toBe("done");
    expect(fleet.active[0]?.status).toBe("running");
    expect(pillView(fleet)).toMatchObject({ label: "2 agents · 1 running" });
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

  it("reports validated cumulative token stats for the root and children", () => {
    const input = fleetInput({
      root: snapshot({
        tokens: makeTokens({ input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 4 }),
      }),
      children: [snapshot({ id: "ses-child", created: 1, running: true, tokens: makeTokens() })],
    });
    const fleet = buildFleet(input);

    expect(fleet.root.tokens).toStrictEqual({
      input: 10,
      output: 5,
      reasoning: 2,
      cacheRead: 3,
      cacheWrite: 4,
      total: 24,
    });
    expect(fleet.active[0]?.tokens).toStrictEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    });
    expect(fleet.totalTokens).toBe(24);
  });

  it("reports an exact zero token total rather than omitting it", () => {
    const fleet = buildFleet(fleetInput({ root: snapshot({ tokens: makeTokens() }) }));

    expect(fleet.root.tokens?.total).toBe(0);
    expect(fleet.totalTokens).toBe(0);
  });

  it("counts each distinct session in the family token total once", () => {
    const child = snapshot({
      id: "ses-child",
      created: 1,
      running: true,
      tokens: makeTokens({ input: 5 }),
    });
    const grandchild = snapshot({
      id: "ses-grandchild",
      parentID: "ses-child",
      created: 2,
      tokens: makeTokens({ input: 3 }),
    });
    const input = fleetInput({
      root: snapshot({ id: "ses-root", tokens: makeTokens({ input: 10 }) }),
      children: [child],
      descendants: [child, grandchild],
    });

    expect(buildFleet(input).totalTokens).toBe(18);
  });

  const invalidTokenCases: readonly (readonly [string, TokenUsageInfo])[] = [
    ["input is not finite", makeTokens({ input: Number.NaN })],
    ["output is negative", makeTokens({ output: -1 })],
    ["reasoning is infinite", makeTokens({ reasoning: Number.POSITIVE_INFINITY })],
    ["cache read is not finite", makeTokens({ cacheRead: Number.NaN })],
    ["cache write is negative", makeTokens({ cacheWrite: -1 })],
  ];

  it.each(invalidTokenCases)("leaves tokens unknown when %s", (_name, tokens) => {
    const fleet = buildFleet(fleetInput({ root: snapshot({ tokens }) }));

    expect(fleet.root.tokens).toBeUndefined();
    expect(fleet.totalTokens).toBeUndefined();
  });

  it("leaves the family total unknown when a descendant's tokens are invalid", () => {
    const input = fleetInput({
      root: snapshot({ tokens: makeTokens() }),
      descendants: [snapshot({ id: "ses-child", created: 1, tokens: makeTokens({ input: -1 }) })],
    });

    expect(buildFleet(input).totalTokens).toBeUndefined();
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
    const lines = { added: 12, removed: 3, files: 1 };
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
