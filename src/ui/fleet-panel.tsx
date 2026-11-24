import { For, Show, createMemo, createSignal } from "solid-js";

import type { AgentView, Beam, FleetView, LanesView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { AgentCard } from "./agent-card";
import { AgentLanes } from "./agent-lanes";
import { Connections } from "./connections";
import { createFlip } from "./flip";
import { createKeyed } from "./keyed";
import { formatMoney } from "../model/format";
import { reduceMotion } from "./motion";

export interface FleetPanelProps {
  readonly fleet: FleetView | undefined;
  readonly lanes: LanesView | undefined;
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

const bySession = (agent: AgentView) => agent.sessionID;

/**
 * The Agent Fleet side panel: a fixed summary line, the orchestrator with one
 * level of subagents under it (finished ones last) in their own scroll area,
 * and the Agent Lanes region below. Read-only: every affordance either opens a
 * session or reveals data.
 *
 * Lists are keyed by session id and each card reads its agent through a getter,
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
  const all = createKeyed(agents, bySession);
  const active = createKeyed(() => props.fleet?.active ?? [], bySession);
  const inactive = createKeyed(() => props.fleet?.inactive ?? [], bySession);
  const rowIDs = createMemo<readonly string[]>(() => [...active.ids(), ...inactive.ids()]);

  // A card joining, or moving between Active and Finished, glides to its new place.
  createFlip(
    host,
    () => `${active.ids().join(",")}|${inactive.ids().join(",")}`,
    "[data-bn-card], .bn-group",
    (element) =>
      element.dataset.bnCard ?? (element.classList.contains("bn-group") ? "" : undefined),
    animate,
  );

  const running = () => count(agents(), "running");
  const waiting = () => count(agents(), "waiting");

  const jumpToWaiting = () => {
    const cards = panel()?.querySelectorAll("[data-bn-waiting] [data-bn-open]");
    if (cards === undefined || cards.length === 0) return;
    const next = cards[waitingCursor % cards.length];
    waitingCursor += 1;
    if (next instanceof HTMLElement) next.focus();
  };

  const card = (id: string, root: boolean, finished: boolean) => (
    <Show when={all.get(id)}>
      {(agent) => (
        <AgentCard
          agent={agent()}
          root={root}
          inactive={finished}
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

            <div class="bn-cards">
              <div class="bn-tree" ref={setHost}>
                {card(fleet().root.sessionID, true, false)}
                <Show when={rowIDs().length > 0}>
                  <div class="bn-branch">
                    <For each={active.ids()}>{(id) => card(id, false, false)}</For>
                    <Show when={inactive.ids().length > 0}>
                      <div
                        class="bn-group"
                        data-after-active={active.ids().length > 0 ? "true" : undefined}
                      >
                        Finished
                        <span class="bn-group__count">{inactive.ids().length}</span>
                      </div>
                      <For each={inactive.ids()}>{(id) => card(id, false, true)}</For>
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
            </div>

            <Show when={props.lanes?.from === undefined ? undefined : props.lanes}>
              {(lanes) => (
                <AgentLanes lanes={lanes()} now={props.now} animate={animate} ui={props.ui} />
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
