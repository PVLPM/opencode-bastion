# Design

OpenCode Bastion should look like part of OpenCode Desktop: quiet, native, and
honest about what it knows. This file records the visual rules the panel follows
and the reasons behind them. `src/ui/styles.css`, `src/ui/*.tsx` and
`src/ui/lane-geometry.ts` are the implementation of record; if this file and the
code disagree, the code is current and this file must be updated in the same
change.

## Principles

1. **Native by construction.** Colors, fonts and surfaces come from the host's
   theme tokens. Light and dark work because the tokens change, not because the
   panel has two palettes.
2. **Truth over completeness.** A missing value is shown as missing, never
   guessed. Unknown is a legitimate status.
3. **Motion reports events.** Things move when something happened — a new card,
   a delegation, a text change — not to decorate an idle screen.
4. **One family, one screen.** The fleet is the routed session's root and its
   direct subagents. The panel is a monitor and a navigator, never a controller.
5. **Read-only affordances.** Every control opens a session, expands details, or
   changes the view. Nothing starts, stops, approves or answers.

## Theme tokens and naming

Every class is prefixed `bn-`, and all panel styles live under `.bn-panel`.
Component styles are injected with the host `Style` primitive; they must not
style host elements outside the panel.

Each color is a `--v2-*` token, then the older token, then a literal fallback for
the standalone preview. The literal fallbacks keep the preview legible; the panel
overrides a few in the light and dark schemes where the host token is not enough.

| Panel variable | Native token | Fallback |
| --- | --- | --- |
| `--bn-text` | `--v2-text-text-base` | `#fafafa` |
| `--bn-muted` | `--v2-text-text-muted` | `#aeaeae` |
| `--bn-faint` | `--v2-text-text-muted` | `#5c5c5c` |
| `--bn-icon` / `--bn-icon-muted` | `--v2-icon-icon-base` / `-muted` | `#dbdbdb` / `#808080` |
| `--bn-icon-faint` | `--v2-icon-icon-faint` | `#5c5c5c` |
| `--bn-layer` / `--bn-layer-2` | `--v2-background-bg-layer-01` / `-02` | `#242424` / `#2e2e2e` |
| `--bn-border` / `--bn-border-base` | `--v2-border-border-muted` / `-base` | `#ffffff14` / `#ffffff1a` |
| `--bn-focus` | `--v2-icon-icon-accent` | `#3b5cf6` |
| `--bn-accent` | `--v2-icon-icon-accent` | `#a2bcff` |
| `--bn-warn` / `--bn-danger` / `--bn-success` | `--v2-state-fg-warning` / `-danger` / `-success` | `#f2cf76` / `#f17471` / `#6bd586` |
| `--bn-raised` | `--v2-elevation-raised` | `0 0 0 0.5px #ffffff29` |
| `--bn-surface` | `--v2-background-bg-base` | `#161616` |

- `--bn-wire` is the accent at 85%; `--bn-wire-quiet` is `--bn-icon-faint`.
- Under `[data-color-scheme="dark"]`, cards move from the base surface to layer
  01, sunken surfaces mix layer 01 with the base, faint text resolves to
  `--v2-text-text-muted` (`#a6a6a6`), the running mark uses the base icon color,
  and focus uses `--v2-border-border-focus` (`#a2bcff`). Light mode deepens
  warning and success to `--v2-yellow-1100` and `--v2-green-900`.
- Tints are `color-mix()` of a token with a surface, never a new literal.
- Font: `--v2-font-family-sans`, falling back to the host's sans stack. Panel text
  is 12px/18px, weight 440, letter-spacing -0.04px; card titles are 13px/weight
  530 and the agent badge is 11px. Numbers use `font-variant-numeric: tabular-nums`.

## Card anatomy

A card is three fixed-height rows (20px, 18px, 20px) with a 1px gap, 8px radius
and `6px 6px 5px 8px` padding. The whole card body is one open button; the
status mark and the disclosure sit above it so their tooltips and clicks work.

1. **Identity** — `[agent badge] Session title ……… [status mark]`.
   The badge is capitalized agent text in an 18px-tall, 5px-radius chip
   (`--bn-layer-2`, inset 0.5px `--bn-border-strong`, 11px), capped at 62% width
   and ellipsized. Below 300px of card content width the badge is capped at 48%.
   The title is the stored session title with the native ` (@agent subagent)`
   suffix removed, so follow-ups do not rename the card. The status mark is 16×16
   and right-aligned.
2. **Work** — `Task • Activity`.
   The task is the newest delegation description for a subagent, or the first
   line of its latest user prompt for the orchestrator; never the session title.
   The orchestrator prompt is the native display text with native mention spans
   removed when they still match. The details carry the full task text. The
   activity is the live, concise tool description. The `•` separator only appears
   when both exist. The task is capped at 50%; the ticker takes the rest and
   clips.
3. **Meta** — `[logo] Model #Effort ……… lines duration tokens cost context-ring chevron`.
   The provider mark sits in a 14px optical box, 4px from the model name; a
   provider with no vendored mark shows no logo. Effort is the model variant
   actually observed on the latest assistant message, displayed as `#Medium`; it
   is never inferred from the model name. Metrics are right-aligned with an 8px
   gap and tabular numbers. The token metric is the cumulative session total,
   including cache reads and writes; the chevron is a 24×24 disclosure button that
   rotates 180° when open. At wide card widths a 14px slot is reserved for the
   context ring even when the ring is absent.

The disclosure reveals a definition list (72px label column) with Agent, Session,
Task, Now, Provider, Model, Time, Context, Total tokens, Input, Output,
Cache read, Cache write, Cost and Changes when each exists. The Provider row carries
the provider mark and catalog display name. The Agent row always carries the full
agent name, since the badge may be truncated. The task shows the full available
text, without a nested scrollbar. Duration and cost are hidden only when unknown.

Activity wording is generated from the tool part. A tool-provided description
wins; otherwise: `Reading <file>`, `Writing <file>`, `Editing <file>`,
`Searching files`, `Fetching <host>`, `Searching the web`,
`Delegating to <agent>`, `Loading <name> skill`, `Asking a question`,
`Using <name>`. Shell commands are classified from the command head into
`Running tests`, `Installing packages`, `Building`, `Linting`, `Formatting`,
`Type-checking`, `Checking changes`, `Updating git`, `Searching files`,
`Listing files`, `Reading files`, `Fetching a URL`, falling back to
`Running Shell`. `Thinking…`, `Writing response…`, `Starting…` and
`Retrying request…` cover the rest. The raw command, pattern, path contents and
file contents are never shown. Waiting appends `…` to its reason; task and prompt
text appear only in the task row, the details, the lane labels and the lane
tooltip.

### Rolling money

Cost uses an odometer. The exact formatted value (`$1.24`, `~$1.24`, `<$0.01`)
is the accessible text; the visible digit cells are `aria-hidden`. Only the
digits that changed roll, each clipped to its one-character cell, over 440ms.
Nothing rolls on mount, when the formatted value is unchanged, on a theme or
width change, or on an unrelated fleet revision. Host `data-motion="reduce"` and
the OS reduced-motion preference show the final value immediately. The estimate
`~`, the `<$0.01` form and the list-price tooltip are unchanged.

## Status marks

The card follows the marks OpenCode puts on a session tab, never a word pill.

| Status | Mark | Color | Accessible name |
| --- | --- | --- | --- |
| Running | Soft Radar, 14×14 | `--bn-radar-color` (muted; base icon in dark) | `Running`, or `Running: Retrying (attempt N)` |
| Waiting | 7px dot | `--bn-warn` | `Needs you: Waiting for permission` / `… for your answer` |
| Failed | 7px dot | `--bn-danger` | `Failed: rate limit` (safe category only) |
| Done | `check-small`, 14×14 | `--bn-icon-muted` | `Done` |
| Unknown | 7px hollow ring, 1.5px border | `--bn-icon-muted` | `Unknown`, or `Unknown: Interrupted` |

Waiting and failed share a dot shape and differ by tone and by their accessible
name, which is also the tooltip. A real status change settles the new glyph in
from scale 0.6 with a fade over 260ms. It never animates on mount, and a fleet
revision that leaves the primitive status unchanged animates nothing — the status
memo is the rule, not the fleet object. It does not animate at all when motion is
reduced.

Status evidence is fixed:

| Status | Evidence |
| --- | --- |
| Waiting | pending permission or form for that session |
| Running | `status(id) === "running"` and not waiting; retrying is a detail |
| Failed | idle outcome `failed`, or the last assistant message's error |
| Done | idle outcome `succeeded` |
| Unknown | idle without outcome, `interrupted`, or missing data |

The composer pill appears only after the orchestrator delegates. It shows the
agent count and the most actionable state: waiting (`warning`), then failed
(`danger`), then running; once everything is done it is `success` with a check,
and an unknown member keeps it neutral with the stack icon. It never shows
before there is a subagent.

## Elevation means live

- **Live cards** sit at `--bn-raised`.
- **Finished cards** recede onto the sunken surface with a 0.5px hairline
  (`0 0 0 0.5px --bn-border-base`). Text keeps its tone; only the surface moves.
- **The routed card** adds an inset 1px ring at 60% focus color.
- Hover and press use the native overlay tokens, and only when the card can open.
- Focus is a 2px `--bn-focus` outline outside the card.

There is no other surface elevation: tooltips use
`--v2-elevation-floating` with the raised token as fallback. If a surface needs
more elevation than that, the layout is probably wrong.

## Fleet connectors

The root card connects to each child card with one SVG elbow:

- Spine at x = 10.5; corner radius 8; node circle radius 3 at the root card's
  bottom; stroke width 1.5, round caps.
- Active runs are `--bn-wire` (accent at 85%); finished runs and the tail below
  the last active card are `--bn-wire-quiet`.
- Child cards are indented 22px (`.bn-branch`); the card list has a 6px gap.
- Geometry is measured from layout offsets, not client rects, so indentation and
  wrapping never desynchronize the wires. While cards glide, the wires glide with
  them (`data-bn-gliding`).

A beam is a 5px accent dot with a 2px 22% glow, travelling for 680ms along the
wire from the orchestrator to the agent that received a delegation, or back when
that agent returned a result. Beams exist only for transitions observed while
the panel is live: hydration of an existing family produces none, and each beam
expires after 900ms. No beam is rendered when motion is reduced.

## Agent Lanes

Agent Lanes is the timeline below the cards. Each session gets one lane on a
shared time axis; the orchestrator is first, children follow by first execution
start, and the order is stable.

### Truthful blocks

- An **execution block** starts at the first assistant turn after the previous
  `idle` message and ends at the next `idle`; its status is that idle's outcome.
- A running session has one open block that extends to `now`; waiting applies
  only to that live block.
- Gaps are only between an `idle` marker and the next execution start — confirmed
  inactivity. Tool calls inside one execution never split it.
- No block, label, connector or tick is drawn past the now line; live work ends at
  `now`.
- History is read from the durable transcripts on reopen.
- Past waiting is not drawn: OpenCode does not persist waiting intervals.
- A handoff is a root `subagent` call with a confirmed `metadata.sessionID`. It
  lands on the child block running at call time, else the next block to start. A
  second call to the same child is a follow-up. There are no child→child
  connectors and no inference from overlapping time.

### Geometry

| Measurement | Value |
| --- | --- |
| Time-axis height | 22px |
| Lane height | 28px |
| Block height / top inset | 20px / 4px |
| Lane label column | 92px, sticky left |
| Block radius | 4px |
| Region minimum / default height | 96px / 176px |
| Lanes bar height | 36px |
| Scale control | 24px high, fit-content, no outer padding; items 24px high with 8px inline padding |
| Room kept for cards when dragging | 160px |
| Keyboard resize step | 24px (`Home` = minimum, `End` = maximum) |

The time axis and agent names are sticky, so both stay visible while the region
scrolls in either direction. The region is collapsible from its 36px bar and
resizable from a 9px handle above it; dragging is instant, collapsing animates
240ms.

### Block appearance

| Block | Surface | Meaning |
| --- | --- | --- |
| Done | layer 02, inset 1px border | neutral, finished |
| Running | accent at 16% over the panel, 42% inset edge, bright 2px leading edge | live, reaching for now |
| Waiting | warning, same treatment | live, blocked on the user |
| Failed | danger, same treatment | ended badly |
| Unknown | transparent, dashed 1px `--bn-border-strong` | no confirming outcome |

A live block's width extends to `now` with a 1000ms linear transition, so it
grows at the current scale's rate (one pixel per second at the Detail floor). A
new block draws in with a 320ms clip-path wipe; its label fades in over 240ms
after an 80ms delay. Focus is the standard 2px focus outline.

### Labels that may overflow a block

The label is a separate layer from the block:

- Inside the block it uses the full tone (`--bn-text` for running/waiting/failed,
  `--bn-muted` for done).
- Past the block's right edge it continues in `--bn-faint`, over a background
  that masks whatever is underneath.
- It stops before the next block on that lane, leaving a 6px gap. If less than
  18px remains, the label is hidden.
- A block narrower than 36px shows no inner label; when the overflow has room, its
  label lives only beyond the block and uses `--bn-muted`.
- A child label that merely repeats the lane/title is capped to the block width,
  so long titles do not flood the lane.
- The lane label itself is the agent name, ellipsized at 92px; the session title
  is the tooltip. Child lanes also carry a quiet right-aligned watermark of the
  title at 37% opacity.

### Handoff curves

A connector runs from the right edge of the orchestrator block that issued the
call, at that block's vertical center, to the left edge of the child block at its
center. When the source block is missing or zero-width it falls back to the
call's exact x. A follow-up inserted inside the child block's duration lands at
the call's exact x, still mid-height.

It is one bounded cubic with a horizontal tangent at each end; there are no
elbows. The control handles are clamped inside the plot, and at the live now
boundary the departing handle points back into the plot, so a curve never draws
in the future.

- Delegations dash `2 3`; follow-ups dash `0.5 3`.
- Connectors are quiet at rest: `--bn-muted` at 1px and 48% opacity. When either
  endpoint block is hovered or keyboard-focused, the connector turns accent at
  100%.
- The connector layer is above blocks and below labels. A new connector draws
  along its path once over 220ms and never redraws on later updates; reduced
  motion skips the draw-in.
- There is no caret or marker on the child block: the curve itself shows where
  the call landed.

### Fit and Detail

Two scales share one axis:

- **Detail** is linear, at the largest zoom that fits the visible width, chosen
  from `[40, 20, 10, 5, 2, 1]` px/s. One pixel per second is the floor: below it
  a minute-long block cannot carry its label, so long sessions scroll instead.
- **Fit** maps the whole session into the visible width on a logarithmic age
  scale: `x = START_PAD + width × (1 − ln(1 + age/knee) / ln(1 + span/knee))`,
  with `knee = clamp(span/60, 5s, 300s)`. Recent minutes keep their room and
  older history compresses toward the left.
- Until the user picks a scale, a session that Detail cannot show without
  scrolling opens in Fit.

The scale control is the native compact segmented control, built from a real
radio group rather than ARIA-styled buttons. Its container is 24px high and
fit-content with no outer padding, a 6px radius, a `--bn-layer` (native layer 01)
background and a 0.5px inset `--bn-border-base` hairline instead of a border. One
indicator span sits behind the labels, using `--bn-surface` (native base), a
0.5px `--bn-border-strong` hairline and the same 6px radius. It follows the
selected item's position and width over about 150ms without bounce, never
animates on first mount, and jumps under reduced motion. Items take their own
label's width, 24px high with 8px inline padding, 12px at weight 440, tabular
numerals, a transparent background and no per-item shadow; the selected label
uses `--bn-text` and the others stay `--bn-muted`. The group keeps one Tab stop,
arrow/Home/End movement and a 2px inset focus ring. The 36px Lanes bar keeps the
control centered, so 6px of clearance sits above and below it.

Fit maps age, so positions change as time advances. A position settles over 160ms,
and only when its whole-pixel value changes, so subpixel drift does not cause
constant micro-animation.
The live block's leading edge keeps its one-second width animation (see above).
When the lanes region is collapsed, the canvas is frozen: positions do not advance
or animate.
Detail leaves closed blocks fixed; only live blocks, the axis end and the now
label move.

The header shows the total span with the shared duration format. Detail ticks
stay at least 64px apart, choosing from 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m,
30m, 1h and 2h. Fit ticks are ages of 10s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, 1h,
2h and 4h, labelled `−10m`, at least 44px apart. The `now` label keeps 64px of
room before the now line.

### Region behaviour

- Only the card list scrolls vertically; the header stays and the lanes dock
  below.
- The lanes region scrolls independently in both directions, with thin
  scrollbars that appear on hover or keyboard focus within the region.
- The resize handle shows a 24×3 grip at rest, with a stronger state on hover,
  drag and focus.
- It follows the newest work while the user is at the right edge. Once the user
  scrolls back, updates leave the view alone. Picking a scale re-pins.
- Dragging the handle is instant; collapse/expand animates the height. Both are
  keyboard accessible through the separator role.

### Lane tooltip

Hovering or focusing a block opens a popover table:

| Field | Content |
| --- | --- |
| Provenance | One row per handoff kind that landed on the block: `Delegated by` for a delegation, `Follow-up from` for a follow-up; the value is the orchestrator agent's name |
| Task (Prompt on a root block) | Full task or prompt, `Not recorded` when unknown |
| Status | The status label |
| Started | Local clock time, with an ISO `datetime` |
| Duration | Block end minus start, shared duration format |

The popover is a manual popover placed above the block when possible, else
below, clamped to the viewport and to the scroller's frame. It is at most 340px
wide; long text scrolls within 144px/42dvh. `Escape` dismisses it, returning
focus to the block when focus was inside the tooltip. Hover inspection ignores
touch pointers.

## Motion

Motion answers "what changed":

| Event | Motion |
| --- | --- |
| Activity text changes | Old line leaves up and the new rises from below: 220ms in, 180ms out, clipped to keep the row height |
| Card joins, or moves (including into Finished) | FLIP from its old position: 240ms move ease; arrivals 280ms ease-out, 40ms stagger capped at 160ms. A card moved to Finished is not remounted, so its open details and keyboard focus stay |
| Status changes | A real change settles the mark from scale 0.6 over 260ms; a fleet revision with the same status animates nothing |
| Cost changes | Only changed digits roll, clipped to their cell, over 440ms; no roll on mount or an unchanged formatted value |
| Details open/close | Height and fade, 240ms out / 260ms in, interruptible both ways |
| Block appears | Clip-path wipe, 320ms |
| Connector appears | Draws along its path once, 220ms |
| Delegation or result | Beam travels the wire, 680ms |
| Scale selection | Indicator slides in about 150ms with no bounce; no first-mount animation |
| Fit scale | Positions settle over 160ms, only on whole-pixel changes |

Easing tokens: `--bn-ease` `cubic-bezier(0.2, 0, 0, 1)` for state changes,
`--bn-ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for arrivals, `--bn-ease-move`
`cubic-bezier(0.77, 0, 0.175, 1)` for moves. Hover and small state changes use
120–160ms. The Soft Radar is the only loop; nothing else repeats, and nothing
animates merely because the panel opened: entrance flags are set only after mount
and only for elements created later.

Streamed activity (text that only grew or shrank) and changes that arrive while a
slide is still running update in place, so bursts never stack animations.

### Reduced motion

Reduced motion comes from either the host (`data-motion="reduce"` on the root
element) or the OS preference. When it is on:

- the ticker does not slide and does not keep a leaving line;
- no beams are rendered;
- the Soft Radar shows its still frame;
- FLIP, status-change and cost-roll animations are skipped;
- the scale indicator jumps to the selected item;
- all animations and transitions in the panel collapse to 0.001ms.

Layout is unchanged. Reduced motion is not a different layout.

## Accessibility

- Every interactive element has a visible focus indicator in `--bn-focus`; the
  card outline sits outside, inner controls use `outline-offset: 0` or `-2px`,
  and the lanes scroller uses a 2px inset ring.
- Primary controls are at least 24px high: the card disclosure is 24×24, the lane
  toggle is 24px high, and the scale control and its items are 24px high with 8px
  inline padding. The scale radio group is one Tab stop with arrow/Home/End
  movement and a 2px inset focus ring. The header "needs you" chip keeps its 22px
  height, and the resize handle is a 9px-tall drag strip with a 24×3 grip.
- Cost exposes the exact formatted value to assistive technology; the rolling
  digit layer is `aria-hidden` and is not a live region.
- A card is an `article` with a full-card button labelled
  `Open <agent>, <title>, <status>` (the title is omitted when absent); the routed
  card sets `aria-current`. The button is disabled when the session is missing, so
  the card is not a dead tab stop that does nothing.
- The disclosure button carries `aria-expanded` and `aria-controls`; the closed
  content is `inert` and `aria-hidden`, so hidden details are not read or
  focusable.
- The header's "N need you" control is a button that cycles focus through waiting
  cards and has a descriptive `aria-label`.
- Agent Lanes is a labelled region with a tab stop; blocks are focusable
  `role="img"` elements labelled `<agent>: <task>, <status>` and reference the
  open tooltip with `aria-details`. The resize handle is a `separator` with
  `aria-valuemin`/`max`/`now`.
- Color is never the only signal: status marks use shape (radar, dot, check,
  ring) and always carry an accessible name; waiting and failed share the dot but
  differ by tone and label. The line count has an `aria-label` that includes the
  file count; the context ring states percent and tokens.
- Decorative layers (wires, axis, ticks, grid) carry no accessible content.
- Lane tooltips open on keyboard focus as well as hover; the card's details
  repeat the same task, timing and usage data.

## Narrow width and overflow

The card is a container (`container: bn-card / inline-size`); its third row
gives way in this order:

1. At ≤330px: hide the cost (it remains in the details).
2. At ≤300px: hide the `+added −removed` counts (they remain in the details),
   tighten the 10px row gap and 8px metric gap to 6px, and shrink the effort
   label to a 3ch minimum.
3. Only then does the model name ellipsize.
4. At ≤280px: hide the context ring (its value is still in the details and the
   tooltip).

Duration never drops, and the model name gives way first. The agent badge is
capped at 62% (48% below 300px) and the title ellipsizes; the task is capped at
50%. The panel's vertical rhythm never depends on text length: every row is a
fixed height.

The lanes region does not squeeze: in Detail it scrolls horizontally with sticky
labels and axis, which is why the panel is usable at 320px.

## Show only what data supports

- A value with no evidence is absent; it is not replaced by a guess or a
  placeholder. Zero appears only when zero is the measured value. No invented
  percentages, statuses or model names.
- **Cost**: OpenCode's reported cost wins. A session with no reported cost and
  zero tokens is exactly `$0.00`; a session with tokens but no reported cost is
  estimated from models.dev list prices and shown with `~` and the tooltip
  `Estimated at API list price`; if no price matches, cost is absent. The header
  total is the reported family total plus estimates only for members that had no
  reported cost, so nothing is counted twice; if such a member cannot be priced,
  the total is absent rather than understated. `claude-agent` is Anthropic CLI
  routing for subscription use; it is priced with Anthropic list prices, so the
  estimate is an API-list-price equivalent, not subscription spend. It stays
  estimated (`~`) like any other estimate.
- **Context**: the latest token-bearing assistant over the context limit of the
  model that produced those tokens. No limit, zero limit or a completed
  compaction means no ring.
- **Tokens**: cumulative per-session usage as OpenCode reports it. The total is
  non-cached input plus output, reasoning and cache reads/writes, each counted
  once; cache tokens are not added to input again. The family total sums distinct
  sessions only, so a child that also appears as a descendant is counted once. A
  session with any invalid counter has no token metric and makes the family total
  absent; zero is shown when zero is the measured value. The context ring still
  measures the latest token-bearing assistant against its model's limit; it is not
  the cumulative total.
- **Changes**: the session's own cumulative diff, refreshed from the latest
  completed assistant turn. An explicit `files: []` describes only that turn, so
  the refresh is skipped and the last known diff is kept until a later completed
  turn changes files; only a scope or session change with no completed assistant
  clears it. The line counts and the file count come from the same diff: `files`
  counts distinct real paths, and a truncation sentinel (`more`) is not a file and
  contributes no lines. It is not exact per-agent attribution when agents edit the
  same files, and the card says so in a tooltip.
- **Effort**: only the observed model variant, else absent.
- **Status**: only the evidence table above; everything else is Unknown.
- **Lanes**: only durable transcript evidence; past waiting is not drawn, and a
  handoff is drawn only for a confirmed child session id.
- **Titles**: the native subagent suffix is stripped; an absent title collapses
  to just the agent badge.
