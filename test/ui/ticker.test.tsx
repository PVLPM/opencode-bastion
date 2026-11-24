import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { ActivityTicker } from "../../src/ui/ticker";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  document.body.innerHTML = "";
});

describe("ActivityTicker", () => {
  it("slides the previous line out while keeping one line in flow", async () => {
    const [text, setText] = createSignal<string | undefined>("Reading a.ts");
    const host = document.createElement("div");
    document.body.append(host);
    disposers.push(render(() => <ActivityTicker text={text()} live />, host));

    expect(host.querySelectorAll(".bn-ticker__line")).toHaveLength(1);

    setText("Editing b.ts");
    await Promise.resolve();

    expect(host.querySelectorAll(".bn-ticker__line")).toHaveLength(2);
    expect(host.querySelector(".bn-ticker__prev")?.textContent).toBe("Reading a.ts");
    expect(host.querySelectorAll(".bn-ticker__line:not(.bn-ticker__prev)")).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 240));

    expect(host.querySelectorAll(".bn-ticker__line")).toHaveLength(1);
    expect(host.querySelector(".bn-ticker__prev")).toBeNull();
    expect(host.textContent).toContain("Editing b.ts");
  });

  it("does not animate the first text it mounts with", () => {
    const host = document.createElement("div");
    document.body.append(host);
    disposers.push(render(() => <ActivityTicker text="Thinking…" live />, host));

    expect(host.querySelector(".bn-ticker__line[data-enter]")).toBeNull();
    expect(host.querySelector(".bn-ticker__prev")).toBeNull();
  });
});
