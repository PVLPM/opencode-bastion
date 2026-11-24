import { createEffect, createSignal, onCleanup, Show } from "solid-js";

/**
 * One line of activity that slides up when the text changes. The container keeps
 * one line in flow and the previous line absolutely over it, so a card never
 * changes height. The scan highlight follows OpenCode's own activity shimmer and
 * only runs while the agent is live.
 */
export function ActivityTicker(props: { text: string | undefined; live: boolean }) {
  const [shown, setShown] = createSignal(props.text);
  const [previous, setPrevious] = createSignal<string | undefined>(undefined);
  let last = props.text;
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const next = props.text;
    if (next === last) return;
    const from = last;
    last = next;
    setPrevious(from);
    setShown(next);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      setPrevious(undefined);
      timer = undefined;
    }, 200);
  });

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return (
    <span class="bn-ticker">
      <Show when={previous()}>
        {(old) => (
          <span class="bn-ticker__line bn-ticker__prev" aria-hidden="true">
            <span class="bn-ticker__text">{old()}</span>
          </span>
        )}
      </Show>
      <Show when={shown()} keyed>
        {(text) => (
          <span class="bn-ticker__line" data-enter={previous() === undefined ? undefined : "true"}>
            <span class="bn-ticker__text">{text}</span>
            <Show when={props.live}>
              <span class="bn-ticker__shine" aria-hidden="true">
                {text}
              </span>
            </Show>
          </span>
        )}
      </Show>
    </span>
  );
}
