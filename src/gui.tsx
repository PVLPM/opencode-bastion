import type { JsonValue } from "@opencode/client/promise";
import {
  Command,
  ComposerPill,
  MenuItem,
  Panel,
  Plugin,
  Style,
  type Context,
  type SessionRef,
  usePanel,
} from "@opencode/plugin/gui";
import { createEffect, createSignal, onCleanup } from "solid-js";

import { createFleetSource } from "./data/fleet-source";
import { parsePriceTable, type PriceTable } from "./model/pricing";
import { FleetPanel } from "./ui/fleet-panel";
import { pillView } from "./ui/pill";
import radar from "./ui/radar.css?inline";
import styles from "./ui/styles.css?inline";

const PANEL_ID = "fleet";
const FLEET_TAB = { id: PANEL_ID, title: "Agent Fleet" } as const;

async function fetchPrices(): Promise<PriceTable> {
  const response = await fetch("https://models.dev/api.json");
  if (!response.ok) throw new Error(`models.dev ${response.status}`);
  // The body is external JSON: decode its shape before use.
  const payload: JsonValue = await response.json();
  const table = parsePriceTable(payload);
  if (table === undefined) throw new Error("models.dev returned an unexpected body");
  return table;
}

function revealFleet(ctx: Context, session: SessionRef | undefined): void {
  if (session === undefined) return;
  const key = `${ctx.id}:${PANEL_ID}`;
  if (ctx.layout.state(key, session) !== "visible") ctx.layout.open(key, session);
}

export default Plugin.define({
  setup(ctx) {
    const [panelVisible, setPanelVisible] = createSignal(false);
    const source = createFleetSource({
      current: () => ctx.sessions.current(),
      openTab: (server, id) => ctx.tabs.open({ server, id }, { focus: true }),
      fetchPrices,
      visible: panelVisible,
    });
    const openFleet = () => revealFleet(ctx, ctx.sessions.current());

    ctx.add(Style, `${radar}\n${styles}`);

    ctx.add(ComposerPill, {
      id: "agent-status",
      show: (input) => {
        if (ctx.sessions.current()?.key !== input.session.key) return undefined;
        const view = pillView(source.fleet());
        if (view === undefined) return undefined;
        return { ...view, title: "Agent Status", run: () => revealFleet(ctx, input.session) };
      },
    });

    ctx.add(Panel, {
      id: PANEL_ID,
      region: "side",
      list: (input) => (input.open.includes(PANEL_ID) ? [FLEET_TAB] : []),
      render: () => {
        const panel = usePanel();
        createEffect(() => setPanelVisible(panel.visible()));
        onCleanup(() => setPanelVisible(false));
        return (
          <FleetPanel
            fleet={source.fleet()}
            lanes={source.lanes()}
            beams={source.beams()}
            now={source.now()}
            onOpen={source.open}
            canOpen={source.canOpen}
            ui={ctx.ui}
          />
        );
      },
    });

    ctx.add(Command, {
      id: "open-fleet",
      title: "Open Agent Fleet",
      description: "Show the orchestrator and its subagents in the side region",
      keywords: "agents subagents fleet status orchestrator",
      section: "navigation",
      group: "Navigation",
      run: openFleet,
    });

    ctx.add(MenuItem, {
      menu: "session.panel",
      id: "open-fleet",
      title: "Agent Fleet",
      icon: "sessions-stack",
      run: openFleet,
    });
  },
});
