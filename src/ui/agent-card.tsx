import { Show, createSignal, type JSX } from "solid-js";

import type { AgentView, LineStats } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { ContextRing, contextSummary } from "./context-ring";
import {
  formatClock,
  formatElapsed,
  formatMoney,
  formatTokenMetric,
  formatTokens,
} from "../model/format";
import { ProviderLogo } from "./provider-logo";
import { RollingMoney, RollingText } from "./rolling-money";
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
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function detailsID(sessionID: string): string {
  return `bn-details-${encodeURIComponent(sessionID)}`;
}

function linesLabel(lines: LineStats): string {
  const files = `${lines.files} ${lines.files === 1 ? "file" : "files"}`;
  return `${lines.added} lines added, ${lines.removed} removed, ${files}${lines.truncated ? ", partial" : ""}`;
}

function diffTooltip(truncated: boolean): string {
  return truncated
    ? "Session file diff — partial: the directory listing was truncated. Overlapping edits can appear in more than one agent."
    : "Session file diff — overlapping edits can appear in more than one agent.";
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
  const rowChanges = () => {
    const lines = props.agent.lines;
    return lines !== undefined && (lines.added > 0 || lines.removed > 0) ? lines : undefined;
  };
  const detailsChanges = () => {
    const lines = props.agent.lines;
    return lines !== undefined && (lines.added > 0 || lines.removed > 0 || lines.files > 0)
      ? lines
      : undefined;
  };
  const contextSummaryText = () => {
    const context = props.agent.context;
    return context === undefined ? undefined : contextSummary(context);
  };
  // A group's divider is rendered with the group itself, so it can never
  // separate the list from nothing.
  const hasModelGroup = () =>
    props.agent.model !== undefined ||
    props.agent.cost !== undefined ||
    props.agent.startedAt !== undefined ||
    detailsChanges() !== undefined;
  const hasUsageGroup = () =>
    contextSummaryText() !== undefined || props.agent.tokens !== undefined;

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
          {/* The duration and mark stay together at the trailing edge while the title truncates. */}
          <span class="bn-card__end">
            <Show when={elapsed()}>
              {(duration) => <span class="bn-duration">{duration()}</span>}
            </Show>
            <span class="bn-card__mark">
              <StatusMark agent={props.agent} animate={props.animate} ui={props.ui} />
            </span>
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
          <Show when={rowChanges()}>
            {(lines) => (
              <span class="bn-work__diff">
                <Tooltip value={diffTooltip(lines().truncated)}>
                  <span class="bn-lines" role="img" aria-label={linesLabel(lines())}>
                    <span class="bn-lines__add">+{lines().added}</span>
                    <span class="bn-lines__del">−{lines().removed}</span>
                  </span>
                </Tooltip>
              </span>
            )}
          </Show>
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
            <Show when={props.agent.tokens}>
              {(tokens) => (
                <Tooltip value="Total tokens this session has consumed, including reasoning and cache reads and writes">
                  <span class="bn-metrics__tip">
                    <RollingText text={formatTokenMetric(tokens().total)} />
                  </span>
                </Tooltip>
              )}
            </Show>
            <span class="bn-metrics__cost">
              <Show when={props.agent.cost}>
                {(cost) => {
                  const amount = <RollingMoney value={cost()} />;
                  return (
                    <Show when={cost().estimated} fallback={amount}>
                      <Tooltip value="Estimated at API list price">
                        <span class="bn-metrics__tip">{amount}</span>
                      </Tooltip>
                    </Show>
                  );
                }}
              </Show>
            </span>
            <span class="bn-metrics__context">
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
            </span>
            <button
              class="bn-more"
              type="button"
              data-bn-more="true"
              aria-expanded={expanded()}
              aria-controls={detailsID(props.agent.sessionID)}
              aria-label={`${expanded() ? "Hide" : "Show"} details for ${props.agent.agent}${props.agent.title === undefined ? "" : `, ${props.agent.title}`}`}
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
                <div class="bn-dl__group">
                  <Detail label="Agent">{props.agent.agent}</Detail>
                  <Show when={props.agent.title}>
                    {(title) => <Detail label="Session">{title()}</Detail>}
                  </Show>
                  <Show when={props.agent.taskText}>
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
                </div>
                <Show when={hasModelGroup()}>
                  <div class="bn-dl__group">
                    <div class="bn-dl__rule" aria-hidden="true" />
                    <Show when={props.agent.model}>
                      {(model) => (
                        <>
                          <Detail label="Provider">
                            <span class="bn-dl__provider">
                              <ProviderLogo providerID={model().providerID} />
                              <span>{model().providerName}</span>
                            </span>
                          </Detail>
                          <Detail label="Model">
                            {model().name}
                            <Show when={props.agent.effort}>
                              {(effort) => ` ${effortLabel(effort())}`}
                            </Show>
                          </Detail>
                        </>
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
                    <Show when={detailsChanges()}>
                      {(lines) => (
                        <Detail label="Changes">
                          <span class="bn-changes">
                            <span class="bn-lines__add">+{lines().added}</span>
                            <span class="bn-lines__del">−{lines().removed}</span>
                            <span class="bn-changes__files">
                              <span class="bn-changes__bullet" aria-hidden="true">
                                •
                              </span>{" "}
                              {lines().files} {lines().files === 1 ? "file" : "files"}
                            </span>
                            <Show when={lines().truncated}>
                              <span class="bn-changes__partial">· partial</span>
                            </Show>
                          </span>
                        </Detail>
                      )}
                    </Show>
                  </div>
                </Show>
                <Show when={hasUsageGroup()}>
                  <div class="bn-dl__group">
                    <div class="bn-dl__rule" aria-hidden="true" />
                    <Show when={contextSummaryText()}>
                      {(summary) => <Detail label="Context">{summary()}</Detail>}
                    </Show>
                    <Show when={props.agent.tokens}>
                      {(tokens) => (
                        <>
                          <Detail label="Total tokens">{formatTokens(tokens().total)}</Detail>
                          <Detail label="Input">{formatTokens(tokens().input)}</Detail>
                          <Detail label="Output">{formatTokens(tokens().output)}</Detail>
                          <Detail label="Reasoning">{formatTokens(tokens().reasoning)}</Detail>
                          <Detail label="Cache read">{formatTokens(tokens().cacheRead)}</Detail>
                          <Detail label="Cache write">{formatTokens(tokens().cacheWrite)}</Detail>
                        </>
                      )}
                    </Show>
                  </div>
                </Show>
              </dl>
            </div>
          </div>
        </Show>
      </div>
    </article>
  );
}
