// View models shared by the derivation layer (src/model) and the renderer (src/ui).
// Every optional field is absent when OpenCode data does not support a value.

export type AgentStatus = "running" | "waiting" | "done" | "failed" | "unknown";

export interface ModelLabel {
  readonly providerID: string;
  readonly modelID: string;
  /** Catalog display name, else the model id. */
  readonly name: string;
}

export interface Money {
  readonly usd: number;
  /** True when priced from models.dev list prices instead of OpenCode-reported cost. */
  readonly estimated: boolean;
}

export interface ContextUsage {
  readonly used: number;
  readonly limit: number;
}

export interface LineStats {
  readonly added: number;
  readonly removed: number;
}

export interface AgentView {
  readonly sessionID: string;
  /** Agent display name, e.g. "Fixer". */
  readonly agent: string;
  /** Session title, e.g. "Implement pricing table". */
  readonly title: string | undefined;
  readonly model: ModelLabel | undefined;
  readonly status: AgentStatus;
  /** Why the status is what it is, e.g. "Waiting for permission", "Interrupted". */
  readonly statusDetail: string | undefined;
  /** One-line Activity Ticker text, e.g. "Editing session.ts". */
  readonly activity: string | undefined;
  /** The delegation's short description, from the orchestrator's subagent call. */
  readonly task: string | undefined;
  /** The delegation's full prompt, for the details disclosure. */
  readonly prompt: string | undefined;
  readonly startedAt: number | undefined;
  /** Set once the session is idle. */
  readonly endedAt: number | undefined;
  readonly cost: Money | undefined;
  readonly context: ContextUsage | undefined;
  readonly lines: LineStats | undefined;
  readonly error: string | undefined;
  /** The session routed in the app right now. */
  readonly current: boolean;
}

export interface FleetView {
  readonly root: AgentView;
  /** Running and waiting subagents, oldest start first. */
  readonly active: readonly AgentView[];
  /** Done, failed and unknown subagents, most recently ended first. */
  readonly inactive: readonly AgentView[];
  /** Whole-family cost (root plus every descendant), never summed twice. */
  readonly totalCost: Money | undefined;
}

/** A pulse along one connection line, derived only from observed transitions. */
export interface Beam {
  readonly id: string;
  readonly sessionID: string;
  /** "out": orchestrator → subagent (delegation). "in": subagent → orchestrator (result). */
  readonly direction: "out" | "in";
}
