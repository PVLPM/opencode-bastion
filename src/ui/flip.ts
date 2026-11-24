import { type Accessor, createComputed, createEffect, on, onCleanup } from "solid-js";

import { canAnimate } from "./motion";

const FLIP_ID = "bn-flip";
/** On-screen moves use the strong ease-in-out; arrivals the strong ease-out. */
const MOVE_MS = 240;
const MOVE: KeyframeAnimationOptions = {
  id: FLIP_ID,
  duration: MOVE_MS,
  easing: "cubic-bezier(0.77, 0, 0.175, 1)",
};
const ENTER: KeyframeAnimationOptions = {
  id: FLIP_ID,
  duration: 280,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  fill: "backwards",
};
const ENTER_STAGGER = 40;
const MAX_STAGGER = 160;

/**
 * FLIP for a keyed list: whenever `key` changes, elements matching `selector`
 * inside `host` glide from where they were to where they now are, and newly
 * arrived ones rise in. Positions are read before Solid touches the DOM (a
 * computation runs before render effects) and animated after it, on transform
 * and opacity only. A complete swap (another session) is not animated.
 */
export function createFlip(
  host: Accessor<HTMLElement | undefined>,
  key: Accessor<string>,
  selector: string,
  identify: (element: HTMLElement) => string | undefined,
  enabled: boolean,
): void {
  let before = new Map<string, number>();
  let settle: ReturnType<typeof setTimeout> | undefined;
  let focused: HTMLElement | undefined;
  onCleanup(() => clearTimeout(settle));

  const items = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>(selector)].flatMap((element) => {
      const id = identify(element);
      return id === undefined ? [] : [{ id, element }];
    });

  createComputed(
    on(
      key,
      () => {
        before = new Map();
        const root = host();
        const active = document.activeElement;
        focused = active instanceof HTMLElement && root?.contains(active) ? active : undefined;
        if (!enabled || root === undefined) return;
        for (const { id, element } of items(root)) {
          before.set(id, element.getBoundingClientRect().top);
        }
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      key,
      () => {
        const root = host();
        if (focused?.isConnected && document.activeElement === document.body) {
          focused.focus({ preventScroll: true });
        }
        if (!enabled || root === undefined || before.size === 0 || !canAnimate()) return;
        const now = items(root);
        if (!now.some(({ id }) => before.has(id))) return;
        let arrivals = 0;
        // While cards glide, anything drawn to their measured positions (the
        // wires) may glide too; `data-bn-gliding` scopes that to the move.
        root.dataset.bnGliding = "true";
        clearTimeout(settle);
        settle = setTimeout(() => delete root.dataset.bnGliding, MOVE_MS + 40);
        for (const { element } of now) {
          for (const running of element.getAnimations()) {
            if (running.id === FLIP_ID) running.cancel();
          }
        }
        const positions = now.map(({ id, element }) => ({
          id,
          element,
          top: element.getBoundingClientRect().top,
        }));
        for (const { id, element, top } of positions) {
          const old = before.get(id);
          if (old === undefined) {
            element.animate(
              [
                { opacity: 0, transform: "translateY(6px) scale(0.98)" },
                { opacity: 1, transform: "none" },
              ],
              { ...ENTER, delay: Math.min(MAX_STAGGER, arrivals * ENTER_STAGGER) },
            );
            arrivals += 1;
          } else if (Math.abs(old - top) > 0.5) {
            element.animate(
              [{ transform: `translateY(${old - top}px)` }, { transform: "none" }],
              MOVE,
            );
          }
        }
        before = new Map();
      },
      { defer: true },
    ),
  );
}
