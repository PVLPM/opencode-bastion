import type {
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
} from "@opencode/client/promise";

import type { AgentStatus } from "./types";

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
  error: string | undefined;
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

function idleStatus(input: StatusInput): StatusResult {
  const idle = latestIdle(input.messages);
  const outcome = input.info.outcome ?? idle?.outcome;
  if (outcome === "succeeded") return { status: "done", detail: undefined, error: undefined };
  if (outcome === "failed") {
    return {
      status: "failed",
      detail: undefined,
      error: idle?.error?.message ?? latestAssistant(input.messages)?.error?.message,
    };
  }
  if (outcome === "interrupted") {
    return { status: "unknown", detail: "Interrupted", error: undefined };
  }
  return { status: "unknown", detail: undefined, error: undefined };
}

export function deriveStatus(input: StatusInput): StatusResult {
  if (input.forms > 0) {
    return { status: "waiting", detail: "Waiting for your answer", error: undefined };
  }
  if (input.permissions > 0) {
    return { status: "waiting", detail: "Waiting for permission", error: undefined };
  }
  if (!input.running) return idleStatus(input);

  const assistant = latestAssistant(input.messages);
  const retry =
    assistant !== undefined && assistant.time.completed === undefined ? assistant.retry : undefined;
  return {
    status: "running",
    detail: retry === undefined ? undefined : `Retrying (attempt ${retry.attempt})`,
    error: undefined,
  };
}
