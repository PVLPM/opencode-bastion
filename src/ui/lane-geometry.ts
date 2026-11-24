import type { AgentStatus, Handoff, LanesView } from "../model/types";

/** Row metrics shared by the CSS (see `.bn-lanes`) and the connector paths. */
const AXIS_HEIGHT = 22;
export const LANE_HEIGHT = 28;
const BLOCK_HEIGHT = 20;

/** Inset of the time origin from the track's left edge, and room after the last block. */
const START_PAD = 8;
const END_PAD = 24;
const MIN_BLOCK = 3;
/** Gap a label keeps before the next block on its lane; below the minimum it is hidden. */
const LABEL_GAP = 6;
const MIN_LABEL = 18;
/** A handoff leaves its prompt block this far to the right before it curves down. */
const LEAVE = 6;
/** Horizontal travel of the curve, so it lands just after the call, never under the prompt. */
const RUN = 18;
const LAND_INSET = 4;
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
  /** Room for the label from the block's left edge to the next block (0: no label). */
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
  readonly kind: Handoff["kind"];
  /** The child block it feeds is still running. */
  readonly live: boolean;
  readonly d: string;
  /** A small caret on the child block's top edge where the call lands. */
  readonly mark: string;
}

export interface LanesGeometry {
  readonly scale: LaneScale;
  readonly lanes: readonly LaneBox[];
  readonly ticks: readonly Tick[];
  readonly connectors: readonly Connector[];
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

/**
 * Where a handoff leaves the orchestrator lane: the right end of the prompt
 * block that issued it (the last one to start at or before the call), or the
 * call time itself while that block still runs or when none is known.
 */
export function handoffStart(rootBlocks: readonly BlockBox[], at: number, atX: number): number {
  const prompt = rootBlocks.findLast((block) => block.start <= at);
  if (prompt === undefined || prompt.live) return atX;
  return prompt.x + prompt.width;
}

/**
 * A handoff connector: out of the prompt block's right end, a short level run,
 * then one cubic curve that leaves horizontally and arrives vertically on the
 * child block's top edge, just after the call and always within the block.
 */
export function handoffPath(
  start: { readonly x: number; readonly y: number },
  atX: number,
  target: { readonly x: number; readonly width: number; readonly top: number },
) {
  const leaveX = start.x + LEAVE;
  const low = target.x + Math.min(LAND_INSET, target.width / 2);
  const high = target.x + Math.max(target.width - LAND_INSET, target.width / 2);
  const landX = Math.min(high, Math.max(low, Math.max(atX, leaveX + RUN - LEAVE)));
  const drop = target.top - start.y;
  const reach = Math.max(LEAVE, (landX - leaveX) * 0.6);
  const d =
    `M ${round(start.x)} ${round(start.y)} H ${round(leaveX)} ` +
    `C ${round(leaveX + reach)} ${round(start.y)} ${round(landX)} ${round(target.top - drop * 0.55)} ` +
    `${round(landX)} ${round(target.top)}`;
  return { d, landX };
}

function insertMark(x: number, top: number): string {
  return `M ${round(x - 3)} ${round(top + 3)} L ${round(x)} ${round(top + 6)} L ${round(x + 3)} ${round(top + 3)}`;
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
  const { span, live } = measured;
  const to = from + span;
  const zoom = pickScale(span, viewport);
  const x =
    scale === "fit"
      ? fitScale(from, to, viewport)
      : (time: number) => START_PAD + ((time - from) / 1000) * zoom;

  const width = scale === "fit" ? viewport : Math.max(viewport, x(to) + END_PAD);
  const lanes = view.lanes.map((lane) => ({
    sessionID: lane.sessionID,
    agent: lane.agent,
    title: lane.title,
    root: lane.root,
    blocks: lane.blocks.map((block, index) => {
      const end = block.end ?? Math.max(now, block.start);
      const left = x(block.start);
      const next = lane.blocks[index + 1];
      // A label may run past a short block into the empty lane up to the next block.
      const room = (next === undefined ? width : x(next.start)) - LABEL_GAP - left;
      return {
        id: block.id,
        x: left,
        width: Math.max(MIN_BLOCK, x(end) - left),
        start: block.start,
        end,
        status: block.status,
        label: block.label,
        labelWidth: room >= MIN_LABEL ? room : 0,
        live: block.end === undefined,
      };
    }),
  }));

  const nowX = live ? x(now) : undefined;
  const ticks = scale === "fit" ? fitTicks(x, to, span) : detailTicks(x, from, span, zoom, nowX);

  const rootIndex = lanes.findIndex((lane) => lane.root);
  const rootBlocks = lanes[rootIndex]?.blocks ?? [];
  const startY = laneCenter(Math.max(0, rootIndex));
  const connectors: Connector[] = [];
  for (const handoff of view.handoffs) {
    if (handoff.blockID === undefined) continue;
    const laneIndex = lanes.findIndex((lane) => lane.sessionID === handoff.childID);
    const block = lanes[laneIndex]?.blocks.find((candidate) => candidate.id === handoff.blockID);
    if (block === undefined) continue;
    const atX = x(handoff.at);
    const top = laneCenter(laneIndex) - BLOCK_HEIGHT / 2;
    const path = handoffPath({ x: handoffStart(rootBlocks, handoff.at, atX), y: startY }, atX, {
      x: block.x,
      width: block.width,
      top,
    });
    connectors.push({
      id: handoff.id,
      kind: handoff.kind,
      live: block.live,
      d: path.d,
      mark: insertMark(path.landX, top),
    });
  }

  return {
    scale,
    lanes,
    ticks,
    connectors,
    width,
    height: AXIS_HEIGHT + lanes.length * LANE_HEIGHT,
    span,
    nowX,
  };
}
