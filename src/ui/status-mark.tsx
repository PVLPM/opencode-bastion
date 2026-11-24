import { Match, Switch } from "solid-js";

import type { AgentView } from "../model/types";
import type { Ui } from "@opencode/plugin/gui";
import { statusTip } from "./status";

/**
 * The status glyph OpenCode itself puts on a session tab: the Soft Radar while
 * the agent works, a 7 px warning dot when it needs the user, a danger dot when
 * it failed. Finished work gets a quiet check and an unknown end a hollow ring,
 * so a card never shows a word-pill where the host shows a mark.
 */
export function StatusMark(props: { agent: AgentView; ui: Pick<Ui, "Icon" | "Tooltip"> }) {
  const Icon = props.ui.Icon;
  const Tooltip = props.ui.Tooltip;
  const tip = () => statusTip(props.agent);

  return (
    <Tooltip value={tip()} placement="left">
      <span class="bn-mark" data-status={props.agent.status} role="img" aria-label={tip()}>
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
