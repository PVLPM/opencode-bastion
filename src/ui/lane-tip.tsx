import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";

import { formatDuration } from "../model/format";
import type { Handoff } from "../model/types";
import type { BlockBox } from "./lane-geometry";
import { statusLabel } from "./status";

const EDGE = 8;
const GAP = 6;
const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function LaneTip(props: {
  id: string;
  anchor: HTMLElement;
  block: BlockBox;
  root: boolean;
  title: string | undefined;
  sourceAgent: string | undefined;
  inbound: ReadonlySet<Handoff["kind"]> | undefined;
  onEnter: () => void;
  onLeave: () => void;
  onDismiss: () => void;
}) {
  const [scrollable, setScrollable] = createSignal(false);
  let panel: HTMLDivElement | undefined;
  let content: HTMLElement | undefined;
  let frameID: number | undefined;
  const place = () => {
    if (panel === undefined || content === undefined) return;
    const anchor = props.anchor.getBoundingClientRect();
    const scroller = props.anchor.closest(".bn-lanes__scroll");
    const frame = scroller?.getBoundingClientRect();
    const labels = scroller?.querySelector(".bn-lanes__labels")?.getBoundingClientRect();
    const axis = scroller?.querySelector(".bn-lanes__axis")?.getBoundingClientRect();
    const left = Math.max(anchor.left, labels?.right ?? 0);
    const right = Math.min(anchor.right, frame?.right ?? window.innerWidth);
    const top = Math.max(anchor.top, axis?.bottom ?? 0);
    const bottom = Math.min(anchor.bottom, frame?.bottom ?? window.innerHeight);
    const paneLeft = Math.max(EDGE, (frame?.left ?? 0) + EDGE);
    const paneRight = Math.min(window.innerWidth, frame?.right ?? window.innerWidth) - EDGE;
    const maxWidth = paneRight > paneLeft ? `${Math.min(340, paneRight - paneLeft)}px` : "";
    if (panel.style.maxWidth !== maxWidth) panel.style.maxWidth = maxWidth;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const insidePane = paneRight - paneLeft >= width;
    const x = Math.min(
      (insidePane ? paneRight : window.innerWidth - EDGE) - width,
      Math.max(insidePane ? paneLeft : EDGE, (left + right - width) / 2),
    );
    const above = top - GAP - height;
    const below = bottom + GAP;
    const preferred = above >= EDGE || top > window.innerHeight - bottom ? above : below;
    const y = Math.max(EDGE, Math.min(window.innerHeight - EDGE - height, preferred));
    const canScroll = content.scrollHeight > content.clientHeight;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.visibility = right > left && bottom > top ? "visible" : "hidden";
    setScrollable(canScroll);
  };
  const schedulePlace = () => {
    if (frameID !== undefined) return;
    frameID = window.requestAnimationFrame(() => {
      frameID = undefined;
      place();
    });
  };
  const onScroll = (event: Event) => {
    if (event.target instanceof Node && panel?.contains(event.target)) return;
    schedulePlace();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || panel?.style.visibility !== "visible") return;
    if (panel.contains(document.activeElement)) props.anchor.focus();
    props.onDismiss();
    event.preventDefault();
    event.stopPropagation();
  };

  onMount(() => {
    if (panel === undefined) return;
    if ("showPopover" in panel) panel.showPopover();
    place();
    const observer = "ResizeObserver" in window ? new ResizeObserver(schedulePlace) : undefined;
    observer?.observe(panel);
    const anchor = props.anchor;
    anchor.addEventListener("transitionend", schedulePlace);
    window.addEventListener("resize", schedulePlace);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      observer?.disconnect();
      if (frameID !== undefined) window.cancelAnimationFrame(frameID);
      anchor.removeEventListener("transitionend", schedulePlace);
      window.removeEventListener("resize", schedulePlace);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
    });
  });
  const position = createMemo(() => `${props.block.x}/${props.block.width}`);
  const text = createMemo(() => props.block.text);
  createEffect(on([position, text], schedulePlace, { defer: true }));

  return (
    <div
      id={props.id}
      class="bn-lanes__tip"
      role="region"
      aria-label="Execution details"
      popover="manual"
      ref={(element) => {
        panel = element;
      }}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    >
      <dl>
        <div>
          <dt id={`${props.id}-text`}>
            {props.root && props.block.text !== undefined ? "Prompt" : "Task"}
          </dt>
          <dd
            class="bn-lanes__tip-text"
            aria-labelledby={`${props.id}-text`}
            tabindex={scrollable() ? 0 : undefined}
            ref={(element) => {
              content = element;
            }}
          >
            {props.block.text ?? props.block.label ?? props.title ?? "Not recorded"}
          </dd>
        </div>
        <Show when={props.sourceAgent && props.inbound?.has("delegate")}>
          <div>
            <dt>Delegated by</dt>
            <dd>{props.sourceAgent}</dd>
          </div>
        </Show>
        <Show when={props.sourceAgent && props.inbound?.has("followup")}>
          <div>
            <dt>Follow-up from</dt>
            <dd>{props.sourceAgent}</dd>
          </div>
        </Show>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(props.block.status)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>
            <time datetime={new Date(props.block.start).toISOString()}>
              {clock.format(props.block.start)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(props.block.end - props.block.start)}</dd>
        </div>
      </dl>
    </div>
  );
}
