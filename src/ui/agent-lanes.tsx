import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
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
  laneGeometry,
  laneSpan,
  LANE_HEIGHT,
  outgrowsDetail,
} from "./lane-geometry";
import { statusLabel } from "./status";

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
const LANES_ID = "bn-lanes-body";
const TIP_MARGIN = 6;

const SCALE_OPTIONS: readonly { value: LaneScale; label: string; hint: string }[] = [
  { value: "fit", label: "Fit", hint: "Whole session; older time is compressed" },
  { value: "detail", label: "Detail", hint: "True time scale; scroll for earlier work" },
];

function blockLabel(lane: LaneBox, block: BlockBox): string {
  const what = block.label ?? lane.title ?? (lane.root ? "Orchestrator turn" : "Execution");
  return `${lane.agent}: ${what}, ${statusLabel(block.status)}, ${formatDuration(block.end - block.start)}`;
}

/**
 * One execution: the block is exactly as long as it ran. Its label is a
 * separate layer that may continue past a short block into the empty lane, in
 * a quieter tone, and stops before the next block.
 */
function Block(props: {
  lane: () => LaneBox | undefined;
  block: () => BlockBox | undefined;
  enter: boolean;
}) {
  // Read once: Solid re-runs an element's attribute effects together, and a
  // block that existed before mount must never start its entrance later.
  const enter = props.enter;
  return (
    <Show when={props.block()}>
      {(block) => {
        const text = () => block().label ?? props.lane()?.title;
        return (
          <>
            <div
              class="bn-block"
              role="img"
              tabindex="0"
              aria-label={(() => {
                const lane = props.lane();
                return lane === undefined ? "" : blockLabel(lane, block());
              })()}
              data-bn-block={block().id}
              data-status={block().status}
              data-live={block().live ? "true" : undefined}
              data-enter={enter ? "true" : undefined}
              style={{ left: `${block().x}px`, width: `${block().width}px` }}
            />
            <Show when={block().labelWidth > 0 && text()}>
              <span
                class="bn-block__label"
                aria-hidden="true"
                data-status={block().status}
                data-enter={enter ? "true" : undefined}
                style={{
                  left: `${block().x}px`,
                  width: `${block().labelWidth}px`,
                  "--bn-inside": `${block().width}px`,
                }}
              >
                {text()}
              </span>
            </Show>
          </>
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
      <For each={blocks.ids()}>
        {(id) => (
          <Block
            lane={props.lane}
            block={() => blocks.get(id)}
            enter={untrack(props.ready) && props.animate}
          />
        )}
      </For>
    </div>
  );
}

interface Tip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}
/**
 * Agent Lanes: one lane per session on a shared time axis, execution blocks at
 * their real start and end, live blocks reaching for now, and dashed handoff
 * connectors from the orchestrator's call to the child block it fed.
 *
 * The region is collapsible, resizable from its top edge and scrolls on its
 * own in both directions. It follows the newest work only while the user is
 * at the right edge; once they scroll back, updates leave the view alone.
 */
export function AgentLanes(props: AgentLanesProps) {
  const Icon = props.ui.Icon;
  const [open, setOpen] = createSignal(true);
  const [height, setHeight] = createSignal(DEFAULT_HEIGHT);
  const [viewport, setViewport] = createSignal(FALLBACK_VIEWPORT);
  const [ready, setReady] = createSignal(false);
  const [drag, setDrag] = createSignal<{ y: number; height: number }>();
  let region: HTMLElement | undefined;
  let scroller: HTMLDivElement | undefined;
  let labels: HTMLDivElement | undefined;
  let pinned = true;
  let tipElement: HTMLDivElement | undefined;
  const [tip, setTip] = createSignal<Tip>();

  // The host tooltip anchors to its own trigger wrapper, which for an absolutely
  // placed block is a zero-size box at the lane's left edge; this one anchors to
  // the visible part of the hovered or focused block, inside the region.
  const showTip = (target: EventTarget | null) => {
    if (!(target instanceof Element) || region === undefined || scroller === undefined) return;
    const block = target.closest<HTMLElement>("[data-bn-block]");
    const text = block?.getAttribute("aria-label");
    if (block === null || block === undefined || !text) return;
    const box = block.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    const home = region.getBoundingClientRect();
    const left = Math.max(box.left, frame.left + (labels?.offsetWidth ?? 0));
    const right = Math.min(box.right, frame.right);
    setTip({ text, x: (left + right) / 2 - home.left, y: box.top - home.top });
  };
  const hideTip = () => setTip(undefined);

  createEffect(() => {
    const current = tip();
    if (current === undefined || tipElement === undefined || region === undefined) return;
    const half = tipElement.offsetWidth / 2;
    const max = region.clientWidth - half - TIP_MARGIN;
    tipElement.style.left = `${Math.max(half + TIP_MARGIN, Math.min(max, current.x))}px`;
  });

  // Until the user picks a scale, a session the Detail view would have to scroll opens in Fit.
  const [chosen, setChosen] = createSignal<LaneScale>();
  const scale = createMemo<LaneScale>(() => {
    const picked = chosen();
    if (picked !== undefined) return picked;
    const span = laneSpan(props.lanes, props.now)?.span ?? 0;
    return outgrowsDetail(span, viewport()) ? "fit" : "detail";
  });
  const geometry = createMemo(() => laneGeometry(props.lanes, props.now, viewport(), scale()));
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

  const maxHeight = () => {
    const host = region?.parentElement?.clientHeight ?? 0;
    return host > 0 ? Math.max(MIN_LANES_HEIGHT, host - RESERVED) : Number.POSITIVE_INFINITY;
  };
  const resize = (next: number) =>
    setHeight(Math.round(Math.min(maxHeight(), Math.max(MIN_LANES_HEIGHT, next))));

  const measure = () => {
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
    hideTip();
    if (scroller === undefined) return;
    pinned = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  };

  createEffect(on(() => geometry()?.width, followNewest));

  onMount(() => {
    setReady(true);
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(measure);
    if (scroller !== undefined) observer.observe(scroller);
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
          aria-controls={LANES_ID}
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
          aria-controls={LANES_ID}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-down" size="small" class="bn-lanes__chevron" />
          <span class="bn-lanes__title">Lanes</span>
        </button>
        <Show when={open()}>
          <div class="bn-seg" role="radiogroup" aria-label="Time scale">
            <For each={SCALE_OPTIONS}>
              {(option) => (
                <button
                  class="bn-seg__item"
                  type="button"
                  role="radio"
                  aria-checked={scale() === option.value}
                  title={option.hint}
                  data-bn-scale={option.value}
                  onClick={() => {
                    pinned = true;
                    setChosen(option.value);
                  }}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={geometry()}>
          {(measured) => <span class="bn-lanes__span">{formatDuration(measured().span)}</span>}
        </Show>
      </div>
      <div
        class="bn-lanes__scroll"
        id={LANES_ID}
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
              <div class="bn-lanes__track" style={{ width: `${measured().width}px` }}>
                <For each={ticks.ids()}>
                  {(key) => (
                    <span class="bn-lanes__grid" style={{ left: `${ticks.get(key)?.x ?? 0}px` }} />
                  )}
                </For>
                <div
                  class="bn-lanes__rows"
                  onPointerOver={(event) => showTip(event.target)}
                  onPointerOut={hideTip}
                  onFocusIn={(event) => showTip(event.target)}
                  onFocusOut={hideTip}
                >
                  <For each={lanes.ids()}>
                    {(id, index) => (
                      <Lane
                        lane={() => lanes.get(id)}
                        index={index}
                        ready={ready}
                        animate={props.animate}
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
                          return (
                            <g
                              class="bn-link"
                              data-bn-link={id}
                              data-kind={link().kind}
                              data-live={link().live ? "true" : undefined}
                              data-enter={enter ? "true" : undefined}
                            >
                              <path class="bn-link__path" d={link().d} />
                              <path class="bn-link__mark" d={link().mark} />
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
      <Show when={tip()}>
        {(current) => (
          <div
            class="bn-lanes__tip"
            role="tooltip"
            ref={(element) => {
              tipElement = element;
            }}
            style={{ left: `${current().x}px`, top: `${current().y}px` }}
          >
            {current().text}
          </div>
        )}
      </Show>
    </section>
  );
}
