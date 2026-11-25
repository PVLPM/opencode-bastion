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
  /** Older pages behind the sync window, oldest first. */
  readonly olderMessages?: Readonly<Record<string, readonly SessionMessageInfo[]>>;
  readonly agents?: AgentInfo[];
  readonly models?: ModelInfo[];
  readonly providers?: ProviderInfo[];
  readonly agentsByLocation?: Readonly<Record<string, AgentInfo[]>>;
  readonly modelsByLocation?: Readonly<Record<string, ModelInfo[]>>;
  readonly providersByLocation?: Readonly<Record<string, ProviderInfo[]>>;
  readonly providersOnSync?: Readonly<Record<string, readonly ProviderInfo[]>>;
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
  const [messageLoading, setMessageLoading] = createSignal<Record<string, true>>({});
  const [messageMore, setMessageMore] = createSignal<Record<string, true>>({});
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
  const [providers, setProviders] = createSignal<Record<string, ProviderInfo[]>>(
    Object.fromEntries(
      Object.entries(options.providersByLocation ?? {}).map(([key, list]) => [key, [...list]]),
    ),
  );

  const failSessionSyncs = new Set(options.failSessionSyncOnce ?? []);
  const failMessageSyncs = new Set(options.failMessageSyncOnce ?? []);
  const failLoadMores = new Set<string>();
  const loadSignals = new Map<string, AbortSignal | undefined>();
  const nextSyncs = new Map<
    string,
    { messages: readonly SessionMessageInfo[]; older: readonly SessionMessageInfo[] }
  >();
  const messageHolds = new Map<string, { promise: Promise<void>; release: () => void }>();
  const loadMoreHolds = new Map<string, { promise: Promise<void>; release: () => void }>();
  const olderRemaining: Record<string, SessionMessageInfo[]> = Object.fromEntries(
    Object.entries(options.olderMessages ?? {}).map(([sessionID, list]) => [sessionID, [...list]]),
  );
  const agentsByLocation = options.agentsByLocation ?? {};
  const modelsByLocation = options.modelsByLocation ?? {};

  const sessionSyncs: { id: string; children: boolean }[] = [];
  const messageSyncs: string[] = [];
  const messageLoadMores: { id: string; all: boolean }[] = [];
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

  function setMore(sessionID: string, value: boolean): void {
    setMessageMore((current) => {
      if ((current[sessionID] === true) === value) return current;
      const next = { ...current };
      if (value) next[sessionID] = true;
      else delete next[sessionID];
      return next;
    });
  }

  function setLoading(sessionID: string, value: boolean): void {
    setMessageLoading((current) => {
      if ((current[sessionID] === true) === value) return current;
      const next = { ...current };
      if (value) next[sessionID] = true;
      else delete next[sessionID];
      return next;
    });
  }

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

  /** Mirrors the store's family index: the root's loaded descendants. */
  function family(sessionID: string): string[] {
    const rootID = rootOf(sessionID);
    return knownSessions()
      .filter((info) => info.id !== rootID && rootOf(info.id) === rootID)
      .map((info) => info.id);
  }

  const data: FleetData = {
    session: {
      get: (sessionID) => (isLoaded(sessionID) ? sessions()[sessionID] : undefined),
      missing: (sessionID) => deleted()[sessionID] === true,
      root: (sessionID) => rootOf(sessionID),
      family: (sessionID) => family(sessionID),
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
            const next = nextSyncs.get(sessionID);
            if (next !== undefined) {
              nextSyncs.delete(sessionID);
              setMessages((current) => ({ ...current, [sessionID]: [...next.messages] }));
              olderRemaining[sessionID] = [...next.older];
            } else {
              const onSync = options.messagesOnSync?.[sessionID];
              if (onSync !== undefined) {
                // A sync replaces the window and resets the older cursor.
                setMessages((current) => ({ ...current, [sessionID]: [...onSync] }));
                olderRemaining[sessionID] = [...(options.olderMessages?.[sessionID] ?? [])];
              }
            }
            setMore(sessionID, (olderRemaining[sessionID]?.length ?? 0) > 0);
            load(sessionID);
          };
          const hold = messageHolds.get(sessionID);
          if (hold !== undefined) {
            messageHolds.delete(sessionID);
            return hold.promise.then(apply);
          }
          return afterGate(options.messageGate, apply);
        },
        more: (sessionID) => messageMore()[sessionID] === true,
        loading: (sessionID) => messageLoading()[sessionID] === true,
        loadMore: (sessionID, loadOptions) => {
          messageLoadMores.push({ id: sessionID, all: loadOptions?.all === true });
          const signal = loadOptions?.signal;
          loadSignals.set(sessionID, signal);
          if (signal?.aborted) return Promise.resolve();
          if (messageMore()[sessionID] !== true) return Promise.resolve();
          if (failLoadMores.delete(sessionID)) {
            setLoading(sessionID, true);
            return Promise.reject(new Error(`Failed to load messages for ${sessionID}`)).finally(
              () => setLoading(sessionID, false),
            );
          }
          setLoading(sessionID, true);
          const apply = () => {
            if (signal?.aborted) return;
            const existing = messages()[sessionID] ?? [];
            const ids = new Set(existing.map((message) => message.id));
            const older = olderRemaining[sessionID] ?? [];
            olderRemaining[sessionID] = [];
            const fetched: SessionMessageInfo[] = [];
            // The host pages 200 at a time; only IDs already in the window are
            // filtered, so duplicates inside a page survive like the real store.
            for (let index = 0; index < older.length; index += 200) {
              fetched.push(...older.slice(index, index + 200));
            }
            loadOptions?.beforePublish?.();
            setMessages((current) => ({
              ...current,
              [sessionID]: [...fetched.filter((message) => !ids.has(message.id)), ...existing],
            }));
            setMore(sessionID, false);
          };
          const hold = loadMoreHolds.get(sessionID);
          if (hold !== undefined) loadMoreHolds.delete(sessionID);
          const ready = hold === undefined ? Promise.resolve() : hold.promise;
          return ready.then(apply).finally(() => setLoading(sessionID, false));
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
        list: (ref) => providers()[locationKey(ref)] ?? options.providers ?? [],
        sync: (ref) => {
          const key = locationKey(ref);
          providerSyncs.push(key);
          const onSync = options.providersOnSync?.[key];
          if (onSync !== undefined) {
            setProviders((current) => ({ ...current, [key]: [...onSync] }));
          }
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
    holdNextLoadMore: (sessionID: string) => {
      let release: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      loadMoreHolds.set(sessionID, { promise, release });
      return release;
    },
    setNextSync: (
      sessionID: string,
      messages: readonly SessionMessageInfo[],
      older: readonly SessionMessageInfo[],
    ) => {
      nextSyncs.set(sessionID, { messages, older });
    },
    setMessageMore: setMore,
    loadSignal: (sessionID: string) => loadSignals.get(sessionID),
    failLoadMoreOnce: (sessionID: string) => {
      failLoadMores.add(sessionID);
    },
    // Models a concurrent host sync: the window is replaced and the older
    // cursor comes back when the seeded pages still exist.
    replaceMessages: (sessionID: string, list: readonly SessionMessageInfo[]) => {
      setMessages((currentMessages) => ({ ...currentMessages, [sessionID]: [...list] }));
      olderRemaining[sessionID] = [...(options.olderMessages?.[sessionID] ?? [])];
      setMore(sessionID, (olderRemaining[sessionID]?.length ?? 0) > 0);
    },
    evictMessages: (sessionID: string) => {
      setMessages((currentMessages) => {
        const next = { ...currentMessages };
        delete next[sessionID];
        return next;
      });
      olderRemaining[sessionID] = [...(options.olderMessages?.[sessionID] ?? [])];
      setMore(sessionID, false);
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
      messageLoadMores,
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
