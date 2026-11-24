import { Show, createSignal, type JSX } from "solid-js";

import type { AgentView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { ContextRing, contextSummary } from "./context-ring";
import { formatClock, formatElapsed, formatMoney } from "../model/format";
import { ProviderLogo } from "./provider-logo";
import { StatusMark } from "./status-mark";
import { statusLabel } from "./status";
import { ActivityTicker } from "./ticker";

export interface AgentCardProps {
  readonly agent: AgentView;
  readonly root: boolean;
  readonly inactive: boolean;
  readonly now: number;
  readonly openable: boolean;
  readonly animate: boolean;
  readonly ui: Pick<Ui, "Icon" | "Tooltip">;
  readonly onOpen: (sessionID: string) => void;
}

/**
 * What the agent is doing right now, distinct from its task: the live tool
 * description while it runs, what blocks it while it waits, the safe failure
 * category once it failed. Finished work has no current activity.
 */
function activityLine(agent: AgentView): string | undefined {
  switch (agent.status) {
    case "running":
      return agent.activity;
    case "waiting":
      return agent.statusDetail ?? agent.activity;
    case "failed":
      return agent.errorKind === undefined ? agent.statusDetail : `Failed: ${agent.errorKind}`;
    case "unknown":
      return agent.statusDetail;
    case "done":
      return undefined;
  }
}

function effortLabel(effort: string): string {
  return `#${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function detailsID(sessionID: string): string {
  return `bn-details-${encodeURIComponent(sessionID)}`;
}

function Detail(props: { label: string; tone?: string; children: JSX.Element }) {
  return (
    <div class="bn-dl__row">
      <dt>{props.label}</dt>
      <dd data-tone={props.tone}>{props.children}</dd>
    </div>
  );
}

export function AgentCard(props: AgentCardProps) {
  const [expanded, setExpanded] = createSignal(false);
  // Details mount on the first expand and then stay, so closing can animate out.
  const [revealed, setRevealed] = createSignal(false);
  const Icon = props.ui.Icon;
  const Tooltip = props.ui.Tooltip;

  const live = () => props.agent.status === "running" || props.agent.status === "waiting";
  const elapsed = () =>
    formatElapsed(props.agent.startedAt, props.agent.endedAt, props.now, live());
  const activity = () => activityLine(props.agent);
  const changed = () => {
    const lines = props.agent.lines;
    return lines !== undefined && (lines.added > 0 || lines.removed > 0) ? lines : undefined;
  };

  const open = () => {
    if (props.openable) props.onOpen(props.agent.sessionID);
  };

  // Marks and metrics sit above the full-card button so their tooltips work;
  // a click on them still opens the session like the rest of the card.
  const forward = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("button, .bn-card__details"))
      return;
    open();
  };

  const openLabel = () => {
    const agent = props.agent;
    const subject = agent.title === undefined ? agent.agent : `${agent.agent}, ${agent.title}`;
    return `Open ${subject}, ${statusLabel(agent.status)}`;
  };

  return (
    <article
      class="bn-card"
      data-kind={props.root ? "root" : "child"}
      data-inactive={props.inactive ? "true" : undefined}
      data-current={props.agent.current ? "true" : undefined}
      data-status={props.agent.status}
      data-openable={props.openable ? "true" : "false"}
      data-bn-anchor={props.agent.sessionID}
      data-bn-waiting={props.agent.status === "waiting" ? "true" : undefined}
      data-bn-card={props.agent.sessionID}
    >
      <button
        class="bn-card__open"
        type="button"
        data-bn-open="true"
        disabled={!props.openable}
        aria-label={openLabel()}
        aria-current={props.agent.current ? "true" : undefined}
        onClick={open}
      />
      <div class="bn-card__body" onClick={forward}>
        <div class="bn-row bn-row--head">
          <span class="bn-badge">{props.agent.agent}</span>
          <Show when={props.agent.title}>{(title) => <span class="bn-title">{title()}</span>}</Show>
          <span class="bn-card__mark">
            <StatusMark agent={props.agent} animate={props.animate} ui={props.ui} />
          </span>
        </div>

        <div class="bn-row bn-row--work" data-tone={props.agent.status}>
          <Show when={props.agent.task}>{(task) => <span class="bn-task">{task()}</span>}</Show>
          <Show when={props.agent.task !== undefined && activity() !== undefined}>
            <span class="bn-sep" aria-hidden="true">
              •
            </span>
          </Show>
          <ActivityTicker text={activity()} animate={props.animate} />
        </div>

        <div class="bn-row bn-row--meta">
          <Show when={props.agent.model}>
            {(model) => (
              <span class="bn-model">
                <ProviderLogo providerID={model().providerID} />
                <span class="bn-model__name">{model().name}</span>
                <Show when={props.agent.effort}>
                  {(effort) => <span class="bn-model__effort">{effortLabel(effort())}</span>}
                </Show>
              </span>
            )}
          </Show>
          <span class="bn-metrics">
            <Show when={changed()}>
              {(lines) => (
                <span
                  class="bn-lines"
                  aria-label={`${lines().added} lines added, ${lines().removed} removed`}
                >
                  <span class="bn-lines__add">+{lines().added}</span>
                  <span class="bn-lines__del">−{lines().removed}</span>
                </span>
              )}
            </Show>
            <Show when={elapsed()}>{(duration) => <span>{duration()}</span>}</Show>
            <Show when={props.agent.cost}>
              {(cost) => (
                <Show when={cost().estimated} fallback={<span>{formatMoney(cost())}</span>}>
                  <Tooltip value="Estimated at API list price">
                    <span class="bn-metrics__tip">{formatMoney(cost())}</span>
                  </Tooltip>
                </Show>
              )}
            </Show>
            <Show when={props.agent.context}>
              {(context) => (
                <Show when={contextSummary(context())}>
                  {(summary) => (
                    <Tooltip value={`Context ${summary()}`}>
                      <span class="bn-metrics__tip">
                        <ContextRing context={context()} />
                      </span>
                    </Tooltip>
                  )}
                </Show>
              )}
            </Show>
            <button
              class="bn-more"
              type="button"
              data-bn-more="true"
              aria-expanded={expanded()}
              aria-controls={detailsID(props.agent.sessionID)}
              aria-label={`${expanded() ? "Hide" : "Show"} details for ${props.agent.agent}`}
              onClick={() => {
                setRevealed(true);
                setExpanded((value) => !value);
              }}
            >
              <Icon name="chevron-down" size="small" class="bn-more__chevron" />
            </button>
          </span>
        </div>

        <Show when={revealed()}>
          <div
            class="bn-reveal"
            data-open={expanded() ? "true" : undefined}
            inert={!expanded()}
            aria-hidden={expanded() ? undefined : "true"}
          >
            <div class="bn-reveal__inner">
              <dl class="bn-card__details bn-dl" id={detailsID(props.agent.sessionID)}>
                <Show when={props.agent.title}>
                  {(title) => <Detail label="Session">{title()}</Detail>}
                </Show>
                <Show when={props.agent.task}>
                  {(task) => (
                    <Detail label="Task">
                      <span class="bn-dl__task">{task()}</span>
                    </Detail>
                  )}
                </Show>
                <Show when={activity()}>
                  {(line) => (
                    <Detail label="Now" tone={props.agent.status}>
                      {line()}
                    </Detail>
                  )}
                </Show>
                <Show when={props.agent.model}>
                  {(model) => (
                    <Detail label="Model">
                      {model().name}
                      <Show when={props.agent.effort}>
                        {(effort) => ` ${effortLabel(effort())}`}
                      </Show>
                    </Detail>
                  )}
                </Show>
                <Show when={props.agent.startedAt}>
                  {(started) => (
                    <Detail label="Time">
                      {formatClock(started())}
                      <Show when={props.agent.endedAt}>
                        {(ended) => ` – ${formatClock(ended())}`}
                      </Show>
                      <Show when={elapsed()}>{(duration) => ` · ${duration()}`}</Show>
                    </Detail>
                  )}
                </Show>
                <Show when={props.agent.context}>
                  {(context) => (
                    <Show when={contextSummary(context())}>
                      {(summary) => <Detail label="Context">{summary()}</Detail>}
                    </Show>
                  )}
                </Show>
                <Show when={props.agent.cost}>
                  {(cost) => (
                    <Detail label="Cost">
                      {formatMoney(cost())}
                      <Show when={cost().estimated}> · estimated at list price</Show>
                    </Detail>
                  )}
                </Show>
                <Show when={changed()}>
                  {(lines) => (
                    <Detail label="Lines">
                      <span class="bn-lines__add">+{lines().added}</span>{" "}
                      <span class="bn-lines__del">−{lines().removed}</span>
                    </Detail>
                  )}
                </Show>
              </dl>
            </div>
          </div>
        </Show>
      </div>
    </article>
  );
}
