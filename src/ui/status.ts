import type { AgentStatus } from "../model/types";
import type { IconName } from "@opencode/plugin/gui";

const STATUS_LABEL = {
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  unknown: "Unknown",
} satisfies Record<AgentStatus, string>;

const STATUS_ICON = {
  running: "sessions-stack",
  waiting: "circle-exclamation",
  done: "check-small",
  failed: "circle-x",
  unknown: "dash",
} satisfies Record<AgentStatus, IconName>;

export function statusLabel(status: AgentStatus): string {
  return STATUS_LABEL[status];
}

/** The glyph shown beside a status; Running draws its own spinner instead. */
export function statusIcon(status: AgentStatus): IconName {
  return STATUS_ICON[status];
}
