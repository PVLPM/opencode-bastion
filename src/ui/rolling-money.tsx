import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";

import { formatMoney } from "../model/format";
import type { Money } from "../model/types";
import { reduceMotion } from "./motion";

const DIGIT = /^[0-9]$/;

function RollCell(props: { character: string }) {
  const character = createMemo(() => props.character);
  const [roll, setRoll] = createSignal<{ from: string; to: string }>();
  const numeric = () => DIGIT.test(character());

  createEffect(
    on(character, (to, from) => {
      setRoll(
        from !== undefined && DIGIT.test(from) && DIGIT.test(to) && !reduceMotion()
          ? { from, to }
          : undefined,
      );
    }),
  );

  return (
    <span
      class="bn-money__cell"
      data-digit={numeric() ? "true" : undefined}
      data-rolling={roll() === undefined ? undefined : "true"}
    >
      <span class="bn-money__current">{character()}</span>
      <Show when={roll()} keyed>
        {(step) => (
          <span
            class="bn-money__reel"
            onAnimationEnd={() => setRoll(undefined)}
            onAnimationCancel={() => setRoll(undefined)}
          >
            <span>{step.from}</span>
            <span>{step.to}</span>
          </span>
        )}
      </Show>
    </span>
  );
}

/**
 * A formatted value whose digits roll in place when it changes. Cells are
 * aligned from the end so a suffix or a new leading digit leaves unchanged
 * positions mounted.
 */
export function RollingText(props: { text: string }) {
  const length = createMemo(() => props.text.length);
  const positions = createMemo(() =>
    Array.from({ length: length() }, (_, index) => length() - index),
  );

  return (
    <span class="bn-money">
      <span class="bn-money__text">{props.text}</span>
      <span class="bn-money__visual" aria-hidden="true">
        <For each={positions()}>
          {(position) => <RollCell character={props.text.charAt(props.text.length - position)} />}
        </For>
      </span>
    </span>
  );
}

export function RollingMoney(props: { value: Money }) {
  const formatted = createMemo(() => formatMoney(props.value));
  return <RollingText text={formatted()} />;
}
