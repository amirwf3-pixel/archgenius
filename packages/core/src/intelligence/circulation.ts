/**
 * Phase 8 - Circulation Intelligence
 *
 * Evaluates entrance-to-... paths, public/private/service circulation,
 * longest important path, turns, dead ends, corridor area, ratio, access graph quality.
 * Geometry-derived, deterministic, heuristic unless verified.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { CirculationEvaluation } from './types.js';
import { rArea } from '../geometry/rect.js';
import { buildAdjMap } from './graph.js';

function shortestPathWithTrace(fromId: string, toId: string, adj: Map<string, Set<string>>): { dist: number; path: string[] } {
  if (fromId === toId) return { dist: 0, path: [fromId] };
  const visited = new Map<string, { dist: number; prev: string | null }>();
  visited.set(fromId, { dist: 0, prev: null });
  const queue: string[] = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    const curDist = visited.get(cur)!.dist;
    const neighbors = adj.get(cur) ?? new Set();
    for (const nid of neighbors) {
      if (!visited.has(nid)) {
        visited.set(nid, { dist: curDist + 1, prev: cur });
        if (nid === toId) {
          // reconstruct
          const path: string[] = [toId];
          let p: string | null = cur;
          while (p) {
            path.unshift(p);
            p = visited.get(p)?.prev ?? null;
          }
          return { dist: curDist + 1, path };
        }
        queue.push(nid);
      }
    }
  }
  return { dist: Infinity, path: [] };
}

function countTurns(path: string[], floor: Floor): number {
  // Simplified: count changes in direction based on space rect centers
  if (path.length < 3) return 0;
  let turns = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const prev = floor.spaces.find(s => s.id === path[i - 1]);
    const cur = floor.spaces.find(s => s.id === path[i]);
    const next = floor.spaces.find(s => s.id === path[i + 1]);
    if (!prev || !cur || !next) continue;
    const v1 = { x: cur.rect.x - prev.rect.x, y: cur.rect.y - prev.rect.y };
    const v2 = { x: next.rect.x - cur.rect.x, y: next.rect.y - cur.rect.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (Math.abs(cross) > 0.01) turns++;
  }
  return turns;
}

export function evaluateCirculation(floor: Floor): CirculationEvaluation {
  const adjMap = buildAdjMap(floor);
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const entrance = floor.spaces.find(s => s.type === 'entrance');
  const living = floor.spaces.find(s => s.type === 'living');
  const kitchen = floor.spaces.find(s => s.type === 'kitchen');
  const bedroom = floor.spaces.find(s => s.type === 'bedroom' || s.type === 'master-bedroom');

  let entranceToLivingPath = Infinity;
  let entranceToKitchenPath = Infinity;
  let entranceToBedroomPath = Infinity;
  let longestImportantPath = 0;
  let turnCount = 0;

  if (entrance && living) {
    const res = shortestPathWithTrace(entrance.id, living.id, adjMap);
    entranceToLivingPath = res.dist;
    turnCount += countTurns(res.path, floor);
    longestImportantPath = Math.max(longestImportantPath, res.dist);
    if (res.dist <= 2) strengths.push(`+ entrance -> living short path (${res.dist} steps)`);
    else weaknesses.push(`- entrance -> living long path (${res.dist} steps)`);
  }
  if (entrance && kitchen) {
    const res = shortestPathWithTrace(entrance.id, kitchen.id, adjMap);
    entranceToKitchenPath = res.dist;
    turnCount += countTurns(res.path, floor);
    longestImportantPath = Math.max(longestImportantPath, res.dist);
    if (res.dist <= 3) strengths.push(`+ entrance -> kitchen efficient (${res.dist} steps)`);
    else weaknesses.push(`- entrance -> kitchen long (${res.dist} steps)`);
  }
  if (entrance && bedroom) {
    const res = shortestPathWithTrace(entrance.id, bedroom.id, adjMap);
    entranceToBedroomPath = res.dist;
    turnCount += countTurns(res.path, floor);
    longestImportantPath = Math.max(longestImportantPath, res.dist);
    if (res.dist >= 2) strengths.push(`+ entrance -> bedroom privacy buffer (${res.dist} steps)`);
    else weaknesses.push(`- entrance -> bedroom too direct (${res.dist} steps) - privacy weak`);
  }

  // Circulation areas
  const circTypes = new Set(['corridor', 'stair-hall', 'elevator-hall', 'entrance', 'foyer']);
  const publicTypes = new Set(['living', 'dining', 'guest-wc', 'foyer', 'entrance']);
  const privateTypes = new Set(['bedroom', 'master-bedroom', 'bathroom', 'master-bathroom']);
  const serviceTypes = new Set(['kitchen', 'storage', 'utility']);

  let publicCirc = 0, privateCirc = 0, serviceCirc = 0, corridorArea = 0, totalCirc = 0;
  for (const s of floor.spaces) {
    if (circTypes.has(s.type)) {
      totalCirc += s.area;
      if (s.type === 'corridor') corridorArea += s.area;
    }
    // Approximate public/private/service circulation by adjacency to those zones
    if (publicTypes.has(s.type) && circTypes.has(s.type)) publicCirc += s.area;
    if (privateTypes.has(s.type) && s.type === 'corridor') {
      // corridor that touches private spaces
      const touchesPrivate = s.adjacentSpaceIds.some(id => {
        const adj = floor.spaces.find(x => x.id === id);
        return adj && privateTypes.has(adj.type);
      });
      if (touchesPrivate) privateCirc += s.area;
    }
    if (serviceTypes.has(s.type) && circTypes.has(s.type)) serviceCirc += s.area;
  }

  // For simplicity, publicCirc = foyer+entrance, privateCirc = corridor portion, serviceCirc = kitchen-adjacent
  publicCirc = floor.spaces.filter(s => s.type === 'foyer' || s.type === 'entrance').reduce((sum, s) => sum + s.area, 0);
  privateCirc = corridorArea;
  serviceCirc = floor.spaces.filter(s => s.type === 'kitchen').reduce((sum, s) => sum + s.area * 0.1, 0); // heuristic

  const footprintArea = rArea(floor.footprint);
  const circulationRatio = footprintArea > 0 ? totalCirc / footprintArea : 0;

  // Dead ends: corridor with ≤1 door
  const doorConnections = new Map<string, number>();
  for (const o of floor.openings) {
    if (o.type === 'window') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    for (const sid of wall.spaceIds) {
      if (!sid) continue;
      doorConnections.set(sid, (doorConnections.get(sid) ?? 0) + 1);
    }
  }
  let deadEndCount = 0;
  for (const s of floor.spaces.filter(s => s.type === 'corridor')) {
    if ((doorConnections.get(s.id) ?? 0) <= 1) deadEndCount++;
  }

  // Unnecessary path length: if circulation ratio >0.35, penalize
  let unnecessaryPathLength = 0;
  if (circulationRatio > 0.35) unnecessaryPathLength = (circulationRatio - 0.35) * 10;

  // Access graph quality: fraction of spaces reachable, penalize dead ends
  const totalSpaces = floor.spaces.filter(s => !['parking', 'yard', 'balcony'].includes(s.type)).length;
  const reachable = Array.from(doorConnections.keys()).length;
  const accessGraphQuality = totalSpaces > 0 ? Math.max(0, 1 - deadEndCount * 0.2 - (totalSpaces - reachable) * 0.1) : 0;

  // Findings
  if (circulationRatio > 0.35) {
    findings.push({ code: 'CIRCULATION_EXCESSIVE', severity: 'soft', message: `Circulation ratio ${(circulationRatio * 100).toFixed(1)}% >35%`, entityIds: floor.spaces.filter(s => circTypes.has(s.type)).map(s => s.id) } as Finding);
    weaknesses.push(`- excessive circulation ${(circulationRatio * 100).toFixed(1)}%`);
  } else {
    strengths.push(`+ efficient circulation ${(circulationRatio * 100).toFixed(1)}%`);
  }
  if (deadEndCount > 0) {
    findings.push({ code: 'CIRCULATION_DEAD_END', severity: 'soft', message: `${deadEndCount} dead-end corridor(s)`, entityIds: [] } as Finding);
    weaknesses.push(`- ${deadEndCount} dead-end corridor(s)`);
  }
  if (turnCount > 5) {
    weaknesses.push(`- many turns in important paths (${turnCount})`);
  }

  const score = Math.max(0, Math.min(1, 1 - circulationRatio * 0.5 - deadEndCount * 0.15 - unnecessaryPathLength * 0.05 - turnCount * 0.02 + (accessGraphQuality * 0.2)));

  return {
    score,
    entranceToLivingPath,
    entranceToKitchenPath,
    entranceToBedroomPath,
    publicCirculationArea: publicCirc,
    privateCirculationArea: privateCirc,
    serviceCirculationArea: serviceCirc,
    longestImportantPath,
    unnecessaryPathLength,
    turnCount,
    deadEndCount,
    corridorArea,
    circulationRatio,
    accessGraphQuality,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
