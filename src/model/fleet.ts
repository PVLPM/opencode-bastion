import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  SessionMessageUser,
  TokenUsageInfo,
} from "@opencode/client/promise";

import { deriveActivity, firstLine, jsonText } from "./activity";
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

interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The typed prompt with the native mention spans removed when they still match. */
function userPromptText(message: SessionMessageUser): string | undefined {
  const displayText = jsonText(message.metadata?.displayText);
  let text = displayText !== undefined && displayText.trim() !== "" ? displayText : message.text;
  const mentions: MentionRange[] = [];
  for (const attachment of [
    ...(message.files ?? []),
    ...(message.agents ?? []),
    ...(message.skills ?? []),
  ]) {
    if (attachment.mention !== undefined) mentions.push(attachment.mention);
  }
  // Earlier offsets stay valid while later ranges are removed first.
  for (const mention of mentions.toSorted((a, b) => b.start - a.start)) {
    const { start, end } = mention;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end > text.length || start >= end) continue;
    if (text.slice(start, end) !== mention.text) continue;
    text = `${text.slice(0, start)}${text.slice(end)}`;
  }
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
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
    const taskText = userPromptText(message);
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
    taskText,
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
  };
}
