import type {
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStructuredError,
} from "@opencode/client/promise";

import type { AgentStatus, ErrorKind } from "./types";

export interface StatusInput {
  running: boolean;
  permissions: number;
  forms: number;
  info: SessionInfo;
  messages: readonly SessionMessageInfo[];
}

interface StatusResult {
  status: AgentStatus;
  detail: string | undefined;
  errorKind: ErrorKind | undefined;
}

function latestAssistant(
  messages: readonly SessionMessageInfo[],
): SessionMessageAssistant | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "assistant") return message;
  }
  return undefined;
}

function latestIdle(messages: readonly SessionMessageInfo[]): SessionMessageIdle | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "idle") return message;
  }
  return undefined;
}

function latestUser(messages: readonly SessionMessageInfo[]): SessionMessageUser | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "user") return message;
  }
  return undefined;
}

/** The newest user or assistant start; anything older belongs to a previous execution. */
function latestExecutionStart(messages: readonly SessionMessageInfo[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    if (message.type !== "user" && message.type !== "assistant") continue;
    const created = message.time.created;
    if (!Number.isFinite(created)) continue;
    if (latest === undefined || created > latest) latest = created;
  }
  return latest;
}

/** Maps an SDK error type to a safe category; the raw message never reaches the UI. */
export function errorKindFor(error: SessionStructuredError): ErrorKind {
  const type = error.type.toLowerCase();
  const status = error.status;
  if (type.includes("abort") || type.includes("cancel") || type.includes("interrupt")) {
    return "aborted";
  }
  if (type.includes("auth") || status === 401 || status === 403) return "authentication";
  if (type.includes("context") || type.includes("overflow")) return "context limit";
  if (type.includes("output") || type.includes("length")) return "output limit";
  if (type.includes("rate") || status === 429) return "rate limit";
  if (type.includes("provider") || type.includes("api")) return "provider error";
  return "error";
}

function latestAssistantError(
  messages: readonly SessionMessageInfo[],
): SessionStructuredError | undefined {
  const assistant = latestAssistant(messages);
  if (assistant?.error === undefined) return undefined;
  const user = latestUser(messages);
  if (user !== undefined && assistant.time.created <= user.time.created) return undefined;
  return assistant.error;
}

function idleStatus(input: StatusInput): StatusResult {
  const start = latestExecutionStart(input.messages);
  const idle = latestIdle(input.messages);
  const idleWins = idle !== undefined && (start === undefined || idle.time.created >= start);
  const infoWins =
    !idleWins &&
    input.info.outcome !== undefined &&
    (start === undefined || (input.info.time.idle !== undefined && input.info.time.idle >= start));
  const outcome = idleWins ? idle.outcome : infoWins ? input.info.outcome : undefined;

  if (outcome === "succeeded") return { status: "done", detail: undefined, errorKind: undefined };
  if (outcome === "failed") {
    const error = (idleWins ? idle.error : undefined) ?? latestAssistantError(input.messages);
    return {
      status: "failed",
      detail: undefined,
      errorKind: error === undefined ? undefined : errorKindFor(error),
    };
  }
  if (outcome === "interrupted") {
    return { status: "unknown", detail: "Interrupted", errorKind: undefined };
  }
  return { status: "unknown", detail: undefined, errorKind: undefined };
}

export function deriveStatus(input: StatusInput): StatusResult {
  if (input.forms > 0) {
    return { status: "waiting", detail: "Waiting for your answer", errorKind: undefined };
  }
  if (input.permissions > 0) {
    return { status: "waiting", detail: "Waiting for permission", errorKind: undefined };
  }
  if (!input.running) return idleStatus(input);

  const assistant = latestAssistant(input.messages);
  const retry =
    assistant !== undefined && assistant.time.completed === undefined ? assistant.retry : undefined;
  return {
    status: "running",
    detail: retry === undefined ? undefined : `Retrying (attempt ${retry.attempt})`,
    errorKind: undefined,
  };
}
