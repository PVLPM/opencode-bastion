import { describe, expect, it } from "vitest";

import { deriveActivity } from "../../src/model/activity";
import type { AgentStatus } from "../../src/model/types";
import { makeAssistant, makeError, makeTool } from "../fixtures";

function running(tools: Parameters<typeof makeTool>[0], status: AgentStatus = "running") {
  return deriveActivity([makeAssistant({ content: [makeTool(tools)] })], status, undefined);
}

interface ToolCase {
  readonly name: string;
  readonly tool: Parameters<typeof makeTool>[0];
  readonly expected: string;
}

const toolCases: readonly ToolCase[] = [
  {
    name: "read",
    tool: { name: "read", input: { filePath: "C:\\project\\src\\model\\types.ts" } },
    expected: "Reading types.ts",
  },
  {
    name: "edit",
    tool: { name: "edit", input: { filePath: "/project/src/session.ts" } },
    expected: "Editing session.ts",
  },
  {
    name: "write",
    tool: { name: "write", input: { filePath: "/project/src/session.ts" } },
    expected: "Editing session.ts",
  },
  {
    name: "patch without a path",
    tool: { name: "patch", input: {} },
    expected: "Editing files",
  },
  {
    name: "shell with a description",
    tool: { name: "shell", input: { description: "run tests" } },
    expected: "Running run tests",
  },
  {
    name: "shell without a description",
    tool: { name: "shell", input: {} },
    expected: "Running command",
  },
  {
    name: "grep with a pattern",
    tool: { name: "grep", input: { pattern: "deriveStatus" } },
    expected: "Searching deriveStatus",
  },
  {
    name: "glob falls back to a path",
    tool: { name: "glob", input: { path: "src/**" } },
    expected: "Searching src/**",
  },
  {
    name: "list with a path",
    tool: { name: "list", input: { path: "src/model" } },
    expected: "Searching src/model",
  },
  {
    name: "grep without input",
    tool: { name: "grep" },
    expected: "Searching repository",
  },
  {
    name: "webfetch uses the URL host",
    tool: { name: "webfetch", input: { url: "https://example.com/docs?q=1" } },
    expected: "Fetching example.com",
  },
  {
    name: "webfetch with an invalid URL",
    tool: { name: "webfetch", input: { url: "not a url" } },
    expected: "Fetching page",
  },
  {
    name: "websearch",
    tool: { name: "websearch" },
    expected: "Searching the web",
  },
  {
    name: "subagent",
    tool: { name: "subagent", input: { agent: "designer" } },
    expected: "Delegating to designer",
  },
  {
    name: "skill",
    tool: { name: "skill", input: { name: "ponytail" } },
    expected: "Loading ponytail skill",
  },
  {
    name: "question",
    tool: { name: "question" },
    expected: "Asking a question",
  },
  {
    name: "unknown tool",
    tool: { name: "todowrite" },
    expected: "Using todowrite",
  },
  {
    name: "streaming tool",
    tool: { name: "shell", status: "streaming", text: '{"command":' },
    expected: "Running command",
  },
];

describe("deriveActivity tool details", () => {
  it.each(toolCases)("$name", ({ tool, expected }) => {
    expect(running(tool)).toBe(expected);
  });
});

interface ActivityCase {
  readonly name: string;
  readonly messages: Parameters<typeof deriveActivity>[0];
  readonly status: AgentStatus;
  readonly detail: string | undefined;
  readonly expected: string | undefined;
}

const activityCases: readonly ActivityCase[] = [
  {
    name: "a running session with no messages is starting",
    messages: [],
    status: "running",
    detail: undefined,
    expected: "Starting…",
  },
  {
    name: "an incomplete reasoning part is thinking",
    messages: [makeAssistant({ content: [{ type: "reasoning", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: "Thinking…",
  },
  {
    name: "a completed reasoning part is not thinking",
    messages: [
      makeAssistant({
        content: [{ type: "reasoning", text: "hidden", time: { created: 0, completed: 1 } }],
      }),
    ],
    status: "running",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "text in an incomplete message is writing a response",
    messages: [makeAssistant({ content: [{ type: "text", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: "Writing response…",
  },
  {
    name: "text in a completed message is not writing",
    messages: [makeAssistant({ completed: 5, content: [{ type: "text", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "only the last content part matters",
    messages: [
      makeAssistant({
        content: [
          { type: "text", text: "hidden" },
          makeTool({ name: "read", input: { filePath: "/a/b.ts" } }),
        ],
      }),
    ],
    status: "running",
    detail: undefined,
    expected: "Reading b.ts",
  },
  {
    name: "a completed tool part has no activity",
    messages: [makeAssistant({ content: [makeTool({ status: "completed" })] })],
    status: "running",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "retrying overrides the last content part",
    messages: [
      makeAssistant({
        content: [makeTool({ name: "read", input: { filePath: "/a/b.ts" } })],
        retry: { attempt: 2, at: 0, error: makeError("rate limited") },
      }),
    ],
    status: "running",
    detail: "Retrying (attempt 2)",
    expected: "Retrying request…",
  },
  {
    name: "waiting repeats the status detail",
    messages: [],
    status: "waiting",
    detail: "Waiting for permission",
    expected: "Waiting for permission…",
  },
  {
    name: "waiting without a detail has no activity",
    messages: [],
    status: "waiting",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "done has no activity",
    messages: [makeAssistant({ content: [makeTool({ name: "read" })] })],
    status: "done",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "failed has no activity",
    messages: [],
    status: "failed",
    detail: undefined,
    expected: undefined,
  },
  {
    name: "unknown has no activity",
    messages: [],
    status: "unknown",
    detail: "Interrupted",
    expected: undefined,
  },
];

describe("deriveActivity states", () => {
  it.each(activityCases)("$name", ({ messages, status, detail, expected }) => {
    expect(deriveActivity(messages, status, detail)).toBe(expected);
  });
});
