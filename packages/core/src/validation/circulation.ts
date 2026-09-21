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

  interface DoorEdge { a: string; b?: string; openingId: string; entry: boolean }
  const doorEdges: DoorEdge[] = [];

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
      doorEdges.push({ a, b, openingId: o.id, entry: o.type === 'entrance' });
    } else if (a) {
      // Street-side door: one interior side only — still relevant for entry checks.
      doorEdges.push({ a, openingId: o.id, entry: o.type === 'entrance' });
    }
  }

  // Phase 15 M5: an upper floor without any vertical hall is disconnected no matter what
  // the door graph looks like — checked before seed short-circuits below.
  if (floor.level > 0) {
    const hasVert = floor.spaces.some(s => s.type === 'stair-hall' || s.type === 'elevator-hall');
    const hasRooms = floor.spaces.some(s => !['parking', 'yard', 'balcony'].includes(s.type));
    if (!hasVert && hasRooms) {
      findings.push(f('CIRC_VERTICAL_DISCONNECTED', 'hard',
        `Level ${floor.level} has habitable spaces but no stair or elevator hall connecting it to the rest of the house.`, undefined));
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

  // --- Phase 15 M5: circulation QUALITY checks (topology, not mere connectivity) ---
  {
    const PRIVATE_THROUGH = new Set(['bedroom', 'master-bedroom', 'guest-room', 'family-room', 'study', 'kids']);
    const WET = new Set(['bathroom', 'master-bathroom', 'guest-wc', 'laundry']);
    const STOR = new Set(['storage', 'walk-in', 'wardrobe', 'utility', 'pantry']);
    const HABITABLE = new Set(['living', 'dining', 'kitchen', 'bedroom', 'master-bedroom', 'guest-room', 'family-room', 'study', 'kids']);
    const ENTRY_WET_PRIVATE = new Set(['bedroom', 'master-bedroom', 'guest-room', 'family-room', 'study', 'kids', 'bathroom', 'master-bathroom', 'guest-wc', 'storage', 'walk-in', 'wardrobe', 'utility', 'laundry', 'pantry']);

    // 1) Street entry must open into entry/public circulation, never into a private
    //    or back-of-house room (that forces the whole house through a bedroom).
    for (const e of doorEdges) {
      if (!e.entry) continue;
      // External walls carry [interiorSpace, undefined]; the interior side decides.
      const sides = [e.a, e.b].filter((x): x is string => !!x).map(id => spacesById.get(id)).filter(Boolean);
      const inner = sides.find(s => s!.type !== 'yard' && s!.type !== 'parking' && s!.type !== 'balcony');
      if (!inner) continue;
      if (ENTRY_WET_PRIVATE.has(inner.type)) {
        findings.push(f('CIRC_INVALID_ENTRY', 'hard',
          `Street entrance opens directly into "${inner.label}" — the front door must lead into the entry hall, foyer or living area.`,
          [e.openingId, inner.id]));
      } else if (inner.type === 'kitchen') {
        findings.push(f('CIRC_INVALID_ENTRY', 'soft',
          `Street entrance opens directly into "${inner.label}" — an entry hall or living room is the conventional front sequence.`,
          [e.openingId, inner.id]));
      }
    }

    // 2) Forced pass-through: a room that is an articulation point on another
    //    room's ONLY path from the entry. Suite exemption: a single wet/storage
    //    pendant reached through its owning bedroom is an ensuite, not a defect.
    const reachableFull = visited;
    for (const v of floor.spaces) {
      if (CIRC_TYPES.has(v.type)) continue;
      if (v.type === 'living' || v.type === 'dining') continue; // public hall bridges are intentional
      if (!reachableFull.has(v.id)) continue;
      const cut = new Set<string>();
      const q2 = seeds.map(s => s.id).filter(id => id !== v.id);
      if (seeds.length === 1 && seeds[0].id === v.id) continue;
      for (const id of q2) if (!cut.has(id)) cut.add(id);
      while (q2.length) {
        const id = q2.shift()!;
        for (const n of adj[id]) {
          if (n === v.id || cut.has(n)) continue;
          cut.add(n); q2.push(n);
        }
      }
      const lost = [...reachableFull].filter(id => id !== v.id && !cut.has(id));
      if (lost.length === 0) continue;
      const lostIsSuitePendant =
        lost.length === 1 && (WET.has(spacesById.get(lost[0])?.type ?? '') || STOR.has(spacesById.get(lost[0])?.type ?? '')) &&
        (adj[lost[0]].size === 1);
      const lostHasHabitable = lost.some(id => HABITABLE.has(spacesById.get(id)?.type ?? ''));
      if (lostIsSuitePendant && !lostHasHabitable) continue;
      findings.push(f('CIRC_ROOM_THROUGH_ROOM', 'hard',
        `"${v.label}" is used as a corridor: ${lost.map(id => spacesById.get(id)?.label ?? id).join(', ')} ${lost.length > 1 ? 'are' : 'is'} only reachable by passing through it.`,
        [v.id, ...lost]));
    }

    // 3) Redundant doors: the same two rooms joined by more than one opening.
    const pairCount = new Map<string, string[]>();
    for (const e of doorEdges) {
      if (!e.b) continue;
      const key = [e.a, e.b].sort().join('|');
      const ids = pairCount.get(key) ?? [];
      ids.push(e.openingId);
      pairCount.set(key, ids);
    }
    for (const [key, ids] of pairCount) {
      if (ids.length <= 1) continue;
      const [a, b] = key.split('|').map(id => spacesById.get(id));
      findings.push(f('CIRC_REDUNDANT_DOOR', 'soft',
        `${ids.length} doors between "${a?.label ?? key.split('|')[0]}" and "${b?.label ?? key.split('|')[1]}" — one intentional link is enough.`,
        ids));
    }

    // 4) Excessive detours (> 5 door hops from the entry) suggest a missing hall link.
    {
      const dist = new Map<string, number>();
      for (const s of seeds) dist.set(s.id, 0);
      const q3 = seeds.map(s => s.id);
      while (q3.length) {
        const id = q3.shift()!;
        for (const n of adj[id]) if (!dist.has(n)) { dist.set(n, dist.get(id)! + 1); q3.push(n); }
      }
      for (const s of floor.spaces) {
        if (CIRC_TYPES.has(s.type) || s.type === 'parking' || s.type === 'yard' || s.type === 'balcony') continue;
        const h = dist.get(s.id);
        if (h !== undefined && h > 5) {
          findings.push(f('CIRC_EXCESSIVE_PATH', 'soft',
            `"${s.label}" is ${h} door-hops from the entry — circulation takes an unnecessarily long detour.`, [s.id]));
        }
      }
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
