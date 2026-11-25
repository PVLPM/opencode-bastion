import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";

import { deriveActivity, firstLine } from "./activity";
import { delegations } from "./delegations";
import { priceSession, usageRecords, type SessionPrice } from "./pricing";
import { promptText } from "./prompt";
import { deriveStatus, latestAssistant } from "./status";
import type { AgentView, FleetView, LineStats, ModelLabel, Money, TokenStats } from "./types";
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
  /** Estimated dollars for one usage record, or undefined when its route is unpriceable. */
  price(
    info: SessionInfo,
    ref: ModelRef | undefined,
    tokens: TokenUsageInfo,
    aggregated: boolean,
  ): number | undefined;
  /** Exact reported cost for the whole family, as the store already sums it. */
  familyCost: number;
  /** False once the host connection drops; live statuses become unknown. */
  connected: boolean;
}

/** A decided cost and the estimated share the store's cumulative cost omits. */
function memberCost(input: FleetInput, snapshot: SessionSnapshot): SessionPrice {
  return priceSession({
    base: snapshot.info.cost,
    tokens: snapshot.info.tokens,
    records: usageRecords(snapshot.messages),
    price: (ref, tokens, aggregated) => input.price(snapshot.info, ref, tokens, aggregated),
  });
}

/**
 * The reported family sum already covers every member the store knows, so only
 * the estimated share of zero-cost records is added; a member with no reported
 * cost contributes its whole estimate. Any member that cannot be priced leaves
 * the family total unknown instead of silently undercounting it.
 */
function familyTotal(
  input: FleetInput,
  members: ReadonlyMap<string, SessionSnapshot>,
  costs: ReadonlyMap<string, SessionPrice>,
): Money | undefined {
  if (!Number.isFinite(input.familyCost)) return undefined;
  let usd = input.familyCost;
  let estimated = false;
  for (const snapshot of members.values()) {
    const info = snapshot.info;
    if (!Number.isFinite(info.cost) || info.cost < 0) return undefined;
    const priced = costs.get(info.id);
    if (priced === undefined || priced.money === undefined) return undefined;
    if (info.cost > 0) {
      const extra = priced.extra ?? 0;
      usd += extra;
      if (extra > 0) estimated = true;
      continue;
    }
    usd += priced.money.usd;
    if (priced.money.estimated) estimated = true;
  }
  return { usd, estimated };
}

/** A counter that is absent or nonsensical leaves the whole stat unknown. */
function sessionTokens(tokens: TokenUsageInfo): TokenStats | undefined {
  const { input, output, reasoning } = tokens;
  const { read, write } = tokens.cache;
  const components = [input, output, reasoning, read, write];
  if (components.some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  const total = tokenTotal(tokens);
  if (!Number.isFinite(total) || total < 0) return undefined;
  return { input, output, reasoning, cacheRead: read, cacheWrite: write, total };
}

/** The family total is only claimed when every distinct member has valid usage. */
function familyTokens(members: ReadonlyMap<string, SessionSnapshot>): number | undefined {
  let total = 0;
  for (const snapshot of members.values()) {
    const tokens = sessionTokens(snapshot.info.tokens);
    if (tokens === undefined) return undefined;
    total += tokens.total;
  }
  return Number.isFinite(total) ? total : undefined;
}

/** The desktop stores child titles as `<description> (@<agent> subagent)`. */
const SUBAGENT_SUFFIX = /\s+\(@[^)]+ subagent\)$/u;

export function sessionTitle(title: string | undefined): string | undefined {
  return title?.replace(SUBAGENT_SUFFIX, "");
}

interface UserPrompt {
  readonly task: string | undefined;
  readonly taskText: string | undefined;
}

/** The orchestrator's task is the latest prompt, never the session title. */
function latestUserPrompt(messages: readonly SessionMessageInfo[]): UserPrompt | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "user") continue;
    const taskText = promptText(message);
    return { task: firstLine(taskText), taskText };
  }
  return undefined;
}

function descriptionText(description: string | undefined): string | undefined {
  const trimmed = description?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** The model actually serving the newest assistant turn, with its effort variant. */
function latestAssistantModel(messages: readonly SessionMessageInfo[]): ModelRef | undefined {
  return latestAssistant(messages)?.model;
}

function agentView(
  input: FleetInput,
  snapshot: SessionSnapshot,
  task: string | undefined,
  taskText: string | undefined,
  costs: ReadonlyMap<string, SessionPrice>,
): AgentView {
  const derived = deriveStatus({
    running: snapshot.running,
    permissions: snapshot.permissions,
    forms: snapshot.forms,
    info: snapshot.info,
    messages: snapshot.messages,
  });
  // A disconnected host cannot confirm a live status; keep the historical
  // tokens, cost and task, but do not present stale activity as current.
  const disconnected =
    !input.connected && (derived.status === "running" || derived.status === "waiting");
  const status = disconnected ? "unknown" : derived.status;
  const interval = sessionInterval(snapshot.info, snapshot.running && !disconnected);
  const assistantModel = latestAssistantModel(snapshot.messages);
  const model = assistantModel ?? snapshot.info.model;
  return {
    sessionID: snapshot.info.id,
    agent: input.agentName(snapshot.info),
    title: sessionTitle(snapshot.info.title),
    model: input.modelLabel(snapshot.info.location, model),
    effort: assistantModel?.variant,
    status,
    statusDetail: disconnected ? undefined : derived.detail,
    activity: disconnected
      ? undefined
      : deriveActivity(snapshot.messages, derived.status, derived.detail),
    task,
    taskText,
    startedAt: interval.startedAt,
    endedAt: interval.endedAt,
    tokens: sessionTokens(snapshot.info.tokens),
    cost: costs.get(snapshot.info.id)?.money,
    context: contextUsage(snapshot.messages, (ref) =>
      input.contextLimit(snapshot.info.location, ref),
    ),
    lines: snapshot.lines,
    errorKind: disconnected ? undefined : derived.errorKind,
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
  const costs = new Map<string, SessionPrice>();
  for (const [id, snapshot] of members) costs.set(id, memberCost(input, snapshot));

  const prompt = latestUserPrompt(input.root.messages);
  const root = agentView(input, input.root, prompt?.task, prompt?.taskText, costs);
  const children = input.children.map((snapshot) => {
    const description = tasks.get(snapshot.info.id)?.description;
    return agentView(input, snapshot, firstLine(description), descriptionText(description), costs);
  });
  const active = children.filter(isActive).toSorted(byStartedAt);
  const inactive = children.filter((child) => !isActive(child)).toSorted(byEndedAt);
  return {
    root,
    active,
    inactive,
    totalCost: familyTotal(input, members, costs),
    totalTokens: familyTokens(members),
  };
}
