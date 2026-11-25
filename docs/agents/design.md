# Design work and visual verification

Read `DESIGN.md` before changing anything visual: it holds the rules, tokens and
measurements. This playbook is the workflow for checking that a change actually
follows them.

## Ground rules

- Use native `--v2-*` tokens with the existing fallbacks. Do not introduce new
  brand colors, gradients, shadows or fonts.
- Keep class names under `bn-` and styles under `.bn-panel`. Never patch host
  components or global selectors outside the panel.
- A value with no host data stays absent. A visual change must not make a card
  look more certain than the underlying data.
- If a design rule changes, update `DESIGN.md` and the code in the same change.

## Preview

```sh
pnpm exec vite --config preview/vite.config.ts
```

Open `http://localhost:5199`. The gallery renders the real panel at 320px and
560px against synthetic fixtures.

| URL | Purpose |
| --- | --- |
| `/` | Dark theme (default), full motion |
| `?theme=light` | Light theme first |
| `?motion=reduce` | Host reduced-motion setting before mount |
| `?theme=light&motion=reduce` | Both |

The header buttons toggle theme and motion at runtime; the motion toggle remounts
the gallery so entrance states are reproducible.

Scenes to check when relevant: no session, no subagents, one active agent,
parallel agents, repeated agent names, long session with gaps and a failure,
every status, long names with a closed session, needs you, failed and completed,
full family, and the live-activity scene with beams.

Preview limitations:

- The preview's host `Tooltip` stub is an inert passthrough; lane popovers do
  render there. Check status, cost and context tooltip text and placement in
  OpenCode Desktop, or at least verify the accessible name in the DOM.
- `preview/fonts/` is gitignored; a fresh clone uses the system sans fallback and
  will not match screenshots taken with Inter.
- Fixtures are synthetic. Do not add real session data for a better screenshot.

## Visual matrix

- **Themes**: dark is the primary acceptance theme for this project. Light must
  still be checked for legibility, fallbacks and any token that is missing from
  the preview stand-ins.
- **Widths**: 320px and 560px. 320px exposes the third-row drop order; 560px
  shows the intended spacing.
- **Motion**: full motion and `?motion=reduce`. Layout must be identical; only
  movement disappears.
- **States**: running, waiting, failed, done, unknown; a fresh child; a missing
  session; long agent, title, model and task strings.

## Checklist

Cards:

- [ ] Three rows keep their fixed heights; a long title, task or activity never
      grows the card.
- [ ] The status mark matches the status, sits on the right, and its tooltip and
      accessible name say the same thing.
- [ ] The `•` separator appears only when both task and activity exist. A running
      card always has an activity; a finished part never keeps its old label and
      the gap is `Working…`.
- [ ] Live cards are raised; finished cards are sunken with a hairline; the routed
      card has its inset ring; hover and press do not move the layout.
- [ ] The metrics order is lines, duration, total tokens, cost, context ring,
      chevron; `+added −removed` and cost are hidden only where the details still
      carry them.
- [ ] At ≤330px the cost goes, at ≤300px the line counts go and the gap tightens
      while effort shrinks, and at ≤280px the ring goes. Duration remains. Below
      300px the badge is capped at 48%; the details always carry the full Agent
      row.
- [ ] Details carry the full task, Provider (logo and display name), the
      cumulative token rows and a Changes row with the distinct file count.
- [ ] A truncated diff is labelled partial in the collapsed line count and the
      Changes row, and its tooltip says the directory listing was truncated.
- [ ] The header token total is the known total for loaded sessions, as its title
      says.
- [ ] The provider logo sits in a 14px optical box 4px from the model name; the
      observed effort is secondary text with no prefix; wide layouts reserve the
      context-ring slot.
- [ ] Clicking the card body opens the session; clicking the disclosure expands
      details without opening; a missing session cannot be opened.
- [ ] Details expand and collapse without a jump, and closed details are not
      focusable.

Fleet:

- [ ] The header shows the family token total beside the family cost; at ≤330px of
      header width the running count leaves first, so the agent count and the
      token/cost pair stay readable.
- [ ] Wires meet the root card's node and each child card's elbow; indentation and
      wrapping do not desynchronize them.
- [ ] Active wires are accent, finished wires are quiet; the spine turns quiet
      below the last live card.
- [ ] Beams appear only for a delegation or a returned result, and never on first
      load. With reduced motion, none render.
- [ ] Cards glide when they join or move between Active and Finished; the wires
      glide with them. A move to Finished takes 240ms and keeps the open details
      and keyboard focus.

Lanes:

- [ ] One lane per session, root first; the block is as long as the execution and
      a live block reaches `now`. Nothing is drawn past the now line.
- [ ] Labels stay readable: full tone inside the block, faint beyond it, stopped
      before the next block, hidden when there is no room. A block under 36px has
      no inner label, only the overflow one.
- [ ] Handoff curves run from the source block's right edge (or the call x when
      it is missing or zero-width) to the child's left edge (call x for an
      inserted follow-up): one cubic, no elbow or caret, drawn once over 220ms;
      follow-ups use the tighter dash.
- [ ] Connectors are quiet until one endpoint is hovered or focused.
- [ ] Fit shows the whole session; Detail is linear and scrolls. The default
      choice matches `DESIGN.md`; Fit settles over 160ms only on whole-pixel
      changes, the live edge animates width over 1s, and a collapsed canvas is
      frozen.
- [ ] Dragging, keyboard resizing, collapsing and both-axis scrolling work, with
      sticky labels and axis. The disclosure, lane toggle and scale control keep
      their 24px heights, the handle shows a 24×3 grip, and scrollbars appear on
      focus.
- [ ] Following the newest work stops once the user scrolls back.
- [ ] The scale control is the native compact segmented style: 24px high,
      fit-content, no outer padding, one indicator that follows the selected
      item's position and width, 8px item padding, no per-item shadow, centered
      inside the 36px Lanes bar with 6px of clearance
      above and below. The selected label uses the base color; the rest are muted.
- [ ] The scale control is one native-radio Tab stop with arrow/Home/End movement
      and a 2px inset focus ring.
- [ ] The tooltip table shows provenance, task/prompt, status, start time and
      duration, stays inside the viewport, and `Escape` returns focus.

Motion and accessibility:

- [ ] Nothing animates on mount; entrance motion exists only for things created
      after the panel opened. A real status change animates the mark once; an
      unchanged fleet revision does not.
- [ ] Cost digits roll only on a changed formatted value, and reduced motion shows
      the final text immediately.
- [ ] The scale indicator slides about 150ms without bounce, does not animate on
      first mount, and jumps under reduced motion.
- [ ] Reduced motion stops the ticker slide, beams, radar animation, FLIP, status,
      money and scale-indicator animation without changing layout.
- [ ] Every control is reachable by keyboard with a visible focus indicator.
- [ ] No provider error, reasoning, tool command or file content leaks into a
      tooltip, screenshot or accessible name; task and prompt text appears only in
      the fields meant to show it.

## Capturing evidence

- Capture the narrow and wide frames in the state you changed, in both themes if
  the change touches color, and once with reduced motion if it touches movement.
- Keep captures in `preview/.screens/` (gitignored) or another local scratch
  location. Do not commit them.
- In the handoff, name the scenes, widths, themes and motion setting you checked,
  and the checks you could not perform (for example real tooltips, which need
  Desktop). Do not claim a visual check you did not perform.
