import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Beam, FleetView, TokenStats } from "../../src/model/types";
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

function usage(values: Partial<TokenStats> = {}): TokenStats {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    ...values,
  };
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
      fleet: testFleet(
        testRoot({ lines: { added: 12, removed: 3, files: 2, truncated: false } }),
        [],
      ),
      ui: {
        ...uiStub,
        Tooltip: (props) => <span data-tooltip={String(props.value)}>{props.children}</span>,
      },
    });
    const counter = host.querySelector(".bn-lines");
    expect(counter?.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe(
      "Session file diff — overlapping edits can appear in more than one agent.",
    );
    expect(counter?.getAttribute("aria-label")).toBe("12 lines added, 3 removed, 2 files");
    expect(counter?.hasAttribute("tabindex")).toBe(false);
  });

  it("caveats recorded and estimated cost as loaded-message based", () => {
    const host = mountPanel({
      fleet: testFleet(testRoot({ cost: { usd: 1.2, estimated: true } }), [
        runningChild({ cost: { usd: 0.3, estimated: false } }),
      ]),
      ui: {
        ...uiStub,
        Tooltip: (props) => <span data-tooltip={String(props.value)}>{props.children}</span>,
      },
    });

    const tips = [...host.querySelectorAll('[data-tooltip*="loaded messages"]')];
    expect(tips.length).toBeGreaterThanOrEqual(2);
    for (const tip of tips) {
      expect(tip.getAttribute("data-tooltip")).toContain("may be incomplete");
    }
    expect(host.querySelector(".bn-head__cost")?.getAttribute("title")).toContain(
      "loaded messages",
    );
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

  it("shows the cumulative token total on row three and in the header", () => {
    const tokens = usage({
      input: 10_000,
      output: 1_400,
      reasoning: 400,
      cacheRead: 1_000,
      total: 12_800,
    });
    const fleet = testFleet(testRoot({ tokens }), [], 12_800);
    const host = mountPanel({
      fleet,
      ui: {
        ...uiStub,
        Tooltip: (props) => <span data-tooltip={String(props.value)}>{props.children}</span>,
      },
    });

    const metric = host.querySelector(
      '[data-tooltip="Total tokens this session has consumed, including reasoning and cache reads and writes"]',
    );
    expect(metric?.querySelector(".bn-money__text")?.textContent).toBe("12.8k tok");
    expect(host.querySelector(".bn-head__tokens .bn-money__text")?.textContent).toBe("12.8k tok");
    expect(host.querySelector(".bn-head__tokens")?.getAttribute("title")).toBe(
      "Known family token total for loaded sessions",
    );
  });

  it("rolls a changed token digit in the card and the header", () => {
    const initial = testFleet(testRoot({ tokens: usage({ total: 12_800 }) }), [], 12_800);
    const [fleet, setFleet] = createSignal(initial);
    const host = mountPanel({ readFleet: fleet });
    const reels = () =>
      [...host.querySelectorAll(".bn-money__reel")].map((reel) => reel.textContent);

    expect(reels()).toHaveLength(0);
    setFleet(testFleet(testRoot({ tokens: usage({ total: 12_900 }) }), [], 12_900));
    expect(reels()).toEqual(["89", "89"]);
  });

  it("shows a measured zero token total", () => {
    const fleet = testFleet(testRoot({ tokens: usage() }), [], 0);
    const host = mountPanel({ fleet });

    expect(host.querySelector(".bn-row--meta")?.textContent).toContain("0 tok");
    expect(host.querySelector(".bn-head__tokens .bn-money__text")?.textContent).toBe("0 tok");
  });

  it("lists cumulative usage in the details and keeps the cost", () => {
    const fleet = testFleet(
      testRoot(),
      [
        runningChild({
          tokens: usage({
            input: 1_200,
            output: 300,
            reasoning: 100,
            cacheRead: 5_000,
            cacheWrite: 400,
            total: 7_000,
          }),
          cost: { usd: 0.3, estimated: false },
        }),
      ],
      7_000,
    );
    const host = mountPanel({ fleet });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );
    more?.click();

    const details = host.querySelector("#bn-details-ses_child_a");
    const rows = [...(details?.querySelectorAll(".bn-dl__row") ?? [])];
    const value = (label: string) =>
      rows.find((row) => row.querySelector("dt")?.textContent === label)?.querySelector("dd")
        ?.textContent;

    expect(value("Total tokens")).toBe("7.0k");
    expect(value("Input")).toBe("1.2k");
    expect(value("Output")).toBe("300");
    expect(value("Reasoning")).toBe("100");
    expect(value("Cache read")).toBe("5.0k");
    expect(value("Cache write")).toBe("400");
    expect(value("Cost")).toBe("$0.30");
  });

  it("names the provider in the details beside its logo", () => {
    const host = mountPanel({ fleet: sampleFleet() });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );
    more?.click();

    const details = host.querySelector("#bn-details-ses_child_a");
    const rows = [...(details?.querySelectorAll(".bn-dl__row") ?? [])];
    const labels = rows.map((row) => row.querySelector("dt")?.textContent);
    const provider = rows.find((row) => row.querySelector("dt")?.textContent === "Provider");

    expect(labels.indexOf("Provider")).toBeLessThan(labels.indexOf("Model"));
    expect(provider?.querySelector(".bn-dl__provider")?.textContent?.trim()).toBe("Anthropic");
    expect(provider?.querySelector(".bn-dl__provider .bn-logo")).not.toBeNull();
  });

  it("groups and orders the details, linked from the disclosure", () => {
    const fleet = testFleet(testRoot(), [
      runningChild({
        task: "Fix it",
        taskText: "Fix it",
        cost: { usd: 0.3, estimated: false },
        context: { used: 62_000, limit: 200_000 },
        tokens: usage({
          input: 1_200,
          output: 300,
          reasoning: 100,
          cacheRead: 5_000,
          cacheWrite: 400,
          total: 7_000,
        }),
        lines: { added: 12, removed: 3, files: 2, truncated: false },
      }),
    ]);
    const host = mountPanel({ fleet });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );
    more?.click();

    const details = document.getElementById(more?.getAttribute("aria-controls") ?? "");

    expect(details?.tagName).toBe("DL");
    expect(details?.querySelectorAll(".bn-dl__row")).toHaveLength(16);
    expect([...(details?.querySelectorAll("dt") ?? [])].map((label) => label.textContent)).toEqual([
      "Agent",
      "Session",
      "Task",
      "Now",
      "Provider",
      "Model",
      "Cost",
      "Time",
      "Changes",
      "Context",
      "Total tokens",
      "Input",
      "Output",
      "Reasoning",
      "Cache read",
      "Cache write",
    ]);
    expect(details?.querySelectorAll(".bn-dl__rule")).toHaveLength(2);
  });

  it.each([
    [
      "identity rows only",
      {
        model: undefined,
        startedAt: undefined,
        cost: undefined,
        lines: undefined,
        context: undefined,
        tokens: undefined,
      },
      0,
    ],
    ["identity and model rows", { context: undefined, tokens: undefined }, 1],
    [
      "identity and usage rows",
      {
        model: undefined,
        startedAt: undefined,
        cost: undefined,
        lines: undefined,
        tokens: usage({ total: 7_000 }),
      },
      1,
    ],
    ["all three groups", { context: undefined, tokens: usage({ total: 7_000 }) }, 2],
  ] as const)("draws a divider only between non-empty groups: %s", (_name, init, rules) => {
    const host = mountPanel({ fleet: testFleet(testRoot(), [runningChild(init)]) });
    host.querySelector<HTMLButtonElement>('[data-bn-card="ses_child_a"] [data-bn-more]')?.click();

    const details = host.querySelector("#bn-details-ses_child_a");
    const children = [...(details?.querySelectorAll(".bn-dl__row, .bn-dl__rule") ?? [])];

    expect(children.filter((child) => child.classList.contains("bn-dl__rule"))).toHaveLength(rules);
    expect(children[0]?.classList.contains("bn-dl__row")).toBe(true);
    expect(children.at(-1)?.classList.contains("bn-dl__row")).toBe(true);
  });

  it("marks a truncated diff in the accessible name, tooltip and details", () => {
    const host = mountPanel({
      fleet: testFleet(testRoot(), [
        runningChild({ lines: { added: 12, removed: 3, files: 2, truncated: true } }),
      ]),
      ui: {
        ...uiStub,
        Tooltip: (props) => <span data-tooltip={String(props.value)}>{props.children}</span>,
      },
    });
    const counter = host.querySelector(".bn-lines");

    expect(counter?.getAttribute("role")).toBe("img");
    expect(counter?.getAttribute("aria-label")).toBe("12 lines added, 3 removed, 2 files, partial");
    expect(counter?.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe(
      "Session file diff — partial: the directory listing was truncated. Overlapping edits can appear in more than one agent.",
    );

    host.querySelector<HTMLButtonElement>('[data-bn-card="ses_child_a"] [data-bn-more]')?.click();
    const rows = [
      ...(host.querySelector("#bn-details-ses_child_a")?.querySelectorAll(".bn-dl__row") ?? []),
    ];
    const changes = rows.find((row) => row.querySelector("dt")?.textContent === "Changes");

    expect(changes?.querySelector(".bn-changes__partial")?.textContent).toBe("· partial");
  });

  it("keeps a files-only diff out of the collapsed row and in the Changes details", () => {
    const host = mountPanel({
      fleet: testFleet(testRoot(), [
        runningChild({ lines: { added: 0, removed: 0, files: 1, truncated: false } }),
      ]),
    });
    const card = host.querySelector('[data-bn-card="ses_child_a"]');

    expect(card?.querySelector(".bn-lines")).toBeNull();
    card?.querySelector<HTMLButtonElement>("[data-bn-more]")?.click();

    const rows = [
      ...(host.querySelector("#bn-details-ses_child_a")?.querySelectorAll(".bn-dl__row") ?? []),
    ];
    const changes = rows.find((row) => row.querySelector("dt")?.textContent === "Changes");

    expect(changes?.querySelector(".bn-changes__files")?.textContent?.trim()).toBe("• 1 file");
  });

  it.each([
    ["a files-only change", { added: 0, removed: 0, files: 1, truncated: false }, "• 1 file"],
    ["multiple files", { added: 12, removed: 3, files: 2, truncated: false }, "• 2 files"],
  ] as const)("shows %s in the Changes details", (_name, lines, expected) => {
    const host = mountPanel({
      fleet: testFleet(testRoot(), [runningChild({ lines })]),
    });
    const more = host.querySelector<HTMLButtonElement>(
      '[data-bn-card="ses_child_a"] [data-bn-more]',
    );
    more?.click();

    const rows = [
      ...(host.querySelector("#bn-details-ses_child_a")?.querySelectorAll(".bn-dl__row") ?? []),
    ];
    const changes = rows.find((row) => row.querySelector("dt")?.textContent === "Changes");

    expect(changes).not.toBeUndefined();
    expect(changes?.querySelector(".bn-lines__add")?.textContent).toBe(`+${lines.added}`);
    expect(changes?.querySelector(".bn-lines__del")?.textContent).toBe(`−${lines.removed}`);
    expect(changes?.querySelector(".bn-changes__files")?.textContent?.trim()).toBe(expected);
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
        lines: { added: 12, removed: 3, files: 2, truncated: false },
      }),
    ]);
    const card = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"]');
    const rows = [...(card?.querySelectorAll(".bn-card__body > .bn-row") ?? [])];

    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector(".bn-badge")?.textContent).toBe("Fixer");
    expect(rows[0]?.querySelector(".bn-title")?.textContent).toBe("Fix the failing test");
    expect(rows[1]?.textContent).toBe("Fix recovery regressions•Running tests…+12−3");
    expect(rows[2]?.querySelector(".bn-model__name")?.textContent).toBe("Opus 5.5");
    expect(rows[2]?.querySelector(".bn-model__effort")?.textContent).toBe("Medium");
    expect(rows[2]?.querySelector(".bn-lines")).toBeNull();
  });

  it("puts the duration in row one immediately before the status mark", () => {
    const card = mountPanel({ fleet: testFleet(testRoot(), [runningChild()]) }).querySelector(
      '[data-bn-card="ses_child_a"]',
    );
    const head = card?.querySelector(".bn-row--head");
    const duration = head?.querySelector(".bn-duration");

    expect(duration?.textContent).toBe("10s");
    expect(duration?.nextElementSibling).toBe(head?.querySelector(".bn-card__mark"));
    expect(card?.querySelector(".bn-row--meta .bn-duration")).toBeNull();
  });

  it("keeps the task, the activity and the session diff in row two, in that order", () => {
    const fleet = testFleet(testRoot(), [
      runningChild({
        task: "Fix recovery regressions",
        activity: "Running tests…",
        lines: { added: 12, removed: 3, files: 2, truncated: false },
      }),
    ]);
    const card = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"]');
    const work = card?.querySelector(".bn-row--work");

    expect([...(work?.children ?? [])].map((child) => child.className)).toEqual([
      "bn-task",
      "bn-sep",
      "bn-ticker",
      "bn-work__diff",
    ]);
    expect(work?.lastElementChild?.querySelector(".bn-lines")?.textContent).toBe("+12−3");
    expect(card?.querySelector(".bn-row--meta .bn-lines")).toBeNull();
  });

  it("keeps a finished task and its diff without an orphaned separator", () => {
    const fleet = testFleet(testRoot(), [
      runningChild({
        task: "Fix recovery regressions",
        status: "done",
        endedAt: TEST_NOW,
        activity: undefined,
        lines: { added: 12, removed: 3, files: 2, truncated: false },
      }),
    ]);
    const row = mountPanel({ fleet }).querySelector('[data-bn-card="ses_child_a"] .bn-row--work');

    expect(row?.querySelectorAll(".bn-sep")).toHaveLength(0);
    expect(row?.textContent).toBe("Fix recovery regressions+12−3");
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
