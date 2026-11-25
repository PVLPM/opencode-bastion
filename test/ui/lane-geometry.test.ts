import { describe, expect, it } from "vitest";

import {
  fitScale,
  formatTick,
  handoffPath,
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

function pathPoints(d: string) {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((point) => ({
    x: Number(point[1]),
    y: Number(point[2]),
  }));
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

  it("starts a delegation at the call and lands at the child's left center", () => {
    const target = block("ses_fixer_a", 0);
    const link = geometry().connectors.find((item) => item.id === "call_a");
    const points = pathPoints(link?.d ?? "");
    expect(points[0]).toEqual({ x: START + 40, y: 36 });
    expect(points.at(-1)).toEqual({ x: target.x, y: 64 });
  });

  it("starts a follow-up at its call", () => {
    const link = geometry().connectors.find((item) => item.id === "call_a2");
    expect(pathPoints(link?.d ?? "")[0]).toEqual({ x: START + 340, y: 36 });
  });

  it("lands an inserted follow-up in the child at the call's time and mid-height", () => {
    const view = familyLanes();
    const followup = handoff("call_mid", "ses_fixer_a", 42, "ses_fixer_a:1", "followup");
    const result = geometry(50, lanesView(view.lanes, [...view.handoffs, followup]));
    const link = result.connectors.find((item) => item.id === followup.id);
    expect(pathPoints(link?.d ?? "").at(-1)).toEqual({ x: START + 420, y: 64 });
  });

  it("starts a handoff at the call when no root block contains it", () => {
    const root = lane("ses_root", "Orchestrator", [[42, undefined]], true);
    const child = lane("ses_child", "Fixer", [
      [0, 20],
      [40, undefined],
    ]);
    const call = handoff("call", "ses_child", 38, "ses_child:1");
    const result = geometry(50, lanesView([root, child], [call]));
    expect(pathPoints(result.connectors[0]?.d ?? "")[0]?.x).toBe(START + 380);
  });

  it("keeps a label inside its block and stops it before the next block", () => {
    const [first, second] = geometry().lanes[0]?.blocks ?? [];
    expect(first).toMatchObject({ x: START, width: 100, labelWidth: 100 });
    expect(second?.labelWidth).toBe(second?.width);
  });

  it.each([
    ["too narrow", 0.5, 0],
    ["three characters wide", 0.75, 30],
  ])("hides the label on a block %s", (_name, seconds, labelWidth) => {
    const root = lane("ses_root", "Orchestrator", [[0, seconds]], true);
    const block = geometry(50, lanesView([root])).lanes[0]?.blocks[0];
    expect(block?.labelWidth).toBe(labelWidth);
  });

  it("never gives a label more room than its block", () => {
    for (const lane of geometry().lanes)
      for (const block of lane.blocks) expect(block.labelWidth).toBeLessThanOrEqual(block.width);
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
  it.each([
    "fit",
    "detail",
  ] as const)("uses no elbows and keeps every %s handoff before now", (scale) => {
    const view = familyLanes();
    const liveRoot = lane("ses_root", "Orchestrator", [[0, undefined]], true);
    const result = laneGeometry(
      lanesView([liveRoot, ...view.lanes.slice(1)], view.handoffs),
      at(50),
      320,
      scale,
    );
    const now = result?.nowX;
    if (result === undefined || now === undefined) throw new Error("expected a live layout");
    expect(result.connectors).toHaveLength(3);
    for (const link of result.connectors) {
      expect(link.d.match(/[A-Z]/g)).toEqual(["M", "C"]);
      expect(
        pathPoints(link.d).every(({ x, y }) => x >= 0 && x <= now && y >= 0 && y <= result.height),
      ).toBe(true);
    }
  });

  it.each([
    ["near-vertical", 100, 102, 200],
    ["reverse-x", 150, 30, 200],
    ["departure at now", 150, 150, 150],
  ])("keeps horizontal handles inside the SVG for a %s handoff", (_name, source, target, right) => {
    const d = handoffPath({ x: source, y: 10 }, { x: target, y: 60 }, right);
    const [start, out, into, end] = pathPoints(d);
    expect(start).toEqual({ x: source, y: 10 });
    expect(end).toEqual({ x: target, y: 60 });
    expect(out?.y).toBe(10);
    expect(out?.x).not.toBe(source);
    expect(into?.y).toBe(60);
    expect(into?.x).not.toBe(target);
    expect(pathPoints(d).every(({ x }) => x >= 0 && x <= right)).toBe(true);
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
