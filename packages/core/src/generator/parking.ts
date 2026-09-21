/**
 * Parking placement on ground floor.
 *
 * V1 `placeParking` (legacy, kept for earlier unit tests) put a strip of
 * stalls along the access side with bounding-box checks only.
 *
 * P16-A v2 `placeParkingSiteAware` replaces the broken Phase-10 behavior:
 * the old version treated the ENTIRE buildable zone as obstacle, so stalls
 * could never fit anywhere the building was allowed to stand — every request
 * returned `stalls: []`, and the generator exported an aisle-only rectangle.
 * v2:
 *  - obstacle set = the ACTUAL placed building footprint (caller-supplied
 *    space rects, wall-inflated),
 *  - deterministic search over bands along ALL FOUR site edges (aisle flush
 *    to the edge, stalls behind it), perpendicular and parallel layouts,
 *    with a bounded 0.5 m slide of the band into the site,
 *  - every stall, the aisle and access paths are verified against the real
 *    site polygon (rectInsidePolygon), not just the bounding box,
 *  - vehicle access: aisle must touch (or have a free 3.2 m driveway strip to)
 *    the street edge on the actual access side — works for any orientation,
 *  - all-or-nothing: fewer than `count` valid stalls = fits:false with NO
 *    stalls returned (no silent reduction of the program).
 */
import type { Rect } from '../geometry/rect.js';
import { rFromCorners, rArea, rIntersects } from '../geometry/rect.js';
import type { ParkingStall, ParkingArea } from '../model/parking.js';
import type { AccessSide } from '../model/site.js';
import { PARKING_STALL_WIDTH, PARKING_STALL_LENGTH, PARKING_AISLE_MIN_WIDTH } from '../units.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import { rectInsidePolygon, polygonBoundingRect } from '../geometry/polygon-ops.js';

export interface ParkingPlacement {
  stalls: ParkingStall[];
  aisle: Rect;
  /** Rectangles of stalls (used for drawing). */
  stallRects: Rect[];
  /** True if all requested stalls fit. */
  fits: boolean;
  /** Layout used */
  layout?: 'perpendicular' | 'parallel';
  /** Attempts */
  attempts?: string[];
}

export const PARKING_PARALLEL_WIDTH = 2.2;
export const PARKING_PARALLEL_LENGTH = 6.0;

/**
 * Place `count` perpendicular parking stalls along the access side, given the
 * full site rectangle and the building footprint. Parking sits between the
 * street setback and the building.
 */
export function placeParking(
  siteRect: Rect,
  buildingRect: Rect,
  access: AccessSide,
  count: number,
  floorLevel: number,
): ParkingPlacement {
  const stalls: ParkingStall[] = [];
  const stallRects: Rect[] = [];

  if (count <= 0) {
    // No stalls, but place a small entry apron on access side.
    const apron = makeApron(siteRect, buildingRect, access, 3.0);
    return { stalls, aisle: apron, stallRects, fits: true };
  }

  const depth = PARKING_STALL_LENGTH + PARKING_AISLE_MIN_WIDTH;
  // Try to fit stalls along the access edge of the site.
  // The zone runs along the access side, width = site.w or site.h, depth = depth.
  let zone: Rect;
  switch (access) {
    case 'south':
      zone = { x: siteRect.x, y: siteRect.y, w: siteRect.w, h: depth };
      break;
    case 'north':
      zone = { x: siteRect.x, y: siteRect.y + siteRect.h - depth, w: siteRect.w, h: depth };
      break;
    case 'west':
      zone = { x: siteRect.x, y: siteRect.y, w: depth, h: siteRect.h };
      break;
    case 'east':
      zone = { x: siteRect.x + siteRect.w - depth, y: siteRect.y, w: depth, h: siteRect.h };
      break;
  }

  const parallelLen = (access === 'south' || access === 'north') ? zone.w : zone.h;
  const stallsThatFit = Math.max(0, Math.floor((parallelLen) / PARKING_STALL_WIDTH));

  const aisle: Rect = (() => {
    if (access === 'south' || access === 'north') {
      if (access === 'south') return { x: zone.x, y: zone.y + PARKING_STALL_LENGTH, w: zone.w, h: PARKING_AISLE_MIN_WIDTH };
      return { x: zone.x, y: zone.y, w: zone.w, h: PARKING_AISLE_MIN_WIDTH };
    } else {
      if (access === 'west') return { x: zone.x + PARKING_STALL_LENGTH, y: zone.y, w: PARKING_AISLE_MIN_WIDTH, h: zone.h };
      return { x: zone.x, y: zone.y, w: PARKING_AISLE_MIN_WIDTH, h: zone.h };
    }
  })();

  for (let i = 0; i < Math.min(count, stallsThatFit); i++) {
    let rect: Rect;
    if (access === 'south' || access === 'north') {
      const sx = zone.x + i * PARKING_STALL_WIDTH;
      const sy = access === 'south' ? zone.y : zone.y + PARKING_AISLE_MIN_WIDTH;
      rect = { x: sx, y: sy, w: PARKING_STALL_WIDTH, h: PARKING_STALL_LENGTH };
    } else {
      const sy = zone.y + i * PARKING_STALL_WIDTH;
      const sx = access === 'west' ? zone.x : zone.x + PARKING_AISLE_MIN_WIDTH;
      rect = { x: sx, y: sy, w: PARKING_STALL_LENGTH, h: PARKING_STALL_WIDTH };
    }
    if (rect.x < siteRect.x - 1e-6 || rect.y < siteRect.y - 1e-6 ||
      rect.x + rect.w > siteRect.x + siteRect.w + 1e-6 ||
      rect.y + rect.h > siteRect.y + siteRect.h + 1e-6) continue;
    const id = `parking-${floorLevel}-${i}`;
    stalls.push({ id, rect, index: i + 1, covered: false, floor: floorLevel });
    stallRects.push(rect);
  }

  // Extend apron beyond aisle so it connects to street.
  const apron = makeApron(siteRect, buildingRect, access, 2.0);

  const fits = stalls.length === count;
  return { stalls, aisle, stallRects, fits };
}

function makeApron(siteRect: Rect, _buildingRect: Rect, access: AccessSide, depth: number): Rect {
  switch (access) {
    case 'south': return { x: siteRect.x, y: siteRect.y, w: siteRect.w, h: depth };
    case 'north': return { x: siteRect.x, y: siteRect.y + siteRect.h - depth, w: siteRect.w, h: depth };
    case 'west':  return { x: siteRect.x, y: siteRect.y, w: depth, h: siteRect.h };
    case 'east':  return { x: siteRect.x + siteRect.w - depth, y: siteRect.y, w: depth, h: siteRect.h };
  }
}

// Helper used by generator to allocate a yard area from the remainder (unused).
export function remainingArea(_site: Rect, _building: Rect): number {
  return Math.max(0, rArea(_site) - rArea(_building));
}

// Suppress unused import warnings kept for legacy compatibility.
void rFromCorners;
void rIntersects;
void polygonBoundingRect;
void (undefined as unknown as ParkingArea);

// ============================================================================
// P16-A v2 — real site-aware parking placement
// ============================================================================

const EPS_OV = 0.02;        // overlap tolerance (m)
const SLIDE_STEP = 0.5;     // band slide granularity (m)
const PARKING_DRIVEWAY_WIDTH = 3.2;

function ov(a: Rect, b: Rect, tol = EPS_OV): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > tol && h > tol;
}

export interface ParkingSiteAwareInput {
  /** Real site polygon (all vertex units, meters). */
  siteBoundary: Polygon;
  /** Site bounding rect. */
  siteRect: Rect;
  /** ACTUAL placed building footprint rects (wall-inflated space rects). */
  buildingRects: Rect[];
  access: AccessSide;
  count: number;
  floorLevel: number;
  layoutPref?: 'perpendicular' | 'parallel' | 'auto';
  /**
   * P16-A: buildable envelope (setback-limited bbox). STALLS (permanent
   * slabs) must sit inside it; the drive AISLE may cross setbacks — a real
   * driveway does. Omit = whole site is buildable.
   */
  buildableRect?: Rect;
}

/**
 * Place exactly `count` stalls around the site, or fail honestly
 * (`fits:false`, empty stalls). Never returns a partial row.
 */
export function placeParkingSiteAware(input: ParkingSiteAwareInput): ParkingPlacement {
  const { siteBoundary, siteRect, buildingRects, access, count, floorLevel } = input;
  const layoutPref = input.layoutPref ?? 'auto';
  const attempts: string[] = [];

  const emptyAisle: Rect = { x: siteRect.x, y: siteRect.y, w: 0, h: 0 };
  if (count <= 0) {
    return { stalls: [], aisle: emptyAisle, stallRects: [], fits: true, layout: 'perpendicular', attempts: ['no parking requested'] };
  }

  const insideSite = (r: Rect): boolean => rectInsidePolygon(r, siteBoundary, 1e-3);
  const free = (r: Rect): boolean => insideSite(r) && !buildingRects.some(o => ov(r, o));

  const layoutsToTry: Array<'perpendicular' | 'parallel'> =
    layoutPref === 'auto' ? ['perpendicular', 'parallel'] : [layoutPref];
  const bandOrder: AccessSide[] = [access, 'south', 'east', 'north', 'west'];
  const seenSides = new Set<AccessSide>();
  const sides = bandOrder.filter(s => (seenSides.has(s) ? false : (seenSides.add(s), true)));

  // Coordinate helper: rect expressed as (along-edge position, depth from the
  // band's edge) so the same scan code serves all four sides.
  const mk = (horizontal: boolean, side: AccessSide, along: number, alongLen: number, depth0: number, depthLen: number): Rect => {
    if (horizontal) {
      const y = side === 'south' ? siteRect.y + depth0 : siteRect.y + siteRect.h - depth0 - depthLen;
      return { x: siteRect.x + along, y, w: alongLen, h: depthLen };
    }
    const x = side === 'west' ? siteRect.x + depth0 : siteRect.x + siteRect.w - depth0 - depthLen;
    return { x, y: siteRect.y + along, w: depthLen, h: alongLen };
  };

  const touchesStreet = (r: Rect): boolean => {
    const e = 1e-6;
    switch (access) {
      case 'south': return Math.abs(r.y - siteRect.y) < e;
      case 'north': return Math.abs(r.y + r.h - (siteRect.y + siteRect.h)) < e;
      case 'west':  return Math.abs(r.x - siteRect.x) < e;
      case 'east':  return Math.abs(r.x + r.w - (siteRect.x + siteRect.w)) < e;
    }
  };

  // A free 3.2 m driveway strip from the street edge to the far edge, flush
  // with one perpendicular corner — cars route around the building.
  const drivewayOkTo = (r: Rect): boolean => {
    const streetHorizontal = access === 'south' || access === 'north';
    for (const corner of ['min', 'max'] as const) {
      let strip: Rect;
      if (streetHorizontal) {
        const x = corner === 'min' ? siteRect.x : siteRect.x + siteRect.w - PARKING_DRIVEWAY_WIDTH;
        strip = { x, y: siteRect.y, w: PARKING_DRIVEWAY_WIDTH, h: siteRect.h };
        // the aisle must reach that corner corridor laterally
        const reaches = corner === 'min'
          ? r.x <= siteRect.x + PARKING_DRIVEWAY_WIDTH + 0.01
          : r.x + r.w >= siteRect.x + siteRect.w - PARKING_DRIVEWAY_WIDTH - 0.01;
        if (reaches && free(strip)) return true;
      } else {
        const y = corner === 'min' ? siteRect.y : siteRect.y + siteRect.h - PARKING_DRIVEWAY_WIDTH;
        strip = { x: siteRect.x, y, w: siteRect.w, h: PARKING_DRIVEWAY_WIDTH };
        const reaches2 = corner === 'min'
          ? r.y <= siteRect.y + PARKING_DRIVEWAY_WIDTH + 0.01
          : r.y + r.h >= siteRect.y + siteRect.h - PARKING_DRIVEWAY_WIDTH - 0.01;
        if (reaches2 && free(strip)) return true;
      }
    }
    return false;
  };

  const accessOk = (aisle: Rect, side: AccessSide, off: number, aMinRef = 0): boolean => {
    if (touchesStreet(aisle)) return true;
    if (side === access && off >= 0) {
      // path strip from the street edge to the aisle, along this band
      const horizontal = side === 'south' || side === 'north';
      const edgeLen = horizontal ? siteRect.w : siteRect.h;
      const path = mk(horizontal, side, aMinRef, edgeLen, 0, off);
      if (free(path) || off < 1e-6) return true;
    }
    return drivewayOkTo(aisle);
  };

  const bld = input.buildableRect;
  for (const side of sides) {
    const horizontal = side === 'south' || side === 'north';
    // Along-axis and depth-axis limits for STALLS: clipped to the buildable
    // envelope when provided (setback zones may host the aisle/driveway only).
    let aMin = 0;
    let aMax = horizontal ? siteRect.w : siteRect.h;
    let dMin = 0;
    let dMax = horizontal ? siteRect.h : siteRect.w;
    if (bld) {
      if (side === 'south') { aMin = bld.x - siteRect.x; aMax = bld.x + bld.w - siteRect.x; dMin = bld.y - siteRect.y; dMax = bld.y + bld.h - siteRect.y; }
      else if (side === 'north') { aMin = bld.x - siteRect.x; aMax = bld.x + bld.w - siteRect.x; dMin = siteRect.y + siteRect.h - (bld.y + bld.h); dMax = siteRect.y + siteRect.h - bld.y; }
      else if (side === 'west') { aMin = bld.y - siteRect.y; aMax = bld.y + bld.h - siteRect.y; dMin = bld.x - siteRect.x; dMax = bld.x + bld.w - siteRect.x; }
      else { aMin = bld.y - siteRect.y; aMax = bld.y + bld.h - siteRect.y; dMin = siteRect.x + siteRect.w - bld.x - bld.w; dMax = siteRect.x + siteRect.w - bld.x; }
    }
    const edgeLen = aMax - aMin;
    const depthAxis = dMax;
    for (const layout of layoutsToTry) {
      const stallAlong = layout === 'perpendicular' ? PARKING_STALL_WIDTH : PARKING_PARALLEL_LENGTH;
      const stallDepth = layout === 'perpendicular' ? PARKING_STALL_LENGTH : PARKING_PARALLEL_WIDTH;
      const aisleDepth = PARKING_AISLE_MIN_WIDTH;
      const bandTotal = aisleDepth + stallDepth;
      if (edgeLen + 1e-6 < stallAlong) { attempts.push(`${side}/${layout}: edge ${edgeLen.toFixed(1)}m too short for one stall`); continue; }

      const offStart = bld ? Math.max(0, dMin - aisleDepth) : 0;
      const offEnd = bld ? Math.min(depthAxis, dMax) - bandTotal : depthAxis - bandTotal;
      for (let off = offStart; off + bandTotal <= offEnd + 1e-6; off += SLIDE_STEP) {
        const aisle = mk(horizontal, side, aMin, edgeLen, off, aisleDepth);
        if (!free(aisle)) { attempts.push(`${side}/${layout}@${off.toFixed(1)}: aisle blocked/outside`); continue; }
        if (!accessOk(aisle, side, off, aMin)) { attempts.push(`${side}/${layout}@${off.toFixed(1)}: no vehicle access`); continue; }

        const stalls: ParkingStall[] = [];
        const stallRects: Rect[] = [];
        for (let i = 0; stalls.length < count && aMin + i * stallAlong + stallAlong <= aMax + 1e-6; i++) {
          const r = mk(horizontal, side, aMin + i * stallAlong, stallAlong, off + aisleDepth, stallDepth);
          if (!free(r) || stallRects.some(x => ov(x, r))) continue;
          stalls.push({ id: `parking-${floorLevel}-${stalls.length}`, rect: r, index: stalls.length + 1, covered: false, floor: floorLevel });
          stallRects.push(r);
        }
        if (stalls.length === count) {
          // Trim the aisle to the occupied run; keep full width if the trim
          // would collide (e.g. holes in the row) — either way it is real.
          const first = stallRects[0];
          const last = stallRects[stallRects.length - 1];
          const a0 = horizontal ? first.x - siteRect.x : first.y - siteRect.y;
          const a1 = (horizontal ? last.x + last.w : last.y + last.h) - (horizontal ? siteRect.x : siteRect.y);
          const trimmed = mk(horizontal, side, a0, a1 - a0, off, aisleDepth);
          const finalAisle = free(trimmed) && accessOk(trimmed, side, off, aMin) ? trimmed : aisle;
          return { stalls, aisle: finalAisle, stallRects, fits: true, layout, attempts };
        }
        attempts.push(`${side}/${layout}@${off.toFixed(1)}: only ${stalls.length}/${count} stalls valid`);
      }
    }
  }
  attempts.push('no band/layout/offset fit all requested stalls');
  return { stalls: [], aisle: emptyAisle, stallRects: [], fits: false, layout: layoutPref === 'parallel' ? 'parallel' : 'perpendicular', attempts };
}

// ============================================================================
// P16-A — parking band reservation (pre-slice space guarantee)
// ============================================================================

function edgeBand(siteRect: Rect, side: AccessSide, depth: number): Rect {
  switch (side) {
    case 'south': return { x: siteRect.x, y: siteRect.y, w: siteRect.w, h: depth };
    case 'north': return { x: siteRect.x, y: siteRect.y + siteRect.h - depth, w: siteRect.w, h: depth };
    case 'west':  return { x: siteRect.x, y: siteRect.y, w: depth, h: siteRect.h };
    case 'east':  return { x: siteRect.x + siteRect.w - depth, y: siteRect.y, w: depth, h: siteRect.h };
  }
}

/** Subtract a cut rect from a rect list; returns the remaining rectangles. */
export function subtractRects(rects: Rect[], cut: Rect, minDim = 0.25): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const ix = Math.max(r.x, cut.x);
    const iy = Math.max(r.y, cut.y);
    const ix2 = Math.min(r.x + r.w, cut.x + cut.w);
    const iy2 = Math.min(r.y + r.h, cut.y + cut.h);
    if (ix2 - ix < 1e-9 || iy2 - iy < 1e-9) { out.push(r); continue; }
    const parts: Rect[] = [];
    if (ix - r.x > minDim) parts.push({ x: r.x, y: r.y, w: ix - r.x, h: r.h });                       // west of cut
    if (r.x + r.w - ix2 > minDim) parts.push({ x: ix2, y: r.y, w: r.x + r.w - ix2, h: r.h });          // east of cut
    if (iy - r.y > minDim) parts.push({ x: Math.max(r.x, ix), y: r.y, w: Math.min(ix2, r.x + r.w) - Math.max(r.x, ix), h: iy - r.y }); // below cut
    if (r.y + r.h - iy2 > minDim) parts.push({ x: Math.max(r.x, ix), y: iy2, w: Math.min(ix2, r.x + r.w) - Math.max(r.x, ix), h: r.y + r.h - iy2 }); // above cut
    for (const q of parts) if (q.w > minDim && q.h > minDim) out.push(q);
  }
  // deterministic order by corner
  return out.sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.w - b.w) || (a.h - b.h));
}

/**
 * Reserve the parking band along the access-side edge BEFORE room slicing,
 * so the building cannot grow into the area the stalls need. Returns the
 * remaining buildable rects (caller swaps its slice input) or null when the
 * reservation would leave nothing to build on.
 */
export function reserveParkingBand(
  siteRect: Rect,
  buildableRects: Rect[],
  access: AccessSide,
  layoutPref: 'perpendicular' | 'parallel' | 'auto' = 'auto',
  count = 1,
): { rects: Rect[]; band: Rect; layout: 'perpendicular' | 'parallel' } | null {
  let layouts: Array<'perpendicular' | 'parallel'>;
  if (layoutPref === 'parallel') layouts = ['parallel'];
  else if (layoutPref === 'perpendicular') layouts = ['perpendicular'];
  else {
    // Auto: prefer the SHALLOWER band (parallel) when the access frontage can
    // hold the requested stalls in a row — it leaves more buildable depth for
    // the program; perpendicular otherwise (its row is narrow, its band deep).
    const edgeLen = (access === 'south' || access === 'north') ? siteRect.w : siteRect.h;
    const parRow = Math.floor((edgeLen + 1e-6) / PARKING_PARALLEL_LENGTH);
    const perpRow = Math.floor((edgeLen + 1e-6) / PARKING_STALL_WIDTH);
    layouts = (parRow >= count && perpRow >= count)
      ? ['parallel', 'perpendicular']
      : (perpRow >= count ? ['perpendicular'] : ['parallel', 'perpendicular']);
  }
  for (const layout of layouts) {
    const bandDepth = PARKING_AISLE_MIN_WIDTH + (layout === 'perpendicular' ? PARKING_STALL_LENGTH : PARKING_PARALLEL_WIDTH);
    const band = edgeBand(siteRect, access, bandDepth);
    const remaining = subtractRects(buildableRects, band);
    const area = remaining.reduce((a, r) => a + r.w * r.h, 0);
    const before = buildableRects.reduce((a, r) => a + r.w * r.h, 0);
    // The band must leave real room for the building (>= 45% of the envelope);
    // below that the program will fail on its own merits via
    // ARCH_PROGRAM_UNPLACED instead of a cramped unusable plan.
    if (remaining.length > 0 && area >= 0.45 * before) {
      return { rects: remaining, band, layout };
    }
  }
  return null;
}
