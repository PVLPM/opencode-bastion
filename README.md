# OpenCode Bastion

Agent Fleet for OpenCode Desktop. See what the orchestrator and its subagents in
the open session are doing — status, live activity, duration, cost, context and
changed lines — without leaving the conversation.

Requires OpenCode Desktop 2.4.x. Read-only: Bastion never starts, stops, approves
or answers anything.

## Features

- **Agent Status pill** above the composer once the session has delegated work:
  agent count and the most actionable state (needs you, failed, running).
  Clicking it opens the panel.
- **Agent Fleet panel** (side region): the orchestrator card, active subagents
  connected by a line, and finished ones in a greyed Inactive group that stays
  connected. A pulse runs along a line when the orchestrator delegates
  (orchestrator → agent) and when a subagent returns (agent → orchestrator).
- **Cards** titled `Agent • Session`, with model and provider logo, status
  (Running, Needs you, Done, Failed, Unknown), a one-line activity ticker,
  duration, `+added −removed` lines, cost and a context ring. The card body opens
  the session; the disclosure shows the delegated task, model, start/end, usage
  and the waiting reason or error.
- **Timeline** of real start/stop intervals, below the cards.

Open it from the pill, the session panel menu (**Agent Fleet**) or the command
palette (**Open Agent Fleet**).

## Install (local build)

```sh
pnpm install
pnpm build
```

Add the absolute path of this folder to `plugins` in your OpenCode config
(`~/.config/opencode/opencode.json`), then restart OpenCode Desktop:

```json
{ "plugins": ["C:/path/to/opencode-bastion"] }
```

## What the numbers mean

- **Cost** is what OpenCode reports. When OpenCode reports no cost for a session
  that used tokens, Bastion estimates it from models.dev list prices and shows it
  with `~`. That is not your subscription spend. The header total is the family
  total from OpenCode and is never summed twice.
- **Context** is the latest assistant turn's tokens over the model's context
  limit. No limit or a fresh compaction shows no ring.
- **Lines** come from each session's own file diff. They are not an exact
  per-agent attribution when agents touch the same files.
- **Status** is shown only on evidence; anything else is Unknown (for example an
  interrupted session).
- The fleet covers one session family: the routed session's root and its direct
  subagents.

## Development

`pnpm verify` runs the format check, Oxlint (with vendored anti-slop rules),
Knip, jscpd, tsc, Vitest and the production build. `pnpm exec vite --config
preview/vite.config.ts` serves a visual preview with fixture fleets.

## License

MIT. Provider logos: see `src/ui/logos/NOTICE.md`.
