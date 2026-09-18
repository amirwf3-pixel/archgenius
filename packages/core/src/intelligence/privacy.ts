/**
 * Phase 8 - Privacy Intelligence
 *
 * Evaluates entrance->bedroom, living->bedroom, living->bathroom, guest WC, bedroom cluster, master separation, public/private transition.
 * Produces metrics, findings, explainable reasons.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { PrivacyEvaluation } from './types.js';
import { buildAdjMap, shortestPath, hasDirectAccess as hasDirectDoor } from './graph.js';

export function evaluatePrivacy(floor: Floor): PrivacyEvaluation {
  const adjMap = buildAdjMap(floor);
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const entrance = floor.spaces.find(s => s.type === 'entrance' || s.type === 'foyer');
  const living = floor.spaces.find(s => s.type === 'living');
  const bedrooms = floor.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom');
  const bathrooms = floor.spaces.filter(s => s.type === 'bathroom' || s.type === 'master-bathroom' || s.type === 'guest-wc');
  const guestWC = floor.spaces.find(s => s.type === 'guest-wc');
  const master = floor.spaces.find(s => s.type === 'master-bedroom');

  let entranceToBedroomExposure = 0;
  let entranceToPrivateZone = 0;
  let livingToBedroom = 0;
  let livingToBathroomExposure = 0;
  let guestWCLocationScore = 1;
  let bedroomClusterScore = 1;
  let masterSeparationScore = 1;
  let publicPrivateTransitionScore = 1;

  // Entrance -> bedroom exposure
  if (entrance) {
    for (const bed of bedrooms) {
      if (hasDirectDoor(entrance.id, bed.id, floor)) {
        entranceToBedroomExposure += 1;
        findings.push({ code: 'PRIVACY_WEAK', severity: 'soft', message: `Bedroom ${bed.label} directly opens to ${entrance.label}`, entityIds: [bed.id, entrance.id] } as Finding);
        weaknesses.push(`- bedroom ${bed.label} directly exposed to entrance`);
      } else {
        const dist = shortestPath(entrance.id, bed.id, adjMap);
        if (dist >= 2) {
          strengths.push(`+ bedroom ${bed.label} separated from entrance (${dist} steps)`);
        } else if (dist === 1) {
          // Adjacent but not direct door - still weak
          entranceToBedroomExposure += 0.5;
          weaknesses.push(`- bedroom ${bed.label} adjacent to entrance zone`);
        }
      }
    }
    entranceToBedroomExposure = Math.min(1, entranceToBedroomExposure / Math.max(bedrooms.length, 1));
    entranceToPrivateZone = entranceToBedroomExposure; // same for now
  }

  // Living -> bedroom
  if (living) {
    for (const bed of bedrooms) {
      if (hasDirectDoor(living.id, bed.id, floor)) {
        livingToBedroom += 0.7;
        weaknesses.push(`- bedroom ${bed.label} directly opens to living`);
        findings.push({ code: 'PRIVACY_WEAK', severity: 'soft', message: `Bedroom ${bed.label} opens to living`, entityIds: [bed.id, living.id] } as Finding);
      }
    }
    livingToBedroom = Math.min(1, livingToBedroom);
    if (livingToBedroom === 0) strengths.push('+ bedrooms separated from living');
  }

  // Living -> bathroom exposure
  if (living) {
    for (const bath of bathrooms) {
      if (hasDirectDoor(living.id, bath.id, floor)) {
        livingToBathroomExposure += 1;
        findings.push({ code: 'SERVICE_EXPOSURE', severity: 'soft', message: `Service ${bath.label} opens to living`, entityIds: [bath.id, living.id] } as Finding);
        weaknesses.push(`- ${bath.label} directly opens to living - exposure`);
      }
    }
    livingToBathroomExposure = Math.min(1, livingToBathroomExposure / Math.max(bathrooms.length, 1));
    if (livingToBathroomExposure === 0) strengths.push('+ no bathroom exposure to living');
  }

  // Guest WC location: should be near entrance/public, not deep private
  if (guestWC && entrance) {
    const dist = shortestPath(entrance.id, guestWC.id, adjMap);
    if (dist <= 2) {
      guestWCLocationScore = 1;
      strengths.push(`+ guest WC near entrance (${dist} steps)`);
    } else {
      guestWCLocationScore = Math.max(0, 1 - (dist - 2) * 0.2);
      weaknesses.push(`- guest WC deep in private zone (${dist} steps)`);
    }
  }

  // Bedroom cluster: bedrooms should be near each other (same zone)
  if (bedrooms.length >= 2) {
    let clustered = 0;
    for (let i = 0; i < bedrooms.length; i++) {
      for (let j = i + 1; j < bedrooms.length; j++) {
        if (bedrooms[i].zone === bedrooms[j].zone) clustered++;
        const d = shortestPath(bedrooms[i].id, bedrooms[j].id, adjMap);
        if (d <= 2) clustered++;
      }
    }
    const maxPairs = (bedrooms.length * (bedrooms.length - 1)) / 2 * 2;
    bedroomClusterScore = maxPairs > 0 ? Math.min(1, clustered / maxPairs) : 1;
    if (bedroomClusterScore > 0.7) strengths.push('+ bedroom cluster well grouped');
    else weaknesses.push('- bedrooms scattered');
  }

  // Master separation: master should be somewhat separated from secondary bedrooms
  if (master && bedrooms.length > 1) {
    const secondaries = bedrooms.filter(b => b.id !== master.id);
    let sep = 0;
    for (const sec of secondaries) {
      const d = shortestPath(master.id, sec.id, adjMap);
      if (d >= 2) sep++;
    }
    masterSeparationScore = secondaries.length > 0 ? sep / secondaries.length : 1;
    if (masterSeparationScore > 0.5) strengths.push('+ master bedroom separated from secondary');
  }

  // Public/private transition: should go through foyer/corridor
  const publicPrivateDirect = floor.openings.filter(o => {
    if (o.type === 'window') return false;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) return false;
    const a = floor.spaces.find(s => s.id === wall.spaceIds[0]);
    const b = floor.spaces.find(s => s.id === wall.spaceIds[1]);
    if (!a || !b) return false;
    const isPublic = (s: any) => s.privacy === 'public';
    const isPrivate = (s: any) => s.privacy === 'private';
    return (isPublic(a) && isPrivate(b)) || (isPublic(b) && isPrivate(a));
  }).length;
  publicPrivateTransitionScore = publicPrivateDirect === 0 ? 1 : Math.max(0, 1 - publicPrivateDirect * 0.3);
  if (publicPrivateTransitionScore === 1) strengths.push('+ strong public/private separation');
  else weaknesses.push(`- ${publicPrivateDirect} direct public->private doors - weak transition`);

  const score = Math.max(0, Math.min(1,
    1
    - entranceToBedroomExposure * 0.3
    - livingToBedroom * 0.2
    - livingToBathroomExposure * 0.2
    - (1 - guestWCLocationScore) * 0.1
    - (1 - bedroomClusterScore) * 0.05
    - (1 - masterSeparationScore) * 0.05
    - (1 - publicPrivateTransitionScore) * 0.1
  ));

  return {
    score,
    entranceToBedroomExposure,
    entranceToPrivateZone,
    livingToBedroom,
    livingToBedroomExposure: livingToBedroom,
    livingToBathroomExposure,
    guestWCLocationScore,
    bedroomClusterScore,
    masterSeparationScore,
    publicPrivateTransitionScore,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
