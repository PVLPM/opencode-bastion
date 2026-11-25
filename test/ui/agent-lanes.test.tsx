import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import type { LanesView } from "../../src/model/types";
import { AgentLanes, MIN_LANES_HEIGHT } from "../../src/ui/agent-lanes";
import { at, familyLanes, handoff, lane, lanesView } from "./lane-fixtures";
import { uiStub } from "./ui-stub";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  document.body.innerHTML = "";
});

function mountLanes(initial: LanesView, nowSeconds = 50, animate = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const [lanes, setLanes] = createSignal(initial);
  const [now, setNow] = createSignal(at(nowSeconds));
  disposers.push(
    render(() => <AgentLanes lanes={lanes()} now={now()} animate={animate} ui={uiStub} />, host),
  );
  return { host, setLanes, setNow: (seconds: number) => setNow(at(seconds)) };
}

const scroller = (host: HTMLElement) => {
  const element = host.querySelector<HTMLElement>(".bn-lanes__scroll");
  if (element === null) throw new Error("lanes are collapsed");
  return element;
};

/** jsdom has no layout; give the scroller a fixed box and a writable scroll offset. */
function fakeScrollBox(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  let left = 0;
  Object.defineProperty(element, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, get: () => clientWidth });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = Math.min(value, scrollWidth - clientWidth);
    },
  });
}

describe("AgentLanes", () => {
  it("renders one labelled lane per session in order, repeated names included", () => {
    const { host } = mountLanes(familyLanes());
    const labels = [...host.querySelectorAll(".bn-lanes__label")].map((node) => node.textContent);
    expect(labels).toEqual(["Orchestrator", "Fixer", "Fixer"]);
    expect(
      [...host.querySelectorAll("[data-bn-lane]")].map((node) => node.getAttribute("data-bn-lane")),
    ).toEqual(["ses_root", "ses_fixer_a", "ses_fixer_b"]);
  });

  it("shows each execution as a separate labelled block with an accessible summary", () => {
    const { host } = mountLanes(familyLanes());
    const root = host.querySelectorAll('[data-bn-lane="ses_root"] .bn-block');
    expect(root).toHaveLength(2);
    const failed = host.querySelector('[data-bn-block="ses_fixer_b:0"]');
    expect(failed?.getAttribute("data-status")).toBe("failed");
    expect(failed?.getAttribute("aria-label")).toBe("Fixer: Fixer 0, Failed");
    const label = failed?.parentElement?.querySelector(".bn-block__label");
    expect(label?.textContent).toBe("Fixer 0");
  });

  it("grows the live block with the clock without recreating it", () => {
    const { host, setNow } = mountLanes(familyLanes());
    const live = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_a:1"]');
    expect(live?.dataset.live).toBe("true");
    const before = Number.parseFloat(live?.style.width ?? "");
    setNow(52);
    const after = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_a:1"]');
    expect(after).toBe(live);
    expect(Number.parseFloat(after?.style.width ?? "")).toBeGreaterThan(before);
  });

  it("draws delegations dashed and follow-ups dotted, and nothing for an unresolved call", () => {
    const view = familyLanes();
    const { host } = mountLanes(
      lanesView(view.lanes, [...view.handoffs, handoff("call_lost", "ses_fixer_b", 45, undefined)]),
    );
    const links = [...host.querySelectorAll<SVGGElement>(".bn-link")].map((node) => [
      node.dataset.bnLink,
      node.dataset.kind,
    ]);
    expect(links).toEqual([
      ["call_a", "delegate"],
      ["call_b", "delegate"],
      ["call_a2", "followup"],
    ]);
  });

  it("animates only blocks and connectors that arrive after mount, and none without motion", () => {
    const grown = (view: LanesView) =>
      lanesView(
        [...view.lanes, lane("ses_late", "Reviewer", [[48, undefined]])],
        [...view.handoffs, handoff("call_late", "ses_late", 47, "ses_late:0")],
      );
    for (const animate of [true, false]) {
      const { host, setLanes } = mountLanes(familyLanes(), 50, animate);
      expect(host.querySelector("[data-enter]")).toBeNull();
      setLanes(grown(familyLanes()));
      const entered = [
        ...host.querySelectorAll<HTMLElement>(
          "[data-bn-block][data-enter], [data-bn-link][data-enter]",
        ),
      ].map((node) => node.dataset.bnBlock ?? node.dataset.bnLink);
      expect(entered).toEqual(animate ? ["ses_late:0", "call_late"] : []);
      for (const dispose of disposers.splice(0)) dispose();
    }
  });

  it("opens a session too long for Detail in Fit, and lets the user switch", () => {
    const long = lanesView([lane("ses_root", "Orchestrator", [[0, undefined]], true)]);
    const { host } = mountLanes(long, 3600);
    const checked = () =>
      host.querySelector('input[type="radio"]:checked')?.getAttribute("data-bn-scale");
    expect(checked()).toBe("fit");
    expect(scroller(host).dataset.scale).toBe("fit");
    host.querySelector<HTMLInputElement>('[data-bn-scale="detail"]')?.click();
    expect(checked()).toBe("detail");
    expect(scroller(host).dataset.scale).toBe("detail");
  });

  it("opens a short session in Detail", () => {
    const { host } = mountLanes(lanesView([lane("ses_root", "Orchestrator", [[0, 20]], true)]), 20);
    expect(scroller(host).dataset.scale).toBe("detail");
  });

  it.each([true, false])("tracks the checked radio with motion enabled=%s", async (animate) => {
    const { host } = mountLanes(familyLanes(), 50, animate);
    const group = host.querySelector('[role="radiogroup"]');
    const indicator = group?.querySelector<HTMLElement>(".bn-seg__indicator");
    const detail = group?.querySelector<HTMLInputElement>('[data-bn-scale="detail"]');
    const fit = group?.querySelector<HTMLInputElement>('[data-bn-scale="fit"]');
    if (!indicator || !fit?.parentElement || !detail?.parentElement) {
      throw new Error("expected a time scale control");
    }
    expect(indicator.getAttribute("aria-hidden")).toBe("true");
    expect(group?.firstElementChild).toBe(indicator);
    expect(indicator.hasAttribute("data-ready")).toBe(false);
    Object.defineProperties(fit.parentElement, {
      offsetLeft: { value: 0 },
      offsetWidth: { value: 30 },
    });
    Object.defineProperties(detail.parentElement, {
      offsetLeft: { value: 30 },
      offsetWidth: { value: 44 },
    });
    for (const [key, input, x, width] of [
      ["Home", fit, 0, 30],
      ["End", detail, 30, 44],
    ] as const) {
      group?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(input.checked).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(indicator.style.transform).toBe(`translateX(${x}px)`);
      expect(indicator.style.width).toBe(`${width}px`);
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(indicator.hasAttribute("data-ready")).toBe(animate);
  });

  it("lists the full task and metadata separately from the accessible block name", () => {
    const { host } = mountLanes(familyLanes());
    const block = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_b:0"]');
    block?.dispatchEvent(new PointerEvent("pointerenter"));
    const tip = host.querySelector(".bn-lanes__tip");
    expect(tip?.getAttribute("popover")).toBe("manual");
    expect([...(tip?.querySelectorAll("dt") ?? [])].map((term) => term.textContent)).toEqual([
      "Task",
      "Delegated by",
      "Status",
      "Started",
      "Duration",
    ]);
    expect(tip?.querySelector("dd")?.textContent).toBe("Fixer 0\nFull execution text");
    expect(tip?.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(at(8)).toISOString(),
    );
    expect(tip?.querySelector("dl > :last-child dd")?.textContent).toBe("17s");
  });

  it("falls back to the lane title for a bare root block and calls it a task", () => {
    const base = lane("ses_root", "Orchestrator", [[0, 10]], true);
    const view = lanesView([
      {
        ...base,
        title: "Agent card task, tokens and changes",
        blocks: base.blocks.map((block) => ({ ...block, label: undefined, text: undefined })),
      },
    ]);
    const { host } = mountLanes(view, 20);
    expect(host.querySelector(".bn-block__label")?.textContent).toBe(
      "Agent card task, tokens and changes",
    );
    host.querySelector<HTMLElement>('[data-bn-block="ses_root:0"]')?.focus();
    const tip = host.querySelector(".bn-lanes__tip");
    expect([...(tip?.querySelectorAll("dt") ?? [])].map((term) => term.textContent)).toEqual([
      "Task",
      "Status",
      "Started",
      "Duration",
    ]);
    expect(tip?.querySelector("dd")?.textContent).toBe("Agent card task, tokens and changes");
    expect(tip?.textContent).not.toContain("Not recorded");
  });

  it("keeps the prompt row for a root block with prompt text", () => {
    const { host } = mountLanes(lanesView([lane("ses_root", "Orchestrator", [[0, 10]], true)]), 20);
    host.querySelector<HTMLElement>('[data-bn-block="ses_root:0"]')?.focus();
    const tip = host.querySelector(".bn-lanes__tip");
    expect(tip?.querySelector("dt")?.textContent).toBe("Prompt");
    expect(tip?.querySelector("dd")?.textContent).toBe("Orchestrator 0\nFull execution text");
  });

  it("uses a distinct native radio group for each mounted panel", () => {
    const first = mountLanes(familyLanes()).host;
    const second = mountLanes(familyLanes()).host;
    const group = (host: HTMLElement) =>
      [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
        (input) => input.name,
      );
    expect(new Set(group(first)).size).toBe(1);
    expect(group(first)[0]).not.toBe(group(second)[0]);
  });

  it("freezes the canvas while collapsed and catches up on reopen", () => {
    const { host, setNow } = mountLanes(familyLanes());
    const toggle = host.querySelector<HTMLButtonElement>(".bn-lanes__toggle");
    const live = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_a:1"]');
    const width = live?.style.width;
    toggle?.click();
    setNow(55);
    expect(live?.style.width).toBe(width);
    toggle?.click();
    expect(live?.style.width).not.toBe(width);
  });

  it("clips a short block's label inside the block", () => {
    const view = lanesView([lane("ses_root", "Orchestrator", [[0, 1]], true)]);
    const { host } = mountLanes(view);
    const label = host.querySelector<HTMLElement>(".bn-block__label");
    expect(label?.textContent).toBe("Orchestrator 0");
    expect(label?.style.left).toBe("8px");
    expect(label?.style.maxWidth).toBe("40px");
    expect(label?.hasAttribute("data-short")).toBe(false);
  });

  it("renders no label on a block too narrow for three characters", () => {
    const view = lanesView([lane("ses_root", "Orchestrator", [[0, 0.5]], true)]);
    const { host } = mountLanes(view);
    expect(host.querySelector("[data-bn-block]")).not.toBeNull();
    expect(host.querySelector(".bn-block__label")).toBeNull();
  });

  it("keeps every label inside its block", () => {
    const { host } = mountLanes(familyLanes());
    const labels = [...host.querySelectorAll<HTMLElement>(".bn-block__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const block = label.previousElementSibling;
      if (!(block instanceof HTMLElement)) throw new Error("label without a block");
      expect(label.style.left).toBe(block.style.left);
      expect(Number.parseFloat(label.style.maxWidth)).toBeLessThanOrEqual(
        Number.parseFloat(block.style.width),
      );
    }
  });

  it.each([
    ["ses_fixer_a:0", "Delegated by"],
    ["ses_fixer_a:1", "Follow-up from"],
  ])("names the confirmed source for %s", (id, label) => {
    const { host } = mountLanes(familyLanes());
    host.querySelector<HTMLElement>(`[data-bn-block="${id}"]`)?.focus();
    const terms = [...host.querySelectorAll(".bn-lanes__tip dt")];
    const source = terms.find((term) => term.textContent === label);
    expect(source?.nextElementSibling?.textContent).toBe("Orchestrator");
  });

  it("updates the open duration while an execution is live", () => {
    const { host, setNow } = mountLanes(familyLanes());
    const live = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_a:1"]');
    live?.focus();
    const duration = () => host.querySelector(".bn-lanes__tip dl > :last-child dd")?.textContent;
    expect(duration()).toBe("15s");
    setNow(55);
    expect(duration()).toBe("20s");
  });

  it.each([
    ["ses_root:0", ["call_a", "call_b"]],
    ["ses_fixer_a:1", ["call_a2"]],
  ])("emphasizes only the handoffs related to %s", (id, expected) => {
    const { host } = mountLanes(familyLanes());
    host.querySelector<HTMLElement>(`[data-bn-block="${id}"]`)?.focus();
    const related = [...host.querySelectorAll("[data-related]")].map((link) =>
      link.getAttribute("data-bn-link"),
    );
    expect(related).toEqual(expected);
  });

  it("collapses and expands the region from its bar", () => {
    const { host } = mountLanes(familyLanes());
    const toggle = host.querySelector<HTMLButtonElement>(".bn-lanes__toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    toggle?.click();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    // Kept mounted so its height can animate to zero, but out of reach.
    expect(scroller(host).style.height).toBe("0px");
    expect(scroller(host).inert).toBe(true);
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    toggle?.click();
    expect(scroller(host).inert).toBe(false);
    expect(Number.parseFloat(scroller(host).style.height)).toBeGreaterThan(0);
  });

  it("resizes from the keyboard and by dragging the handle, never below the minimum", () => {
    const { host } = mountLanes(familyLanes());
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (handle === null) throw new Error("no resize handle");
    const height = () => Number.parseFloat(scroller(host).style.height);
    const start = height();

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(height()).toBe(start + 24);
    expect(handle.getAttribute("aria-valuenow")).toBe(String(start + 24));

    handle.setPointerCapture = () => {};
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientY: 300, bubbles: true }),
    );
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 260, bubbles: true }));
    expect(height()).toBe(start + 64);
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 900, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(height()).toBe(MIN_LANES_HEIGHT);

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(height()).toBe(MIN_LANES_HEIGHT);
  });

  it("follows new work at the right edge but leaves a scrolled-back view alone", () => {
    const long = lanesView([lane("ses_root", "Orchestrator", [[0, undefined]], true)]);
    for (const [scrolledTo, expected] of [
      [797, 800],
      [100, 100],
    ] as const) {
      const { host, setNow } = mountLanes(long, 600);
      host.querySelector<HTMLInputElement>('[data-bn-scale="detail"]')?.click();
      const element = scroller(host);
      fakeScrollBox(element, 1000, 200);
      element.scrollLeft = scrolledTo;
      element.dispatchEvent(new Event("scroll"));
      setNow(700);
      expect(element.scrollLeft).toBe(expected);
      for (const dispose of disposers.splice(0)) dispose();
    }
  });
});
