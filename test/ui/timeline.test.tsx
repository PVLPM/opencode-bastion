import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { Timeline } from "../../src/ui/timeline";
import { TEST_NOW, runningChild, testFleet, testRoot } from "./fixtures";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  document.body.innerHTML = "";
});

function mountTimeline(fleet: ReturnType<typeof testFleet>, now: number): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(render(() => <Timeline fleet={fleet} now={now} />, host));
  return host;
}

describe("Timeline", () => {
  it("stays hidden with a single interval", () => {
    const fleet = testFleet(testRoot({ status: "done", endedAt: TEST_NOW }), []);
    const host = mountTimeline(fleet, TEST_NOW);

    expect(host.querySelector(".bn-timeline")).toBeNull();
  });

  it("places staggered agents on one shared axis", () => {
    const root = testRoot({ status: "done", startedAt: TEST_NOW - 100_000, endedAt: TEST_NOW });
    const child = runningChild({ startedAt: TEST_NOW - 50_000, endedAt: undefined });
    const host = mountTimeline(testFleet(root, [child]), TEST_NOW);
    const bars = host.querySelectorAll<HTMLElement>(".bn-timeline__bar");

    expect(bars).toHaveLength(2);
    expect(bars[0]?.style.left).toBe("0%");
    expect(bars[0]?.style.width).toBe("100%");
    expect(bars[1]?.style.left).toBe("50%");
    expect(bars[1]?.style.width).toBe("50%");
  });

  it("keeps waiting and running colours distinct", () => {
    const root = testRoot({ status: "done", startedAt: TEST_NOW - 100_000, endedAt: TEST_NOW });
    const child = runningChild({ status: "waiting", startedAt: TEST_NOW - 50_000 });
    const host = mountTimeline(testFleet(root, [child]), TEST_NOW);
    const bars = host.querySelectorAll(".bn-timeline__bar");

    expect(bars[0]?.getAttribute("data-status")).toBe("done");
    expect(bars[1]?.getAttribute("data-status")).toBe("waiting");
  });

  it("names each row with its agent and the full title on hover", () => {
    const root = testRoot({ status: "done", startedAt: TEST_NOW - 100_000, endedAt: TEST_NOW });
    const child = runningChild({ startedAt: TEST_NOW - 50_000 });
    const host = mountTimeline(testFleet(root, [child]), TEST_NOW);
    const labels = [...host.querySelectorAll(".bn-timeline__label")];

    expect(labels.map((label) => label.textContent)).toEqual(["Orchestrator", "Fixer"]);
    expect(labels[1]?.getAttribute("title")).toBe("Fixer — Fix the failing test");
  });
});
