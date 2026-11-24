import { createMemo, type Accessor } from "solid-js";

export interface Keyed<T> {
  /** The keys in order; a new array only when the keys or their order change. */
  readonly ids: Accessor<readonly string[]>;
  readonly get: (id: string) => T | undefined;
}

function sameIDs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Stable identity for lists the host rebuilds on every clock tick: render with
 * `<For each={ids()}>` and read the latest item through `get`, so rows update
 * in place instead of being recreated (which would restart their animations).
 */
export function createKeyed<T>(list: Accessor<readonly T[]>, key: (item: T) => string): Keyed<T> {
  const ids = createMemo<readonly string[]>(() => list().map(key), [], { equals: sameIDs });
  const byID = createMemo(() => new Map(list().map((item) => [key(item), item] as const)));
  return { ids, get: (id) => byID().get(id) };
}
