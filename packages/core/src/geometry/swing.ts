/**
 * Phase 18 — exact door-swing sector geometry (shared by validation and furniture
 * placement). Replaces the former "V1" bounding-box/center-distance proxies with
 * the actual 90° swing sector the Opening model already carries (hinge / leafEnd /
 * openEnd). This is a precision fix, not a semantic change: a door or furniture
 * piece is flagged only when geometry genuinely enters the swing sector, and
 * tangential contacts (a door opening flat against its wall, normal T-junctions
 * at the wall ends) stay clear.
 */
import type { Opening } from '../model/opening.js';
import type { Vec2 } from './vec2.js';
import type { Rect } from './rect.js';

/** Tolerance (m): contacts shallower than this along a separating axis count as tangency, not obstruction. */
const SECTOR_TANGENCY_TOL = 0.02;

/**
 * Convex polygon that CONTAINS the door's true 90° swing sector (quarter disk).
 * Vertices: hinge, arc from the closed-leaf ray (u) to the open-leaf ray (v).
 * Interior arc vertices use radius r/cos(halfStep) so chords never cut inside
 * the real arc (conservative: may over-cover by <2%, never misses a block).
 * Returns null for non-swing doors (sliding or missing leaf geometry).
 */
export function doorSwingSectorPolygon(o: Opening): Vec2[] | null {
  if (!o.hinge || !o.leafEnd || !o.openEnd) return null;
  if (o.swing === 'sliding') return null;
  const h = o.hinge;
  const ux = o.leafEnd.x - h.x, uy = o.leafEnd.y - h.y;
  const vx = o.openEnd.x - h.x, vy = o.openEnd.y - h.y;
  const ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
  if (!(ul > 1e-9) || !(vl > 1e-9)) return null;
  const u = { x: ux / ul, y: uy / ul };
  const v = { x: vx / vl, y: vy / vl };
  const r = Math.max(o.width, 0.1);
  const steps = 8;
  const pts: Vec2[] = [{ x: h.x, y: h.y }];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI / 2;
    const rad = i === 0 || i === steps ? r : r / Math.cos(Math.PI / (2 * steps));
    pts.push({ x: h.x + (u.x * Math.cos(t) + v.x * Math.sin(t)) * rad, y: h.y + (u.y * Math.cos(t) + v.y * Math.sin(t)) * rad });
  }
  return pts;
}

function project(poly: Vec2[], ax: number, ay: number): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Convex-convex overlap with tangency tolerance. An axis separates the shapes
 * when its projection intervals are disjoint OR their penetration is at most
 * tangential (<= tol). Penetration for overlapping intervals is the minimum
 * end-to-end distance (correct also for degenerate point/line projections,
 * e.g. wall centerlines): a segment strictly inside the sector has positive
 * clearance to the boundary and blocks; a segment lying exactly ON a sector
 * edge has zero penetration and stays clear.
 */
function convexOverlap(polyA: Vec2[], axes: Array<[number, number]>, polyB: Vec2[]): boolean {
  for (const [ax, ay] of axes) {
    const a = project(polyA, ax, ay);
    const b = project(polyB, ax, ay);
    if (a.max < b.min || b.max < a.min) return false; // disjoint
    const pen = Math.min(a.max - b.min, b.max - a.min);
    if (pen <= SECTOR_TANGENCY_TOL) return false; // tangential contact only
  }
  return true;
}

function rectPoly(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ];
}

function polyAxes(poly: Vec2[]): Array<[number, number]> {
  const axes: Array<[number, number]> = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const l = Math.hypot(ex, ey);
    if (l > 1e-9) axes.push([-ey / l, ex / l]);
  }
  return axes;
}

/**
 * True when the furniture rect genuinely enters the door's swing sector
 * (beyond tangency). Doors without swing geometry are never blocking.
 */
export function rectBlocksDoorSwing(rect: Rect, o: Opening): boolean {
  const sector = doorSwingSectorPolygon(o);
  if (!sector) return false;
  const rp = rectPoly(rect);
  const axes: Array<[number, number]> = [[1, 0], [0, 1], ...polyAxes(sector)];
  return convexOverlap(rp, axes, sector);
}

/**
 * True when a wall centerline segment genuinely crosses the door's swing sector
 * (beyond tangency — a door opening flat against its host wall stays clear).
 */
export function segmentBlocksDoorSwing(ax: number, ay: number, bx: number, by: number, o: Opening): boolean {
  const sector = doorSwingSectorPolygon(o);
  if (!sector) return false;
  const ex = bx - ax, ey = by - ay;
  const l = Math.hypot(ex, ey);
  const segPoly: Vec2[] = l > 1e-9
    ? [{ x: ax, y: ay }, { x: bx, y: by }]
    : [{ x: ax, y: ay }];
  const axes: Array<[number, number]> = l > 1e-9
    ? [[-ey / l, ex / l], [ex / l, ey / l], ...polyAxes(sector)]
    : [[1, 0], [0, 1], ...polyAxes(sector)];
  return convexOverlap(segPoly, axes, sector);
}
