import type {
  AgentInfo,
  FileDiffInfo,
  FormInfo,
  ModelInfo,
  PermissionRequest,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode/client/promise";
import { createSignal } from "solid-js";

import type { FleetData, FleetHost, FleetSession } from "../../src/data/fleet-source";
import type { PriceTable } from "../../src/model/pricing";

export interface FakeSession {
  readonly info: SessionInfo;
  readonly messages?: readonly SessionMessageInfo[];
  readonly permissions?: readonly PermissionRequest[];
  readonly forms?: readonly FormInfo[];
  readonly status?: "idle" | "running";
}

export interface FakeHostOptions {
  readonly routed?: string;
  readonly server?: string;
  readonly connected?: boolean;
  readonly sessions?: readonly FakeSession[];
  readonly childrenOnSync?: Readonly<Record<string, readonly SessionInfo[]>>;
  readonly agents?: AgentInfo[];
  readonly models?: ModelInfo[];
  readonly diff?: (sessionID: string) => Promise<FileDiffInfo[]>;
  readonly prices?: () => Promise<PriceTable>;
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

function rootOf(sessions: Record<string, SessionInfo>, sessionID: string): string {
  let current = sessionID;
  const seen = new Set<string>([sessionID]);
  let parentID = sessions[sessionID]?.parentID;
  while (parentID !== undefined && !seen.has(parentID)) {
    current = parentID;
    seen.add(parentID);
    parentID = sessions[parentID]?.parentID;
  }
  return current;
}

function familyCost(sessions: Record<string, SessionInfo>, sessionID: string): number {
  const rootID = rootOf(sessions, sessionID);
  let total = 0;
  for (const info of Object.values(sessions)) {
    if (rootOf(sessions, info.id) === rootID) total += info.cost;
  }
  return total;
}

export function createFakeHost(options: FakeHostOptions = {}) {
  const seeds = options.sessions ?? [];
  const [connected, setConnectedSignal] = createSignal(options.connected ?? true);
  const [routedID, setRoutedID] = createSignal<string | undefined>(options.routed);
  const [serverID] = createSignal(options.server ?? "server");
  const [sessions, setSessions] = createSignal<Record<string, SessionInfo>>(
    Object.fromEntries(seeds.map((seed) => [seed.info.id, seed.info])),
  );
  const [messages, setMessages] = createSignal<Record<string, SessionMessageInfo[]>>(
    recordFrom(seeds, (seed) => seed.messages),
  );
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

  const sessionSyncs: { id: string; children: boolean }[] = [];
  const messageSyncs: string[] = [];
  const permissionSyncs: string[] = [];
  const formSyncs: string[] = [];
  const agentSyncs: string[] = [];
  const modelSyncs: string[] = [];
  const diffCalls: string[] = [];
  const openTabs: { server: string; id: string }[] = [];
  let priceFetches = 0;

  const data: FleetData = {
    session: {
      list: () => Object.values(sessions()),
      get: (sessionID) => {
        const info = sessions()[sessionID];
        if (info === undefined) throw new Error(`Unknown session: ${sessionID}`);
        return info;
      },
      missing: (sessionID) => sessions()[sessionID] === undefined,
      root: (sessionID) => rootOf(sessions(), sessionID),
      status: (sessionID) => statuses()[sessionID] ?? "idle",
      cost: (sessionID) => familyCost(sessions(), sessionID),
      sync: (sessionID, syncOptions) => {
        sessionSyncs.push({ id: sessionID, children: syncOptions?.children === true });
        const additions = options.childrenOnSync?.[sessionID];
        if (syncOptions?.children === true && additions !== undefined) {
          setSessions((current) => ({
            ...current,
            ...Object.fromEntries(additions.map((info) => [info.id, info])),
          }));
        }
        return Promise.resolve();
      },
      message: {
        list: (sessionID) => messages()[sessionID] ?? [],
        sync: (sessionID) => {
          messageSyncs.push(sessionID);
          return Promise.resolve();
        },
      },
      permission: {
        list: (sessionID) => permissions()[sessionID] ?? [],
        sync: (sessionID) => {
          permissionSyncs.push(sessionID);
          return Promise.resolve();
        },
      },
      form: {
        list: (sessionID) => forms()[sessionID] ?? [],
        sync: (sessionID) => {
          formSyncs.push(sessionID);
          return Promise.resolve();
        },
      },
    },
    location: {
      agent: {
        list: () => agents(),
        sync: () => {
          agentSyncs.push("sync");
          return Promise.resolve();
        },
      },
      model: {
        list: () => models(),
        sync: () => {
          modelSyncs.push("sync");
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
    addSession: (info: SessionInfo) =>
      setSessions((currentSessions) => ({ ...currentSessions, [info.id]: info })),
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
      diffCalls,
      openTabs,
      priceFetches: () => priceFetches,
    },
  };
}
