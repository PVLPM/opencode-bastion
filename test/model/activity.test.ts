import type { JsonValue } from "@opencode/client/promise";
import { describe, expect, it } from "vitest";

import { deriveActivity, firstLine, jsonText } from "../../src/model/activity";
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

describe("jsonText", () => {
  const cases: readonly (readonly [string, JsonValue | undefined, string | undefined])[] = [
    ["a JSON string", "text", "text"],
    ["a number", 1, undefined],
    ["a boolean", true, undefined],
    ["null", null, undefined],
    ["undefined", undefined, undefined],
    ["an array", ["text"], undefined],
    ["an object", { text: "value" }, undefined],
    ["an object whose toString is null", { toString: null }, undefined],
  ];

  it.each(cases)("returns only strings for %s", (_name, value, expected) => {
    expect(jsonText(value)).toBe(expected);
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
    expected: "Writing session.ts",
  },
  {
    name: "write without a path",
    tool: { name: "write", input: {} },
    expected: "Writing files",
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
    expected: "Running tests",
  },
  {
    name: "shell classifies a test runner",
    tool: { name: "shell", input: { command: "pnpm vitest run test/model" } },
    expected: "Running tests",
  },
  {
    name: "shell classifies an install",
    tool: { name: "shell", input: { command: "pnpm add -D vitest" } },
    expected: "Installing packages",
  },
  {
    name: "shell classifies a build",
    tool: { name: "shell", input: { command: "pnpm build" } },
    expected: "Building",
  },
  {
    name: "shell classifies linting",
    tool: { name: "shell", input: { command: "pnpm exec oxlint -c .oxlintrc.json ." } },
    expected: "Linting",
  },
  {
    name: "shell classifies formatting",
    tool: { name: "shell", input: { command: "pnpm format:check" } },
    expected: "Formatting",
  },
  {
    name: "shell classifies a typecheck",
    tool: { name: "shell", input: { command: "tsc --noEmit" } },
    expected: "Type-checking",
  },
  {
    name: "shell classifies a git inspection",
    tool: { name: "shell", input: { command: "git status --short" } },
    expected: "Checking changes",
  },
  {
    name: "shell classifies a git write",
    tool: { name: "shell", input: { command: 'git commit -m "Update pricing"' } },
    expected: "Updating git",
  },
  {
    name: "shell classifies a search",
    tool: { name: "shell", input: { command: "rg canonical src" } },
    expected: "Searching files",
  },
  {
    name: "shell classifies a directory listing",
    tool: { name: "shell", input: { command: "ls -la src" } },
    expected: "Listing files",
  },
  {
    name: "shell classifies a file read",
    tool: { name: "shell", input: { command: "cat package.json" } },
    expected: "Reading files",
  },
  {
    name: "shell classifies a network fetch",
    tool: { name: "shell", input: { command: "curl https://example.com/api?q=secret" } },
    expected: "Fetching a URL",
  },
  {
    name: "shell classifies through a cd and export prefix",
    tool: { name: "shell", input: { command: "cd C:\\project && pnpm test" } },
    expected: "Running tests",
  },
  {
    name: "shell falls back for an unknown command",
    tool: { name: "shell", input: { command: "./deploy.sh --production" } },
    expected: "Running Shell",
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
    name: "legacy bash classifies its command",
    tool: { name: "bash", input: { command: "npm run build" } },
    expected: "Building",
  },
  {
    name: "shell without input",
    tool: { name: "shell", input: {} },
    expected: "Running Shell",
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
    expected: "Running Shell",
  },
];

describe("deriveActivity tool details", () => {
  it.each(toolCases)("$name", ({ tool, expected }) => {
    expect(running(tool)).toBe(expected);
  });
});

describe("deriveActivity command privacy", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ["a search command", "rg secret-token src", "Searching files"],
    ["a git commit message", 'git commit -m "secret-token"', "Updating git"],
    ["an unknown command", "./deploy.sh --token secret-token", "Running Shell"],
  ];

  it.each(cases)("never echoes %s", (_name, command, expected) => {
    const activity = running({ name: "shell", input: { command } });

    expect(activity).toBe(expected);
    expect(activity).not.toContain("secret-token");
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
    name: "an assistant with no parts is working",
    messages: [makeAssistant()],
    status: "running",
    detail: undefined,
    expected: "Working…",
  },
  {
    name: "an incomplete reasoning part is thinking",
    messages: [makeAssistant({ content: [{ type: "reasoning", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: "Thinking…",
  },
  {
    name: "a completed reasoning part is working",
    messages: [
      makeAssistant({
        content: [{ type: "reasoning", text: "hidden", time: { created: 0, completed: 1 } }],
      }),
    ],
    status: "running",
    detail: undefined,
    expected: "Working…",
  },
  {
    name: "text in an incomplete message is writing a response",
    messages: [makeAssistant({ content: [{ type: "text", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: "Writing response…",
  },
  {
    name: "text in a completed message is working",
    messages: [makeAssistant({ completed: 5, content: [{ type: "text", text: "hidden" }] })],
    status: "running",
    detail: undefined,
    expected: "Working…",
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
    name: "a completed tool part falls back to working",
    messages: [makeAssistant({ content: [makeTool({ status: "completed" })] })],
    status: "running",
    detail: undefined,
    expected: "Working…",
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
