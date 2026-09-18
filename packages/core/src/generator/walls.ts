/**
 * Wall generation: from placed rooms, derive walls as axis-aligned segments
 * with shared walls merged to avoid duplicate lines.
 *
 * Algorithm (V1):
 *   1. For each room rectangle, emit 4 candidate wall segments (N, S, E, W),
 *      each tagged with the room id on the interior side.
 *   2. Merge colinear candidate walls that share the same orientation and
 *      overlap within epsilon, combining their space-id sets.
 *   3. Determine wall kind (exterior if one side has no room, partition/interior
 *      otherwise) and assign thickness.
 */
import type { Space } from '../model/space.js';
import type { Wall } from '../model/wall.js';
import type { Rect } from '../geometry/rect.js';
import { EPS, WALL_EXT_THK, WALL_INT_THK, WALL_PARTITION_THK, WALL_CORE_THK, WALL_SERVICE_THK } from '../units.js';
import { rEdges } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';

interface WallCandidate {
  axis: 'h' | 'v';
  /** Fixed coordinate (y for h, x for v). */
  coord: number;
  /** Range along the axis: [min, max]. */
  range0: number;
  range1: number;
  /** For horizontal walls: is the room above (+Y) or below (-Y)? For vertical: left/right (+X / -X). */
  sideSign: 1 | -1;
  spaceId: string;
}

export function generateWalls(spaces: Space[], floorLevel: number): Wall[] {
  const candidates: WallCandidate[] = [];
  for (const s of spaces) {
    const rect: Rect = s.rect;
    // Directly use known edges with consistent (min,max) ranges to avoid
    // direction-dependent ordering issues.
    const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
    // S (south) edge: horizontal at y=y0, x from x0 to x1, room above -> plus (left of +X dir)
    candidates.push({ axis: 'h', coord: y0, range0: x0, range1: x1, sideSign: 1, spaceId: s.id });
    // N (north) edge: horizontal at y=y1, x from x0 to x1, room below -> minus
    candidates.push({ axis: 'h', coord: y1, range0: x0, range1: x1, sideSign: -1, spaceId: s.id });
    // W (west) edge: vertical at x=x0, y from y0 to y1, room on right (+X side = right of +Y dir)
    candidates.push({ axis: 'v', coord: x0, range0: y0, range1: y1, sideSign: 1, spaceId: s.id });
    // E (east) edge: vertical at x=x1, y from y0 to y1, room on left (-X side)
    candidates.push({ axis: 'v', coord: x1, range0: y0, range1: y1, sideSign: -1, spaceId: s.id });
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
    // Sort along the range axis; then merge overlapping segments while tracking
    // which space is on each side.
    group.sort((a, b) => a.range0 - b.range0);

    // Break into "intervals" at every range0 and range1, so that in each
    // interval we know which space(s) sit on each side.
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
        // Emit a wall segment [prevPos, ev.pos]
        // For a wall to be valid, we need at least one space adjacent.
        // Determine side spaces: space on + side and space on - side.
        let plus: string | null = null;
        let minus: string | null = null;
        for (const ac of active) {
          if (ac.sideSign === 1) {
            // h: sideSign 1 means interior above (+Y); v: sideSign 1 means interior to right (+X)
            if (!plus) plus = ac.spaceId;
            else if (plus !== ac.spaceId) { /* multiple rooms sharing same side on same wall line? shouldn't happen in V1 rectangles */ }
          } else {
            if (!minus) minus = ac.spaceId;
            else if (minus !== ac.spaceId) { /* same caveat */ }
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
            // "left" of start→end is +Y side, "right" is -Y side.
            // Convention: start at lower x, end at higher x.
            start = { x: prevPos, y: coord };
            end = { x: ev.pos, y: coord };
            // left = +Y = plus, right = -Y = minus
            spaceIds = [plus, minus];
          } else {
            // Vertical: start at lower y, end at higher y.
            // "left" of up-direction is -X; "right" is +X.
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
            const plusIsPartition = plusIsService;
            const minusIsPartition = minusIsService;

            if (plusIsCore || minusIsCore) {
              kind = 'core';
              thickness = WALL_CORE_THK;
            } else if (plusIsService && minusIsService) {
              kind = 'partition';
              thickness = WALL_PARTITION_THK;
            } else if (plusIsService || minusIsService) {
              kind = 'service';
              thickness = WALL_SERVICE_THK;
            } else if (plusIsPartition || minusIsPartition) {
              kind = 'partition';
              thickness = WALL_PARTITION_THK;
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
