import type { AgentStatus, Handoff, Lane, LanesView } from "../../src/model/types";
import { TEST_NOW } from "./fixtures";

/** Seconds after `TEST_NOW`; an absent end is a live execution. */
type BlockInit = readonly [start: number, end: number | undefined, status?: AgentStatus];

export const at = (seconds: number) => TEST_NOW + seconds * 1000;

export function lane(
  sessionID: string,
  agent: string,
  blocks: readonly BlockInit[],
  root = false,
): Lane {
  return {
    sessionID,
    agent,
    title: undefined,
    root,
    blocks: blocks.map(([start, end, status], index) => ({
      id: `${sessionID}:${index}`,
      start: at(start),
      end: end === undefined ? undefined : at(end),
      status: status ?? (end === undefined ? "running" : "done"),
      label: `${agent} ${index}`,
      text: `${agent} ${index}\nFull execution text`,
    })),
  };
}

export function handoff(
  id: string,
  childID: string,
  seconds: number,
  blockID: string | undefined,
  kind: Handoff["kind"] = "delegate",
): Handoff {
  return { id, childID, at: at(seconds), blockID, kind };
}

export function lanesView(lanes: readonly Lane[], handoffs: readonly Handoff[] = []): LanesView {
  const starts = lanes.flatMap((item) => item.blocks.map((block) => block.start));
  return { lanes, handoffs, from: starts.length === 0 ? undefined : Math.min(...starts) };
}

/**
 * An orchestrator with two turns and an idle gap, a child that ran, went idle
 * and was followed up (still live), and a second child with the same name.
 */
export function familyLanes(): LanesView {
  return lanesView(
    [
      lane(
        "ses_root",
        "Orchestrator",
        [
          [0, 10],
          [30, 40],
        ],
        true,
      ),
      lane("ses_fixer_a", "Fixer", [
        [5, 20],
        [35, undefined],
      ]),
      lane("ses_fixer_b", "Fixer", [[8, 25, "failed"]]),
    ],
    [
      handoff("call_a", "ses_fixer_a", 4, "ses_fixer_a:0"),
      handoff("call_b", "ses_fixer_b", 7, "ses_fixer_b:0"),
      handoff("call_a2", "ses_fixer_a", 34, "ses_fixer_a:1", "followup"),
    ],
  );
}
