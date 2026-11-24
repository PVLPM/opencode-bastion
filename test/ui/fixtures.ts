import type { AgentView, FleetView } from "../../src/model/types";

export const TEST_NOW = 1_700_000_000_000;

interface AgentInit extends Partial<AgentView> {
  readonly sessionID: string;
}

function testAgent(init: AgentInit): AgentView {
  const base: AgentView = {
    sessionID: init.sessionID,
    agent: "Agent",
    title: undefined,
    model: { providerID: "anthropic", modelID: "claude-opus-4-5", name: "Opus 5.5" },
    status: "running",
    statusDetail: undefined,
    activity: undefined,
    task: undefined,
    prompt: undefined,
    startedAt: TEST_NOW - 10_000,
    endedAt: undefined,
    cost: undefined,
    context: undefined,
    lines: undefined,
    error: undefined,
    current: false,
  };
  return { ...base, ...init };
}

export function testRoot(init: Partial<AgentView> = {}): AgentView {
  return testAgent({
    sessionID: "ses_root",
    agent: "Orchestrator",
    title: "Ship the pricing page",
    activity: "Delegating to Fixer",
    ...init,
  });
}

export function testFleet(root: AgentView, children: readonly AgentView[]): FleetView {
  const active: AgentView[] = [];
  const inactive: AgentView[] = [];
  for (const child of children) {
    if (child.status === "running" || child.status === "waiting") active.push(child);
    else inactive.push(child);
  }
  return { root, active, inactive, totalCost: { usd: 1.2, estimated: false } };
}

export function runningChild(init: Partial<AgentView> = {}): AgentView {
  return testAgent({
    sessionID: "ses_child_a",
    agent: "Fixer",
    title: "Fix the failing test",
    activity: "Editing cart.test.ts",
    ...init,
  });
}

export function waitingChild(init: Partial<AgentView> = {}): AgentView {
  return testAgent({
    sessionID: "ses_child_b",
    agent: "Reviewer",
    title: "Review the diff",
    status: "waiting",
    statusDetail: "Waiting for permission",
    activity: "Waiting for permission…",
    ...init,
  });
}
