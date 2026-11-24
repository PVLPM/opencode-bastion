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

function subagentCall(id: string, childID: string, description: string) {
  return makeTool({
    id,
    name: "subagent",
    input: { agent: "designer", description, prompt: `${description} prompt` },
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
});

describe("createFleetSource beams", () => {
  it("emits no beam on load, one out on a new delegation and one in when the child idles", async () => {
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

      fake.setStatus("ses-child", "idle");
      await flush();
      const inward = source.beams().filter((beam) => beam.direction === "in");
      expect(inward).toHaveLength(1);
      expect(inward[0]?.sessionID).toBe("ses-child");
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
        { info: makeSession({ id: "ses-other" }) },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.canOpen("ses-root")).toBe(true);
      expect(source.canOpen("ses-child")).toBe(true);
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
});
