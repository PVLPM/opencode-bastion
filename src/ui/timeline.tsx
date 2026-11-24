import { For, Show, createMemo } from "solid-js";

import type { AgentStatus, AgentView, FleetView } from "../model/types";
import { formatDuration } from "./format";

interface Bar {
  readonly sessionID: string;
  readonly left: number;
  readonly width: number;
  readonly status: AgentStatus;
  readonly inactive: boolean;
}

interface Timeline {
  readonly bars: readonly Bar[];
  readonly span: number;
}

function endOf(agent: AgentView, now: number): number | undefined {
  if (agent.startedAt === undefined) return undefined;
  if (agent.endedAt !== undefined) return agent.endedAt;
  if (agent.status === "running" || agent.status === "waiting") return now;
  return undefined;
}

/**
 * One shared time axis for the family, one thin row per agent, so staggered and
 * concurrent work is legible without turning into a trace waterfall. The cards
 * above carry the labels; this stays a glanceable strip.
 */
export function Timeline(props: { fleet: FleetView; now: number }) {
  const model = createMemo<Timeline | undefined>(() => {
    const agents: AgentView[] = [props.fleet.root, ...props.fleet.active, ...props.fleet.inactive];
    const spans: { agent: AgentView; start: number; end: number }[] = [];
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;

    for (const agent of agents) {
      const start = agent.startedAt;
      const end = endOf(agent, props.now);
      if (start === undefined || end === undefined || end < start) continue;
      spans.push({ agent, start, end });
      from = Math.min(from, start);
      to = Math.max(to, end);
    }

    if (spans.length < 2 || to <= from) return undefined;
    const total = to - from;
    const bars = spans.map(({ agent, start, end }) => {
      const width = Math.max(((end - start) / total) * 100, 0.8);
      const left = Math.min(((start - from) / total) * 100, 100 - width);
      return {
        sessionID: agent.sessionID,
        left,
        width,
        status: agent.status,
        inactive: agent.endedAt !== undefined,
      };
    });
    return { bars, span: total };
  });

  return (
    <Show when={model()}>
      {(timeline) => (
        <section class="bn-timeline" aria-hidden="true">
          <div class="bn-timeline__head">
            <span>Timeline</span>
            <span class="bn-timeline__total">{formatDuration(timeline().span)}</span>
          </div>
          <div class="bn-timeline__rows">
            <For each={timeline().bars}>
              {(bar) => (
                <span class="bn-timeline__row">
                  <span
                    class="bn-timeline__bar"
                    data-status={bar.status}
                    data-inactive={bar.inactive ? "true" : undefined}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  />
                </span>
              )}
            </For>
          </div>
        </section>
      )}
    </Show>
  );
}
