# OpenCode Bastion — project rules

OpenCode Bastion is a read-only OpenCode Desktop GUI plugin: an **Agent Status**
composer pill and an **Agent Fleet** side panel for the routed session's family.

This file is the repository-wide rule set for contributors and coding agents.
Detailed procedures live in `docs/agents/` and are loaded only when relevant.
Explicit maintainer instructions and higher-priority system instructions always
win.

## Product scope

- Monitor and navigate only. Bastion never starts, stops, steers, approves or
  answers anything.
- One session family at a time: the routed session's root and its direct
  subagents. Viewing a child keeps the whole fleet; there is no global dashboard.
- State comes from the host's synced store. No backend, no own event
  subscription, no parallel cache of sessions, messages or statuses, no polling
  loops, no file watchers.
- Non-goals: control and approvals, quota tracking, LLM summaries, invented
  statuses or percentages, implied communication that did not happen, constant
  decorative motion, and DOM patching of OpenCode.
- Show a value only when OpenCode data supports it. Unknown is a valid state;
  estimates are labelled as estimates. Past waiting intervals are not persisted
  by OpenCode, so Agent Lanes does not draw them.

## Load only the playbook you need

| Task | Read in addition to this file |
| --- | --- |
| setup, build, preview gallery, loading the plugin | `docs/agents/development.md` |
| tests, fixtures, fake host, regressions | `docs/agents/testing.md` |
| UI work and visual verification | `docs/agents/design.md` and `DESIGN.md` |
| reviewing a change | `docs/agents/review.md` |

Do not preload every playbook "just in case".

## CodeGraph

This repository uses [CodeGraph](https://github.com/colbymchenry/codegraph) for
code navigation. Each worktree keeps its own local index:

- Initialize it once per worktree, from that worktree's root:

  ```sh
  npm install -g @colbymchenry/codegraph   # only if `codegraph` is not available
  codegraph init -y
  ```

- Keep the index current with `codegraph sync` after substantial edits, or
  `codegraph index` for a clean rebuild.
- Before `rg`/`find` or reading files to understand or locate code, use
  `codegraph explore "<symbol or question>"`. It returns the relevant symbols'
  source and the call paths between them.
- `.codegraph/` is a local index, not project content. It is ignored by git;
  never commit it.
- CodeGraph is a local developer tool, not a project dependency. If it is
  unavailable, fall back to `rg` and file reads.

## Architecture rules

- The host store `ServerRef.data` is the single source of truth. Do not add a
  parallel cache of sessions, messages or statuses.
- `src/model/` is framework-free derivation (pure functions over SDK types), with
  its unit tests under `test/model/`. `src/data/` is the narrow host adapter.
  `src/ui/` renders view models only. `src/gui.tsx` wires the plugin into the host.
- Only `@opencode/plugin/gui`, `@opencode/client/*` (types and `solid`) and
  `solid-js` may be imported from the host. Anything else must be bundled or
  avoided; dev-only packages must never leak into `src/`.
- Local state is presentation only: disclosures, ticker transitions, lane scale,
  height, scroll and inspection, and beams keyed by observed transitions. It is
  never a second copy of host data.
- Use native OpenCode theme tokens in CSS with fallbacks; namespace classes `bn-`.
  Styles must not reach host components outside the panel.
- Timing is demand-driven: a one-second clock runs only while a member is running
  or waiting, and file diffs refresh from a session's latest completed turn unless
  it explicitly reports no changed files. No background loops.
- Never render raw provider error messages, reasoning text, tool commands or file
  contents. Use the safe status categories. Task and prompt text appear only in
  the places that deliberately show them (task row, details, lane labels and lane
  tooltip).

## Code quality

- TypeScript strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any`, no `@ts-ignore`, no unchecked casts; a
  needed assertion carries a `// SAFETY:` comment (enforced by the vendored
  anti-slop Oxlint rules).
- Fix the rule, not the call site. Do not silence a check to get a change through.
- KISS and YAGNI are correctness rules: no speculative abstractions, wrappers,
  fallback values or comments that restate code. Write comments that explain why.
- No blanket catches or watchdogs. Establish the root cause from host logs or
  source, make the smallest correction, and add a regression test.
- One test proves one contract. Prefer table-driven tests over copies, and
  synthetic fixtures over real session data. Prefer injected dependencies over
  module mocking.

## Verification

Prerequisites: Node `>=22.18.0` and pnpm `10.33.0`, declared in `package.json`
and `packageManager`. Run `pnpm install` first; Oxlint (with the vendored
anti-slop plugin), Knip, jscpd, Biome, Vitest, Vite and TypeScript all come from
`devDependencies`. Do not install them globally or run a newer `npx` copy
instead; if one is genuinely missing after install, report it.

Run `pnpm verify` before every commit. It runs, in order:

1. `pnpm format:check` — Biome format check.
2. `pnpm lint` — Oxlint with the vendored anti-slop rules.
3. `pnpm knip` — unused files, exports and dependencies.
4. `pnpm dup:check` — jscpd over `src`.
5. `pnpm typecheck` — `tsc --noEmit`.
6. `pnpm test` — Vitest, model and DOM projects.
7. `pnpm build` — production bundle to `dist/gui-experimental.cjs`.

Do not weaken, skip or locally disable a check to make it pass. If a check is
genuinely wrong, correct its configuration in the same change and say why.
Targeted runs are fine while working; the full gate is required before handoff.

## Commits

- Small, independently reviewable conventional commits (`feat:`, `fix:`, `test:`,
  `docs:`, `chore:`, and so on). One concern per commit.
- Stage exact files; never `git commit -a`. Keep unrelated formatting or
  refactoring out of a change.
- Describe behavior and intent, not the tool that produced the commit.
- Agents must not push, publish, tag, force-push or rewrite published history.
  A human maintainer handles integration and releases.
- Never commit build output (`dist/`), local configuration, screenshots or
  editor scratch files.

## Security

- Never commit secrets, local config, API keys or session content. Fixtures are
  synthetic.
- Never paste real prompts, transcripts, logs or screenshots containing them into
  commits, issues or tests.
- The plugin's only network request is the models.dev price table, fetched
  lazily only when an estimate is needed; failure means no estimate. Adding
  telemetry or another network source is a product decision for the maintainer,
  not an incidental change.
- Read-only means read-only: no code path may call a mutating host API.
