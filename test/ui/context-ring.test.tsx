import type { ContextUsage } from "../../src/model/types";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { ContextRing } from "../../src/ui/context-ring";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  document.body.innerHTML = "";
});

function mountRing(context: ContextUsage): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(render(() => <ContextRing context={context} />, host));
  return host;
}

describe("ContextRing", () => {
  it("renders nothing when the limit is unknown", () => {
    const host = mountRing({ used: 42_000, limit: 0 });

    expect(host.querySelector(".bn-ring")).toBeNull();
  });

  it("clamps usage above the limit to 100 percent", () => {
    const host = mountRing({ used: 240_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring__pct")?.textContent).toBe("100%");
    expect(host.querySelector(".bn-ring")?.getAttribute("aria-label")).toContain("100 percent");
  });

  it("shows the rounded share of the context", () => {
    const host = mountRing({ used: 20_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring__pct")?.textContent).toBe("10%");
    expect(host.querySelector(".bn-ring")?.getAttribute("data-level")).toBe("normal");
  });

  it("marks a nearly full context as high", () => {
    const host = mountRing({ used: 190_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring")?.getAttribute("data-level")).toBe("high");
  });
});
