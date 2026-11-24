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

function mountTicker(initial: string | undefined, animate = true) {
  const [text, setText] = createSignal<string | undefined>(initial);
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(render(() => <ActivityTicker text={text()} animate={animate} />, host));
  const lines = () => [...host.querySelectorAll(".bn-ticker__line")];
  return { host, setText, lines };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280));

describe("ActivityTicker", () => {
  it("does not animate the text it mounts with", () => {
    const { host } = mountTicker("Thinking…");

    expect(host.querySelector("[data-enter]")).toBeNull();
    expect(host.querySelector(".bn-ticker__prev")).toBeNull();
  });

  it("slides the previous line out and the new one in on a meaningful change", async () => {
    const { host, setText, lines } = mountTicker("Reading a.ts");

    setText("Running tests…");

    expect(host.querySelector(".bn-ticker__prev")?.textContent).toBe("Reading a.ts");
    expect(host.querySelector("[data-enter]")?.textContent).toBe("Running tests…");

    await settle();

    expect(lines().map((line) => line.textContent)).toStrictEqual(["Running tests…"]);
  });

  it.each([
    ["identical text", "Reading a.ts", "Reading a.ts"],
    ["streamed text that only grew", "Thinking", "Thinking about the diff"],
  ])("updates in place without a slide for %s", (_name, from, to) => {
    const { host, setText, lines } = mountTicker(from);

    setText(to);

    expect(host.querySelector(".bn-ticker__prev")).toBeNull();
    expect(host.querySelector("[data-enter]")).toBeNull();
    expect(lines().map((line) => line.textContent)).toStrictEqual([to]);
  });

  it("folds a burst of changes into the slide already running", () => {
    const { host, setText } = mountTicker("Reading a.ts");

    setText("Editing b.ts");
    const entering = host.querySelector("[data-enter]");
    setText("Running tests…");

    expect(host.querySelectorAll(".bn-ticker__prev")).toHaveLength(1);
    expect(host.querySelector("[data-enter]")).toBe(entering);
    expect(entering?.textContent).toBe("Running tests…");
  });

  it("swaps text without any slide when motion is reduced", () => {
    const { host, setText, lines } = mountTicker("Reading a.ts", false);

    setText("Editing b.ts");

    expect(host.querySelector(".bn-ticker__prev")).toBeNull();
    expect(host.querySelector("[data-enter]")).toBeNull();
    expect(lines().map((line) => line.textContent)).toStrictEqual(["Editing b.ts"]);
  });
});
