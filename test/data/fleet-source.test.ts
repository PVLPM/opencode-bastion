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
  makeProvider,
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

function historyMessages(count: number, start = 0): SessionMessageInfo[] {
  return Array.from({ length: count }, (_, index) =>
    makeAssistant({ id: `msg-${start + index}`, created: start + index }),
  );
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

  it("loads each location's provider catalog on sync and labels models with its name", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({
            id: "ses-root",
            location: { directory: "C:\\root" },
            model: { id: "m", providerID: "p" },
          }),
        },
        {
          info: makeSession({
            id: "ses-child",
            parentID: "ses-root",
            created: 2,
            location: { directory: "C:\\child" },
            model: { id: "m", providerID: "p" },
          }),
          status: "running",
        },
      ],
      providersOnSync: {
        "C:\\root": [makeProvider({ id: "p", name: "Root Provider" })],
        "C:\\child": [makeProvider({ id: "p", name: "Child Provider" })],
      },
    });

    await withSource(fake.host, async (source) => {
      await flush();

      expect(source.fleet()?.root.model?.providerName).toBe("Root Provider");
      expect(source.fleet()?.active[0]?.model?.providerName).toBe("Child Provider");
      expect(fake.calls.providerSyncs).toStrictEqual(["C:\\root", "C:\\child"]);
    });
  });

  it("falls back to the provider id when the catalog has no entry", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({
            id: "ses-root",
            model: { id: "m", providerID: "missing-provider" },
          }),
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();

      expect(source.fleet()?.root.model?.providerName).toBe("missing-provider");
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

describe("createFleetSource history", () => {
  it("makes no older-page request for a short transcript", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [makeAssistant({ id: "msg-only", created: 1 })],
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.sessionID).toBe("ses-root");
      expect(fake.calls.messageSyncs).toStrictEqual(["ses-root"]);
      expect(fake.calls.messageLoadMores).toStrictEqual([]);
    });
  });

  it("loads every older page of a long transcript", async () => {
    const all = historyMessages(450);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: window }],
      messagesOnSync: { "ses-root": window },
      olderMessages: { "ses-root": all.slice(0, -50) },
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      const list = fake.data.session.message.list("ses-root");
      expect(list).toHaveLength(450);
      expect(list[0]?.id).toBe("msg-0");
      expect(list.at(-1)?.id).toBe("msg-449");
      expect(fake.calls.messageSyncs).toStrictEqual(["ses-root"]);
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-root", all: true }]);
      expect(source.fleet()?.root.sessionID).toBe("ses-root");
    });
  });

  it("runs one history load at a time across the family", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const older = all.slice(0, -50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }), messages: window },
        {
          info: makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }),
          messages: window,
        },
        {
          info: makeSession({ id: "ses-grandchild", parentID: "ses-child", created: 3 }),
          messages: window,
        },
      ],
      messagesOnSync: { "ses-root": window, "ses-child": window, "ses-grandchild": window },
      olderMessages: { "ses-root": older, "ses-child": older, "ses-grandchild": older },
    });
    const releaseRoot = fake.holdNextLoadMore("ses-root");
    const releaseChild = fake.holdNextLoadMore("ses-child");
    const releaseGrandchild = fake.holdNextLoadMore("ses-grandchild");

    await withSource(fake.host, async () => {
      await flush();
      expect(fake.calls.messageLoadMores.map((call) => call.id)).toStrictEqual(["ses-root"]);

      releaseRoot();
      await flush();
      await flush();
      expect(fake.calls.messageLoadMores.map((call) => call.id)).toStrictEqual([
        "ses-root",
        "ses-child",
      ]);

      releaseChild();
      await flush();
      await flush();
      expect(fake.calls.messageLoadMores.map((call) => call.id)).toStrictEqual([
        "ses-root",
        "ses-child",
        "ses-grandchild",
      ]);

      releaseGrandchild();
      await flush();
      await flush();
      expect(fake.data.session.message.list("ses-root")).toHaveLength(400);
      expect(fake.data.session.message.list("ses-child")).toHaveLength(400);
      expect(fake.data.session.message.list("ses-grandchild")).toHaveLength(400);
    });
  });

  it("hydrates descendants that only feed cost and its tariffs", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }) },
        { info: makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }) },
        {
          info: makeSession({
            id: "ses-grandchild",
            parentID: "ses-child",
            created: 3,
            location: { directory: "C:\\grand" },
          }),
        },
      ],
      messagesOnSync: {
        "ses-grandchild": [makeAssistant({ id: "msg-new", created: 2 })],
      },
      olderMessages: {
        "ses-grandchild": [makeAssistant({ id: "msg-old", created: 1 })],
      },
    });

    await withSource(fake.host, async () => {
      await flush();
      await flush();
      expect(fake.calls.messageSyncs).toContain("ses-grandchild");
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-grandchild", all: true }]);
      expect(fake.data.session.message.list("ses-grandchild")).toHaveLength(2);
      expect(fake.calls.modelSyncs).toContain("C:\\grand");
      expect(fake.calls.agentSyncs).toContain("C:\\grand");
      expect(fake.calls.permissionSyncs).not.toContain("ses-grandchild");
      expect(fake.calls.formSyncs).not.toContain("ses-grandchild");
    });
  });

  it("aborts a load on a route change and refills on return", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-a",
      sessions: [
        { info: makeSession({ id: "ses-a" }), messages: window },
        { info: makeSession({ id: "ses-b" }) },
      ],
      messagesOnSync: { "ses-a": window },
      olderMessages: { "ses-a": all.slice(0, -50) },
    });
    const releaseFirst = fake.holdNextLoadMore("ses-a");

    await withSource(fake.host, async () => {
      await flush();
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-a", all: true }]);

      fake.setRouted("ses-b");
      await flush();
      releaseFirst();
      await flush();
      expect(fake.data.session.message.list("ses-a")).toHaveLength(50);

      const releaseSecond = fake.holdNextLoadMore("ses-a");
      fake.setRouted("ses-a");
      await flush();
      expect(fake.calls.messageLoadMores.filter((call) => call.id === "ses-a")).toHaveLength(2);

      releaseSecond();
      await flush();
      await flush();
      expect(fake.data.session.message.list("ses-a")).toHaveLength(400);
    });
  });

  it("backfills again after a reconnect that reset the store window", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: window }],
      messagesOnSync: { "ses-root": window },
      olderMessages: { "ses-root": all.slice(0, -50) },
    });

    await withSource(fake.host, async () => {
      await flush();
      await flush();
      expect(fake.data.session.message.list("ses-root")).toHaveLength(400);

      fake.setConnected(false);
      await flush();
      fake.setConnected(true);
      await flush();
      await flush();

      expect(fake.calls.messageLoadMores).toHaveLength(2);
      expect(fake.data.session.message.list("ses-root")).toHaveLength(400);
    });
  });

  it("does not refetch when a reconnect retained the full list", async () => {
    const all = historyMessages(200);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: all }],
    });

    await withSource(fake.host, async () => {
      await flush();
      expect(fake.calls.messageLoadMores).toStrictEqual([]);

      fake.setConnected(false);
      await flush();
      fake.setConnected(true);
      await flush();
      await flush();

      expect(fake.calls.messageLoadMores).toStrictEqual([]);
      expect(fake.data.session.message.list("ses-root")).toHaveLength(200);
    });
  });

  it("records a failed load once and does not retry on its own", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: window }],
      messagesOnSync: { "ses-root": window },
      olderMessages: { "ses-root": all.slice(0, -50) },
    });
    fake.failLoadMoreOnce("ses-root");

    await withSource(fake.host, async () => {
      await flush();
      await flush();
      await flush();
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-root", all: true }]);
      expect(fake.data.session.message.list("ses-root")).toHaveLength(50);
    });
  });

  it("stops a session whose window lost an anchor during a load", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: window }],
      messagesOnSync: { "ses-root": window },
      olderMessages: { "ses-root": all.slice(0, -50) },
    });
    const release = fake.holdNextLoadMore("ses-root");

    await withSource(fake.host, async () => {
      await flush();
      release();
      // Let the load publish, then replace the window before the settle lands.
      await Promise.resolve();
      fake.replaceMessages("ses-root", [makeAssistant({ id: "msg-replaced", created: 999 })]);
      await flush();
      await flush();

      expect(fake.data.session.message.more("ses-root")).toBe(true);
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-root", all: true }]);
      expect(fake.data.session.message.list("ses-root").map((message) => message.id)).toStrictEqual(
        ["msg-replaced"],
      );
    });
  });

  it("aborts an in-flight load on disposal without publishing", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: window }],
      messagesOnSync: { "ses-root": window },
      olderMessages: { "ses-root": all.slice(0, -50) },
    });
    const release = fake.holdNextLoadMore("ses-root");
    const dispose = createRoot((disposeRoot) => {
      createFleetSource(fake.host);
      return disposeRoot;
    });

    await flush();
    expect(fake.calls.messageLoadMores).toHaveLength(1);
    dispose();
    release();
    await flush();

    expect(fake.calls.messageLoadMores).toHaveLength(1);
    expect(fake.data.session.message.list("ses-root")).toHaveLength(50);
  });

  it("does not beam for history prepended by a backfill", async () => {
    const window = [makeAssistant({ id: "msg-new", created: 100 })];
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }), messages: window },
        {
          info: makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }),
          status: "running",
        },
      ],
      messagesOnSync: { "ses-root": window },
      olderMessages: {
        "ses-root": [
          makeAssistant({
            id: "msg-old",
            created: 1,
            content: [subagentCall("tool-old", "ses-child", "Old")],
          }),
        ],
      },
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      expect(fake.calls.messageLoadMores).toStrictEqual([{ id: "ses-root", all: true }]);
      expect(source.beams()).toStrictEqual([]);

      fake.addMessage(
        "ses-root",
        makeAssistant({
          id: "msg-live",
          created: 200,
          content: [subagentCall("tool-old", "ses-child", "Old", "completed")],
        }),
      );
      await flush();

      expect(source.beams().filter((beam) => beam.direction === "in")).toHaveLength(1);
    });
  });

  it("keeps other members' history across a route change", async () => {
    const all = historyMessages(400);
    const window = all.slice(-50);
    const older = all.slice(0, -50);
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        { info: makeSession({ id: "ses-root" }), messages: window },
        {
          info: makeSession({ id: "ses-child", parentID: "ses-root", created: 2 }),
          status: "running",
          messages: window,
        },
      ],
      messagesOnSync: { "ses-root": window, "ses-child": window },
      olderMessages: { "ses-root": older, "ses-child": older },
    });

    await withSource(fake.host, async () => {
      await flush();
      await flush();
      const rootSyncs = fake.calls.messageSyncs.filter((id) => id === "ses-root").length;
      const rootLoads = fake.calls.messageLoadMores.filter((call) => call.id === "ses-root").length;

      fake.setRouted("ses-child");
      await flush();
      await flush();

      expect(fake.calls.messageSyncs.filter((id) => id === "ses-child").length).toBeGreaterThan(0);
      expect(fake.calls.messageSyncs.filter((id) => id === "ses-root")).toHaveLength(rootSyncs);
      expect(fake.calls.messageLoadMores.filter((call) => call.id === "ses-root")).toHaveLength(
        rootLoads,
      );
      expect(fake.data.session.message.list("ses-root")).toHaveLength(400);
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
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 2,
        removed: 1,
        files: 1,
        truncated: false,
      });

      fake.addMessage("ses-root", makeAssistant({ created: 150, completed: 150 }));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(2);

      additions = 5;
      fake.addMessage("ses-root", messageWithSnapshot(200));
      await flush();
      expect(fake.calls.diffCalls).toHaveLength(3);
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 5,
        removed: 1,
        files: 1,
        truncated: false,
      });
    });
  });

  it("counts each file once when the diff repeats a path", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: [messageWithSnapshot(100)] }],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions: 2, deletions: 1, status: "modified" },
          { file: "src/a.ts", patch: "", additions: 9, deletions: 9, status: "modified" },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 2,
        removed: 1,
        files: 1,
        truncated: false,
      });
    });
  });

  it("excludes the truncation sentinel from the file count and the lines", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: [messageWithSnapshot(100)] }],
      diff: () =>
        Promise.resolve([
          { file: "src/a.ts", patch: "", additions: 2, deletions: 1, status: "modified" },
          {
            file: "src/truncated.ts",
            patch: "",
            additions: 100,
            deletions: 100,
            status: "modified",
            more: true,
          },
        ]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 2,
        removed: 1,
        files: 1,
        truncated: true,
      });
    });
  });

  it("reports an empty diff as no changes", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [{ info: makeSession({ id: "ses-root" }), messages: [messageWithSnapshot(100)] }],
      diff: () => Promise.resolve([]),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 0,
        removed: 0,
        files: 0,
        truncated: false,
      });
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
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 4,
        removed: 2,
        files: 1,
        truncated: false,
      });
    });
  });

  it("requests the cumulative diff on first load even when the latest turn reports no files", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root" }),
          messages: [messageWithSnapshot(100, [])],
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
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 3,
        removed: 2,
        files: 1,
        truncated: false,
      });

      fake.addMessage("ses-root", messageWithSnapshot(200, []));
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 3,
        removed: 2,
        files: 1,
        truncated: false,
      });
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
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 3,
        removed: 2,
        files: 1,
        truncated: false,
      });

      fake.addMessage("ses-root", messageWithSnapshot(200, []));
      await flush();
      expect(fake.calls.diffCalls).toStrictEqual(["ses-root"]);
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 3,
        removed: 2,
        files: 1,
        truncated: false,
      });
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
      expect(source.fleet()?.root.lines).toStrictEqual({
        added: 1,
        removed: 1,
        files: 1,
        truncated: false,
      });
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

describe("createFleetSource connection", () => {
  it("marks live members unknown while disconnected and restores them on reconnect", async () => {
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", cost: 0.5, tokens: makeTokens({ input: 10 }) }),
          status: "running",
        },
      ],
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.root.status).toBe("running");

      fake.setConnected(false);
      await flush();
      expect(source.fleet()?.root.status).toBe("unknown");
      expect(source.fleet()?.root.statusDetail).toBeUndefined();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 0.5, estimated: false });
      expect(source.fleet()?.root.tokens?.total).toBe(10);

      fake.setConnected(true);
      await flush();
      expect(source.fleet()?.root.status).toBe("running");
    });
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
    const tokens = makeTokens({ input: 1_000_000 });
    const model = { id: "m", providerID: "p" };
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", tokens, model }),
          messages: [makeAssistant({ tokens, cost: 0, completed: 1, model })],
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
    const tokens = makeTokens({ input: 1_000_000, output: 1_000_000 });
    const model = { id: "claude-sonnet-4-5", providerID: "claude-agent" };
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", tokens, model }),
          messages: [makeAssistant({ tokens, cost: 0, completed: 1, model })],
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

  it("includes a grandchild's reported cost in the family total", async () => {
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
            cost: 0.05,
          }),
        },
      ],
      prices: () => Promise.resolve({}),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(source.fleet()?.totalCost).toStrictEqual({ usd: 0.75, estimated: false });
      expect(source.fleet()?.active).toStrictEqual([]);
    });
  });

  it("leaves the family total unknown for a zero-cost grandchild without loaded usage", async () => {
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
      expect(source.fleet()?.totalCost).toBeUndefined();
    });
  });

  it("uses the host's own rates for the exact route", async () => {
    const tokens = makeTokens({ input: 1_000_000 });
    const model = { id: "m", providerID: "p" };
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", tokens, model }),
          messages: [makeAssistant({ tokens, cost: 0, completed: 1, model })],
        },
      ],
      models: [
        makeModel({
          providerID: "p",
          modelID: "m",
          id: "m",
          cost: [{ input: 2, output: 0, cache: { read: 0, write: 0 } }],
        }),
      ],
      prices: () =>
        Promise.resolve({
          p: { models: { m: { cost: { input: 99, output: 0 } } } },
        } satisfies PriceTable),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 2, estimated: true });
    });
  });

  it("prices a subscription alias through its native display name", async () => {
    const table = {
      anthropic: {
        models: {
          "claude-sonnet-5-5": {
            name: "Claude Sonnet 5.5",
            cost: { input: 2, output: 10 },
          },
        },
      },
    } satisfies PriceTable;
    const tokens = makeTokens({ input: 1_000_000 });
    const model = { id: "sonnet", providerID: "claude-agent" };
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", tokens, model }),
          messages: [makeAssistant({ tokens, cost: 0, completed: 1, model })],
        },
      ],
      models: [
        makeModel({
          providerID: "claude-agent",
          modelID: "sonnet",
          id: "sonnet",
          name: "Sonnet 5.5",
          cost: [],
        }),
      ],
      prices: () => Promise.resolve(table),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      await flush();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 2, estimated: true });
    });
  });

  it("fetches prices for a mixed session and adds only its unpriced share", async () => {
    const tokens = makeTokens({ input: 1_000 });
    const model = { id: "m", providerID: "p" };
    const fake = createFakeHost({
      routed: "ses-root",
      sessions: [
        {
          info: makeSession({ id: "ses-root", cost: 0.5, tokens, model }),
          messages: [makeAssistant({ tokens, cost: 0, completed: 1, model })],
        },
      ],
      prices: () =>
        Promise.resolve({
          p: { models: { m: { cost: { input: 1, output: 0 } } } },
        } satisfies PriceTable),
    });

    await withSource(fake.host, async (source) => {
      await flush();
      expect(fake.calls.priceFetches()).toBe(1);
      await flush();
      expect(source.fleet()?.root.cost).toStrictEqual({ usd: 0.501, estimated: true });
    });
  });
});
