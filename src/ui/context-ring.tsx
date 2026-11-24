import { Show } from "solid-js";

import type { ContextUsage } from "../model/types";
import { formatTokens } from "../model/format";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "31% · 62.4k of 200k", or undefined when the limit is unknown. */
export function contextSummary(context: ContextUsage): string | undefined {
  if (context.limit <= 0) return undefined;
  const percent = Math.round(Math.min(100, (Math.max(0, context.used) / context.limit) * 100));
  return `${percent}% · ${formatTokens(context.used)} of ${formatTokens(context.limit)}`;
}

/**
 * Context load of the latest assistant message as a compact ring; the numbers
 * live in its label and the card's details. Nothing renders when the limit is
 * unknown or zero, so a card never shows an invented percentage.
 */
export function ContextRing(props: { context: ContextUsage }) {
  const percent = () => {
    if (props.context.limit <= 0) return undefined;
    const used = Math.max(0, props.context.used);
    return Math.min(100, (used / props.context.limit) * 100);
  };

  return (
    <Show when={percent()}>
      {(value) => (
        <span
          class="bn-ring"
          data-level={value() >= 85 ? "high" : "normal"}
          role="img"
          aria-label={`Context ${Math.round(value())} percent: ${formatTokens(
            props.context.used,
          )} of ${formatTokens(props.context.limit)} tokens`}
        >
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true">
            <circle
              class="bn-ring__track"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke-width={STROKE}
            />
            <circle
              class="bn-ring__value"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke-width={STROKE}
              stroke-linecap="round"
              stroke-dasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              stroke-dashoffset={CIRCUMFERENCE * (1 - value() / 100)}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>
        </span>
      )}
    </Show>
  );
}
