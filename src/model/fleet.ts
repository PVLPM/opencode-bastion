import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";

import { deriveActivity, firstLine } from "./activity";
import { delegations } from "./delegations";
import { deriveStatus, latestAssistant } from "./status";
import type { AgentView, FleetView, LineStats, ModelLabel, Money } from "./types";
import { contextUsage, sessionInterval, tokenTotal } from "./usage";

export interface SessionSnapshot {
  info: SessionInfo;
  running: boolean;
  messages: readonly SessionMessageInfo[];
  permissions: number;
  forms: number;
  lines: LineStats | undefined;
}

export interface FleetInput {
  root: SessionSnapshot;
  children: SessionSnapshot[];
  /** Every descendant at any depth; used only for the family total. */
  descendants: SessionSnapshot[];
  currentID: string;
  agentName(info: SessionInfo): string;
  modelLabel(location: SessionInfo["location"], ref?: ModelRef): ModelLabel | undefined;
  contextLimit(location: SessionInfo["location"], ref?: ModelRef): number | undefined;
  price(tokens: TokenUsageInfo, ref?: ModelRef): Money | undefined;
  /** Exact reported cost for the whole family, as the store already sums it. */
  familyCost: number;
}

/** Reported cost wins; otherwise zero tokens are exact and tokens are estimated. */
function memberCost(input: FleetInput, info: SessionInfo): Money | undefined {
  if (Number.isFinite(info.cost) && info.cost > 0) {
    return { usd: info.cost, estimated: false };
  }
  const tokens = tokenTotal(info.tokens);
  if (!Number.isFinite(tokens) || tokens < 0) return undefined;
  if (tokens === 0) return { usd: 0, estimated: false };
  const estimate = input.price(info.tokens, info.model);
  if (estimate === undefined || !Number.isFinite(estimate.usd)) return undefined;
  return { usd: estimate.usd, estimated: true };
}

/**
 * The reported family sum already covers every member the store knows, so only
 * members with no reported cost and real tokens need an estimate added.
 */
function familyTotal(
  input: FleetInput,
  members: ReadonlyMap<string, SessionSnapshot>,
  costs: ReadonlyMap<string, Money | undefined>,
): Money | undefined {
  if (!Number.isFinite(input.familyCost)) return undefined;
  let usd = input.familyCost;
  let estimated = false;
  for (const snapshot of members.values()) {
    const info = snapshot.info;
    if (Number.isFinite(info.cost) && info.cost > 0) continue;
    const tokens = tokenTotal(info.tokens);
    if (!Number.isFinite(tokens) || tokens < 0) return undefined;
    if (tokens === 0) continue;
    const cost = costs.get(info.id);
    if (cost === undefined) return undefined;
    usd += cost.usd;
    estimated = true;
  }
  return { usd, estimated };
}

/** The desktop stores child titles as `<description> (@<agent> subagent)`. */
const SUBAGENT_SUFFIX = /\s+\(@[^)]+ subagent\)$/u;

export function sessionTitle(title: string | undefined): string | undefined {
  return title?.replace(SUBAGENT_SUFFIX, "");
}

/** The orchestrator's task is the latest prompt, never the session title. */
function latestUserTask(messages: readonly SessionMessageInfo[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "user") return firstLine(message.text);
  }
  return undefined;
}

/** The model actually serving the newest assistant turn, with its effort variant. */
function latestAssistantModel(messages: readonly SessionMessageInfo[]): ModelRef | undefined {
  return latestAssistant(messages)?.model;
}

function agentView(
  input: FleetInput,
  snapshot: SessionSnapshot,
  task: string | undefined,
  costs: ReadonlyMap<string, Money | undefined>,
): AgentView {
  const derived = deriveStatus({
    running: snapshot.running,
    permissions: snapshot.permissions,
    forms: snapshot.forms,
    info: snapshot.info,
    messages: snapshot.messages,
  });
  const interval = sessionInterval(snapshot.info, snapshot.running);
  const assistantModel = latestAssistantModel(snapshot.messages);
  const model = assistantModel ?? snapshot.info.model;
  return {
    sessionID: snapshot.info.id,
    agent: input.agentName(snapshot.info),
    title: sessionTitle(snapshot.info.title),
    model: input.modelLabel(snapshot.info.location, model),
    effort: assistantModel?.variant,
    status: derived.status,
    statusDetail: derived.detail,
    activity: deriveActivity(snapshot.messages, derived.status, derived.detail),
    task,
    startedAt: interval.startedAt,
    endedAt: interval.endedAt,
    cost: costs.get(snapshot.info.id),
    context: contextUsage(snapshot.messages, (ref) =>
      input.contextLimit(snapshot.info.location, ref),
    ),
    lines: snapshot.lines,
    errorKind: derived.errorKind,
    current: snapshot.info.id === input.currentID,
  };
}

function isActive(view: AgentView): boolean {
  return view.status === "running" || view.status === "waiting";
}

function byStartedAt(a: AgentView, b: AgentView): number {
  return (a.startedAt ?? 0) - (b.startedAt ?? 0);
}

function byEndedAt(a: AgentView, b: AgentView): number {
  if (a.endedAt === b.endedAt) return 0;
  if (a.endedAt === undefined) return 1;
  if (b.endedAt === undefined) return -1;
  return b.endedAt - a.endedAt;
}

export function buildFleet(input: FleetInput): FleetView {
  const tasks = delegations(input.root.messages);
  const members = new Map<string, SessionSnapshot>();
  members.set(input.root.info.id, input.root);
  for (const snapshot of [...input.children, ...input.descendants]) {
    if (!members.has(snapshot.info.id)) members.set(snapshot.info.id, snapshot);
  }
  const costs = new Map<string, Money | undefined>();
  for (const [id, snapshot] of members) costs.set(id, memberCost(input, snapshot.info));

  const root = agentView(input, input.root, latestUserTask(input.root.messages), costs);
  const children = input.children.map((snapshot) =>
    agentView(input, snapshot, tasks.get(snapshot.info.id)?.description, costs),
  );
  const active = children.filter(isActive).toSorted(byStartedAt);
  const inactive = children.filter((child) => !isActive(child)).toSorted(byEndedAt);
  return {
    root,
    active,
    inactive,
    totalCost: familyTotal(input, members, costs),
  };
}
