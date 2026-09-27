/**
 * Per-room dimension callouts for the plan inspection canvas
 * (ROADMAP Phase 5 — "per-room dimension callouts").
 *
 * Pure, deterministic helpers. Edge lengths come ONLY from the canonical
 * `Space.polygon` (world metres). Nothing is inferred from rendered pixels, and
 * the input polygon/space is never mutated. The screen layout keeps a constant
 * pixel offset and font size, so callouts stay readable at every zoom level.
 */
import { tf, faNum, spaceLabel } from './i18n';

export interface Pt { x: number; y: number }

/** Geometric tolerance (metres) for duplicate / collinear vertices. */
export const DIM_EPS = 1e-6;

export interface EdgeDimension {
  /** Order of the edge along the (cleaned) polygon, starting at its first vertex. */
  index: number;
  a: Pt;
  b: Pt;
  /** Exact edge length in metres. */
  length: number;
  /** Display text. Technical value: Western digits in an LTR run, like the rest of the canvas. */
  label: string;
  mid: Pt;
  /** Outward unit normal (world, y-up). */
  normal: Pt;
}

/** Dimension text: 2 decimals + metre unit, the same convention as the canvas scale bar and spaces panel. */
export function formatDimension(lengthM: number): string {
  return `${lengthM.toFixed(2)} m`;
}

/**
 * Drop consecutive duplicate vertices (incl. a closing duplicate) and merge
 * collinear runs, so each callout measures one straight room edge.
 */
function cleanPolygon(poly: readonly Pt[]): Pt[] {
  let pts: Pt[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > DIM_EPS) pts.push({ x: p.x, y: p.y });
  }
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) <= DIM_EPS) pts.pop();
  }
  // Remove vertices that lie on a straight line between their neighbours
  // (same direction only). Repeat until stable, so the result is deterministic.
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      const ux = c.x - p.x, uy = c.y - p.y, vx = n.x - c.x, vy = n.y - c.y;
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      const cross = (ux * vy - uy * vx) / (lu * lv);
      const dot = ux * vx + uy * vy;
      if (Math.abs(cross) <= DIM_EPS && dot > 0) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Edge lengths of a room polygon (rectangular or any orthogonal / simple
 * polygon). Returns [] for polygons with fewer than 3 distinct vertices.
 */
export function roomEdgeDimensions(polygon: readonly Pt[] | null | undefined): EdgeDimension[] {
  if (!polygon) return [];
  const pts = cleanPolygon(polygon);
  if (pts.length < 3) return [];
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area2 += p.x * q.y - q.x * p.y;
  }
  if (Math.abs(area2) <= DIM_EPS) return [];
  const ccw = area2 > 0;
  const out: EdgeDimension[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    // For a CCW ring the outward side of edge (dx,dy) is (dy,-dx).
    const s = ccw ? 1 : -1;
    out.push({
      index: i,
      a, b, length,
      label: formatDimension(length),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      normal: { x: (s * dy) / length, y: (-s * dx) / length },
    });
  }
  return out;
}

export interface DimensionLayoutOptions {
  /** Constant screen distance (px) between the room edge and the dimension line. */
  offsetPx: number;
  /** Constant label font size (px). */
  fontPx: number;
  /** Edges shorter than this on screen get no callout. */
  minEdgePx: number;
}

export const DEFAULT_DIM_LAYOUT: DimensionLayoutOptions = { offsetPx: 14, fontPx: 11, minEdgePx: 24 };

export interface DimensionCallout {
  index: number;
  label: string;
  length: number;
  /** Extension lines: room-edge endpoint → dimension-line endpoint (screen px). */
  ext: [[number, number, number, number], [number, number, number, number]];
  /** Dimension line (screen px). */
  line: [number, number, number, number];
  /** Label centre (screen px) and rotation (radians, kept upright in (-π/2, π/2]). */
  textX: number;
  textY: number;
  angle: number;
  /** Approximate label box (width × height, px) used for overlap culling. */
  textW: number;
  textH: number;
}

/** Axis-aligned box of a rotated label. */
function labelBox(c: DimensionCallout) {
  const cos = Math.abs(Math.cos(c.angle)), sin = Math.abs(Math.sin(c.angle));
  const hw = (c.textW * cos + c.textH * sin) / 2;
  const hh = (c.textW * sin + c.textH * cos) / 2;
  return { x0: c.textX - hw, y0: c.textY - hh, x1: c.textX + hw, y1: c.textY + hh };
}

/**
 * Project edge dimensions to screen callouts. Deterministic:
 * - offset and font size are constant in pixels (zoom-independent readability);
 * - edges too short on screen for their label are skipped;
 * - overlap culling is greedy: longest edge first, ties by edge index; a label
 *   whose box intersects an already accepted label is skipped.
 * The result is returned in edge-index order.
 */
export function layoutDimensionCallouts(
  edges: readonly EdgeDimension[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  opts: DimensionLayoutOptions = DEFAULT_DIM_LAYOUT,
): DimensionCallout[] {
  const candidates: DimensionCallout[] = [];
  for (const e of edges) {
    const ax = tx(e.a.x), ay = ty(e.a.y), bx = tx(e.b.x), by = ty(e.b.y);
    const sdx = bx - ax, sdy = by - ay;
    const sLen = Math.hypot(sdx, sdy);
    const textW = e.label.length * opts.fontPx * 0.6;
    const textH = opts.fontPx * 1.2;
    if (sLen < Math.max(opts.minEdgePx, textW + 4)) continue;
    // Screen normal: world normal with y flipped (screen is y-down).
    const nx = e.normal.x, ny = -e.normal.y;
    const o = opts.offsetPx;
    const l1x = ax + nx * o, l1y = ay + ny * o, l2x = bx + nx * o, l2y = by + ny * o;
    let angle = Math.atan2(sdy, sdx);
    if (angle > Math.PI / 2 + 1e-9) angle -= Math.PI;
    else if (angle <= -Math.PI / 2 + 1e-9) angle += Math.PI;
    candidates.push({
      index: e.index,
      label: e.label,
      length: e.length,
      ext: [[ax, ay, l1x, l1y], [bx, by, l2x, l2y]],
      line: [l1x, l1y, l2x, l2y],
      textX: (l1x + l2x) / 2,
      textY: (l1y + l2y) / 2,
      angle,
      textW,
      textH,
    });
  }
  const order = [...candidates].sort((p, q) => (q.length - p.length) || (p.index - q.index));
  const accepted: DimensionCallout[] = [];
  for (const c of order) {
    const bb = labelBox(c);
    const hit = accepted.some(a => {
      const ab = labelBox(a);
      return bb.x0 < ab.x1 && bb.x1 > ab.x0 && bb.y0 < ab.y1 && bb.y1 > ab.y0;
    });
    if (!hit) accepted.push(c);
  }
  return accepted.sort((p, q) => p.index - q.index);
}

/** Minimal shape the canvas needs: spaces with id, label and canonical polygon. */
export interface DimFloor { spaces: ReadonlyArray<{ id: string; label: string; polygon: readonly Pt[] }> }

/**
 * Callouts for the currently selected space on this floor. Returns [] when no
 * space is selected or the selected id is not on this floor.
 */
export function selectedRoomCallouts(
  floor: DimFloor,
  selectedSpaceId: string | null | undefined,
  tx: (x: number) => number,
  ty: (y: number) => number,
  opts: DimensionLayoutOptions = DEFAULT_DIM_LAYOUT,
): DimensionCallout[] {
  if (!selectedSpaceId) return [];
  const sp = floor.spaces.find(s => s.id === selectedSpaceId);
  if (!sp) return [];
  return layoutDimensionCallouts(roomEdgeDimensions(sp.polygon), tx, ty, opts);
}

/** Persian caption for the selected room's dimension overlay (existing i18n system). */
export function dimensionCaption(roomLabel: string, edgeCount: number): string {
  return tf('canvasDimCaption', { room: spaceLabel(roomLabel), count: faNum(edgeCount) });
}
