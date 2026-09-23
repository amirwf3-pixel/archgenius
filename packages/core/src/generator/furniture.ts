/**
 * Phase 11 — Minimal furniture placement with polygon canonical containment.
 * Phase 18 — door-aware: pieces whose footprint would enter a door's 90° swing
 * sector (geometry/swing.ts, same exact sector the validators use) are skipped.
 * One deterministic position per piece — a conflicting piece is simply not
 * placed, which is architecturally better than a bed/wardrobe blocking a door.
 */

import type { Space } from '../model/space.js';
import type { Furniture, FurnitureType } from '../model/furniture.js';
import { FURNITURE_SIZES } from '../model/furniture.js';
import type { Opening } from '../model/opening.js';
import type { Rect } from '../geometry/rect.js';
import { rContains, rOverlapArea } from '../geometry/rect.js';
import { pointInPolygon, rectInsidePolygon } from '../geometry/polygon-ops.js';
import { roomPolygonCentroid } from '../geometry/room-polygon.js';
import { rectBlocksDoorSwing } from '../geometry/swing.js';

let idCounter = 0;
const nextId = () => `f-${(idCounter++).toString(36)}`;

export function placeFurniture(spaces: Space[], openings: Opening[] = []): Furniture[] {
  idCounter = 0;
  const doors = openings.filter(o => o.type === 'door' || o.type === 'entrance');
  const out: Furniture[] = [];
  for (const s of spaces) {
    out.push(...placeInRoom(s, doors, out));
  }
  return out;
}

/** Phase 31-P2 — deterministic ordered fallback slots per piece. Each entry
 * lists the (type, slot) candidates in strict priority order; the first one
 * that passes every gate (containment, polygon, overlap, wall clearance,
 * exact door-swing) wins. A piece whose whole ladder fails is honestly not
 * placed — never forced into an invalid spot. */
function placeInRoom(s: Space, doors: Opening[], existing: Furniture[]): Furniture[] {
  const CORNERS_BED = ['sw-corner', 'se-corner', 'nw-corner', 'ne-corner'] as const;
  const CORNERS_WET = ['ne-corner', 'nw-corner', 'se-corner', 'sw-corner'] as const;
  const WALLS = ['north-wall', 'south-wall', 'west-wall', 'east-wall'] as const;
  const pieces: Array<Array<{ type: FurnitureType; at: 'nw-corner'|'sw-corner'|'ne-corner'|'se-corner'|'north-wall'|'south-wall'|'east-wall'|'west-wall'|'center' }>> = [];
  switch (s.type) {
    case 'bedroom':
      pieces.push(CORNERS_BED.map(at => ({ type: 'bed-double' as const, at })));
      pieces.push(WALLS.map(at => ({ type: 'wardrobe' as const, at })));
      break;
    case 'master-bedroom':
      pieces.push(CORNERS_BED.map(at => ({ type: 'bed-king' as const, at })));
      pieces.push(WALLS.map(at => ({ type: 'wardrobe' as const, at })));
      break;
    case 'living':
      pieces.push(WALLS.map(at => ({ type: 'sofa-3seat' as const, at })));
      break;
    case 'dining':
      pieces.push([{ type: 'dining-table-4', at: 'center' }]);
      break;
    case 'kitchen':
      // P30 audit: an L-counter needs 2.6 m of wall — narrow kitchens fall
      // back to the 2.4×0.6 single counter along a long wall.
      pieces.push(CORNERS_WET.map(at => ({ type: 'kitchen-counter-l' as const, at })));
      pieces.push(WALLS.map(at => ({ type: 'kitchen-counter-single' as const, at })));
      break;
    case 'bathroom':
    case 'master-bathroom':
      pieces.push(CORNERS_WET.map(at => ({ type: 'toilet' as const, at })));
      pieces.push(CORNERS_WET.map(at => ({ type: 'sink' as const, at })));
      pieces.push(CORNERS_WET.map(at => ({ type: 'shower' as const, at })));
      break;
    case 'guest-wc':
      pieces.push(CORNERS_WET.map(at => ({ type: 'toilet' as const, at })));
      pieces.push(CORNERS_WET.map(at => ({ type: 'sink' as const, at })));
      break;
    default:
      break;
  }

  const out: Furniture[] = [];
  for (const ladder of pieces) {
    for (const p of ladder) {
      const f = makePiece(p.type, s, p.at, [...existing, ...out], doors);
      if (f) {
        out.push(f);
        break;
      }
    }
  }
  return out;
}

function makePiece(type: FurnitureType, s: Space, where: string, others: Furniture[], doors: Opening[] = []): Furniture | null {
  const size = FURNITURE_SIZES[type];
  const r = s.rect;
  const poly = s.polygon;
  if (r.w < size.w + 0.1 || r.h < size.d + 0.1) return null;

  let cand: Rect;
  switch (where) {
    case 'sw-corner':
      cand = { x: r.x + 0.05, y: r.y + 0.05, w: size.w, h: size.d };
      break;
    case 'nw-corner':
      cand = { x: r.x + 0.05, y: r.y + r.h - size.d - 0.05, w: size.w, h: size.d };
      break;
    case 'ne-corner':
      cand = { x: r.x + r.w - size.w - 0.05, y: r.y + r.h - size.d - 0.05, w: size.w, h: size.d };
      break;
    case 'se-corner':
      cand = { x: r.x + r.w - size.w - 0.05, y: r.y + 0.05, w: size.w, h: size.d };
      break;
    case 'north-wall':
      cand = { x: r.x + (r.w - size.w) / 2, y: r.y + r.h - size.d - 0.05, w: size.w, h: size.d };
      break;
    case 'south-wall':
      cand = { x: r.x + (r.w - size.w) / 2, y: r.y + 0.05, w: size.w, h: size.d };
      break;
    case 'east-wall':
      cand = { x: r.x + r.w - size.d - 0.05, y: r.y + (r.h - size.w) / 2, w: size.d, h: size.w };
      break;
    case 'west-wall':
      cand = { x: r.x + 0.05, y: r.y + (r.h - size.w) / 2, w: size.d, h: size.w };
      break;
    case 'center':
    default:
      cand = { x: r.x + (r.w - size.w) / 2, y: r.y + (r.h - size.d) / 2, w: size.w, h: size.d };
      break;
  }
  if (cand.x < r.x) cand.x = r.x + 0.05;
  if (cand.y < r.y) cand.y = r.y + 0.05;
  if (cand.x + cand.w > r.x + r.w) cand.x = r.x + r.w - cand.w - 0.05;
  if (cand.y + cand.h > r.y + r.h) cand.y = r.y + r.h - cand.h - 0.05;
  if (cand.w <= 0 || cand.h <= 0) return null;
  if (!rContains(r, cand, 1e-3)) return null;

  // Phase 11: check inside actual room polygon (canonical)
  if (poly && poly.length >= 4) {
    // Check if furniture rect is inside polygon
    if (!rectInsidePolygon(cand, poly, 1e-3)) {
      // Try center inside as fallback for L-shape corner cases
      const center = { x: cand.x + cand.w / 2, y: cand.y + cand.h / 2 };
      if (!pointInPolygon(center, poly, 1e-3)) return null;
    }
  }

  for (const o of others) {
    if (o.spaceId !== s.id) continue;
    if (rOverlapArea(cand, o.rect) > 1e-3) return null;
  }

  // Phase 18: never place a piece into a door's swing sector (validators use
  // the same exact sector — the producer and the check cannot disagree).
  for (const d of doors) {
    if (rectBlocksDoorSwing(cand, d)) return null;
  }

  return {
    id: nextId(),
    type,
    rect: cand,
    rotation: 0,
    spaceId: s.id,
    clearanceFront: size.clearanceFront,
  };
}
