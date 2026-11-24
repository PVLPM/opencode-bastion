import type { Money } from "../model/types";

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** Compact elapsed time: `12s`, `4m 05s`, `1h 02m`. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Elapsed time of a session, or undefined when OpenCode knows no start. */
export function formatElapsed(
  startedAt: number | undefined,
  endedAt: number | undefined,
  now: number,
): string | undefined {
  if (startedAt === undefined) return undefined;
  const end = endedAt ?? now;
  if (end < startedAt) return undefined;
  return formatDuration(end - startedAt);
}

/** Cost as OpenCode reports it; a leading `~` marks a models.dev estimate. */
export function formatMoney(money: Money): string {
  if (money.usd > 0 && money.usd < 0.01) return "<$0.01";
  const estimate = money.estimated ? "~" : "";
  return `${estimate}$${money.usd.toFixed(2)}`;
}

/** Token counts in the compact form the app uses: `1.2k`, `18.4k`, `1.2M`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) {
    const thousands = count / 1000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatClock(timestamp: number): string {
  return clock.format(new Date(timestamp));
}
