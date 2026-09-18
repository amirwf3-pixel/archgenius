/**
 * Minimal furniture placement for usability / clearance QA.
 *
 * Furniture is placed deterministically inside each room rectangle after
 * room rectangles are fixed but before wall openings, so that door-swing
 * and clearance checks can use furniture footprints. Placement is heuristic
 * (corners / walls) and conservative: it never places furniture outside the
 * room, and it never overlaps another piece in the same room.
 *
 * The placement deliberately places ONLY the minimum footprints required
 * for clearance QA (one bed per bedroom, one toilet+sink per bathroom,
 * one kitchen counter in kitchen, one sofa set + dining table in living/
 * dining), per the Phase 3 spec.
 */
import type { Space } from '../model/space.js';
import type { Furniture, FurnitureType } from '../model/furniture.js';
import { FURNITURE_SIZES } from '../model/furniture.js';
import type { Rect } from '../geometry/rect.js';
import { rContains, rOverlapArea, rArea } from '../geometry/rect.js';

let idCounter = 0;
const nextId = () => `f-${(idCounter++).toString(36)}`;

/** Place furniture for a whole floor. */
export function placeFurniture(spaces: Space[]): Furniture[] {
  idCounter = 0;
  const out: Furniture[] = [];
  for (const s of spaces) {
    out.push(...placeInRoom(s, out));
  }
  return out;
}

function placeInRoom(s: Space, existing: Furniture[]): Furniture[] {
  const pieces: Array<{ type: FurnitureType; at: 'nw-corner'|'sw-corner'|'ne-corner'|'se-corner'|'north-wall'|'south-wall'|'east-wall'|'west-wall'|'center' }> = [];
  switch (s.type) {
    case 'bedroom':
      pieces.push({ type: 'bed-double', at: 'sw-corner' });
      pieces.push({ type: 'wardrobe', at: 'north-wall' });
      break;
    case 'master-bedroom':
      pieces.push({ type: 'bed-king', at: 'sw-corner' });
      pieces.push({ type: 'wardrobe', at: 'north-wall' });
      break;
    case 'living':
      pieces.push({ type: 'sofa-3seat', at: 'north-wall' });
      break;
    case 'dining':
      pieces.push({ type: 'dining-table-4', at: 'center' });
      break;
    case 'kitchen':
      pieces.push({ type: 'kitchen-counter-l', at: 'sw-corner' });
      break;
    case 'bathroom':
    case 'master-bathroom':
      pieces.push({ type: 'toilet', at: 'ne-corner' });
      pieces.push({ type: 'sink', at: 'nw-corner' });
      pieces.push({ type: 'shower', at: 'se-corner' });
      break;
    case 'guest-wc':
      pieces.push({ type: 'toilet', at: 'ne-corner' });
      pieces.push({ type: 'sink', at: 'nw-corner' });
      break;
    case 'parking':
      // Cars are placed by parking module, not furniture.
      break;
    default:
      break;
  }

  const out: Furniture[] = [];
  for (const p of pieces) {
    const f = makePiece(p.type, s, p.at, [...existing, ...out]);
    if (f) out.push(f);
  }
  return out;
}

function makePiece(type: FurnitureType, s: Space, where: string, others: Furniture[]): Furniture | null {
  const size = FURNITURE_SIZES[type];
  const r = s.rect;
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
  // Clamp inside room.
  if (cand.x < r.x) cand.x = r.x + 0.05;
  if (cand.y < r.y) cand.y = r.y + 0.05;
  if (cand.x + cand.w > r.x + r.w) cand.x = r.x + r.w - cand.w - 0.05;
  if (cand.y + cand.h > r.y + r.h) cand.y = r.y + r.h - cand.h - 0.05;
  if (cand.w <= 0 || cand.h <= 0) return null;
  if (!rContains(r, cand, 1e-3)) return null;

  // Avoid overlap with other furniture in the same room.
  for (const o of others) {
    if (o.spaceId !== s.id) continue;
    if (rOverlapArea(cand, o.rect) > 1e-3) return null;
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
