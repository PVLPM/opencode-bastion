import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from "solid-js";

import type { LanesView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { createKeyed } from "./keyed";
import { formatDuration } from "../model/format";
import {
  type BlockBox,
  type LaneBox,
  type LaneScale,
  type LanesGeometry,
  laneGeometry,
  laneSpan,
  LANE_HEIGHT,
  outgrowsDetail,
} from "./lane-geometry";
import { statusLabel } from "./status";
import { LaneTip } from "./lane-tip";

export interface AgentLanesProps {
  readonly lanes: LanesView;
  readonly now: number;
  readonly animate: boolean;
  readonly ui: Pick<Ui, "Icon" | "Tooltip">;
}

export const MIN_LANES_HEIGHT = 96;
const DEFAULT_HEIGHT = 176;
const KEY_STEP = 24;
/** Room the cards keep above the region when it is dragged to its maximum. */
const RESERVED = 160;
/** Width used before the scroller has been measured. */
const FALLBACK_VIEWPORT = 240;

const SCALE_OPTIONS: readonly { value: LaneScale; label: string; hint: string }[] = [
  { value: "fit", label: "Fit", hint: "Whole session; older time is compressed" },
  { value: "detail", label: "Detail", hint: "True time scale; scroll for earlier work" },
];

function ScaleControl(props: {
  name: string;
  scale: LaneScale;
  animate: boolean;
  select: (scale: LaneScale) => void;
}) {
  let group: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal<{ x: number; width: number }>();
  const [ready, setReady] = createSignal(false);
  const measure = () => {
    const item = group?.querySelector(`[data-bn-scale="${props.scale}"]`)?.parentElement;
    if (item !== undefined && item !== null) {
      setPosition({ x: item.offsetLeft, width: item.offsetWidth });
    }
  };

  createEffect(on(() => props.scale, measure));
  onMount(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : undefined;
    for (const item of group?.querySelectorAll(".bn-seg__item") ?? []) observer?.observe(item);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    });
  });

  const onKey = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    if (event.key !== "Home" && event.key !== "End") return;
    const input = event.currentTarget.querySelector<HTMLInputElement>(
      event.key === "Home" ? '[data-bn-scale="fit"]' : '[data-bn-scale="detail"]',
    );
    if (input === null) return;
    event.preventDefault();
    input.click();
    input.focus();
  };

  return (
    <div
      class="bn-seg"
      role="radiogroup"
      aria-label="Time scale"
      ref={(element) => {
        group = element;
      }}
      onKeyDown={onKey}
    >
      <span
        class="bn-seg__indicator"
        aria-hidden="true"
        data-ready={ready() && props.animate ? "true" : undefined}
        style={{
          width: position() === undefined ? undefined : `${position()?.width}px`,
          transform: position() === undefined ? undefined : `translateX(${position()?.x}px)`,
        }}
      />
      <For each={SCALE_OPTIONS}>
        {(option) => (
          <label class="bn-seg__item" title={option.hint}>
            <input
              class="bn-seg__radio"
              type="radio"
              name={props.name}
              checked={props.scale === option.value}
              data-bn-scale={option.value}
              onChange={() => props.select(option.value)}
            />
            {option.label}
          </label>
        )}
      </For>
    </div>
  );
}

/**
 * One execution: the block is exactly as long as it ran. Its label is clipped
 * inside the block, up to the next block; a block too narrow for three
 * characters shows none and keeps the full text in the tooltip.
 */
function Block(props: {
  lane: () => LaneBox | undefined;
  block: () => BlockBox | undefined;
  enter: boolean;
  inspection: Inspection;
  geometry: Accessor<LanesGeometry | undefined>;
}) {
  // Read once: Solid re-runs an element's attribute effects together, and a
  // block that existed before mount must never start its entrance later.
  const enter = props.enter;
  const tipID = createUniqueId();
  let anchor: HTMLDivElement | undefined;
  return (
    <Show when={props.block()}>
      {(block) => {
        const text = () => block().label ?? props.lane()?.title;
        const id = () => block().id;
        const inspected = () => props.inspection.active() === id();
        return (
          <div
            onFocusIn={() => props.inspection.focus(id())}
            onFocusOut={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              )
                return;
              props.inspection.blur(id());
            }}
          >
            <div
              ref={(element) => {
                anchor = element;
              }}
              class="bn-block"
              role="img"
              tabindex={block().width > 0 ? "0" : "-1"}
              aria-label={`${props.lane()?.agent}: ${text() ?? "Execution"}, ${statusLabel(block().status)}`}
              aria-details={inspected() ? tipID : undefined}
              data-bn-block={block().id}
              data-status={block().status}
              data-live={block().live ? "true" : undefined}
              data-enter={enter ? "true" : undefined}
              style={{ left: `${block().x}px`, width: `${block().width}px` }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") props.inspection.hover(id());
              }}
              onPointerLeave={() => props.inspection.leave(id())}
            >
              <Show when={["running", "waiting", "failed"].includes(block().status)}>
                <span class="bn-block__end" aria-hidden="true" />
              </Show>
            </div>
            <Show when={block().labelWidth > 0 && text()}>
              <span
                class="bn-block__label"
                aria-hidden="true"
                data-status={block().status}
                data-enter={enter ? "true" : undefined}
                style={{
                  left: `${block().x}px`,
                  "max-width": `${block().labelWidth}px`,
                }}
              >
                <span>{text()}</span>
              </span>
            </Show>
            <Show when={inspected() && anchor}>
              {(trigger) => (
                <LaneTip
                  id={tipID}
                  anchor={trigger()}
                  block={block()}
                  prompt={props.lane()?.root === true}
                  sourceAgent={props.geometry()?.sourceAgent}
                  inbound={props.geometry()?.inbound.get(id())}
                  onEnter={() => props.inspection.hover(id())}
                  onLeave={() => props.inspection.leave(id())}
                  onDismiss={props.inspection.dismiss}
                />
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

function Lane(props: {
  lane: () => LaneBox | undefined;
  index: Accessor<number>;
  ready: Accessor<boolean>;
  animate: boolean;
  inspection: Inspection;
  geometry: Accessor<LanesGeometry | undefined>;
}) {
  const blocks = createKeyed(
    () => props.lane()?.blocks ?? [],
    (block) => block.id,
  );
  return (
    <div
      class="bn-lane"
      data-bn-lane={props.lane()?.sessionID}
      data-root={props.lane()?.root ? "true" : undefined}
      style={{ top: `${props.index() * LANE_HEIGHT}px` }}
    >
      <Show when={!props.lane()?.root && props.lane()?.title}>
        {(title) => (
          <span class="bn-lane__watermark" aria-hidden="true">
            {title()}
          </span>
        )}
      </Show>
      <For each={blocks.ids()}>
        {(id) => (
          <Block
            lane={props.lane}
            block={() => blocks.get(id)}
            enter={untrack(props.ready) && props.animate}
            inspection={props.inspection}
            geometry={props.geometry}
          />
        )}
      </For>
    </div>
  );
}

interface Inspection {
  readonly active: Accessor<string | undefined>;
  readonly hover: (id: string) => void;
  readonly leave: (id: string) => void;
  readonly focus: (id: string) => void;
  readonly blur: (id: string) => void;
  readonly dismiss: () => void;
}

/**
 * Agent Lanes: one lane per session on a shared time axis, execution blocks at
 * their real start and end, live blocks reaching for now, and dashed handoff
 * connectors from the orchestrator's call x to the child block it fed.
 *
 * The region is collapsible, resizable from its top edge and scrolls on its
 * own in both directions. It follows the newest work only while the user is
 * at the right edge; once they scroll back, updates leave the view alone.
 */
export function AgentLanes(props: AgentLanesProps) {
  const Icon = props.ui.Icon;
  const uid = createUniqueId();
  const lanesID = `bn-lanes-${uid}`;
  const [open, setOpen] = createSignal(true);
  const [height, setHeight] = createSignal(DEFAULT_HEIGHT);
  const [viewport, setViewport] = createSignal(FALLBACK_VIEWPORT);
  const [ready, setReady] = createSignal(false);
  const [drag, setDrag] = createSignal<{ y: number; height: number }>();
  const [maxHeight, setMaxHeight] = createSignal(Number.POSITIVE_INFINITY);
  let region: HTMLElement | undefined;
  let scroller: HTMLDivElement | undefined;
  let labels: HTMLDivElement | undefined;
  let pinned = true;
  const [hovered, setHovered] = createSignal<string>();
  const [focused, setFocused] = createSignal<string>();
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = () => {
    clearTimeout(leaveTimer);
    setHovered(undefined);
    setFocused(undefined);
  };
  const inspection: Inspection = {
    active: createMemo(() => (open() ? (hovered() ?? focused()) : undefined)),
    hover(id) {
      clearTimeout(leaveTimer);
      setHovered(id);
    },
    leave(id) {
      if (hovered() !== id) return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setHovered(undefined), 250);
    },
    focus(id) {
      clearTimeout(leaveTimer);
      setHovered(undefined);
      setFocused(id);
    },
    blur(id) {
      if (focused() === id) setFocused(undefined);
      if (hovered() === id) setHovered(undefined);
    },
    dismiss,
  };
  onCleanup(() => clearTimeout(leaveTimer));

  // Until the user picks a scale, a session the Detail view would have to scroll opens in Fit.
  const [chosen, setChosen] = createSignal<LaneScale>();
  const scale = createMemo<LaneScale>((previous) => {
    if (!open()) return previous;
    const picked = chosen();
    if (picked !== undefined) return picked;
    const span = laneSpan(props.lanes, props.now)?.span ?? 0;
    return outgrowsDetail(span, viewport()) ? "fit" : "detail";
  }, "detail");
  const geometry = createMemo<LanesGeometry | undefined>((previous) =>
    open() ? laneGeometry(props.lanes, props.now, viewport(), scale()) : previous,
  );
  const lanes = createKeyed(
    () => geometry()?.lanes ?? [],
    (lane) => lane.sessionID,
  );
  const ticks = createKeyed(
    () => geometry()?.ticks ?? [],
    (tick) => tick.key,
  );
  const connectors = createKeyed(
    () => geometry()?.connectors ?? [],
    (connector) => connector.id,
  );

  const resize = (next: number) =>
    setHeight(Math.round(Math.min(maxHeight(), Math.max(MIN_LANES_HEIGHT, next))));

  const measure = () => {
    const host = region?.parentElement?.clientHeight ?? 0;
    if (host > 0) {
      const limit = Math.max(MIN_LANES_HEIGHT, host - RESERVED);
      setMaxHeight(limit);
      if (height() > limit) resize(limit);
    }
    if (scroller === undefined) return;
    const width = scroller.clientWidth - (labels?.offsetWidth ?? 0);
    setViewport(width > 0 ? width : FALLBACK_VIEWPORT);
  };

  const followNewest = () => {
    if (scroller !== undefined && pinned && scale() === "detail") {
      scroller.scrollLeft = scroller.scrollWidth;
    }
  };

  const onScroll = () => {
    if (scroller === undefined) return;
    pinned = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  };

  const canvasWidth = createMemo(() => geometry()?.width);
  createEffect(on(canvasWidth, followNewest));

  onMount(() => {
    setReady(true);
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(measure);
    if (scroller !== undefined) observer.observe(scroller);
    if (region?.parentElement !== null && region?.parentElement !== undefined)
      observer.observe(region.parentElement);
    measure();
    followNewest();
    onCleanup(() => observer.disconnect());
  });

  const onKey = (event: KeyboardEvent) => {
    const steps = new Map([
      ["ArrowUp", height() + KEY_STEP],
      ["ArrowDown", height() - KEY_STEP],
      ["Home", MIN_LANES_HEIGHT],
      ["End", maxHeight()],
    ]);
    const next = steps.get(event.key);
    // End has no target until the panel has been measured.
    if (next === undefined || !Number.isFinite(next)) return;
    event.preventDefault();
    resize(next);
  };

  return (
    <section
      class="bn-lanes"
      ref={(element) => {
        region = element;
      }}
      data-open={open() ? "true" : undefined}
      data-dragging={drag() === undefined ? undefined : "true"}
    >
      <Show when={open()}>
        <div
          class="bn-lanes__handle"
          role="separator"
          tabindex="0"
          aria-orientation="horizontal"
          aria-controls={lanesID}
          aria-label="Resize agent lanes"
          aria-valuemin={MIN_LANES_HEIGHT}
          aria-valuemax={Number.isFinite(maxHeight()) ? maxHeight() : undefined}
          aria-valuenow={height()}
          onKeyDown={onKey}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({ y: event.clientY, height: height() });
          }}
          onPointerMove={(event) => {
            const start = drag();
            if (start !== undefined) resize(start.height + start.y - event.clientY);
          }}
          onPointerUp={() => setDrag(undefined)}
          onPointerCancel={() => setDrag(undefined)}
        />
      </Show>
      <div class="bn-lanes__bar">
        <button
          class="bn-lanes__toggle"
          type="button"
          aria-expanded={open()}
          aria-controls={lanesID}
          onClick={() => {
            dismiss();
            setOpen((value) => !value);
          }}
        >
          <Icon name="chevron-down" size="small" class="bn-lanes__chevron" />
          <span class="bn-lanes__title">Lanes</span>
        </button>
        <Show when={open()}>
          <ScaleControl
            name={`bn-scale-${uid}`}
            scale={scale()}
            animate={props.animate}
            select={(value) => {
              pinned = true;
              setChosen(value);
            }}
          />
        </Show>
        <Show when={geometry()}>
          {(measured) => <span class="bn-lanes__span">{formatDuration(measured().span)}</span>}
        </Show>
      </div>
      <div
        class="bn-lanes__scroll"
        id={lanesID}
        ref={(element) => {
          scroller = element;
        }}
        role="region"
        tabindex={open() ? "0" : "-1"}
        aria-label="Agent lanes"
        aria-hidden={open() ? undefined : "true"}
        inert={!open()}
        data-scale={scale()}
        style={{ height: `${open() ? height() : 0}px` }}
        onScroll={onScroll}
      >
        <Show when={geometry()}>
          {(measured) => (
            <div
              class="bn-lanes__canvas"
              style={{
                width: `calc(var(--bn-lane-label) + ${measured().width}px)`,
                height: `${measured().height}px`,
              }}
            >
              <div class="bn-lanes__axis" aria-hidden="true">
                <span class="bn-lanes__corner" />
                <div class="bn-lanes__ticks">
                  <For each={ticks.ids()}>
                    {(key) => (
                      <span class="bn-lanes__tick" style={{ left: `${ticks.get(key)?.x ?? 0}px` }}>
                        {ticks.get(key)?.label}
                      </span>
                    )}
                  </For>
                  <Show when={measured().nowX}>
                    {(x) => (
                      <span
                        class="bn-lanes__now-label"
                        style={{ transform: `translateX(${x()}px)` }}
                      >
                        now
                      </span>
                    )}
                  </Show>
                </div>
              </div>
              <div
                class="bn-lanes__labels"
                ref={(element) => {
                  labels = element;
                }}
              >
                <For each={lanes.ids()}>
                  {(id) => (
                    <span
                      class="bn-lanes__label"
                      data-root={lanes.get(id)?.root ? "true" : undefined}
                      title={lanes.get(id)?.title}
                    >
                      {lanes.get(id)?.agent}
                    </span>
                  )}
                </For>
              </div>
              <div
                class="bn-lanes__track"
                style={{
                  width: `${measured().width}px`,
                  "--bn-post-now": `${measured().width - (measured().nowX ?? measured().width)}px`,
                }}
              >
                <For each={ticks.ids()}>
                  {(key) => (
                    <span class="bn-lanes__grid" style={{ left: `${ticks.get(key)?.x ?? 0}px` }} />
                  )}
                </For>
                <div class="bn-lanes__rows">
                  <For each={lanes.ids()}>
                    {(id, index) => (
                      <Lane
                        lane={() => lanes.get(id)}
                        index={index}
                        ready={ready}
                        animate={props.animate}
                        inspection={inspection}
                        geometry={geometry}
                      />
                    )}
                  </For>
                </div>
                <svg
                  class="bn-lanes__links"
                  width={measured().width}
                  height={measured().height}
                  aria-hidden="true"
                >
                  <For each={connectors.ids()}>
                    {(id) => (
                      <Show when={connectors.get(id)}>
                        {(link) => {
                          const enter = untrack(ready) && props.animate;
                          const [drawing, setDrawing] = createSignal(enter);
                          const mask = `bn-handoff-${createUniqueId()}`;
                          return (
                            <g
                              class="bn-link"
                              data-bn-link={id}
                              data-kind={link().kind}
                              data-live={link().live ? "true" : undefined}
                              data-related={
                                inspection.active() === link().to ||
                                (link().from !== undefined && inspection.active() === link().from)
                                  ? "true"
                                  : undefined
                              }
                              data-enter={enter ? "true" : undefined}
                            >
                              <Show when={drawing()}>
                                <mask
                                  id={mask}
                                  maskUnits="userSpaceOnUse"
                                  x="0"
                                  y="0"
                                  width={measured().width}
                                  height={measured().height}
                                >
                                  <path
                                    class="bn-link__reveal"
                                    d={link().d}
                                    pathLength="1"
                                    onAnimationEnd={() => setDrawing(false)}
                                  />
                                </mask>
                              </Show>
                              <path
                                class="bn-link__path"
                                d={link().d}
                                mask={drawing() ? `url(#${mask})` : undefined}
                              />
                            </g>
                          );
                        }}
                      </Show>
                    )}
                  </For>
                </svg>
                <Show when={measured().nowX}>
                  {(x) => (
                    <span class="bn-lanes__now" style={{ transform: `translateX(${x()}px)` }} />
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
