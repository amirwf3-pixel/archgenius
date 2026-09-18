/**
 * Phase 9 — Inter-Floor Intelligence
 *
 * Evaluates meaningful relationships such as entrance→vertical→upper floors, public/private transitions, bedroom/service distribution, shared circulation, privacy transitions, floor access.
 * Only evaluates relationships deterministically from structured project data.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { InterFloorEvaluation } from './types.js';
import { buildAdjMap, shortestPath, hasDirectAccess } from './graph.js';

function hasStair(floor: Floor): boolean {
  return floor.stairs.length > 0;
}

export function evaluateInterFloor(candidate: LayoutCandidate): InterFloorEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const floors = [...candidate.floors].sort((a, b) => a.level - b.level);
  const floorCount = floors.length;

  if (floorCount <= 1) {
    return {
      score: 1,
      entranceToVerticalScore: 1,
      publicPrivateTransitionScore: 1,
      bedroomDistributionScore: 1,
      serviceDistributionScore: 1,
      sharedCirculationScore: 1,
      privacyTransitionScore: 1,
      floorAccessScore: 1,
      findings: [],
      strengths: ['+ single floor — inter-floor not applicable'],
      weaknesses: [],
      isHeuristic: true,
    };
  }

  // Entrance → vertical circulation → upper floors
  let entranceToVerticalScore = 0;
  const ground = floors[0];
  const entrance = ground.spaces.find(s => s.type === 'entrance' || s.type === 'foyer');
  const stairHall = ground.spaces.find(s => s.type === 'stair-hall' || s.type === 'corridor');
  if (entrance && stairHall) {
    const adjMap = buildAdjMap(ground);
    const dist = shortestPath(entrance.id, stairHall.id, adjMap);
    if (dist <= 2) {
      entranceToVerticalScore = 1;
      strengths.push(`+ entrance → vertical circulation short path (${dist} steps)`);
    } else if (dist <= 4) {
      entranceToVerticalScore = 0.6;
      weaknesses.push(`- entrance → vertical circulation long path (${dist} steps)`);
    } else {
      entranceToVerticalScore = 0.3;
      weaknesses.push(`- entrance → vertical circulation very long or disconnected (${dist === Infinity ? '∞' : dist} steps)`);
      findings.push({
        code: 'INTERFLOOR_ENTRANCE_VERTICAL_LONG',
        severity: 'advisory',
        message: `Entrance to vertical circulation long path ${dist} steps (HEURISTIC)`,
        entityIds: [],
      } as Finding);
    }
  } else {
    entranceToVerticalScore = 0.5;
    weaknesses.push('- entrance or stair-hall missing on ground floor');
  }

  // Public/private transition between floors: ground public, upper private preferred
  let publicPrivateTransitionScore = 1;
  const groundPublic = ground.spaces.filter(s => s.privacy === 'public').length;
  const groundPrivate = ground.spaces.filter(s => s.privacy === 'private').length;
  const upperPrivate = floors.slice(1).reduce((sum, fl) => sum + fl.spaces.filter(s => s.privacy === 'private').length, 0);
  const upperPublic = floors.slice(1).reduce((sum, fl) => sum + fl.spaces.filter(s => s.privacy === 'public').length, 0);

  // Heuristic: ground should have more public than private, upper more private than public
  if (groundPublic >= groundPrivate) {
    strengths.push(`+ ground floor public/private balanced (${groundPublic} public vs ${groundPrivate} private)`);
  } else {
    publicPrivateTransitionScore -= 0.2;
    weaknesses.push(`- ground floor has more private than public — weak public zone`);
  }
  if (upperPrivate >= upperPublic) {
    strengths.push(`+ upper floors private-oriented (${upperPrivate} private vs ${upperPublic} public)`);
  } else {
    publicPrivateTransitionScore -= 0.2;
    weaknesses.push(`- upper floors have many public spaces — privacy transition weak`);
  }
  publicPrivateTransitionScore = Math.max(0, Math.min(1, publicPrivateTransitionScore));

  // Bedroom distribution: bedrooms on upper floors preferred in multi-floor villas? Heuristic
  let bedroomDistributionScore = 1;
  const groundBedrooms = ground.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom').length;
  const upperBedrooms = floors.slice(1).reduce((sum, fl) => sum + fl.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom').length, 0);
  const totalBedrooms = groundBedrooms + upperBedrooms;
  if (totalBedrooms > 0) {
    // Ideal: at least half bedrooms on upper floors for 2F+? But not strict
    if (floorCount >= 2) {
      const upperRatio = upperBedrooms / totalBedrooms;
      if (upperRatio >= 0.5) {
        bedroomDistributionScore = 1;
        strengths.push(`+ bedroom distribution upper-oriented ${(upperRatio * 100).toFixed(0)}% on upper floors`);
      } else if (upperRatio >= 0.3) {
        bedroomDistributionScore = 0.7;
        weaknesses.push(`- bedroom distribution ground-heavy ${(upperRatio * 100).toFixed(0)}% upper`);
      } else {
        bedroomDistributionScore = 0.5;
        weaknesses.push(`- bedrooms concentrated on ground floor, upper floors underutilized for privacy`);
      }
    }
  }

  // Service distribution: kitchen on ground preferred, service zones not scattered?
  let serviceDistributionScore = 1;
  const groundKitchen = ground.spaces.some(s => s.type === 'kitchen');
  const upperKitchen = floors.slice(1).some(fl => fl.spaces.some(s => s.type === 'kitchen'));
  if (groundKitchen) {
    strengths.push('+ kitchen on ground floor — service distribution good');
  } else if (upperKitchen && !groundKitchen) {
    serviceDistributionScore = 0.6;
    weaknesses.push('- kitchen only on upper floor — service distribution unusual');
  }
  // Service zones clustering: storage/utility on ground or near kitchen?
  const groundService = ground.spaces.filter(s => s.type === 'storage' || s.type === 'utility').length;
  const upperService = floors.slice(1).reduce((sum, fl) => sum + fl.spaces.filter(s => s.type === 'storage' || s.type === 'utility').length, 0);
  if (groundService >= upperService) {
    strengths.push('+ service zones ground-oriented');
  }

  // Shared circulation: corridor/stair-hall exists on all floors?
  let sharedCirculationScore = 1;
  let floorsWithCorridor = 0;
  for (const fl of floors) {
    if (fl.spaces.some(s => s.type === 'corridor' || s.type === 'stair-hall')) floorsWithCorridor++;
  }
  sharedCirculationScore = floorsWithCorridor / floorCount;
  if (sharedCirculationScore === 1) strengths.push(`+ shared circulation on all ${floorCount} floors`);
  else {
    weaknesses.push(`- ${floorCount - floorsWithCorridor} floor(s) missing corridor/stair-hall`);
    findings.push({
      code: 'INTERFLOOR_CIRCULATION_MISSING',
      severity: 'advisory',
      message: `${floorCount - floorsWithCorridor} floor(s) missing corridor/stair-hall (HEURISTIC)`,
      entityIds: [],
    } as Finding);
  }

  // Privacy transition: entrance not directly to upper private via stair without buffer?
  // Simplified: check if stair-hall directly adjacent to bedroom on upper floors without corridor buffer
  let privacyTransitionScore = 1;
  let directBedroomToStair = 0;
  for (const fl of floors.slice(1)) {
    const stairHall = fl.spaces.find(s => s.type === 'stair-hall');
    if (!stairHall) continue;
    for (const bed of fl.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom')) {
      if (hasDirectAccess(bed.id, stairHall.id, fl)) {
        directBedroomToStair++;
      }
    }
  }
  if (directBedroomToStair > 0) {
    privacyTransitionScore = Math.max(0, 1 - directBedroomToStair * 0.2);
    weaknesses.push(`- ${directBedroomToStair} bedroom(s) directly open to stair-hall on upper floors — privacy weak`);
    findings.push({
      code: 'INTERFLOOR_PRIVACY_WEAK',
      severity: 'advisory',
      message: `${directBedroomToStair} bedroom(s) directly open to stair-hall on upper floors (HEURISTIC)`,
      entityIds: [],
    } as Finding);
  } else {
    strengths.push('+ upper floor bedrooms separated from stair-hall');
  }

  // Floor access: each upper floor accessible via stair from ground?
  let floorAccessScore = 1;
  let accessibleFloors = 1; // ground always accessible
  for (let i = 0; i < floors.length - 1; i++) {
    const from = floors[i];
    const to = floors[i + 1];
    if (hasStair(from) && hasStair(to)) accessibleFloors++;
  }
  floorAccessScore = accessibleFloors / floorCount;
  if (floorAccessScore < 1) {
    weaknesses.push(`- ${floorCount - accessibleFloors} upper floor(s) not accessible via stair`);
    findings.push({
      code: 'INTERFLOOR_ACCESS_MISSING',
      severity: 'soft',
      message: `${floorCount - accessibleFloors} upper floor(s) not accessible via stair — vertical access broken (HEURISTIC)`,
      entityIds: [],
    } as Finding);
  } else {
    strengths.push(`+ all ${floorCount} floors accessible via vertical circulation`);
  }

  const score = Math.max(0, Math.min(1,
    entranceToVerticalScore * 0.20 +
    publicPrivateTransitionScore * 0.20 +
    bedroomDistributionScore * 0.15 +
    serviceDistributionScore * 0.10 +
    sharedCirculationScore * 0.15 +
    privacyTransitionScore * 0.10 +
    floorAccessScore * 0.10
  ));

  if (score >= 0.8) strengths.push(`+ inter-floor relationships efficient ${(score * 100).toFixed(0)}% (HEURISTIC)`);
  else if (score < 0.5) weaknesses.push(`- inter-floor relationships weak ${(score * 100).toFixed(0)}% (HEURISTIC)`);

  return {
    score,
    entranceToVerticalScore,
    publicPrivateTransitionScore,
    bedroomDistributionScore,
    serviceDistributionScore,
    sharedCirculationScore,
    privacyTransitionScore,
    floorAccessScore,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 8),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 8),
    isHeuristic: true,
  };
}
