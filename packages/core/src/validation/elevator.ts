/**
 * Elevator shaft GEOMETRY validation (first bounded subphase).
 *
 * These are geometric-integrity invariants only — they say whether the
 * generated shaft exists, stacks, stays inside the building, collides with
 * nothing and has a floor-level landing. They are NOT regulatory checks: the
 * shaft dimensions are DESIGN ASSUMPTIONS (model/stairs.ts), and nothing here
 * reports or implies Mabhas 15 compliance (MBH15-LIFT-002 stays
 * NOT_IMPLEMENTED; pit/headroom/fire rating are not modelled).
 *
 *  ELEV_SHAFT_MISSING (hard)        floor requested a shaft (hasElevator on a
 *                                   2+ floor building) but carries none.
 *  ELEV_SHAFT_MISALIGNED (hard)     same core on adjacent floors, different
 *                                   rect — a shaft must be one vertical prism.
 *  ELEV_SHAFT_OUTSIDE_BUILDABLE (hard)
 *  ELEV_SHAFT_OVERLAP (hard)        shaft overlaps a room, furniture, a
 *                                   parking stall or a stair footprint.
 *  ELEV_SHAFT_NO_LANDING (hard)     no shared edge ≥ 0.80 m with floor-level
 *                                   circulation (corridor / foyer / entrance),
 *                                   or no landing door located on that edge.
 *  ELEV_SHAFT_GEOMETRY_INCONSISTENT (hard)
 *                                   cabin ⊄ clear shaft ⊄ shaft cell, or the
 *                                   shaft no longer matches its hall space
 *                                   (rect or polygon).
 */
import type { Floor } from '../model/floor.js';
import type { Elevator } from '../model/stairs.js';
import type { Rect } from '../geometry/rect.js';
import { rContains, rOverlapArea } from '../geometry/rect.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import type { Finding } from './types.js';

/** Floor-level circulation a shaft may land on (same set the generator uses). */
const LANDING_TYPES = new Set(['corridor', 'foyer', 'entrance']);
/** Minimum usable landing edge (door-going width) — geometric, not a code value. */
const MIN_LANDING_EDGE = 0.8;
const OVERLAP_NOISE = 0.01; // m²
const RECT_TOL = 0.011; // m — placement snaps to a cm grid

function f(code: Finding['code'], msg: string, entityIds?: string[], r?: Rect): Finding {
  return { code, severity: 'hard', message: msg, entityIds, bbox: r ? [r.x, r.y, r.x + r.w, r.y + r.h] : undefined };
}

function sameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < RECT_TOL && Math.abs(a.y - b.y) < RECT_TOL
    && Math.abs(a.w - b.w) < RECT_TOL && Math.abs(a.h - b.h) < RECT_TOL;
}

/** Longest edge `a` shares with `b` (touching, collinear, overlapping span). */
/** eps is tight on purpose: walls and the landing door need one EXACT shared
 *  edge; a cm seam produces two one-sided walls and no landing. */
function sharedEdge(a: Rect, b: Rect, eps = 0.005): number {
  const ov = (a0: number, a1: number, c0: number, c1: number) => Math.max(0, Math.min(a1, c1) - Math.max(a0, c0));
  let m = 0;
  if (Math.abs(a.y - (b.y + b.h)) < eps || Math.abs(a.y + a.h - b.y) < eps) m = Math.max(m, ov(a.x, a.x + a.w, b.x, b.x + b.w));
  if (Math.abs(a.x - (b.x + b.w)) < eps || Math.abs(a.x + a.w - b.x) < eps) m = Math.max(m, ov(a.y, a.y + a.h, b.y, b.y + b.h));
  return m;
}

function polyBBox(poly: { x: number; y: number }[]): Rect {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Point lies on the rect's boundary (within wall-snap noise), inside its span. */
function onRectBoundary(p: { x: number; y: number } | undefined, r: Rect, eps = 0.02): boolean {
  if (!p) return false;
  const inX = p.x >= r.x - eps && p.x <= r.x + r.w + eps;
  const inY = p.y >= r.y - eps && p.y <= r.y + r.h + eps;
  const onV = (Math.abs(p.x - r.x) < eps || Math.abs(p.x - (r.x + r.w)) < eps) && inY;
  const onH = (Math.abs(p.y - r.y) < eps || Math.abs(p.y - (r.y + r.h)) < eps) && inX;
  return onV || onH;
}

function validateOneElevator(e: Elevator, fl: Floor): Finding[] {
  const out: Finding[] = [];
  // Inside the buildable geometry (polygon when the generator stamped one).
  const boundary = (fl as any).buildableBoundary as { x: number; y: number }[] | undefined;
  const inside = Array.isArray(boundary) && boundary.length >= 3
    ? rectInsidePolygon(e.rect, boundary, 1e-3)
    : rContains(fl.footprint, e.rect, 0.02);
  if (!inside) {
    out.push(f('ELEV_SHAFT_OUTSIDE_BUILDABLE', `Elevator ${e.id} on floor ${fl.level}: shaft cell leaves the buildable area.`, [e.id], e.rect));
  }
  // Collisions: every other space, furniture, parking, stair footprints.
  const hits: string[] = [];
  for (const s of fl.spaces) if (s.id !== e.hallSpaceId && rOverlapArea(e.rect, s.rect) > OVERLAP_NOISE) hits.push(s.id);
  for (const fu of fl.furniture ?? []) if (rOverlapArea(e.rect, fu.rect) > OVERLAP_NOISE) hits.push(fu.id);
  for (const p of fl.parkingStalls ?? []) if (rOverlapArea(e.rect, p.rect) > OVERLAP_NOISE) hits.push(p.id);
  for (const st of fl.stairs ?? []) if (rOverlapArea(e.rect, st.footprint ?? st.rect) > OVERLAP_NOISE) hits.push(st.id);
  if (hits.length) {
    out.push(f('ELEV_SHAFT_OVERLAP', `Elevator ${e.id} on floor ${fl.level}: shaft overlaps ${hits.join(', ')}.`, [e.id, ...hits], e.rect));
  }
  // Floor-level landing: a usable shared edge AND a landing door physically on
  // the shaft boundary leading to that circulation (a door recorded between the
  // right spaces but located elsewhere is not a landing).
  const landingSpaces = fl.spaces.filter(s => LANDING_TYPES.has(s.type));
  const landing = Math.max(0, ...landingSpaces.map(s => sharedEdge(e.rect, s.rect)));
  if (landing + 1e-9 < MIN_LANDING_EDGE) {
    out.push(f('ELEV_SHAFT_NO_LANDING', `Elevator ${e.id} on floor ${fl.level}: shaft shares no ≥${MIN_LANDING_EDGE.toFixed(2)} m edge with a corridor/foyer/entrance (longest ${landing.toFixed(2)} m) — no floor-level landing.`, [e.id], e.rect));
  } else {
    const landingIds = new Set(landingSpaces.filter(s => sharedEdge(e.rect, s.rect) + 1e-9 >= MIN_LANDING_EDGE).map(s => s.id));
    const hasDoor = (fl.openings ?? []).some(o => {
      if (o.type !== 'door') return false;
      const other = o.spaceA === e.hallSpaceId ? o.spaceB : o.spaceB === e.hallSpaceId ? o.spaceA : undefined;
      return !!other && landingIds.has(other) && onRectBoundary(o.center, e.rect);
    });
    if (!hasDoor) {
      out.push(f('ELEV_SHAFT_NO_LANDING', `Elevator ${e.id} on floor ${fl.level}: shaft touches circulation but has no landing door on its boundary — no floor-level landing.`, [e.id], e.rect));
    }
  }
  // Internal consistency: cabin ⊂ clear ⊂ cell, and the cell is its hall space.
  const hall = fl.spaces.find(s => s.id === e.hallSpaceId);
  const nested = rContains(e.rect, e.clearRect, 1e-6) && rContains(e.clearRect, e.cabinRect, 1e-6);
  // Walls/doors/DXF are generated from the space POLYGON: it must be the rect.
  const polyOk = !!hall && Array.isArray(hall.polygon) && hall.polygon.length >= 3 && sameRect(polyBBox(hall.polygon), e.rect);
  if (!nested || !hall || hall.type !== 'elevator-hall' || !sameRect(hall.rect, e.rect) || !polyOk) {
    out.push(f('ELEV_SHAFT_GEOMETRY_INCONSISTENT', `Elevator ${e.id} on floor ${fl.level}: ${!nested ? 'cabin/clear-shaft/cell rectangles are not nested' : !hall || hall.type !== 'elevator-hall' || !sameRect(hall.rect, e.rect) ? 'shaft does not coincide with its elevator-hall space' : 'elevator-hall polygon (walls/doors source) does not match the shaft rect'}.`, [e.id], e.rect));
  }
  return out;
}

export function validateElevators(floors: Floor[]): Finding[] {
  const out: Finding[] = [];
  for (const fl of floors) {
    const els = fl.elevators ?? [];
    if (fl.elevatorRequested && els.length === 0) {
      out.push(f('ELEV_SHAFT_MISSING', `Floor ${fl.level}: an elevator shaft was requested (hasElevator on a multi-floor building) but no shaft geometry exists on this floor.`));
    }
    for (const e of els) out.push(...validateOneElevator(e, fl));
  }
  for (let i = 0; i + 1 < floors.length; i++) {
    for (const a of floors[i].elevators ?? []) {
      for (const b of floors[i + 1].elevators ?? []) {
        if (a.coreId !== b.coreId || sameRect(a.rect, b.rect)) continue;
        out.push(f('ELEV_SHAFT_MISALIGNED', `Elevator core ${a.coreId}: shafts on floors ${floors[i].level} and ${floors[i + 1].level} are not the same rectangle — the shaft is not vertically continuous.`, [a.id, b.id], a.rect));
      }
    }
  }
  return out;
}
