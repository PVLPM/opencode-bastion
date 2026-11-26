# README demo

`docs/images/agent-fleet.webp` is a recorded run of the real Fleet panel. The
sessions are synthetic; the cards, statuses, activity, costs, context, beams and
Agent Lanes are the production UI and model. Nothing in `src/` is demo-specific.

The scene exists only in the preview at `?demo=1`.

## Regenerate

Prerequisites:

- Node `>=22.18.0` and pnpm `10.33.0`, as declared in `package.json`.
- `pnpm install`.
- `pnpm exec playwright install chromium`, once per machine.
- `ffmpeg` (with libwebp) and `ffprobe` on `PATH`.
- `preview/fonts/Inter.ttf` and `Inter-Italic.ttf` (OFL, gitignored). The recorder
  stops if Inter is missing because the WebP is captured with the real preview
  font; a fresh clone falls back to the system sans stack.

```sh
pnpm demo:record
```

The script starts Vite on `localhost:5199`, records `/?demo=1` with Playwright,
and encodes the WebP with ffmpeg. Raw video and timing files go to
`preview/.screens/demo/` and stay uncommitted. It exits non-zero on a page error,
missing Inter, a non-done final state, a detail panel that does not fit, or an
encoder failure.

## Storyboard

| Approx. | State |
| --- | --- |
| 0 s | Orchestrator alone, planning |
| 2.3 s | Explorer appears; delegation beam |
| 3.7 s | Designer appears |
| 5.0 s | Fixer appears |
| 6.3 s | Oracle appears |
| 7.6 s | Validator appears; five parallel children |
| 8.7 s | Explorer returns |
| 9–12 s | Designer enters Needs you (permission) |
| 11–13 s | Oracle fails with `provider error` |
| 13–15 s | Designer resumes; Oracle retries |
| 18.9 s | Fixer receives a follow-up execution |
| 20.5–22.4 s | Validator and the Fixer follow-up return |
| 26.9 s | Final verification ends; every card is Done |
| 28.0–30.7 s | Orchestrator details expand, then collapse |
| 33.1 s | Final state, then loop |

Delegation beams are emitted at roughly 2.3, 3.7, 5.0, 6.3, 7.6 and 18.9 s;
return beams at roughly 8.7, 10.7, 15.9, 17.1, 20.5 and 22.4 s. The model is
deterministic; frame timing may vary by a frame.

## Tuning

- `preview/demo/scenario.ts` owns the story: sessions, messages, permissions,
  diff counters and prices. Keep every state reachable from real host data and
  never add a Bastion control for resolving, retrying or approving.
- `preview/preview.css` owns the recording frame: `.pv-demo__surface` is
  `600 × 770`.
- `preview/record-demo.mjs` owns the capture: `800 × 830` viewport and video,
  Orchestrator details, hold timings, and the `640 × 800` crop, 24 fps and q90
  WebP settings. If the frame height changes, update all four places (surface,
  viewport, `recordVideo.size`, `CROP`) and re-check that the six cards plus the
  Lanes still fit.
- `770 px` is the smallest height that keeps all six cards visible with a 10 px
  gap above the Lanes. Do not lower it without measuring the final Explorer card.
- The details target is the Orchestrator because it is the first card and always
  visible; finished children are newest-first, so Explorer is last at the end.
- The WebP is committed as a product asset. `preview/.screens/` is not.

## Review the encoded WebP

```sh
ffmpeg -i docs/images/agent-fleet.webp \
  -vf "fps=1/2.1,scale=360:-1:flags=lanczos,tile=4x4:padding=4:margin=4" \
  -frames:v 1 preview/.screens/demo/contact.png
```

Inspect the encoded WebP, not only the live page or the webm:

- 1:1 text clarity at the waiting, details and final frames; no clipping or
  unintended scrollbars.
- Delegation and return beams at the times above.
- Waiting → resume, failure → retry, and the Fixer follow-up as a second lane
  block with its own handoff.
- Rolling token and cost digits during the parallel phase.
- Finished-group order and the Orchestrator Done check in the final state.
- The completed hold before the loop.

The committed demo is 24 fps, 640 × 800, q90: 687 encoded frames over 33.08 s,
7.18 MB. q95 is sharper but 10.30 MB; q90 is the approved size/clarity point.
Do not change the quality without re-checking the size and 1:1 text.
