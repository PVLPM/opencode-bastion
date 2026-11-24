import type {
  AgentStatus,
  AgentView,
  FleetView,
  Handoff,
  Lane,
  LaneBlock,
  LanesView,
  LineStats,
  ModelLabel,
  Money,
} from "../src/model/types";

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
    effort: undefined,
    status: "running",
    statusDetail: undefined,
    activity: undefined,
    task: undefined,
    startedAt: undefined,
    endedAt: undefined,
    cost: undefined,
    context: undefined,
    lines: undefined,
    errorKind: undefined,
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
    effort: "high",
    status: "running",
    task: "Add the annual toggle and match the tiers to the new price sheet",
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
  "Running command",
  "Thinking…",
];

/**
 * The live scene's cards, in step with `liveLanes`: the Writer finishes and is
 * followed up, and the orchestrator is idle between the turns its lane shows.
 */
export function liveFleet(
  startedAt: number,
  step: number,
  now: number,
  addedCents: number,
): FleetView {
  const activity = LIVE_ACTIVITIES[step % LIVE_ACTIVITIES.length] ?? "Thinking…";
  const nextActivity = LIVE_ACTIVITIES[(step + 1) % LIVE_ACTIVITIES.length] ?? "Thinking…";
  const elapsed = (now - startedAt) / 1000;
  const rootIdleSince =
    elapsed < LIVE_ROOT_WAKES
      ? -29
      : elapsed >= 9.5 && elapsed < LIVE_ROOT_RESUMES
        ? 9.5
        : undefined;
  const writerDone = elapsed >= LIVE_WRITER_DONE && elapsed < LIVE_FOLLOWUP_STARTS;
  const followedUp = elapsed >= LIVE_FOLLOWUP_STARTS;
  return fleet(
    agent({
      sessionID: "ses_live_root",
      agent: "Orchestrator",
      title: "Launch the new pricing page",
      model: model("Opus 5.5"),
      effort: "high",
      status: rootIdleSince === undefined ? "running" : "done",
      task: "Add the annual toggle and match the tiers to the new price sheet",
      activity: rootIdleSince === undefined ? "Delegating to Writer" : undefined,
      startedAt: startedAt - 72_000,
      endedAt: rootIdleSince === undefined ? undefined : startedAt + rootIdleSince * 1000,
      cost: money((42 + addedCents) / 100),
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
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "medium",
        status: writerDone ? "done" : "running",
        activity: writerDone ? undefined : nextActivity,
        task: followedUp
          ? "Shorten the enterprise tier"
          : "Write the plan copy for the three pricing tiers",
        startedAt: startedAt - 38_000,
        endedAt: writerDone ? startedAt + LIVE_WRITER_DONE * 1000 : undefined,
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

/** Two Fixers and two Explorers: repeated agent names stay separate cards. */
export function repeatedFleet(): FleetView {
  return fleet(
    rootAgent({
      title: "Stabilise session recovery",
      task: "Fix the recovery regressions and re-run the suite",
      activity: "Delegating to Fixer",
      model: model("Opus 5.5"),
      effort: "high",
    }),
    [
      agent({
        sessionID: "ses_fixer_a",
        agent: "Fixer",
        title: "Session recovery",
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "medium",
        status: "running",
        task: "Fix recovery regressions",
        activity: "Running tests…",
        startedAt: NOW - 128_000,
        cost: money(0.41),
        context: { used: 92_000, limit: 400_000 },
        lines: lines(48, 12),
      }),
      agent({
        sessionID: "ses_fixer_b",
        agent: "Fixer",
        title: "Flaky reconnect test",
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "low",
        status: "running",
        task: "Stabilise the reconnect test",
        activity: "Editing reconnect.test.ts",
        startedAt: NOW - 64_000,
        cost: money(0.12),
        context: { used: 21_000, limit: 400_000 },
        lines: lines(6, 3),
      }),
      agent({
        sessionID: "ses_explore_a",
        agent: "Explorer",
        title: "Where is the retry policy",
        model: model("Sonnet 5.5"),
        status: "done",
        task: "Find every retry policy in the client",
        startedAt: NOW - 240_000,
        endedAt: NOW - 180_000,
        cost: money(0.03),
        context: { used: 18_000, limit: 200_000 },
      }),
      agent({
        sessionID: "ses_explore_b",
        agent: "Explorer",
        title: "Recovery call sites",
        model: model("Sonnet 5.5"),
        status: "done",
        task: "List the call sites of recoverSession",
        startedAt: NOW - 230_000,
        endedAt: NOW - 196_000,
        cost: money(0.02),
        context: { used: 11_000, limit: 200_000 },
      }),
    ],
  );
}

/** One card per status, so every mark and row-two tone can be compared side by side. */
export function statusesFleet(): FleetView {
  return fleet(
    rootAgent({ status: "waiting", statusDetail: "Waiting for permission", task: "Ship 1.1" }),
    [
      agent({
        sessionID: "ses_s_running",
        agent: "Fixer",
        title: "Recovery regressions",
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "medium",
        status: "running",
        task: "Fix recovery regressions",
        activity: "Running tests…",
        startedAt: NOW - 42_000,
        cost: money(0.21),
        context: { used: 64_000, limit: 400_000 },
        lines: lines(14, 3),
      }),
      agent({
        sessionID: "ses_s_waiting",
        agent: "Reviewer",
        title: "Review the diff",
        model: model("Opus 5.5"),
        status: "waiting",
        statusDetail: "Waiting for your answer",
        task: "Review the recovery diff",
        startedAt: NOW - 33_000,
        cost: money(0.08),
        context: { used: 40_000, limit: 200_000 },
      }),
      agent({
        sessionID: "ses_s_failed",
        agent: "Deployer",
        title: "Publish the preview",
        model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
        effort: "high",
        status: "failed",
        errorKind: "rate limit",
        task: "Publish the preview build",
        startedAt: NOW - 200_000,
        endedAt: NOW - 150_000,
        cost: money(0.05, true),
        context: { used: 190_000, limit: 200_000 },
      }),
      agent({
        sessionID: "ses_s_done",
        agent: "Explorer",
        title: "Map the recovery flow",
        model: model("Sonnet 5.5"),
        status: "done",
        task: "Map the recovery flow",
        startedAt: NOW - 260_000,
        endedAt: NOW - 220_000,
        cost: money(0.02),
        context: { used: 12_000, limit: 200_000 },
        lines: lines(0, 0),
      }),
      agent({
        sessionID: "ses_s_unknown",
        agent: "Migrator",
        title: "Backfill legacy ids",
        status: "unknown",
        statusDetail: "Interrupted",
        task: "Backfill legacy ids",
        startedAt: NOW - 320_000,
        endedAt: NOW - 300_000,
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
      errorKind: "provider error",
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
      activity: "Running command",
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
      activity: "Running command",
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
      errorKind: "provider error",
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

// Lanes ----------------------------------------------------------------------

type BlockSpec = readonly [
  start: number,
  end: number | undefined,
  status: AgentStatus,
  label?: string,
];

interface LaneSpec {
  readonly sessionID: string;
  readonly agent: string;
  readonly title?: string;
  readonly root?: boolean;
  /** Seconds relative to `base`; an absent end is a live execution. */
  readonly blocks: readonly BlockSpec[];
}

/** A call issued at `at` seconds; `block` is the index of the child block it fed. */
interface HandoffSpec {
  readonly childID: string;
  readonly at: number;
  readonly block: number | undefined;
}

function buildLanes(
  base: number,
  specs: readonly LaneSpec[],
  calls: readonly HandoffSpec[],
): LanesView {
  const lanes: Lane[] = specs.map((spec) => ({
    sessionID: spec.sessionID,
    agent: spec.agent,
    title: spec.title,
    root: spec.root ?? false,
    blocks: spec.blocks.map(
      ([start, end, status, label], index): LaneBlock => ({
        id: `${spec.sessionID}:${index}`,
        start: base + start * 1000,
        end: end === undefined ? undefined : base + end * 1000,
        status,
        label: label?.split("\n", 1)[0],
        text: label,
      }),
    ),
  }));
  const seen = new Set<string>();
  const handoffs = calls.map((call, index): Handoff => {
    const kind = seen.has(call.childID) ? "followup" : "delegate";
    seen.add(call.childID);
    return {
      id: `call_${index}`,
      childID: call.childID,
      at: base + call.at * 1000,
      blockID: call.block === undefined ? undefined : `${call.childID}:${call.block}`,
      kind,
    };
  });
  let from: number | undefined;
  for (const lane of lanes) {
    for (const block of lane.blocks) from = Math.min(from ?? block.start, block.start);
  }
  return { lanes, handoffs, from };
}

const blockStatus = (agent: AgentView): AgentStatus =>
  agent.endedAt === undefined && agent.status !== "running" && agent.status !== "waiting"
    ? "unknown"
    : agent.status;

/**
 * Lanes implied by a fleet's cards: one execution per subagent, and orchestrator
 * turns that issue each call and read each result, with idle gaps in between.
 */
export function lanesFor(view: FleetView): LanesView {
  const root = view.root;
  const children = [...view.active, ...view.inactive]
    .filter((child) => child.startedAt !== undefined)
    .toSorted((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const seconds = (time: number) => (time - NOW) / 1000;
  const turns: [number, number][] = [];
  const addTurn = (start: number, end: number) => {
    const last = turns.at(-1);
    if (last !== undefined && start <= last[1] + 2) last[1] = Math.max(last[1], end);
    else turns.push([start, end]);
  };
  const moments = [
    ...children.map((child) => [seconds(child.startedAt ?? NOW) - 4, 5] as const),
    ...children.flatMap((child) =>
      child.endedAt === undefined ? [] : [[seconds(child.endedAt) + 1, 7] as const],
    ),
  ].toSorted((a, b) => a[0] - b[0]);
  const rootStart = root.startedAt === undefined ? undefined : seconds(root.startedAt);
  if (rootStart !== undefined) addTurn(rootStart, rootStart + 6);
  for (const [start, length] of moments) addTurn(start, start + length);
  const rootBlocks: BlockSpec[] = turns.map(([start, end], index) => [
    start,
    end,
    "done",
    index === 0 ? root.task : "Reading a result",
  ]);
  const last = rootBlocks.at(-1);
  if ((root.status === "running" || root.status === "waiting") && last !== undefined) {
    rootBlocks[rootBlocks.length - 1] = [last[0], undefined, root.status, last[3]];
  }
  return buildLanes(
    NOW,
    [
      {
        sessionID: root.sessionID,
        agent: root.agent,
        title: root.title,
        root: true,
        blocks: rootBlocks,
      },
      ...children.map((child) => ({
        sessionID: child.sessionID,
        agent: child.agent,
        title: child.title,
        blocks: [
          [
            seconds(child.startedAt ?? NOW),
            child.endedAt === undefined ? undefined : seconds(child.endedAt),
            blockStatus(child),
            child.task,
          ] as const,
        ],
      })),
    ],
    children.map((child) => ({
      childID: child.sessionID,
      at: seconds(child.startedAt ?? NOW) - 1,
      block: 0,
    })),
  );
}

/**
 * A fourteen-minute session: the orchestrator works in six separate turns, two
 * Explorers and two Fixers run side by side, both Fixers get a follow-up after
 * an idle gap, a deploy fails and a review waits for you.
 */
const SESSION_LANES: readonly LaneSpec[] = [
  {
    sessionID: "ses_long_root",
    agent: "Orchestrator",
    title: "Stabilise session recovery",
    root: true,
    blocks: [
      [-840, -790, "done", "Stabilise session recovery before 1.1"],
      [-702, -664, "done", "Explorer: retry policies mapped"],
      [-524, -505, "done", "Fixer: recovery fixed"],
      [-334, -300, "done", "Fixer: reconnect test stable"],
      [-152, -128, "done", "Deployer failed: rate limit"],
      [
        -44,
        undefined,
        "running",
        `Also check the offline banner.

Reproduce the first launch without a network connection, then reconnect while the banner is still visible. Compare that with what happens when the connection drops halfway through a session.

Check the copy at narrow panel widths and make sure the retry action remains visible at larger text sizes. Confirm that an empty session does not show the same message as a connection failure.

Write up the difference between the two cases and include which one clears the banner automatically.`,
      ],
    ],
  },
  {
    sessionID: "ses_long_explore_a",
    agent: "Explorer",
    title: "Where is the retry policy",
    blocks: [[-811, -720, "done", "Find every retry policy in the client"]],
  },
  {
    sessionID: "ses_long_explore_b",
    agent: "Explorer",
    title: "Recovery call sites",
    blocks: [[-805, -705, "done", "List the call sites of recoverSession"]],
  },
  {
    sessionID: "ses_long_fixer_a",
    agent: "Fixer",
    title: "Session recovery",
    blocks: [
      [-689, -530, "done", "Fix recovery regressions"],
      [-511, -420, "done", "Also cover the cold-start path"],
    ],
  },
  {
    sessionID: "ses_long_fixer_b",
    agent: "Fixer",
    title: "Flaky reconnect test",
    blocks: [
      [-675, -340, "done", "Stabilise the reconnect test"],
      [-29, undefined, "running", "Check the offline banner copy"],
    ],
  },
  {
    sessionID: "ses_long_deploy",
    agent: "Deployer",
    title: "Publish the preview",
    blocks: [[-317, -160, "failed", "Publish the preview build"]],
  },
  {
    sessionID: "ses_long_review",
    agent: "Reviewer",
    title: "Review the recovery diff",
    blocks: [[-139, undefined, "waiting", "Review the recovery diff"]],
  },
];

const SESSION_CALLS: readonly HandoffSpec[] = [
  { childID: "ses_long_explore_a", at: -812, block: 0 },
  { childID: "ses_long_explore_b", at: -806, block: 0 },
  { childID: "ses_long_fixer_a", at: -690, block: 0 },
  { childID: "ses_long_fixer_b", at: -676, block: 0 },
  { childID: "ses_long_fixer_a", at: -512, block: 1 },
  { childID: "ses_long_deploy", at: -318, block: 0 },
  { childID: "ses_long_review", at: -140, block: 0 },
  { childID: "ses_long_fixer_b", at: -30, block: 1 },
  { childID: "ses_long_fixer_b", at: -20, block: 1 },
];

export function sessionLanes(): LanesView {
  return buildLanes(NOW, SESSION_LANES, SESSION_CALLS);
}

export function sessionFleet(): FleetView {
  const at = (seconds: number) => NOW + seconds * 1000;
  return fleet(
    rootAgent({
      sessionID: "ses_long_root",
      title: "Stabilise session recovery",
      task: "Also check the offline banner",
      activity: "Delegating to Fixer",
      startedAt: at(-840),
      cost: money(1.18),
    }),
    [
      agent({
        sessionID: "ses_long_fixer_b",
        agent: "Fixer",
        title: "Flaky reconnect test",
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "low",
        task: "Check the offline banner copy",
        activity: "Reading offline-banner.tsx",
        startedAt: at(-675),
        cost: money(0.36),
        context: { used: 120_000, limit: 400_000 },
      }),
      agent({
        sessionID: "ses_long_review",
        agent: "Reviewer",
        title: "Review the recovery diff",
        model: model("Opus 5.5"),
        status: "waiting",
        statusDetail: "Waiting for your answer",
        task: "Review the recovery diff",
        startedAt: at(-139),
        cost: money(0.11),
      }),
      agent({
        sessionID: "ses_long_deploy",
        agent: "Deployer",
        title: "Publish the preview",
        model: model("Gemini 3 Pro", "google", "gemini-3-pro"),
        status: "failed",
        errorKind: "rate limit",
        task: "Publish the preview build",
        startedAt: at(-317),
        endedAt: at(-160),
        cost: money(0.05),
      }),
      agent({
        sessionID: "ses_long_fixer_a",
        agent: "Fixer",
        title: "Session recovery",
        model: model("GPT-6.2 Sol", "openai", "gpt-6.2-sol"),
        effort: "medium",
        status: "done",
        task: "Also cover the cold-start path",
        startedAt: at(-689),
        endedAt: at(-420),
        cost: money(0.41),
        lines: lines(48, 12),
      }),
      agent({
        sessionID: "ses_long_explore_b",
        agent: "Explorer",
        title: "Recovery call sites",
        model: model("Sonnet 5.5"),
        status: "done",
        task: "List the call sites of recoverSession",
        startedAt: at(-805),
        endedAt: at(-705),
        cost: money(0.02),
      }),
      agent({
        sessionID: "ses_long_explore_a",
        agent: "Explorer",
        title: "Where is the retry policy",
        model: model("Sonnet 5.5"),
        status: "done",
        task: "Find every retry policy in the client",
        startedAt: at(-811),
        endedAt: at(-720),
        cost: money(0.03),
      }),
    ],
  );
}

/** Seconds after the live scene starts when the Writer finishes and is followed up. */
const LIVE_WRITER_DONE = 4;
const LIVE_FOLLOWUP = 7;
const LIVE_FOLLOWUP_STARTS = 7.5;
const LIVE_ROOT_WAKES = LIVE_WRITER_DONE + 0.5;
const LIVE_ROOT_RESUMES = 15;

/**
 * The live scene's lanes: everything live grows toward now; the Writer closes,
 * the orchestrator wakes to read it, sends a follow-up and goes idle again.
 */
export function liveLanes(startedAt: number, now: number): LanesView {
  const elapsed = (now - startedAt) / 1000;
  /** The end of an execution that closes at `until`, absent while it still runs. */
  const live = (until: number): number | undefined => (elapsed < until ? undefined : until);
  const root: BlockSpec[] = [
    [-72, -50, "done", "Add the annual toggle and match the tiers to the new price sheet"],
    [-46, -29, "done", "Researcher: competitors compared"],
  ];
  if (elapsed >= LIVE_ROOT_WAKES) {
    root.push([
      LIVE_ROOT_WAKES,
      live(9.5),
      elapsed < 9.5 ? "running" : "done",
      "Writer: plan copy drafted",
    ]);
  }
  if (elapsed >= LIVE_ROOT_RESUMES)
    root.push([LIVE_ROOT_RESUMES, undefined, "running", "Tighten the hero too"]);
  const writer: BlockSpec[] = [
    [
      -37.5,
      live(LIVE_WRITER_DONE),
      elapsed < LIVE_WRITER_DONE ? "running" : "done",
      "Write the plan copy for the three pricing tiers",
    ],
  ];
  if (elapsed >= LIVE_FOLLOWUP_STARTS)
    writer.push([LIVE_FOLLOWUP_STARTS, undefined, "running", "Shorten the enterprise tier"]);
  const calls: HandoffSpec[] = [
    { childID: "ses_live_research", at: -44, block: 0 },
    { childID: "ses_live_writer", at: -38, block: 0 },
    { childID: "ses_live_verify", at: -31, block: 0 },
  ];
  if (elapsed >= LIVE_FOLLOWUP) {
    calls.push({
      childID: "ses_live_writer",
      at: LIVE_FOLLOWUP,
      block: elapsed >= LIVE_FOLLOWUP_STARTS ? 1 : undefined,
    });
  }
  return buildLanes(
    startedAt,
    [
      { sessionID: "ses_live_root", agent: "Orchestrator", root: true, blocks: root },
      {
        sessionID: "ses_live_research",
        agent: "Researcher",
        blocks: [[-43.5, undefined, "running", "Compare five competitors"]],
      },
      { sessionID: "ses_live_writer", agent: "Writer", blocks: writer },
      {
        sessionID: "ses_live_verify",
        agent: "Verifier",
        blocks: [[-30.5, undefined, "waiting", "Check the checkout flow end to end"]],
      },
    ],
    calls,
  );
}
