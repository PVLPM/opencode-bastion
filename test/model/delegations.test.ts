import { describe, expect, it } from "vitest";

import { delegations, detectBeams, type BeamSnapshot } from "../../src/model/delegations";
import type { Beam } from "../../src/model/types";
import { makeAssistant, makeError, makeTool } from "../fixtures";

function subagentTool(id: string, childID: string, description: string) {
  return makeTool({
    id,
    name: "subagent",
    input: { agent: "designer", description, prompt: `${description} prompt` },
    metadata: { sessionID: childID },
  });
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
      prompt: "Design the panel prompt",
      done: false,
    });
  });

  it("keeps the latest call for a child", () => {
    const found = delegations([
      makeAssistant({ content: [subagentTool("tool-1", "ses-child", "First")] }),
      makeAssistant({ content: [subagentTool("tool-2", "ses-child", "Second")] }),
    ]);

    expect([...found.values()]).toStrictEqual([
      {
        toolID: "tool-2",
        agent: "designer",
        description: "Second",
        prompt: "Second prompt",
        done: false,
      },
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

  it("marks a completed call done", () => {
    const found = delegations([
      makeAssistant({
        content: [
          makeTool({
            id: "tool-1",
            name: "subagent",
            status: "completed",
            input: { agent: "designer" },
            metadata: { sessionID: "ses-child" },
          }),
        ],
      }),
    ]);

    expect(found.get("ses-child")?.done).toBe(true);
  });

  it("marks a failed call done", () => {
    const found = delegations([
      makeAssistant({
        content: [
          makeTool({
            id: "tool-1",
            name: "subagent",
            status: "error",
            input: { agent: "designer" },
            error: makeError("failed"),
            metadata: { sessionID: "ses-child" },
          }),
        ],
      }),
    ]);

    expect(found.get("ses-child")?.done).toBe(true);
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

function snapshot(
  toolIDs: readonly string[],
  running: readonly string[],
  targets: readonly (readonly [string, string])[],
): BeamSnapshot {
  return {
    toolIDs: new Set(toolIDs),
    running: new Set(running),
    delegationTargets: new Map(targets),
  };
}

function ids(beams: readonly Beam[]): readonly string[] {
  return beams.map((beam) => beam.id);
}

describe("detectBeams", () => {
  it("does not animate the initial snapshot", () => {
    const next = snapshot(["tool-1"], ["ses-child"], [["tool-1", "ses-child"]]);

    expect(detectBeams(undefined, next)).toStrictEqual([]);
  });

  it("fires one outward beam per new delegation call", () => {
    const prev = snapshot(["tool-1"], ["ses-child"], [["tool-1", "ses-child"]]);
    const next = snapshot(
      ["tool-1", "tool-2", "tool-3"],
      ["ses-child"],
      [
        ["tool-1", "ses-child"],
        ["tool-2", "ses-child"],
        ["tool-3", "ses-child"],
      ],
    );

    expect(detectBeams(prev, next)).toStrictEqual([
      { id: "out:ses-child:tool-2", sessionID: "ses-child", direction: "out" },
      { id: "out:ses-child:tool-3", sessionID: "ses-child", direction: "out" },
    ]);
  });

  it("skips a new tool with no known child", () => {
    const prev = snapshot([], [], []);
    const next = snapshot(["tool-1"], [], []);

    expect(detectBeams(prev, next)).toStrictEqual([]);
  });

  it("fires an inward beam when a child stops running", () => {
    const prev = snapshot(["tool-1"], ["ses-a", "ses-b"], [["tool-1", "ses-a"]]);
    const next = snapshot(["tool-1"], ["ses-a"], [["tool-1", "ses-a"]]);
    const beams = detectBeams(prev, next);

    expect(beams).toHaveLength(1);
    expect(beams[0]?.direction).toBe("in");
    expect(beams[0]?.sessionID).toBe("ses-b");
    expect(beams[0]?.id).toMatch(/^in:ses-b:/u);
  });

  it("gives every inward beam a distinct id", () => {
    const prev = snapshot([], ["ses-a", "ses-b"], []);
    const next = snapshot([], [], []);
    const beams = detectBeams(prev, next);

    expect(new Set(ids(beams)).size).toBe(2);
  });

  it("fires nothing when nothing changed", () => {
    const prev = snapshot(["tool-1"], ["ses-a"], [["tool-1", "ses-a"]]);

    expect(detectBeams(prev, prev)).toStrictEqual([]);
  });
});
