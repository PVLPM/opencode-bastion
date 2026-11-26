import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";

import "./tokens.css";
import "../src/ui/radar.css";
import "../src/ui/styles.css";
import "./preview.css";

import type { Beam, FleetView, LanesView } from "../src/model/types";
import { FleetPanel } from "../src/ui/fleet-panel";
import { DemoScene } from "./demo/scene";
import {
  failedFleet,
  inactiveFleet,
  lanesFor,
  liveFleet,
  liveLanes,
  longNamesFleet,
  now,
  parallelFleet,
  repeatedFleet,
  rootOnlyFleet,
  sessionFleet,
  sessionLanes,
  singleAgentFleet,
  statusesFleet,
  waitingFleet,
} from "./fixtures";
import { ui } from "./ui";

interface FrameProps {
  readonly width: number;
  readonly fleet: FleetView | undefined;
  readonly lanes: LanesView | undefined;
  readonly beams: readonly Beam[];
  readonly now: number;
  readonly closed: readonly string[];
  readonly label: string;
  readonly onOpen: (sessionID: string) => void;
}

function Frame(props: FrameProps) {
  const canOpen = (sessionID: string) => !props.closed.includes(sessionID);

  return (
    <div class="pv-frame" style={{ width: `${props.width}px` }} data-preview-frame={props.label}>
      <div class="pv-frame__bar">
        <span>Agent Fleet</span>
        <span>{props.width} px</span>
      </div>
      <div class="pv-frame__body">
        <FleetPanel
          fleet={props.fleet}
          lanes={props.lanes}
          beams={props.beams}
          now={props.now}
          onOpen={props.onOpen}
          canOpen={canOpen}
          ui={ui}
        />
      </div>
    </div>
  );
}

interface Scene {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly fleet: () => FleetView | undefined;
  /** Lanes for the scene; by default, the ones implied by its cards. */
  readonly lanes?: () => LanesView;
  readonly closed: readonly string[];
}

function sceneLanes(scene: Scene): LanesView | undefined {
  if (scene.lanes !== undefined) return scene.lanes();
  const view = scene.fleet();
  return view === undefined ? undefined : lanesFor(view);
}

const scenes: readonly Scene[] = [
  {
    id: "no-session",
    title: "No session",
    note: "fleet is undefined: nothing to follow yet",
    fleet: () => undefined,
    closed: [],
  },
  {
    id: "no-subagents",
    title: "No subagents",
    note: "the orchestrator alone; nothing was delegated",
    fleet: rootOnlyFleet,
    closed: [],
  },
  {
    id: "single",
    title: "One active agent",
    note: "one running child; the activity scans while it works",
    fleet: singleAgentFleet,
    closed: [],
  },
  {
    id: "parallel",
    title: "Parallel agents",
    note: "three running, one waiting for permission",
    fleet: parallelFleet,
    closed: [],
  },
  {
    id: "repeated",
    title: "Repeated agent names",
    note: "two Fixers and two Explorers stay separate cards; effort shows when known",
    fleet: repeatedFleet,
    closed: [],
  },
  {
    id: "session",
    title: "Long session",
    note: "fourteen minutes: six orchestrator turns with idle gaps, follow-ups after a gap, repeated names, a failure",
    fleet: sessionFleet,
    lanes: sessionLanes,
    closed: [],
  },
  {
    id: "statuses",
    title: "Every status",
    note: "running radar, waiting and failed dots, done check, unknown ring",
    fleet: statusesFleet,
    closed: [],
  },
  {
    id: "long",
    title: "Long names",
    note: "agent, session, model and ids truncate on one line; the last session is gone",
    fleet: longNamesFleet,
    closed: ["ses_child_token_audit"],
  },
  {
    id: "needs-you",
    title: "Needs you",
    note: "waiting is amber in the header, the chip and the timeline",
    fleet: waitingFleet,
    closed: [],
  },
  {
    id: "failed",
    title: "Failed and completed",
    note: "a failure stays readable in the greyed inactive group",
    fleet: failedFleet,
    closed: [],
  },
  {
    id: "full",
    title: "Full family",
    note: "two active agents, five inactive, one shared timeline",
    fleet: inactiveFleet,
    closed: [],
  },
];

function Panes(props: { scene: Scene; onOpen: (sessionID: string) => void }) {
  return (
    <div class="pv-panes">
      <Frame
        width={320}
        fleet={props.scene.fleet()}
        lanes={sceneLanes(props.scene)}
        beams={[]}
        now={now}
        closed={props.scene.closed}
        label={`${props.scene.id}-narrow`}
        onOpen={props.onOpen}
      />
      <Frame
        width={560}
        fleet={props.scene.fleet()}
        lanes={sceneLanes(props.scene)}
        beams={[]}
        now={now}
        closed={props.scene.closed}
        label={`${props.scene.id}-wide`}
        onOpen={props.onOpen}
      />
    </div>
  );
}

function LivePanes(props: { onOpen: (sessionID: string) => void }) {
  const manualClock = new URLSearchParams(window.location.search).get("clock") === "manual";
  const [startedAt, setStartedAt] = createSignal(Date.now());
  const [step, setStep] = createSignal(0);
  const [addedCents, setAddedCents] = createSignal(0);
  const [nowValue, setNowValue] = createSignal(Date.now());
  const [beams, setBeams] = createSignal<readonly Beam[]>([]);
  const timers: ReturnType<typeof setInterval>[] = [];
  const expiries: ReturnType<typeof setTimeout>[] = [];
  let beamSequence = 0;

  const fire = (direction: "out" | "in") => {
    const beam: Beam = { id: `live-${beamSequence}`, sessionID: "ses_live_writer", direction };
    beamSequence += 1;
    setBeams((current) => [...current, beam]);
    expiries.push(
      setTimeout(() => {
        setBeams((current) => current.filter((item) => item.id !== beam.id));
      }, 900),
    );
  };

  onMount(() => {
    if (manualClock) return;
    timers.push(setInterval(() => setNowValue(Date.now()), 1000));
    timers.push(setInterval(() => setStep((value) => value + 1), 2200));
    timers.push(setInterval(() => fire("out"), 3800));
    timers.push(setInterval(() => fire("in"), 6100));
  });

  onCleanup(() => {
    for (const timer of timers) clearInterval(timer);
    for (const expiry of expiries) clearTimeout(expiry);
  });

  return (
    <section class="pv-row" id="live" data-preview="live">
      <header class="pv-row__head">
        <h2>Live activity</h2>
        <p>
          activity lines slide, beams run the wires, live lanes grow; at 4 s the Writer finishes, at
          7 s a follow-up lands
        </p>
      </header>
      <div class="pv-panes">
        <Frame
          width={320}
          fleet={liveFleet(startedAt(), step(), nowValue(), addedCents())}
          lanes={liveLanes(startedAt(), nowValue())}
          beams={beams()}
          now={nowValue()}
          closed={[]}
          label="live-narrow"
          onOpen={props.onOpen}
        />
        <Frame
          width={560}
          fleet={liveFleet(startedAt(), step(), nowValue(), addedCents())}
          lanes={liveLanes(startedAt(), nowValue())}
          beams={beams()}
          now={nowValue()}
          closed={[]}
          label="live-wide"
          onOpen={props.onOpen}
        />
      </div>
      <div class="pv-controls">
        <Show when={manualClock}>
          <button
            class="pv-action"
            type="button"
            onClick={() => setNowValue((value) => value + 1000)}
          >
            Advance 1 s
          </button>
        </Show>
        <button class="pv-action" type="button" onClick={() => setStep((value) => value + 1)}>
          Next activity
        </button>
        <button class="pv-action" type="button" onClick={() => setAddedCents((value) => value + 5)}>
          Add $0.05
        </button>
        <button class="pv-action" type="button" onClick={() => fire("out")}>
          Delegation →
        </button>
        <button class="pv-action" type="button" onClick={() => fire("in")}>
          ← Result
        </button>
        <button
          class="pv-action"
          type="button"
          onClick={() => {
            const at = Date.now();
            setStartedAt(at);
            setNowValue(at);
          }}
        >
          Replay lanes
        </button>
      </div>
      <p class="pv-hint">
        A delegation beam runs from the orchestrator node down the spine into the Writer card; a
        result runs back. Both only exist while a real beam is in <code>props.beams</code>.
      </p>
    </section>
  );
}

function Gallery(props: { onOpen: (sessionID: string) => void }) {
  return (
    <div class="pv-gallery">
      <For each={scenes}>
        {(scene) => (
          <section class="pv-row" id={scene.id} data-preview={scene.id}>
            <header class="pv-row__head">
              <h2>{scene.title}</h2>
              <p>{scene.note}</p>
            </header>
            <Panes scene={scene} onOpen={props.onOpen} />
          </section>
        )}
      </For>
      <LivePanes onOpen={props.onOpen} />
      <p class="pv-hint">
        Reduced motion: <code>?motion=reduce</code> mounts the whole gallery with
        <code>data-motion="reduce"</code>. No beams are rendered, the scan and slide are off, and
        the layout is unchanged.
      </p>
    </div>
  );
}

const query = new URLSearchParams(window.location.search);
const reducedAtStart = query.get("motion") === "reduce";
if (reducedAtStart) document.documentElement.dataset.motion = "reduce";

const [scheme, setScheme] = createSignal(query.get("theme") === "light" ? "light" : "dark");
document.documentElement.dataset.colorScheme = scheme();
const toggleScheme = () => {
  const next = scheme() === "dark" ? "light" : "dark";
  setScheme(next);
  document.documentElement.dataset.colorScheme = next;
};

const [reduced, setReduced] = createSignal(reducedAtStart);
const [epoch, setEpoch] = createSignal(1);
const [opened, setOpened] = createSignal<string>();

const toggleMotion = () => {
  const next = !reduced();
  setReduced(next);
  if (next) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  setEpoch((value) => value + 1);
};

const recordOpen = (sessionID: string) => setOpened(sessionID);

const host = document.getElementById("root");
if (host === null) throw new Error("Preview root element is missing.");

if (query.get("demo") === "1") {
  // Demo mode is dark, full motion and free of gallery chrome; the panel owns
  // the whole surface as it does in Desktop.
  document.documentElement.dataset.colorScheme = "dark";
  delete document.documentElement.dataset.motion;
  render(() => <DemoScene />, host);
} else {
  render(
    () => (
      <div class="pv-page">
        <header class="pv-bar">
          <div>
            <h1>Agent Fleet</h1>
            <p>
              OpenCode Desktop 2.4 v2 tokens · narrow 320 and wide 560 · ?theme=light,
              ?motion=reduce
            </p>
          </div>
          <div class="pv-bar__tools">
            <span>
              {opened() === undefined ? "Click a card to open its session" : `Open: ${opened()}`}
            </span>
            <button class="pv-action" type="button" onClick={toggleScheme}>
              {scheme() === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <button class="pv-action" type="button" onClick={toggleMotion}>
              {reduced() ? "Use full motion" : "Reduce motion"}
            </button>
          </div>
        </header>
        <Show when={epoch()} keyed>
          <Gallery onOpen={recordOpen} />
        </Show>
      </div>
    ),
    host,
  );
}
