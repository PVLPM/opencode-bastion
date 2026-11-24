import type {
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
} from "@opencode/client/promise";

import { firstLine } from "./activity";
import { delegationCalls } from "./delegations";
import type { AgentStatus, Handoff, Lane, LaneBlock, LanesView } from "./types";

export interface LaneSession {
  readonly info: SessionInfo;
  readonly running: boolean;
  /** True when the existing status derivation says the session waits for the user. */
  readonly waiting: boolean;
  readonly messages: readonly SessionMessageInfo[];
}

export interface LanesInput {
  readonly root: LaneSession;
  readonly children: readonly LaneSession[];
  agentName(info: SessionInfo): string;
  title(info: SessionInfo): string | undefined;
}

interface DraftBlock {
  readonly id: string;
  readonly start: number;
  end: number | undefined;
  status: AgentStatus;
  label: string | undefined;
  text: string | undefined;
}

interface HandoffDraft {
  readonly id: string;
  readonly childID: string;
  readonly at: number;
  readonly description: string | undefined;
}

interface ChildLane {
  readonly session: LaneSession;
  readonly blocks: readonly DraftBlock[];
}

function nonEmpty(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function outcomeStatus(outcome: SessionMessageIdle["outcome"]): AgentStatus {
  if (outcome === "succeeded") return "done";
  if (outcome === "failed") return "failed";
  return "unknown";
}

/** The full prompt before a root block opened: a user message or a synthetic one. */
function promptText(messages: readonly SessionMessageInfo[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message === undefined) continue;
    if (message.type === "user") return nonEmpty(message.text);
    if (message.type === "synthetic") {
      return nonEmpty(message.description) ?? nonEmpty(message.text);
    }
  }
  return undefined;
}

/** The first prompt after the last idle: the message that started the live run. */
function triggerMessage(messages: readonly SessionMessageInfo[]): SessionMessageInfo | undefined {
  let trigger: SessionMessageInfo | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.type === "idle") break;
    if (message.type === "user" || message.type === "synthetic") trigger = message;
  }
  return trigger;
}

/**
 * One block per execution: the first finite assistant after an idle marker opens
 * it, the next idle closes it. Later assistants and tool calls stay in the block.
 */
function deriveBlocks(
  session: LaneSession,
  textFor: ((index: number) => string | undefined) | undefined,
): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  let open: DraftBlock | undefined;
  let lastAssistant: SessionMessageAssistant | undefined;

  for (let index = 0; index < session.messages.length; index += 1) {
    const message = session.messages[index];
    if (message === undefined) continue;
    if (message.type === "assistant") {
      if (!Number.isFinite(message.time.created)) continue;
      if (open === undefined) {
        const text = textFor?.(index);
        open = {
          id: `${session.info.id}:${message.id}`,
          start: message.time.created,
          end: undefined,
          status: "unknown",
          label: firstLine(text),
          text,
        };
        blocks.push(open);
      }
      lastAssistant = message;
      continue;
    }
    if (message.type !== "idle" || open === undefined) continue;
    const end = message.time.created;
    if (!Number.isFinite(end) || end < open.start) continue;
    open.end = end;
    open.status = outcomeStatus(message.outcome);
    open = undefined;
    lastAssistant = undefined;
  }

  if (open === undefined && session.running) {
    const trigger = triggerMessage(session.messages);
    if (trigger !== undefined && Number.isFinite(trigger.time.created)) {
      open = {
        id: `${session.info.id}:${trigger.id}`,
        start: trigger.time.created,
        end: undefined,
        status: session.waiting ? "waiting" : "running",
        label: undefined,
        text: undefined,
      };
      blocks.push(open);
    }
  }

  if (open !== undefined) {
    if (session.running) {
      open.status = session.waiting ? "waiting" : "running";
    } else if (lastAssistant !== undefined) {
      const completed = lastAssistant.time.completed;
      open.end =
        completed !== undefined && Number.isFinite(completed)
          ? completed
          : lastAssistant.time.created;
      open.status = "unknown";
    }
  }
  return blocks;
}

/** Confirmed root→child calls; only a resolved child session id counts. */
function handoffDrafts(root: LaneSession, childIDs: ReadonlySet<string>): HandoffDraft[] {
  const drafts: HandoffDraft[] = [];
  for (const call of delegationCalls(root.messages)) {
    if (call.at === undefined || !childIDs.has(call.childID)) continue;
    drafts.push({
      id: call.toolID,
      childID: call.childID,
      at: call.at,
      description: call.description,
    });
  }
  return drafts.toSorted((a, b) => a.at - b.at);
}

function placeHandoffs(
  drafts: readonly HandoffDraft[],
  blocksByChild: ReadonlyMap<string, readonly DraftBlock[]>,
): Handoff[] {
  const seen = new Set<string>();
  const labelledBlocks = new Set<string>();
  const handoffs: Handoff[] = [];
  for (const draft of drafts) {
    const kind = seen.has(draft.childID) ? "followup" : "delegate";
    seen.add(draft.childID);
    const blocks = blocksByChild.get(draft.childID) ?? [];
    const block =
      blocks.find(
        (candidate) =>
          candidate.start <= draft.at && (candidate.end === undefined || draft.at < candidate.end),
      ) ?? blocks.find((candidate) => candidate.start >= draft.at);
    if (block !== undefined && !labelledBlocks.has(block.id)) {
      labelledBlocks.add(block.id);
      block.label = draft.description;
      block.text = draft.description;
    }
    handoffs.push({
      id: draft.id,
      childID: draft.childID,
      at: draft.at,
      blockID: block?.id,
      kind,
    });
  }
  return handoffs;
}

function byID(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Running lanes first by first start, then lanes without blocks by creation. */
function compareChildren(a: ChildLane, b: ChildLane): number {
  const aStart = a.blocks[0]?.start;
  const bStart = b.blocks[0]?.start;
  if (aStart !== bStart) {
    if (aStart === undefined) return 1;
    if (bStart === undefined) return -1;
    return aStart - bStart;
  }
  if (aStart === undefined) {
    const byCreated = a.session.info.time.created - b.session.info.time.created;
    if (byCreated !== 0) return byCreated;
  }
  return byID(a.session.info.id, b.session.info.id);
}

function laneView(
  input: LanesInput,
  session: LaneSession,
  root: boolean,
  blocks: readonly LaneBlock[],
): Lane {
  return {
    sessionID: session.info.id,
    agent: input.agentName(session.info),
    title: input.title(session.info),
    root,
    blocks,
  };
}

export function deriveLanes(input: LanesInput): LanesView {
  const rootBlocks = deriveBlocks(input.root, (index) => promptText(input.root.messages, index));
  const childLanes = input.children.map((session) => ({
    session,
    blocks: deriveBlocks(session, undefined),
  }));
  const blocksByChild = new Map<string, readonly DraftBlock[]>();
  for (const child of childLanes) blocksByChild.set(child.session.info.id, child.blocks);

  const handoffs = placeHandoffs(
    handoffDrafts(input.root, new Set(blocksByChild.keys())),
    blocksByChild,
  );

  const lanes: Lane[] = [laneView(input, input.root, true, rootBlocks)];
  for (const child of childLanes.toSorted(compareChildren)) {
    lanes.push(laneView(input, child.session, false, child.blocks));
  }

  let from: number | undefined;
  for (const lane of lanes) {
    const start = lane.blocks[0]?.start;
    if (start !== undefined && (from === undefined || start < from)) from = start;
  }
  return { lanes, handoffs, from };
}
