import { Show, createSignal } from "solid-js";

import type { AgentView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { ContextRing } from "./context-ring";
import { formatClock, formatElapsed, formatMoney, formatTokens } from "../model/format";
import { ProviderLogo } from "./provider-logo";
import { statusIcon, statusLabel } from "./status";
import { ActivityTicker } from "./ticker";

export interface AgentCardProps {
  readonly agent: AgentView;
  readonly root: boolean;
  readonly inactive: boolean;
  readonly now: number;
  readonly openable: boolean;
  readonly ui: Pick<Ui, "Icon">;
  readonly onOpen: (sessionID: string) => void;
}

function visibleLine(agent: AgentView): string | undefined {
  switch (agent.status) {
    case "running":
      return agent.activity ?? agent.statusDetail;
    case "waiting":
      // What the session is blocked on matters more than its last activity.
      return agent.statusDetail ?? agent.activity;
    case "failed":
      return agent.errorKind === undefined
        ? (agent.statusDetail ?? agent.activity)
        : `Failed: ${agent.errorKind}`;
    case "unknown":
      return agent.statusDetail ?? agent.task ?? agent.activity;
    case "done":
      return agent.task ?? agent.activity;
  }
}

function detailsID(sessionID: string): string {
  return `bn-details-${encodeURIComponent(sessionID)}`;
}

function contextText(context: { used: number; limit: number }): string {
  if (context.limit <= 0) return `${formatTokens(context.used)} tokens`;
  const percent = Math.min(100, Math.round((context.used / context.limit) * 100));
  return `${percent}% · ${formatTokens(context.used)} of ${formatTokens(context.limit)}`;
}

export function AgentCard(props: AgentCardProps) {
  const [expanded, setExpanded] = createSignal(false);
  const Icon = props.ui.Icon;

  const elapsed = () =>
    formatElapsed(
      props.agent.startedAt,
      props.agent.endedAt,
      props.now,
      props.agent.status === "running" || props.agent.status === "waiting",
    );
  const detailsFor = () => detailsID(props.agent.sessionID);
  const openable = () => props.openable;

  const openLabel = () => {
    const agent = props.agent;
    const subject = agent.title === undefined ? agent.agent : `${agent.agent} — ${agent.title}`;
    return `Open ${subject}, ${statusLabel(agent.status)}`;
  };

  const detailsLabel = () => {
    const action = expanded() ? "Hide" : "Show";
    return `${action} details for ${props.agent.agent}`;
  };

  return (
    <article
      class="bn-card"
      data-kind={props.root ? "root" : "child"}
      data-inactive={props.inactive ? "true" : undefined}
      data-current={props.agent.current ? "true" : undefined}
      data-status={props.agent.status}
      data-openable={openable() ? "true" : "false"}
      data-bn-anchor={props.agent.sessionID}
      data-bn-waiting={props.agent.status === "waiting" ? "true" : undefined}
      data-bn-card={props.agent.sessionID}
    >
      <button
        class="bn-card__open"
        type="button"
        data-bn-open="true"
        disabled={!openable()}
        aria-label={openLabel()}
        aria-current={props.agent.current ? "true" : undefined}
        onClick={() => props.onOpen(props.agent.sessionID)}
      />
      <div class="bn-card__body">
        <div class="bn-card__title">
          <ProviderLogo providerID={props.agent.model?.providerID} />
          <div class="bn-card__identity">
            <span class="bn-card__name" title={props.agent.agent}>
              {props.agent.agent}
            </span>
            <Show when={props.agent.title}>
              {(title) => (
                <>
                  <span class="bn-card__dot" aria-hidden="true">
                    •
                  </span>
                  <span class="bn-card__session" title={title()}>
                    {title()}
                  </span>
                </>
              )}
            </Show>
          </div>
          <span class="bn-chip" data-tone={props.agent.status}>
            <Show
              when={props.agent.status === "running"}
              fallback={<Icon name={statusIcon(props.agent.status)} class="bn-chip__icon" />}
            >
              <span class="bn-spin" aria-hidden="true" />
            </Show>
            <span>{statusLabel(props.agent.status)}</span>
          </span>
        </div>

        <div class="bn-card__live" data-tone={props.agent.status}>
          <ActivityTicker text={visibleLine(props.agent)} live={props.agent.status === "running"} />
          <Show when={props.agent.model}>
            {(model) => (
              <span class="bn-card__model" title={model().name}>
                {model().name}
              </span>
            )}
          </Show>
        </div>

        <div class="bn-card__foot">
          <span class="bn-metrics">
            <Show when={props.agent.cost}>
              {(cost) => (
                <span
                  class="bn-metrics__item"
                  title={cost().estimated ? "Estimated at API list price" : undefined}
                >
                  {formatMoney(cost())}
                </span>
              )}
            </Show>
            <Show when={elapsed()}>
              {(duration) => <span class="bn-metrics__item">{duration()}</span>}
            </Show>
            <Show when={props.agent.lines}>
              {(lines) => (
                <Show when={lines().added > 0 || lines().removed > 0}>
                  <span class="bn-metrics__item bn-diff">
                    <span class="bn-add">+{lines().added}</span>
                    <span class="bn-del">−{lines().removed}</span>
                  </span>
                </Show>
              )}
            </Show>
          </span>
          <span class="bn-card__aside">
            <Show when={props.agent.context}>
              {(context) => <ContextRing context={context()} />}
            </Show>
            <button
              class="bn-more"
              type="button"
              data-bn-more="true"
              aria-expanded={expanded()}
              aria-controls={detailsFor()}
              aria-label={detailsLabel()}
              onClick={() => setExpanded((open) => !open)}
            >
              <Icon name="chevron-down" class="bn-more__chevron" />
            </button>
          </span>
        </div>

        <Show when={expanded()}>
          <div class="bn-card__details" id={detailsFor()}>
            <dl class="bn-dl">
              <Show when={props.agent.task}>
                {(task) => (
                  <div class="bn-dl__row">
                    <dt>Task</dt>
                    <dd class="bn-dl__task">{task()}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.model}>
                {(model) => (
                  <div class="bn-dl__row">
                    <dt>Model</dt>
                    <dd>{model().name}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.startedAt}>
                {(started) => (
                  <div class="bn-dl__row">
                    <dt>Started</dt>
                    <dd>{formatClock(started())}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.endedAt}>
                {(ended) => (
                  <div class="bn-dl__row">
                    <dt>Ended</dt>
                    <dd>{formatClock(ended())}</dd>
                  </div>
                )}
              </Show>
              <Show when={elapsed()}>
                {(duration) => (
                  <div class="bn-dl__row">
                    <dt>Duration</dt>
                    <dd>{duration()}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.activity}>
                {(activity) => (
                  <div class="bn-dl__row">
                    <dt>Activity</dt>
                    <dd>{activity()}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.statusDetail}>
                {(detail) => (
                  <div class="bn-dl__row">
                    <dt>{props.agent.status === "waiting" ? "Waiting" : "Status"}</dt>
                    <dd class={props.agent.status === "waiting" ? "bn-dl__waiting" : undefined}>
                      {detail()}
                    </dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.context}>
                {(context) => (
                  <div class="bn-dl__row">
                    <dt>Context</dt>
                    <dd>{contextText(context())}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.cost}>
                {(cost) => (
                  <div class="bn-dl__row">
                    <dt>Cost</dt>
                    <dd>
                      {formatMoney(cost())}
                      <Show when={cost().estimated}>
                        <span class="bn-dl__note"> · estimated at list price</span>
                      </Show>
                    </dd>
                  </div>
                )}
              </Show>
              <Show when={props.agent.errorKind}>
                {(kind) => (
                  <div class="bn-dl__row">
                    <dt>Error</dt>
                    <dd class="bn-dl__error">Failed: {kind()}</dd>
                  </div>
                )}
              </Show>
            </dl>
          </div>
        </Show>
      </div>
    </article>
  );
}
