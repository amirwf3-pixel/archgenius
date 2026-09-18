/**
 * Phase 8 Hardening — Shared deterministic graph utilities
 *
 * Extracted from duplicated BFS helpers across intelligence modules.
 * Pure, deterministic, no side effects, uses canonical geometry.
 */

import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';

export function buildAdjMap(floor: Floor): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const s of floor.spaces) adj.set(s.id, new Set(s.adjacentSpaceIds));
  return adj;
}

export function shortestPath(fromId: string, toId: string, adj: Map<string, Set<string>>): number {
  if (fromId === toId) return 0;
  const visited = new Set<string>([fromId]);
  const queue: Array<{ id: string; dist: number }> = [{ id: fromId, dist: 0 }];
  while (queue.length) {
    const cur = queue.shift()!;
    const neighbors = adj.get(cur.id) ?? new Set();
    for (const nid of neighbors) {
      if (nid === toId) return cur.dist + 1;
      if (!visited.has(nid)) {
        visited.add(nid);
        queue.push({ id: nid, dist: cur.dist + 1 });
      }
    }
  }
  return Infinity;
}

export function hasDirectAccess(aId: string, bId: string, floor: Floor): boolean {
  for (const o of floor.openings) {
    if (o.type === 'window') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    const ids = wall.spaceIds.filter(Boolean) as string[];
    if (ids.includes(aId) && ids.includes(bId)) return true;
  }
  return false;
}

export function areAdjacent(a: Space, b: Space): boolean {
  return a.adjacentSpaceIds.includes(b.id) || b.adjacentSpaceIds.includes(a.id);
}

export function sameZone(a: Space, b: Space): boolean {
  return a.zone === b.zone;
}
