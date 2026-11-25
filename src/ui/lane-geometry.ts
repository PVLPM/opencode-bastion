import type { AgentStatus, Handoff, LanesView } from "../model/types";

/** Row metrics shared by the CSS (see `.bn-lanes`) and the connector paths. */
const AXIS_HEIGHT = 22;
export const LANE_HEIGHT = 28;

/** Inset of the time origin from the track's left edge, and room after the last block. */
const START_PAD = 8;
const END_PAD = 24;
const MIN_BLOCK = 3;
/** Gap a label keeps before the next block on its lane. */
const LABEL_GAP = 6;
/** Three characters at the 11px label font, plus 6px and 2px inline padding. */
const MIN_LABEL = 26;
const MIN_TICK_SPACING = 64;
const MIN_FIT_TICK_SPACING = 44;
const NOW_LABEL_ROOM = 64;

/**
 * Detail zoom levels in px per second, largest first. The track uses the
 * largest one that fits the visible width and only steps down when the span
 * outgrows it, so finished blocks stay put between steps instead of shrinking
 * every second. One pixel per second is the floor: below it a minute-long
 * execution is too short to carry its label, so long sessions scroll instead.
 */
const MIN_SCALE = 1;
const SCALES = [40, 20, 10, 5, 2, MIN_SCALE] as const;
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200] as const;
/** Ages, in seconds, that may carry a marker on the Fit axis. */
const FIT_TICKS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400] as const;

/**
 * "detail" is linear and scrolls; "fit" shows the whole session in the visible
 * width on a logarithmic scale of age, so the newest minutes keep their room
 * and older history is compressed toward the left edge.
 */
export type LaneScale = "fit" | "detail";

export interface BlockBox {
  readonly id: string;
  readonly x: number;
  readonly width: number;
  readonly start: number;
  readonly end: number;
  readonly status: AgentStatus;
  readonly label: string | undefined;
  readonly text: string | undefined;
  /** Room for the label inside the block, up to the next block (0: too narrow to label). */
  readonly labelWidth: number;
  readonly live: boolean;
}

export interface LaneBox {
  readonly sessionID: string;
  readonly agent: string;
  readonly title: string | undefined;
  readonly root: boolean;
  readonly blocks: readonly BlockBox[];
}

interface Tick {
  readonly key: string;
  readonly x: number;
  readonly label: string;
}

interface Connector {
  readonly id: string;
  readonly from: string | undefined;
  readonly to: string;
  readonly kind: Handoff["kind"];
  /** The child block it feeds is still running. */
  readonly live: boolean;
  readonly d: string;
}

export interface LanesGeometry {
  readonly scale: LaneScale;
  readonly lanes: readonly LaneBox[];
  readonly ticks: readonly Tick[];
  readonly connectors: readonly Connector[];
  readonly inbound: ReadonlyMap<string, ReadonlySet<Handoff["kind"]>>;
  readonly sourceAgent: string | undefined;
  readonly width: number;
  readonly height: number;
  /** First start to the last end, or to now while anything is live. */
  readonly span: number;
  /** Present while any execution is live. */
  readonly nowX: number | undefined;
}

export function pickScale(spanMs: number, viewport: number): number {
  for (const scale of SCALES)
    if ((spanMs / 1000) * scale + START_PAD + END_PAD <= viewport) return scale;
  return MIN_SCALE;
}

/** True when the linear Detail view cannot show the whole span without scrolling. */
export function outgrowsDetail(spanMs: number, viewport: number): boolean {
  return (spanMs / 1000) * pickScale(spanMs, viewport) + START_PAD + END_PAD > viewport;
}

export function formatTick(seconds: number): string {
  if (seconds === 0) return "0";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const rest = seconds % 60;
    return rest === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${rest}s`;
  }
  const minutes = Math.floor((seconds % 3600) / 60);
  const hours = Math.floor(seconds / 3600);
  return minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/**
 * The Fit mapping from a time to track x: `from` lands at the left inset and
 * `end` at the right edge; x grows with ln(1 + age / knee) of the time left
 * until `end`, so it is strictly monotonic and keeps every block in order.
 */
export function fitScale(from: number, end: number, viewport: number): (time: number) => number {
  const span = Math.max(1, (end - from) / 1000);
  // The knee sets how much room recent time keeps: about a sixtieth of the span.
  const knee = Math.min(300, Math.max(5, span / 60));
  const width = Math.max(1, viewport - START_PAD - END_PAD);
  const total = Math.log1p(span / knee);
  return (time) => {
    const age = Math.min(span, Math.max(0, (end - time) / 1000));
    return START_PAD + width * (1 - Math.log1p(age / knee) / total);
  };
}

function laneCenter(index: number): number {
  return AXIS_HEIGHT + index * LANE_HEIGHT + LANE_HEIGHT / 2;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Keep both tangents horizontal. Monotonic y prevents even a reverse-x curve from looping. */
export function handoffPath(
  start: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
  right: number,
): string {
  const reach = Math.min(40, Math.max(12, Math.abs(target.x - start.x) * 0.42));
  // At a plot boundary, point the handle back into the plot instead of clipping away the curve.
  const out = start.x < right ? Math.min(right, start.x + reach) : Math.max(0, start.x - reach);
  const into = target.x > 0 ? Math.max(0, target.x - reach) : Math.min(right, target.x + reach);
  return `M ${start.x} ${start.y} C ${Math.min(right, round(out))} ${start.y} ${Math.min(right, round(into))} ${target.y} ${target.x} ${target.y}`;
}

function detailTicks(
  x: (time: number) => number,
  from: number,
  span: number,
  scale: number,
  nowX: number | undefined,
): Tick[] {
  const step = TICK_STEPS.find((candidate) => candidate * scale >= MIN_TICK_SPACING) ?? 7200;
  const ticks: Tick[] = [];
  for (let seconds = 0; seconds <= span / 1000; seconds += step) {
    const at = x(from + seconds * 1000);
    // The "now" label sits just left of the now line; a tick label there would collide.
    if (nowX !== undefined && at > nowX - NOW_LABEL_ROOM) break;
    ticks.push({ key: String(seconds), x: at, label: formatTick(seconds) });
  }
  return ticks;
}

/** Age markers, newest first, kept only where they have room; labelled as time before the end. */
function fitTicks(x: (time: number) => number, end: number, span: number): Tick[] {
  const ticks: Tick[] = [];
  let edge = x(end) - NOW_LABEL_ROOM;
  for (const age of FIT_TICKS) {
    if (age * 1000 > span) break;
    const at = x(end - age * 1000);
    if (at > edge) continue;
    ticks.push({ key: `-${age}`, x: at, label: `−${formatTick(age)}` });
    edge = at - MIN_FIT_TICK_SPACING;
  }
  return ticks.toReversed();
}

/** First start to the last end (now while anything is live), and whether anything is. */
export function laneSpan(
  view: LanesView,
  now: number,
): { readonly span: number; readonly live: boolean } | undefined {
  const from = view.from;
  if (from === undefined) return undefined;
  let to = from;
  let live = false;
  for (const lane of view.lanes) {
    for (const block of lane.blocks) {
      if (block.end === undefined) live = true;
      to = Math.max(to, block.end ?? now);
    }
  }
  return { span: to - from, live };
}

/**
 * Pure layout of the lanes on one shared time axis, in track pixels. In Detail
 * `now` only feeds live blocks and the axis end, so closed blocks depend on
 * nothing but their own timestamps and the zoom level. In Fit the whole span
 * maps onto the viewport and everything drifts left as time passes.
 */
export function laneGeometry(
  view: LanesView,
  now: number,
  viewport: number,
  scale: LaneScale = "detail",
): LanesGeometry | undefined {
  const from = view.from;
  const measured = laneSpan(view, now);
  if (from === undefined || measured === undefined) return undefined;
  const { span, live: hasLive } = measured;
  const to = from + span;
  const zoom = pickScale(span, viewport);
  const mapX =
    scale === "fit"
      ? fitScale(from, to, viewport)
      : (time: number) => START_PAD + ((time - from) / 1000) * zoom;
  const x = scale === "fit" ? (time: number) => Math.round(mapX(time)) : mapX;

  const width = scale === "fit" ? viewport : Math.max(viewport, x(to) + END_PAD);
  const nowX = hasLive ? x(now) : undefined;
  const limit = nowX ?? width;
  const lanes = view.lanes.map((lane) => ({
    sessionID: lane.sessionID,
    agent: lane.agent,
    title: lane.title,
    root: lane.root,
    blocks: lane.blocks.map((block, index) => {
      const end = block.end ?? Math.max(now, block.start);
      const left = x(block.start);
      const next = lane.blocks[index + 1];
      const blockWidth = Math.max(0, Math.min(limit - left, Math.max(MIN_BLOCK, x(end) - left)));
      const gapRoom =
        Math.min(limit, next === undefined ? width : x(next.start)) - LABEL_GAP - left;
      const labelRoom = Math.min(blockWidth, gapRoom);
      return {
        id: block.id,
        x: left,
        width: blockWidth,
        start: block.start,
        end,
        status: block.status,
        label: block.label,
        text: block.text,
        labelWidth: labelRoom >= MIN_LABEL ? labelRoom : 0,
        live: block.end === undefined,
      };
    }),
  }));

  const ticks = scale === "fit" ? fitTicks(x, to, span) : detailTicks(x, from, span, zoom, nowX);

  const rootIndex = lanes.findIndex((lane) => lane.root);
  const rootBlocks = lanes[rootIndex]?.blocks ?? [];
  const startY = laneCenter(Math.max(0, rootIndex));
  const targets = new Map<string, { block: BlockBox; y: number; sessionID: string }>();
  for (const [index, lane] of lanes.entries()) {
    if (!lane.root)
      for (const block of lane.blocks)
        targets.set(block.id, { block, y: laneCenter(index), sessionID: lane.sessionID });
  }
  const connectors: Connector[] = [];
  const inbound = new Map<string, Set<Handoff["kind"]>>();
  let rootCursor = -1;
  for (const handoff of view.handoffs) {
    if (handoff.blockID === undefined) continue;
    const target = targets.get(handoff.blockID);
    if (target === undefined || target.sessionID !== handoff.childID || target.block.width === 0)
      continue;
    // The view's handoffs and root blocks both arrive in chronological order.
    while ((rootBlocks[rootCursor + 1]?.start ?? Number.POSITIVE_INFINITY) <= handoff.at)
      rootCursor += 1;
    const source = rootBlocks[rootCursor];
    const { block, y } = target;
    const atX = Math.max(0, Math.min(limit, x(handoff.at)));
    const inserted = handoff.at > block.start && (block.live || handoff.at < block.end);
    const landing = inserted ? Math.min(block.x + block.width, atX) : block.x;
    const kinds = inbound.get(block.id) ?? new Set<Handoff["kind"]>();
    kinds.add(handoff.kind);
    inbound.set(block.id, kinds);
    connectors.push({
      id: handoff.id,
      from: source?.id,
      to: block.id,
      kind: handoff.kind,
      live: block.live,
      // Start at the call itself: a child block that starts after the call would
      // make a line from the source block's right edge bend backwards.
      d: handoffPath({ x: atX, y: startY }, { x: landing, y }, limit),
    });
  }

  return {
    scale,
    lanes,
    ticks,
    connectors,
    inbound,
    sourceAgent: lanes[rootIndex]?.agent,
    width,
    height: AXIS_HEIGHT + lanes.length * LANE_HEIGHT,
    span,
    nowX,
  };
}
