import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";

import type { Beam } from "../model/types";
import { createKeyed } from "./keyed";

interface RowWire {
  readonly sessionID: string;
  readonly centerY: number;
  readonly inactive: boolean;
  readonly line: string;
  readonly out: string;
  readonly back: string;
}

interface Geometry {
  readonly nodeY: number;
  readonly live: boolean;
  readonly spine: string | undefined;
  readonly spineTail: string | undefined;
  readonly rows: readonly RowWire[];
  readonly bySession: ReadonlyMap<string, RowWire>;
}

const SPINE_X = 10.5;
const CORNER = 8;
const NODE_RADIUS = 3;

function branch(x: number, y: number, cardLeft: number): string {
  return `M ${x} ${y - CORNER} Q ${x} ${y} ${x + CORNER} ${y} H ${cardLeft - 1}`;
}

function forward(x: number, from: number, to: number, cardLeft: number): string {
  const reach = cardLeft - 1;
  if (to - from < CORNER) return `M ${x} ${from} V ${to} H ${reach}`;
  return `M ${x} ${from} V ${to - CORNER} Q ${x} ${to} ${x + CORNER} ${to} H ${reach}`;
}

function reverse(x: number, from: number, to: number, cardLeft: number): string {
  const start = cardLeft - 1;
  if (to - from < CORNER) return `M ${start} ${to} H ${x} V ${from}`;
  return `M ${start} ${to} H ${x + CORNER} Q ${x} ${to} ${x} ${to - CORNER} V ${from}`;
}

/**
 * Elbow lines from the orchestrator to each card, accent blue to live agents
 * and neutral grey to finished ones, plus a marker that travels along one only on an observed
 * delegation or result; nothing here loops. Geometry is measured
 * from the rendered cards, so indentation and wrapping never desynchronize the
 * wires from the list.
 */
export function Connections(props: {
  readonly host: HTMLElement | undefined;
  readonly arrangement: string;
  readonly beams: readonly Beam[];
  readonly animate: boolean;
}) {
  const [geometry, setGeometry] = createSignal<Geometry>();

  const measure = () => {
    const host = props.host;
    if (host === undefined) return;
    // Layout offsets, not client rects: a card mid-glide is transformed, and the
    // wires must already point at where it is going (they glide there with it).
    const root = host.querySelector('[data-bn-anchor][data-kind="root"]');
    if (!(root instanceof HTMLElement)) return;

    const nodeY = Math.round(root.offsetTop + root.offsetHeight);
    const rows: RowWire[] = [];
    const bySession = new Map<string, RowWire>();

    for (const element of host.querySelectorAll('[data-bn-anchor][data-kind="child"]')) {
      if (!(element instanceof HTMLElement)) continue;
      const sessionID = element.dataset.bnAnchor;
      if (sessionID === undefined) continue;
      const centerY = Math.round(element.offsetTop + element.offsetHeight / 2) + 0.5;
      const cardLeft = element.offsetLeft;
      const row: RowWire = {
        sessionID,
        centerY,
        inactive: element.dataset.inactive === "true",
        line: branch(SPINE_X, centerY, cardLeft),
        out: forward(SPINE_X, nodeY, centerY, cardLeft),
        back: reverse(SPINE_X, nodeY, centerY, cardLeft),
      };
      rows.push(row);
      bySession.set(sessionID, row);
    }

    const last = rows.at(-1);
    if (last === undefined) {
      setGeometry(undefined);
      return;
    }
    // Each vertical run stops where its last elbow starts curving, so no corner
    // overshoots the curve: blue down to the last live agent, grey below it.
    const lastActive = rows.findLast((row) => !row.inactive)?.centerY;
    const activeEnd = lastActive === undefined ? nodeY : lastActive - CORNER;
    const tailEnd = last.centerY - CORNER;
    setGeometry({
      nodeY,
      live: lastActive !== undefined,
      spine: activeEnd > nodeY ? `M ${SPINE_X} ${nodeY} V ${activeEnd}` : undefined,
      spineTail: tailEnd > activeEnd ? `M ${SPINE_X} ${activeEnd} V ${tailEnd}` : undefined,
      rows,
      bySession,
    });
  };

  createEffect(on(() => props.arrangement, measure));

  onMount(() => {
    measure();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(() => measure());
    if (props.host !== undefined) observer.observe(props.host);
    onCleanup(() => observer.disconnect());
  });

  const wireFor = (sessionID: string) => geometry()?.bySession.get(sessionID);
  // Keyed by session, so a wire whose card moves keeps its element and can glide.
  const rows = createKeyed(
    () => geometry()?.rows ?? [],
    (row) => row.sessionID,
  );

  return (
    <Show when={geometry()}>
      {(measured) => (
        <div class="bn-wires" aria-hidden="true">
          <svg class="bn-wires__svg">
            <Show when={measured().spine}>{(spine) => <path class="bn-wire" d={spine()} />}</Show>
            <Show when={measured().spineTail}>
              {(tail) => <path class="bn-wire bn-wire--quiet" d={tail()} />}
            </Show>
            <For each={rows.ids()}>
              {(id) => (
                <Show when={rows.get(id)}>
                  {(row) => (
                    <path
                      class={row().inactive ? "bn-wire bn-wire--quiet" : "bn-wire"}
                      data-bn-wire={id}
                      data-inactive={row().inactive ? "true" : undefined}
                      d={row().line}
                    />
                  )}
                </Show>
              )}
            </For>
            <circle
              class={
                measured().live ? "bn-wire bn-wire__node" : "bn-wire bn-wire__node bn-wire--quiet"
              }
              cx={SPINE_X}
              cy={measured().nodeY}
              r={NODE_RADIUS}
            />
          </svg>
          <Show when={props.animate}>
            <For each={props.beams}>
              {(beam) => (
                <Show when={wireFor(beam.sessionID)}>
                  {(wire) => (
                    <span
                      class="bn-beam"
                      data-bn-beam={beam.id}
                      style={{
                        "--bn-beam-path": `path("${
                          beam.direction === "out" ? wire().out : wire().back
                        }")`,
                      }}
                    />
                  )}
                </Show>
              )}
            </For>
          </Show>
        </div>
      )}
    </Show>
  );
}
