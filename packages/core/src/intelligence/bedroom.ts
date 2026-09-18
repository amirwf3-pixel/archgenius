/**
 * Phase 8 - Bedroom Intelligence
 *
 * Evaluates bed usability, wardrobe usability, access, circulation, door placement, window relationship, privacy, proportions, master/secondary hierarchy, ensuite relationship.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { BedroomEvaluation } from './types.js';
import { rContains } from '../geometry/rect.js';
import { buildAdjMap, shortestPath, hasDirectAccess } from './graph.js';

export function evaluateBedroom(floor: Floor): BedroomEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const adjMap = buildAdjMap(floor);

  const bedrooms = floor.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom');
  const master = floor.spaces.find(s => s.type === 'master-bedroom');

  const rooms: BedroomEvaluation['rooms'] = [];

  for (const bed of bedrooms) {
    const furns = floor.furniture.filter(f => f.spaceId === bed.id);
    const hasBed = furns.some(f => f.type.includes('bed'));
    const hasWardrobe = furns.some(f => f.type === 'wardrobe');

    let bedUsability = hasBed ? 1 : 0.4;
    let wardrobeUsability = hasWardrobe ? 1 : 0.5;
    let accessScore = 1;
    let circulationScore = 1;
    let doorPlacementScore = 1;
    let windowRelationshipScore = 1;
    let privacyScore = 1;
    let proportionScore = 1;
    let ensuiteRelationshipScore: number | undefined;

    const issues: string[] = [];

    // Bed usability: bed should not block door, should have clearance
    if (!hasBed) {
      issues.push('no bed');
      bedUsability = 0.4;
    } else {
      const bedFurn = furns.find(f => f.type.includes('bed'))!;
      // Door conflict
      for (const o of floor.openings) {
        if (o.type === 'window') continue;
        const wall = floor.walls.find(w => w.id === o.wallId);
        if (!wall) continue;
        if (!wall.spaceIds.includes(bed.id)) continue;
        const dx = (bedFurn.rect.x + bedFurn.rect.w / 2) - o.center.x;
        const dy = (bedFurn.rect.y + bedFurn.rect.h / 2) - o.center.y;
        if (Math.hypot(dx, dy) < 1.0) {
          bedUsability -= 0.3;
          issues.push('bed near door');
        }
      }
      if (bedFurn.clearanceFront && bedFurn.clearanceFront < 0.6) {
        bedUsability -= 0.2;
        issues.push('bed clearance small');
      }
    }

    // Wardrobe usability
    if (!hasWardrobe) {
      issues.push('no wardrobe');
      wardrobeUsability = 0.5;
    }

    // Access: should be via corridor, not via another bedroom (except master suite)
    const corridor = floor.spaces.find(s => s.type === 'corridor');
    if (corridor && hasDirectAccess(bed.id, corridor.id, floor)) {
      accessScore = 1;
      strengths.push(`+ ${bed.label} direct corridor access`);
    } else {
      // Check if access via master bedroom (secondary bedroom opens off master)
      const viaMaster = master && hasDirectAccess(bed.id, master.id, floor) && bed.type !== 'master-bedroom';
      if (viaMaster) {
        accessScore = 0.7;
        issues.push('access via master bedroom');
      } else {
        accessScore = 0.4;
        weaknesses.push(`- ${bed.label} no corridor access`);
      }
    }

    // Circulation: room min side should be >=2.15 (bedroom min width) and area >=12 for master
    const minSide = Math.min(bed.rect.w, bed.rect.h);
    const area = bed.area;
    if (bed.type === 'master-bedroom') {
      if (area >= 12 && minSide >= 2.7) circulationScore = 1;
      else if (area >= 9 && minSide >= 2.5) circulationScore = 0.7;
      else circulationScore = 0.4;
    } else {
      if (minSide >= 2.15 && area >= 6.5) circulationScore = 1;
      else circulationScore = 0.5;
    }

    // Door placement: door should not be in middle of long wall blocking furniture? Simplified: door near corner is better
    // Check if door center is near wall end (within 0.5m of corner) - we approximate by checking opening position
    const doors = floor.openings.filter(o => {
      const wall = floor.walls.find(w => w.id === o.wallId);
      return wall && wall.spaceIds.includes(bed.id) && o.type !== 'window';
    });
    if (doors.length > 0) {
      // If door is in middle, penalize slightly
      doorPlacementScore = 0.9;
    }

    // Window relationship
    const hasWindow = floor.openings.some(o => o.type === 'window' && (o.spaceA === bed.id || o.spaceB === bed.id));
    windowRelationshipScore = hasWindow ? 1 : 0.3;
    if (!hasWindow) {
      issues.push('no window');
      weaknesses.push(`- ${bed.label} no window`);
    } else {
      strengths.push(`+ ${bed.label} has window`);
    }

    // Privacy: should not directly open to entrance/foyer/living
    const entrance = floor.spaces.find(s => s.type === 'entrance' || s.type === 'foyer');
    const living = floor.spaces.find(s => s.type === 'living');
    if (entrance && hasDirectAccess(bed.id, entrance.id, floor)) {
      privacyScore = 0.2;
      issues.push('direct entrance exposure');
      weaknesses.push(`- ${bed.label} exposed to entrance`);
    } else if (living && hasDirectAccess(bed.id, living.id, floor)) {
      privacyScore = 0.5;
      issues.push('opens to living');
    } else {
      privacyScore = 1;
    }

    // Proportion: max/min should be <=2.5 ideal
    const maxSide = Math.max(bed.rect.w, bed.rect.h);
    const proportion = maxSide / Math.max(minSide, 1e-6);
    if (proportion <= 1.5) proportionScore = 1;
    else if (proportion <= 2.0) proportionScore = 0.8;
    else if (proportion <= 3.0) proportionScore = 0.5;
    else proportionScore = 0.3;

    // Master/ensuite relationship
    if (bed.type === 'master-bedroom') {
      const ensuite = floor.spaces.find(s => s.type === 'master-bathroom');
      if (ensuite) {
        if (hasDirectAccess(bed.id, ensuite.id, floor)) {
          ensuiteRelationshipScore = 1;
          strengths.push('+ master <-> ensuite direct access');
        } else {
          const dist = shortestPath(bed.id, ensuite.id, adjMap);
          if (dist <= 2) ensuiteRelationshipScore = 0.7;
          else ensuiteRelationshipScore = 0.3;
          weaknesses.push(`- master ensuite not directly accessible (${dist} steps)`);
        }
      }
    }

    const overall = Math.max(0, Math.min(1,
      bedUsability * 0.2 +
      wardrobeUsability * 0.15 +
      accessScore * 0.15 +
      circulationScore * 0.15 +
      doorPlacementScore * 0.05 +
      windowRelationshipScore * 0.15 +
      privacyScore * 0.1 +
      proportionScore * 0.05 +
      (ensuiteRelationshipScore !== undefined ? ensuiteRelationshipScore * 0.1 : 0) * (bed.type === 'master-bedroom' ? 1 : 0)
    ));

    if (overall > 0.8) strengths.push(`+ ${bed.label} usability high ${(overall * 100).toFixed(0)}%`);
    else if (overall < 0.5) weaknesses.push(`- ${bed.label} usability low ${(overall * 100).toFixed(0)}%: ${issues.slice(0, 2).join(', ')}`);

    rooms.push({
      roomId: bed.id,
      type: bed.type,
      bedUsability,
      wardrobeUsability,
      accessScore,
      circulationScore,
      doorPlacementScore,
      windowRelationshipScore,
      privacyScore,
      proportionScore,
      ensuiteRelationshipScore,
      overall,
      issues,
    });
  }

  // Hierarchy: master should be larger than secondary
  let hierarchyScore = 1;
  if (master && bedrooms.length > 1) {
    const secondaries = bedrooms.filter(b => b.id !== master.id);
    const masterArea = master.area;
    const maxSecondary = Math.max(...secondaries.map(s => s.area));
    if (masterArea >= maxSecondary) {
      hierarchyScore = 1;
      strengths.push('+ master larger than secondary');
    } else {
      hierarchyScore = 0.5;
      weaknesses.push('- master not larger than secondary - hierarchy weak');
    }
  }

  let masterEnsuiteScore: number | undefined;
  if (master) {
    const ensuite = floor.spaces.find(s => s.type === 'master-bathroom');
    if (ensuite) {
      masterEnsuiteScore = hasDirectAccess(master.id, ensuite.id, floor) ? 1 : 0.5;
    }
  }

  const avg = rooms.length > 0 ? rooms.reduce((sum, r) => sum + r.overall, 0) / rooms.length : 1;
  const score = Math.max(0, Math.min(1, avg * 0.8 + hierarchyScore * 0.2));

  return {
    score,
    rooms: rooms.sort((a, b) => b.overall - a.overall),
    masterEnsuiteScore,
    hierarchyScore,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
