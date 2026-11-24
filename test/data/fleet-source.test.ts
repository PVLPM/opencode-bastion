import type { SessionMessageInfo } from "@opencode/client/promise";
import type { MountedSession } from "@opencode/plugin/gui";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import {
  createFleetSource,
  type FleetHost,
  type FleetSession,
  type FleetSource,
} from "../../src/data/fleet-source";
import type { PriceTable } from "../../src/model/pricing";
import {
  makeAgent,
  makeAssistant,
  makeIdle,
  makeModel,
  makeSession,
  makeTokens,
  makeTool,
  makeUser,
} from "../fixtures";
import { createFakeHost } from "./fake-host";

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function withSource(host: FleetHost, run: (source: FleetSource) => Promise<void>): Promise<void> {
  const mounted = createRoot((dispose) => ({ source: createFleetSource(host), dispose }));
  return run(mounted.source).finally(mounted.dispose);
}

function subagentCall(
  id: string,
  childID: string,
  description: string,
  status: "running" | "completed" | "error" = "running",
) {
  return makeTool({
    id,
    name: "subagent",
    status,
    input: { agent: "designer", description },
    metadata: { sessionID: childID },
  });
}

function messageWithSnapshot(
  completed: number,
  files: readonly string[] = ["src/a.ts"],
): SessionMessageInfo {
  const message = makeAssistant({ created: completed, completed });
  message.snapshot = { files: [...files] };
  return message;
}

describe("createFleetSource host compatibility", () => {
  type HostSessionCompatible = MountedSession extends FleetSession ? true : false;
  const hostSessionCompatible: HostSessionCompatible = true;

  it("accepts the real mounted session shape", () => {
    expect(hostSessionCompatible).toBe(true);
  });
});

describe("createFleetSource anchoring", () => {
  it("re-anchors on session switch and drops beams", async () => {
    const fake = createFakeHost({
      routed: "ses-a",
      sessions: [
        {
          info: makeSession({ id: "ses-a" }),
          messages: [makeAssistant({ content: [subagentCall("tool-a0", "ses-a1", "A first")] })],
        },
        { info: makeSession({ id: "ses-a1", parentID: "ses-a" }), status: "running" },
        {
          info: makeSession({ id: "ses-b" }),
          messages: [makeAssistant({ content: [subagentCall("tool-b0", "ses-b1", "B first")] })],
        },
        { info: makeSession({ id: "ses-b1", parentID: "ses-b" }), status: "running" },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.sessionID).toBe("ses-a");
      expect(source.fleet()?.active.map((agent) => agent.sessionID)).toStrictEqual(["ses-a1"]);

      fake.addMessage(
        "ses-a",
        makeAssistant({ content: [subagentCall("tool-a1", "ses-a1", "A second")] }),
      );
      await flush();
      expect(source.beams()).toHaveLength(1);
      expect(source.beams()[0]).toMatchObject({ direction: "out", sessionID: "ses-a1" });

      fake.setRouted("ses-b");
      await flush();
      expect(source.fleet()?.root.sessionID).toBe("ses-b");
      expect(source.fleet()?.active.map((agent) => agent.sessionID)).toStrictEqual(["ses-b1"]);
      expect(source.beams()).toStrictEqual([]);
    });
  });

  it("re-syncs a family after leaving and re-entering it", async () => {
    const fake = createFakeHost({
      routed: "ses-a",
      sessions: [
        { info: makeSession({ id: "ses-a" }) },
        { info: makeSession({ id: "ses-a1", parentID: "ses-a" }) },
        { info: makeSession({ id: "ses-b" }) },
        { info: makeSession({ id: "ses-b1", parentID: "ses-b" }) },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      const before = fake.calls.messageSyncs.filter((id) => id === "ses-a").length;

      fake.setRouted("ses-b");
      await flush();
      fake.setRouted("ses-a");
      await flush();

      expect(source.fleet()?.root.sessionID).toBe("ses-a");
      expect(fake.calls.messageSyncs.filter((id) => id === "ses-a").length).toBe(before + 1);
      expect(fake.calls.messageSyncs.filter((id) => id === "ses-a1").length).toBeGreaterThan(0);
    });
  });
});

describe("createFleetSource cold sessions", () => {
  it("keeps the fleet empty but still syncs the routed session and root before info loads", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), loaded: false }],
      sessionGate: gate,
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()).toBeUndefined();
      expect(fake.calls.sessionSyncs.map((call) => call.id)).toStrictEqual([
        "ses-root",
        "ses-root",
      ]);
      expect(fake.calls.sessionSyncs.some((call) => call.children)).toBe(true);

      release?.();
      await flush();
      await flush();
      expect(source.fleet()?.root.sessionID).toBe("ses-root");
    });
  });

  it("never shows or syncs a deleted root", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), deleted: true }],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()).toBeUndefined();
      expect(source.canOpen("ses-root")).toBe(false);
      expect(fake.calls.sessionSyncs).toStrictEqual([]);
    });
  });
});

describe("createFleetSource syncing", () => {
  it("syncing a routed child syncs the child's own info", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }) },
        { info: makeSession({ id: "ses-child", parentID: "ses-root" }) },
      ],
    });

    await withSource(fake.host, async () => {
      await flush();
      fake.setRouted("ses-child");
      await flush();

      expect(fake.calls.sessionSyncs).toContainEqual({ id: "ses-child", children: false });
    });
  });

  it("ignores a sync completion from an activation before A→B→A", async () => {
    const fake = createFakeHost({
      routed: "ses-a",
      sessions: [{ info: makeSession({ id: "ses-a" }) }, { info: makeSession({ id: "ses-b" }) }],
    });
    const releaseFirst = fake.holdNextMessageSync("ses-a");

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.messageSyncs).toContain("ses-a");

      fake.setRouted("ses-b");
      await flush();
      const releaseReentry = fake.holdNextMessageSync("ses-a");
      fake.setRouted("ses-a");
      await flush();
      expect(fake.calls.messageSyncs.filter((id) => id === "ses-a")).toHaveLength(2);

      releaseFirst();
      await flush();
      fake.addMessage(
        "ses-a",
        makeAssistant({ content: [subagentCall("tool-live", "ses-child", "Live")] }),
      );
      await flush();
      expect(source.beams()).toStrictEqual([]);

      releaseReentry();
      await flush();
      await flush();
      fake.addMessage(
        "ses-a",
        makeAssistant({ content: [subagentCall("tool-next", "ses-child", "Next")] }),
      );
      await flush();

      expect(source.beams().filter((beam) => beam.direction === "out")).toHaveLength(1);
    });
  });

  it("re-syncs everything after a reconnect", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }) }],
    });

    await withSource(fake.host, async () => {
      await flush();
      const messageSyncs = fake.calls.messageSyncs.filter((id) => id === "ses-root").length;
      const childrenSyncs = fake.calls.sessionSyncs.filter((call) => call.children).length;
      expect(messageSyncs).toBeGreaterThan(0);
      expect(childrenSyncs).toBeGreaterThan(0);

      fake.setConnected(false);
      await flush();
      fake.setConnected(true);
      await flush();

      expect(fake.calls.messageSyncs.filter((id) => id === "ses-root").length).toBe(
        messageSyncs + 1,
      );
      expect(fake.calls.sessionSyncs.filter((call) => call.children).length).toBe(
        childrenSyncs + 1,
      );
    });
  });

  it("resolves each member's model limit from its own location", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", location: { directory: "C:\\root" } }),
          messages: [
            makeAssistant({
              tokens: makeTokens({ input: 10 }),
              model: { id: "m", providerID: "p" },
            }),
          ],
        },
        {
          info: makeSession({
            id: "ses-child",
            parentID: "ses-root",
            created: 2,
            location: { directory: "C:\\child" },
          }),
          status: "running",
          messages: [
            makeAssistant({
              tokens: makeTokens({ input: 20 }),
              model: { id: "m", providerID: "p" },
            }),
          ],
        },
      ],
      modelsByLocation: {
        "C:\\root": [makeModel({ providerID: "p", modelID: "m", contextLimit: 1_000 })],
        "C:\\child": [makeModel({ providerID: "p", modelID: "m", contextLimit: 200 })],
      },
    });

    await withSource(fake.host, async (source) => {
      await flush();

      expect(source.fleet()?.root.context).toStrictEqual({ used: 10, limit: 1_000 });
      expect(source.fleet()?.active[0]?.context).toStrictEqual({ used: 20, limit: 200 });
      expect([...new Set(fake.calls.modelSyncs)]).toHaveLength(2);
      expect([...new Set(fake.calls.agentSyncs)]).toHaveLength(2);
    });
  });

  it("syncs a child that appears later", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }) }],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      fake.addSession(makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }));
      fake.setStatus("ses-child", "running");
      await flush();

      expect(fake.calls.messageSyncs).toContain("ses-child");
      expect(fake.calls.permissionSyncs).toContain("ses-child");
      expect(fake.calls.formSyncs).toContain("ses-child");
      expect(source.fleet()?.active.map((agent) => agent.sessionID)).toStrictEqual(["ses-child"]);
    });
  });

  it("derives a new child before its permissions are synced", async () => {
    // Regression: the store returns undefined permissions until synced; reading
    // `.length` threw inside a plugin-root effect and the host failed the plugin.
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }) }],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      fake.addSession(makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }));
      fake.setStatus("ses-child", "running");

      expect(source.fleet()?.active.map((agent) => agent.status)).toStrictEqual(["running"]);
    });
  });

  it("retries a failed sync on the next store change", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }) }],
      failMessageSyncOnce: ["ses-root"],
    });

    await withSource(fake.host, async () => {
      await flush();
      expect(fake.calls.messageSyncs.filter((id) => id === "ses-root")).toHaveLength(1);

      fake.addSession(makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }));
      await flush();

      expect(fake.calls.messageSyncs.filter((id) => id === "ses-root").length).toBeGreaterThan(1);
    });
  });
});

describe("createFleetSource beams", () => {
  it("beams only from live delegation transitions after hydration", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ content: [subagentCall("tool-1", "ses-child", "First")] })],
        },
        { info: makeSession({ id: "ses-child", parentID: "ses-root" }), status: "running" },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.beams()).toStrictEqual([]);

      fake.addMessage(
        "ses-root",
        makeAssistant({ content: [subagentCall("tool-2", "ses-child", "Second")] }),
      );
      await flush();
      const outward = source.beams().filter((beam) => beam.direction === "out");
      expect(outward).toHaveLength(1);
      expect(outward[0]?.sessionID).toBe("ses-child");

      fake.addMessage(
        "ses-root",
        makeAssistant({ content: [subagentCall("tool-2", "ses-child", "Second", "completed")] }),
      );
      await flush();
      const inward = source.beams().filter((beam) => beam.direction === "in");
      expect(inward).toHaveLength(1);
      expect(inward[0]?.sessionID).toBe("ses-child");
    });
  });

  it("beams when a delegation hidden at hydration resolves its child id", async () => {
    const hidden = makeTool({
      id: "tool-1",
      name: "subagent",
      status: "streaming",
      text: "{}",
    });
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ content: [hidden] })],
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.beams()).toStrictEqual([]);

      fake.addMessages("ses-root", [
        makeAssistant({ content: [subagentCall("tool-1", "ses-child", "Live")] }),
      ]);
      await flush();

      const outward = source.beams().filter((beam) => beam.direction === "out");
      expect(outward).toHaveLength(1);
      expect(outward[0]?.sessionID).toBe("ses-child");
    });
  });

  it("shows no beam while a cold transcript is still hydrating", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }) }],
      messageGate: gate,
      messagesOnSync: {
        "ses-root": [makeAssistant({ content: [subagentCall("tool-1", "ses-child", "Historic")] })],
      },
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()).toBeDefined();
      expect(source.beams()).toStrictEqual([]);

      release?.();
      await flush();
      await flush();
      expect(source.beams()).toStrictEqual([]);
    });
  });

  it("shows no beam when a stale running child merely becomes idle after a reconnect", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ content: [subagentCall("tool-1", "ses-child", "First")] })],
        },
        {
          info: makeSession({ id: "ses-child", parentID: "ses-root" }),
          status: "running",
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      fake.setConnected(false);
      await flush();
      fake.setConnected(true);
      await flush();

      fake.setStatus("ses-child", "idle");
      await flush();

      expect(source.beams()).toStrictEqual([]);
    });
  });
});

describe("createFleetSource navigation", () => {
  it("only opens the root and known children", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }) },
        { info: makeSession({ id: "ses-child", parentID: "ses-root" }) },
        { info: makeSession({ id: "ses-gone", parentID: "ses-root" }), deleted: true },
        { info: makeSession({ id: "ses-other" }) },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.canOpen("ses-root")).toBe(true);
      expect(source.canOpen("ses-child")).toBe(true);
      expect(source.canOpen("ses-gone")).toBe(false);
      expect(source.canOpen("ses-other")).toBe(false);
      expect(source.canOpen("ses-ghost")).toBe(false);

      source.open("ses-child");
      source.open("ses-ghost");
      expect(fake.calls.openTabs).toStrictEqual([{ server: "server", id: "ses-child" }]);
    });
  });
});

describe("createFleetSource lines", () => {
  it("refetches when the latest completed assistant changes", async () => {
    let additions = 2;
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: [messageWithSnapshot(100)] }],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions, deletions: 1, status: "modified" },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 2, removed: 1 });

      fake.addMessage("ses-root", makeAssistant({ created: 150, completed: 150 }));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(2);

      additions = 5;
      fake.addMessage("ses-root", messageWithSnapshot(200));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(3);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 5, removed: 1 });
    });
  });

  it("requests the diff when the completed assistant has no snapshot files", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ created: 100, completed: 100 })],
        },
      ],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions: 4, deletions: 2, status: "modified" },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 4, removed: 2 });
    });
  });

  it("skips the diff when the completed assistant explicitly lists no files", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [messageWithSnapshot(100, [])],
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual([]);
      expect(source.fleet()?.root.lines).toBeUndefined();
    });
  });

  it("keeps the last known stats when a later turn reports no changed files", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [messageWithSnapshot(100)],
        },
      ],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions: 3, deletions: 2, status: "modified" },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 3, removed: 2 });

      fake.addMessage("ses-root", messageWithSnapshot(200, []));
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 3, removed: 2 });
    });
  });

  it("does not refetch when the latest completed time is unchanged", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ created: 100, completed: 100 })],
        },
      ],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions: 1, deletions: 1, status: "modified" },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(1);

      fake.addMessage("ses-root", makeAssistant({ created: 200 }));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(1);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 1, removed: 1 });
    });
  });

  it("hides the counter when the diff request fails", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [messageWithSnapshot(100)],
        },
      ],
      diff: () => Promise.reject(new Error("diff failed")),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toBeUndefined();
    });
  });
});

describe("createFleetSource lanes", () => {
  it("derives lanes and the capitalized agent from the same store reads as the fleet", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      agents: [makeAgent({ id: "fixer", name: "code-fixer" })],
      sessions: [
        {
          info: makeSession({ id: "ses-root", agent: "fixer", title: "Root task", created: 10 }),
          messages: [
            makeUser(20, "First prompt"),
            makeAssistant({ id: "root-a1", created: 30 }),
            makeIdle("succeeded", undefined, 40),
          ],
        },
        {
          info: makeSession({
            id: "ses-child",
            parentID: "ses-root",
            agent: "fixer",
            created: 5,
          }),
          status: "running",
          messages: [makeAssistant({ id: "child-a1", created: 50 })],
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();

      expect(source.fleet()?.root.agent).toBe("Code-fixer");
      expect(source.lanes()?.lanes[0]?.agent).toBe("Code-fixer");
      expect(source.lanes()?.lanes.map((lane) => lane.sessionID)).toStrictEqual([
        "ses-root",
        "ses-child",
      ]);
      expect(source.lanes()?.lanes[0]?.blocks[0]).toMatchObject({
        start: 30,
        end: 40,
        status: "done",
        label: "First prompt",
      });
      expect(source.lanes()?.lanes[1]?.blocks[0]).toMatchObject({
        start: 50,
        end: undefined,
        status: "running",
      });
      expect(source.lanes()?.from).toBe(30);
    });
  });
});

describe("createFleetSource clock", () => {
  it("ticks only while a member is active", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeHost({
        routed: "ses-root",
        sessions: [{ info: makeSession({ id: "ses-root" }) }],
      });

      await withSource(fake.host, async (source) => {
        await vi.advanceTimersByTimeAsync(0);
        const idleNow = source.now();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(source.now()).toBe(idleNow);

        fake.setStatus("ses-root", "running");
        const runningNow = source.now();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(source.now()).toBeGreaterThan(runningNow);

        fake.setStatus("ses-root", "idle");
        const stoppedNow = source.now();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(source.now()).toBe(stoppedNow);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the clock while the panel is hidden and seeds it when visible again", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeHost({
        routed: "ses-root",
        visible: false,
        sessions: [{ info: makeSession({ id: "ses-root" }), status: "running" }],
      });

      await withSource(fake.host, async (source) => {
        await vi.advanceTimersByTimeAsync(0);
        const hiddenNow = source.now();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(source.now()).toBe(hiddenNow);

        fake.setVisible(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(source.now()).toBe(Date.now());
        expect(source.now()).toBeGreaterThan(hiddenNow);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(source.now()).toBeGreaterThan(hiddenNow + 5_000);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createFleetSource prices", () => {
  it("fetches prices once, lazily, for an unpriced session", async () => {
    let release: ((table: PriceTable) => void) | undefined;
    const prices = new Promise<PriceTable>((resolve) => {
      release = resolve;
    });
    const table = {
      p: { models: { m: { cost: { input: 3, output: 15 } } } },
    } satisfies PriceTable;
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({
            id: "ses-root",
            tokens: makeTokens({ input: 1_000_000 }),
            model: { id: "m", providerID: "p" },
          }),
        },
      ],
      prices: () => prices,
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.priceFetches()).toBe(1);
      expect(source.fleet()?.root.cost).toBeUndefined();

      release?.(table);
      await flush();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 3, estimated: true });

      fake.addSession(
        makeSession({
          id: "ses-child",
          parentID: "ses-root",
          created: 2,
          tokens: makeTokens({ input: 1_000 }),
          model: { id: "m", providerID: "p" },
        }),
      );
      fake.setStatus("ses-child", "running");
      await flush();
      expect(fake.calls.priceFetches()).toBe(1);
    });
  });

  it("does not fetch prices when every cost is reported", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({
            id: "ses-root",
            cost: 0.5,
            tokens: makeTokens({ input: 1_000 }),
            model: { id: "m", providerID: "p" },
          }),
        },
      ],
      prices: () => Promise.resolve({}),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.priceFetches()).toBe(0);
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 0.5, estimated: false });
    });
  });

  it("estimates a claude-agent model at Anthropic API list price", async () => {
    const table = {
      anthropic: {
        models: { "claude-sonnet-4-5": { cost: { input: 3, output: 15 } } },
      },
      openrouter: {
        models: { "claude-sonnet-4-5": { cost: { input: 4, output: 20 } } },
      },
    } satisfies PriceTable;
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({
            id: "ses-root",
            tokens: makeTokens({ input: 1_000_000, output: 1_000_000 }),
            model: { id: "claude-sonnet-4-5", providerID: "claude-agent" },
          }),
        },
      ],
      prices: () => Promise.resolve(table),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 18, estimated: true });
    });
  });

  it("adds only the grandchild's estimate to the reported family total", async () => {
    const table = {
      p: { models: { m: { cost: { input: 50, output: 0 } } } },
    } satisfies PriceTable;
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root", cost: 0.4 }) },
        { info: makeSession({ id: "ses-child", parentID: "ses-root", cost: 0.3, created: 2 }) },
        {
          info: makeSession({
            id: "ses-grandchild",
            parentID: "ses-child",
            created: 3,
            tokens: makeTokens({ input: 1_000 }),
            model: { id: "m", providerID: "p" },
          }),
        },
      ],
      prices: () => Promise.resolve(table),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      expect(source.fleet()?.totalCost).toStrictEqual({ usd: 0.75, estimated: true });
      expect(source.fleet()?.active).toStrictEqual([]);
    });
  });
});
