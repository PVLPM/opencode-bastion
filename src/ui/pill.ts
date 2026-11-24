import type { AgentStatus, AgentView, FleetView } from "../model/types";
import type { ComposerPillTone, IconName } from "@opencode/plugin/gui";

interface PillView {
  readonly label: string;
  readonly icon: IconName;
  readonly tone?: ComposerPillTone;
}

function countStatus(agents: readonly AgentView[], status: AgentStatus): number {
  let count = 0;
  for (const agent of agents) if (agent.status === status) count += 1;
  return count;
}

/**
 * The composer pill's one line. Nothing shows until the orchestrator delegates,
 * and the most actionable state wins: waiting, then failure, then running.
 */
export function pillView(fleet: FleetView | undefined): PillView | undefined {
  if (fleet === undefined) return undefined;
  const subagents = fleet.active.length + fleet.inactive.length;
  if (subagents === 0) return undefined;

  const members: AgentView[] = [fleet.root];
  for (const agent of fleet.active) members.push(agent);
  for (const agent of fleet.inactive) members.push(agent);

  const total = members.length;
  const head = `${total} ${total === 1 ? "agent" : "agents"}`;
  const waiting = countStatus(members, "waiting");
  if (waiting > 0) {
    return {
      label: `${head} · ${waiting} ${waiting === 1 ? "needs" : "need"} you`,
      icon: "circle-exclamation",
      tone: "warning",
    };
  }

  const failed = countStatus(members, "failed");
  if (failed > 0) {
    return {
      label: `${head} · ${failed} failed`,
      icon: "circle-x",
      tone: "danger",
    };
  }

  const running = countStatus(members, "running");
  if (running > 0) {
    return { label: `${head} · ${running} running`, icon: "sessions-stack" };
  }

  if (countStatus(members, "unknown") > 0) {
    return { label: head, icon: "sessions-stack" };
  }

  return { label: head, icon: "check-small", tone: "success" };
}
