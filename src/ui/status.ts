import type { AgentStatus, AgentView } from "../model/types";

const STATUS_LABEL = {
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  unknown: "Unknown",
} satisfies Record<AgentStatus, string>;

export function statusLabel(status: AgentStatus): string {
  return STATUS_LABEL[status];
}

/** The status with its reason when OpenCode gives one, e.g. "Needs you: Waiting for permission". */
export function statusTip(agent: AgentView): string {
  const label = statusLabel(agent.status);
  if (agent.status === "failed" && agent.errorKind !== undefined)
    return `${label}: ${agent.errorKind}`;
  if (agent.statusDetail === undefined || agent.statusDetail === label) return label;
  return `${label}: ${agent.statusDetail}`;
}
