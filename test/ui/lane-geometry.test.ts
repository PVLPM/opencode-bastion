import { describe, expect, it } from "vitest";

import {
  fitScale,
  formatTick,
  handoffPath,
  handoffStart,
  laneGeometry,
  pickScale,
} from "../../src/ui/lane-geometry";
import { at, familyLanes, handoff, lane, lanesView } from "./lane-fixtures";

/** familyLanes spans 0..50 s at now = +50 s; 1000 px fits it at 10 px per second. */
const VIEWPORT = 1000;
const START = 8;

function geometry(nowSeconds = 50, view = familyLanes()) {
  const result = laneGeometry(view, at(nowSeconds), VIEWPORT);
  if (result === undefined) throw new Error("expected lanes");
  return result;
}

function block(sessionID: string, index: number, nowSeconds = 50) {
  const found = geometry(nowSeconds)
    .lanes.find((item) => item.sessionID === sessionID)
    ?.blocks.at(index);
  if (found === undefined) throw new Error(`no block ${sessionID}:${index}`);
  return found;
}

describe("laneGeometry", () => {
  it("has nothing to lay out before the first execution", () => {
    expect(laneGeometry(lanesView([]), at(0), VIEWPORT)).toBeUndefined();
  });

  it("places closed blocks at their real start and end on the shared axis", () => {
    expect(block("ses_root", 0)).toMatchObject({ x: START, width: 100, live: false });
    expect(block("ses_fixer_b", 0)).toMatchObject({ x: START + 80, width: 170 });
  });

  it("keeps the idle gap between two executions of one lane", () => {
    const first = block("ses_root", 0);
    const second = block("ses_root", 1);
    expect(second.x - (first.x + first.width)).toBe(200);
  });

  it("extends a live block to now while closed blocks stay put", () => {
    expect(block("ses_fixer_a", 1, 50)).toMatchObject({ width: 150, live: true });
    expect(block("ses_fixer_a", 1, 55)).toMatchObject({ width: 200, live: true });
    expect(block("ses_root", 0, 55)).toEqual(block("ses_root", 0, 50));
    expect(geometry(55).nowX).toBe(START + 550);
  });

  it("has no now line once every execution is closed", () => {
    const closed = lanesView([lane("ses_root", "Orchestrator", [[0, 10]], true)]);
    expect(geometry(50, closed).nowX).toBeUndefined();
  });

  it("keeps one lane per session in the given order, even with repeated names", () => {
    expect(geometry().lanes.map((item) => [item.sessionID, item.agent])).toEqual([
      ["ses_root", "Orchestrator"],
      ["ses_fixer_a", "Fixer"],
      ["ses_fixer_b", "Fixer"],
    ]);
  });

  it("draws each handoff from the right end of its prompt block in one curve onto the child's top edge", () => {
    const first = geometry().connectors.find((item) => item.id === "call_a");
    // Prompt [0 s, 10 s] ends at x 108 on the root lane's center line (y 36); the
    // call (x 48) feeds Fixer A's block (x 58, top 54), landing a curve's run later.
    expect(first?.d).toBe("M 108 36 H 114 C 121.2 36 126 44.1 126 54");
    expect(first?.mark).toBe("M 123 57 L 126 60 L 129 57");
    expect(first?.live).toBe(false);
  });

  it("lets a label run past a short block, stopping before the next one", () => {
    const [first, second] = geometry().lanes[0]?.blocks ?? [];
    expect(first).toMatchObject({ x: START, width: 100, labelWidth: 300 - 6 });
    expect(second?.labelWidth).toBe(VIEWPORT - 6 - (second?.x ?? 0));
  });
  it("keeps follow-ups and drops calls whose child block is unknown", () => {
    const view = familyLanes();
    const unresolved = lanesView(view.lanes, [
      ...view.handoffs,
      handoff("call_lost", "ses_fixer_b", 45, undefined),
      handoff("call_gone", "ses_missing", 45, "ses_missing:0"),
    ]);
    expect(geometry(50, unresolved).connectors.map((item) => [item.id, item.kind])).toEqual([
      ["call_a", "delegate"],
      ["call_b", "delegate"],
      ["call_a2", "followup"],
    ]);
  });

  it("drops axis labels that would collide with the now label", () => {
    const labels = geometry().ticks.map((tick) => tick.label);
    expect(labels).toEqual(["0", "10s", "20s", "30s", "40s"]);
    expect(geometry().ticks.at(-1)?.x).toBeLessThanOrEqual(START + 500 - 64);
  });
});

describe("handoff connectors", () => {
  const box = (start: number, end: number, live = false) => ({
    id: `b${start}`,
    x: start,
    width: end - start,
    start: at(start),
    end: at(end),
    status: "done" as const,
    label: undefined,
    labelWidth: 0,
    live,
  });

  it.each([
    ["the right end of the closed prompt that issued it", [box(0, 40), box(60, 90)], 70, 90],
    ["the call itself while that prompt still runs", [box(0, 40), box(60, 90, true)], 70, 70],
    ["the call itself when no prompt precedes it", [box(60, 90)], 10, 10],
  ] as const)("start at %s", (_name, blocks, call, expected) => {
    expect(handoffStart(blocks, at(call), call)).toBe(expected);
  });

  it("lands inside the child block, never before the call, arriving vertically", () => {
    const { d, landX } = handoffPath({ x: 100, y: 10 }, 140, { x: 120, width: 200, top: 60 });
    expect(landX).toBe(140);
    expect(d.endsWith(`140 ${60 - 50 * 0.55} 140 60`)).toBe(true);
    const short = handoffPath({ x: 100, y: 10 }, 105, { x: 90, width: 20, top: 60 });
    expect(short.landX).toBe(106);
  });
});

describe("fitScale", () => {
  const from = at(0);
  const end = at(3600);
  const x = fitScale(from, end, 400);

  it("maps the whole session onto the viewport, start at the left inset and the end at the right", () => {
    expect(x(from)).toBe(START);
    expect(x(end)).toBe(400 - 24);
  });

  it("is strictly increasing, so blocks keep their order", () => {
    const xs = [0, 1, 60, 600, 1800, 3000, 3590, 3599, 3600].map((seconds) => x(at(seconds)));
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThan(xs[index - 1] ?? Number.NaN);
    }
  });

  it("gives the newest minute more room than an older one", () => {
    const newest = x(at(3600)) - x(at(3540));
    const oldest = x(at(60)) - x(at(0));
    expect(newest).toBeGreaterThan(oldest * 5);
  });

  it("keeps now at the right edge and labels markers as time before it", () => {
    const fit = laneGeometry(familyLanes(), at(50), 400, "fit");
    expect(fit?.width).toBe(400);
    expect(fit?.nowX).toBe(400 - 24);
    expect(fit?.ticks.map((tick) => tick.label)).toEqual(["−30s", "−10s"]);
    const starts = fit?.lanes.flatMap((item) => item.blocks.map((block) => block.x)) ?? [];
    const detail = geometry().lanes.flatMap((item) => item.blocks.map((block) => block.x));
    const order = (xs: readonly number[]) =>
      xs.map((_, index) => index).toSorted((a, b) => (xs[a] ?? 0) - (xs[b] ?? 0));
    expect(order(starts)).toEqual(order(detail));
  });
});

describe("pickScale", () => {
  it.each([
    ["the largest zoom that fits", 10_000, 500, 40],
    ["a smaller zoom once the span outgrows it", 60_000, 500, 5],
    ["one pixel per second at most, then scroll", 3_600_000, 500, 1],
  ])("picks %s", (_name, span, viewport, scale) => {
    expect(pickScale(span, viewport)).toBe(scale);
  });
});

describe("formatTick", () => {
  it.each([
    [0, "0"],
    [45, "45s"],
    [120, "2m"],
    [90, "1m 30s"],
    [3600, "1h"],
    [5400, "1h 30m"],
  ])("labels %i seconds as %s", (seconds, label) => {
    expect(formatTick(seconds)).toBe(label);
  });
});
