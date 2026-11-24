import { describe, expect, it } from "vitest";

import {
  delegations,
  detectBeams,
  subagentCalls,
  type SubagentCall,
} from "../../src/model/delegations";
import type { Beam } from "../../src/model/types";
import { makeAssistant, makeTool } from "../fixtures";

function subagentTool(
  id: string,
  childID: string,
  description: string,
  status: "streaming" | "running" | "completed" | "error" = "running",
) {
  const values = { id, name: "subagent", status, input: { agent: "designer", description } };
  return status === "streaming"
    ? makeTool({ ...values, text: "{}" })
    : makeTool({ ...values, metadata: { sessionID: childID } });
}
describe("delegations", () => {
  it("maps a subagent call to its child session", () => {
    const found = delegations([
      makeAssistant({ content: [subagentTool("tool-1", "ses-child", "Design the panel")] }),
    ]);

    expect(found.get("ses-child")).toStrictEqual({
      toolID: "tool-1",
      agent: "designer",
      description: "Design the panel",
    });
  });

  it("keeps the latest call for a child", () => {
    const found = delegations([
      makeAssistant({ content: [subagentTool("tool-1", "ses-child", "First")] }),
      makeAssistant({ content: [subagentTool("tool-2", "ses-child", "Second")] }),
    ]);

    expect([...found.values()]).toStrictEqual([
      { toolID: "tool-2", agent: "designer", description: "Second" },
    ]);
  });

  it("tracks two children separately", () => {
    const found = delegations([
      makeAssistant({
        content: [subagentTool("tool-1", "ses-a", "A"), subagentTool("tool-2", "ses-b", "B")],
      }),
    ]);

    expect([...found.keys()]).toStrictEqual(["ses-a", "ses-b"]);
  });

  it("ignores non-subagent tools", () => {
    const found = delegations([
      makeAssistant({
        content: [makeTool({ name: "read", metadata: { sessionID: "ses-child" } })],
      }),
    ]);

    expect(found.size).toBe(0);
  });

  it("ignores a subagent call before its child id exists", () => {
    const found = delegations([
      makeAssistant({
        content: [makeTool({ name: "subagent", status: "streaming", text: "{}" })],
      }),
    ]);

    expect(found.size).toBe(0);
  });
});

const noCalls: ReadonlyMap<string, SubagentCall> = new Map();

function call(
  toolID: string,
  childID: string | undefined,
  status: SubagentCall["status"],
): SubagentCall {
  return { toolID, childID, status };
}

function calls(...entries: readonly SubagentCall[]): ReadonlyMap<string, SubagentCall> {
  return new Map(entries.map((entry) => [entry.toolID, entry]));
}

function ids(beams: readonly Beam[]): readonly string[] {
  return beams.map((beam) => beam.id);
}

describe("subagentCalls", () => {
  it("maps each delegation tool part by tool id", () => {
    const found = subagentCalls([
      makeAssistant({
        content: [subagentTool("tool-1", "ses-child", "Design", "running")],
      }),
    ]);

    expect(found.get("tool-1")).toStrictEqual(call("tool-1", "ses-child", "running"));
  });

  it("keeps a streaming call without a child id", () => {
    const found = subagentCalls([
      makeAssistant({
        content: [subagentTool("tool-1", "ses-child", "Design", "streaming")],
      }),
    ]);

    expect(found.get("tool-1")).toStrictEqual(call("tool-1", undefined, "streaming"));
  });

  it("keeps the latest state for a tool id", () => {
    const found = subagentCalls([
      makeAssistant({ content: [subagentTool("tool-1", "ses-child", "Design", "running")] }),
      makeAssistant({ content: [subagentTool("tool-1", "ses-child", "Design", "completed")] }),
    ]);

    expect(found.get("tool-1")).toStrictEqual(call("tool-1", "ses-child", "completed"));
  });

  it("ignores non-subagent parts", () => {
    const found = subagentCalls([
      makeAssistant({ content: [makeTool({ id: "tool-1", name: "read" })] }),
    ]);

    expect(found.size).toBe(0);
  });
});

describe("detectBeams", () => {
  it("does not animate the hydration snapshot", () => {
    const baseline = calls(call("tool-1", "ses-child", "running"));

    expect(detectBeams(baseline, baseline, baseline)).toStrictEqual([]);
  });

  it("fires one outward beam for a new delegation entering running", () => {
    const next = calls(call("tool-2", "ses-child", "running"));

    expect(detectBeams(noCalls, noCalls, next)).toStrictEqual([
      { id: "out:ses-child:tool-2", sessionID: "ses-child", direction: "out" },
    ]);
  });

  it("fires outward only for calls absent at hydration", () => {
    const baseline = calls(call("tool-1", "ses-child", "running"));
    const next = calls(call("tool-1", "ses-child", "running"), call("tool-2", "ses-a", "running"));

    expect(detectBeams(baseline, baseline, next)).toStrictEqual([
      { id: "out:ses-a:tool-2", sessionID: "ses-a", direction: "out" },
    ]);
  });

  it("fires outward when a running call resolves its child id later", () => {
    const before = calls(call("tool-1", undefined, "running"));
    const next = calls(call("tool-1", "ses-child", "running"));

    expect(detectBeams(noCalls, before, next)).toStrictEqual([
      { id: "out:ses-child:tool-1", sessionID: "ses-child", direction: "out" },
    ]);
  });

  it("fires one inward beam when an observed running call completes", () => {
    const before = calls(call("tool-1", "ses-child", "running"));
    const next = calls(call("tool-1", "ses-child", "completed"));
    const beams = detectBeams(noCalls, before, next);

    expect(beams).toHaveLength(1);
    expect(beams[0]?.direction).toBe("in");
    expect(beams[0]?.sessionID).toBe("ses-child");
    expect(beams[0]?.id).toMatch(/^in:ses-child:/u);
  });

  it("fires one inward beam when an observed streaming call completes", () => {
    const before = calls(call("tool-1", undefined, "streaming"));
    const next = calls(call("tool-1", "ses-child", "completed"));
    const beams = detectBeams(noCalls, before, next);

    expect(beams).toHaveLength(1);
    expect(beams[0]?.direction).toBe("in");
  });

  it("fires no inward beam for a call already terminal at hydration", () => {
    const baseline = calls(call("tool-1", "ses-child", "completed"));

    expect(detectBeams(baseline, baseline, baseline)).toStrictEqual([]);
  });

  it("fires no beam for a new call first seen completed", () => {
    const next = calls(call("tool-1", "ses-child", "completed"));

    expect(detectBeams(noCalls, noCalls, next)).toStrictEqual([]);
  });

  it("fires nothing when nothing changed", () => {
    const before = calls(call("tool-1", "ses-child", "running"));

    expect(detectBeams(noCalls, before, before)).toStrictEqual([]);
  });

  it("gives every inward beam a distinct id", () => {
    const before = calls(call("tool-1", "ses-a", "running"), call("tool-2", "ses-b", "running"));
    const next = calls(call("tool-1", "ses-a", "completed"), call("tool-2", "ses-b", "completed"));
    const beams = detectBeams(noCalls, before, next);

    expect(beams).toHaveLength(2);
    expect(new Set(ids(beams)).size).toBe(2);
  });
});
