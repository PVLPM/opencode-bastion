// Synthetic SDK objects for model tests. Shapes mirror @opencode/client 2.4.1.
import type {
  AgentInfo,
  JsonValue,
  ModelInfo,
  ModelRef,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptSkillAttachment,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompactionCompleted,
  SessionMessageCompactionRunning,
  SessionMessageIdle,
  SessionMessageSynthetic,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageUser,
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
  agent?: string;
  cost?: number;
  tokens?: TokenUsageInfo;
  outcome?: "succeeded" | "failed" | "interrupted";
  created?: number;
  updated?: number;
  idle?: number;
  title?: string;
  model?: ModelRef;
  location?: SessionInfo["location"];
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
    location: values.location ?? { directory: "C:\\project" },
  };
  if (values.parentID !== undefined) info.parentID = values.parentID;
  if (values.agent !== undefined) info.agent = values.agent;
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
  model?: ModelRef;
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
    model: values.model ?? { id: "claude", providerID: "anthropic" },
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
  ran?: number;
}

export function makeTool(values: ToolValues = {}): SessionMessageAssistantTool {
  const input = values.input ?? {};
  const time: SessionMessageAssistantTool["time"] = { created: values.created ?? 0 };
  if (values.ran !== undefined) time.ran = values.ran;
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
    time,
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

export interface UserValues {
  readonly displayText?: string;
  readonly files?: readonly PromptFileAttachment[];
  readonly agents?: readonly PromptAgentAttachment[];
  readonly skills?: readonly PromptSkillAttachment[];
}

export function makeUser(
  created = 0,
  text = "Do the work",
  values: UserValues = {},
): SessionMessageUser {
  const message: SessionMessageUser = {
    id: `msg-user-${created}`,
    time: { created },
    type: "user",
    text,
  };
  if (values.displayText !== undefined) message.metadata = { displayText: values.displayText };
  if (values.files !== undefined) message.files = [...values.files];
  if (values.agents !== undefined) message.agents = [...values.agents];
  if (values.skills !== undefined) message.skills = [...values.skills];
  return message;
}

export interface SyntheticValues {
  id?: string;
  created?: number;
  text?: string;
  description?: string;
}

export function makeSynthetic(values: SyntheticValues = {}): SessionMessageSynthetic {
  const message: SessionMessageSynthetic = {
    id: values.id ?? "msg-synthetic",
    time: { created: values.created ?? 0 },
    type: "synthetic",
    text: values.text ?? "Continue",
  };
  if (values.description !== undefined) message.description = values.description;
  return message;
}

export interface AgentValues {
  id?: string;
  name?: string;
}

export function makeAgent(values: AgentValues = {}): AgentInfo {
  return {
    id: values.id ?? "build",
    name: values.name ?? "build",
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [],
  };
}

export function makeError(
  message: string,
  type = "error",
  status?: number,
): SessionStructuredError {
  const error: SessionStructuredError = { type, message };
  if (status !== undefined) error.status = status;
  return error;
}

export interface ModelValues {
  providerID?: string;
  modelID?: string;
  name?: string;
  contextLimit?: number;
}

export function makeModel(values: ModelValues = {}): ModelInfo {
  const providerID = values.providerID ?? "anthropic";
  const modelID = values.modelID ?? "claude";
  const context = values.contextLimit ?? 200_000;
  return {
    id: `${providerID}/${modelID}`,
    modelID,
    providerID,
    name: values.name ?? modelID,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context, output: context },
  };
}
