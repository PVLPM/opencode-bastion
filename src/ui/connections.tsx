import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import type { Beam } from "../model/types";

interface RowWire {
  readonly sessionID: string;
  readonly centerY: number;
  readonly inactive: boolean;
  readonly line: string;
  readonly out: string;
  readonly back: string;
}

interface Geometry {
  readonly spine: string;
  readonly spineTail: string | undefined;
  readonly rows: readonly RowWire[];
  readonly bySession: ReadonlyMap<string, RowWire>;
}

const SPINE_X = 10.5;
const CORNER = 6;

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
 * Quiet elbow lines from the orchestrator to each card (live ones a step
 * brighter), plus a marker that travels along one only on an observed
 * delegation or result; nothing here loops. Geometry is measured
 * from the rendered cards, so indentation and wrapping never desynchronize the
 * wires from the list.
 */
export function Connections(props: {
  readonly host: HTMLElement | undefined;
  readonly sessionIDs: readonly string[];
  readonly beams: readonly Beam[];
  readonly animate: boolean;
}) {
  const [geometry, setGeometry] = createSignal<Geometry>();
  const rowKey = createMemo(() => props.sessionIDs.join("\u0000"));

  const measure = () => {
    const host = props.host;
    if (host === undefined) return;
    const hostRect = host.getBoundingClientRect();
    const root = host.querySelector('[data-bn-anchor][data-kind="root"]');
    if (!(root instanceof HTMLElement)) return;

    const nodeY = Math.round(root.getBoundingClientRect().bottom - hostRect.top);
    const rows: RowWire[] = [];
    const bySession = new Map<string, RowWire>();

    for (const element of host.querySelectorAll('[data-bn-anchor][data-kind="child"]')) {
      if (!(element instanceof HTMLElement)) continue;
      const sessionID = element.dataset.bnAnchor;
      if (sessionID === undefined) continue;
      const rect = element.getBoundingClientRect();
      const centerY = Math.round(rect.top - hostRect.top + rect.height / 2) + 0.5;
      const cardLeft = rect.left - hostRect.left;
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
    const lastActive = rows.findLast((row) => !row.inactive)?.centerY ?? nodeY;
    setGeometry({
      spine: `M ${SPINE_X} ${nodeY} V ${lastActive}`,
      spineTail:
        last.centerY > lastActive ? `M ${SPINE_X} ${lastActive} V ${last.centerY}` : undefined,
      rows,
      bySession,
    });
  };

  createEffect(() => {
    rowKey();
    measure();
  });

  onMount(() => {
    measure();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(() => measure());
    if (props.host !== undefined) observer.observe(props.host);
    onCleanup(() => observer.disconnect());
  });

  const wireFor = (sessionID: string) => geometry()?.bySession.get(sessionID);

  return (
    <Show when={geometry()}>
      {(measured) => (
        <div class="bn-wires" aria-hidden="true">
          <svg class="bn-wires__svg">
            <path class="bn-wire" d={measured().spine} />
            <Show when={measured().spineTail}>
              {(tail) => <path class="bn-wire bn-wire--quiet" d={tail()} />}
            </Show>
            <For each={measured().rows}>
              {(row) => (
                <path
                  class={row.inactive ? "bn-wire bn-wire--quiet" : "bn-wire"}
                  data-bn-wire={row.sessionID}
                  data-inactive={row.inactive ? "true" : undefined}
                  d={row.line}
                />
              )}
            </For>
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
