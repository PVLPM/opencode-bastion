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
    expect(failed?.getAttribute("aria-label")).toBe("Fixer: Fixer 0, Failed, 17s");
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
      host.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("data-bn-scale");
    expect(checked()).toBe("fit");
    expect(scroller(host).dataset.scale).toBe("fit");
    host.querySelector<HTMLButtonElement>('[data-bn-scale="detail"]')?.click();
    expect(checked()).toBe("detail");
    expect(scroller(host).dataset.scale).toBe("detail");
  });

  it("opens a short session in Detail", () => {
    const { host } = mountLanes(lanesView([lane("ses_root", "Orchestrator", [[0, 20]], true)]), 20);
    expect(scroller(host).dataset.scale).toBe("detail");
  });

  it("anchors its tooltip to the hovered block, inside the region", () => {
    const { host } = mountLanes(familyLanes());
    const block = host.querySelector<HTMLElement>('[data-bn-block="ses_fixer_b:0"]');
    block?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const tip = host.querySelector('.bn-lanes [role="tooltip"]');
    expect(tip?.textContent).toBe("Fixer: Fixer 0, Failed, 17s");
    block?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
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
      host.querySelector<HTMLButtonElement>('[data-bn-scale="detail"]')?.click();
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
