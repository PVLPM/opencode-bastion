// Synthetic SDK objects for model tests. Shapes mirror @opencode/client 2.4.1.
import type {
  JsonValue,
  ModelRef,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompactionCompleted,
  SessionMessageCompactionRunning,
  SessionMessageIdle,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionStructuredError,
  TokenUsageInfo,
} from "@opencode/client/promise";

export interface TokenValues {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function makeTokens(values: TokenValues = {}): TokenUsageInfo {
  return {
    input: values.input ?? 0,
    output: values.output ?? 0,
    reasoning: values.reasoning ?? 0,
    cache: { read: values.cacheRead ?? 0, write: values.cacheWrite ?? 0 },
  };
}

export interface SessionValues {
  id?: string;
  parentID?: string;
  cost?: number;
  tokens?: TokenUsageInfo;
  outcome?: "succeeded" | "failed" | "interrupted";
  created?: number;
  updated?: number;
  idle?: number;
  title?: string;
  model?: ModelRef;
}

export function makeSession(values: SessionValues = {}): SessionInfo {
  const created = values.created ?? 1_000;
  const time: SessionInfo["time"] = { created, updated: values.updated ?? created };
  if (values.idle !== undefined) time.idle = values.idle;
  const info: SessionInfo = {
    id: values.id ?? "ses-root",
    projectID: "project",
    cost: values.cost ?? 0,
    tokens: values.tokens ?? makeTokens(),
    time,
    location: { directory: "C:\\project" },
  };
  if (values.parentID !== undefined) info.parentID = values.parentID;
  if (values.outcome !== undefined) info.outcome = values.outcome;
  if (values.title !== undefined) info.title = values.title;
  if (values.model !== undefined) info.model = values.model;
  return info;
}

export interface AssistantValues {
  id?: string;
  created?: number;
  completed?: number;
  content?: SessionMessageAssistant["content"];
  tokens?: TokenUsageInfo;
  error?: SessionStructuredError;
  retry?: SessionMessageAssistant["retry"];
}

export function makeAssistant(values: AssistantValues = {}): SessionMessageAssistant {
  const time: SessionMessageAssistant["time"] = { created: values.created ?? 0 };
  if (values.completed !== undefined) time.completed = values.completed;
  const message: SessionMessageAssistant = {
    id: values.id ?? "msg-assistant",
    time,
    type: "assistant",
    agent: "orchestrator",
    model: { id: "claude", providerID: "anthropic" },
    content: values.content ?? [],
  };
  if (values.tokens !== undefined) message.tokens = values.tokens;
  if (values.error !== undefined) message.error = values.error;
  if (values.retry !== undefined) message.retry = values.retry;
  return message;
}

export interface ToolValues {
  id?: string;
  name?: string;
  status?: "streaming" | "running" | "completed" | "error";
  input?: Record<string, JsonValue>;
  metadata?: Record<string, JsonValue>;
  text?: string;
  error?: SessionStructuredError;
  created?: number;
}

export function makeTool(values: ToolValues = {}): SessionMessageAssistantTool {
  const input = values.input ?? {};
  let state: SessionMessageAssistantTool["state"];
  switch (values.status ?? "running") {
    case "streaming":
      state = { status: "streaming", input: values.text ?? "" };
      break;
    case "completed": {
      const completed: SessionMessageToolStateCompleted = {
        status: "completed",
        input,
        content: [{ type: "text", text: "" }],
      };
      if (values.metadata !== undefined) completed.metadata = values.metadata;
      state = completed;
      break;
    }
    case "error": {
      const failed: SessionMessageToolStateError = {
        status: "error",
        input,
        error: values.error ?? makeError("tool failed"),
      };
      if (values.metadata !== undefined) failed.metadata = values.metadata;
      state = failed;
      break;
    }
    default:
      state = { status: "running", input, metadata: values.metadata ?? {} };
  }
  return {
    type: "tool",
    id: values.id ?? "tool-1",
    name: values.name ?? "read",
    state,
    time: { created: values.created ?? 0 },
  };
}

export function makeIdle(
  outcome: "succeeded" | "failed" | "interrupted",
  error?: SessionStructuredError,
  created = 0,
): SessionMessageIdle {
  const message: SessionMessageIdle = {
    id: "msg-idle",
    time: { created },
    type: "idle",
    outcome,
  };
  if (error !== undefined) message.error = error;
  return message;
}

export function makeCompactionRunning(created = 0): SessionMessageCompactionRunning {
  return {
    type: "compaction",
    id: "msg-compaction-running",
    time: { created },
    status: "running",
    reason: "auto",
    summary: "",
  };
}

export function makeCompactionCompleted(
  values: { created?: number; tokens?: TokenUsageInfo } = {},
): SessionMessageCompactionCompleted {
  const message: SessionMessageCompactionCompleted = {
    type: "compaction",
    id: "msg-compaction-completed",
    time: { created: values.created ?? 0 },
    status: "completed",
    reason: "auto",
    summary: "",
  };
  if (values.tokens !== undefined) message.tokens = values.tokens;
  return message;
}

export function makeError(message: string): SessionStructuredError {
  return { type: "error", message };
}
