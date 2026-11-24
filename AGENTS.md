# AGENTS.md

OpenCode Bastion is a read-only OpenCode Desktop GUI plugin: an **Agent Status**
composer pill and an **Agent Fleet** side panel for the routed session's family.

## Scope

- Monitor and navigate only. Never start, stop, steer, approve or answer anything.
- One session family at a time (the routed session's root). No global dashboards,
  no backend, no polling loops, no file watchers.
- Out of scope: see `docs/superpowers/specs/2026-11-24-bastion-v1-design.md`.

## Architecture rules

- The host store `ServerRef.data` is the single source of truth. Do not add a
  parallel cache of sessions, messages or statuses.
- `src/model/` is framework-free derivation (pure functions over SDK types) and is
  where logic and its unit tests live. `src/ui/` renders view models only.
- Only `@opencode/plugin/gui`, `@opencode/client/*` (types and `solid`) and
  `solid-js` are imported from the host; anything else must be bundled or avoided.
- Use native OpenCode theme tokens in CSS with fallbacks; namespace classes `bn-`.
- Show a value only when OpenCode data supports it. Unknown is a valid state;
  estimates are marked as estimates.

## Code quality

- TypeScript strict. No `any`, no `@ts-ignore`, no unchecked casts; a needed
  assertion carries a `// SAFETY:` comment (enforced by anti-slop Oxlint rules).
- No speculative abstractions, wrappers, fallback values or comments that restate code.
- One test proves one contract. Prefer table-driven tests over copies.

## Verification

Run before every commit: `pnpm verify` (format, Oxlint, Knip, jscpd, tsc,
Vitest, production build). Do not weaken a check to make it pass.

## Commits

Small, independently reviewable conventional commits (`feat:`, `fix:`, `chore:`,
`test:`, `docs:`). Stage exact files; never `git commit -a`. Never push, publish
or tag from an agent session.

## Security

Never commit secrets, local config, or session content. Fixtures are synthetic.
