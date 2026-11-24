import type {
  FileDiffInfo,
  LocationRef,
  ModelInfo,
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";
import type { Data } from "@opencode/client/solid";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import { detectBeams, subagentCalls, type SubagentCall } from "../model/delegations";
import { buildFleet, sessionTitle, type SessionSnapshot } from "../model/fleet";
import { deriveLanes, type LaneSession } from "../model/lanes";
import { resolveCost, type PriceTable } from "../model/pricing";
import type { AgentStatus, Beam, FleetView, LanesView, LineStats, Money } from "../model/types";
import { tokenTotal } from "../model/usage";

export interface FleetData {
  readonly session: Omit<
    Pick<Data["session"], "get" | "list" | "missing" | "root" | "status" | "cost" | "sync">,
    "get"
  > & {
    /** The host store returns undefined for a session it has not loaded yet. */
    get(sessionID: string): SessionInfo | undefined;
    readonly message: Pick<Data["session"]["message"], "list" | "sync">;
    readonly permission: Pick<Data["session"]["permission"], "list" | "sync">;
    readonly form: Pick<Data["session"]["form"], "list" | "sync">;
  };
  readonly location: {
    readonly agent: Pick<Data["location"]["agent"], "list" | "sync">;
    readonly model: Pick<Data["location"]["model"], "list" | "sync">;
  };
}

interface FleetServer {
  readonly id: string;
  readonly connected: boolean;
  readonly data: FleetData;
  readonly client: {
    readonly session: {
      diff(input: { sessionID: string }): Promise<FileDiffInfo[]>;
    };
  };
}

export interface FleetSession {
  readonly id: string;
  readonly server: FleetServer;
}

export interface FleetHost {
  current(): FleetSession | undefined;
  openTab(server: string, id: string): void;
  fetchPrices(): Promise<PriceTable>;
}

export interface FleetSource {
  readonly fleet: Accessor<FleetView | undefined>;
  readonly lanes: Accessor<LanesView | undefined>;
  readonly beams: Accessor<readonly Beam[]>;
  readonly now: Accessor<number>;
  canOpen(sessionID: string): boolean;
  open(sessionID: string): void;
}

interface Anchor {
  readonly session: FleetSession;
  readonly data: FleetData;
  readonly serverID: string;
  readonly routedID: string;
  readonly rootID: string;
  readonly connected: boolean;
}

interface Family extends Anchor {
  readonly root: SessionInfo;
  readonly children: SessionInfo[];
  readonly descendants: SessionInfo[];
}

interface Hydration {
  readonly scope: string;
  readonly calls: ReadonlyMap<string, SubagentCall>;
}

function scopeKey(anchor: Anchor): string {
  return `${anchor.serverID}\n${anchor.connected ? "on" : "off"}\n${anchor.rootID}`;
}

/** The SDK's location identity: directory plus workspace when present. */
function locationKey(location: LocationRef): string {
  return location.workspaceID === undefined
    ? location.directory
    : `${location.workspaceID}\n${location.directory}`;
}

function sessionInfo(data: FleetData, sessionID: string): SessionInfo | undefined {
  return data.session.get(sessionID);
}

function knownSessions(data: FleetData): SessionInfo[] {
  return data.session.list().filter((info) => !data.session.missing(info.id));
}

function directChildren(data: FleetData, rootID: string): SessionInfo[] {
  return knownSessions(data).filter((info) => info.parentID === rootID);
}

/** Every known descendant at any depth, so a grandchild's cost is never dropped. */
function descendantsOf(data: FleetData, rootID: string): SessionInfo[] {
  const all = knownSessions(data);
  const byID = new Map(all.map((info) => [info.id, info]));
  const under = (info: SessionInfo): boolean => {
    const seen = new Set<string>([info.id]);
    let parentID = info.parentID;
    while (parentID !== undefined && !seen.has(parentID)) {
      if (parentID === rootID) return true;
      seen.add(parentID);
      parentID = byID.get(parentID)?.parentID;
    }
    return false;
  };
  return all.filter((info) => info.id !== rootID && under(info));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modelFor(data: FleetData, location: LocationRef, ref: ModelRef): ModelInfo | undefined {
  return data.location.model
    .list(location)
    ?.find((model) => model.providerID === ref.providerID && model.modelID === ref.id);
}

function agentNameFor(data: FleetData, info: SessionInfo): string {
  const agent = data.location.agent.list(info.location)?.find((entry) => entry.id === info.agent);
  return capitalize(agent?.name ?? info.agent ?? "unknown");
}

function latestSnapshotKey(messages: readonly SessionMessageInfo[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    if (message.time.completed === undefined) continue;
    if ((message.snapshot?.files?.length ?? 0) === 0) continue;
    return message.time.completed;
  }
  return undefined;
}

function sumLines(files: readonly FileDiffInfo[]): LineStats {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.additions;
    removed += file.deletions;
  }
  return { added, removed };
}

function priceFor(
  table: PriceTable | undefined,
  tokens: TokenUsageInfo,
  ref: ModelRef | undefined,
): Money | undefined {
  if (table === undefined || ref === undefined) return undefined;
  return resolveCost(0, tokens, { providerID: ref.providerID, modelID: ref.id }, table);
}

export function createFleetSource(host: FleetHost): FleetSource {
  const routed = createMemo(() => host.current());
  const [now, setNow] = createSignal(Date.now());
  const [prices, setPrices] = createSignal<PriceTable | undefined>(undefined);
  const [beams, setBeams] = createSignal<readonly Beam[]>([]);
  const [lines, setLines] = createSignal<ReadonlyMap<string, LineStats | undefined>>(new Map());
  const [hydration, setHydration] = createSignal<Hydration | undefined>(undefined);

  const synced = new Set<string>();
  const lineKeys = new Map<string, number>();
  const lineRequests = new Map<string, number>();
  let lineRequestSequence = 0;
  let syncScope: string | undefined;
  let activation = 0;
  let beamScope: string | undefined;
  let beamPrevious: ReadonlyMap<string, SubagentCall> | undefined;
  let pricesStarted = false;

  const beamTimers = new Set<ReturnType<typeof setTimeout>>();

  function clearBeams(): void {
    for (const timer of beamTimers) clearTimeout(timer);
    beamTimers.clear();
    setBeams([]);
  }

  function addBeams(created: readonly Beam[]): void {
    setBeams((existing) => [...existing, ...created]);
    for (const beam of created) {
      const timer = setTimeout(() => {
        beamTimers.delete(timer);
        setBeams((existing) => existing.filter((entry) => entry.id !== beam.id));
      }, 900);
      beamTimers.add(timer);
    }
  }

  onCleanup(clearBeams);

  function resetScope(): void {
    activation += 1;
    synced.clear();
    setHydration(undefined);
    beamScope = undefined;
    beamPrevious = undefined;
    clearBeams();
    lineKeys.clear();
    lineRequests.clear();
    setLines(new Map());
  }

  function syncOnce(key: string, run: () => Promise<void>, done?: () => void): void {
    if (synced.has(key)) return;
    synced.add(key);
    const startedAt = activation;
    run().then(
      () => {
        if (activation !== startedAt) return;
        done?.();
      },
      () => {
        if (activation !== startedAt) return;
        synced.delete(key);
      },
    );
  }

  const anchor = createMemo<Anchor | undefined>(() => {
    const session = routed();
    if (session === undefined) return undefined;
    return {
      session,
      data: session.server.data,
      serverID: session.server.id,
      routedID: session.id,
      rootID: session.server.data.session.root(session.id),
      connected: session.server.connected,
    };
  });

  const family = createMemo<Family | undefined>(() => {
    const current = anchor();
    if (current === undefined) return undefined;
    const root = sessionInfo(current.data, current.rootID);
    if (root === undefined) return undefined;
    return {
      ...current,
      root,
      children: directChildren(current.data, current.rootID),
      descendants: descendantsOf(current.data, current.rootID),
    };
  });

  createEffect(() => {
    const current = anchor();
    const scope = current === undefined ? undefined : scopeKey(current);
    if (scope !== syncScope) {
      syncScope = scope;
      resetScope();
    }
    if (current === undefined || scope === undefined || !current.connected) return;
    const data = current.data;
    if (data.session.missing(current.rootID)) return;

    syncOnce(`${scope}\nrouted\n${current.routedID}`, () => data.session.sync(current.routedID));
    syncOnce(`${scope}\nroot`, () => data.session.sync(current.rootID, { children: true }));

    const root = sessionInfo(data, current.rootID);
    if (root === undefined) return;

    const members = [root, ...directChildren(data, current.rootID)];
    const locations = new Map<string, LocationRef>();
    for (const info of members) locations.set(locationKey(info.location), info.location);
    for (const [key, location] of locations) {
      syncOnce(`${scope}\nagents\n${key}`, () => data.location.agent.sync(location));
      syncOnce(`${scope}\nmodels\n${key}`, () => data.location.model.sync(location));
    }

    for (const info of members) {
      if (info.id === root.id) {
        syncOnce(
          `${scope}\nmessages\n${info.id}`,
          () => data.session.message.sync(info.id),
          () => {
            if (syncScope !== scope) return;
            setHydration({
              scope,
              calls: subagentCalls(data.session.message.list(info.id)),
            });
          },
        );
      } else {
        syncOnce(`${scope}\nmessages\n${info.id}`, () => data.session.message.sync(info.id));
      }
      syncOnce(`${scope}\npermissions\n${info.id}`, () => data.session.permission.sync(info.id));
      syncOnce(`${scope}\nforms\n${info.id}`, () => data.session.form.sync(info.id, info.location));
    }
  });

  createEffect(() => {
    const current = anchor();
    if (current === undefined) return;
    const scope = scopeKey(current);
    const hydrated = hydration();
    if (hydrated === undefined || hydrated.scope !== scope) return;
    const next = subagentCalls(current.data.session.message.list(current.rootID));
    if (beamScope !== scope || beamPrevious === undefined) {
      beamScope = scope;
      beamPrevious = hydrated.calls;
    }
    const created = detectBeams(hydrated.calls, beamPrevious, next);
    beamPrevious = next;
    if (created.length > 0) addBeams(created);
  });

  const fleet = createMemo<FleetView | undefined>(() => {
    const current = family();
    if (current === undefined) return undefined;
    const data = current.data;
    const scope = scopeKey(current);
    const snapshot = (info: SessionInfo): SessionSnapshot => ({
      info,
      running: data.session.status(info.id) === "running",
      messages: data.session.message.list(info.id),
      permissions: data.session.permission.list(info.id).length,
      forms: data.session.form.list(info.id, info.location)?.length ?? 0,
      lines: lines().get(`${scope}\n${info.id}`),
    });
    const costOnly = (info: SessionInfo): SessionSnapshot => ({
      info,
      running: false,
      messages: [],
      permissions: 0,
      forms: 0,
      lines: undefined,
    });
    return buildFleet({
      root: snapshot(current.root),
      children: current.children.map(snapshot),
      descendants: current.descendants.map(costOnly),
      currentID: current.routedID,
      agentName: (info) => agentNameFor(data, info),
      modelLabel: (location, ref) =>
        ref === undefined
          ? undefined
          : {
              providerID: ref.providerID,
              modelID: ref.id,
              name: modelFor(data, location, ref)?.name ?? ref.id,
            },
      contextLimit: (location, ref) =>
        ref === undefined ? undefined : modelFor(data, location, ref)?.limit.context,
      price: (tokens, ref) => priceFor(prices(), tokens, ref),
      familyCost: data.session.cost(current.rootID),
    });
  });

  const lanes = createMemo<LanesView | undefined>(() => {
    const current = family();
    const view = fleet();
    if (current === undefined || view === undefined) return undefined;
    const data = current.data;
    const statuses = new Map<string, AgentStatus>();
    for (const agent of [view.root, ...view.active, ...view.inactive]) {
      statuses.set(agent.sessionID, agent.status);
    }
    const laneSession = (info: SessionInfo): LaneSession => ({
      info,
      running: data.session.status(info.id) === "running",
      waiting: statuses.get(info.id) === "waiting",
      messages: data.session.message.list(info.id),
    });
    return deriveLanes({
      root: laneSession(current.root),
      children: current.children.map(laneSession),
      agentName: (info) => agentNameFor(data, info),
      title: (info) => sessionTitle(info.title),
    });
  });

  function setLine(key: string, value: LineStats | undefined): void {
    setLines((current) => {
      if (current.get(key) === value) return current;
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  }

  createEffect(() => {
    const current = family();
    if (current === undefined) return;
    const scope = scopeKey(current);
    for (const info of [current.root, ...current.children]) {
      const key = `${scope}\n${info.id}`;
      const snapshotKey = latestSnapshotKey(current.data.session.message.list(info.id));
      if (snapshotKey === undefined) {
        const hadKey = lineKeys.delete(key);
        lineRequests.delete(key);
        if (hadKey) setLine(key, undefined);
        continue;
      }
      if (lineKeys.get(key) === snapshotKey) continue;
      lineKeys.set(key, snapshotKey);
      lineRequestSequence += 1;
      const request = lineRequestSequence;
      lineRequests.set(key, request);
      const startedAt = activation;
      void current.session.server.client.session.diff({ sessionID: info.id }).then(
        (files) => {
          if (activation !== startedAt || lineRequests.get(key) !== request) return;
          lineRequests.delete(key);
          setLine(key, sumLines(files));
        },
        () => {
          if (activation !== startedAt || lineRequests.get(key) !== request) return;
          lineRequests.delete(key);
          setLine(key, undefined);
        },
      );
    }
  });

  createEffect(() => {
    if (pricesStarted) return;
    const current = family();
    if (current === undefined) return;
    const needsEstimate = [current.root, ...current.descendants].some((info) => {
      const tokens = tokenTotal(info.tokens);
      return info.cost === 0 && Number.isFinite(tokens) && tokens > 0;
    });
    if (!needsEstimate) return;
    pricesStarted = true;
    host.fetchPrices().then(
      (table) => setPrices(table),
      () => undefined,
    );
  });

  const hasActiveMember = createMemo(() => {
    const view = fleet();
    return (
      view !== undefined &&
      (view.active.length > 0 || view.root.status === "running" || view.root.status === "waiting")
    );
  });

  createEffect(() => {
    if (!hasActiveMember()) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    onCleanup(() => clearInterval(interval));
  });

  function canOpenIn(currentFamily: Family, sessionID: string): boolean {
    const member =
      sessionID === currentFamily.rootID ||
      currentFamily.children.some((info) => info.id === sessionID);
    return member && !currentFamily.data.session.missing(sessionID);
  }

  function canOpen(sessionID: string): boolean {
    const currentFamily = family();
    return currentFamily !== undefined && canOpenIn(currentFamily, sessionID);
  }

  function open(sessionID: string): void {
    const currentFamily = family();
    if (currentFamily === undefined || !canOpenIn(currentFamily, sessionID)) return;
    host.openTab(currentFamily.serverID, sessionID);
  }

  return { fleet, lanes, beams, now, canOpen, open };
}
