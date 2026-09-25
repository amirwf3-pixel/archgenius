/**
 * Phase 9 — Vertical Circulation Intelligence
 *
 * Deterministic whole-building vertical circulation analysis.
 * Evaluates stair existence, continuity, floor-to-floor connectivity, alignment, accessibility path, disconnected floors.
 * Heuristic labeled HEURISTIC, separate from verified regulation checks.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { VerticalCirculationEvaluation } from './types.js';
import { rOverlapArea } from '../geometry/rect.js';

function hasStair(floor: Floor): boolean {
  return floor.stairs.length > 0 && floor.stairs.some(s => (s as any).valid !== false);
}

export function stairFootprintOverlap(a: Floor, b: Floor): number {
  // Compute overlap area of stair footprints between floors
  if (a.stairs.length === 0 || b.stairs.length === 0) return 0;
  let maxOverlap = 0;
  for (const sa of a.stairs) {
    const ra = (sa as any).footprint ?? (sa as any).rect;
    if (!ra) continue;
    for (const sb of b.stairs) {
      const rb = (sb as any).footprint ?? (sb as any).rect;
      if (!rb) continue;
      const overlap = rOverlapArea(ra, rb);
      const areaA = ra.w * ra.h;
      const areaB = rb.w * rb.h;
      const minArea = Math.min(areaA, areaB);
      if (minArea > 0) {
        const ratio = overlap / minArea;
        if (ratio > maxOverlap) maxOverlap = ratio;
      }
    }
  }
  return maxOverlap; // 0..1
}

export function evaluateVerticalCirculation(candidate: LayoutCandidate): VerticalCirculationEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const floors = [...candidate.floors].sort((a, b) => a.level - b.level);
  const floorCount = floors.length;

  const floorConnectivity: VerticalCirculationEvaluation['floorConnectivity'] = [];
  const disconnectedFloors: number[] = [];
  let connectedPairs = 0;
  let totalPairs = 0;
  let continuitySum = 0;
  let alignmentSum = 0;

  // Check each floor for stair existence
  for (const fl of floors) {
    if (floorCount > 1 && !hasStair(fl)) {
      disconnectedFloors.push(fl.level);
      findings.push({
        code: 'VERT_CIRC_MISSING_STAIR',
        severity: 'soft',
        message: `Floor ${fl.level} missing stair where required for ${floorCount}-floor building — vertical access compromised (HEURISTIC)`,
        entityIds: [fl.level.toString()],
      } as Finding);
      weaknesses.push(`- Floor ${fl.level} missing stair — disconnected`);
    }
  }

  // Check consecutive floor connectivity
  for (let i = 0; i < floors.length - 1; i++) {
    const from = floors[i];
    const to = floors[i + 1];
    totalPairs++;
    const fromHasStair = hasStair(from);
    const toHasStair = hasStair(to);
    const connected = fromHasStair && toHasStair;
    const overlap = stairFootprintOverlap(from, to);
    const viaStair = connected;
    let reason = '';
    if (!fromHasStair) reason = `Floor ${from.level} missing stair`;
    else if (!toHasStair) reason = `Floor ${to.level} missing stair`;
    else {
      reason = `Stair continuity ${from.level}→${to.level} overlap ${(overlap * 100).toFixed(0)}% — ${overlap >= 0.5 ? 'aligned' : 'misaligned'}`;
      continuitySum += connected ? 1 : 0;
      alignmentSum += overlap;
      if (overlap >= 0.5) {
        strengths.push(`+ stair alignment ${from.level}→${to.level} ${(overlap * 100).toFixed(0)}%`);
      } else {
        weaknesses.push(`- stair misalignment ${from.level}→${to.level} ${(overlap * 100).toFixed(0)}%`);
        findings.push({
          code: 'VERT_CIRC_MISALIGNED',
          severity: 'advisory',
          message: `Stair footprint misalignment between floor ${from.level} and ${to.level} — overlap ${(overlap * 100).toFixed(0)}% (HEURISTIC)`,
          entityIds: [],
        } as Finding);
      }
    }
    if (connected) connectedPairs++;
    floorConnectivity.push({
      fromLevel: from.level,
      toLevel: to.level,
      connected,
      viaStair,
      reason,
    });
  }

  // Vertical access path from ground
  const verticalAccessPath: number[] = [];
  if (floors.length > 0) {
    verticalAccessPath.push(floors[0].level);
    for (let i = 0; i < floors.length - 1; i++) {
      const conn = floorConnectivity[i];
      if (conn.connected) {
        verticalAccessPath.push(conn.toLevel);
      } else {
        break; // disconnected chain
      }
    }
  }

  const isConnected = disconnectedFloors.length === 0 && connectedPairs === totalPairs;

  if (isConnected) {
    strengths.push(`+ all ${floorCount} floors vertically connected via stairs`);
  } else {
    weaknesses.push(`- ${disconnectedFloors.length} floor(s) disconnected, ${totalPairs - connectedPairs}/${totalPairs} pairs disconnected`);
  }

  // Scores
  const connectivityScore = totalPairs > 0 ? connectedPairs / totalPairs : 1;
  const stairContinuityScore = totalPairs > 0 ? continuitySum / totalPairs : 1;
  const stairAlignmentScore = totalPairs > 0 ? alignmentSum / totalPairs : 1;

  // Check stair validity (flight consistency)
  let validStairRatio = 0;
  let totalStairChecks = 0;
  for (const fl of floors) {
    for (const st of fl.stairs) {
      totalStairChecks++;
      if ((st as any).valid !== false) validStairRatio++;
      else {
        findings.push({
          code: 'VERT_CIRC_INVALID_STAIR',
          severity: 'soft',
          message: `Invalid stair on floor ${fl.level} — ${(st as any).explanation?.[0] ?? 'invalid'} (HEURISTIC)`,
          entityIds: [],
        } as Finding);
        weaknesses.push(`- invalid stair on floor ${fl.level}`);
      }
    }
  }
  const stairValidityScore = totalStairChecks > 0 ? validStairRatio / totalStairChecks : (floorCount > 1 ? 0 : 1);

  // Gross vertical circulation penalties: if too many stairs or too large?
  // Simplified: if stairCount > floors*2, penalize slightly (inefficient)
  const stairCount = floors.reduce((sum, fl) => sum + fl.stairs.length, 0);
  let penalty = 0;
  if (stairCount > floorCount * 2) penalty = 0.1;

  const score = Math.max(0, Math.min(1,
    connectivityScore * 0.4 +
    stairContinuityScore * 0.2 +
    stairAlignmentScore * 0.2 +
    stairValidityScore * 0.2 -
    penalty
  ));

  if (score >= 0.8) strengths.push(`+ vertical circulation efficient ${(score * 100).toFixed(0)}%`);
  else if (score < 0.5) weaknesses.push(`- vertical circulation weak ${(score * 100).toFixed(0)}%`);

  return {
    score,
    isConnected,
    floorConnectivity,
    stairContinuityScore,
    stairAlignmentScore,
    verticalAccessPath,
    disconnectedFloors,
    stairCount,
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 8),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 8),
    isHeuristic: true,
  };
}
