import type { SessionMessageInfo } from "@opencode/client/promise";

import { jsonText } from "./activity";
import type { Beam } from "./types";

export interface Delegation {
  toolID: string;
  agent: string;
  description: string | undefined;
  prompt: string | undefined;
  done: boolean;
}

export function delegations(rootMessages: readonly SessionMessageInfo[]): Map<string, Delegation> {
  const found = new Map<string, Delegation>();
  for (const message of rootMessages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent") continue;
      if (part.state.status === "streaming") continue;
      const childID = jsonText(part.state.metadata?.sessionID);
      if (childID === undefined) continue;
      found.set(childID, {
        toolID: part.id,
        agent: jsonText(part.state.input.agent) ?? "subagent",
        description: jsonText(part.state.input.description),
        prompt: jsonText(part.state.input.prompt),
        done: part.state.status === "completed" || part.state.status === "error",
      });
    }
  }
  return found;
}

export interface BeamSnapshot {
  readonly toolIDs: ReadonlySet<string>;
  readonly running: ReadonlySet<string>;
  readonly delegationTargets: ReadonlyMap<string, string>;
}

let idleBeamSequence = 0;

export function detectBeams(prev: BeamSnapshot | undefined, next: BeamSnapshot): Beam[] {
  if (prev === undefined) return [];

  const beams: Beam[] = [];
  for (const toolID of next.toolIDs) {
    if (prev.toolIDs.has(toolID)) continue;
    const sessionID = next.delegationTargets.get(toolID);
    if (sessionID === undefined) continue;
    beams.push({ id: `out:${sessionID}:${toolID}`, sessionID, direction: "out" });
  }
  for (const sessionID of prev.running) {
    if (next.running.has(sessionID)) continue;
    idleBeamSequence += 1;
    beams.push({ id: `in:${sessionID}:${idleBeamSequence}`, sessionID, direction: "in" });
  }
  return beams;
}
