/**
 * Phase 8 - Daylight & Orientation Intelligence
 *
 * Evaluates room orientation, exterior wall availability, window potential, room depth, daylight exposure, space type priority.
 * Design heuristics unless backed by verified regulation.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { DaylightEvaluation } from './types.js';

type AccessSide = 'south' | 'north' | 'east' | 'west';

function wallSide(wall: any, footprint: { x: number; y: number; w: number; h: number }): AccessSide | null {
  const EPS = 1e-6;
  const x = wall.start.x, y = wall.start.y, endX = wall.end.x, endY = wall.end.y;
  if (wall.kind !== 'exterior') return null;
  if (Math.abs(y - footprint.y) < EPS && Math.abs(endY - footprint.y) < EPS) return 'south';
  if (Math.abs(y - (footprint.y + footprint.h)) < EPS && Math.abs(endY - (footprint.y + footprint.h)) < EPS) return 'north';
  if (Math.abs(x - footprint.x) < EPS && Math.abs(endX - footprint.x) < EPS) return 'west';
  if (Math.abs(x - (footprint.x + footprint.w)) < EPS && Math.abs(endX - (footprint.x + footprint.w)) < EPS) return 'east';
  return null;
}

function orientationScoreForType(roomType: string, side: AccessSide | null): number {
  if (!side) return 0;
  switch (roomType) {
    case 'living':
      if (side === 'south') return 10;
      if (side === 'east' || side === 'west') return 6;
      return 2;
    case 'master-bedroom':
      if (side === 'south') return 10;
      if (side === 'east') return 8;
      if (side === 'west') return 5;
      return 1;
    case 'bedroom':
      if (side === 'east') return 9;
      if (side === 'west') return 7;
      if (side === 'south') return 6;
      return 2;
    case 'kitchen':
      if (side === 'east') return 9;
      if (side === 'north') return 7;
      if (side === 'south') return 4;
      return 3;
    case 'dining':
      if (side === 'south') return 8;
      if (side === 'east' || side === 'west') return 6;
      return 3;
    default:
      return 5;
  }
}

export function evaluateDaylight(floor: Floor): DaylightEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const roomScores: DaylightEvaluation['roomScores'] = [];
  let livingScore = 0, diningScore = 0, bedroomScore = 0, kitchenScore = 0;
  let livingCount = 0, diningCount = 0, bedroomCount = 0, kitchenCount = 0;
  let totalDepth = 0, depthCount = 0;
  let exteriorWalls = 0, totalRooms = 0;

  for (const s of floor.spaces) {
    if (['parking', 'corridor', 'stair-hall', 'elevator-hall', 'storage', 'entrance', 'foyer', 'yard'].includes(s.type)) continue;
    totalRooms++;

    const extWalls = floor.walls.filter(w => w.kind === 'exterior' && w.spaceIds.includes(s.id));
    if (extWalls.length > 0) exteriorWalls++;

    // Window potential: does it have window?
    const hasWindow = floor.openings.some(o => o.type === 'window' && (o.spaceA === s.id || o.spaceB === s.id));
    const windowPotential = hasWindow ? 1 : (extWalls.length > 0 ? 0.5 : 0);

    // Orientation score: best orientation among exterior walls
    let bestOrient = 0;
    let bestSide: AccessSide | null = null;
    for (const w of extWalls) {
      const side = wallSide(w, floor.footprint);
      const score = orientationScoreForType(s.type, side);
      if (score > bestOrient) {
        bestOrient = score;
        bestSide = side;
      }
    }
    const orientationScore = bestOrient / 10; // normalize 0..1
    const exteriorWallScore = extWalls.length > 0 ? 1 : 0;

    // Depth score: room depth should be <=7m for daylight (MBH4-DYL-001 verified: max 7m)
    const depth = Math.max(s.rect.w, s.rect.h);
    totalDepth += depth;
    depthCount++;
    let depthScore = 1;
    if (depth > 7) {
      depthScore = Math.max(0, 1 - (depth - 7) * 0.15);
      if (s.daylightRequired) {
        findings.push({ code: 'ARCH_DAYLIGHT_MISSING', severity: 'soft', message: `Room ${s.label} depth ${depth.toFixed(2)}m >7m may have weak daylight`, entityIds: [s.id] } as Finding);
        weaknesses.push(`- ${s.label} deep ${depth.toFixed(1)}m >7m - daylight weak`);
      }
    } else {
      if (s.daylightRequired && hasWindow) strengths.push(`+ ${s.label} good daylight depth ${depth.toFixed(1)}m`);
    }

    const overall = (orientationScore * 0.3 + exteriorWallScore * 0.3 + windowPotential * 0.3 + depthScore * 0.1);

    roomScores.push({
      roomId: s.id,
      roomType: s.type,
      orientationScore,
      exteriorWallScore,
      windowPotential,
      depthScore,
      overall,
    });

    if (s.type === 'living') { livingScore += overall; livingCount++; }
    else if (s.type === 'dining') { diningScore += overall; diningCount++; }
    else if (s.type === 'bedroom' || s.type === 'master-bedroom') { bedroomScore += overall; bedroomCount++; }
    else if (s.type === 'kitchen') { kitchenScore += overall; kitchenCount++; }
  }

  const avgLiving = livingCount > 0 ? livingScore / livingCount : 0;
  const avgDining = diningCount > 0 ? diningScore / diningCount : 0;
  const avgBedroom = bedroomCount > 0 ? bedroomScore / bedroomCount : 0;
  const avgKitchen = kitchenCount > 0 ? kitchenScore / kitchenCount : 0;

  const averageDepth = depthCount > 0 ? totalDepth / depthCount : 0;
  const exteriorWallRatio = totalRooms > 0 ? exteriorWalls / totalRooms : 0;

  if (exteriorWallRatio < 0.5) weaknesses.push(`- only ${(exteriorWallRatio * 100).toFixed(0)}% rooms have exterior wall`);
  else strengths.push(`+ ${(exteriorWallRatio * 100).toFixed(0)}% rooms have exterior wall`);

  // Overall score weighted by priority: living and master bedroom higher
  const score = Math.max(0, Math.min(1,
    avgLiving * 0.3 +
    avgBedroom * 0.25 +
    avgDining * 0.2 +
    avgKitchen * 0.15 +
    exteriorWallRatio * 0.1
  ));

  if (avgLiving > 0.7) strengths.push(`+ living daylight good ${(avgLiving * 100).toFixed(0)}%`);
  if (avgBedroom > 0.7) strengths.push(`+ bedroom daylight good ${(avgBedroom * 100).toFixed(0)}%`);
  if (avgLiving < 0.4 && livingCount > 0) weaknesses.push(`- living daylight weak ${(avgLiving * 100).toFixed(0)}%`);
  if (avgBedroom < 0.4 && bedroomCount > 0) weaknesses.push(`- bedroom daylight weak ${(avgBedroom * 100).toFixed(0)}%`);

  return {
    score,
    roomScores: roomScores.sort((a, b) => b.overall - a.overall),
    livingScore: avgLiving,
    diningScore: avgDining,
    bedroomScore: avgBedroom,
    kitchenScore: avgKitchen,
    averageDepth,
    exteriorWallRatio,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
