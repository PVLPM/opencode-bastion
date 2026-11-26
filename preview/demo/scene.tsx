import { onCleanup, onMount } from "solid-js";

import { createFleetSource } from "../../src/data/fleet-source";
import { FleetPanel } from "../../src/ui/fleet-panel";
import { ui } from "../ui";
import { createDemoScenario, DEMO_ROOT } from "./scenario";

interface DemoHook {
  ready: boolean;
  done: boolean;
  start(): void;
}

declare global {
  interface Window {
    __bastionDemo?: DemoHook;
  }
}

/**
 * The README scene: the production panel, mounted exactly as the plugin mounts
 * it, over the preview fake host. No gallery chrome is rendered here.
 */
export function DemoScene() {
  const hook: DemoHook = {
    ready: false,
    done: false,
    start: () => undefined,
  };
  const scenario = createDemoScenario({
    onDone: () => {
      hook.done = true;
    },
  });
  hook.start = () => {
    scenario.start();
  };
  const source = createFleetSource(scenario.host);

  onMount(() => {
    window.__bastionDemo = hook;
    let alive = true;
    let check: ReturnType<typeof setTimeout> | undefined;
    const awaitRoot = () => {
      if (!alive) return;
      if (source.fleet()?.root.sessionID === DEMO_ROOT) {
        hook.ready = true;
        return;
      }
      check = setTimeout(awaitRoot, 16);
    };
    awaitRoot();
    onCleanup(() => {
      alive = false;
      if (check !== undefined) clearTimeout(check);
    });
  });

  onCleanup(() => {
    scenario.dispose();
    if (window.__bastionDemo === hook) delete window.__bastionDemo;
  });

  return (
    <div class="pv-demo" data-preview-demo="true">
      <div class="pv-demo__surface">
        <FleetPanel
          fleet={source.fleet()}
          lanes={source.lanes()}
          beams={source.beams()}
          now={source.now()}
          onOpen={(sessionID) => {
            source.open(sessionID);
          }}
          canOpen={source.canOpen}
          ui={ui}
        />
      </div>
    </div>
  );
}
