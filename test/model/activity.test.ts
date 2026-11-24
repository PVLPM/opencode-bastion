import { describe, expect, it } from "vitest";

import { deriveActivity, firstLine } from "../../src/model/activity";
import type { AgentStatus } from "../../src/model/types";
import { makeAssistant, makeError, makeTool } from "../fixtures";

describe("firstLine", () => {
  it.each([
    ["\n\n  Ship it  \nmore", "Ship it"],
    ["# Agent Fleet — redesign\nbody", "Agent Fleet — redesign"],
    ["### Plan", "Plan"],
    ["> quoted ask", "quoted ask"],
    ["#hashtag stays", "#hashtag stays"],
    ["  \n ", undefined],
  ])("%j → %j", (text, expected) => {
    expect(firstLine(text)).toBe(expected);
  });
});

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
    name: "read keeps only the basename",
    tool: { name: "read", input: { filePath: "C:\\project\\src\\model\\types.ts" } },
    expected: "Reading types.ts",
  },
  {
    name: "edit keeps only the basename",
    tool: { name: "edit", input: { filePath: "/project/src/session.ts" } },
    expected: "Editing session.ts",
  },
  {
    name: "write keeps only the basename",
    tool: { name: "write", input: { filePath: "/project/src/session.ts" } },
    expected: "Editing session.ts",
  },
  {
    name: "patch without a path",
    tool: { name: "patch", input: {} },
    expected: "Editing files",
  },
  {
    name: "shell prefers the tool's own concise description",
    tool: { name: "shell", input: { description: "Run the test suite", command: "pnpm test" } },
    expected: "Run the test suite",
  },
  {
    name: "shell falls back when the description is blank",
    tool: { name: "shell", input: { description: "  \n ", command: "pnpm test" } },
    expected: "Running command",
  },
  {
    name: "subagent keeps delegating even with a description",
    tool: {
      name: "subagent",
      input: { agent: "designer", description: "Polish the panel" },
    },
    expected: "Delegating to Designer",
  },
  {
    name: "legacy task keeps delegating with the capitalized target",
    tool: {
      name: "task",
      input: { subagent_type: "release-engineer", description: "Ship it" },
    },
    expected: "Delegating to Release-engineer",
  },
  {
    name: "legacy bash prefers its description",
    tool: { name: "bash", input: { description: "Run the tests", command: "pnpm test" } },
    expected: "Run the tests",
  },
  {
    name: "shell without input",
    tool: { name: "shell", input: {} },
    expected: "Running command",
  },
  {
    name: "grep never shows its pattern",
    tool: { name: "grep", input: { pattern: "secret-token" } },
    expected: "Searching files",
  },
  {
    name: "glob never shows its path",
    tool: { name: "glob", input: { path: "src/**" } },
    expected: "Searching files",
  },
  {
    name: "list never shows its path",
    tool: { name: "list", input: { path: "src/model" } },
    expected: "Searching files",
  },
  {
    name: "grep without input",
    tool: { name: "grep" },
    expected: "Searching files",
  },
  {
    name: "webfetch uses only the URL host",
    tool: { name: "webfetch", input: { url: "https://example.com/docs?q=secret" } },
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
    expected: "Delegating to Designer",
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
