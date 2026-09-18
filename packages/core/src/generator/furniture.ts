/**
 * Phase 11 — Minimal furniture placement with polygon canonical containment
 */

import type { Space } from '../model/space.js';
import type { Furniture, FurnitureType } from '../model/furniture.js';
import { FURNITURE_SIZES } from '../model/furniture.js';
import type { Rect } from '../geometry/rect.js';
import { rContains, rOverlapArea } from '../geometry/rect.js';
import { pointInPolygon, rectInsidePolygon } from '../geometry/polygon-ops.js';
import { roomPolygonCentroid } from '../geometry/room-polygon.js';

let idCounter = 0;
const nextId = () => `f-${(idCounter++).toString(36)}`;

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

  return {
    id: nextId(),
    type,
    rect: cand,
    rotation: 0,
    spaceId: s.id,
    clearanceFront: size.clearanceFront,
  };
}
