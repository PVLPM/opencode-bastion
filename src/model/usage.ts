import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";

import type { ContextUsage } from "./types";

export function tokenTotal(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function usableLimit(limit: number | undefined): number | undefined {
  return limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

/**
 * Context usage of the latest token-bearing assistant, limited by the model that
 * actually produced those tokens rather than the session's current model.
 */
export function contextUsage(
  messages: readonly SessionMessageInfo[],
  limit: (ref: ModelRef) => number | undefined,
): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "compaction" && message.status === "completed") return undefined;
    if (message?.type === "assistant" && message.tokens !== undefined) {
      const used = tokenTotal(message.tokens);
      if (!Number.isFinite(used) || used < 0) return undefined;
      const resolved = usableLimit(limit(message.model));
      return resolved === undefined ? undefined : { used, limit: resolved };
    }
  }
  return undefined;
}

export interface SessionInterval {
  startedAt: number | undefined;
  endedAt: number | undefined;
}

/** An inactive session without an idle timestamp has no known end. */
export function sessionInterval(info: SessionInfo, running: boolean): SessionInterval {
  const created = info.time.created;
  const startedAt = Number.isFinite(created) ? created : undefined;
  if (running) return { startedAt, endedAt: undefined };
  const idle = info.time.idle;
  return {
    startedAt,
    endedAt:
      startedAt !== undefined && idle !== undefined && Number.isFinite(idle) && idle >= startedAt
        ? idle
        : undefined,
  };
}
