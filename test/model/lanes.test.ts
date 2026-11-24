import type { SessionMessageInfo } from "@opencode/client/promise";
import { describe, expect, it } from "vitest";

import { deriveLanes, type LaneSession, type LanesInput } from "../../src/model/lanes";
import type { AgentStatus } from "../../src/model/types";
import type { SessionValues } from "../fixtures";
import {
  makeAssistant,
  makeIdle,
  makeSession,
  makeSynthetic,
  makeTool,
  makeUser,
} from "../fixtures";

interface LaneSessionValues extends SessionValues {
  running?: boolean;
  waiting?: boolean;
  messages?: readonly SessionMessageInfo[];
}

function laneSession(values: LaneSessionValues = {}): LaneSession {
  return {
    info: makeSession(values),
    running: values.running ?? false,
    waiting: values.waiting ?? false,
    messages: values.messages ?? [],
  };
}

function lanesInput(overrides: Partial<LanesInput> = {}): LanesInput {
  return {
    root: laneSession({ id: "ses-root" }),
    children: [],
    agentName: (info) => info.id,
    title: (info) => info.title,
    ...overrides,
  };
}

function subagentCall(id: string, childID: string, description: string, at: number) {
  return makeTool({
    id,
    name: "subagent",
    created: at,
    input: { agent: "fixer", description },
    metadata: { sessionID: childID },
  });
}

describe("deriveLanes execution blocks", () => {
  it("draws one block from the first assistant to the idle marker", () => {
    const root = laneSession({
      messages: [
        makeUser(10, "Do the work"),
        makeAssistant({ id: "a1", created: 20, completed: 35 }),
        makeIdle("succeeded", undefined, 40),
      ],
    });

    const view = deriveLanes(lanesInput({ root }));

    expect(view.lanes[0]?.blocks).toStrictEqual([
      {
        id: "ses-root:msg-user-10",
        start: 20,
        end: 40,
        status: "done",
        label: "Do the work",
        text: "Do the work",
      },
    ]);
    expect(view.from).toBe(20);
  });

  it("keeps a gap between two executions", () => {
    const root = laneSession({
      messages: [
        makeUser(10, "First"),
        makeAssistant({ id: "a1", created: 20 }),
        makeIdle("succeeded", undefined, 30),
        makeUser(100, "\n  Second task\nrest"),
        makeAssistant({ id: "a2", created: 110 }),
        makeIdle("failed", undefined, 120),
      ],
    });

    const blocks = deriveLanes(lanesInput({ root })).lanes[0]?.blocks;

    expect(blocks).toStrictEqual([
      {
        id: "ses-root:msg-user-10",
        start: 20,
        end: 30,
        status: "done",
        label: "First",
        text: "First",
      },
      {
        id: "ses-root:msg-user-100",
        start: 110,
        end: 120,
        status: "failed",
        label: "Second task",
        text: "Second task\nrest",
      },
    ]);
  });

  it("leaves the live block open with the derived running or waiting status", () => {
    const root = laneSession({
      running: true,
      waiting: true,
      messages: [makeAssistant({ id: "a1", created: 20 })],
    });

    expect(deriveLanes(lanesInput({ root })).lanes[0]?.blocks[0]).toStrictEqual({
      id: "ses-root:a1",
      start: 20,
      end: undefined,
      status: "waiting",
      label: undefined,
      text: undefined,
    });
  });

  interface TriggerCase {
    readonly name: string;
    readonly prompt: SessionMessageInfo;
    readonly waiting: boolean;
    readonly status: AgentStatus;
    readonly label: string;
    readonly text: string;
  }

  const triggerCases: readonly TriggerCase[] = [
    {
      name: "a running session",
      prompt: makeUser(30, "Next task"),
      waiting: false,
      status: "running",
      label: "Next task",
      text: "Next task",
    },
    {
      name: "a waiting session",
      prompt: makeUser(30, "Next task"),
      waiting: true,
      status: "waiting",
      label: "Next task",
      text: "Next task",
    },
    {
      name: "a running session with a synthetic prompt",
      prompt: makeSynthetic({ id: "msg-synthetic", created: 30, text: "Continue" }),
      waiting: false,
      status: "running",
      label: "Continue",
      text: "Continue",
    },
  ];

  it.each(triggerCases)("opens a live block at the trigger for $name before any assistant", ({
    prompt,
    waiting,
    status,
    label,
    text,
  }) => {
    const root = laneSession({
      running: true,
      waiting,
      messages: [
        makeAssistant({ id: "old", created: 10 }),
        makeIdle("succeeded", undefined, 20),
        prompt,
      ],
    });

    const blocks = deriveLanes(lanesInput({ root })).lanes[0]?.blocks;

    expect(blocks).toStrictEqual([
      {
        id: "ses-root:old",
        start: 10,
        end: 20,
        status: "done",
        label: undefined,
        text: undefined,
      },
      {
        id: `ses-root:${prompt.id}`,
        start: 30,
        end: undefined,
        status,
        label,
        text,
      },
    ]);
  });

  it("keeps the trigger block's id and prompt when its first assistant arrives", () => {
    const prompt = makeUser(30, "Next task");
    const before = laneSession({
      running: true,
      messages: [makeIdle("succeeded", undefined, 20), prompt],
    });
    const after = laneSession({
      running: true,
      messages: [
        makeIdle("succeeded", undefined, 20),
        prompt,
        makeAssistant({ id: "a1", created: 40 }),
      ],
    });

    const beforeBlock = deriveLanes(lanesInput({ root: before })).lanes[0]?.blocks[0];
    const afterBlock = deriveLanes(lanesInput({ root: after })).lanes[0]?.blocks[0];

    expect(beforeBlock).toMatchObject({
      id: `ses-root:${prompt.id}`,
      label: "Next task",
      text: "Next task",
    });
    expect(afterBlock).toMatchObject({
      id: `ses-root:${prompt.id}`,
      label: "Next task",
      text: "Next task",
    });
  });

  it("does not label a block with a prompt from before an idle boundary", () => {
    const root = laneSession({
      messages: [
        makeUser(10, "Old task"),
        makeAssistant({ id: "a1", created: 20 }),
        makeIdle("succeeded", undefined, 30),
        makeAssistant({ id: "a2", created: 40 }),
      ],
    });

    const block = deriveLanes(lanesInput({ root })).lanes[0]?.blocks[1];

    expect(block).toMatchObject({
      id: "ses-root:a2",
      label: undefined,
      text: undefined,
    });
  });

  it("keeps tool calls and later assistants inside one block", () => {
    const root = laneSession({
      messages: [
        makeAssistant({ id: "a1", created: 20, content: [makeTool({ id: "t1" })] }),
        makeAssistant({ id: "a2", created: 25, content: [makeTool({ id: "t2", name: "edit" })] }),
        makeIdle("succeeded", undefined, 40),
      ],
    });

    const blocks = deriveLanes(lanesInput({ root })).lanes[0]?.blocks;

    expect(blocks).toStrictEqual([
      {
        id: "ses-root:a1",
        start: 20,
        end: 40,
        status: "done",
        label: undefined,
        text: undefined,
      },
    ]);
  });

  const missingIdleCases: readonly (readonly [string, number | undefined, number])[] = [
    ["uses the last assistant completion", 35, 35],
    ["falls back to the last assistant start", undefined, 20],
    ["ignores a completion before the block start", 10, 20],
  ];

  it.each(
    missingIdleCases,
  )("a non-running session without an idle marker is unknown and %s", (_name, completed, expectedEnd) => {
    const assistant =
      completed === undefined
        ? makeAssistant({ id: "a1", created: 20 })
        : makeAssistant({ id: "a1", created: 20, completed });
    const root = laneSession({ messages: [assistant] });

    expect(deriveLanes(lanesInput({ root })).lanes[0]?.blocks[0]).toStrictEqual({
      id: "ses-root:a1",
      start: 20,
      end: expectedEnd,
      status: "unknown",
      label: undefined,
      text: undefined,
    });
  });

  it("closes a block at its start when the idle timestamp precedes it", () => {
    const root = laneSession({
      messages: [makeAssistant({ id: "a1", created: 20 }), makeIdle("succeeded", undefined, 10)],
    });

    expect(deriveLanes(lanesInput({ root })).lanes[0]?.blocks[0]).toStrictEqual({
      id: "ses-root:a1",
      start: 20,
      end: 20,
      status: "unknown",
      label: undefined,
      text: undefined,
    });
  });

  it("ignores assistant messages with a non-finite start", () => {
    const root = laneSession({
      messages: [
        makeAssistant({ id: "bad", created: Number.NaN }),
        makeAssistant({ id: "a1", created: 20 }),
        makeIdle("succeeded", undefined, 30),
      ],
    });

    const blocks = deriveLanes(lanesInput({ root })).lanes[0]?.blocks;

    expect(blocks).toStrictEqual([
      {
        id: "ses-root:a1",
        start: 20,
        end: 30,
        status: "done",
        label: undefined,
        text: undefined,
      },
    ]);
  });

  it("maps an interrupted idle marker to unknown", () => {
    const root = laneSession({
      messages: [makeAssistant({ id: "a1", created: 20 }), makeIdle("interrupted", undefined, 40)],
    });

    expect(deriveLanes(lanesInput({ root })).lanes[0]?.blocks[0]?.status).toBe("unknown");
  });
});

interface LabelCase {
  readonly name: string;
  readonly messages: readonly SessionMessageInfo[];
  readonly label: string | undefined;
  readonly text: string | undefined;
}

const labelCases: readonly LabelCase[] = [
  {
    name: "a user prompt contributes its first non-empty line",
    messages: [makeUser(10, "\n  Fix the tests  \nmore"), makeAssistant({ id: "a1", created: 20 })],
    label: "Fix the tests",
    text: "Fix the tests  \nmore",
  },
  {
    name: "a synthetic prompt prefers its description",
    messages: [
      makeSynthetic({ created: 10, text: "Full text", description: "Synthetic task" }),
      makeAssistant({ id: "a1", created: 20 }),
    ],
    label: "Synthetic task",
    text: "Synthetic task",
  },
  {
    name: "a synthetic prompt without a description uses its first line",
    messages: [
      makeSynthetic({ created: 10, text: "\n  Synthetic text  \nmore" }),
      makeAssistant({ id: "a1", created: 20 }),
    ],
    label: "Synthetic text",
    text: "Synthetic text  \nmore",
  },
  {
    name: "an assistant without a preceding prompt has no label",
    messages: [makeAssistant({ id: "a1", created: 20 })],
    label: undefined,
    text: undefined,
  },
];

describe("deriveLanes root block labels", () => {
  it.each(labelCases)("$name", ({ messages, label, text }) => {
    const root = laneSession({ messages });
    const block = deriveLanes(lanesInput({ root })).lanes[0]?.blocks[0];

    expect(block?.label).toBe(label);
    expect(block?.text).toBe(text);
  });
});

describe("deriveLanes handoffs", () => {
  it("lands a follow-up on the child block that is still running", () => {
    const root = laneSession({
      messages: [
        makeAssistant({
          id: "r1",
          created: 100,
          content: [subagentCall("call-1", "ses-child", "First task", 100)],
        }),
        makeAssistant({
          id: "r2",
          created: 150,
          content: [subagentCall("call-2", "ses-child", "Follow-up", 150)],
        }),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 50,
      running: true,
      messages: [makeAssistant({ id: "c1", created: 90 })],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.handoffs.map((handoff) => [handoff.kind, handoff.blockID])).toStrictEqual([
      ["delegate", "ses-child:c1"],
      ["followup", "ses-child:c1"],
    ]);
    expect(view.lanes[1]?.blocks[0]?.label).toBe("First task");
  });

  it("lands a follow-up after the child idled on the next block", () => {
    const root = laneSession({
      messages: [
        makeAssistant({
          id: "r1",
          created: 110,
          content: [subagentCall("call-1", "ses-child", "First task", 110)],
        }),
        makeAssistant({
          id: "r2",
          created: 210,
          content: [subagentCall("call-2", "ses-child", "Second task", 210)],
        }),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 50,
      messages: [
        makeAssistant({ id: "c1", created: 90 }),
        makeIdle("succeeded", undefined, 120),
        makeAssistant({ id: "c2", created: 200 }),
        makeIdle("succeeded", undefined, 250),
      ],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.handoffs.map((handoff) => [handoff.kind, handoff.blockID])).toStrictEqual([
      ["delegate", "ses-child:c1"],
      ["followup", "ses-child:c2"],
    ]);
    expect(view.lanes[1]?.blocks.map((block) => block.label)).toStrictEqual([
      "First task",
      "Second task",
    ]);
  });

  it("lands a call issued before the child's first block on that block", () => {
    const root = laneSession({
      messages: [
        makeAssistant({
          id: "r1",
          created: 100,
          content: [subagentCall("call-1", "ses-child", "Start now", 100)],
        }),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 110,
      messages: [makeAssistant({ id: "c1", created: 120 }), makeIdle("succeeded", undefined, 150)],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.handoffs[0]?.blockID).toBe("ses-child:c1");
    expect(view.lanes[1]?.blocks[0]?.label).toBe("Start now");
  });

  it("places a call at the tool's run time rather than its creation time", () => {
    const root = laneSession({
      messages: [
        makeAssistant({
          id: "r1",
          created: 10,
          content: [
            makeTool({
              id: "call-1",
              name: "subagent",
              created: 210,
              ran: 110,
              input: { agent: "fixer", description: "Ran early" },
              metadata: { sessionID: "ses-child" },
            }),
          ],
        }),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 50,
      messages: [
        makeAssistant({ id: "c1", created: 90 }),
        makeIdle("succeeded", undefined, 120),
        makeAssistant({ id: "c2", created: 200 }),
        makeIdle("succeeded", undefined, 250),
      ],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.handoffs[0]?.blockID).toBe("ses-child:c1");
  });

  it("leaves a late call unplaced and ignores an unknown child", () => {
    const root = laneSession({
      messages: [
        makeAssistant({
          id: "r1",
          created: 10,
          content: [
            subagentCall("call-1", "ses-child", "Late", 500),
            subagentCall("call-2", "ses-other", "Unknown", 520),
          ],
        }),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 50,
      messages: [makeAssistant({ id: "c1", created: 90 }), makeIdle("succeeded", undefined, 120)],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.handoffs).toHaveLength(1);
    expect(view.handoffs[0]?.blockID).toBeUndefined();
  });
});

describe("deriveLanes lanes", () => {
  it("orders the root first, then children by first start and by creation without blocks", () => {
    const children = [
      laneSession({ id: "ses-no-block-late", created: 500 }),
      laneSession({
        id: "ses-second",
        created: 5,
        messages: [makeAssistant({ id: "b1", created: 200 })],
      }),
      laneSession({ id: "ses-no-block-early", created: 100 }),
      laneSession({
        id: "ses-first",
        created: 6,
        messages: [makeAssistant({ id: "a1", created: 100 })],
      }),
    ];

    const view = deriveLanes(lanesInput({ children }));

    expect(view.lanes.map((lane) => lane.sessionID)).toStrictEqual([
      "ses-root",
      "ses-first",
      "ses-second",
      "ses-no-block-early",
      "ses-no-block-late",
    ]);
    expect(view.from).toBe(100);
  });

  it("keeps two children with the same agent name as two lanes", () => {
    const children = [
      laneSession({
        id: "ses-a",
        created: 5,
        messages: [makeAssistant({ id: "a1", created: 100 })],
      }),
      laneSession({
        id: "ses-b",
        created: 6,
        messages: [makeAssistant({ id: "b1", created: 200 })],
      }),
    ];

    const view = deriveLanes(lanesInput({ children, agentName: () => "Fixer" }));

    expect(view.lanes.map((lane) => lane.sessionID)).toStrictEqual(["ses-root", "ses-a", "ses-b"]);
    expect(view.lanes.map((lane) => lane.agent)).toStrictEqual(["Fixer", "Fixer", "Fixer"]);
  });

  it("keeps the root done while a background child is still running", () => {
    const root = laneSession({
      messages: [
        makeUser(10, "Run in the background"),
        makeAssistant({ id: "r1", created: 20 }),
        makeIdle("succeeded", undefined, 30),
      ],
    });
    const child = laneSession({
      id: "ses-child",
      parentID: "ses-root",
      created: 15,
      running: true,
      messages: [makeAssistant({ id: "c1", created: 25 })],
    });

    const view = deriveLanes(lanesInput({ root, children: [child] }));

    expect(view.lanes[0]?.blocks[0]?.status).toBe("done");
    expect(view.lanes[1]?.blocks[0]).toMatchObject({
      start: 25,
      end: undefined,
      status: "running",
    });
    expect(view.from).toBe(20);
  });
});
