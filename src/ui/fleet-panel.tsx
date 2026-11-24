import { For, Show, createMemo, createSignal } from "solid-js";

import type { AgentView, Beam, FleetView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { AgentCard } from "./agent-card";
import { Connections } from "./connections";
import { formatMoney } from "../model/format";
import { reduceMotion } from "./motion";
import { Timeline } from "./timeline";

export interface FleetPanelProps {
  readonly fleet: FleetView | undefined;
  readonly beams: readonly Beam[];
  readonly now: number;
  readonly onOpen: (sessionID: string) => void;
  readonly canOpen: (sessionID: string) => boolean;
  readonly ui: Pick<Ui, "Icon" | "Tooltip" | "Loader">;
}

function count(agents: readonly AgentView[], status: AgentView["status"]): number {
  let total = 0;
  for (const agent of agents) if (agent.status === status) total += 1;
  return total;
}

/**
 * The Agent Fleet side panel: the routed session's orchestrator, one level of
 * subagents under it, the finished ones below, and one shared timeline.
 * Read-only: every affordance either opens a session or reveals data.
 *
 * Lists are keyed by session id and the card reads its agent through a getter,
 * so a fleet object rebuilt by the one-second clock updates cards in place
 * instead of recreating them and restarting their tickers.
 */
export function FleetPanel(props: FleetPanelProps) {
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  const animate = !reduceMotion();
  let waitingCursor = 0;

  const agents = createMemo<readonly AgentView[]>(() => {
    const fleet = props.fleet;
    if (fleet === undefined) return [];
    return [fleet.root, ...fleet.active, ...fleet.inactive];
  });

  const byID = createMemo<ReadonlyMap<string, AgentView>>(() => {
    const map = new Map<string, AgentView>();
    for (const agent of agents()) map.set(agent.sessionID, agent);
    return map;
  });

  const ids = (list: readonly AgentView[] | undefined) =>
    list === undefined ? [] : list.map((agent) => agent.sessionID);
  const activeIDs = createMemo<readonly string[]>(() => ids(props.fleet?.active), [], {
    equals: (a, b) => a.join("\u0000") === b.join("\u0000"),
  });
  const inactiveIDs = createMemo<readonly string[]>(() => ids(props.fleet?.inactive), [], {
    equals: (a, b) => a.join("\u0000") === b.join("\u0000"),
  });
  const rowIDs = createMemo<readonly string[]>(() => [...activeIDs(), ...inactiveIDs()]);

  const running = () => count(agents(), "running");
  const waiting = () => count(agents(), "waiting");

  const jumpToWaiting = () => {
    const cards = panel()?.querySelectorAll("[data-bn-waiting] [data-bn-open]");
    if (cards === undefined || cards.length === 0) return;
    const next = cards[waitingCursor % cards.length];
    waitingCursor += 1;
    if (next instanceof HTMLElement) next.focus();
  };

  const card = (id: string, root: boolean, inactive: boolean) => (
    <Show when={byID().get(id)}>
      {(agent) => (
        <AgentCard
          agent={agent()}
          root={root}
          inactive={inactive}
          now={props.now}
          openable={props.canOpen(id)}
          animate={animate}
          ui={props.ui}
          onOpen={props.onOpen}
        />
      )}
    </Show>
  );

  return (
    <div class="bn-panel" data-bn-panel="true" ref={setPanel}>
      <Show when={props.fleet} fallback={<p class="bn-empty">No session.</p>}>
        {(fleet) => (
          <>
            <header class="bn-head">
              <span class="bn-head__stats">
                <span>
                  {agents().length} {agents().length === 1 ? "agent" : "agents"}
                </span>
                <Show when={running() > 0}>
                  <span>{running()} running</span>
                </Show>
              </span>
              <Show when={waiting() > 0}>
                <button
                  class="bn-needs"
                  type="button"
                  onClick={jumpToWaiting}
                  aria-label={`Go to the next agent that needs you, ${waiting()} waiting`}
                >
                  <span class="bn-needs__dot" aria-hidden="true" />
                  {waiting()} {waiting() === 1 ? "needs" : "need"} you
                </button>
              </Show>
              <Show when={fleet().totalCost}>
                {(cost) => (
                  <span class="bn-head__cost" title="Known family cost">
                    {formatMoney(cost())}
                  </span>
                )}
              </Show>
            </header>

            <div class="bn-tree" ref={setHost}>
              {card(fleet().root.sessionID, true, false)}
              <Show when={rowIDs().length > 0}>
                <div class="bn-branch">
                  <For each={activeIDs()}>{(id) => card(id, false, false)}</For>
                  <Show when={inactiveIDs().length > 0}>
                    <div
                      class="bn-group"
                      data-after-active={activeIDs().length > 0 ? "true" : undefined}
                    >
                      Finished
                      <span class="bn-group__count">{inactiveIDs().length}</span>
                    </div>
                    <For each={inactiveIDs()}>{(id) => card(id, false, true)}</For>
                  </Show>
                </div>
              </Show>
              <Connections
                host={host()}
                sessionIDs={rowIDs()}
                beams={props.beams}
                animate={animate}
              />
            </div>
            <Timeline fleet={fleet()} now={props.now} />
          </>
        )}
      </Show>
    </div>
  );
}
