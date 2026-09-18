/**
 * Furniture/clearance validation.
 *
 * Checks that every furniture footprint lies entirely inside its assigned
 * room and that no two pieces in the same room overlap.
 */
import type { Floor } from '../model/floor.js';
import type { Finding } from './types.js';
import type { Rect } from '../geometry/rect.js';
import { rContains, rOverlapArea } from '../geometry/rect.js';

export function validateFurniture(floor: Floor): Finding[] {
  const findings: Finding[] = [];
  const spacesById = new Map(floor.spaces.map(s => [s.id, s]));
  for (const furn of floor.furniture) {
    const room = spacesById.get(furn.spaceId);
    if (!room) {
      findings.push(f('FURN_OUTSIDE_ROOM', 'hard',
        `Furniture ${furn.type} references missing space ${furn.spaceId}.`,
        [furn.id], bbox(furn.rect)));
      continue;
    }
    if (!rContains(room.rect, furn.rect, 1e-3)) {
      findings.push(f('FURN_OUTSIDE_ROOM', 'hard',
        `${furn.type} extends outside \"${room.label}\".`,
        [furn.id, room.id], bbox(furn.rect)));
    }
  }
  for (let i = 0; i < floor.furniture.length; i++) {
    for (let j = i + 1; j < floor.furniture.length; j++) {
      const a = floor.furniture[i], b = floor.furniture[j];
      if (a.spaceId !== b.spaceId) continue;
      if (rOverlapArea(a.rect, b.rect) > 1e-3) {
        findings.push(f('FURN_COLLISION', 'soft',
          `${a.type} overlaps ${b.type} in the same room.`,
          [a.id, b.id]));
      }
    }
  }
  return findings;
}

function f(code: Finding['code'], severity: Finding['severity'], msg: string, entityIds?: string[], bb?: [number,number,number,number]): Finding {
  return { code, severity, message: msg, entityIds, bbox: bb };
}
function bbox(r: Rect): [number,number,number,number] {
  return [r.x, r.y, r.x + r.w, r.y + r.h];
}
