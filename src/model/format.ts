import type { Money } from "./types";

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "0s";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * Elapsed time of a member. `now` is only a valid end while the member is live:
 * an inactive member without an idle timestamp has no known duration.
 */
export function formatElapsed(
  startedAt: number | undefined,
  endedAt: number | undefined,
  now: number,
  active: boolean,
): string | undefined {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return undefined;
  const end = endedAt ?? (active ? now : undefined);
  if (end === undefined || !Number.isFinite(end) || end < startedAt) return undefined;
  return formatDuration(end - startedAt);
}

export function formatMoney(money: Money): string {
  const prefix = money.estimated ? "~" : "";
  if (money.usd > 0 && money.usd < 0.01) return `${prefix}<$0.01`;
  return `${prefix}$${money.usd.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** The compact metric form; `formatTokens` stays for the context ring's tooltip. */
export function formatTokenMetric(count: number): string {
  return `${formatTokens(count)} tok`;
}

export function formatClock(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  return clock.format(new Date(timestamp));
}
