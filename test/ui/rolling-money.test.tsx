import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import type { Money } from "../../src/model/types";
import { RollingMoney } from "../../src/ui/rolling-money";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.motion;
});

function mountMoney(initial: Money = { usd: 1.24, estimated: false }) {
  const host = document.createElement("div");
  document.body.append(host);
  const [value, setValue] = createSignal(initial);
  dispose = render(() => <RollingMoney value={value()} />, host);
  const reels = () => [...host.querySelectorAll(".bn-money__reel")];
  return { host, setValue, reels };
}

describe("RollingMoney", () => {
  it("doesn't roll on mount or when the formatted value is unchanged", () => {
    const { reels, setValue } = mountMoney();
    expect(reels()).toHaveLength(0);
    setValue({ usd: 1.241, estimated: false });
    expect(reels()).toHaveLength(0);
  });

  it("rolls only the changed digit once", () => {
    const { reels, setValue } = mountMoney();
    setValue({ usd: 1.25, estimated: false });
    expect(reels().map((reel) => reel.textContent)).toEqual(["45"]);
    reels()[0]?.dispatchEvent(new Event("animationend"));
    expect(reels()).toHaveLength(0);
  });

  it("doesn't create reels with host reduced motion", () => {
    document.documentElement.dataset.motion = "reduce";
    const { host, reels, setValue } = mountMoney();
    setValue({ usd: 1.29, estimated: false });
    expect(reels()).toHaveLength(0);
    expect(host.querySelector(".bn-money__visual")?.textContent).toBe("$1.29");
  });

  it("exposes the exact formatted text while visual digits are hidden from assistive tech", () => {
    const { host, setValue } = mountMoney();
    setValue({ usd: 0.003, estimated: true });
    expect(host.querySelector(".bn-money__text")?.textContent).toBe("~<$0.01");
    expect(host.querySelector(".bn-money__visual")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("[aria-live]")).toBeNull();
  });
});
