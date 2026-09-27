/**
 * Task 154 — yard (open ground-level site area) for `building.hasYard === true`.
 *
 * Model semantics already present in the repo: a yard is an EXTERIOR space like
 * parking — exempt from room-access / door / daylight rules, "reachable via the
 * entrance door directly or vehicle access" (validation/circulation.ts), never
 * walled (dxf/writer.ts and generateWalls skip it). So a yard is:
 *   - sized from the existing program (programming/program.ts: target 20 m², min 10 m²),
 *   - a rectangle INSIDE the buildable polygon (setbacks are never consumed),
 *   - OPEN-AIR: not under any floor's spaces (upper floors included),
 *   - clear of parking stalls and the drive aisle,
 *   - REACHABLE on foot from the street edge of the site over open ground by a
 *     path at least CORRIDOR_MIN_WIDTH wide (grid flood fill, below).
 * No interior door is generated: the model does not require one.
 *
 * Never on the street side: a yard never crosses the ground floor's street-facing
 * building line (it would sit between the street and the front door, and the
 * entrance façade is classified over the ground-floor bounding box).
 *
 * Deterministic: fixed side order (rear, then the two flanks), fixed slide order.
 * Returns null when no placement satisfies every condition — the caller then
 * leaves the yard unplaced and program completeness makes the result INFEASIBLE.
 */
import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import { rectInsidePolygon, pointInPolygon } from '../geometry/polygon-ops.js';
import type { AccessSide } from '../model/site.js';
import { CORRIDOR_MIN_WIDTH, ROOM_MIN_SIDE } from '../units.js';

/** Existing placer quality limit for a cell's aspect ratio (layout/placer.ts CELL_QUALITY_MAX_ASPECT). */
export const YARD_MAX_ASPECT = 3.5;
/** Existing parking slide granularity (generator/parking.ts SLIDE_STEP). */
const SLIDE_STEP = 0.5;
/** Existing overlap tolerance used by parking placement (generator/parking.ts EPS_OV). */
const EPS_OV = 0.02;
/** Reachability grid resolution (m). */
const GRID = 0.1;

/** Existing placer M4 area cap max(1.1·minArea, 1.75·max(target, minArea)) (also used for balconies). */
export function yardAreaCap(targetArea: number, minArea: number): number {
  return Math.max(minArea * 1.1, Math.max(targetArea, minArea) * 1.75);
}

export function rectsOverlap(a: Rect, b: Rect, tol = EPS_OV): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > tol && h > tol;
}

function bbox(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function polyBBox(p: Polygon): Rect {
  return bbox(p.map(v => ({ x: v.x, y: v.y, w: 0, h: 0 })))!;
}

export interface YardReachInput {
  siteBoundary: Polygon;
  access: AccessSide;
  /** Ground-level obstacles to WALKING (ground-floor spaces, parking stalls). */
  groundBlockers: Rect[];
}

/**
 * True when some point of `yard` is reachable from the street edge of the site by a
 * walkway at least CORRIDOR_MIN_WIDTH wide over open ground inside the site.
 */
export function yardReachable(yard: Rect, inp: YardReachInput): boolean {
  const sb = polyBBox(inp.siteBoundary);
  const nx = Math.max(1, Math.ceil(sb.w / GRID)), ny = Math.max(1, Math.ceil(sb.h / GRID));
  // free[i] = cell centre inside the site and outside every blocker
  const free = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = sb.y + (j + 0.5) * GRID;
    for (let i = 0; i < nx; i++) {
      const cx = sb.x + (i + 0.5) * GRID;
      if (!pointInPolygon({ x: cx, y: cy }, inp.siteBoundary)) continue;
      let blocked = false;
      for (const r of inp.groundBlockers) {
        if (cx > r.x + 1e-9 && cx < r.x + r.w - 1e-9 && cy > r.y + 1e-9 && cy < r.y + r.h - 1e-9) { blocked = true; break; }
      }
      if (!blocked) free[j * nx + i] = 1;
    }
  }
  // clear[i] = a CORRIDOR_MIN_WIDTH square centred on the cell is entirely free (summed-area table)
  const k = Math.max(1, Math.round(CORRIDOR_MIN_WIDTH / GRID));
  const half = Math.floor(k / 2);
  const sat = new Int32Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    sat[(j + 1) * (nx + 1) + (i + 1)] = free[j * nx + i]
      + sat[j * (nx + 1) + (i + 1)] + sat[(j + 1) * (nx + 1) + i] - sat[j * (nx + 1) + i];
  }
  const clear = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const i0 = i - half, j0 = j - half, i1 = i0 + k, j1 = j0 + k;
    if (i0 < 0 || j0 < 0 || i1 > nx || j1 > ny) continue;
    const s = sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0];
    if (s === k * k) clear[j * nx + i] = 1;
  }
  // seeds: clear cells within one walkway width of the street edge of the site bbox
  const seen = new Uint8Array(nx * ny);
  const queue: number[] = [];
  const band = k;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const onEdge = inp.access === 'south' ? j < band + half
      : inp.access === 'north' ? j >= ny - band - half
      : inp.access === 'west' ? i < band + half
      : i >= nx - band - half;
    if (onEdge && clear[j * nx + i]) { seen[j * nx + i] = 1; queue.push(j * nx + i); }
  }
  const inYard = (idx: number) => {
    const i = idx % nx, j = (idx - i) / nx;
    const cx = sb.x + (i + 0.5) * GRID, cy = sb.y + (j + 0.5) * GRID;
    return cx > yard.x && cx < yard.x + yard.w && cy > yard.y && cy < yard.y + yard.h;
  };
  for (let q = 0; q < queue.length; q++) {
    const idx = queue[q];
    if (inYard(idx)) return true;
    const i = idx % nx, j = (idx - i) / nx;
    const nb = [i > 0 ? idx - 1 : -1, i < nx - 1 ? idx + 1 : -1, j > 0 ? idx - nx : -1, j < ny - 1 ? idx + nx : -1];
    for (const n of nb) if (n >= 0 && !seen[n] && clear[n]) { seen[n] = 1; queue.push(n); }
  }
  return false;
}

export interface YardPlacementInput extends YardReachInput {
  buildableBoundary: Polygon;
  /** Ground-floor building space rects (street-side building line). */
  groundRects: Rect[];
  /** Every floor's space rects (open-air: the yard may not lie under any of them). */
  allFloorRects: Rect[];
  /** Parking stalls + aisle (the yard never overlaps parking geometry). */
  parkingRects: Rect[];
  targetArea: number;
  minArea: number;
}

/** Side order relative to the street: rear first, then the flanks (never the street side). */
function sideOrder(access: AccessSide): Array<'north' | 'south' | 'east' | 'west'> {
  switch (access) {
    case 'south': return ['north', 'west', 'east'];
    case 'north': return ['south', 'west', 'east'];
    case 'east': return ['west', 'south', 'north'];
    case 'west': return ['east', 'south', 'north'];
  }
}

/** True when `r` crosses the ground building's street-facing line toward the street. */
export function yardCrossesStreetLine(r: Rect, ground: Rect, access: AccessSide): boolean {
  const E = 1e-6;
  switch (access) {
    case 'south': return r.y < ground.y - E;
    case 'north': return r.y + r.h > ground.y + ground.h + E;
    case 'west': return r.x < ground.x - E;
    case 'east': return r.x + r.w > ground.x + ground.w + E;
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Candidate (d = depth away from the building, w = length along it) pairs from the program only. */
function dimsFor(D: number, L: number, target: number, minA: number): Array<{ d: number; w: number }> {
  const out: Array<{ d: number; w: number }> = [];
  const side = Math.sqrt(target);
  const minSide = Math.max(ROOM_MIN_SIDE, CORRIDOR_MIN_WIDTH);
  const push = (d: number, w: number) => {
    d = r2(Math.min(d, D)); w = r2(Math.min(w, L));
    if (d < minSide - 1e-6 || w < minSide - 1e-6) return;
    if (Math.max(d, w) / Math.min(d, w) > YARD_MAX_ASPECT + 1e-6) return;
    if (d * w < minA - 1e-6) return;
    if (!out.some(o => o.d === d && o.w === w)) out.push({ d, w });
  };
  // 1) program target: depth limited by the strip, length = target / depth (≤ strip length)
  const d1 = Math.min(side, D);
  let w1 = target / d1, dd1 = d1;
  if (w1 > L) { w1 = L; dd1 = Math.min(D, target / L); }
  push(dd1, w1);
  // 2) fallback: the square clipped to the strip (still ≥ program minimum area)
  push(side, side);
  return out;
}

export function placeYard(inp: YardPlacementInput): { rect: Rect | null; explanation: string } {
  const bld = bbox(inp.allFloorRects);
  const gnd = bbox(inp.groundRects);
  const env = polyBBox(inp.buildableBoundary);
  if (!bld || !gnd) return { rect: null, explanation: 'Yard: no building geometry' };
  const obstacles = [...inp.allFloorRects, ...inp.parkingRects];
  const tried: string[] = [];
  for (const side of sideOrder(inp.access)) {
    const horiz = side === 'north' || side === 'south';
    // strip between the building's outer edge on this side and the buildable envelope edge
    const D = side === 'north' ? env.y + env.h - (bld.y + bld.h)
      : side === 'south' ? bld.y - env.y
      : side === 'east' ? env.x + env.w - (bld.x + bld.w)
      : bld.x - env.x;
    const a0 = horiz ? env.x : env.y;
    const L = horiz ? env.w : env.h;
    if (D < ROOM_MIN_SIDE - 1e-6) { tried.push(`${side}:depth ${D.toFixed(2)}`); continue; }
    const centre = horiz ? bld.x + bld.w / 2 : bld.y + bld.h / 2;
    for (const { d, w } of dimsFor(D, L, inp.targetArea, inp.minArea)) {
      // slide positions: centred on the building, then alternating outward
      const s0 = Math.min(Math.max(a0, centre - w / 2), a0 + L - w);
      const maxK = Math.ceil(L / SLIDE_STEP) + 1;
      for (let kk = 0; kk <= 2 * maxK; kk++) {
        const off = (kk % 2 === 1 ? 1 : -1) * Math.ceil(kk / 2) * SLIDE_STEP;
        const s = r2(s0 + off);
        if (s < a0 - 1e-6 || s + w > a0 + L + 1e-6) continue;
        const r: Rect = side === 'north' ? { x: s, y: r2(bld.y + bld.h), w, h: d }
          : side === 'south' ? { x: s, y: r2(bld.y - d), w, h: d }
          : side === 'east' ? { x: r2(bld.x + bld.w), y: s, w: d, h: w }
          : { x: r2(bld.x - d), y: s, w: d, h: w };
        if (yardCrossesStreetLine(r, gnd, inp.access)) continue;
        if (!rectInsidePolygon(r, inp.buildableBoundary, 1e-3)) continue;
        if (obstacles.some(o => rectsOverlap(r, o))) continue;
        if (!yardReachable(r, inp)) continue;
        return { rect: r, explanation: `Yard placed on the ${side} side: ${w.toFixed(2)}×${d.toFixed(2)} m (${(w * d).toFixed(1)} m², program target ${inp.targetArea} m²), open-air, inside buildable, reachable from the ${inp.access} street edge.` };
      }
      tried.push(`${side}:${w}x${d} no clear/reachable spot`);
    }
  }
  return { rect: null, explanation: `Yard INFEASIBLE: no open-air, reachable, program-sized spot inside the buildable area (${tried.join('; ')}) — ARCH_PROGRAM_UNPLACED flags this candidate.` };
}
