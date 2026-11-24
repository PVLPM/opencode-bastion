import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise";

import { jsonText } from "./activity";
import type { Beam } from "./types";

export interface Delegation {
  toolID: string;
  agent: string;
  description: string | undefined;
}

export interface DelegationCall {
  /** Tool-part id; stable across updates. */
  readonly toolID: string;
  readonly childID: string;
  readonly agent: string;
  readonly description: string | undefined;
  /** The tool's run time, else creation time; absent when neither is finite. */
  readonly at: number | undefined;
}

/** Every confirmed subagent call in transcript order, including follow-ups. */
export function delegationCalls(rootMessages: readonly SessionMessageInfo[]): DelegationCall[] {
  const calls: DelegationCall[] = [];
  for (const message of rootMessages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent") continue;
      if (part.state.status === "streaming") continue;
      const childID = jsonText(part.state.metadata?.sessionID);
      if (childID === undefined) continue;
      const ran = part.time.ran;
      const at = ran !== undefined && Number.isFinite(ran) ? ran : part.time.created;
      calls.push({
        toolID: part.id,
        childID,
        agent: jsonText(part.state.input.agent) ?? "subagent",
        description: jsonText(part.state.input.description),
        at: Number.isFinite(at) ? at : undefined,
      });
    }
  }
  return calls;
}

export function delegations(rootMessages: readonly SessionMessageInfo[]): Map<string, Delegation> {
  const found = new Map<string, Delegation>();
  for (const call of delegationCalls(rootMessages)) {
    found.set(call.childID, {
      toolID: call.toolID,
      agent: call.agent,
      description: call.description,
    });
  }
  return found;
}

export interface SubagentCall {
  readonly toolID: string;
  readonly childID: string | undefined;
  readonly status: SessionMessageAssistantTool["state"]["status"];
}

/** Every subagent tool part of the root transcript, keyed by tool id, latest state wins. */
export function subagentCalls(
  rootMessages: readonly SessionMessageInfo[],
): Map<string, SubagentCall> {
  const found = new Map<string, SubagentCall>();
  for (const message of rootMessages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent") continue;
      const childID =
        part.state.status === "streaming" ? undefined : jsonText(part.state.metadata?.sessionID);
      found.set(part.id, { toolID: part.id, childID, status: part.state.status });
    }
  }
  return found;
}

let inBeamSequence = 0;

/**
 * Beams are observed tool-part transitions after hydration, never a child's
 * status: out when a new delegation enters running, in when an observed call
 * settles. `baseline` holds the parts present when the transcript was hydrated.
 */
export function detectBeams(
  baseline: ReadonlyMap<string, SubagentCall>,
  previous: ReadonlyMap<string, SubagentCall>,
  next: ReadonlyMap<string, SubagentCall>,
): Beam[] {
  const beams: Beam[] = [];
  for (const [toolID, call] of next) {
    if (call.childID === undefined) continue;
    const before = previous.get(toolID);
    const baselineCall = baseline.get(toolID);
    const hiddenAtBaseline = baselineCall?.childID === undefined;
    const fresh =
      before === undefined || before.status !== "running" || before.childID === undefined;
    const becameVisible =
      call.status === "running" ||
      (baselineCall !== undefined && baselineCall.childID === undefined);
    if (call.childID !== undefined && hiddenAtBaseline && fresh && becameVisible) {
      beams.push({
        id: `out:${call.childID}:${toolID}`,
        sessionID: call.childID,
        direction: "out",
      });
    }
    const observed =
      before !== undefined && (before.status === "running" || before.status === "streaming");
    if (observed && (call.status === "completed" || call.status === "error")) {
      inBeamSequence += 1;
      beams.push({
        id: `in:${call.childID}:${inBeamSequence}`,
        sessionID: call.childID,
        direction: "in",
      });
    }
  }
  return beams;
}
