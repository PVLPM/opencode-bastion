import type { SessionInfo, SessionMessageInfo, TokenUsageInfo } from "@opencode/client/promise";

import type { ContextUsage } from "./types";

export function tokenTotal(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

export function contextUsage(
  messages: readonly SessionMessageInfo[],
  limit: number | undefined,
): ContextUsage | undefined {
  if (!limit) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "compaction" && message.status === "completed") return undefined;
    if (message?.type === "assistant" && message.tokens !== undefined) {
      return { used: tokenTotal(message.tokens), limit };
    }
  }
  return undefined;
}

function latestMessageTime(messages: readonly SessionMessageInfo[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    if (latest === undefined || message.time.created > latest) latest = message.time.created;
  }
  return latest;
}

export interface SessionInterval {
  startedAt: number;
  endedAt: number | undefined;
}

export function sessionInterval(
  info: SessionInfo,
  running: boolean,
  messages: readonly SessionMessageInfo[] = [],
): SessionInterval {
  const startedAt = info.time.created;
  if (running) return { startedAt, endedAt: undefined };
  const idle = info.time.idle;
  if (idle !== undefined && idle >= startedAt) return { startedAt, endedAt: idle };
  return { startedAt, endedAt: latestMessageTime(messages) };
}
