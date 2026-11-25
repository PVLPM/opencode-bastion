import type {
  FileDiffInfo,
  LocationRef,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  SessionInfo,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise";
import type { Data } from "@opencode/client/solid";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import { detectBeams, subagentCalls, type SubagentCall } from "../model/delegations";
import { buildFleet, sessionTitle, type SessionSnapshot } from "../model/fleet";
import { deriveLanes, type LaneSession } from "../model/lanes";
import { resolveTariff, usageCost, usageRecords, type PriceTable } from "../model/pricing";
import type { AgentStatus, Beam, FleetView, LanesView, LineStats } from "../model/types";
import { tokenTotal } from "../model/usage";

export interface FleetData {
  readonly session: Omit<
    Pick<Data["session"], "get" | "missing" | "family" | "root" | "status" | "cost" | "sync">,
    "get"
  > & {
    /** The host store returns undefined for a session it has not loaded yet. */
    get(sessionID: string): SessionInfo | undefined;
    readonly message: Pick<
      Data["session"]["message"],
      "list" | "sync" | "more" | "loading" | "loadMore"
    >;
    readonly permission: Pick<Data["session"]["permission"], "sync"> & {
      /**
       * Typed as an array by the SDK, but the store returns `store.session.permission[id]`,
       * which stays undefined until that session's permissions are synced.
       */
      list(sessionID: string): PermissionRequest[] | undefined;
    };
    readonly form: Pick<Data["session"]["form"], "list" | "sync">;
  };
  readonly location: {
    readonly agent: Pick<Data["location"]["agent"], "list" | "sync">;
    readonly model: Pick<Data["location"]["model"], "list" | "sync">;
    readonly provider: Pick<Data["location"]["provider"], "list" | "sync">;
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
  /** The panel is on screen; the clock only runs while someone can see it. */
  visible(): boolean;
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
  readonly familyComplete: boolean;
}

interface Backfill {
  readonly sessionID: string;
  readonly scope: string;
  readonly anchors: ReadonlySet<string>;
  readonly controller: AbortController;
}

interface Hydration {
  readonly scope: string;
  readonly calls: ReadonlyMap<string, SubagentCall>;
}

function scopeKey(anchor: Anchor): string {
  return `${anchor.serverID}\n${anchor.connected ? "on" : "off"}\n${anchor.rootID}`;
}

function messageSyncKey(scope: string, sessionID: string): string {
  return `${scope}\nmessages\n${sessionID}`;
}

/** Family readiness survives a connection change; only the root/server move it. */
function familyKey(anchor: Anchor): string {
  return `${anchor.serverID}\n${anchor.rootID}`;
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

/**
 * The store's family index is the single list both the fleet and the cost
 * estimate use, so a base total and an estimate cannot cover different members.
 */
function familyInfos(data: FleetData, rootID: string) {
  const ids = [...new Set([rootID, ...data.session.family(rootID)])];
  const infos: SessionInfo[] = [];
  for (const id of ids) {
    if (data.session.missing(id)) continue;
    const info = data.session.get(id);
    if (info !== undefined) infos.push(info);
  }
  return { ids, infos };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modelFor(data: FleetData, location: LocationRef, ref: ModelRef): ModelInfo | undefined {
  // ModelRef.id is the host route key (`ModelInfo.id`), not the provider's
  // API model id (`ModelInfo.modelID`).
  return data.location.model
    .list(location)
    ?.find((model) => model.providerID === ref.providerID && model.id === ref.id);
}

function providerNameFor(data: FleetData, location: LocationRef, providerID: string): string {
  return (
    data.location.provider.list(location)?.find((provider) => provider.id === providerID)?.name ??
    providerID
  );
}

function agentNameFor(data: FleetData, info: SessionInfo): string {
  const agent = data.location.agent.list(info.location)?.find((entry) => entry.id === info.agent);
  return capitalize(agent?.name ?? info.agent ?? "unknown");
}

interface LineRefresh {
  readonly at: number;
  /** False when the completed message explicitly reports no changed files. */
  readonly request: boolean;
}

function latestLineRefresh(messages: readonly SessionMessageInfo[]): LineRefresh | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant") continue;
    const completed = message.time.completed;
    if (completed === undefined) continue;
    if (!Number.isFinite(completed)) return undefined;
    return {
      at: completed,
      request: message.snapshot?.files?.length !== 0,
    };
  }
  return undefined;
}

function sumLines(files: readonly FileDiffInfo[]): LineStats {
  const real = new Map<string, FileDiffInfo>();
  let truncated = false;
  for (const file of files) {
    if (file.more === true) {
      truncated = true;
      continue;
    }
    // A repeated path is one file; the sentinel above is not a file at all.
    if (real.has(file.file)) continue;
    real.set(file.file, file);
  }
  let added = 0;
  let removed = 0;
  for (const file of real.values()) {
    added += file.additions;
    removed += file.deletions;
  }
  return { added, removed, files: real.size, truncated };
}

function priceUsage(
  data: FleetData,
  table: PriceTable | undefined,
  info: SessionInfo,
  ref: ModelRef | undefined,
  tokens: TokenUsageInfo,
  aggregated: boolean,
): number | undefined {
  if (ref === undefined) return undefined;
  const tariff = resolveTariff({ table, ref, native: modelFor(data, info.location, ref) });
  return tariff === undefined ? undefined : usageCost(tariff, tokens, aggregated);
}

export function createFleetSource(host: FleetHost): FleetSource {
  const routed = createMemo(() => host.current());
  const [now, setNow] = createSignal(Date.now());
  const [prices, setPrices] = createSignal<PriceTable | undefined>(undefined);
  const [beams, setBeams] = createSignal<readonly Beam[]>([]);
  const [lines, setLines] = createSignal<ReadonlyMap<string, LineStats | undefined>>(new Map());
  const [hydration, setHydration] = createSignal<Hydration | undefined>(undefined);
  const [familyReady, setFamilyReady] = createSignal<string | undefined>(undefined);
  const [historyRevision, setHistoryRevision] = createSignal(0);

  const synced = new Set<string>();
  const messageSynced = new Set<string>();
  const historyFailures = new Set<string>();
  const lineKeys = new Map<string, number>();
  const lineRequests = new Map<string, number>();
  let lineRequestSequence = 0;
  let syncScope: string | undefined;
  let activation = 0;
  let beamScope: string | undefined;
  let beamPrevious: ReadonlyMap<string, SubagentCall> | undefined;
  let backfill: Backfill | undefined;
  let backfillRoot = false;
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

  function bumpHistory(): void {
    setHistoryRevision((value) => value + 1);
  }

  /** Abort the one load in flight, so a stale publication never lands. */
  function abortBackfill(sessionID?: string): void {
    if (backfill === undefined) return;
    if (sessionID !== undefined && backfill.sessionID !== sessionID) return;
    const { controller } = backfill;
    backfill = undefined;
    controller.abort();
  }

  onCleanup(() => {
    abortBackfill();
    clearBeams();
  });

  function resetScope(): void {
    activation += 1;
    abortBackfill();
    synced.clear();
    messageSynced.clear();
    historyFailures.clear();
    backfillRoot = false;
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
    const { ids, infos } = familyInfos(current.data, current.rootID);
    const children = infos.filter((info) => info.id !== root.id && info.parentID === root.id);
    const descendants = infos.filter((info) => info.id !== root.id && info.parentID !== root.id);
    return {
      ...current,
      root,
      children,
      descendants,
      // A cost total is only claimed once the family sync resolved and every
      // indexed member has info; otherwise the estimate could cover less. The
      // index is the host's known family for this root, not a full tree crawl.
      familyComplete: familyReady() === familyKey(current) && infos.length === ids.length,
    };
  });

  let trackedFamily: string | undefined;
  createEffect(() => {
    const current = anchor();
    const key = current === undefined ? undefined : familyKey(current);
    if (key === trackedFamily) return;
    trackedFamily = key;
    setFamilyReady(undefined);
  });

  let trackedRouted: { readonly scope: string; readonly id: string } | undefined;
  createEffect(() => {
    const current = anchor();
    if (current === undefined) return;
    const scope = scopeKey(current);
    const previous = trackedRouted;
    trackedRouted = { scope, id: current.routedID };
    // A route change re-syncs only the newly routed member; the rest of the
    // family keeps its loaded history.
    if (previous === undefined || previous.scope !== scope || previous.id === current.routedID) {
      return;
    }
    abortBackfill(current.routedID);
    historyFailures.delete(current.routedID);
    synced.delete(messageSyncKey(scope, current.routedID));
    messageSynced.delete(messageSyncKey(scope, current.routedID));
    bumpHistory();
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
    syncOnce(
      `${scope}\nroot`,
      () => data.session.sync(current.rootID, { children: true }),
      () => {
        if (syncScope !== scope) return;
        setFamilyReady(familyKey(current));
      },
    );

    const root = sessionInfo(data, current.rootID);
    if (root === undefined) return;

    const { infos } = familyInfos(data, current.rootID);
    const direct = new Set([
      root.id,
      ...infos.filter((info) => info.parentID === root.id).map((info) => info.id),
    ]);
    const locations = new Map<string, LocationRef>();
    for (const info of infos) locations.set(locationKey(info.location), info.location);
    for (const [key, location] of locations) {
      syncOnce(`${scope}\nagents\n${key}`, () => data.location.agent.sync(location));
      syncOnce(`${scope}\nmodels\n${key}`, () => data.location.model.sync(location));
      syncOnce(`${scope}\nproviders\n${key}`, () => data.location.provider.sync(location));
    }

    for (const info of infos) {
      syncOnce(
        messageSyncKey(scope, info.id),
        () => data.session.message.sync(info.id),
        () => {
          if (syncScope !== scope) return;
          messageSynced.add(messageSyncKey(scope, info.id));
          historyFailures.delete(info.id);
          bumpHistory();
          if (info.id === root.id) {
            setHydration({
              scope,
              calls: subagentCalls(data.session.message.list(info.id)),
            });
          }
        },
      );
      // Permissions and forms only drive the live root and direct-child cards.
      if (!direct.has(info.id)) continue;
      syncOnce(`${scope}\npermissions\n${info.id}`, () => data.session.permission.sync(info.id));
      syncOnce(`${scope}\nforms\n${info.id}`, () => data.session.form.sync(info.id, info.location));
    }
  });

  createEffect(() => {
    const current = anchor();
    if (current === undefined) return;
    const scope = scopeKey(current);
    const hydrated = hydration();
    // A settle with no new rows still has to consume a pending rebaseline.
    historyRevision();
    if (hydrated === undefined || hydrated.scope !== scope) return;
    const next = subagentCalls(current.data.session.message.list(current.rootID));
    if (beamScope !== scope || beamPrevious === undefined) {
      beamScope = scope;
      beamPrevious = hydrated.calls;
    }
    if (backfillRoot) {
      backfillRoot = false;
      beamPrevious = next;
      const calls = new Map(hydrated.calls);
      for (const [toolID, call] of next) {
        if (!calls.has(toolID)) calls.set(toolID, call);
      }
      setHydration({ scope, calls });
      return;
    }
    const created = detectBeams(hydrated.calls, beamPrevious, next);
    beamPrevious = next;
    if (created.length > 0) addBeams(created);
  });

  createEffect(() => {
    const current = family();
    if (current === undefined || !current.connected) return;
    const scope = scopeKey(current);
    // Every settled page asks for the next member; one load runs at a time.
    historyRevision();
    const members = [current.root, ...current.children, ...current.descendants];
    const active = backfill;
    if (active !== undefined) {
      // A deleted member must free the single-flight slot for the rest.
      if (members.some((info) => info.id === active.sessionID)) return;
      abortBackfill();
      bumpHistory();
      return;
    }
    const data = current.data;
    for (const info of members) {
      if (!messageSynced.has(messageSyncKey(scope, info.id))) continue;
      if (historyFailures.has(info.id)) continue;
      if (data.session.message.loading(info.id)) continue;
      if (!data.session.message.more(info.id)) continue;
      const anchors = new Set(data.session.message.list(info.id).map((message) => message.id));
      const controller = new AbortController();
      const load: Backfill = { sessionID: info.id, scope, anchors, controller };
      const startedAt = activation;
      backfill = load;
      const options =
        info.id === current.rootID
          ? {
              all: true,
              signal: controller.signal,
              beforePublish: () => {
                backfillRoot = true;
              },
            }
          : { all: true, signal: controller.signal };
      data.session.message.loadMore(info.id, options).then(
        () => {
          if (backfill !== load) return;
          backfill = undefined;
          if (activation !== startedAt || syncScope !== scope) return;
          // A concurrent host sync can replace the window; losing an anchor
          // means this session's history is no longer trustworthy.
          const present = new Set(data.session.message.list(info.id).map((message) => message.id));
          for (const anchor of load.anchors) {
            if (present.has(anchor)) continue;
            historyFailures.add(info.id);
            break;
          }
          bumpHistory();
        },
        () => {
          if (backfill !== load) return;
          backfill = undefined;
          if (activation !== startedAt || syncScope !== scope) return;
          historyFailures.add(info.id);
          bumpHistory();
        },
      );
      return;
    }
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
      permissions: data.session.permission.list(info.id)?.length ?? 0,
      forms: data.session.form.list(info.id, info.location)?.length ?? 0,
      lines: lines().get(`${scope}\n${info.id}`),
    });
    // A descendant feeds cost and usage only; it is never a live card, but its
    // loaded messages are what carry its unpriced usage records.
    const costSnapshot = (info: SessionInfo): SessionSnapshot => ({
      info,
      running: false,
      messages: data.session.message.list(info.id),
      permissions: 0,
      forms: 0,
      lines: undefined,
    });
    return buildFleet({
      root: snapshot(current.root),
      children: current.children.map(snapshot),
      descendants: current.descendants.map(costSnapshot),
      currentID: current.routedID,
      agentName: (info) => agentNameFor(data, info),
      modelLabel: (location, ref) =>
        ref === undefined
          ? undefined
          : {
              providerID: ref.providerID,
              modelID: ref.id,
              providerName: providerNameFor(data, location, ref.providerID),
              name: modelFor(data, location, ref)?.name ?? ref.id,
            },
      contextLimit: (location, ref) =>
        ref === undefined ? undefined : modelFor(data, location, ref)?.limit.context,
      price: (info, ref, tokens, aggregated) =>
        priceUsage(data, prices(), info, ref, tokens, aggregated),
      familyCost: data.session.cost(current.rootID),
      familyComplete: current.familyComplete,
      connected: current.connected,
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
    const laneSession = (info: SessionInfo): LaneSession => {
      // The lane follows the card statuses, which a disconnect demotes to
      // Unknown; the raw store status cannot outrank that.
      const status = statuses.get(info.id);
      return {
        info,
        running: status === "running" || status === "waiting",
        waiting: status === "waiting",
        messages: data.session.message.list(info.id),
      };
    };
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
      const refresh = latestLineRefresh(current.data.session.message.list(info.id));
      if (refresh === undefined) {
        const hadKey = lineKeys.delete(key);
        lineRequests.delete(key);
        if (hadKey) setLine(key, undefined);
        continue;
      }
      // An explicit empty file list describes this turn, not the session's
      // cumulative diff. Once stats are known, keep them. Before they are known,
      // the cumulative diff is the only source for earlier changes, so ask once.
      if (!refresh.request && lines().get(key) !== undefined) continue;
      if (lineKeys.get(key) === refresh.at) continue;
      lineKeys.set(key, refresh.at);
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
    const needsEstimate = [current.root, ...current.children, ...current.descendants].some(
      (info) => {
        const tokens = tokenTotal(info.tokens);
        if (info.cost === 0 && Number.isFinite(tokens) && tokens > 0) return true;
        // A mixed session reports a base cost but still contains unpriced records.
        return usageRecords(current.data.session.message.list(info.id)).some((record) => {
          const total = tokenTotal(record.tokens);
          return (record.cost ?? 0) === 0 && Number.isFinite(total) && total > 0;
        });
      },
    );
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
    if (!host.visible() || !hasActiveMember()) return;
    setNow(Date.now());
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
