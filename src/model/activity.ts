import type {
  JsonValue,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise";

import { latestAssistant } from "./status";
import type { AgentStatus } from "./types";

/**
 * Only a real string is safe to coerce: a JSON object may carry a null
 * `toString`, which makes `String(value)` throw.
 */
export function jsonText(value: JsonValue | undefined): string | undefined {
  if (Object.prototype.toString.call(value) !== "[object String]") return undefined;
  return String(value);
}

function inputText(
  input: { [key: string]: JsonValue } | undefined,
  key: string,
): string | undefined {
  return input === undefined ? undefined : jsonText(input[key]);
}

/** The first non-empty line, trimmed; undefined when the text has none. */
export function firstLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  for (const line of text.split(/\r?\n/u)) {
    // Prompts are markdown; a heading or quote marker is syntax, not task text.
    const trimmed = line.trim().replace(/^(?:#{1,6}|>)\s+/u, "");
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

function urlHost(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Delegations show their target; their description belongs to the task row. */
function delegationActivity(agent: string | undefined): string | undefined {
  return agent === undefined ? "Delegating" : `Delegating to ${capitalize(agent)}`;
}

interface CommandActivity {
  readonly pattern: RegExp;
  readonly activity: string;
}

/**
 * Conservative command prefixes. Only the executable that starts a command is
 * classified, and the command text itself is never returned.
 */
const COMMAND_ACTIVITIES: readonly CommandActivity[] = [
  {
    pattern:
      /^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec|dlx)\s+)?(?:test|vitest|jest|mocha|pytest|playwright|cypress)\b/iu,
    activity: "Running tests",
  },
  {
    pattern: /^(?:vitest|jest|mocha|pytest|rspec|phpunit)\b/iu,
    activity: "Running tests",
  },
  { pattern: /^playwright\s+test\b/iu, activity: "Running tests" },
  { pattern: /^cypress\s+(?:run|open)\b/iu, activity: "Running tests" },
  {
    pattern: /^(?:cargo|go|dotnet|swift|mix)\s+test\b/iu,
    activity: "Running tests",
  },
  {
    pattern: /^(?:pnpm|npm|yarn|bun)\s+(?:install|i|add|ci)\b/iu,
    activity: "Installing packages",
  },
  { pattern: /^(?:pip|pip3)\s+install\b/iu, activity: "Installing packages" },
  { pattern: /^uv\s+(?:pip\s+)?install\b/iu, activity: "Installing packages" },
  { pattern: /^cargo\s+(?:add|install)\b/iu, activity: "Installing packages" },
  { pattern: /^go\s+get\b/iu, activity: "Installing packages" },
  { pattern: /^gem\s+install\b/iu, activity: "Installing packages" },
  { pattern: /^composer\s+require\b/iu, activity: "Installing packages" },
  { pattern: /^dotnet\s+add\s+package\b/iu, activity: "Installing packages" },
  {
    pattern: /^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec|dlx)\s+)?build\b/iu,
    activity: "Building",
  },
  { pattern: /^(?:cargo|go|dotnet)\s+build\b/iu, activity: "Building" },
  { pattern: /^vite\s+build\b/iu, activity: "Building" },
  { pattern: /^make\b/iu, activity: "Building" },
  { pattern: /^cmake\s+--build\b/iu, activity: "Building" },
  { pattern: /^mvn\s+package\b/iu, activity: "Building" },
  { pattern: /^gradle\s+build\b/iu, activity: "Building" },
  {
    pattern:
      /^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec|dlx)\s+)?(?:lint|eslint|oxlint|stylelint)\b/iu,
    activity: "Linting",
  },
  { pattern: /^(?:eslint|oxlint|stylelint|golangci-lint)\b/iu, activity: "Linting" },
  { pattern: /^ruff\s+check\b/iu, activity: "Linting" },
  { pattern: /^cargo\s+clippy\b/iu, activity: "Linting" },
  {
    pattern: /^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec|dlx)\s+)?(?:format|prettier|dprint)\b/iu,
    activity: "Formatting",
  },
  { pattern: /^biome\s+format\b/iu, activity: "Formatting" },
  { pattern: /^(?:prettier|dprint|rustfmt|gofmt|black)\b/iu, activity: "Formatting" },
  { pattern: /^cargo\s+fmt\b/iu, activity: "Formatting" },
  { pattern: /^ruff\s+format\b/iu, activity: "Formatting" },
  {
    pattern: /^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec|dlx)\s+)?(?:typecheck|tsc|vue-tsc)\b/iu,
    activity: "Type-checking",
  },
  { pattern: /^(?:tsc|vue-tsc|mypy|pyright)\b/iu, activity: "Type-checking" },
  {
    pattern: /^git(?:\s+-C\s+\S+)?(?:\s+--no-pager)?\s+(?:status|diff|log|show)\b/iu,
    activity: "Checking changes",
  },
  {
    pattern: /^git(?:\s+-C\s+\S+)?\s+(?:commit|push)\b/iu,
    activity: "Updating git",
  },
  { pattern: /^(?:rg|grep|find|fd)\b/iu, activity: "Searching files" },
  { pattern: /^git\s+grep\b/iu, activity: "Searching files" },
  { pattern: /^(?:ls|dir|tree)\b/iu, activity: "Listing files" },
  { pattern: /^(?:Get-ChildItem|gci)\b/iu, activity: "Listing files" },
  { pattern: /^(?:cat|head|tail|less|more|bat)\b/iu, activity: "Reading files" },
  { pattern: /^Get-Content\b/iu, activity: "Reading files" },
  { pattern: /^(?:curl|wget)\b/iu, activity: "Fetching a URL" },
  {
    pattern: /^(?:Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b/iu,
    activity: "Fetching a URL",
  },
];

/** Strip only well-known wrappers so classification still sees the real command. */
function commandHead(command: string): string {
  let head = command.trim();
  for (;;) {
    const next = head
      .replace(/^cd\s+[^&;|]+\s*(?:&&|;)\s*/u, "")
      .replace(/^(?:sudo|command|env|time|nohup|npx|pnpx|bunx)\s+/u, "")
      .replace(/^(?:\w+=\S*\s+)+/u, "");
    if (next === head) return head;
    head = next;
  }
}

/** A safe category for a shell command; the command text never surfaces. */
function commandActivity(command: string | undefined): string {
  if (command === undefined) return "Running Shell";
  const head = commandHead(command);
  for (const rule of COMMAND_ACTIVITIES) {
    if (rule.pattern.test(head)) return rule.activity;
  }
  return "Running Shell";
}

function toolActivity(part: SessionMessageAssistantTool): string | undefined {
  if (part.state.status !== "running" && part.state.status !== "streaming") return undefined;
  const input = part.state.status === "running" ? part.state.input : undefined;
  if (part.name === "subagent" || part.name === "task") {
    return delegationActivity(inputText(input, "agent") ?? inputText(input, "subagent_type"));
  }
  const description = firstLine(inputText(input, "description"));
  if (description !== undefined) return description;
  const filePath = inputText(input, "filePath");
  const file = filePath === undefined ? undefined : basename(filePath);
  switch (part.name) {
    case "read":
      return file === undefined ? "Reading file" : `Reading ${file}`;
    case "write":
      return file === undefined ? "Writing files" : `Writing ${file}`;
    case "edit":
    case "patch":
      return file === undefined ? "Editing files" : `Editing ${file}`;
    case "shell":
    case "bash":
      return commandActivity(inputText(input, "command"));
    case "grep":
    case "glob":
    case "list":
      return "Searching files";
    case "webfetch": {
      const host = urlHost(inputText(input, "url"));
      return host === undefined ? "Fetching page" : `Fetching ${host}`;
    }
    case "websearch":
      return "Searching the web";
    case "skill": {
      const name = inputText(input, "name");
      return name === undefined ? "Loading skill" : `Loading ${name} skill`;
    }
    case "question":
      return "Asking a question";
    default:
      return `Using ${part.name}`;
  }
}

export function deriveActivity(
  messages: readonly SessionMessageInfo[],
  status: AgentStatus,
  detail: string | undefined,
): string | undefined {
  if (status === "waiting") return detail === undefined ? undefined : `${detail}…`;
  if (status !== "running") return undefined;

  const assistant = latestAssistant(messages);
  if (assistant === undefined) return "Starting…";
  if (assistant.retry !== undefined && assistant.time.completed === undefined) {
    return "Retrying request…";
  }

  const part = assistant.content.at(-1);
  if (part === undefined) return undefined;
  if (part.type === "tool") return toolActivity(part);
  if (part.type === "reasoning") {
    return part.time?.completed === undefined ? "Thinking…" : undefined;
  }
  return assistant.time.completed === undefined ? "Writing response…" : undefined;
}
