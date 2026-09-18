/**
 * Circulation validation: checks that every room is reachable from the
 * entrance through corridors/doors and that doors don't open into walls.
 *
 * V1 is conservative: a space is considered reachable iff it is connected
 * (via door) either to the entrance/foyer/corridor chain, or directly to a
 * circulation space (corridor / stair-hall / foyer).
 */
import type { Floor } from '../model/floor.js';
import type { Opening } from '../model/opening.js';
import type { Finding } from './types.js';

const CIRC_TYPES = new Set(['entrance', 'foyer', 'corridor', 'stair-hall', 'elevator-hall']);

export function validateCirculation(floor: Floor): Finding[] {
  const findings: Finding[] = [];
  const spacesById = new Map(floor.spaces.map(s => [s.id, s]));
  const adj: Record<string, Set<string>> = {};
  for (const s of floor.spaces) adj[s.id] = new Set();

  for (const o of floor.openings) {
    if (o.type !== 'door' && o.type !== 'entrance' && o.type !== 'sliding-door') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) {
      findings.push(f('OPENING_INVALID_WALL', 'hard', `Opening ${o.id} references missing wall ${o.wallId}.`, [o.id]));
      continue;
    }
    const [a, b] = wall.spaceIds;
    if (a && b) {
      adj[a].add(b);
      adj[b].add(a);
    }
  }

  // Find entrances as BFS seeds.
  const entrances = floor.spaces.filter(s => s.type === 'entrance' || s.type === 'foyer');
  const seeds = entrances.length ? entrances : floor.spaces.filter(s => CIRC_TYPES.has(s.type));
  if (seeds.length === 0) {
    findings.push(f('CIRC_DISCONNECTED', 'hard', 'No circulation seed (entrance/foyer/corridor) found on floor.'));
    return findings;
  }

  const visited = new Set<string>();
  const queue = seeds.map(s => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const n of adj[id] || []) {
      if (!visited.has(n)) queue.push(n);
    }
  }

  // For multi-floor buildings, stair-hall connections are considered seeds for upper floors.
  for (const s of floor.spaces) {
    if ((s.type === 'stair-hall' || s.type === 'elevator-hall') && !visited.has(s.id)) {
      // still mark as reachable (vertical circulation) on non-ground floors
      if (floor.level > 0) {
        visited.add(s.id);
        // flood-fill from there too
        const q = [s.id];
        while (q.length) {
          const id = q.shift()!;
          if (visited.has(id) && id !== s.id) { /* already */ }
          visited.add(id);
          for (const n of adj[id] || []) if (!visited.has(n)) q.push(n);
        }
      }
    }
  }

  for (const s of floor.spaces) {
    // Parking and yard are reachable via entrance door directly or vehicle access; ignore for circulation check.
    if (s.type === 'parking' || s.type === 'yard' || s.type === 'balcony') continue;
    if (!visited.has(s.id)) {
      findings.push(f('CIRC_INACCESSIBLE_SPACE', 'hard',
        `Space "${s.label}" is not reachable from the entrance/circulation.`,
        [s.id], [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h]));
    }
  }

  // Door swing blocked by wall? V1 heuristic: if a door center is very close (< 0.1m) to a wall end,
  // or the arc intersects a nearby perpendicular wall, flag it.
  for (const o of floor.openings) {
    if (o.type !== 'door' && o.type !== 'entrance') continue;
    const blocked = doorSwingBlocked(o, floor);
    if (blocked) {
      findings.push(f('OPENING_DOOR_SWING_BLOCKED', 'soft',
        `Door of ${labelOf(o, floor)} may swing into obstruction.`,
        [o.id]));
    }
  }

  return findings;
}

function labelOf(o: Opening, floor: Floor): string {
  const wall = floor.walls.find(w => w.id === o.wallId);
  if (wall) {
    const ids = wall.spaceIds.filter(Boolean) as string[];
    const names = ids.map(id => floor.spaces.find(s => s.id === id)?.label ?? id);
    return names.join(' / ') || o.id;
  }
  return o.id;
}

/**
 * Very conservative V1 heuristic: door swing is considered blocked if any
 * other wall crosses the 90° arc quadrant on the swing side within the
 * door radius. We check approximate bounding overlap only.
 */
function doorSwingBlocked(o: Opening, floor: Floor): boolean {
  if (!o.swing || o.swing === 'sliding') return false;
  const r = o.width; // open-door radius
  const cx = o.center.x, cy = o.center.y;
  // compute arc bounding box
  const minX = cx - r, maxX = cx + r, minY = cy - r, maxY = cy + r;
  for (const w of floor.walls) {
    if (w.id === o.wallId) continue;
    // simple segment-aabb check
    const seg = segAabb(w.start.x, w.start.y, w.end.x, w.end.y);
    if (seg.maxX < minX || seg.minX > maxX || seg.maxY < minY || seg.minY > maxY) continue;
    // not doing exact arc-segment intersection in V1; flag as advisory via soft if close
    const dx = Math.max(0, Math.max(minX - Math.max(w.start.x, w.end.x), Math.min(w.start.x, w.end.x) - maxX));
    const dy = Math.max(0, Math.max(minY - Math.max(w.start.y, w.end.y), Math.min(w.start.y, w.end.y) - maxY));
    if (dx * dx + dy * dy < 0.4 * 0.4) return true;
  }
  return false;
}

function segAabb(x1: number, y1: number, x2: number, y2: number) {
  return {
    minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
    minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
  };
}

function f(code: Finding['code'], severity: Finding['severity'], msg: string, entityIds?: string[], bbox?: Finding['bbox']): Finding {
  return { code, severity, message: msg, entityIds, bbox };
}
