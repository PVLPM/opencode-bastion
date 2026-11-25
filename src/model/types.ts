// View models shared by the derivation layer (src/model) and the renderer (src/ui).
// Every optional field is absent when OpenCode data does not support a value.

export type AgentStatus = "running" | "waiting" | "done" | "failed" | "unknown";

/** A safe, short category for a failed execution; never the provider's raw message. */
export type ErrorKind =
  | "aborted"
  | "authentication"
  | "context limit"
  | "output limit"
  | "rate limit"
  | "provider error"
  | "error";

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

export interface TokenStats {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Non-cached input plus output, reasoning and cache reads/writes, each once. */
  readonly total: number;
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
  /** Capitalized agent display name, e.g. "Fixer"; the agent id is never mutated. */
  readonly agent: string;
  /** Stored session title without the native subagent suffix; stable across follow-ups. */
  readonly title: string | undefined;
  readonly model: ModelLabel | undefined;
  /** The model variant (reasoning effort) actually used, e.g. "medium"; absent when unknown. */
  readonly effort: string | undefined;
  readonly status: AgentStatus;
  /** Why the status is what it is, e.g. "Waiting for permission", "Interrupted". */
  readonly statusDetail: string | undefined;
  /** One-line Activity Ticker text, e.g. "Editing session.ts". */
  readonly activity: string | undefined;
  /**
   * The latest task: for a subagent, the description of the newest parent→child
   * subagent call (follow-ups replace it); for the orchestrator, the first line
   * of its latest user prompt. Never the session title.
   */
  readonly task: string | undefined;
  /** The full available task text for the details; `task` keeps its first line. */
  readonly taskText: string | undefined;
  readonly startedAt: number | undefined;
  /** Set once the session is idle. */
  readonly endedAt: number | undefined;
  /** Cumulative usage reported by the session, never recomputed from turns. */
  readonly tokens: TokenStats | undefined;
  readonly cost: Money | undefined;
  readonly context: ContextUsage | undefined;
  readonly lines: LineStats | undefined;
  readonly errorKind: ErrorKind | undefined;
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
  /** Known cumulative tokens over the same distinct members; absent if any is invalid. */
  readonly totalTokens: number | undefined;
}

/**
 * One confirmed execution of a session: from the first assistant turn after the
 * previous idle marker to the idle marker that closed it. Never inferred from
 * event silence.
 */
export interface LaneBlock {
  /**
   * Stable across updates: `${sessionID}:${id of the prompt that opened it, else
   * the first assistant}`.
   */
  readonly id: string;
  readonly start: number;
  /** Absent while the execution is live; the renderer extends it to `now`. */
  readonly end: number | undefined;
  /**
   * "running"/"waiting" only for the live block; closed blocks carry the idle
   * outcome ("done", "failed", "unknown" for interrupted), or "unknown" when the
   * history holds no closing idle marker.
   */
  readonly status: AgentStatus;
  /** Delegated task (subagent) or prompt first line (orchestrator); absent when unknown. */
  readonly label: string | undefined;
  /** The full prompt or task text behind `label`, trimmed; for tooltips. */
  readonly text: string | undefined;
}

export interface Lane {
  readonly sessionID: string;
  /** Capitalized agent display name, same as the card's. */
  readonly agent: string;
  readonly title: string | undefined;
  readonly root: boolean;
  /** Oldest first, non-overlapping. */
  readonly blocks: readonly LaneBlock[];
}

/** A confirmed parent→child subagent call, drawn as a connector between lanes. */
export interface Handoff {
  /** The root transcript's subagent tool-part id. */
  readonly id: string;
  readonly childID: string;
  /** When the call was issued (tool part time). */
  readonly at: number;
  /** The child block the call fed: the block running at `at`, else the next to start. */
  readonly blockID: string | undefined;
  /** "followup" when the child already had a call before this one. */
  readonly kind: "delegate" | "followup";
}

export interface LanesView {
  /** Orchestrator first, then children by first execution start; never reordered by status. */
  readonly lanes: readonly Lane[];
  readonly handoffs: readonly Handoff[];
  /** Earliest block start; absent when no block exists. */
  readonly from: number | undefined;
}

/** A pulse along one connection line, derived only from observed transitions. */
export interface Beam {
  readonly id: string;
  readonly sessionID: string;
  /** "out": orchestrator → subagent (delegation). "in": subagent → orchestrator (result). */
  readonly direction: "out" | "in";
}
