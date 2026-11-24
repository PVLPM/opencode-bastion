import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Beam, FleetView } from "../../src/model/types";
import type { FleetPanelProps } from "../../src/ui/fleet-panel";
import { FleetPanel } from "../../src/ui/fleet-panel";
import { TEST_NOW, runningChild, testFleet, testRoot, waitingChild } from "./fixtures";
import { familyLanes, lanesView } from "./lane-fixtures";
import { uiStub } from "./ui-stub";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.motion;
});

function mountPanel(
  overrides: Partial<Omit<FleetPanelProps, "fleet">> & {
    fleet?: FleetView | undefined;
    readFleet?: () => FleetView;
  },
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const props: FleetPanelProps = {
    get fleet() {
      return overrides.readFleet?.() ?? overrides.fleet;
    },
    lanes: overrides.lanes,
    onOpen: overrides.onOpen ?? (() => {}),
    canOpen: overrides.canOpen ?? (() => true),
    now: overrides.now ?? TEST_NOW,
    beams: overrides.beams ?? [],
    ui: overrides.ui ?? uiStub,
  };
  disposers.push(render(() => <FleetPanel {...props} />, host));
  return host;
}

function sampleFleet(): FleetView {
  return testFleet(testRoot(), [runningChild(), waitingChild()]);
}

function fleetWithFinished(): FleetView {
  return testFleet(testRoot(), [
    runningChild(),
    runningChild({
      sessionID: "ses_child_done",
      agent: "Shipper",
      title: "Ship the release",
      status: "done",
      activity: undefined,
      endedAt: TEST_NOW - 1000,
    }),
  ]);
}

describe("FleetPanel", () => {
  it("animates a status mark only when its status changes", () => {
    const markAnimation = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (this: Element) {
        if (this.classList.contains("bn-mark")) markAnimation(this);
      },
    });
    try {
      const [fleet, setFleet] = createSignal(sampleFleet());
      const host = mountPanel({ readFleet: fleet });
      expect(markAnimation).not.toHaveBeenCalled();
      setFleet(sampleFleet());
      expect(markAnimation).not.toHaveBeenCalled();
      setFleet(testFleet(testRoot({ status: "waiting" }), [runningChild(), waitingChild()]));
      const changed = host.querySelector('[data-kind="root"] .bn-mark');
      expect(markAnimation.mock.calls).toEqual([[changed]]);
    } finally {
      if (original === undefined) Reflect.deleteProperty(Element.prototype, "animate");
      else Object.defineProperty(Element.prototype, "animate", original);
    }
  });

  it("explains the line count's attribution without adding a tab stop", () => {
    const host = mountPanel({
      fleet: testFleet(testRoot({ lines: { added: 12, removed: 3 } }), []),
      ui: {
        ...uiStub,
        Tooltip: (props) => <span data-tooltip={String(props.value)}>{props.children}</span>,
      },
    });
    const counter = host.querySelector(".bn-lines");
    expect(counter?.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe(
      "Session file diff — overlapping edits can appear in more than one agent.",
    );
    expect(counter?.getAttribute("aria-label")).toBe("12 lines added, 3 removed");
    expect(counter?.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps the existing root card mounted across fleet revisions", () => {
    const [fleet, setFleet] = createSignal(sampleFleet());
    const host = mountPanel({ readFleet: fleet });
    const root = () => host.querySelector('[data-kind="root"]');
    const previous = root();
    setFleet(testFleet(testRoot({ activity: "Checking results" }), [runningChild()]));
    expect(root()).toBe(previous);
    expect(root()?.textContent).toContain("Checking results");
  });

  it("retains the focused disclosure and its open details when a card moves to Finished", () => {
    const [fleet, setFleet] = createSignal(sampleFleet());
    const host = mountPanel({ readFleet: fleet });
    const more = () =>
      host.querySelector<HTMLButtonElement>('[data-bn-card="ses_child_a"] [data-bn-more]');
    const disclosure = more();
    disclosure?.focus();
    disclosure?.click();
    setFleet(
      testFleet(testRoot(), [waitingChild(), runningChild({ status: "done", endedAt: TEST_NOW })]),
    );
    expect(more()).toBe(disclosure);
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(disclosure);
    expect(disclosure?.closest("article")?.previousElementSibling?.className).toBe("bn-group");
  });
  it("opens the session when the card body is clicked", () => {
    const onOpen = vi.fn<(sessionID: string) => void>();
    const host = mountPanel({ fleet: sampleFleet(), onOpen });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-open]',
    );

    expect(button).not.toBeNull();
    button?.click();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("ses_child_a");
  });

  it("expands details without opening the session", () => {
    const onOpen = vi.fn<(sessionID: string) => void>();
    const host = mountPanel({ fleet: sampleFleet(), onOpen });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );

    expect(more).not.toBeNull();
    more?.click();

    expect(onOpen).not.toHaveBeenCalled();
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#bn-details-ses_child_a")).not.toBeNull();
    expect(host.textContent).toContain("Editing cart.test.ts");

    more?.click();

    expect(more?.getAttribute("aria-expanded")).toBe("false");
    // Kept mounted so it can animate closed, but out of reach and unannounced.
    const reveal = host
      .querySelector("#bn-details-ses_child_a")
      ?.closest<HTMLElement>(".bn-reveal");
    expect(reveal?.inert).toBe(true);
    expect(reveal?.getAttribute("aria-hidden")).toBe("true");
  });

  it("disables a card whose session cannot be opened", () => {
    const onOpen = vi.fn<(sessionID: string) => void>();
    const host = mountPanel({
      fleet: sampleFleet(),
      onOpen,
      canOpen: (sessionID) => sessionID !== "ses_child_a",
    });
    const card = host.querySelector('[data-bn-card="ses_child_a"]');
    const button = card?.querySelector<HTMLButtonElement>("[data-bn-open]");

    expect(button?.disabled).toBe(true);
    expect(card?.getAttribute("data-openable")).toBe("false");
    button?.click();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("summarises the family in the header", () => {
    const fleet = testFleet(testRoot({ status: "done", endedAt: TEST_NOW - 1000 }), [
      runningChild(),
      waitingChild(),
    ]);
    const host = mountPanel({ fleet });

    expect(host.textContent).toContain("3 agents");
    expect(host.textContent).toContain("1 running");
    expect(host.textContent).toContain("needs you");
    expect(host.textContent).toContain("$1.20");
  });

  it("shows the empty state without a fleet", () => {
    const host = mountPanel({ fleet: undefined });

    expect(host.textContent).toContain("No session.");
    expect(host.querySelector(".bn-tree")).toBeNull();
  });

  it("renders beams but none when motion is reduced", () => {
    const fleet = testFleet(testRoot(), [runningChild()]);
    const beams: Beam[] = [{ id: "beam-out", sessionID: "ses_child_a", direction: "out" }];

    const full = mountPanel({ fleet, beams });
    expect(full.querySelector(".bn-beam")).not.toBeNull();

    document.documentElement.dataset.motion = "reduce";
    const reduced = mountPanel({ fleet, beams });
    expect(reduced.querySelector(".bn-beam")).toBeNull();
  });

  it("renders a safe failure category from the view model", () => {
    const fleet = testFleet(testRoot(), [
      runningChild({
        status: "failed",
        endedAt: TEST_NOW - 1000,
        errorKind: "provider error",
      }),
    ]);
    const host = mountPanel({ fleet });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );

    expect(host.textContent).toContain("Failed: provider error");
    more?.click();
    expect(host.querySelector("#bn-details-ses_child_a")?.textContent).toContain(
      "Failed: provider error",
    );
  });

  it("lays a collapsed card out in exactly three rows", () => {
    const fleet = testFleet(testRoot(), [
      runningChild({
        task: "Fix recovery regressions",
        activity: "Running tests…",
        effort: "medium",
        lines: { added: 12, removed: 3 },
      }),
    ]);
    const card = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"]');
    const rows = [...(card?.querySelectorAll(".bn-card__body > .bn-row") ?? [])];

    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector(".bn-badge")?.textContent).toBe("Fixer");
    expect(rows[0]?.querySelector(".bn-title")?.textContent).toBe("Fix the failing test");
    expect(rows[1]?.textContent).toBe("Fix recovery regressions•Running tests…");
    expect(rows[2]?.querySelector(".bn-model__name")?.textContent).toBe("Opus 5.5");
    expect(rows[2]?.querySelector(".bn-model__effort")?.textContent).toBe("#Medium");
    expect(rows[2]?.querySelector(".bn-lines")?.textContent).toBe("+12−3");
  });

  it.each([
    [
      "task and activity",
      { task: "Fix it", activity: "Running tests…" },
      1,
      "Fix it•Running tests…",
    ],
    ["only a task", { task: "Fix it", activity: undefined }, 0, "Fix it"],
    ["only an activity", { task: undefined, activity: "Running tests…" }, 0, "Running tests…"],
    ["a finished task", { task: "Fix it", status: "done", endedAt: TEST_NOW }, 0, "Fix it"],
  ] as const)("separates task and activity only when both exist: %s", (_name, init, separators, text) => {
    const fleet = testFleet(testRoot(), [runningChild(init)]);
    const row = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"] .bn-row--work');

    expect(row?.querySelectorAll(".bn-sep")).toHaveLength(separators);
    expect(row?.textContent).toBe(text);
  });

  it.each([
    ["running", ".bn-radar", "Running"],
    ["waiting", ".bn-mark__dot", "Needs you: Waiting for permission"],
    ["failed", ".bn-mark__dot", "Failed: rate limit"],
    ["done", '[data-icon="check-small"]', "Done"],
    ["unknown", ".bn-mark__ring", "Unknown: Interrupted"],
  ] as const)("marks a %s agent with its native glyph and a label", (status, glyph, label) => {
    const detail =
      status === "waiting"
        ? "Waiting for permission"
        : status === "unknown"
          ? "Interrupted"
          : undefined;
    const fleet = testFleet(testRoot(), [
      runningChild({
        status,
        statusDetail: detail,
        errorKind: status === "failed" ? "rate limit" : undefined,
      }),
    ]);
    const mark = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"] .bn-mark');

    expect(mark?.getAttribute("aria-label")).toBe(label);
    expect(mark?.querySelector(glyph)).not.toBeNull();
  });

  it("links inactive agents with a quiet wire", () => {
    const host = mountPanel({ fleet: fleetWithFinished() });
    const wire = host.querySelector('[data-bn-wire="ses_child_done"]');

    expect(wire?.getAttribute("data-inactive")).toBe("true");
    expect(wire?.classList.contains("bn-wire--quiet")).toBe(true);
  });

  it("renders a beam for an inactive agent", () => {
    const beams: Beam[] = [{ id: "beam-in", sessionID: "ses_child_done", direction: "in" }];
    const host = mountPanel({ fleet: fleetWithFinished(), beams });

    expect(host.querySelector('[data-bn-beam="beam-in"]')).not.toBeNull();
  });

  it.each([
    ["no lanes yet", undefined, false],
    ["lanes without any execution", lanesView([]), false],
    ["at least one execution", familyLanes(), true],
  ] as const)("docks the lanes region below the cards only with %s", (_name, lanes, shown) => {
    const host = mountPanel({ fleet: sampleFleet(), lanes });
    const region = host.querySelector(".bn-cards + .bn-lanes");
    expect(region !== null).toBe(shown);
  });
});
