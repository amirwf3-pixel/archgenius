/**
 * Phase 8 - Kitchen Intelligence
 *
 * Evaluates refrigerator, sink, cooktop, counter sequence, working triangle, circulation, entrance, dining/living relationship, service functionality.
 * Reports NOT EVALUABLE when geometry insufficient.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { KitchenEvaluation } from './types.js';
import { buildAdjMap, shortestPath, hasDirectAccess } from './graph.js';

export function evaluateKitchen(floor: Floor): KitchenEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const kitchen = floor.spaces.find(s => s.type === 'kitchen');
  if (!kitchen) {
    return {
      score: null,
      hasRefrigerator: false,
      hasSink: false,
      hasCooktop: false,
      counterSequenceScore: 0,
      workingTriangleScore: 0,
      circulationScore: 0,
      entranceScore: 0,
      diningRelationshipScore: 0,
      livingRelationshipScore: 0,
      serviceScore: 0,
      isEvaluable: false,
      reason: 'No kitchen in floor — N/A — Not Evaluated',
      findings,
      strengths,
      weaknesses: ['N/A — Not Evaluated — No kitchen in floor'],
    };
  }

  const adjMap = buildAdjMap(floor);
  const furns = floor.furniture.filter(f => f.spaceId === kitchen.id);
  const hasCounter = furns.some(f => f.type.includes('kitchen-counter'));

  // In our minimal furniture model, we don't have explicit fridge/sink/cooktop, but counter implies them
  const hasRefrigerator = hasCounter; // heuristic
  const hasSink = hasCounter;
  const hasCooktop = hasCounter;

  let isEvaluable = true;
  let reason: string | undefined;

  if (!hasCounter) {
    isEvaluable = false;
    reason = 'Kitchen geometry exists but no counter furniture placed — N/A — Not Evaluated — insufficient data for detailed kitchen evaluation';
    return {
      score: null,
      hasRefrigerator: false,
      hasSink: false,
      hasCooktop: false,
      counterSequenceScore: 0,
      workingTriangleScore: 0,
      circulationScore: 0,
      entranceScore: 0,
      diningRelationshipScore: 0,
      livingRelationshipScore: 0,
      serviceScore: 0,
      isEvaluable,
      reason,
      findings,
      strengths,
      weaknesses: ['N/A — Not Evaluated — no counter'],
    };
  }

  // Counter sequence: L-shaped is good
  const counter = furns.find(f => f.type.includes('kitchen-counter'))!;
  const counterSequenceScore = counter.type === 'kitchen-counter-l' ? 1 : 0.7;
  if (counterSequenceScore === 1) strengths.push('+ kitchen L-shaped counter - good sequence');
  else weaknesses.push('- kitchen single counter - limited sequence');

  // Working triangle / working zone: fridge-sink-cooktop should be within 1.2-2.7m each, perimeter 3.6-6.6m (classical)
  // Since we don't have explicit positions, we approximate by kitchen dimensions: if kitchen min side >=2.15 (verified threshold) and area >=5.5, triangle feasible
  const minSide = Math.min(kitchen.rect.w, kitchen.rect.h);
  const area = kitchen.area;
  let workingTriangleScore = 0.8;
  if (minSide >= 2.15 && area >= 5.5) {
    workingTriangleScore = 0.9;
    strengths.push(`+ kitchen dimensions ${minSide.toFixed(2)}m min, ${area.toFixed(1)}m² - working zone feasible`);
  } else {
    workingTriangleScore = 0.5;
    weaknesses.push(`- kitchen tight ${minSide.toFixed(2)}m × ${area.toFixed(1)}m² - working triangle constrained`);
  }

  // Circulation: should have clearance front 1.0m
  const circulationScore = counter.clearanceFront && counter.clearanceFront >= 1.0 ? 1 : 0.6;
  if (circulationScore === 1) strengths.push('+ kitchen circulation good');
  else weaknesses.push('- kitchen circulation tight');

  // Entrance: kitchen should not be directly from entrance, should be via dining or corridor
  const entrance = floor.spaces.find(s => s.type === 'entrance');
  let entranceScore = 1;
  if (entrance && hasDirectAccess(entrance.id, kitchen.id, floor)) {
    entranceScore = 0.3;
    weaknesses.push('- kitchen directly opens to entrance - service exposure');
    findings.push({ code: 'SERVICE_EXPOSURE', severity: 'soft', message: 'Kitchen opens to entrance', entityIds: [kitchen.id, entrance.id] } as Finding);
  } else {
    strengths.push('+ kitchen not directly exposed to entrance');
  }

  // Dining relationship
  const dining = floor.spaces.find(s => s.type === 'dining');
  let diningRelationshipScore = 0.5;
  if (dining) {
    if (hasDirectAccess(kitchen.id, dining.id, floor)) {
      diningRelationshipScore = 1;
      strengths.push('+ kitchen <-> dining direct access - efficient service');
    } else {
      const dist = shortestPath(kitchen.id, dining.id, adjMap);
      if (dist <= 2) {
        diningRelationshipScore = 0.8;
        strengths.push(`+ kitchen near dining (${dist} steps)`);
      } else {
        diningRelationshipScore = 0.4;
        weaknesses.push(`- kitchen far from dining (${dist} steps)`);
      }
    }
  }

  // Living relationship
  const living = floor.spaces.find(s => s.type === 'living');
  let livingRelationshipScore = 0.6;
  if (living) {
    const dist = shortestPath(kitchen.id, living.id, adjMap);
    if (dist <= 2) {
      livingRelationshipScore = 0.8;
      strengths.push(`+ kitchen near living (${dist} steps) - family interaction`);
    } else if (dist > 3) {
      livingRelationshipScore = 0.4;
      weaknesses.push(`- kitchen far from living (${dist} steps)`);
    }
  }

  // Service functionality: near storage?
  const storage = floor.spaces.find(s => s.type === 'storage');
  let serviceScore = 0.6;
  if (storage && hasDirectAccess(kitchen.id, storage.id, floor)) {
    serviceScore = 1;
    strengths.push('+ kitchen <-> storage direct - good service');
  } else if (storage) {
    const dist = shortestPath(kitchen.id, storage.id, adjMap);
    if (dist <= 2) serviceScore = 0.8;
  } else {
    serviceScore = 0.7; // no storage requested
  }

  const score = Math.max(0, Math.min(1,
    counterSequenceScore * 0.2 +
    workingTriangleScore * 0.25 +
    circulationScore * 0.15 +
    entranceScore * 0.1 +
    diningRelationshipScore * 0.15 +
    livingRelationshipScore * 0.05 +
    serviceScore * 0.1
  ));

  return {
    score,
    hasRefrigerator,
    hasSink,
    hasCooktop,
    counterSequenceScore,
    workingTriangleScore,
    circulationScore,
    entranceScore,
    diningRelationshipScore,
    livingRelationshipScore,
    serviceScore,
    isEvaluable,
    reason,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
