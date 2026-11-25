# Review

How to review a change to OpenCode Bastion. The standard is not "looks fine": a
change is accepted when its behavior matches the product rules, its evidence is
reproducible, and it does not make the panel claim more than the data supports.

## Start with evidence

Ask for, or run:

- `pnpm verify` output (format, Oxlint, Knip, jscpd, tsc, Vitest, build).
- The targeted test or reproduction for the changed behavior.
- For UI changes: the scenes, widths (320/560), themes and motion setting that
  were checked, per `docs/agents/design.md`. Host tooltips need Desktop; the
  preview stubs them.
- For data changes: the store state that produces the value, and what happens
  when it is absent, zero or stale.

Do not accept "should work" as verification. If a check was not run, say which
one and why.

## Scope and architecture

- [ ] Read-only: no mutating host API, no approval/answer path, no new control.
- [ ] One session family: the routed root and direct subagents. No global view.
- [ ] The host store is still the only state source. No second cache, event
      subscription, polling loop or watcher.
- [ ] Local state is presentation only.
- [ ] `src/model/` stays framework-free; derivation has a unit test; `src/ui/`
      renders view models and does not derive product data.
- [ ] Host imports are limited to `@opencode/plugin/gui`, `@opencode/client/*`
      (types and `solid`) and `solid-js`; new packages are bundled or rejected.
- [ ] Timing is demand-driven: the one-second clock runs only while a member is
      live, and diffs refresh from a completed turn unless it reports no changed
      files. No speculative timers.
- [ ] A bug fix names the root cause and adds a regression test. No blanket
      catches or watchdogs.

## Truthfulness

- [ ] Every displayed value is traceable to host data. Missing data stays absent;
      no guess, dash or percentage is invented, and zero appears only when zero is
      the measured value.
- [ ] Status matches the evidence table in `DESIGN.md` (permission/form → waiting,
      running → running, idle outcome → done/failed, otherwise unknown).
- [ ] Errors use the safe category, never the provider's raw message.
- [ ] Activity text contains no reasoning, prompt, command or file contents.
- [ ] Cost: OpenCode's reported value wins; estimates only for loaded zero-cost
      requests, each priced at its own route after native history pagination; `~`
      and the loaded-message caveat tooltip; no double counting; an unpriced
      member makes the family total absent rather than understated.
      Loaded-message estimates are caveated: title, generate and reverted usage
      has no message, token totals are never treated as a completeness
      certificate, and an unversioned alias uses its current listed tariff.
- [ ] Context: latest token-bearing assistant over the limit of the model that
      produced it; no ring for zero/unknown limits or after a completed
      compaction.
- [ ] Lines are the session's cumulative diff, not exact per-agent attribution; the
      card says so in a tooltip. An explicit empty snapshot skips the refresh but
      keeps the last known count.
- [ ] Effort comes only from the observed model variant.
- [ ] Lanes: blocks come from assistant/idle boundaries, not event silence; past
      waiting is not drawn; handoffs need a confirmed child session id; no
      child→child edges; only a real user prompt labels an orchestrator block,
      never a synthetic internal message.
- [ ] A known limitation is documented where a user will see it, not hidden in
      code comments.

## High-value cases to inspect

These have produced real defects or are easy to get wrong:

1. A child created seconds ago with no messages: Running with `Starting…`, no
   `NaN` duration, no crash before its permissions sync.
2. Model missing from the catalog or `limit.context` of 0: no ring, no `0%`, no
   `Infinity`.
3. Reported cost 0 with tokens > 0 and no models.dev match: cost absent, not
   `$0.00`.
4. The same child delegated twice: one card, task from the latest call, one
   outward beam per new call, and in Agent Lanes the second connector drawn as a
   follow-up.
5. Opening a finished family: no beams. Beams exist only for live transitions
   after hydration.
6. Switching sessions: the source re-anchors, drops beams and lines, and does not
   leak the previous family.
7. A deleted or unloaded session: not openable, no throw.
8. `prefers-reduced-motion` or `data-motion="reduce"`: no ticker slide, beams,
   radar animation, FLIP or money roll; identical layout.
9. An unchanged fleet revision leaves the status mark still; only a real status
   change animates it once.
10. A card moved to Finished keeps its open details and keyboard focus.
11. Handoffs: the call's x on the orchestrator lane to the child's left edge (or
    the call's x for an inserted follow-up), one cubic with no elbows, and no
    point past `now` in either scale.
12. Rolling cost and token metrics: no roll on mount, unchanged value,
    theme/width change or reduced motion; only changed digits roll; the
    accessible text is the final formatted value.
13. Line refresh: absent snapshot metadata still queries the diff; explicit
    `files: []` keeps the last known cumulative count; a new completed turn with
    changed files refetches, and an unchanged completed time does not.

## UI review

- [ ] Tokens only: native `--v2-*` with fallbacks; no new literals outside the
      documented fallback block; `bn-` classes; no styles outside `.bn-panel`.
- [ ] Card: three fixed rows, ellipsized identity, right status mark, separator
      only when both parts exist, metrics order (lines, duration, total tokens,
      cost, ring, chevron), disclosure separate from the open action.
- [ ] Elevation meaning: live raised, finished sunken with a hairline, routed
      card ringed.
- [ ] Fleet wires: active accent, finished quiet, aligned to measured cards;
      beams only on events and absent under reduced motion.
- [ ] Lanes: truthful blocks, labels clipped inside their block and hidden below
      three characters, handoff geometry (call x to child left edge, or call x for
      an inserted follow-up, one cubic, no elbow or caret), quiet connectors until
      hover/focus, Fit/Detail behavior, pinned scroll.
- [ ] Scale control: native compact segmented style, one sliding indicator, 24px
      items with 8px inline padding, one Tab stop with arrow/Home/End movement,
      and no first-mount motion.
- [ ] Cost and token digits roll only when the formatted value changes; reduced
      motion shows the final text immediately; the accessible text is exact.
- [ ] Narrow widths: the header running count drops at ≤330px header width, the
      card cost at ≤330px, line counts at ≤300px and the ring at ≤280px; duration
      stays, and dropped values remain in the details.
- [ ] Keyboard: every action reachable, focus visible, closed details inert,
      tooltips dismiss with `Escape`, resize handle has range semantics.
- [ ] Accessible names state the same thing as the visible label; color is not
      the only channel.
- [ ] Motion: no entrance animation on mount; interruptible transitions; no new
      decorative loop.

## Tests

- [ ] One test proves one contract; table-driven where the rule is tabular.
- [ ] The fixture is synthetic and built through the shared builders.
- [ ] No module mocking; variation is injected.
- [ ] DOM tests dispose roots and clean `document.body` / `data-motion`.
- [ ] The regression test fails without the fix (state how you know).
- [ ] No test weakens a check, skips a project or relies on an arbitrary sleep.

## Report

Write findings in this shape, most severe first:

```text
Finding: <what is wrong, where>
Why it matters: <user-visible or data-truth impact>
Evidence: <file:line, test, command output, scene>
Smallest fix: <the correction, not a redesign>
```

Distinguish a defect from a documented limitation and from a stylistic
preference. Do not expand scope for unrelated cleanup; report it separately.
