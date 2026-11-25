import type {
  AgentInfo,
  FileDiffInfo,
  FormInfo,
  LocationRef,
  ModelInfo,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client/promise";
import { createSignal } from "solid-js";

import type { FleetData, FleetHost, FleetSession } from "../../src/data/fleet-source";
import type { PriceTable } from "../../src/model/pricing";

interface FakeSession {
  readonly info: SessionInfo;
  readonly messages?: readonly SessionMessageInfo[];
  readonly permissions?: readonly PermissionRequest[];
  readonly forms?: readonly FormInfo[];
  readonly status?: "idle" | "running";
  /** False models a session the store knows about but has not loaded yet. */
  readonly loaded?: boolean;
  /** True models a deleted session: `missing` is true, `get` stays undefined. */
  readonly deleted?: boolean;
}

export interface FakeHostOptions {
  readonly routed?: string;
  readonly server?: string;
  readonly connected?: boolean;
  readonly visible?: boolean;
  readonly sessions?: readonly FakeSession[];
  readonly childrenOnSync?: Readonly<Record<string, readonly SessionInfo[]>>;
  readonly messagesOnSync?: Readonly<Record<string, readonly SessionMessageInfo[]>>;
  readonly agents?: AgentInfo[];
  readonly models?: ModelInfo[];
  readonly providers?: ProviderInfo[];
  readonly agentsByLocation?: Readonly<Record<string, AgentInfo[]>>;
  readonly modelsByLocation?: Readonly<Record<string, ModelInfo[]>>;
  readonly providersByLocation?: Readonly<Record<string, ProviderInfo[]>>;
  readonly diff?: (sessionID: string) => Promise<FileDiffInfo[]>;
  readonly prices?: () => Promise<PriceTable>;
  readonly sessionGate?: Promise<void>;
  readonly messageGate?: Promise<void>;
  readonly failSessionSyncOnce?: readonly string[];
  readonly failMessageSyncOnce?: readonly string[];
}

function recordFrom<Value>(
  seeds: readonly FakeSession[],
  pick: (seed: FakeSession) => readonly Value[] | undefined,
): Record<string, Value[]> {
  const entries: [string, Value[]][] = [];
  for (const seed of seeds) {
    const values = pick(seed);
    if (values !== undefined) entries.push([seed.info.id, [...values]]);
  }
  return Object.fromEntries(entries);
}

function afterGate(gate: Promise<void> | undefined, apply: () => void): Promise<void> {
  if (gate === undefined) {
    apply();
    return Promise.resolve();
  }
  return gate.then(apply);
}

function locationKey(ref: LocationRef | undefined): string {
  if (ref === undefined) return "";
  return ref.workspaceID === undefined ? ref.directory : `${ref.workspaceID}\n${ref.directory}`;
}

export function createFakeHost(options: FakeHostOptions = {}) {
  const seeds = options.sessions ?? [];
  const seedMessages = recordFrom(seeds, (seed) => seed.messages);
  const [connected, setConnectedSignal] = createSignal(options.connected ?? true);
  const [visible, setVisibleSignal] = createSignal(options.visible ?? true);
  const [routedID, setRoutedID] = createSignal<string | undefined>(options.routed);
  const [serverID] = createSignal(options.server ?? "server");
  const [sessions, setSessions] = createSignal<Record<string, SessionInfo>>(
    Object.fromEntries(seeds.map((seed) => [seed.info.id, seed.info])),
  );
  const [loaded, setLoaded] = createSignal<Record<string, true>>(
    Object.fromEntries(
      seeds
        .filter((seed) => seed.loaded !== false && seed.deleted !== true)
        .map((seed) => [seed.info.id, true as const]),
    ),
  );
  const [deleted, setDeleted] = createSignal<Record<string, true>>(
    Object.fromEntries(
      seeds.filter((seed) => seed.deleted === true).map((seed) => [seed.info.id, true as const]),
    ),
  );
  const [messages, setMessages] = createSignal<Record<string, SessionMessageInfo[]>>(seedMessages);
  const [permissions, setPermissions] = createSignal<Record<string, PermissionRequest[]>>(
    recordFrom(seeds, (seed) => seed.permissions),
  );
  const [forms, setForms] = createSignal<Record<string, FormInfo[]>>(
    recordFrom(seeds, (seed) => seed.forms),
  );
  const [statuses, setStatuses] = createSignal<Record<string, "idle" | "running">>(
    Object.fromEntries(
      seeds.flatMap((seed) => (seed.status === undefined ? [] : [[seed.info.id, seed.status]])),
    ),
  );
  const [agents, setAgentsSignal] = createSignal<AgentInfo[]>(options.agents ?? []);
  const [models, setModelsSignal] = createSignal<ModelInfo[]>(options.models ?? []);

  const failSessionSyncs = new Set(options.failSessionSyncOnce ?? []);
  const failMessageSyncs = new Set(options.failMessageSyncOnce ?? []);
  const messageHolds = new Map<string, { promise: Promise<void>; release: () => void }>();
  const agentsByLocation = options.agentsByLocation ?? {};
  const modelsByLocation = options.modelsByLocation ?? {};
  const providersByLocation = options.providersByLocation ?? {};

  const sessionSyncs: { id: string; children: boolean }[] = [];
  const messageSyncs: string[] = [];
  const permissionSyncs: string[] = [];
  const formSyncs: string[] = [];
  const agentSyncs: string[] = [];
  const modelSyncs: string[] = [];
  const providerSyncs: string[] = [];
  const diffCalls: string[] = [];
  const openTabs: { server: string; id: string }[] = [];
  let priceFetches = 0;

  const isLoaded = (sessionID: string): boolean =>
    loaded()[sessionID] === true && deleted()[sessionID] !== true;

  function load(sessionID: string): void {
    if (deleted()[sessionID] === true) return;
    setLoaded((current) =>
      current[sessionID] === true ? current : { ...current, [sessionID]: true },
    );
  }

  function remember(info: SessionInfo): void {
    setSessions((current) => ({ ...current, [info.id]: info }));
  }

  function rootOf(sessionID: string): string {
    let current = sessionID;
    const seen = new Set<string>([sessionID]);
    let parentID = isLoaded(sessionID) ? sessions()[sessionID]?.parentID : undefined;
    while (parentID !== undefined && !seen.has(parentID)) {
      current = parentID;
      seen.add(parentID);
      parentID = isLoaded(parentID) ? sessions()[parentID]?.parentID : undefined;
    }
    return current;
  }

  function knownSessions(): SessionInfo[] {
    return Object.values(sessions()).filter((info) => isLoaded(info.id));
  }

  function familyCost(sessionID: string): number {
    const rootID = rootOf(sessionID);
    let total = 0;
    for (const info of knownSessions()) {
      if (rootOf(info.id) === rootID) total += info.cost;
    }
    return total;
  }

  const data: FleetData = {
    session: {
      list: () => knownSessions(),
      get: (sessionID) => (isLoaded(sessionID) ? sessions()[sessionID] : undefined),
      missing: (sessionID) => deleted()[sessionID] === true,
      root: (sessionID) => rootOf(sessionID),
      status: (sessionID) => statuses()[sessionID] ?? "idle",
      cost: (sessionID) => familyCost(sessionID),
      sync: (sessionID, syncOptions) => {
        sessionSyncs.push({ id: sessionID, children: syncOptions?.children === true });
        if (failSessionSyncs.delete(sessionID)) {
          return Promise.reject(new Error(`Failed to sync ${sessionID}`));
        }
        return afterGate(options.sessionGate, () => {
          if (syncOptions?.children === true) {
            for (const info of options.childrenOnSync?.[sessionID] ?? []) {
              remember(info);
              load(info.id);
            }
          }
          load(sessionID);
        });
      },
      message: {
        list: (sessionID) => (isLoaded(sessionID) ? (messages()[sessionID] ?? []) : []),
        sync: (sessionID) => {
          messageSyncs.push(sessionID);
          if (failMessageSyncs.delete(sessionID)) {
            return Promise.reject(new Error(`Failed to sync messages for ${sessionID}`));
          }
          const apply = () => {
            const onSync = options.messagesOnSync?.[sessionID];
            if (onSync !== undefined) {
              setMessages((current) => ({ ...current, [sessionID]: [...onSync] }));
            }
            load(sessionID);
          };
          const hold = messageHolds.get(sessionID);
          if (hold !== undefined) {
            messageHolds.delete(sessionID);
            return hold.promise.then(apply);
          }
          return afterGate(options.messageGate, apply);
        },
      },
      permission: {
        // Mirrors the real store: undefined until the session's permissions are synced.
        list: (sessionID) => permissions()[sessionID],
        sync: (sessionID) => {
          permissionSyncs.push(sessionID);
          return Promise.resolve();
        },
      },
      form: {
        list: (sessionID) => (isLoaded(sessionID) ? forms()[sessionID] : undefined),
        sync: (sessionID) => {
          formSyncs.push(sessionID);
          return Promise.resolve();
        },
      },
    },
    location: {
      agent: {
        list: (ref) => agentsByLocation[locationKey(ref)] ?? agents(),
        sync: (ref) => {
          agentSyncs.push(locationKey(ref));
          return Promise.resolve();
        },
      },
      model: {
        list: (ref) => modelsByLocation[locationKey(ref)] ?? models(),
        sync: (ref) => {
          modelSyncs.push(locationKey(ref));
          return Promise.resolve();
        },
      },
      provider: {
        list: (ref) => providersByLocation[locationKey(ref)] ?? options.providers ?? [],
        sync: (ref) => {
          providerSyncs.push(locationKey(ref));
          return Promise.resolve();
        },
      },
    },
  };

  const client: FleetSession["server"]["client"] = {
    session: {
      diff: (input) => {
        diffCalls.push(input.sessionID);
        return options.diff?.(input.sessionID) ?? Promise.resolve([]);
      },
    },
  };

  function current(): FleetSession | undefined {
    const id = routedID();
    if (id === undefined) return undefined;
    return {
      id,
      server: {
        id: serverID(),
        get connected() {
          return connected();
        },
        data,
        client,
      },
    };
  }

  const host: FleetHost = {
    current,
    visible,
    openTab: (server, id) => {
      openTabs.push({ server, id });
    },
    fetchPrices: () => {
      priceFetches += 1;
      return options.prices?.() ?? Promise.resolve({});
    },
  };

  return {
    host,
    data,
    setRouted: (sessionID: string | undefined) => setRoutedID(sessionID),
    setConnected: (value: boolean) => setConnectedSignal(value),
    setVisible: (value: boolean) => setVisibleSignal(value),
    holdNextMessageSync: (sessionID: string) => {
      let release: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      messageHolds.set(sessionID, { promise, release });
      return release;
    },
    addSession: (info: SessionInfo) => {
      remember(info);
      load(info.id);
    },
    unload: (sessionID: string) =>
      setLoaded((currentLoaded) => {
        const next = { ...currentLoaded };
        delete next[sessionID];
        return next;
      }),
    deleteSession: (sessionID: string) => {
      setDeleted((currentDeleted) => ({ ...currentDeleted, [sessionID]: true }));
      setLoaded((currentLoaded) => {
        const next = { ...currentLoaded };
        delete next[sessionID];
        return next;
      });
    },
    addMessage: (sessionID: string, message: SessionMessageInfo) =>
      setMessages((currentMessages) => ({
        ...currentMessages,
        [sessionID]: [...(currentMessages[sessionID] ?? []), message],
      })),
    addMessages: (sessionID: string, list: readonly SessionMessageInfo[]) =>
      setMessages((currentMessages) => ({ ...currentMessages, [sessionID]: [...list] })),
    setStatus: (sessionID: string, status: "idle" | "running") =>
      setStatuses((currentStatuses) => ({ ...currentStatuses, [sessionID]: status })),
    setPermissions: (sessionID: string, list: readonly PermissionRequest[]) =>
      setPermissions((currentPermissions) => ({ ...currentPermissions, [sessionID]: [...list] })),
    setForms: (sessionID: string, list: readonly FormInfo[]) =>
      setForms((currentForms) => ({ ...currentForms, [sessionID]: [...list] })),
    setAgents: (list: readonly AgentInfo[]) => setAgentsSignal([...list]),
    setModels: (list: readonly ModelInfo[]) => setModelsSignal([...list]),
    calls: {
      sessionSyncs,
      messageSyncs,
      permissionSyncs,
      formSyncs,
      agentSyncs,
      modelSyncs,
      providerSyncs,
      diffCalls,
      openTabs,
      priceFetches: () => priceFetches,
    },
  };
}
