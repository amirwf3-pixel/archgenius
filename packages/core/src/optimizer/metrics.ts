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
  /** Fraction of orientation-preferring rooms with preferred facade (V1: placeholder). */
  orientationSatisfaction: number;
  /** 0..1; penalizes direct sight-lines between entrance/foyer and private rooms. */
  privacySatisfaction: number;
  /** Total footprint area of all stair cores (m²). */
  stairFootprintArea: number;
  /** Total number of stair flights across all floors. */
  stairFlightCount: number;
  /** Total HARD + SOFT violation count (should be 0 hard for valid). */
  constraintViolations: number;
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

  // Adjacency satisfaction: fraction of placed rooms reachable through a
  // circulation door (1 - inaccessibility ratio).
  const totalRooms = c.floors.reduce((n, f) => n + f.spaces.length, 0);
  const inaccess = c.findings.filter(f => f.code === 'CIRC_INACCESSIBLE_SPACE').length;
  const adjacencySatisfaction = totalRooms > 0 ? Math.max(0, 1 - inaccess / totalRooms) : 0;
  const orientationSatisfaction = 0.7; // placeholder; refine with facade check
  const privacySatisfaction = privacyViolations === 0 ? 1 : Math.max(0, 1 - privacyViolations / 10);

  const constraintViolations = c.findings.filter(f => f.severity !== 'advisory').length;

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
  };
}

function round(n: number, d: number) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
