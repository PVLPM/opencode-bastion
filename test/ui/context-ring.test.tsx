import type { ContextUsage } from "../../src/model/types";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { ContextRing, contextSummary } from "../../src/ui/context-ring";

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
    expect(contextSummary({ used: 42_000, limit: 0 })).toBeUndefined();
  });

  it("clamps usage above the limit to 100 percent", () => {
    const host = mountRing({ used: 240_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring")?.getAttribute("aria-label")).toBe(
      "Context 100 percent: 240.0k of 200.0k tokens",
    );
    expect(contextSummary({ used: 240_000, limit: 200_000 })).toBe("100% · 240.0k of 200.0k");
  });

  it("shows the rounded share of the context", () => {
    const host = mountRing({ used: 20_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring")?.getAttribute("aria-label")).toContain("10 percent");
    expect(host.querySelector(".bn-ring")?.getAttribute("data-level")).toBe("normal");
  });

  it("marks a nearly full context as high", () => {
    const host = mountRing({ used: 190_000, limit: 200_000 });

    expect(host.querySelector(".bn-ring")?.getAttribute("data-level")).toBe("high");
  });
});
