# Development

How to set up, build, preview and load OpenCode Bastion. Read `AGENTS.md` first
for project rules.

## Prerequisites

- Node `>=22.18.0`.
- pnpm `10.33.0`, the version in `packageManager`. If pnpm is missing, install
  that version with Corepack or your package manager.
- OpenCode Desktop 2.4.x to load the plugin; `peerDependencies` accepts
  `@opencode/plugin >=2.4.0 <2.5.0`.

```sh
pnpm install
```

For code navigation, initialize the per-worktree CodeGraph index with
`codegraph init -y` and keep it current with `codegraph sync`; `AGENTS.md` has the
full rules and the `rg` fallback.

`pnpm install` also provides the verification tools (Biome, Oxlint with the
vendored anti-slop plugin, Knip, jscpd, TypeScript, Vitest, Vite). Do not install
them globally or substitute newer `npx` copies.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Vite production bundle to `dist/gui-experimental.cjs` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest: model (node) and DOM (happy-dom) projects |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm lint` | Oxlint with `.oxlintrc.json` and the vendored anti-slop plugin |
| `pnpm format` | Biome format, writing changes |
| `pnpm format:check` | Biome format check |
| `pnpm knip` | Unused files, exports and dependencies |
| `pnpm dup:check` | jscpd over `src` |
| `pnpm verify` | The full gate: format check, lint, Knip, jscpd, typecheck, tests, build |

Run `pnpm verify` before a commit. During work, targeted runs are fine:
`pnpm exec vitest run test/model/lanes.test.ts`, `pnpm typecheck`,
`pnpm exec oxlint -c .oxlintrc.json src/ui`.

## Repository map

| Path | Role |
| --- | --- |
| `src/gui.tsx` | Plugin entry: `Style`, `ComposerPill`, `Panel`, `Command`, `MenuItem` |
| `src/data/fleet-source.ts` | Narrow host adapter; reads the synced store and derives the views |
| `src/model/` | Pure derivation over SDK types; no Solid, no DOM |
| `src/ui/` | Solid rendering of view models, panel styles, lanes geometry |
| `preview/` | Standalone visual harness with synthetic fixtures |
| `test/` | Unit and DOM tests, fixtures, fake host |
| `tools/oxlint/anti-slop/` | Vendored Oxlint plugin; treated as third-party |
| `docs/agents/` | These playbooks |

All colors, spacing and motion the panel applies are documented in `DESIGN.md`.

## Preview gallery

The preview runs the real `FleetPanel` with the real `src/ui` stylesheet against
fixtures, in two frame widths and both color schemes:

```sh
pnpm exec vite --config preview/vite.config.ts
```

It serves on `http://localhost:5199` (strict port). Do not use the root
`vite.config.ts` for the preview; that config builds the plugin bundle.

Useful URLs and controls:

- `?theme=light` opens light first (dark is the default); the header button
  toggles it at runtime.
- `?motion=reduce` sets `data-motion="reduce"` before the gallery mounts; the
  header button toggles it and remounts the gallery.
- The static scenes cover no session, no subagents, one agent, parallel agents,
  repeated names, every status, long names, a waiting agent, a failure and a full
  family, each at 320px and 560px.
- The **Live activity** scene animates a running agent, fires delegation and
  result beams, and has buttons to advance the activity line, fire a beam or
  replay the lanes.
- `?demo=1` opens the README recording scene: one panel, no gallery chrome, dark
  and full motion. `pnpm demo:record` regenerates `docs/images/agent-fleet.gif`;
  see `docs/agents/demo.md`.

Preview limitations, so you do not chase ghosts:

- The preview's host `Tooltip` stub is an inert passthrough
  (`preview/ui.tsx`), so status, cost and context tooltips need Desktop. The
  custom lane popover does render in the preview.
- `preview/fonts/` is gitignored. A fresh clone falls back to the system sans
  stack; glyph widths may differ from screenshots taken with Inter installed.
- `preview/.screens/` is gitignored for local screenshot captures.
- Fixtures are synthetic. Never add real session transcripts.

## Build and load into Desktop

```sh
pnpm build
```

This writes one CommonJS bundle, `dist/gui-experimental.cjs`, exposed by the
package as `./gui-experimental`. Solid and the OpenCode SDK stay external because
Desktop provides them.

Add the absolute path of this folder to `plugins` in your OpenCode config
(`~/.config/opencode/opencode.json`), then restart OpenCode Desktop:

```json
{ "plugins": ["C:/path/to/opencode-bastion"] }
```

Notes:

- The build deliberately does not empty `dist/`. A running Desktop that reads the
  bundle during a rebuild briefly fails with `PluginNotFoundError` when the
  directory disappears; the single file is overwritten in place instead.
- Source maps are off in the production bundle.
- There is no release or publish automation in the repository. Maintainers handle
  integration and releases.

## Adding a host capability

1. Confirm the data exists in `@opencode/client` types or the GUI host API. If it
   does not, it is not a feature yet.
2. Expose the smallest slice in `src/data/fleet-source.ts`; keep `FleetData` a
   narrow pick of what you actually read.
3. Derive the view model in `src/model/` with a unit test. Keep `undefined` for
   "not known" and never invent a default.
4. Render it in `src/ui/` with a fixture and, if it is visual, a preview scene.
5. Run `pnpm verify`.

Do not add a second subscription, cache or polling loop to answer a question the
host store already answers.
