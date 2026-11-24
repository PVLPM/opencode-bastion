# Testing

How tests are structured, how to use the fixtures and fake host, and the traps
that have already caused real failures. Read `AGENTS.md` first for the test
rules.

## Layout and projects

`vitest.config.ts` runs two projects:

| Project | Environment | Includes | Notes |
| --- | --- | --- | --- |
| `model` | node | `test/**/*.test.ts` | Pure derivation; no DOM |
| `dom` | happy-dom | `test/**/*.test.tsx` | Solid plugin; renders components into a real element |

Both projects alias `solid-js` and `solid-js/web` to their development builds.
This is deliberate: a test and a compiled component must share one Solid
instance, or signals created in one copy are invisible to the other.

```sh
pnpm test                        # both projects
pnpm test:watch
pnpm exec vitest run test/model  # one project
pnpm exec vitest run test/ui/fleet-panel.test.tsx
```

`passWithNoTests` is on, so a project with no matching files does not fail the
run.

## Fixtures

- `test/fixtures.ts` builds SDK-shaped objects: sessions, assistant and user
  messages, idle markers, tokens, tools, models and agents. Use the builders
  instead of literal objects; add a field to a builder when a test needs it.
- `test/ui/fixtures.ts` and `test/ui/lane-fixtures.ts` build `FleetView` and
  `LanesView` values directly, so DOM tests do not depend on derivation.
- `test/ui/ui-stub.tsx` provides inert `Icon`, `Tooltip` and `Loader` doubles.
  The tooltip stub is a passthrough, so assert the visible child text, not
  tooltip popovers.
- The preview fixtures under `preview/fixtures.ts` are for the visual gallery and
  are not imported by tests.

Fixtures are synthetic. Never copy a real transcript into `test/`.

## Fake host

`test/data/fake-host.ts` implements the narrow `FleetData` slice that
`createFleetSource` reads, plus `FleetHost`.

Seeding (`createFakeHost({...})`):

- `sessions`: each seed has `info` plus optional `messages`, `permissions`,
  `forms`, `status`, `loaded: false` (known but not loaded) or `deleted: true`.
- `childrenOnSync` and `messagesOnSync` add data when a sync resolves, modelling
  a child discovered later and messages arriving after hydration.
- `agents`, `models`, `agentsByLocation`, `modelsByLocation` cover the location
  catalog and per-directory differences.
- `diff` and `prices` stand in for the network; `sessionGate` and `messageGate`
  delay all session or message syncs.
- `failSessionSyncOnce` / `failMessageSyncOnce` make the first sync of a session
  reject, to test retry behavior.

Controls on the returned object:

- `setRouted`, `setConnected`, `addSession`, `unload`, `deleteSession`;
- `addMessage`, `addMessages`, `setStatus`, `setPermissions`, `setForms`,
  `setAgents`, `setModels`;
- `holdNextMessageSync(sessionID)` releases one message sync on demand;
- `calls` records session/message/permission/form/agent/model syncs, diff calls,
  opened tabs and price fetches.

Mount a source inside an owner so effects run and clean up:

```ts
function withSource(host: FleetHost, run: (source: FleetSource) => Promise<void>) {
  const mounted = createRoot((dispose) => ({ source: createFleetSource(host), dispose }));
  return run(mounted.source).finally(mounted.dispose);
}
```

After an action that resolves promises, `await flush()` (a `setTimeout(0)`) or
advance the relevant gate. Do not sprinkle arbitrary sleeps.

For the one-second clock, fake timers are appropriate; restore real timers in a
`finally` so a failed assertion cannot leak them into later tests.

## Pitfalls that have already bitten

### Unsynced store lists are `undefined`

The real store returns `store.session.permission[id]`, which stays `undefined`
until that session's permissions are synced, even though the SDK types it as an
array. The adapter treats form lists the same way, and `session.get` is undefined
for an unloaded session. Read them as `list?.(...)?.length ?? 0`; never assume
`.length` exists.

A throw inside a plugin-root memo or effect does not fail one card: the host
fails the whole plugin until it is reloaded. That is why the regression
`derives a new child before its permissions are synced` exists in
`test/data/fleet-source.test.ts`. Keep it passing, and treat any new host read as
guilty until proven optional-safe.

### Sessions can be known, unloaded or missing

`session.get(id)` is `undefined` until the session is loaded, and
`session.missing(id)` is true for a deleted session. Handle absent info without
throwing, and never make a missing session openable. Test both, not just the
happy path.

### Sync is asynchronous and scoped

`createFleetSource` syncs once per scope (`server`, connection state, root,
session). On a session switch it resets derived state and beams. Tests must
switch the routed session and assert the new anchor, rather than assuming the
old one is reused.

A failed sync removes its key so the next store change retries it. There is no
timer-based retry; do not add one in a test or in code.

### DOM tests: ownership, cleanup and host gaps

- Render with `render(() => <Panel ... />, host)` and dispose every root in
  `afterEach`. Also clear `document.body` and delete
  `document.documentElement.dataset.motion` so tests cannot leak state.
- Assert DOM and data attributes (`data-status`, `aria-expanded`, `aria-label`,
  `disabled`). When the contract is whether an animation runs, spy on
  `Element.prototype.animate` narrowly, as the status-mark test does, not on
  timings or keyframes. Web Animations is optional (`canAnimate()`), so animations
  may be skipped in the test DOM.
- `ResizeObserver` is optional and guarded in components. Pure geometry tests call
  `laneGeometry` directly; do not try to measure a happy-dom layout as if it were
  a browser.
- Pass `now` explicitly. Component tests should not wait on the real clock.
- `Tooltip` and `Loader` from the host are stubs; do not assert their internals.

### No module mocking

The vendored anti-slop rule `anti-slop/no-module-mocking` rejects `vi.mock`.
Inject what varies instead: the fake host, `fetchPrices`, callbacks and props.
Spies (`vi.fn`) for callbacks are fine.

## Regression contracts

These behaviors have already been wrong once and must not regress:

- **Status animation**: a fleet revision with the same status animates no mark; a
  real status change runs one mark animation. The primitive status memo is the
  signal, not the fleet object.
- **Handoffs**: a connector path contains only `M` and `C` commands, starts at the
  source block's right edge at its center (call x when the source is missing or
  zero-width), and ends at the child block's left edge at its center (call x for
  an inserted follow-up). Every point stays within `0..nowX` and `0..height` in
  both Fit and Detail; there are no elbows and no caret path.
- **Rolling money**: no reel on mount, an unchanged formatted value,
  `data-motion="reduce"`, or a theme/width change; one reel per changed digit,
  removed on `animationend`; the exact formatted text is accessible and the
  visual layer is `aria-hidden`.
- **Line refresh**: a new completed assistant turn with changed files refetches;
  an unchanged completed time does not; absent snapshot metadata still queries the
  authoritative diff; an explicit `files: []` skips the refresh but keeps the last
  known cumulative diff. Only a scope or session change with no completed
  assistant clears the counter.
- **Finished move**: a card moved to Finished keeps its open details and keyboard
  focus; it is moved, not remounted.
- **Scale control**: the indicator is the first child and `aria-hidden`; it tracks
  the checked item's offset and width; `data-ready` appears only after mount and
  only with motion; `Home`/`End` select and focus the ends; each mounted panel
  gets its own radio-group name.

## What a change must ship with

- A bug fix ships with a test that fails for the reported behavior and passes
  after the smallest correction. Establish the root cause first; no blanket
  catches, watchdogs or defensive rewrites.
- A new derivation rule gets one table-driven row that names the rule, not a copy
  of a neighboring test.
- A new UI behavior gets one DOM test for its contract (click target, disabled
  state, disclosure behavior, label) and, when visual, a preview scene.
- Do not duplicate the same scenario across model, data and DOM layers unless
  each layer proves a distinct boundary. The full gate is `pnpm verify`.
