import { Match, Switch, createEffect, createMemo, on } from "solid-js";

import type { AgentView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { canAnimate } from "./motion";
import { statusTip } from "./status";

/**
 * The status glyph OpenCode itself puts on a session tab: the Soft Radar while
 * the agent works, a 7 px warning dot when it needs the user, a danger dot when
 * it failed. Finished work gets a quiet check and an unknown end a hollow ring,
 * so a card never shows a word-pill where the host shows a mark.
 */
export function StatusMark(props: {
  agent: AgentView;
  animate: boolean;
  ui: Pick<Ui, "Icon" | "Tooltip">;
}) {
  const Icon = props.ui.Icon;
  const Tooltip = props.ui.Tooltip;
  const tip = () => statusTip(props.agent);
  const status = createMemo(() => props.agent.status);
  let mark: HTMLSpanElement | undefined;

  // A status change swaps the glyph; the new one settles in from slightly
  // smaller so the change reads as one mark turning into another, never on mount.
  createEffect(
    on(
      status,
      () => {
        if (!props.animate || mark === undefined || !canAnimate()) return;
        mark.animate(
          [
            { opacity: 0, transform: "scale(0.6)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
      },
      { defer: true },
    ),
  );

  return (
    <Tooltip value={tip()} placement="left">
      <span
        class="bn-mark"
        ref={(element) => {
          mark = element;
        }}
        data-status={props.agent.status}
        role="img"
        aria-label={tip()}
      >
        <Switch>
          <Match when={props.agent.status === "running"}>
            <span class="bn-radar" />
          </Match>
          <Match when={props.agent.status === "waiting" || props.agent.status === "failed"}>
            <span class="bn-mark__dot" />
          </Match>
          <Match when={props.agent.status === "done"}>
            <Icon name="check-small" size="small" class="bn-mark__icon" />
          </Match>
          <Match when={props.agent.status === "unknown"}>
            <span class="bn-mark__ring" />
          </Match>
        </Switch>
      </span>
    </Tooltip>
  );
}
