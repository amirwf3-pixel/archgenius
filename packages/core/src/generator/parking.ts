/**
 * Parking placement on ground floor, along the access side.
 *
 * V1: perpendicular parking in a strip adjacent to the setback on the access
 * side (i.e., outside the main building footprint), with an aisle connecting
 * to the entrance-side access. Each stall is 2.5 × 5.0 m.
 *
 * Phase 10: site-aware parking with perpendicular/parallel alternatives,
 * geometric fit checks against siteBoundary polygon and buildableBoundary,
 * deterministic bounded attempts.
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

  // Avoid overlapping with building footprint: if the parking zone intrudes
  // into buildingRect, clamp it. V1 villas typically have front yard + parking.
  // We'll shrink zone only if it collides — but we trust the setbacks; if not
  // enough room we mark fits=false.

  const parallelLen = (access === 'south' || access === 'north') ? zone.w : zone.h;
  const stallsThatFit = Math.max(0, Math.floor((parallelLen) / PARKING_STALL_WIDTH));

  const aisle: Rect = (() => {
    if (access === 'south' || access === 'north') {
      // aisle is the strip closer to the building
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

// Suppress unused import warning when not using rFromCorners
void rFromCorners;

void polygonBoundingRect;
void rectInsidePolygon;

/**
 * Phase 10 — Site-aware parking with perpendicular/parallel alternatives.
 * Deterministic bounded attempts, geometric fit checks against siteBoundary polygon and building footprint.
 */
export function placeParkingSiteAware(
  siteBoundary: Polygon,
  buildableBoundary: Polygon,
  buildableRects: Rect[],
  siteRect: Rect,
  buildingRect: Rect,
  access: AccessSide,
  count: number,
  floorLevel: number,
  layout: 'perpendicular' | 'parallel' | 'auto' = 'auto'
): ParkingPlacement {
  const attempts: string[] = [];
  if (count <= 0) {
    const apron = makeApron(siteRect, buildingRect, access, 3.0);
    return { stalls: [], aisle: apron, stallRects: [], fits: true, layout: 'perpendicular', attempts: ['no parking requested'] };
  }

  // Determine building footprint rects to avoid overlapping
  const buildingFootprintRects = buildableRects.length > 0 ? buildableRects : [buildingRect];

  // Helper to check if stall rect is valid: inside siteBoundary, not intersecting building footprint, not overlapping other stalls
  const isStallValid = (rect: Rect, existing: Rect[]): boolean => {
    // Inside site boundary
    if (!rectInsidePolygon(rect, siteBoundary, 1e-3)) {
      attempts.push(`stall ${rect.x.toFixed(2)},${rect.y.toFixed(2)} outside site boundary`);
      return false;
    }
    // Not intersecting building footprint (allow touching but not overlapping interior)
    for (const bf of buildingFootprintRects) {
      if (rIntersects(rect, bf, 1e-3)) {
        // Check if overlap area > small threshold
        const overlapW = Math.min(rect.x + rect.w, bf.x + bf.w) - Math.max(rect.x, bf.x);
        const overlapH = Math.min(rect.y + rect.h, bf.y + bf.h) - Math.max(rect.y, bf.y);
        if (overlapW > 0.05 && overlapH > 0.05) {
          attempts.push(`stall ${rect.x.toFixed(2)},${rect.y.toFixed(2)} overlaps building footprint`);
          return false;
        }
      }
    }
    // Not overlapping other stalls
    for (const ex of existing) {
      if (rIntersects(rect, ex, 1e-3)) {
        const overlapW = Math.min(rect.x + rect.w, ex.x + ex.w) - Math.max(rect.x, ex.x);
        const overlapH = Math.min(rect.y + rect.h, ex.y + ex.h) - Math.max(rect.y, ex.y);
        if (overlapW > 0.05 && overlapH > 0.05) {
          attempts.push(`stall ${rect.x.toFixed(2)},${rect.y.toFixed(2)} overlaps other stall`);
          return false;
        }
      }
    }
    return true;
  };

  // Try layouts in order
  const layoutsToTry: Array<'perpendicular' | 'parallel'> = layout === 'auto' ? ['perpendicular', 'parallel'] : [layout];

  for (const tryLayout of layoutsToTry) {
    const stalls: ParkingStall[] = [];
    const stallRects: Rect[] = [];
    let stallW: number, stallH: number, aisleW: number;
    if (tryLayout === 'perpendicular') {
      stallW = PARKING_STALL_WIDTH;
      stallH = PARKING_STALL_LENGTH;
      aisleW = PARKING_AISLE_MIN_WIDTH;
    } else {
      stallW = PARKING_PARALLEL_LENGTH;
      stallH = PARKING_PARALLEL_WIDTH;
      aisleW = PARKING_AISLE_MIN_WIDTH;
    }

    const depth = stallH + aisleW;
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
    const stallStep = tryLayout === 'perpendicular' ? PARKING_STALL_WIDTH : PARKING_PARALLEL_LENGTH;
    const maxStallsInZone = Math.max(0, Math.floor(parallelLen / stallStep));

    const aisle: Rect = (() => {
      if (access === 'south' || access === 'north') {
        if (access === 'south') return { x: zone.x, y: zone.y + stallH, w: zone.w, h: aisleW };
        return { x: zone.x, y: zone.y, w: zone.w, h: aisleW };
      } else {
        if (access === 'west') return { x: zone.x + stallH, y: zone.y, w: aisleW, h: zone.h };
        return { x: zone.x, y: zone.y, w: aisleW, h: zone.h };
      }
    })();

    for (let i = 0; i < Math.min(count, maxStallsInZone); i++) {
      let rect: Rect;
      if (access === 'south' || access === 'north') {
        const sx = zone.x + i * stallStep;
        const sy = access === 'south' ? zone.y : zone.y + aisleW;
        rect = { x: sx, y: sy, w: tryLayout === 'perpendicular' ? stallW : stallW, h: stallH };
        // For parallel, width is length along access, height is width
        if (tryLayout === 'parallel') {
          rect = { x: sx, y: sy, w: PARKING_PARALLEL_LENGTH, h: PARKING_PARALLEL_WIDTH };
        }
      } else {
        const sy = zone.y + i * stallStep;
        const sx = access === 'west' ? zone.x : zone.x + aisleW;
        if (tryLayout === 'perpendicular') {
          rect = { x: sx, y: sy, w: stallH, h: stallW };
        } else {
          rect = { x: sx, y: sy, w: PARKING_PARALLEL_WIDTH, h: PARKING_PARALLEL_LENGTH };
        }
      }
      // Bounds check against siteRect
      if (rect.x < siteRect.x - 1e-6 || rect.y < siteRect.y - 1e-6 ||
          rect.x + rect.w > siteRect.x + siteRect.w + 1e-6 ||
          rect.y + rect.h > siteRect.y + siteRect.h + 1e-6) {
        attempts.push(`${tryLayout} stall ${i} out of siteRect bounds`);
        continue;
      }
      if (!isStallValid(rect, stallRects)) continue;
      const id = `parking-${floorLevel}-${i}`;
      stalls.push({ id, rect, index: i + 1, covered: false, floor: floorLevel });
      stallRects.push(rect);
    }

    const fits = stalls.length === count;
    if (fits || stalls.length > 0) {
      // Return best attempt for this layout
      return { stalls, aisle, stallRects, fits, layout: tryLayout, attempts };
    }
    attempts.push(`${tryLayout} layout failed to place any stalls`);
  }

  // If both layouts fail, return empty with attempts
  const apron = makeApron(siteRect, buildingRect, access, 3.0);
  return { stalls: [], aisle: apron, stallRects: [], fits: false, layout: 'perpendicular', attempts };
}
