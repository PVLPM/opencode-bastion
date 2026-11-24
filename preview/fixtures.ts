import type { AgentView, FleetView, LineStats, ModelLabel, Money } from "../src/model/types";

const NOW = Date.now();

export const now = NOW;

const model = (
  name: string,
  providerID = "anthropic",
  modelID = "claude-opus-4-5",
): ModelLabel => ({
  providerID,
  modelID,
  name,
});

const money = (usd: number, estimated = false): Money => ({ usd, estimated });

const lines = (added: number, removed: number): LineStats => ({ added, removed });

interface AgentInit extends Partial<AgentView> {
  readonly sessionID: string;
}

function agent(init: AgentInit): AgentView {
  const base: AgentView = {
    sessionID: init.sessionID,
    agent: "Agent",
    title: undefined,
    model: undefined,
    status: "running",
    statusDetail: undefined,
    activity: undefined,
    task: undefined,
    prompt: undefined,
    startedAt: undefined,
    endedAt: undefined,
    cost: undefined,
    context: undefined,
    lines: undefined,
    error: undefined,
    current: false,
  };
  return { ...base, ...init };
}

function totalCost(members: readonly AgentView[]): Money | undefined {
  let usd = 0;
  let known = false;
  let estimated = false;
  for (const member of members) {
    if (member.cost === undefined) continue;
    known = true;
    usd += member.cost.usd;
    estimated = estimated || member.cost.estimated;
  }
  return known ? { usd, estimated } : undefined;
}

function fleet(root: AgentView, children: readonly AgentView[]): FleetView {
  const active: AgentView[] = [];
  const inactive: AgentView[] = [];
  for (const child of children) {
    if (child.status === "running" || child.status === "waiting") active.push(child);
    else inactive.push(child);
  }
  active.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  inactive.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return {
    root,
    active,
    inactive,
    totalCost: totalCost([root, ...children]),
  };
}

function rootAgent(init: Partial<AgentView> = {}): AgentView {
  return agent({
    sessionID: "ses_root_launch",
    agent: "Orchestrator",
    title: "Launch the new pricing page",
    model: model("Opus 5.5"),
    status: "running",
    activity: "Delegating to Researcher",
    startedAt: NOW - 51_000,
    cost: money(0.42),
    context: { used: 62_400, limit: 200_000 },
    lines: lines(18, 4),
    ...init,
  });
}

const LIVE_ACTIVITIES = [
  "Reading pricing.md",
  "Editing pricing-table.tsx",
  "Running pnpm vitest run",
  "Thinking…",
];

export function liveFleet(startedAt: number, step: number): FleetView {
  const activity = LIVE_ACTIVITIES[step % LIVE_ACTIVITIES.length] ?? "Thinking…";
  const nextActivity = LIVE_ACTIVITIES[(step + 1) % LIVE_ACTIVITIES.length] ?? "Thinking…";
  return fleet(
    agent({
      sessionID: "ses_live_root",
      agent: "Orchestrator",
      title: "Launch the new pricing page",
      model: model("Opus 5.5"),
      status: "running",
      activity: step % 2 === 0 ? "Delegating to Writer" : "Reviewing the diff",
      startedAt: startedAt - 72_000,
      cost: money(0.42),
      context: { used: 62_400, limit: 200_000 },
      lines: lines(18, 4),
    }),
    [
      agent({
        sessionID: "ses_live_research",
        agent: "Researcher",
        title: "Compare five competitors",
        model: model("Opus 5.5"),
        status: "running",
        activity,
        task: "Compare five competitors",
        startedAt: startedAt - 44_000,
        cost: money(0.31),
        context: { used: 84_200, limit: 200_000 },
        lines: lines(12, 2),
      }),
      agent({
        sessionID: "ses_live_writer",
        agent: "Writer",
        title: "Write the plan copy",
        model: model("GPT-5.1", "openai", "gpt-5.1"),
        status: "running",
        activity: nextActivity,
        task: "Write the plan copy for the three pricing tiers",
        startedAt: startedAt - 38_000,
        cost: money(0.18),
        context: { used: 31_800, limit: 128_000 },
        lines: lines(26, 9),
      }),
      agent({
        sessionID: "ses_live_verify",
        agent: "Verifier",
        title: "Check the checkout flow",
        model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
        status: "waiting",
        statusDetail: "Waiting for permission",
        activity: "Waiting for permission…",
        task: "Check the checkout flow end to end",
        startedAt: startedAt - 31_000,
        cost: money(0.09),
        context: { used: 51_600, limit: 1_000_000 },
        lines: lines(3, 1),
      }),
    ],
  );
}

export function rootOnlyFleet(): FleetView {
  return fleet(rootAgent(), []);
}

export function singleAgentFleet(): FleetView {
  return fleet(rootAgent(), [
    agent({
      sessionID: "ses_child_research",
      agent: "Researcher",
      title: "Compare five competitors",
      model: model("Opus 5.5"),
      status: "running",
      activity: "Reading pricing.md",
      task: "Compare five competitors and summarise their pricing",
      startedAt: NOW - 24_000,
      cost: money(0.21),
      context: { used: 48_200, limit: 200_000 },
      lines: lines(12, 2),
    }),
  ]);
}

export function parallelFleet(): FleetView {
  return fleet(rootAgent(), [
    agent({
      sessionID: "ses_child_research",
      agent: "Researcher",
      title: "Compare five competitors",
      model: model("Opus 5.5"),
      status: "running",
      activity: "Reading pricing.md",
      task: "Compare five competitors and summarise their pricing",
      startedAt: NOW - 44_000,
      cost: money(0.31),
      context: { used: 84_200, limit: 200_000 },
      lines: lines(12, 2),
    }),
    agent({
      sessionID: "ses_child_writer",
      agent: "Writer",
      title: "Write the plan copy",
      model: model("GPT-5.1", "openai", "gpt-5.1"),
      status: "running",
      activity: "Editing pricing-table.tsx",
      task: "Write the plan copy for the three pricing tiers",
      startedAt: NOW - 38_000,
      cost: money(0.18),
      context: { used: 31_800, limit: 128_000 },
      lines: lines(26, 9),
    }),
    agent({
      sessionID: "ses_child_verify",
      agent: "Verifier",
      title: "Check the checkout flow",
      model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
      status: "waiting",
      statusDetail: "Waiting for permission",
      activity: "Waiting for permission…",
      task: "Check the checkout flow end to end",
      startedAt: NOW - 31_000,
      cost: money(0.09),
      context: { used: 51_600, limit: 1_000_000 },
      lines: lines(3, 1),
    }),
    agent({
      sessionID: "ses_child_copy",
      agent: "Copyeditor",
      title: "Tighten the hero headline",
      model: model("Mistral Large", "mistral", "mistral-large-2"),
      status: "running",
      activity: "Searching the web",
      task: "Tighten the hero headline without losing the claim",
      startedAt: NOW - 12_000,
      cost: money(0.04),
      context: { used: 12_900, limit: 128_000 },
      lines: lines(2, 2),
    }),
  ]);
}

export function longNamesFleet(): FleetView {
  return fleet(
    rootAgent({
      title: "Coordinate the accessibility remediation across the settings surface",
      model: model("Opus 5.5", "anthropic", "claude-opus-4-5-20251101"),
      activity: "Delegating to Keyboard and Screen-reader Review",
    }),
    [
      agent({
        sessionID: "ses_child_accessibility_review_extremely_long_identifier",
        agent: "Accessibility review and remediation specialist",
        title: "Audit every interactive control in the settings flow for keyboard traps",
        model: model(
          "claude-sonnet-4-5-20250929-preview-extended",
          "openrouter",
          "anthropic/claude-sonnet-4-5",
        ),
        status: "running",
        activity: "Reading settings-dialog.tsx",
        task: "Audit every interactive control in the settings flow for keyboard traps and screen-reader names, then fix the findings in place.",
        startedAt: NOW - 96_000,
        cost: money(0.74, true),
        context: { used: 188_400, limit: 200_000 },
        lines: lines(1_284, 318),
      }),
      agent({
        sessionID: "ses_child_token_audit",
        agent: "Design token auditor",
        title: "Replace hard-coded colors",
        model: model("Grok 4.5", "xai", "grok-4.5"),
        status: "waiting",
        statusDetail: "Waiting for your answer",
        activity: "Asking a question…",
        task: "Replace hard-coded colors with native OpenCode tokens.",
        startedAt: NOW - 54_000,
        cost: money(0.12, true),
        context: { used: 4_100, limit: 256_000 },
        lines: lines(0, 0),
      }),
    ],
  );
}

export function waitingFleet(): FleetView {
  return fleet(rootAgent({ status: "waiting", statusDetail: "Waiting for permission" }), [
    agent({
      sessionID: "ses_child_verify",
      agent: "Verifier",
      title: "Check the checkout flow",
      model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
      status: "waiting",
      statusDetail: "Waiting for permission",
      activity: "Waiting for permission…",
      task: "Check the checkout flow end to end",
      startedAt: NOW - 61_000,
      cost: money(0.09),
      context: { used: 51_600, limit: 1_000_000 },
      lines: lines(3, 1),
    }),
    agent({
      sessionID: "ses_child_research",
      agent: "Researcher",
      title: "Compare five competitors",
      model: model("Opus 5.5"),
      status: "running",
      activity: "Thinking…",
      task: "Compare five competitors",
      startedAt: NOW - 44_000,
      cost: money(0.31),
      context: { used: 84_200, limit: 200_000 },
      lines: lines(12, 2),
    }),
    agent({
      sessionID: "ses_child_forms",
      agent: "Form builder",
      title: "Wire the billing form",
      model: model("DeepSeek V4.1", "deepseek", "deepseek-v4"),
      status: "waiting",
      statusDetail: "Waiting for your answer",
      activity: "Asking a question…",
      task: "Wire the billing form to the new plan endpoints",
      startedAt: NOW - 29_000,
      cost: money(0.05),
      context: { used: 22_000, limit: 128_000 },
      lines: lines(41, 7),
    }),
  ]);
}

export function failedFleet(): FleetView {
  return fleet(rootAgent({ status: "done", endedAt: NOW - 3_000, activity: undefined }), [
    agent({
      sessionID: "ses_child_release",
      agent: "Release engineer",
      title: "Publish the pricing page",
      model: model("Opus 5.5"),
      status: "failed",
      activity: undefined,
      task: "Publish the pricing page to production",
      startedAt: NOW - 300_000,
      endedAt: NOW - 210_000,
      error: "Deploy failed: the production token has no access to the pricing project.",
      cost: money(0.22),
      context: { used: 96_100, limit: 200_000 },
      lines: lines(4, 1),
    }),
    agent({
      sessionID: "ses_child_legal",
      agent: "Legal reviewer",
      title: "Read the refund clause",
      model: model("Moonshot Kimi K2", "moonshotai", "kimi-k2"),
      status: "done",
      activity: undefined,
      task: "Read the refund clause and flag risky wording",
      startedAt: NOW - 280_000,
      endedAt: NOW - 190_000,
      cost: money(0.07),
      context: { used: 33_200, limit: 256_000 },
      lines: lines(2, 0),
    }),
    agent({
      sessionID: "ses_child_research",
      agent: "Researcher",
      title: "Compare five competitors",
      model: model("Opus 5.5"),
      status: "running",
      activity: "Running pnpm build",
      task: "Compare five competitors",
      startedAt: NOW - 72_000,
      cost: money(0.31),
      context: { used: 84_200, limit: 200_000 },
      lines: lines(12, 2),
    }),
  ]);
}

export function inactiveFleet(): FleetView {
  return fleet(rootAgent({ status: "running", activity: "Reviewing the diff" }), [
    agent({
      sessionID: "ses_child_verify",
      agent: "Verifier",
      title: "Check the checkout flow",
      model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
      status: "running",
      activity: "Running pnpm vitest run",
      task: "Check the checkout flow end to end",
      startedAt: NOW - 52_000,
      cost: money(0.09),
      context: { used: 51_600, limit: 1_000_000 },
      lines: lines(3, 1),
      current: true,
    }),
    agent({
      sessionID: "ses_child_writer",
      agent: "Writer",
      title: "Write the plan copy",
      model: model("GPT-5.1", "openai", "gpt-5.1"),
      status: "waiting",
      statusDetail: "Waiting for permission",
      activity: "Waiting for permission…",
      task: "Write the plan copy for the three pricing tiers",
      startedAt: NOW - 38_000,
      cost: money(0.18),
      context: { used: 31_800, limit: 128_000 },
      lines: lines(26, 9),
    }),
    agent({
      sessionID: "ses_child_legal",
      agent: "Legal reviewer",
      title: "Read the refund clause",
      model: model("Moonshot Kimi K2", "moonshotai", "kimi-k2"),
      status: "done",
      activity: undefined,
      task: "Read the refund clause and flag risky wording",
      startedAt: NOW - 280_000,
      endedAt: NOW - 190_000,
      cost: money(0.07),
      context: { used: 33_200, limit: 256_000 },
      lines: lines(2, 0),
    }),
    agent({
      sessionID: "ses_child_release",
      agent: "Release engineer",
      title: "Publish the pricing page",
      model: model("Opus 5.5"),
      status: "failed",
      activity: undefined,
      task: "Publish the pricing page to production",
      startedAt: NOW - 300_000,
      endedAt: NOW - 210_000,
      error: "Deploy failed: the production token has no access to the pricing project.",
      cost: money(0.22),
      context: { used: 96_100, limit: 200_000 },
      lines: lines(4, 1),
    }),
    agent({
      sessionID: "ses_child_stale",
      agent: "Migrator",
      title: "Backfill legacy plan ids",
      model: model("Opus 5.5"),
      status: "unknown",
      statusDetail: "Interrupted",
      activity: undefined,
      task: "Backfill legacy plan ids",
      startedAt: NOW - 320_000,
      endedAt: NOW - 240_000,
      cost: money(0.03),
      context: { used: 9_800, limit: 200_000 },
      lines: undefined,
    }),
    agent({
      sessionID: "ses_child_guard",
      agent: "Guard",
      title: "Re-check the bundle size",
      model: model("Qwen 3 Coder", "alibaba", "qwen3-coder"),
      status: "done",
      activity: undefined,
      task: "Re-check the bundle size after the copy change",
      startedAt: NOW - 220_000,
      endedAt: NOW - 120_000,
      cost: money(0.02),
      context: { used: 7_200, limit: 128_000 },
      lines: lines(0, 3),
    }),
  ]);
}
