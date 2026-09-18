/**
 * Phase 8 - Entrance & Service Intelligence
 *
 * Evaluates entrance transition exterior->entrance->public, direct bedroom/WC exposure, circulation efficiency, foyer; service circulation, bathroom exposure, crossing public zones, service access efficiency.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { EntranceServiceEvaluation } from './types.js';
import { buildAdjMap, shortestPath, hasDirectAccess } from './graph.js';

export function evaluateEntranceService(floor: Floor): EntranceServiceEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const adjMap = buildAdjMap(floor);

  const entrance = floor.spaces.find(s => s.type === 'entrance');
  const foyer = floor.spaces.find(s => s.type === 'foyer');
  const living = floor.spaces.find(s => s.type === 'living');
  const bedrooms = floor.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom');
  const guestWC = floor.spaces.find(s => s.type === 'guest-wc');
  const kitchen = floor.spaces.find(s => s.type === 'kitchen');
  const bathrooms = floor.spaces.filter(s => s.type === 'bathroom' || s.type === 'master-bathroom');

  // Entrance transition: exterior -> entrance -> foyer -> living
  let entranceTransitionScore = 0;
  if (entrance && foyer && living) {
    const eToF = hasDirectAccess(entrance.id, foyer.id, floor) ? 1 : 0;
    const fToL = hasDirectAccess(foyer.id, living.id, floor) ? 1 : 0;
    entranceTransitionScore = (eToF + fToL) / 2;
    if (entranceTransitionScore === 1) strengths.push('+ entrance -> foyer -> living transition clear');
    else weaknesses.push('- entrance transition incomplete');
  } else if (entrance && living) {
    entranceTransitionScore = hasDirectAccess(entrance.id, living.id, floor) ? 0.7 : 0.3;
    if (entranceTransitionScore < 0.5) weaknesses.push('- entrance directly to living without foyer buffer');
    else strengths.push('+ entrance to living accessible');
  } else {
    entranceTransitionScore = 0.5;
  }

  // Direct bedroom exposure from entrance
  let directBedroomExposureScore = 1;
  if (entrance) {
    let exposed = 0;
    for (const bed of bedrooms) {
      if (hasDirectAccess(entrance.id, bed.id, floor)) exposed++;
    }
    directBedroomExposureScore = exposed === 0 ? 1 : Math.max(0, 1 - exposed * 0.5);
    if (directBedroomExposureScore === 1) strengths.push('+ no bedroom directly exposed to entrance');
    else {
      weaknesses.push(`- ${exposed} bedroom(s) directly exposed to entrance`);
      findings.push({ code: 'PRIVACY_WEAK', severity: 'soft', message: `${exposed} bedroom(s) exposed to entrance`, entityIds: [] } as Finding);
    }
  }

  // Direct WC exposure: guest WC should not directly open to living/dining?
  let directWCExposureScore = 1;
  if (guestWC && living) {
    if (hasDirectAccess(guestWC.id, living.id, floor)) {
      directWCExposureScore = 0.4;
      weaknesses.push('- guest WC directly opens to living - exposure');
      findings.push({ code: 'SERVICE_EXPOSURE', severity: 'soft', message: 'Guest WC opens to living', entityIds: [guestWC.id, living.id] } as Finding);
    } else {
      directWCExposureScore = 1;
      strengths.push('+ guest WC not directly exposed to living');
    }
  }

  // Circulation efficiency: entrance -> living should be short, entrance -> private should be longer but not excessive
  let circulationEfficiencyScore = 1;
  if (entrance && living) {
    const dist = shortestPath(entrance.id, living.id, adjMap);
    if (dist <= 2) circulationEfficiencyScore = 1;
    else if (dist === 3) circulationEfficiencyScore = 0.7;
    else circulationEfficiencyScore = 0.4;
  }

  // Foyer score: does foyer exist and have adequate area?
  let foyerScore = 0.5;
  if (foyer) {
    foyerScore = foyer.area >= 4 ? 1 : foyer.area >= 2 ? 0.7 : 0.4;
    if (foyerScore === 1) strengths.push(`+ foyer adequate ${foyer.area.toFixed(1)} m²`);
    else weaknesses.push(`- foyer small ${foyer.area.toFixed(1)} m²`);
  } else {
    foyerScore = 0.3;
    weaknesses.push('- no foyer - entrance transition weak');
  }

  // Service circulation: kitchen/service should not cross public unnecessarily
  let serviceCirculationScore = 1;
  if (kitchen && entrance) {
    if (hasDirectAccess(kitchen.id, entrance.id, floor)) {
      serviceCirculationScore = 0.4;
      weaknesses.push('- kitchen opens to entrance - service crossing public');
    }
  }

  // Bathroom exposure
  let bathroomExposureScore = 1;
  if (living) {
    let exposed = 0;
    for (const bath of bathrooms) {
      if (hasDirectAccess(bath.id, living.id, floor)) exposed++;
    }
    bathroomExposureScore = exposed === 0 ? 1 : Math.max(0, 1 - exposed * 0.4);
    if (bathroomExposureScore < 1) weaknesses.push(`- ${exposed} bathroom(s) open to living`);
  }

  // Public crossing: service access should not go through living?
  let publicCrossingScore = 1;
  // Simplified: if kitchen path to entrance goes through living, penalize
  if (kitchen && entrance && living) {
    const kitchenToEntrancePath = (() => {
      // BFS to find if living is on path
      const visited = new Map<string, string | null>();
      visited.set(kitchen.id, null);
      const queue = [kitchen.id];
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur === entrance.id) {
          // reconstruct
          let node: string | null = entrance.id;
          const path: string[] = [];
          while (node) {
            path.unshift(node);
            node = visited.get(node) ?? null;
          }
          return path;
        }
        for (const nid of adjMap.get(cur) ?? []) {
          if (!visited.has(nid)) {
            visited.set(nid, cur);
            queue.push(nid);
          }
        }
      }
      return [];
    })();
    if (kitchenToEntrancePath.includes(living.id)) {
      publicCrossingScore = 0.5;
      weaknesses.push('- kitchen service route crosses living');
    } else {
      publicCrossingScore = 1;
      strengths.push('+ kitchen service does not cross living');
    }
  }

  // Service access efficiency: kitchen near dining
  let serviceAccessEfficiencyScore = 0.6;
  if (kitchen) {
    const dining = floor.spaces.find(s => s.type === 'dining');
    if (dining && hasDirectAccess(kitchen.id, dining.id, floor)) {
      serviceAccessEfficiencyScore = 1;
      strengths.push('+ kitchen <-> dining service efficient');
    } else if (dining) {
      const dist = shortestPath(kitchen.id, dining.id, adjMap);
      serviceAccessEfficiencyScore = dist <= 2 ? 0.8 : 0.4;
    }
  }

  const score = Math.max(0, Math.min(1,
    entranceTransitionScore * 0.2 +
    directBedroomExposureScore * 0.15 +
    directWCExposureScore * 0.1 +
    circulationEfficiencyScore * 0.15 +
    foyerScore * 0.1 +
    serviceCirculationScore * 0.1 +
    bathroomExposureScore * 0.1 +
    publicCrossingScore * 0.05 +
    serviceAccessEfficiencyScore * 0.05
  ));

  return {
    score,
    entranceTransitionScore,
    directBedroomExposureScore,
    directWCExposureScore,
    circulationEfficiencyScore,
    foyerScore,
    serviceCirculationScore,
    bathroomExposureScore,
    publicCrossingScore,
    serviceAccessEfficiencyScore,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
