import { Show, batch, createEffect, createSignal, on, onCleanup } from "solid-js";

interface Line {
  readonly id: number;
  readonly enter: boolean;
}

/** Matches the longest of the CSS enter/exit slides, plus a frame. */
const SETTLE_MS = 240;

function streamed(from: string, to: string): boolean {
  return to.startsWith(from) || from.startsWith(to);
}

/**
 * One line of activity that slides vertically on a meaningful change: the old
 * line leaves upward while the new one rises from below, inside a clipped row,
 * so the card never changes height. Identical text, text that only grew or
 * shrank (streamed tokens) and changes that land while a slide is still running
 * update the visible line in place, so bursts never stack animations.
 */
export function ActivityTicker(props: {
  readonly text: string | undefined;
  readonly animate: boolean;
}) {
  const [text, setText] = createSignal(props.text);
  const [line, setLine] = createSignal<Line | undefined>(
    props.text === undefined ? undefined : { id: 0, enter: false },
  );
  const [leaving, setLeaving] = createSignal<string | undefined>();
  let last = props.text;
  let sequence = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    on(
      () => props.text,
      (next) => {
        if (next === last) return;
        const from = last;
        last = next;
        setText(next);

        const shown = line() !== undefined;
        const quiet =
          !props.animate ||
          settle !== undefined ||
          (from !== undefined && next !== undefined && streamed(from, next));
        if (shown && next !== undefined && quiet) return;

        sequence += 1;
        const id = sequence;
        batch(() => {
          setLeaving(props.animate ? from : undefined);
          setLine(next === undefined ? undefined : { id, enter: props.animate });
        });
        if (!props.animate) return;
        if (settle !== undefined) clearTimeout(settle);
        settle = setTimeout(() => {
          settle = undefined;
          setLeaving(undefined);
        }, SETTLE_MS);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    if (settle !== undefined) clearTimeout(settle);
  });

  return (
    <span class="bn-ticker">
      <Show when={leaving()}>
        {(old) => (
          <span class="bn-ticker__line bn-ticker__prev" aria-hidden="true">
            {old()}
          </span>
        )}
      </Show>
      <Show when={line()} keyed>
        {(current) => (
          <span class="bn-ticker__line" data-enter={current.enter ? "true" : undefined}>
            {text()}
          </span>
        )}
      </Show>
    </span>
  );
}
