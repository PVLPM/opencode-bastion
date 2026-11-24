import type {
  JsonValue,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise";

import type { AgentStatus } from "./types";

/** JSON strings are the only JSON values equal to their own stringification. */
export function jsonText(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text === value ? text : undefined;
}

function inputText(
  input: { [key: string]: JsonValue } | undefined,
  key: string,
): string | undefined {
  return input === undefined ? undefined : jsonText(input[key]);
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

function toolActivity(part: SessionMessageAssistantTool): string | undefined {
  if (part.state.status !== "running" && part.state.status !== "streaming") return undefined;
  const input = part.state.status === "running" ? part.state.input : undefined;
  const filePath = inputText(input, "filePath");
  const file = filePath === undefined ? undefined : basename(filePath);
  switch (part.name) {
    case "read":
      return file === undefined ? "Reading file" : `Reading ${file}`;
    case "edit":
    case "write":
    case "patch":
      return file === undefined ? "Editing files" : `Editing ${file}`;
    case "shell": {
      const description = inputText(input, "description");
      return description === undefined ? "Running command" : `Running ${description}`;
    }
    case "grep":
    case "glob":
    case "list": {
      const target = inputText(input, "pattern") ?? inputText(input, "path");
      return target === undefined ? "Searching repository" : `Searching ${target}`;
    }
    case "webfetch": {
      const host = urlHost(inputText(input, "url"));
      return host === undefined ? "Fetching page" : `Fetching ${host}`;
    }
    case "websearch":
      return "Searching the web";
    case "subagent": {
      const agent = inputText(input, "agent");
      return agent === undefined ? "Delegating" : `Delegating to ${agent}`;
    }
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

function latestAssistant(messages: readonly SessionMessageInfo[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "assistant") return message;
  }
  return undefined;
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
