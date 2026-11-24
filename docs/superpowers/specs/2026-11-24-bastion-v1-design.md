# OpenCode Bastion 1.0 — Design

Status: approved by owner via the v1.0 brief (2026-11-24) plus two answered questions.
This document records the decisions the brief leaves to the builder.

## Intent

A read-only, native OpenCode Desktop GUI plugin that shows, at a glance, what the
orchestrator and its subagents in the **currently open session family** are doing:
who runs, waits, finished or failed, what each is doing now, for how long, at what
cost and context load, and with how many changed lines. It is a monitor and a
navigator, never a controller.

## Goals

- Composer pill **Agent Status**: one-line summary; click opens/focuses the panel.
- Side panel **Agent Fleet**: orchestrator card → connected subagent cards, an
  inactive (greyed) group below, a compact parallel timeline.
- Live, evidence-based status: Running, Waiting, Done, Failed, Unknown.
- Activity Ticker with vertical slide transition on meaningful changes only.
- Blue connection lines; a beam travels orchestrator→agent on delegation/message
  and agent→orchestrator on result return. Only for observed events.
- Card title is `Agent Name • Session Name`.
- Cost (OpenCode-reported, else models.dev estimate marked `~`), context ring,
  `+added / −removed`.
- Card body opens the child session tab; a separate disclosure expands details.

## Non-goals / anti-goals

Out of scope per brief §12 (no control, no approvals, no global dashboards, no
backend, no quota tracking, no LLM summaries). Anti-goals: invented statuses,
invented percentages, implied communication that did not happen, constant
decorative motion, DOM patching of OpenCode.

## Owner decisions

1. **Fleet anchor:** the fleet follows the routed session's family **root**
   (`data.session.root`). Viewing a child keeps the whole fleet and highlights the
   viewed card. Still scoped to that one family — no global view.
2. **Theme:** all colors from native OpenCode theme tokens; light works by
   construction, visual acceptance is performed on dark.

## Architecture

One state source: the host's reactive synced store `ServerRef.data`
(`@opencode/client/solid` `Data`) of the routed session's server. Bastion keeps no
cache of its own; it derives view models with Solid memos from:

- `data.session.get/list/family/root/status/cost` — topology, status, cost.
- `data.session.message.list(id)` — activity, tokens, retries, errors, timings.
- `data.session.permission.list(id)` / `data.session.form.list(id)` — waiting.
- `data.location.model.list()` — context limits and model display names.
- `client.session.diff({ sessionID })` — line stats (on demand, see Limitations).

The only plugin-local state is presentation: expanded cards, the last ticker text
per card (for transition), and beam animations keyed by observed tool-part
transitions. Reconnect/reopen recovery comes from the store itself: on mount and
on `server.connected` turning true, Bastion calls `data.session.sync(root,
{ children: true })`.

Pure derivation lives in framework-free modules (`src/model/*`) with unit tests;
Solid components (`src/ui/*`) only render. Entry `src/gui.tsx` registers Style,
ComposerPill, Panel, Command and a `session.panel` MenuItem.

## Status model (evidence rules)

| Status | Evidence |
| --- | --- |
| Waiting | pending permission or form for the session |
| Running | `status(id) === "running"` and not waiting |
| Failed | idle with `outcome` `failed` (or last assistant `error`) |
| Done | idle with `outcome` `succeeded` |
| Unknown | idle without outcome, `interrupted`, or missing data |

`interrupted` renders as Unknown with detail "Interrupted". Retrying is a Running
detail from `assistant.retry`. Tool running / generating are ticker details.

## Limitations to surface honestly

- Per-agent line attribution: session diffs per child session; parallel edits of
  the same file can be attributed to whichever session's snapshot captured them.
  Shown as reported by OpenCode with a tooltip caveat, never "exact".
- Estimated cost: shown with `~`, tooltip "Estimated at API list price".

## Approaches considered

1. **Host synced store (chosen):** zero extra connections, consistent with what
   the native UI shows, reconnect handled by the host.
2. Own event subscription + cache: duplicates the host store; two sources of truth.
3. Server-plugin backend + RPC: violates "no backend" and adds a process.
