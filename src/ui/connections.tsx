import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import type { Beam } from "../model/types";

interface RowWire {
  readonly sessionID: string;
  readonly centerY: number;
  readonly line: string;
  readonly out: string;
  readonly back: string;
}

interface Geometry {
  readonly nodeX: number;
  readonly nodeY: number;
  readonly spine: string;
  readonly rows: readonly RowWire[];
  readonly bySession: ReadonlyMap<string, RowWire>;
}

const SPINE_X = 9.5;
const NODE_GAP = 6;
const CORNER = 4;

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
 * Blue elbow lines from the orchestrator to each card, plus a marker that
 * travels along one on an observed delegation or result. Geometry is measured
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

    const nodeY = Math.round(root.getBoundingClientRect().bottom - hostRect.top) + NODE_GAP + 0.5;
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
    setGeometry({
      nodeX: SPINE_X,
      nodeY,
      spine: `M ${SPINE_X} ${nodeY} V ${last.centerY}`,
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
            <circle class="bn-node" cx={measured().nodeX} cy={measured().nodeY} r="2.4" />
            <path class="bn-wire" d={measured().spine} />
            <For each={measured().rows}>{(row) => <path class="bn-wire" d={row.line} />}</For>
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
