import type {
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
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

type TerminalOutcome = SessionMessageIdle["outcome"];

interface TerminalEvidence {
  outcome: TerminalOutcome;
  error: SessionStructuredError | undefined;
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

/**
 * Execution boundary is the latest assistant start. Queued user messages can be
 * inserted before delivery, so they must not move the boundary or hide an error.
 */
function latestAssistantStart(messages: readonly SessionMessageInfo[]): number | undefined {
  const assistant = latestAssistant(messages);
  if (assistant === undefined || !Number.isFinite(assistant.time.created)) return undefined;
  return assistant.time.created;
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
  return latestAssistant(messages)?.error;
}

/** The newest terminal evidence that belongs to the latest execution, if any. */
function terminalEvidence(input: StatusInput): TerminalEvidence | undefined {
  const start = latestAssistantStart(input.messages);
  const idle = latestIdle(input.messages);
  const idleTime = idle?.time.created;
  const idleEligible =
    idle !== undefined && idleTime !== undefined && (start === undefined || idleTime >= start);
  const infoTime = input.info.time.idle;
  const infoEligible =
    input.info.outcome !== undefined &&
    (start === undefined || (infoTime !== undefined && infoTime >= start));

  if (idleEligible && idle !== undefined && idleTime !== undefined) {
    if (infoEligible && input.info.outcome !== undefined) {
      if (infoTime !== undefined && infoTime > idleTime) {
        return { outcome: input.info.outcome, error: undefined };
      }
    }
    return { outcome: idle.outcome, error: idle.error };
  }
  if (infoEligible && input.info.outcome !== undefined) {
    return { outcome: input.info.outcome, error: undefined };
  }
  return undefined;
}

function failed(error: SessionStructuredError | undefined): StatusResult {
  return {
    status: "failed",
    detail: undefined,
    errorKind: error === undefined ? undefined : errorKindFor(error),
  };
}

function idleStatus(input: StatusInput): StatusResult {
  const terminal = terminalEvidence(input);
  if (terminal?.outcome === "succeeded") {
    return { status: "done", detail: undefined, errorKind: undefined };
  }
  if (terminal?.outcome === "failed") {
    return failed(terminal.error ?? latestAssistantError(input.messages));
  }
  if (terminal?.outcome === "interrupted") {
    return { status: "unknown", detail: "Interrupted", errorKind: undefined };
  }
  const error = latestAssistantError(input.messages);
  if (error !== undefined) return failed(error);
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
