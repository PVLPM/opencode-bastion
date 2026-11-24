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

import { delegations, detectBeams, type BeamSnapshot } from "../model/delegations";
import { buildFleet, type SessionSnapshot } from "../model/fleet";
import { resolveCost, type PriceTable } from "../model/pricing";
import type { Beam, FleetView, LineStats, Money } from "../model/types";
import { tokenTotal } from "../model/usage";

export interface FleetData {
  readonly session: Pick<
    Data["session"],
    "get" | "list" | "missing" | "root" | "status" | "cost" | "sync"
  > & {
    readonly message: Pick<Data["session"]["message"], "list" | "sync">;
    readonly permission: Pick<Data["session"]["permission"], "list" | "sync">;
    readonly form: Pick<Data["session"]["form"], "list" | "sync">;
  };
  readonly location: {
    readonly agent: Pick<Data["location"]["agent"], "list" | "sync">;
    readonly model: Pick<Data["location"]["model"], "list" | "sync">;
  };
}

export interface FleetServer {
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
  readonly beams: Accessor<readonly Beam[]>;
  readonly now: Accessor<number>;
  canOpen(sessionID: string): boolean;
  open(sessionID: string): void;
}

interface Family {
  readonly currentID: string;
  readonly server: FleetServer;
  readonly rootID: string;
  readonly root: SessionInfo;
  readonly children: SessionInfo[];
}

function directChildren(data: FleetData, rootID: string): SessionInfo[] {
  return data.session.list().filter((info) => info.parentID === rootID);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modelFor(data: FleetData, location: LocationRef, ref: ModelRef): ModelInfo | undefined {
  return data.location.model
    .list(location)
    ?.find((model) => model.providerID === ref.providerID && model.modelID === ref.id);
}

function agentNameFor(data: FleetData, location: LocationRef, sessionID: string): string {
  const info = data.session.missing(sessionID) ? undefined : data.session.get(sessionID);
  const ref = info?.location ?? location;
  const agentID = info?.agent ?? "unknown";
  const agent = data.location.agent.list(ref)?.find((entry) => entry.id === agentID);
  return agent?.name ?? capitalize(agentID);
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
  const [snapshotEpoch, setSnapshotEpoch] = createSignal(0);

  const family = createMemo<Family | undefined>(() => {
    const session = routed();
    if (session === undefined) return undefined;
    const data = session.server.data;
    const rootID = data.session.root(session.id);
    if (data.session.missing(rootID)) return undefined;
    return {
      currentID: session.id,
      server: session.server,
      rootID,
      root: data.session.get(rootID),
      children: directChildren(data, rootID),
    };
  });

  const synced = new Set<string>();
  let lastConnectionKey: string | undefined;

  function syncOnce(key: string, run: () => Promise<void>): void {
    if (synced.has(key)) return;
    synced.add(key);
    run().catch(() => undefined);
  }

  createEffect(() => {
    const session = routed();
    const connected = session?.server.connected === true;
    const serverID = session?.server.id ?? "";
    const connectionKey = `${serverID}\n${connected ? "on" : "off"}`;
    if (connectionKey !== lastConnectionKey) {
      lastConnectionKey = connectionKey;
      if (connected) synced.clear();
    }
    if (session === undefined || !connected) return;

    const data = session.server.data;
    syncOnce(`session\n${serverID}\n${session.id}`, () => data.session.sync(session.id));

    const rootID = data.session.root(session.id);
    syncOnce(`root\n${serverID}\n${rootID}`, () => data.session.sync(rootID, { children: true }));
    if (data.session.missing(rootID)) return;

    const root = data.session.get(rootID);
    const location = root.location;
    syncOnce(`agents\n${serverID}\n${location.directory}`, () =>
      data.location.agent.sync(location),
    );
    syncOnce(`models\n${serverID}\n${location.directory}`, () =>
      data.location.model.sync(location),
    );

    for (const info of [root, ...directChildren(data, rootID)]) {
      syncOnce(`messages\n${serverID}\n${info.id}`, () => data.session.message.sync(info.id));
      syncOnce(`permissions\n${serverID}\n${info.id}`, () => data.session.permission.sync(info.id));
      syncOnce(`forms\n${serverID}\n${info.id}`, () =>
        data.session.form.sync(info.id, info.location),
      );
    }
  });

  let lastAnchorKey: string | undefined;
  let lastBeamConnectionKey: string | undefined;

  createEffect(() => {
    const session = routed();
    const serverID = session?.server.id ?? "";
    const rootID = session === undefined ? undefined : session.server.data.session.root(session.id);
    const anchorKey = session === undefined ? undefined : `${serverID}\n${rootID}\n${session.id}`;
    const connectionKey =
      session === undefined ? undefined : `${serverID}\n${session.server.connected ? "on" : "off"}`;
    if (anchorKey === lastAnchorKey && connectionKey === lastBeamConnectionKey) return;
    lastAnchorKey = anchorKey;
    lastBeamConnectionKey = connectionKey;
    setSnapshotEpoch((epoch) => epoch + 1);
  });

  const beamSnapshot = createMemo<BeamSnapshot | undefined>(() => {
    const currentFamily = family();
    if (currentFamily === undefined) return undefined;
    const data = currentFamily.server.data;
    const tasks = delegations(data.session.message.list(currentFamily.rootID));
    const toolIDs = new Set<string>();
    const delegationTargets = new Map<string, string>();
    for (const [childID, task] of tasks) {
      toolIDs.add(task.toolID);
      delegationTargets.set(task.toolID, childID);
    }
    const running = new Set<string>();
    for (const child of currentFamily.children) {
      if (data.session.status(child.id) === "running") running.add(child.id);
    }
    return { toolIDs, running, delegationTargets };
  });

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

  let previousSnapshot: BeamSnapshot | undefined;
  let skipSnapshot = true;
  let seenEpoch = 0;

  createEffect(() => {
    const epoch = snapshotEpoch();
    if (epoch !== seenEpoch) {
      seenEpoch = epoch;
      previousSnapshot = undefined;
      skipSnapshot = true;
      clearBeams();
    }
    const next = beamSnapshot();
    if (next === undefined) {
      previousSnapshot = undefined;
      return;
    }
    if (previousSnapshot === undefined || skipSnapshot) {
      previousSnapshot = next;
      skipSnapshot = false;
      return;
    }
    const created = detectBeams(previousSnapshot, next);
    previousSnapshot = next;
    if (created.length > 0) addBeams(created);
  });

  const fleet = createMemo<FleetView | undefined>(() => {
    const currentFamily = family();
    if (currentFamily === undefined) return undefined;
    const data = currentFamily.server.data;
    const location = currentFamily.root.location;
    const snapshot = (info: SessionInfo): SessionSnapshot => ({
      info,
      running: data.session.status(info.id) === "running",
      messages: data.session.message.list(info.id),
      permissions: data.session.permission.list(info.id).length,
      forms: data.session.form.list(info.id, info.location)?.length ?? 0,
      lines: lines().get(`${currentFamily.server.id}\n${info.id}`),
    });
    return buildFleet({
      root: snapshot(currentFamily.root),
      children: currentFamily.children.map(snapshot),
      currentID: currentFamily.currentID,
      agentName: (sessionID) => agentNameFor(data, location, sessionID),
      modelLabel: (ref) =>
        ref === undefined
          ? undefined
          : {
              providerID: ref.providerID,
              modelID: ref.id,
              name: modelFor(data, location, ref)?.name ?? ref.id,
            },
      contextLimit: (ref) =>
        ref === undefined ? undefined : modelFor(data, location, ref)?.limit.context,
      price: (tokens, ref) => priceFor(prices(), tokens, ref),
      familyCost: data.session.cost(currentFamily.rootID),
    });
  });

  const lineKeys = new Map<string, number>();
  const lineRequests = new Map<string, number>();
  let lineRequestSequence = 0;

  function setLine(key: string, value: LineStats | undefined): void {
    setLines((current) => {
      if (current.get(key) === value) return current;
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  }

  createEffect(() => {
    const currentFamily = family();
    if (currentFamily === undefined) return;
    const server = currentFamily.server;
    for (const info of [currentFamily.root, ...currentFamily.children]) {
      const sessionKey = `${server.id}\n${info.id}`;
      const key = latestSnapshotKey(server.data.session.message.list(info.id));
      if (key === undefined) {
        const hadKey = lineKeys.delete(sessionKey);
        lineRequests.delete(sessionKey);
        if (hadKey) setLine(sessionKey, undefined);
        continue;
      }
      if (lineKeys.get(sessionKey) === key) continue;
      lineKeys.set(sessionKey, key);
      lineRequestSequence += 1;
      const request = lineRequestSequence;
      lineRequests.set(sessionKey, request);
      void server.client.session.diff({ sessionID: info.id }).then(
        (files) => {
          if (lineRequests.get(sessionKey) !== request) return;
          lineRequests.delete(sessionKey);
          setLine(sessionKey, sumLines(files));
        },
        () => {
          if (lineRequests.get(sessionKey) !== request) return;
          lineRequests.delete(sessionKey);
          setLine(sessionKey, undefined);
        },
      );
    }
  });

  let pricesStarted = false;

  createEffect(() => {
    if (pricesStarted) return;
    const currentFamily = family();
    if (currentFamily === undefined) return;
    const members = [currentFamily.root, ...currentFamily.children];
    if (!members.some((info) => info.cost === 0 && tokenTotal(info.tokens) > 0)) return;
    pricesStarted = true;
    host.fetchPrices().then(
      (table) => {
        setPrices(table);
      },
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
    return member && !currentFamily.server.data.session.missing(sessionID);
  }

  function canOpen(sessionID: string): boolean {
    const currentFamily = family();
    return currentFamily !== undefined && canOpenIn(currentFamily, sessionID);
  }

  function open(sessionID: string): void {
    const currentFamily = family();
    if (currentFamily === undefined || !canOpenIn(currentFamily, sessionID)) return;
    host.openTab(currentFamily.server.id, sessionID);
  }

  return { fleet, beams, now, canOpen, open };
}
