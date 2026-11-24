import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";

import { formatMoney } from "../model/format";
import type { Money } from "../model/types";
import { reduceMotion } from "./motion";

const DIGIT = /^[0-9]$/;

function MoneyCell(props: { character: string }) {
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

export function RollingMoney(props: { value: Money }) {
  const formatted = createMemo(() => formatMoney(props.value));
  // Align cells from the cents end so adding `~`, `<`, or another dollar digit
  // leaves all the unchanged positions mounted.
  const length = createMemo(() => formatted().length);
  const positions = createMemo(() =>
    Array.from({ length: length() }, (_, index) => length() - index),
  );

  return (
    <span class="bn-money">
      <span class="bn-money__text">{formatted()}</span>
      <span class="bn-money__visual" aria-hidden="true">
        <For each={positions()}>
          {(position) => (
            <MoneyCell character={formatted().charAt(formatted().length - position)} />
          )}
        </For>
      </span>
    </span>
  );
}
