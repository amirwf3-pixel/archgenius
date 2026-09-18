/**
 * Parking placement on ground floor, along the access side.
 *
 * V1: perpendicular parking in a strip adjacent to the setback on the access
 * side (i.e., outside the main building footprint), with an aisle connecting
 * to the entrance-side access. Each stall is 2.5 × 5.0 m.
 */
import type { Rect } from '../geometry/rect.js';
import { rFromCorners, rArea } from '../geometry/rect.js';
import type { ParkingStall, ParkingArea } from '../model/parking.js';
import type { AccessSide } from '../model/site.js';
import { PARKING_STALL_WIDTH, PARKING_STALL_LENGTH, PARKING_AISLE_MIN_WIDTH } from '../units.js';

export interface ParkingPlacement {
  stalls: ParkingStall[];
  aisle: Rect;
  /** Rectangles of stalls (used for drawing). */
  stallRects: Rect[];
  /** True if all requested stalls fit. */
  fits: boolean;
}

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
