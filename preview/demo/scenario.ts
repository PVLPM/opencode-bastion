// A deterministic, preview-only scene for the README recording. It drives the
// real fake host and lets production derivation produce every view: the fleet,
// Agent Lanes, beams and all metrics below are read from `createFleetSource`.
import type {
  AgentInfo,
  FileDiffInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStructuredError,
  TokenUsageInfo,
} from "@opencode/client/promise";

import type { FleetHost } from "../../src/data/fleet-source";
import { createFakeHost } from "../../test/data/fake-host";
import {
  makeAgent,
  makeAssistant,
  makeIdle,
  makeModel,
  makeProvider,
  makeSession,
  makeSynthetic,
  makeTool,
  makeUser,
} from "../../test/fixtures";

export const DEMO_ROOT = "ses_demo_root";
const DEMO_EXPLORER = "ses_demo_explorer";
const DEMO_DESIGNER = "ses_demo_designer";
const DEMO_FIXER = "ses_demo_fixer";
const DEMO_ORACLE = "ses_demo_oracle";
const DEMO_VALIDATOR = "ses_demo_validator";

/** Seconds after `start()` when the full story has been told. */
const DEMO_DURATION = 32.2;

const LOCATION = { directory: "C:\\work\\pricing-page" };
const PROJECT = "preview-demo";
const SERVER = "preview-server";

const PROVIDERS: readonly ProviderInfo[] = [
  makeProvider({ id: "anthropic", name: "Anthropic" }),
  makeProvider({ id: "zai", name: "Z.ai" }),
  makeProvider({ id: "deepseek", name: "DeepSeek" }),
  makeProvider({ id: "openai", name: "OpenAI" }),
  makeProvider({ id: "moonshotai", name: "Moonshot AI" }),
];

const OPUS = makeModel({
  id: "claude-opus-5.5",
  providerID: "anthropic",
  modelID: "claude-opus-5.5",
  name: "Claude Opus 5.5",
  contextLimit: 200_000,
  cost: [{ input: 15, output: 75, cache: { read: 1.5, write: 18.75 } }],
});
const GLM = makeModel({
  id: "glm-5.3-flash",
  providerID: "zai",
  modelID: "glm-5.3-flash",
  name: "GLM 5.3 Flash",
  contextLimit: 200_000,
  cost: [{ input: 0.6, output: 2.2, cache: { read: 0.06, write: 0.6 } }],
});
const SONNET = makeModel({
  id: "claude-sonnet-5.5",
  providerID: "anthropic",
  modelID: "claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
  contextLimit: 200_000,
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
});
const DEEPSEEK = makeModel({
  id: "deepseek-v4.1-flash",
  providerID: "deepseek",
  modelID: "deepseek-v4.1-flash",
  name: "DeepSeek V4.1 Flash",
  contextLimit: 128_000,
  cost: [{ input: 0.28, output: 0.42, cache: { read: 0.028, write: 0.28 } }],
});
const GPT = makeModel({
  id: "gpt-6.2-sol",
  providerID: "openai",
  modelID: "gpt-6.2-sol",
  name: "GPT-6.2 Sol",
  contextLimit: 400_000,
  cost: [{ input: 10, output: 40, cache: { read: 1, write: 10 } }],
});
const KIMI = makeModel({
  id: "kimi-k3.1",
  providerID: "moonshotai",
  modelID: "kimi-k3.1",
  name: "Kimi K3.1",
  contextLimit: 256_000,
  cost: [{ input: 0.6, output: 2.5, cache: { read: 0.06, write: 0.6 } }],
});
const MODELS: readonly ModelInfo[] = [OPUS, GLM, SONNET, DEEPSEEK, GPT, KIMI];

const AGENTS: readonly AgentInfo[] = [
  makeAgent({ id: "orchestrator", name: "Orchestrator" }),
  makeAgent({ id: "explorer", name: "Explorer" }),
  makeAgent({ id: "designer", name: "Designer" }),
  makeAgent({ id: "fixer", name: "Fixer" }),
  makeAgent({ id: "oracle", name: "Oracle" }),
  makeAgent({ id: "validator", name: "Validator" }),
];

interface Route {
  readonly model: ModelInfo;
  readonly ref: ModelRef;
}

function route(model: ModelInfo, variant?: string): Route {
  const ref: ModelRef =
    variant === undefined
      ? { id: model.id, providerID: model.providerID }
      : { id: model.id, providerID: model.providerID, variant };
  return { model, ref };
}

const ROUTES = {
  orchestrator: route(OPUS, "medium"),
  explorer: route(GLM, "max"),
  designer: route(SONNET, "medium"),
  fixer: route(DEEPSEEK, "max"),
  oracle: route(GPT, "medium"),
  validator: route(KIMI),
} as const;

interface Use {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

function split(total: number): Use {
  const cacheRead = Math.round(total * 0.46);
  const input = Math.round(total * 0.33);
  const output = Math.round(total * 0.13);
  const reasoning = Math.round(total * 0.04);
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite: Math.max(0, total - input - output - reasoning - cacheRead),
  };
}

function tokensOf(use: Use): TokenUsageInfo {
  return {
    input: use.input,
    output: use.output,
    reasoning: use.reasoning,
    cache: { read: use.cacheRead, write: use.cacheWrite },
  };
}

function useOf(tokens: TokenUsageInfo): Use {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  };
}

function addUse(use: Use, total: number): void {
  const delta = split(total);
  use.input += delta.input;
  use.output += delta.output;
  use.reasoning += delta.reasoning;
  use.cacheRead += delta.cacheRead;
  use.cacheWrite += delta.cacheWrite;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

let messageSequence = 0;
let toolSequence = 0;
const nextMessage = (prefix: string): string => {
  messageSequence += 1;
  return `msg_demo_${prefix}_${messageSequence}`;
};
const nextTool = (): string => {
  toolSequence += 1;
  return `tool_demo_${toolSequence}`;
};

interface Meta {
  readonly id: string;
  readonly route: Route;
  info: SessionInfo;
  messages: SessionMessageInfo[];
  cost: number;
  use: Use;
  requestUsed: number;
  callCount: number;
}

function metaFor(info: SessionInfo, routeValue: Route, requestUsed: number): Meta {
  return {
    id: info.id,
    route: routeValue,
    info,
    messages: [],
    cost: info.cost,
    use: useOf(info.tokens),
    requestUsed,
    callCount: 0,
  };
}

interface CallPlan {
  readonly messageID: string;
  readonly toolID: string;
  readonly created: number;
  readonly childID: string;
  readonly agent: string;
  readonly description: string;
}

interface DiffFile {
  readonly file: string;
  readonly added: number;
  readonly removed: number;
}

const diffInfo = (files: readonly DiffFile[]): FileDiffInfo[] =>
  files.map((file) => ({
    file: file.file,
    patch: "",
    additions: file.added,
    deletions: file.removed,
    status: "modified",
  }));

function readPart(created: number, filePath: string): SessionMessageAssistantTool {
  return makeTool({
    id: nextTool(),
    name: "read",
    status: "running",
    input: { filePath },
    created,
  });
}

function editPart(created: number, filePath: string): SessionMessageAssistantTool {
  return makeTool({
    id: nextTool(),
    name: "edit",
    status: "running",
    input: { filePath },
    created,
  });
}

function shellPart(created: number, command: string): SessionMessageAssistantTool {
  return makeTool({
    id: nextTool(),
    name: "shell",
    status: "running",
    input: { command },
    created,
  });
}

function searchPart(created: number): SessionMessageAssistantTool {
  return makeTool({
    id: nextTool(),
    name: "grep",
    status: "running",
    input: { pattern: "pricing" },
    created,
  });
}

type AssistantPart = SessionMessageAssistant["content"][number];

function reasoningPart(created: number): AssistantPart {
  return { type: "reasoning", text: "", time: { created } };
}

function textPart(): AssistantPart {
  return { type: "text", text: "" };
}

function subagentPart(
  call: CallPlan,
  status: "running" | "completed",
  linked: boolean,
): SessionMessageAssistantTool {
  return makeTool({
    id: call.toolID,
    name: "subagent",
    status,
    input: { agent: call.agent, description: call.description },
    metadata: linked ? { sessionID: call.childID } : {},
    created: call.created,
  });
}

export interface DemoScenario {
  readonly host: FleetHost;
  start(): void;
  dispose(): void;
}

interface DemoOptions {
  readonly onDone: () => void;
}

export function createDemoScenario(options: DemoOptions): DemoScenario {
  const createdAt = Date.now() - 4_200;
  const rootInfo = makeSession({
    id: DEMO_ROOT,
    agent: "orchestrator",
    title: "Pricing page launch",
    created: createdAt,
    updated: createdAt + 350,
    model: ROUTES.orchestrator.ref,
    cost: 0.24,
    tokens: tokensOf(split(88_000)),
    location: LOCATION,
  });
  rootInfo.projectID = PROJECT;

  const rootPrompt = makeUser(createdAt + 180, "Ship the new pricing page");
  const rootPlan = makeAssistant({
    id: nextMessage("plan"),
    created: createdAt + 350,
    model: ROUTES.orchestrator.ref,
    content: [readPart(createdAt + 350, "src/pricing/pricing-page.tsx")],
    tokens: tokensOf(split(74_000)),
  });
  rootPlan.agent = "orchestrator";

  const root = metaFor(rootInfo, ROUTES.orchestrator, 74_000);
  root.messages.push(rootPrompt, rootPlan);

  const diffs = new Map<string, FileDiffInfo[]>();
  diffs.set(DEMO_ROOT, diffInfo([{ file: "src/app/routes.tsx", added: 4, removed: 1 }]));

  const demoHost = createFakeHost({
    routed: DEMO_ROOT,
    server: SERVER,
    sessions: [{ info: rootInfo, messages: [rootPrompt, rootPlan], status: "running" }],
    agents: [...AGENTS],
    models: [...MODELS],
    providers: [...PROVIDERS],
    diff: (sessionID) => Promise.resolve(diffs.get(sessionID) ?? []),
    prices: () => Promise.resolve({}),
  });

  const metas = new Map<string, Meta>([[root.id, root]]);
  let startedAt = 0;
  let started = false;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const at = (seconds: number): number => startedAt + Math.round(seconds * 1_000);

  function write(meta: Meta): void {
    demoHost.replaceMessages(meta.id, meta.messages);
  }

  function touch(meta: Meta, time: number): void {
    const info: SessionInfo = {
      ...meta.info,
      time: { ...meta.info.time, updated: time },
    };
    meta.info = info;
    demoHost.addSession(info);
  }

  function publish(meta: Meta, time: number): void {
    const info: SessionInfo = {
      ...meta.info,
      cost: round(meta.cost),
      tokens: tokensOf(meta.use),
      time: { ...meta.info.time, updated: time },
    };
    meta.info = info;
    demoHost.addSession(info);
  }

  function openIndex(meta: Meta): number {
    return meta.messages.findLastIndex(
      (message) => message.type === "assistant" && message.time.completed === undefined,
    );
  }

  function setActivity(meta: Meta, time: number, part: AssistantPart): void {
    const index = openIndex(meta);
    const current = meta.messages[index];
    if (current === undefined || current.type !== "assistant") return;
    meta.messages[index] = {
      ...current,
      content: [part],
      tokens: tokensOf(split(meta.requestUsed)),
    };
    write(meta);
    touch(meta, time);
  }

  function openCall(
    meta: Meta,
    time: number,
    part: AssistantPart,
    messageID = nextMessage("assistant"),
  ): SessionMessageAssistant {
    const assistant = makeAssistant({
      id: messageID,
      created: time,
      model: meta.route.ref,
      content: [part],
      tokens: tokensOf(split(meta.requestUsed)),
    });
    assistant.agent = meta.info.agent ?? "orchestrator";
    meta.messages.push(assistant);
    write(meta);
    touch(meta, time);
    return assistant;
  }

  function closeCall(
    meta: Meta,
    time: number,
    spend: number,
    files: readonly string[],
    error?: SessionStructuredError,
  ): void {
    const index = openIndex(meta);
    const current = meta.messages[index];
    if (current === undefined || current.type !== "assistant") return;
    meta.requestUsed += 900 + (meta.callCount % 4) * 220;
    const next: SessionMessageAssistant = {
      ...current,
      time: { ...current.time, completed: time },
      tokens: tokensOf(split(meta.requestUsed)),
      cost: spend,
      snapshot: { files: [...files] },
    };
    if (error !== undefined) next.error = error;
    meta.cost = round(meta.cost + spend);
    addUse(meta.use, 720 + (meta.callCount % 3) * 180);
    meta.callCount += 1;
    meta.messages[index] = next;
    write(meta);
    publish(meta, time);
  }

  function finish(
    meta: Meta,
    time: number,
    spend: number,
    files: readonly string[],
    outcome: "succeeded" | "failed",
    error?: SessionStructuredError,
  ): void {
    closeCall(meta, time, spend, files, error);
    const idleTime = time + 20;
    const idle = makeIdle(outcome, error, idleTime);
    idle.id = nextMessage("idle");
    meta.messages.push(idle);
    write(meta);
    const info: SessionInfo = {
      ...meta.info,
      cost: round(meta.cost),
      tokens: tokensOf(meta.use),
      outcome,
      time: { ...meta.info.time, updated: idleTime, idle: idleTime },
    };
    meta.info = info;
    demoHost.addSession(info);
    demoHost.setStatus(meta.id, "idle");
  }

  function resume(meta: Meta, time: number): void {
    meta.info = {
      ...meta.info,
      time: { ...meta.info.time, updated: time },
    };
    demoHost.addSession(meta.info);
    demoHost.setStatus(meta.id, "running");
  }

  function childMeta(
    id: string,
    agent: string,
    title: string,
    routeValue: Route,
    created: number,
    requestUsed: number,
    cost: number,
  ): Meta {
    const info = makeSession({
      id,
      parentID: DEMO_ROOT,
      agent,
      title,
      created,
      updated: created,
      model: routeValue.ref,
      cost,
      tokens: tokensOf(split(requestUsed)),
      location: LOCATION,
    });
    info.projectID = PROJECT;
    const meta = metaFor(info, routeValue, requestUsed);
    metas.set(id, meta);
    return meta;
  }

  async function addChild(meta: Meta): Promise<void> {
    demoHost.addSession(meta.info);
    demoHost.setStatus(meta.id, "running");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  function startChild(meta: Meta, time: number, promptText: string, part: AssistantPart): void {
    resume(meta, time);
    meta.messages.push(makeUser(time, promptText));
    openCall(meta, time + 20, part);
  }

  function openDelegation(call: CallPlan): void {
    const assistant = makeAssistant({
      id: call.messageID,
      created: call.created,
      model: root.route.ref,
      content: [subagentPart(call, "running", false)],
      tokens: tokensOf(split(root.requestUsed)),
    });
    assistant.agent = "orchestrator";
    root.messages.push(assistant);
    write(root);
    touch(root, call.created);
  }

  function replaceCallPart(call: CallPlan, part: SessionMessageAssistantTool): void {
    const index = root.messages.findIndex((message) => message.id === call.messageID);
    const message = root.messages[index];
    if (message === undefined || message.type !== "assistant") return;
    root.messages[index] = {
      ...message,
      content: message.content.map((entry) =>
        entry.type === "tool" && entry.id === call.toolID ? part : entry,
      ),
    };
    write(root);
  }

  function linkCall(call: CallPlan): void {
    replaceCallPart(call, subagentPart(call, "running", true));
  }

  function completeCall(call: CallPlan, time: number): void {
    const part = subagentPart(call, "completed", true);
    part.time.completed = time;
    replaceCallPart(call, part);
  }

  function bump(meta: Meta, time: number, cost: number, tokenCount: number): void {
    meta.cost = round(meta.cost + cost);
    addUse(meta.use, tokenCount);
    meta.requestUsed += Math.round(tokenCount * 0.55);
    publish(meta, time);
  }

  function plan(): void {
    const rootMeta = root;
    const explorer = childMeta(
      DEMO_EXPLORER,
      "explorer",
      "Pricing data flow (@explorer subagent)",
      ROUTES.explorer,
      at(2.05),
      38_000,
      0.012,
    );
    const designer = childMeta(
      DEMO_DESIGNER,
      "designer",
      "Annual pricing toggle (@designer subagent)",
      ROUTES.designer,
      at(3.4),
      29_000,
      0.01,
    );
    const fixer = childMeta(
      DEMO_FIXER,
      "fixer",
      "Tier rounding (@fixer subagent)",
      ROUTES.fixer,
      at(4.7),
      54_000,
      0.014,
    );
    const oracle = childMeta(
      DEMO_ORACLE,
      "oracle",
      "Migration risk (@oracle subagent)",
      ROUTES.oracle,
      at(6),
      24_000,
      0.009,
    );
    const validator = childMeta(
      DEMO_VALIDATOR,
      "validator",
      "Checkout copy (@validator subagent)",
      ROUTES.validator,
      at(7.3),
      31_000,
      0.011,
    );

    const explorerCall: CallPlan = {
      messageID: nextMessage("explorer_call"),
      toolID: nextTool(),
      created: at(1.9),
      childID: DEMO_EXPLORER,
      agent: "explorer",
      description: "Map how prices reach checkout",
    };
    const designerCall: CallPlan = {
      messageID: nextMessage("designer_call"),
      toolID: nextTool(),
      created: at(3.2),
      childID: DEMO_DESIGNER,
      agent: "designer",
      description: "Design the annual plan toggle",
    };
    const fixerCall: CallPlan = {
      messageID: nextMessage("fixer_call"),
      toolID: nextTool(),
      created: at(4.5),
      childID: DEMO_FIXER,
      agent: "fixer",
      description: "Fix tier rounding and stale totals",
    };
    const oracleCall: CallPlan = {
      messageID: nextMessage("oracle_call"),
      toolID: nextTool(),
      created: at(5.8),
      childID: DEMO_ORACLE,
      agent: "oracle",
      description: "Review the billing migration risk",
    };
    const validatorCall: CallPlan = {
      messageID: nextMessage("validator_call"),
      toolID: nextTool(),
      created: at(7.1),
      childID: DEMO_VALIDATOR,
      agent: "validator",
      description: "Validate copy across every plan",
    };
    const fixerFollowUp: CallPlan = {
      messageID: nextMessage("fixer_follow_up"),
      toolID: nextTool(),
      created: at(18.3),
      childID: DEMO_FIXER,
      agent: "fixer",
      description: "Add a proration regression test",
    };

    const providerError: SessionStructuredError = {
      type: "api_error",
      message: "upstream unavailable",
      status: 502,
    };

    interface Event {
      readonly at: number;
      readonly run: () => void | Promise<void>;
    }
    const events: Event[] = [];
    const later = (seconds: number, run: () => void | Promise<void>): void => {
      events.push({ at: seconds, run });
    };

    // Opening: the orchestrator maps the pricing page before it delegates.
    later(0.9, () => setActivity(rootMeta, at(0.9), reasoningPart(at(0.9))));

    // Explorer: the first delegation establishes the pattern: the card appears,
    // the beam links it, then work starts.
    later(1.9, () => {
      diffs.set(
        DEMO_ROOT,
        diffInfo([
          { file: "src/app/routes.tsx", added: 4, removed: 1 },
          { file: "src/app/pricing-page.tsx", added: 5, removed: 1 },
        ]),
      );
      closeCall(rootMeta, at(1.9), 0.054, ["src/app/pricing-page.tsx"]);
      openDelegation(explorerCall);
    });
    later(2.05, () => addChild(explorer));
    later(2.3, () => linkCall(explorerCall));
    later(2.45, () =>
      startChild(
        explorer,
        at(2.45),
        "Map how prices reach checkout and note every source.",
        readPart(at(2.47), "src/pricing/price-table.tsx"),
      ),
    );
    later(3.35, () => setActivity(explorer, at(3.35), searchPart(at(3.35))));
    later(4.05, () =>
      setActivity(explorer, at(4.05), readPart(at(4.05), "src/pricing/checkout-page.tsx")),
    );
    later(4.15, () => {
      diffs.set(
        DEMO_EXPLORER,
        diffInfo([{ file: "src/pricing/price-index.ts", added: 11, removed: 2 }]),
      );
      closeCall(explorer, at(4.15), 0.022, ["src/pricing/price-index.ts"]);
      openCall(explorer, at(4.2), reasoningPart(at(4.2)));
    });
    later(4.9, () => setActivity(explorer, at(4.9), textPart()));
    later(5.8, () => {
      diffs.set(
        DEMO_EXPLORER,
        diffInfo([
          { file: "src/pricing/price-index.ts", added: 11, removed: 2 },
          { file: "src/pricing/checkout.ts", added: 9, removed: 3 },
        ]),
      );
      closeCall(explorer, at(5.8), 0.024, ["src/pricing/checkout.ts"]);
      openCall(explorer, at(5.85), shellPart(at(5.85), "pnpm vitest run"));
    });
    later(6.9, () => setActivity(explorer, at(6.9), reasoningPart(at(6.9))));
    later(7.5, () => setActivity(explorer, at(7.5), textPart()));
    later(8, () => {
      diffs.set(
        DEMO_EXPLORER,
        diffInfo([
          { file: "src/pricing/price-index.ts", added: 11, removed: 2 },
          { file: "src/pricing/checkout.ts", added: 9, removed: 3 },
          { file: "src/pricing/README.md", added: 14, removed: 1 },
        ]),
      );
      closeCall(explorer, at(8), 0.024, ["src/pricing/README.md"]);
      openCall(explorer, at(8.05), textPart());
    });
    later(8.6, () => finish(explorer, at(8.6), 0.01, [], "succeeded"));
    later(8.7, () => completeCall(explorerCall, at(8.7)));

    // Designer: works, then waits for a permission, then resumes host-side.
    later(3.2, () => {
      closeCall(rootMeta, at(3.2), 0.041, []);
      openDelegation(designerCall);
    });
    later(3.4, () => addChild(designer));
    later(3.65, () => linkCall(designerCall));
    later(3.8, () =>
      startChild(
        designer,
        at(3.8),
        "Design the annual plan toggle in the existing token system.",
        readPart(at(3.82), "src/ui/tokens.css"),
      ),
    );
    later(4.9, () =>
      setActivity(designer, at(4.9), editPart(at(4.9), "src/ui/pricing-toggle.tsx")),
    );
    later(5.6, () => {
      diffs.set(
        DEMO_DESIGNER,
        diffInfo([{ file: "src/ui/pricing-toggle.tsx", added: 16, removed: 3 }]),
      );
      closeCall(designer, at(5.6), 0.02, ["src/ui/pricing-toggle.tsx"]);
      openCall(designer, at(5.65), readPart(at(5.65), "src/ui/design-system.md"));
    });
    later(6.7, () =>
      setActivity(designer, at(6.7), editPart(at(6.7), "src/ui/pricing-toggle.tsx")),
    );
    later(7.4, () => {
      diffs.set(
        DEMO_DESIGNER,
        diffInfo([
          { file: "src/ui/pricing-toggle.tsx", added: 16, removed: 3 },
          { file: "src/ui/pricing-toggle.css", added: 10, removed: 4 },
        ]),
      );
      closeCall(designer, at(7.4), 0.022, ["src/ui/pricing-toggle.css"]);
      openCall(designer, at(7.45), editPart(at(7.45), "src/ui/pricing-toggle.tsx"));
    });
    later(9.4, () => {
      const permission: PermissionRequest = {
        id: "perm_demo_designer",
        sessionID: DEMO_DESIGNER,
        action: "write",
        resources: ["src/ui/pricing-toggle.tsx"],
      };
      demoHost.setPermissions(DEMO_DESIGNER, [permission]);
    });
    later(13.8, () => {
      demoHost.setPermissions(DEMO_DESIGNER, []);
      setActivity(designer, at(13.8), editPart(at(13.8), "src/ui/pricing-toggle.tsx"));
    });
    later(14.6, () => {
      diffs.set(
        DEMO_DESIGNER,
        diffInfo([
          { file: "src/ui/pricing-toggle.tsx", added: 16, removed: 3 },
          { file: "src/ui/pricing-toggle.css", added: 10, removed: 4 },
          { file: "src/ui/pricing-toggle.test.tsx", added: 18, removed: 2 },
        ]),
      );
      closeCall(designer, at(14.6), 0.026, ["src/ui/pricing-toggle.test.tsx"]);
      openCall(designer, at(14.65), shellPart(at(14.65), "pnpm vitest run"));
    });
    later(15.7, () => setActivity(designer, at(15.7), textPart()));
    later(16.9, () => finish(designer, at(16.9), 0.012, [], "succeeded"));
    later(17.1, () => completeCall(designerCall, at(17.1)));

    // Fixer: a full run, a short Finished stay, then a follow-up execution.
    later(4.5, () => {
      closeCall(rootMeta, at(4.5), 0.043, []);
      openDelegation(fixerCall);
    });
    later(4.7, () => addChild(fixer));
    later(4.95, () => linkCall(fixerCall));
    later(5.1, () =>
      startChild(
        fixer,
        at(5.1),
        "Fix the tier rounding and the stale totals it leaves behind.",
        readPart(at(5.12), "src/pricing/summary.ts"),
      ),
    );
    later(6.2, () => setActivity(fixer, at(6.2), editPart(at(6.2), "src/pricing/summary.ts")));
    later(6.7, () => {
      diffs.set(DEMO_FIXER, diffInfo([{ file: "src/pricing/summary.ts", added: 12, removed: 4 }]));
      closeCall(fixer, at(6.7), 0.018, ["src/pricing/summary.ts"]);
      openCall(fixer, at(6.75), shellPart(at(6.75), "pnpm vitest run"));
    });
    later(8, () => setActivity(fixer, at(8), editPart(at(8), "src/pricing/summary.test.ts")));
    later(9.4, () => {
      diffs.set(
        DEMO_FIXER,
        diffInfo([
          { file: "src/pricing/summary.ts", added: 12, removed: 4 },
          { file: "src/pricing/summary.test.ts", added: 19, removed: 6 },
        ]),
      );
      closeCall(fixer, at(9.4), 0.02, ["src/pricing/summary.test.ts"]);
      openCall(fixer, at(9.45), shellPart(at(9.45), "git diff --stat"));
    });
    later(10.6, () => setActivity(fixer, at(10.6), editPart(at(10.6), "src/pricing/proration.ts")));
    later(12, () => {
      diffs.set(
        DEMO_FIXER,
        diffInfo([
          { file: "src/pricing/summary.ts", added: 12, removed: 4 },
          { file: "src/pricing/summary.test.ts", added: 19, removed: 6 },
          { file: "src/pricing/proration.ts", added: 14, removed: 2 },
        ]),
      );
      closeCall(fixer, at(12), 0.022, ["src/pricing/proration.ts"]);
      openCall(fixer, at(12.05), shellPart(at(12.05), "pnpm vitest run"));
    });
    later(13.4, () => {
      closeCall(fixer, at(13.4), 0.016, []);
      openCall(fixer, at(13.45), shellPart(at(13.45), "pnpm biome format"));
    });
    later(14.6, () => {
      closeCall(fixer, at(14.6), 0.014, []);
      openCall(fixer, at(14.65), textPart());
    });
    later(15.8, () => finish(fixer, at(15.8), 0.01, [], "succeeded"));
    later(15.9, () => completeCall(fixerCall, at(15.9)));

    // Oracle: a provider failure, then a second execution later.
    later(5.8, () => {
      closeCall(rootMeta, at(5.8), 0.04, []);
      openDelegation(oracleCall);
    });
    later(6, () => addChild(oracle));
    later(6.25, () => linkCall(oracleCall));
    later(6.4, () =>
      startChild(
        oracle,
        at(6.4),
        "Review the billing migration for risk and edge cases.",
        readPart(at(6.42), "src/billing/migration.sql"),
      ),
    );
    later(7.6, () => setActivity(oracle, at(7.6), searchPart(at(7.6))));
    later(8.8, () => {
      diffs.set(
        DEMO_ORACLE,
        diffInfo([{ file: "src/billing/migration.sql", added: 8, removed: 1 }]),
      );
      closeCall(oracle, at(8.8), 0.018, ["src/billing/migration.sql"]);
      openCall(oracle, at(8.85), readPart(at(8.85), "src/billing/risk-notes.md"));
    });
    later(9.8, () => setActivity(oracle, at(9.8), reasoningPart(at(9.8))));
    later(10.6, () => finish(oracle, at(10.6), 0.02, [], "failed", providerError));
    later(10.7, () => completeCall(oracleCall, at(10.7)));
    later(14.4, () => {
      startChild(
        oracle,
        at(14.4),
        "Review the failing migration once more.",
        readPart(at(14.42), "src/billing/rollback.sql"),
      );
    });
    later(15.5, () => setActivity(oracle, at(15.5), reasoningPart(at(15.5))));
    later(16.3, () => setActivity(oracle, at(16.3), textPart()));
    later(17.4, () => {
      diffs.set(
        DEMO_ORACLE,
        diffInfo([
          { file: "src/billing/migration.sql", added: 8, removed: 1 },
          { file: "src/billing/rollback.sql", added: 6, removed: 2 },
        ]),
      );
      closeCall(oracle, at(17.4), 0.016, ["src/billing/rollback.sql"]);
      openCall(oracle, at(17.45), textPart());
    });
    later(18, () => finish(oracle, at(18), 0.008, [], "succeeded"));

    // Validator: the longest parallel run, finishing after the others.
    later(7.1, () => {
      closeCall(rootMeta, at(7.1), 0.045, []);
      openDelegation(validatorCall);
    });
    later(7.3, () => addChild(validator));
    later(7.55, () => linkCall(validatorCall));
    later(7.7, () =>
      startChild(
        validator,
        at(7.7),
        "Validate the copy across every plan and the checkout summary.",
        readPart(at(7.72), "src/content/pricing-copy.md"),
      ),
    );
    later(9, () => setActivity(validator, at(9), editPart(at(9), "src/content/plans.json")));
    later(9.9, () => {
      diffs.set(
        DEMO_VALIDATOR,
        diffInfo([{ file: "src/content/plans.json", added: 14, removed: 2 }]),
      );
      closeCall(validator, at(9.9), 0.016, ["src/content/plans.json"]);
      openCall(validator, at(9.95), readPart(at(9.95), "src/content/checkout-copy.md"));
    });
    later(11.1, () => setActivity(validator, at(11.1), searchPart(at(11.1))));
    later(11.8, () => {
      diffs.set(
        DEMO_VALIDATOR,
        diffInfo([
          { file: "src/content/plans.json", added: 14, removed: 2 },
          { file: "src/content/checkout-copy.md", added: 9, removed: 4 },
        ]),
      );
      closeCall(validator, at(11.8), 0.018, ["src/content/checkout-copy.md"]);
      openCall(validator, at(11.85), editPart(at(11.85), "src/content/plans.json"));
    });
    later(13, () => {
      diffs.set(
        DEMO_VALIDATOR,
        diffInfo([
          { file: "src/content/plans.json", added: 14, removed: 2 },
          { file: "src/content/checkout-copy.md", added: 9, removed: 4 },
          { file: "src/content/plans.test.ts", added: 6, removed: 1 },
        ]),
      );
      closeCall(validator, at(13), 0.02, ["src/content/plans.test.ts"]);
      openCall(validator, at(13.05), shellPart(at(13.05), "pnpm vitest run"));
    });
    later(14.4, () => {
      closeCall(validator, at(14.4), 0.014, []);
      openCall(validator, at(14.45), shellPart(at(14.45), "git diff --stat"));
    });
    later(15.6, () => {
      closeCall(validator, at(15.6), 0.012, []);
      openCall(validator, at(15.65), editPart(at(15.65), "src/content/checkout-copy.md"));
    });
    later(17, () => {
      diffs.set(
        DEMO_VALIDATOR,
        diffInfo([
          { file: "src/content/plans.json", added: 14, removed: 2 },
          { file: "src/content/checkout-copy.md", added: 9, removed: 4 },
          { file: "src/content/plans.test.ts", added: 6, removed: 1 },
          { file: "src/content/checkout-copy.test.ts", added: 7, removed: 1 },
        ]),
      );
      closeCall(validator, at(17), 0.012, ["src/content/checkout-copy.test.ts"]);
      openCall(validator, at(17.05), textPart());
    });
    later(18.4, () => {
      closeCall(validator, at(18.4), 0.008, []);
      openCall(validator, at(18.45), shellPart(at(18.45), "pnpm vitest run"));
    });
    later(19.6, () => {
      closeCall(validator, at(19.6), 0.01, []);
      openCall(validator, at(19.65), textPart());
    });
    later(20.3, () => finish(validator, at(20.3), 0.008, [], "succeeded"));
    later(20.5, () => completeCall(validatorCall, at(20.5)));

    // The delegation turn ends: the orchestrator writes its response and idles
    // while the children keep working.
    later(8.3, () => {
      closeCall(rootMeta, at(8.3), 0.042, []);
      openCall(rootMeta, at(8.35), textPart());
    });
    later(9, () => finish(rootMeta, at(9), 0.012, [], "succeeded"));

    // The orchestrator reads a result while the designer waits, then idles again.
    later(11.2, () => {
      resume(rootMeta, at(11.2));
      rootMeta.messages.push(
        makeSynthetic({
          id: nextMessage("continue"),
          created: at(11.2),
          text: "Continue after the delegated result.",
        }),
      );
      openCall(rootMeta, at(11.3), readPart(at(11.3), "src/pricing/explorer-notes.md"));
    });
    later(12.2, () => {
      diffs.set(
        DEMO_ROOT,
        diffInfo([
          { file: "src/app/routes.tsx", added: 4, removed: 1 },
          { file: "src/app/pricing-page.tsx", added: 8, removed: 2 },
        ]),
      );
      closeCall(rootMeta, at(12.2), 0.03, ["src/app/pricing-page.tsx"]);
      openCall(rootMeta, at(12.25), textPart());
    });
    later(13.1, () => finish(rootMeta, at(13.1), 0.012, [], "succeeded"));

    // The follow-up: the orchestrator wakes, asks the Fixer for one more test.
    later(17.4, () => {
      resume(rootMeta, at(17.4));
      rootMeta.messages.push(
        makeSynthetic({
          id: nextMessage("continue"),
          created: at(17.4),
          text: "Continue after the delegated result.",
        }),
      );
      openCall(rootMeta, at(17.5), readPart(at(17.5), "src/ui/designer-notes.md"));
    });
    later(18.2, () => {
      diffs.set(
        DEMO_ROOT,
        diffInfo([
          { file: "src/app/routes.tsx", added: 4, removed: 1 },
          { file: "src/app/pricing-page.tsx", added: 8, removed: 2 },
          { file: "src/app/pricing-page.test.tsx", added: 6, removed: 1 },
        ]),
      );
      closeCall(rootMeta, at(18.2), 0.028, ["src/app/pricing-page.test.tsx"]);
    });
    later(18.3, () => openDelegation(fixerFollowUp));
    later(18.5, () => {
      resume(fixer, at(18.5));
      fixer.messages.push(makeUser(at(18.5), "Add a proration regression test and run the suite."));
    });
    later(18.9, () => linkCall(fixerFollowUp));
    later(19, () => {
      openCall(fixer, at(19), editPart(at(19), "src/pricing/proration.test.ts"));
    });
    later(19.6, () => {
      closeCall(rootMeta, at(19.6), 0.02, []);
      openCall(rootMeta, at(19.65), textPart());
    });
    later(20.2, () => finish(rootMeta, at(20.2), 0.012, [], "succeeded"));
    later(20.8, () => setActivity(fixer, at(20.8), shellPart(at(20.8), "pnpm vitest run")));
    later(21.6, () => setActivity(fixer, at(21.6), textPart()));
    later(22.3, () => {
      diffs.set(
        DEMO_FIXER,
        diffInfo([
          { file: "src/pricing/summary.ts", added: 12, removed: 4 },
          { file: "src/pricing/summary.test.ts", added: 19, removed: 6 },
          { file: "src/pricing/proration.ts", added: 14, removed: 2 },
          { file: "src/pricing/proration.test.ts", added: 11, removed: 1 },
        ]),
      );
      finish(fixer, at(22.3), 0.014, ["src/pricing/proration.test.ts"], "succeeded");
    });
    later(22.4, () => completeCall(fixerFollowUp, at(22.4)));

    // Final verification: everything else is finished, the orchestrator closes.
    later(23.3, () => {
      resume(rootMeta, at(23.3));
      rootMeta.messages.push(
        makeSynthetic({
          id: nextMessage("continue"),
          created: at(23.3),
          text: "Run the final verification.",
        }),
      );
      openCall(rootMeta, at(23.4), shellPart(at(23.4), "pnpm vitest run"));
    });
    later(24, () => {
      diffs.set(
        DEMO_ROOT,
        diffInfo([
          { file: "src/app/routes.tsx", added: 4, removed: 1 },
          { file: "src/app/pricing-page.tsx", added: 8, removed: 2 },
          { file: "src/app/pricing-page.test.tsx", added: 6, removed: 1 },
          { file: "src/app/verify.ts", added: 3, removed: 0 },
        ]),
      );
      closeCall(rootMeta, at(24), 0.038, ["src/app/verify.ts"]);
      openCall(rootMeta, at(24.05), shellPart(at(24.05), "git diff --stat"));
    });
    later(24.8, () => {
      diffs.set(
        DEMO_ROOT,
        diffInfo([
          { file: "src/app/routes.tsx", added: 4, removed: 1 },
          { file: "src/app/pricing-page.tsx", added: 8, removed: 2 },
          { file: "src/app/pricing-page.test.tsx", added: 6, removed: 1 },
          { file: "src/app/verify.ts", added: 3, removed: 0 },
          { file: "src/app/verify.test.ts", added: 2, removed: 1 },
        ]),
      );
      closeCall(rootMeta, at(24.8), 0.034, ["src/app/verify.test.ts"]);
      openCall(rootMeta, at(24.85), textPart());
    });
    later(26.9, () => finish(rootMeta, at(26.9), 0.012, [], "succeeded"));

    // Metric activity: frequent enough that rolling digits are always visible.
    interface BumpWindow {
      readonly meta: Meta;
      readonly from: number;
      readonly to: number;
      readonly step: number;
      readonly phase: number;
      readonly cost: number;
      readonly tokens: number;
    }
    const windows: readonly BumpWindow[] = [
      { meta: rootMeta, from: 0.2, to: 8.9, step: 1.05, phase: 0.1, cost: 0.046, tokens: 780 },
      { meta: rootMeta, from: 11.25, to: 13.2, step: 1.05, phase: 0.35, cost: 0.038, tokens: 640 },
      { meta: rootMeta, from: 17.45, to: 20.2, step: 1.05, phase: 0.55, cost: 0.04, tokens: 660 },
      { meta: rootMeta, from: 23.35, to: 26.9, step: 1.05, phase: 0.15, cost: 0.044, tokens: 720 },
      { meta: explorer, from: 2.6, to: 8.55, step: 1, phase: 0.25, cost: 0.024, tokens: 1_260 },
      { meta: designer, from: 3.9, to: 9.35, step: 1.05, phase: 0.5, cost: 0.02, tokens: 1_100 },
      { meta: designer, from: 13.9, to: 16.85, step: 1.05, phase: 0.8, cost: 0.022, tokens: 1_180 },
      { meta: fixer, from: 5.2, to: 15.75, step: 0.95, phase: 0.75, cost: 0.017, tokens: 980 },
      { meta: fixer, from: 19.1, to: 22.25, step: 0.95, phase: 0.4, cost: 0.018, tokens: 1_040 },
      { meta: oracle, from: 6.5, to: 10.45, step: 1.1, phase: 0.15, cost: 0.021, tokens: 880 },
      { meta: oracle, from: 14.55, to: 17.95, step: 1.1, phase: 0.65, cost: 0.022, tokens: 920 },
      { meta: validator, from: 7.8, to: 20.25, step: 1.15, phase: 0.6, cost: 0.014, tokens: 760 },
    ];
    for (const window of windows) {
      let stepIndex = 0;
      for (let time = window.from + window.phase; time <= window.to; time += window.step) {
        const cost = window.cost + (stepIndex % 3) * 0.003;
        const tokenCount = window.tokens + (stepIndex % 4) * 90;
        const meta = window.meta;
        later(time, () => bump(meta, at(time), cost, tokenCount));
        stepIndex += 1;
      }
    }

    later(DEMO_DURATION, () => {
      options.onDone();
    });

    events.sort((a, b) => a.at - b.at);
    for (const event of events) {
      const delay = Math.max(0, at(event.at) - Date.now());
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (disposed) return;
        // A failed step must surface as a page error so the recorder stops
        // instead of committing a half-told story.
        void Promise.resolve(event.run());
      }, delay);
      timers.add(timer);
    }
  }

  return {
    host: demoHost.host,
    start: () => {
      if (started || disposed) return;
      started = true;
      startedAt = Date.now();
      plan();
    },
    dispose: () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
