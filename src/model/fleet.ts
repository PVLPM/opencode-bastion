import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";

import { deriveActivity } from "./activity";
import { delegations, type Delegation } from "./delegations";
import { deriveStatus } from "./status";
import type { AgentView, FleetView, LineStats, ModelLabel, Money } from "./types";
import { contextUsage, sessionInterval } from "./usage";

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
  currentID: string;
  agentName(id: string): string;
  modelLabel(ref?: ModelRef): ModelLabel | undefined;
  contextLimit(ref?: ModelRef): number | undefined;
  price(tokens: TokenUsageInfo, ref?: ModelRef): Money | undefined;
  familyCost: number;
}

function memberCost(input: FleetInput, snapshot: SessionSnapshot): Money | undefined {
  if (snapshot.info.cost > 0) return { usd: snapshot.info.cost, estimated: false };
  return input.price(snapshot.info.tokens, snapshot.info.model);
}

function agentView(
  input: FleetInput,
  snapshot: SessionSnapshot,
  task: Delegation | undefined,
): AgentView {
  const derived = deriveStatus({
    running: snapshot.running,
    permissions: snapshot.permissions,
    forms: snapshot.forms,
    info: snapshot.info,
    messages: snapshot.messages,
  });
  const interval = sessionInterval(snapshot.info, snapshot.running, snapshot.messages);
  return {
    sessionID: snapshot.info.id,
    agent: input.agentName(snapshot.info.id),
    title: snapshot.info.title,
    model: input.modelLabel(snapshot.info.model),
    status: derived.status,
    statusDetail: derived.detail,
    activity: deriveActivity(snapshot.messages, derived.status, derived.detail),
    task: task?.description,
    prompt: task?.prompt,
    startedAt: interval.startedAt,
    endedAt: interval.endedAt,
    cost: memberCost(input, snapshot),
    context: contextUsage(snapshot.messages, input.contextLimit(snapshot.info.model)),
    lines: snapshot.lines,
    error: derived.error,
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

function estimatedFamilyCost(input: FleetInput): Money | undefined {
  let usd = 0;
  for (const snapshot of [input.root, ...input.children]) {
    const cost = input.price(snapshot.info.tokens, snapshot.info.model);
    if (cost === undefined) return undefined;
    usd += cost.usd;
  }
  return { usd, estimated: true };
}

function totalCost(input: FleetInput, members: readonly AgentView[]): Money | undefined {
  if (members.some((member) => member.cost?.estimated === true)) {
    return estimatedFamilyCost(input);
  }
  return { usd: input.familyCost, estimated: false };
}

export function buildFleet(input: FleetInput): FleetView {
  const tasks = delegations(input.root.messages);
  const root = agentView(input, input.root, undefined);
  const children = input.children.map((snapshot) =>
    agentView(input, snapshot, tasks.get(snapshot.info.id)),
  );
  const active = children.filter(isActive).toSorted(byStartedAt);
  const inactive = children.filter((child) => !isActive(child)).toSorted(byEndedAt);
  return {
    root,
    active,
    inactive,
    totalCost: totalCost(input, [root, ...children]),
  };
}
