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

/**
 * The Agent Fleet side panel: the routed session's orchestrator, one level of
 * subagents under it, the ones that finished or failed below, and one shared
 * timeline. Read-only: every affordance either opens a session or reveals data.
 *
 * Lists are keyed by session id and the card reads its agent through a getter,
 * so a fleet object rebuilt by the one-second clock updates cards in place
 * instead of recreating them and restarting their tickers.
 */
export function FleetPanel(props: FleetPanelProps) {
  const Icon = props.ui.Icon;
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  const animate = !reduceMotion();
  let waitingCursor = 0;

  const agents = createMemo<readonly AgentView[]>(() => {
    const fleet = props.fleet;
    if (fleet === undefined) return [];
    const all: AgentView[] = [fleet.root];
    for (const agent of fleet.active) all.push(agent);
    for (const agent of fleet.inactive) all.push(agent);
    return all;
  });

  const byID = createMemo<ReadonlyMap<string, AgentView>>(() => {
    const map = new Map<string, AgentView>();
    for (const agent of agents()) map.set(agent.sessionID, agent);
    return map;
  });

  const activeIDs = createMemo<readonly string[]>(() => {
    const ids: string[] = [];
    if (props.fleet !== undefined)
      for (const agent of props.fleet.active) ids.push(agent.sessionID);
    return ids;
  });

  const inactiveIDs = createMemo<readonly string[]>(() => {
    const ids: string[] = [];
    if (props.fleet !== undefined)
      for (const agent of props.fleet.inactive) ids.push(agent.sessionID);
    return ids;
  });

  const running = () => {
    let count = 0;
    for (const agent of agents()) if (agent.status === "running") count += 1;
    return count;
  };

  const waiting = () => {
    let count = 0;
    for (const agent of agents()) if (agent.status === "waiting") count += 1;
    return count;
  };

  const agentsLabel = () => {
    const count = agents().length;
    return `${count} ${count === 1 ? "agent" : "agents"}`;
  };

  const rowIDs = createMemo<readonly string[]>(() => [...activeIDs(), ...inactiveIDs()]);

  const jumpToWaiting = () => {
    const cards = panel()?.querySelectorAll("[data-bn-waiting] [data-bn-open]");
    if (cards === undefined || cards.length === 0) return;
    const next = cards[waitingCursor % cards.length];
    waitingCursor += 1;
    if (next instanceof HTMLElement) next.focus();
  };

  const card = (id: string, inactive: boolean) => (
    <Show when={byID().get(id)}>
      {(agent) => (
        <AgentCard
          agent={agent()}
          root={false}
          inactive={inactive}
          now={props.now}
          openable={props.canOpen(id)}
          ui={props.ui}
          onOpen={props.onOpen}
        />
      )}
    </Show>
  );

  return (
    <div class="bn-panel" data-bn-panel="true" ref={setPanel}>
      <header class="bn-head">
        <div class="bn-head__title">
          <Icon name="shield" class="bn-head__icon" />
          <span>Agents</span>
        </div>
        <Show when={props.fleet}>
          <div class="bn-head__stats">
            <span>{agentsLabel()}</span>
            <Show when={running() > 0}>
              <span class="bn-sep" aria-hidden="true">
                ·
              </span>
              <span>{running()} running</span>
            </Show>
            <Show when={waiting() > 0}>
              <span class="bn-sep" aria-hidden="true">
                ·
              </span>
              <button
                class="bn-needs"
                type="button"
                onClick={jumpToWaiting}
                aria-label={`Go to the next agent that needs you, ${waiting()} waiting`}
              >
                <Icon name="circle-exclamation" class="bn-needs__icon" />
                <span>
                  {waiting()} {waiting() === 1 ? "needs" : "need"} you
                </span>
              </button>
            </Show>
            <Show when={props.fleet?.totalCost}>
              {(cost) => (
                <>
                  <span class="bn-sep" aria-hidden="true">
                    ·
                  </span>
                  <span
                    class="bn-head__cost"
                    title="Reported plus estimated cost for this session's family"
                  >
                    {formatMoney(cost())}
                  </span>
                </>
              )}
            </Show>
          </div>
        </Show>
      </header>

      <Show when={props.fleet} fallback={<p class="bn-empty">No session.</p>}>
        {(fleet) => (
          <>
            <div class="bn-tree" ref={setHost}>
              <Show when={byID().get(fleet().root.sessionID)}>
                {(agent) => (
                  <AgentCard
                    agent={agent()}
                    root
                    inactive={false}
                    now={props.now}
                    openable={props.canOpen(fleet().root.sessionID)}
                    ui={props.ui}
                    onOpen={props.onOpen}
                  />
                )}
              </Show>

              <Show when={fleet().active.length > 0 || fleet().inactive.length > 0}>
                <div class="bn-branch">
                  <For each={activeIDs()}>{(id) => card(id, false)}</For>
                  <Show when={fleet().inactive.length > 0}>
                    <div class="bn-group">
                      <span class="bn-group__label">Inactive</span>
                      <span class="bn-group__count">{fleet().inactive.length}</span>
                      <span class="bn-group__rule" aria-hidden="true" />
                    </div>
                    <For each={inactiveIDs()}>{(id) => card(id, true)}</For>
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
