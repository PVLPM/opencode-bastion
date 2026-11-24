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
import { makeAssistant, makeSession, makeTokens, makeTool } from "../fixtures";
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

function messageWithSnapshot(completed: number): SessionMessageInfo {
  const message = makeAssistant({ created: completed, completed });
  message.snapshot = { files: ["src/a.ts"] };
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
  it("refetches only when the latest snapshot-bearing assistant changes", async () => {
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
      expect(fake.calls.diffCalls).toHaveLength(1);

      additions = 5;
      fake.addMessage("ses-root", messageWithSnapshot(200));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(2);
      expect(source.fleet()?.root.lines).toStrictEqual({ added: 5, removed: 1 });
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
