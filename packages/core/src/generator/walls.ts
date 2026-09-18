/**
 * Phase 11 — Wall generation from canonical room polygon
 *
 * From placed rooms (polygon canonical), derive walls as axis-aligned segments
 * with shared walls merged to avoid duplicate lines.
 *
 * Algorithm:
 *   1. For each room polygon, emit candidate wall segments for each edge (orthogonal)
 *      tagged with room id on interior side, using polygon orientation to determine interior.
 *   2. Merge colinear candidates that share same orientation and overlap within epsilon.
 *   3. Determine wall kind and thickness.
 */

import type { Space } from '../model/space.js';
import type { Wall } from '../model/wall.js';
import { EPS, WALL_EXT_THK, WALL_INT_THK, WALL_PARTITION_THK, WALL_CORE_THK, WALL_SERVICE_THK } from '../units.js';
import type { Vec2 } from '../geometry/vec2.js';
import { polygonSignedArea } from '../geometry/polygon-ops.js';

interface WallCandidate {
  axis: 'h' | 'v';
  coord: number;
  range0: number;
  range1: number;
  sideSign: 1 | -1;
  spaceId: string;
}

export function generateWalls(spaces: Space[], floorLevel: number): Wall[] {
  const candidates: WallCandidate[] = [];

  for (const s of spaces) {
    const poly = s.polygon;
    if (!poly || poly.length < 3) continue;
    const area = polygonSignedArea(poly);
    const isCCW = area > 0;

    for (let i = 0, n = poly.length; i < n; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      const isHorizontal = Math.abs(dy) < 1e-6;
      const isVertical = Math.abs(dx) < 1e-6;
      if (!isHorizontal && !isVertical) {
        // Phase 11 only supports orthogonal, skip non-orthogonal (should not happen)
        continue;
      }

      // Interior normal: left if CCW, right if CW
      // For edge vector (dx,dy), left normal = (-dy, dx), right = (dy, -dx)
      let nx: number, ny: number;
      if (isCCW) {
        nx = -dy / len;
        ny = dx / len;
      } else {
        nx = dy / len;
        ny = -dx / len;
      }

      if (isHorizontal) {
        const y = p1.y; // same as p2.y
        const x0 = Math.min(p1.x, p2.x);
        const x1 = Math.max(p1.x, p2.x);
        if (x1 - x0 < 1e-6) continue;
        // Interior north => sideSign 1, south => -1
        const sideSign: 1 | -1 = ny > 0 ? 1 : -1;
        candidates.push({ axis: 'h', coord: y, range0: x0, range1: x1, sideSign, spaceId: s.id });
      } else {
        const x = p1.x;
        const y0 = Math.min(p1.y, p2.y);
        const y1 = Math.max(p1.y, p2.y);
        if (y1 - y0 < 1e-6) continue;
        // Interior east => sideSign 1, west => -1
        const sideSign: 1 | -1 = nx > 0 ? 1 : -1;
        candidates.push({ axis: 'v', coord: x, range0: y0, range1: y1, sideSign, spaceId: s.id });
      }
    }
  }

  // Group by axis + coord (rounded to epsilon)
  type Key = string;
  const groups = new Map<Key, WallCandidate[]>();
  const key = (c: WallCandidate): Key => `${c.axis}:${Math.round(c.coord / EPS) * EPS}`;
  for (const c of candidates) {
    const k = key(c);
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(c);
  }

  const walls: Wall[] = [];
  let wallIdx = 0;

  for (const [, group] of groups) {
    group.sort((a, b) => a.range0 - b.range0);

    const events: Array<{ pos: number; add?: WallCandidate; remove?: WallCandidate }> = [];
    for (const c of group) {
      events.push({ pos: c.range0, add: c });
      events.push({ pos: c.range1, remove: c });
    }
    events.sort((a, b) => a.pos - b.pos);

    const active: WallCandidate[] = [];
    let prevPos = events[0]?.pos ?? 0;
    for (const ev of events) {
      if (ev.pos - prevPos > EPS) {
        let plus: string | null = null;
        let minus: string | null = null;
        for (const ac of active) {
          if (ac.sideSign === 1) {
            if (!plus) plus = ac.spaceId;
          } else {
            if (!minus) minus = ac.spaceId;
          }
        }
        if (plus || minus) {
          const axis = group[0].axis;
          const coord = group[0].coord;
          let start: Vec2, end: Vec2;
          let spaceIds: [string | null, string | null];
          let kind: Wall['kind'];
          let thickness: number;
          if (axis === 'h') {
            start = { x: prevPos, y: coord };
            end = { x: ev.pos, y: coord };
            spaceIds = [plus, minus];
          } else {
            start = { x: coord, y: prevPos };
            end = { x: coord, y: ev.pos };
            spaceIds = [minus, plus];
          }
          const ext = !plus || !minus;
          if (ext) {
            kind = 'exterior';
            thickness = WALL_EXT_THK;
          } else {
            const plusType = spaces.find(s => s.id === plus)?.type;
            const minusType = spaces.find(s => s.id === minus)?.type;
            const plusIsCore = plusType === 'stair-hall' || plusType === 'elevator-hall';
            const minusIsCore = minusType === 'stair-hall' || minusType === 'elevator-hall';
            const plusIsService = plusType === 'bathroom' || plusType === 'master-bathroom' || plusType === 'guest-wc' || plusType === 'storage' || plusType === 'utility';
            const minusIsService = minusType === 'bathroom' || minusType === 'master-bathroom' || minusType === 'guest-wc' || minusType === 'storage' || minusType === 'utility';
            if (plusIsCore || minusIsCore) {
              kind = 'core';
              thickness = WALL_CORE_THK;
            } else if (plusIsService && minusIsService) {
              kind = 'partition';
              thickness = WALL_PARTITION_THK;
            } else if (plusIsService || minusIsService) {
              kind = 'service';
              thickness = WALL_SERVICE_THK;
            } else {
              kind = 'interior';
              thickness = WALL_INT_THK;
            }
          }
          walls.push({
            id: `wall-${floorLevel}-${wallIdx++}`,
            kind,
            start,
            end,
            thickness,
            spaceIds,
            openingIds: [],
            floor: floorLevel,
          });
        }
      }
      if (ev.add) active.push(ev.add);
      if (ev.remove) {
        const idx = active.indexOf(ev.remove);
        if (idx >= 0) active.splice(idx, 1);
      }
      prevPos = ev.pos;
    }
  }

  return walls;
}
