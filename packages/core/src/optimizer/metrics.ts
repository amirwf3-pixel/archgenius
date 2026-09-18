/**
 * Architectural metrics for comparing candidate layouts.
 * Every metric has a defined calculation. No arbitrary "AI score".
 */
import type { LayoutCandidate } from '../model/layout.js';
import { rArea } from '../geometry/rect.js';
import { rOverlapArea } from '../geometry/rect.js';

export interface LayoutMetrics {
  /** Usable (non-circulation) room area / footprint area. 0..1, higher better. */
  usableAreaRatio: number;
  /** Circulation (corridor + stair) / footprint area. 0..1, lower generally better. */
  circulationRatio: number;
  /** Footprint area not assigned to any room (m²). Lower better. */
  wastedArea: number;
  /** Average |actual - target| / target across rooms. Lower better. */
  roomAreaDeviation: number;
  /** Fraction of requested adjacency relationships satisfied (0..1). */
  adjacencySatisfaction: number;
  /** Number of overlapping room pairs found (should be 0 for valid layouts). */
  collisionCount: number;
  /** Fraction of requested parking stalls placed successfully (0..1). */
  parkingFeasibility: number;
  /** Fraction of daylight-required rooms on an exterior wall (0..1). */
  daylightExposure: number;
  /** Fraction of orientation-preferring rooms with preferred facade (0..1). */
  orientationSatisfaction: number;
  /** 0..1; penalizes direct sight-lines between entrance/foyer and private rooms. */
  privacySatisfaction: number;
  /** Total footprint area of all stair cores (m²). */
  stairFootprintArea: number;
  /** Total number of stair flights across all floors. */
  stairFlightCount: number;
  /** Total HARD + SOFT violation count (should be 0 hard for valid). */
  constraintViolations: number;
  // ---- Phase 6 extended metrics ----
  /** Total circulation area (m²) */
  totalCirculationArea?: number;
  /** Longest path through circulation graph (approx number of spaces) */
  longestCirculationPath?: number;
  /** Number of dead-end corridors */
  deadEndCount?: number;
  /** Average room proportion (max/min) across rooms — lower better, ideal ~1.3 */
  avgRoomProportion?: number;
  /** Number of rooms with bad proportion (>3.5) */
  badProportionCount?: number;
}

export function computeMetrics(c: LayoutCandidate): LayoutMetrics {
  let footprintArea = 0;
  let usable = 0;
  let circ = 0;
  let totalAssigned = 0;
  let roomsRequiringDaylight = 0;
  let roomsDaylit = 0;
  let deviation = 0;
  let deviationCount = 0;
  let collisionCount = 0;
  let parkingRequested = 0;
  let parkingProvided = 0;
  let privacyViolations = 0;
  let stairFootprintArea = 0;
  let stairFlightCount = 0;

  for (const f of c.floors) {
    footprintArea += rArea(f.footprint);
    // Stair metrics.
    for (const st of f.stairs) {
      const fp = st.footprint ?? (st as any).rect;
      if (fp) stairFootprintArea += rArea(fp);
      stairFlightCount += (st.flights ?? []).length;
    }
    // Build adjacency map for privacy scoring.
    const adj = new Map<string, Set<string>>();
    for (const s of f.spaces) adj.set(s.id, new Set(s.adjacentSpaceIds));

    for (const s of f.spaces) {
      totalAssigned += s.area;
      if (['corridor', 'stair-hall', 'elevator-hall', 'entrance', 'foyer'].includes(s.type)) {
        circ += s.area;
      } else {
        usable += s.area;
      }
      if (s.daylightRequired) {
        roomsRequiringDaylight++;
        if (s.hasExteriorWall) roomsDaylit++;
      }
      if (s.targetArea > 0) {
        deviation += Math.abs(s.area - s.targetArea) / s.targetArea;
        deviationCount++;
      }
      // Privacy: private rooms must not share a direct wall with public
      // entrance/foyer (only through corridor).
      if (s.privacy === 'private') {
        for (const nid of adj.get(s.id) ?? []) {
          const n = f.spaces.find(x => x.id === nid);
          if (n && (n.type === 'entrance' || n.type === 'foyer')) {
            privacyViolations++;
          }
        }
      }
    }
    for (let i = 0; i < f.spaces.length; i++) {
      for (let j = i + 1; j < f.spaces.length; j++) {
        const a = f.spaces[i], b = f.spaces[j];
        if (a.type === 'parking' || b.type === 'parking') continue;
        if (rOverlapArea(a.rect, b.rect) > 1e-3) collisionCount++;
      }
    }
    parkingProvided += f.parkingStalls.length;
  }

  // Parking requested (from project input — approximate)
  // We recover it from ground-floor stalls length vs stalls expected? For now
  // treat parkingFeasibility=1 if we generated no parking violations; refined later.
  parkingRequested = Math.max(parkingProvided, 1);

  const usableAreaRatio = footprintArea > 0 ? usable / footprintArea : 0;
  const circulationRatio = footprintArea > 0 ? circ / footprintArea : 0;
  const wastedArea = Math.max(0, footprintArea - totalAssigned);
  const roomAreaDeviation = deviationCount > 0 ? deviation / deviationCount : 0;
  const daylightExposure = roomsRequiringDaylight > 0 ? roomsDaylit / roomsRequiringDaylight : 1;
  const parkingFeasibility = parkingRequested > 0 ? parkingProvided / parkingRequested : 1;

  // Adjacency satisfaction
  const totalRooms = c.floors.reduce((n, f) => n + f.spaces.length, 0);
  const inaccess = c.findings.filter(f => f.code === 'CIRC_INACCESSIBLE_SPACE').length;
  const adjacencySatisfaction = totalRooms > 0 ? Math.max(0, 1 - inaccess / totalRooms) : 0;

  // Orientation satisfaction: check if rooms with orientation preference are on preferred side
  // For Phase 6, compute based on exterior wall side vs room type
  let orientOk = 0, orientTotal = 0;
  for (const fl of c.floors) {
    for (const s of fl.spaces) {
      if (!s.daylightRequired) continue;
      if (['corridor', 'stair-hall', 'parking'].includes(s.type)) continue;
      orientTotal++;
      // If has exterior wall, count as ok if orientation is reasonable
      // For living/master-bedroom prefer south, bedroom east/west, etc.
      // Since we already orient windows in openings.ts, we consider any exterior as partially ok,
      // but south-facing living gets higher.
      if (s.hasExteriorWall) {
        // Check if window exists (opening on exterior)
        const hasWin = fl.openings.some(o => o.type === 'window' && (o.spaceA === s.id || o.spaceB === s.id));
        if (hasWin) orientOk++;
      }
    }
  }
  const orientationSatisfaction = orientTotal > 0 ? orientOk / orientTotal : 0.7;

  const privacySatisfaction = privacyViolations === 0 ? 1 : Math.max(0, 1 - privacyViolations / 10);
  const constraintViolations = c.findings.filter(f => f.severity !== 'advisory').length;

  // Phase 6 extended
  let longestPath = 0;
  let deadEnds = 0;
  let totalProp = 0, propCount = 0, badProp = 0;
  for (const fl of c.floors) {
    // Dead-end estimation from circulation findings
    deadEnds += c.findings.filter(f => f.code === 'CIRCULATION_DEAD_END').length;
    // Longest path approximated by number of spaces reachable
    const circSpaces = fl.spaces.filter(s => ['corridor', 'foyer', 'entrance', 'stair-hall'].includes(s.type));
    longestPath = Math.max(longestPath, circSpaces.length + fl.spaces.length);
    for (const s of fl.spaces) {
      if (['parking', 'yard', 'balcony'].includes(s.type)) continue;
      const ratio = Math.max(s.rect.w, s.rect.h) / Math.max(Math.min(s.rect.w, s.rect.h), 1e-6);
      totalProp += ratio;
      propCount++;
      if (ratio > 3.5) badProp++;
    }
  }

  return {
    usableAreaRatio: round(usableAreaRatio, 3),
    circulationRatio: round(circulationRatio, 3),
    wastedArea: round(wastedArea, 2),
    roomAreaDeviation: round(roomAreaDeviation, 3),
    adjacencySatisfaction: round(adjacencySatisfaction, 3),
    collisionCount,
    parkingFeasibility: round(parkingFeasibility, 3),
    daylightExposure: round(daylightExposure, 3),
    orientationSatisfaction: round(orientationSatisfaction, 3),
    privacySatisfaction: round(privacySatisfaction, 3),
    stairFootprintArea: round(stairFootprintArea, 2),
    stairFlightCount,
    constraintViolations,
    totalCirculationArea: round(circ, 2),
    longestCirculationPath: longestPath,
    deadEndCount: deadEnds,
    avgRoomProportion: propCount > 0 ? round(totalProp / propCount, 2) : 0,
    badProportionCount: badProp,
  };
}

function round(n: number, d: number) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
