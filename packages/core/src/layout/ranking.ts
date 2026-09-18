/**
 * Deterministic candidate ranking — Phase 6 Professional.
 *
 * Ranking is lexicographic by tier (lower tier wins; within a tier lower is
 * better). Tiers are listed below from highest-priority to lowest:
 *
 *   1. HARD feasibility (geometric + circulation + regulation hards + ROOM_UNUSABLE)
 *   2. Geometric validity (soft geometry issues: GEO_, OPENING_, ROOM_TOO_NARROW, BAD_PROPORTION)
 *   3. Required adjacency satisfaction (MUST_BE_ADJACENT / DIRECT_ACCESS)
 *   4. Accessibility / circulation graph score (CIRC_*, dead-ends, excessive residual)
 *   5. Room target deviation (area + dimension)
 *   6. Usable area ratio / circulation ratio (efficiency) + bad proportion count
 *   7. Soft preferences (orientation, daylight, privacy, service exposure)
 *
 * Formula:
 *   hardCount = count of severity=hard
 *   geoSoft = GEO_/OPENING_/ROOM_TOO_NARROW/ROOM_BAD_PROPORTION soft count
 *   hardAdj = ARCH_ADJACENCY_VIOLATION hard count
 *   circulationFailures = CIRC_* + CIRCULATION_DEAD_END + EXCESSIVE_RESIDUAL soft count
 *   roomAreaDeviation = metrics.roomAreaDeviation
 *   wastedArea = metrics.wastedArea
 *   circulationRatio = metrics.circulationRatio
 *   softPreferencePenalty = (1-adj)*10 + (1-daylight)*5 + (1-orient)*3 + (1-privacy)*4 + badProp*0.5 + deadEnds*1 + serviceExposure*2
 *
 * No arbitrary "AI score" is produced. A candidate with any HARD finding
 * will rank strictly below any candidate with zero HARD findings.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

export interface RankingVector {
  hardCount: number;
  geoSoftCount: number;
  hardAdjacencyFailures: number;
  circulationFailures: number;
  roomAreaDeviation: number;
  wastedArea: number;
  circulationRatio: number;
  softPreferencePenalty: number;
}

export function rankVector(c: LayoutCandidate): RankingVector {
  let hard = 0, geoSoft = 0, circFail = 0;
  let serviceExposure = 0, privacyWeak = 0, doorColl = 0, windowColl = 0;
  for (const f of c.findings) {
    if (f.severity === 'hard') hard++;
    else if (f.severity === 'soft') {
      if (f.code.startsWith('GEO_') || f.code.startsWith('OPENING_') || f.code === 'ROOM_TOO_NARROW' || f.code === 'ROOM_BAD_PROPORTION' || f.code === 'ROOM_UNUSABLE') geoSoft++;
      else if (f.code.startsWith('CIRC_') || f.code === 'CIRCULATION_DEAD_END' || f.code === 'CIRCULATION_EXCESSIVE' || f.code === 'EXCESSIVE_RESIDUAL') circFail++;
      if (f.code === 'SERVICE_EXPOSURE') serviceExposure++;
      if (f.code === 'PRIVACY_WEAK') privacyWeak++;
      if (f.code === 'DOOR_COLLISION' || f.code === 'DOOR_SWING_CONFLICT') doorColl++;
      if (f.code === 'WINDOW_COLLISION' || f.code === 'WINDOW_OUTSIDE') windowColl++;
    }
  }
  const hardAdj = c.findings.filter(f => f.severity === 'hard' && f.code === 'ARCH_ADJACENCY_VIOLATION').length;
  const badProp = c.metrics.badProportionCount ?? 0;
  const deadEnds = c.metrics.deadEndCount ?? c.findings.filter(f => f.code === 'CIRCULATION_DEAD_END').length;
  return {
    hardCount: hard,
    geoSoftCount: geoSoft,
    hardAdjacencyFailures: hardAdj,
    circulationFailures: circFail,
    roomAreaDeviation: c.metrics.roomAreaDeviation,
    wastedArea: c.metrics.wastedArea,
    circulationRatio: c.metrics.circulationRatio,
    softPreferencePenalty:
      (1 - c.metrics.adjacencySatisfaction) * 10 +
      (1 - c.metrics.daylightExposure) * 5 +
      (1 - c.metrics.orientationSatisfaction) * 3 +
      (1 - c.metrics.privacySatisfaction) * 4 +
      badProp * 0.5 +
      deadEnds * 1 +
      serviceExposure * 2 +
      privacyWeak * 1.5 +
      doorColl * 1 +
      windowColl * 1,
  };
}

/** Returns negative if a ranks better than b, positive otherwise. Deterministic. */
export function compareCandidates(a: LayoutCandidate, b: LayoutCandidate): number {
  const va = rankVector(a), vb = rankVector(b);
  // Tier 1: hard count
  if (va.hardCount !== vb.hardCount) return va.hardCount - vb.hardCount;
  // Tier 2: geo soft
  if (va.geoSoftCount !== vb.geoSoftCount) return va.geoSoftCount - vb.geoSoftCount;
  // Tier 3: hard adjacency
  if (va.hardAdjacencyFailures !== vb.hardAdjacencyFailures) return va.hardAdjacencyFailures - vb.hardAdjacencyFailures;
  // Tier 4: circulation
  if (va.circulationFailures !== vb.circulationFailures) return va.circulationFailures - vb.circulationFailures;
  // Tier 5: area deviation
  if (Math.abs(va.roomAreaDeviation - vb.roomAreaDeviation) > 1e-6) return va.roomAreaDeviation - vb.roomAreaDeviation;
  // Tier 6: wasted + circulation
  if (Math.abs(va.wastedArea - vb.wastedArea) > 1e-6) return va.wastedArea - vb.wastedArea;
  if (Math.abs(va.circulationRatio - vb.circulationRatio) > 1e-6) return va.circulationRatio - vb.circulationRatio;
  // Tier 7: soft preferences
  if (Math.abs(va.softPreferencePenalty - vb.softPreferencePenalty) > 1e-6)
    return va.softPreferencePenalty - vb.softPreferencePenalty;
  // Deterministic tie-breaker by id
  return a.id.localeCompare(b.id);
}

/** Sort candidates in place from best to worst. */
export function sortCandidates(candidates: LayoutCandidate[]): LayoutCandidate[] {
  return candidates.sort(compareCandidates);
}
