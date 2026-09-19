/**
 * Stair geometry solver (Phase 4).
 *
 * Deterministic: given a StairConfig and a target stairwell rectangle,
 * compute the best-fitting Stair (straight, U, or L) with flights and
 * landings. The solver never uses randomness.
 *
 * Algorithm:
 *   1. Compute totalRisers = ceil(floorHeight / maxRiserHeight)
 *      then riserHeight = floorHeight / totalRisers (uniform).
 *   2. Choose tread depth using the Blondel-style 2h+b rule clamped to
 *      [minTreadDepth, 0.32] so it stays within 0.63..0.64 m.
 *   3. Distribute risers across the minimum number of flights such that
 *      no flight exceeds maxRisersPerFlight.
 *   4. Try (in deterministic order) STRAIGHT → U_STAIR → L_STAIR and
 *      pick the first type whose computed footprint fits inside the
 *      available stair-hall rectangle AND satisfies circulation.
 *   5. If none fit, return a failure result with attempted dimensions.
 */
import type { Rect } from '../geometry/rect.js';
import { rArea } from '../geometry/rect.js';
import { V, type Vec2 } from '../geometry/vec2.js';
import { EPS } from '../units.js';
import {
  DEFAULT_STAIR_CONFIG,
  type Stair,
  type StairConfig,
  type StairFlight,
  type StairLanding,
  type StairType,
} from '../model/stairs.js';

export interface StairSolveResult {
  ok: boolean;
  stair?: Stair;
  /** Attempted configurations with reason for failure, deterministic. */
  attempts: Array<{
    type: StairType;
    requiredW: number;
    requiredH: number;
    availableW: number;
    availableH: number;
    reason: string;
  }>;
}

/** Distribute `total` risers across flights with each flight ≤ maxPerFlight
 *  and every flight ≥ 2 risers (degenerate 1-riser flights are rejected).
 *  Returns the flight riser counts in order, balanced as evenly as possible. */
export function distributeRisers(total: number, maxPerFlight: number): number[] {
  if (total <= 0) return [];
  const flights = Math.max(1, Math.ceil(total / maxPerFlight));
  const base = Math.floor(total / flights);
  const rem = total - base * flights;
  const out: number[] = [];
  for (let i = 0; i < flights; i++) {
    // Distribute the remainder one-by-one to EARLIER flights so the bottom
    // flight is never the shortest (more ergonomic ascent).
    out.push(base + (i < rem ? 1 : 0));
  }
  return out;
}

/** Pick a tread depth that satisfies Blondel's 2h+b ∈ [0.63, 0.64] while
 *  honoring minTreadDepth and a 0.32 m upper bound for V1. */
export function chooseTreadDepth(riser: number, minTread: number): number {
  // Target 2h+b = 0.635 (middle of the permitted band)
  const ideal = 0.635 - 2 * riser;
  const t = Math.max(minTread, Math.min(0.32, ideal));
  return Math.round(t * 1000) / 1000; // mm rounding
}

/** Plan footprint required for each stair type, given flights and landing. */
export function requiredFootprint(
  type: StairType,
  riserCounts: number[],
  tread: number,
  width: number,
  landingDepth: number,
): { w: number; h: number } {
  // Run length of each flight = (risers-1)*tread
  const runs = riserCounts.map(n => Math.max(0, n - 1) * tread);
  const landingD = Math.max(landingDepth, width * 0.9); // landing ≥ ~stair width
  switch (type) {
    case 'straight': {
      const totalRun = runs.reduce((a, b) => a + b, 0) + landingD * (riserCounts.length - 1);
      return { w: width + 0.20, h: totalRun + 0.30 };
    }
    case 'u-stair': {
      // Two flights running parallel opposite directions; landing between.
      // Width of well ≈ 2*flightW + wall/handrail gap (0.10).
      // Length = longest run + landing depth (the two flights are stacked
      // side by side in plan; the run length is one flight length).
      const longestRun = Math.max(...runs, 0);
      return {
        w: 2 * width + 0.20,
        h: longestRun + landingD + 0.30,
      };
    }
    case 'l-stair': {
      // Two perpendicular flights sharing a quarter-turn landing.
      // Width = first flight run + landingDepth, Height = flight width +
      // second flight run (or vice versa). Pick the longer flight along
      // the long axis.
      const r1 = runs[0] ?? 0;
      const r2 = runs[1] ?? 0;
      return {
        w: width + r2 + landingD * 0.0 /*landing is in the corner*/ + 0.20,
        h: width + r1 + landingD + 0.30,
      };
    }
  }
}

/** Solve and place a stair inside `availableRect`. The stair is aligned
 *  against the top (north) wall of the available rect so it can connect to
 *  the corridor on the corridor side. `corridorSide` tells which side of
 *  the available rectangle the corridor is on; flights are oriented so the
 *  bottom riser faces the corridor entry. */
export function solveStair(
  availableRect: Rect,
  config: StairConfig = DEFAULT_STAIR_CONFIG,
  corridorSide: 'north' | 'south' | 'east' | 'west' = 'south',
  coreId = 'core-main',
  floorLevel = 0,
): StairSolveResult {
  const attempts: StairSolveResult['attempts'] = [];
  const floorHeight = config.floorHeight;
  // 1. Riser count.
  const totalRisers = Math.max(3, Math.ceil(floorHeight / config.maxRiserHeight));
  const riserHeight = floorHeight / totalRisers;
  if (riserHeight > config.maxRiserHeight + EPS) {
    return {
      ok: false, attempts: [],
    };
  }
  const tread = chooseTreadDepth(riserHeight, config.minTreadDepth);
  const width = Math.max(config.minWidth, Math.min(availableRect.w, availableRect.h) * 0.45);
  // Minimum landing depth = flight width but not less than 1.0 m.
  const landingDepth = Math.max(config.minLandingDepth, Math.min(width, 1.4));

  // Try stair types in deterministic preference order.
  const types: StairType[] = ['straight', 'u-stair', 'l-stair'];
  for (const type of types) {
    for (let flightsN = (type === 'straight' ? 1 : 2); flightsN <= (type === 'straight' ? 4 : 2); flightsN++) {
      if (type === 'straight' && flightsN > 2) break; // multi-flight straight = just U-shape in V1
      const counts = distributeRisersForFlights(totalRisers, flightsN, config.maxRisersPerFlight);
      if (!counts) continue;
      const req = requiredFootprint(type, counts, tread, width, landingDepth);
      // Check fit: allow rotation (swap w/h) for long-and-narrow wells.
      const fitsNormally = req.w <= availableRect.w + EPS && req.h <= availableRect.h + EPS;
      const fitsRotated = req.h <= availableRect.w + EPS && req.w <= availableRect.h + EPS;
      if (!fitsNormally && !fitsRotated) {
        attempts.push({
          type, requiredW: req.w, requiredH: req.h,
          availableW: availableRect.w, availableH: availableRect.h,
          reason: `Required footprint ${req.w.toFixed(2)}×${req.h.toFixed(2)} m does not fit available ${availableRect.w.toFixed(2)}×${availableRect.h.toFixed(2)} m.`,
        });
        continue;
      }
      const rotated = !fitsNormally && fitsRotated;
      const stair = buildStairGeometry(
        type, counts, riserHeight, tread, width, landingDepth,
        availableRect, rotated, corridorSide, coreId, floorLevel,
      );
      if (stair) {
        return { ok: true, stair, attempts };
      }
      attempts.push({
        type, requiredW: req.w, requiredH: req.h,
        availableW: availableRect.w, availableH: availableRect.h,
        reason: 'Geometry construction failed (internal).',
      });
    }
  }

  return { ok: false, attempts };
}

/** Try to split totalRisers into exactly n flights with every flight
 *  between 2 and maxPerFlight. Returns null if impossible. */
function distributeRisersForFlights(total: number, n: number, maxPer: number): number[] | null {
  if (n < 1) return null;
  if (total < n * 2) return null; // need at least 2 per flight
  if (total > n * maxPer) return null;
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  if (out.some(x => x > maxPer || x < 2)) return null;
  return out;
}

/** Build concrete Stair geometry inside the available rect. Returns null
 *  if the geometric placement degenerates (e.g. zero area). */
function buildStairGeometry(
  type: StairType,
  counts: number[],
  riser: number,
  tread: number,
  width: number,
  landingDepth: number,
  avail: Rect,
  rotated: boolean,
  corridorSide: 'north' | 'south' | 'east' | 'west',
  coreId: string,
  level: number,
): Stair | null {
  // In V1 all stair wells are placed in the stair-hall rectangle, with the
  // first flight starting NEAR the corridor side (where the access door
  // is). If the corridor is on the SOUTH of the stair hall, flights start
  // at the south edge and go NORTH up to the landing/upper floor.
  //
  // For U-stair: bottom flight goes up along the WEST side of the well
  // from corridor-side to the far end landing, then turns back down the
  // EAST side (opposite direction).
  // For L-stair: bottom flight goes along the corridor-direction axis,
  // lands at the corner landing, then turns 90° along the other axis.
  const flights: StairFlight[] = [];
  const landings: StairLanding[] = [];
  const explanation: string[] = [];

  // Align well to the corridor side: e.g. if corridor is south (placer puts
  // corridor north of the public band and the stair pocket is in the NW
  // private-band corner), the bottom of the stair (first riser) faces the
  // corridor. Our placer always reserves the stair pocket at the west end
  // of the private band with corridor to its SOUTH (the horizontal corridor
  // runs above the public band and the stair pocket is north of it in the
  // private band — see carveZones in placer.ts). Wait: in placer, private
  // band is NORTH of corridor (cy + CORRIDOR_W), so corridor is SOUTH of
  // stair-hall. Stair goes up traveling NORTH. We'll generalize:
  const upDir: 'north' | 'south' | 'east' | 'west' = (() => {
    // Start at corridor edge, go into the well toward the opposite side.
    switch (corridorSide) {
      case 'south': return 'north';
      case 'north': return 'south';
      case 'west': return 'east';
      case 'east': return 'west';
    }
  })();

  // Well rectangle: centered in available rect with computed size.
  const req = requiredFootprint(type, counts, tread, width, landingDepth);
  const wellW = rotated ? req.h : req.w;
  const wellH = rotated ? req.w : req.h;
  // Place well against the corridor side of availableRect.
  let wellX = avail.x;
  let wellY = avail.y;
  switch (corridorSide) {
    // CAD/plan convention: y grows NORTH.  South edge of a rect = rect.y,
    // north edge = rect.y + rect.h.  Place the well's edge flush against
    // the corridor side of avail.
    case 'south': wellY = avail.y; break;               // well south edge at avail south
    case 'north': wellY = avail.y + avail.h - wellH; break; // well north edge at avail north
    case 'west':  wellX = avail.x; break;               // well west edge at avail west
    case 'east':  wellX = avail.x + avail.w - wellW; break; // well east edge at avail east
  }
  // Clamp inside available.
  wellX = Math.max(avail.x, Math.min(avail.x + avail.w - wellW, wellX));
  wellY = Math.max(avail.y, Math.min(avail.y + avail.h - wellH, wellY));
  const well: Rect = { x: wellX, y: wellY, w: wellW, h: wellH };
  if (well.w < EPS || well.h < EPS) return null;

  const fid = (i: number) => `stair-${coreId}-${level}-f${i}`;
  const lid = (i: number) => `stair-${coreId}-${level}-l${i}`;

  if (type === 'straight') {
    // One (or more) straight flights stacked in the same direction with
    // landings between. In V1 straight >1 flight is unusual (would be a
    // straight stair with intermediate landing), but we support it.
    let cursor = edgeOf(well, corridorSide); // distance along travel axis from corridor edge
    const perpCenter = perpendicularCenter(well, upDir);
    for (let i = 0; i < counts.length; i++) {
      const n = counts[i];
      const tcount = n - 1;
      const run = tcount * tread;
      const { start, end } = alongRun(upDir, cursor, perpCenter, width, run, well);
      const fp = flightBox(start, end, width, upDir);
      // v1.0.1 (AGX-01): a flight must stay inside the well — a rotated well
      // (run axis swapped) cannot host along-Y straight runs; reject instead
      // of emitting geometry that overflows the stairwell.
      if (fp.x < well.x - EPS || fp.y < well.y - EPS ||
          fp.x + fp.w > well.x + well.w + EPS || fp.y + fp.h > well.y + well.h + EPS) {
        return null;
      }
      flights.push({
        id: fid(i), direction: upDir,
        riserCount: n, treadCount: tcount,
        riserHeight: riser, treadDepth: tread, width,
        runLength: run,
        startPoint: start, endPoint: end,
        footprint: fp,
        treadLines: buildTreadLines(start, end, upDir, tread, tcount),
      });
      cursor += run;
      if (i < counts.length - 1) {
        const landingRec = landingBoxAt(end, width, landingDepth, upDir, well);
        if (!landingRec) return null;
        landings.push({
          id: lid(i), footprint: landingRec, width, depth: landingDepth,
          connectedFlightIds: [fid(i), fid(i + 1)],
        });
        cursor += landingDepth;
      }
    }
    explanation.push(`Straight stair: ${counts.join('+')} risers, direction ${upDir}.`);
  } else if (type === 'u-stair') {
    // Two flights, opposite plan directions, side-by-side, sharing a landing
    // at the far end of the well (opposite the corridor entry).
    //
    //  ┌────────────────────────┐ (north: far from corridor)
    //  │        landing         │
    //  ├──────────┬─────────────┤
    //  │ flight 1 │ flight 2    │
    //  │  (west)  │  (east)     │
    //  │  ↑ N     │  ↓ S        │  both flights climb vertically
    //  └──────────┴─────────────┘ (south: corridor access at bottom)
    //
    // Enter at south edge of flight 1 → climb north up flight 1 to landing
    // → turn 180° → climb south down flight 2 → exit at south edge of
    // flight 2 onto upper-floor corridor.
    if (counts.length !== 2) return null;
    const gap = 0.10; // handrail/stringer gap between flights
    const n1 = counts[0], n2 = counts[1];
    // v1.0.1 (AGX-01): flights run the EXACT nominal run (treads × tread) so the
    // actual going never shrinks below the configured minimum merely to fit the
    // hall. The remaining well depth is given to the landing (a deeper landing
    // is code-legal — only landing MINIMA are regulated), so flights still
    // terminate exactly at the landing edge and start exactly at the corridor
    // edge. If the nominal run cannot fit the well, this configuration is
    // rejected (return null) and solveStair tries the next one deterministically.
    const maxTreads = Math.max(n1 - 1, n2 - 1, 1);
    const nominalRun = maxTreads * tread;
    if (!rotated) {
      // Run axis = Y (north), flights side-by-side along X.
      const halfW = (well.w - gap) / 2;
      const flightW = Math.min(width, halfW);
      if (nominalRun + landingDepth > well.h + EPS) return null; // going would have to shrink
      const flightH = nominalRun;
      // Landing at FAR end (opposite corridor = north); it absorbs the leftover depth.
      const landH = well.h - flightH;
      const landingSouthY = well.y + flightH;
      const landRect: Rect = { x: well.x, y: landingSouthY, w: well.w, h: landH };
      const f1Rect: Rect = { x: well.x, y: well.y, w: flightW, h: flightH };
      const f2Rect: Rect = { x: well.x + well.w - flightW, y: well.y, w: flightW, h: flightH };
      const f1 = makeFlight(fid(0), n1, riser, tread, flightW, 'north', f1Rect, true);
      const f2 = makeFlight(fid(1), n2, riser, tread, flightW, 'south', f2Rect, true);
      flights.push(f1, f2);
      landings.push({
        id: lid(0), footprint: landRect, width: well.w, depth: landH,
        connectedFlightIds: [f1.id, f2.id],
      });
      explanation.push(`U-stair: ${n1}+${n2} risers, parallel flights with central gap ${gap.toFixed(2)} m, landing ${landH.toFixed(2)} m deep.`);
    } else {
      // v1.0.1 (AGX-01): ROTATED well — the run axis is X (the well was swapped
      // to fit the hall), so flights must run east/west, side-by-side along Y.
      // The previous code still built flights along Y, squeezing the actual
      // going far below the tread minimum. Landing sits at the far X end
      // (east by default; west when the corridor is on the west side).
      const halfH = (well.h - gap) / 2;
      const flightW = Math.min(width, halfH);
      if (nominalRun + landingDepth > well.w + EPS) return null; // going would have to shrink
      const flightLen = nominalRun;
      const landingEast = corridorSide !== 'west';
      const landW = well.w - flightLen;
      const landRect: Rect = landingEast
        ? { x: well.x + flightLen, y: well.y, w: landW, h: well.h }
        : { x: well.x, y: well.y, w: landW, h: well.h };
      // f1 (south flight) climbs toward the landing; f2 (north flight) returns.
      const f1Dir: 'east' | 'west' = landingEast ? 'east' : 'west';
      const f2Dir: 'east' | 'west' = landingEast ? 'west' : 'east';
      const f1Rect: Rect = { x: landingEast ? well.x : well.x + landW, y: well.y, w: flightLen, h: flightW };
      const f2Rect: Rect = { x: landingEast ? well.x : well.x + landW, y: well.y + well.h - flightW, w: flightLen, h: flightW };
      const f1 = makeFlight(fid(0), n1, riser, tread, flightW, f1Dir, f1Rect, true);
      const f2 = makeFlight(fid(1), n2, riser, tread, flightW, f2Dir, f2Rect, true);
      flights.push(f1, f2);
      landings.push({
        id: lid(0), footprint: landRect, width: well.h, depth: landW,
        connectedFlightIds: [f1.id, f2.id],
      });
      explanation.push(`U-stair (rotated well): ${n1}+${n2} risers, parallel flights with central gap ${gap.toFixed(2)} m, landing ${landW.toFixed(2)} m deep.`);
    }
  } else {
    // L-stair: two perpendicular flights. Place flight 1 going upDir from
    // corridor into the well, a quarter-turn landing in the corner, flight
    // 2 going perpendicular (turn left when going up).
    if (counts.length !== 2) return null;
    const n1 = counts[0], n2 = counts[1];
    const run1 = (n1 - 1) * tread;
    const run2 = (n2 - 1) * tread;
    const dir2 = turnLeft(upDir);
    // Corner coordinates.
    // Flight 1 starts at corridor edge, goes upDir for run1 to landing.
    // Landing is a square of width × landingDepth at the corner.
    // Flight 2 starts from the landing and goes dir2.
    // Place flight 1 against the dir2-ward side of the well (so flight 2
    // continues along the opposite wall).
    let f1Rect: Rect, f2Rect: Rect, landRect: Rect;
    const margin = 0.10;
    if (upDir === 'north') {
      // flight 1 along west wall going north, landing in NW corner,
      // flight 2 going east along the top.
      const f1x = well.x + margin;
      const f1y = well.y; // south = corridor side
      const landW = width; // eastward
      const landH = landingDepth;
      const landY = well.y + well.h - landH - run2;
      f1Rect = { x: f1x, y: f1y, w: width, h: run1 };
      landRect = { x: f1x, y: f1y + run1, w: landW, h: landH };
      // flight 2 runs east along top
      f2Rect = { x: landRect.x + landRect.w, y: landRect.y, w: run2, h: width };
      // Ensure fits
      if (f2Rect.x + f2Rect.w > well.x + well.w - margin + EPS) return null;
      if (landRect.y + landRect.h > well.y + well.h - margin + EPS) return null;
    } else if (upDir === 'south') {
      const f1x = well.x + margin;
      const f1y = well.y + well.h - width;
      f1Rect = { x: f1x, y: f1y - run1, w: width, h: run1 };
      landRect = { x: f1x, y: f1y - landingDepth, w: width, h: landingDepth };
      f2Rect = { x: landRect.x + width, y: landRect.y, w: run2, h: width };
    } else if (upDir === 'east') {
      const f1x = well.x;
      const f1y = well.y + margin;
      f1Rect = { x: f1x, y: f1y, w: run1, h: width };
      landRect = { x: f1x + run1, y: f1y, w: landingDepth, h: width };
      f2Rect = { x: landRect.x, y: landRect.y + width, w: landingDepth, h: run2 };
      f2Rect.w = width; f2Rect.h = run2;
    } else {
      const f1x = well.x + well.w - width;
      const f1y = well.y + margin;
      f1Rect = { x: f1x - run1, y: f1y, w: run1, h: width };
      landRect = { x: f1x - landingDepth, y: f1y, w: landingDepth, h: width };
      f2Rect = { x: landRect.x, y: landRect.y + width, w: width, h: run2 };
    }
    flights.push(makeFlight(fid(0), n1, riser, tread, width, upDir, f1Rect, true));
    flights.push(makeFlight(fid(1), n2, riser, tread, width, dir2, f2Rect, false));
    landings.push({
      id: lid(0), footprint: landRect, width, depth: landingDepth,
      connectedFlightIds: [flights[0].id, flights[1].id],
    });
    explanation.push(`L-stair: ${n1}+${n2} risers; flight 1 ${upDir}, flight 2 ${dir2}.`);
  }

  const startPoint = flights[0].startPoint;
  const endPoint = flights[flights.length - 1].endPoint;

  const totalRisers = counts.reduce((a, b) => a + b, 0);
  explanation.push(`Total rise ${(riser*totalRisers).toFixed(2)} m, ${totalRisers} risers @ ${(riser*100).toFixed(1)} cm, tread ${(tread*100).toFixed(0)} cm.`);

  const stair: Stair = {
    id: `stair-${coreId}-${level}`,
    type, coreId,
    totalRise: +(riser * totalRisers).toFixed(4),
    totalRisers,
    riserHeight: riser, treadDepth: tread, width,
    flights, landings, footprint: well,
    startPoint, endPoint,
    floor: level,
    explanation,
    valid: true,
    // Legacy aliases
    rect: well,
    flightWidth: width,
    riser: riser,
    tread,
    riserCount: totalRisers,
    floorHeight: riser * totalRisers,
  };
  void rArea; // sanity import for tree shaking
  // v1.0.1 (AGX-01) safety invariant: never return a stair whose ACTUAL flight
  // going is below the configured minimum (tread ≥ minTreadDepth by
  // chooseTreadDepth). If any construction path squeezed the going, reject the
  // whole configuration — solveStair then tries the next one deterministically.
  for (const fl of flights) {
    if (!(fl.treadDepth >= tread - 1e-9)) return null;
    if (!(fl.riserHeight > 0) || !(fl.runLength > 0)) return null;
  }
  return stair;
}

/** Build a flight from an axis-aligned rectangle. If `startAtMin` is true
 *  the start point is on the min axis edge; otherwise the max edge. */
function makeFlight(
  id: string, n: number, riser: number, tread: number, width: number,
  dir: 'north'|'south'|'east'|'west', rect: Rect, startAtMin: boolean,
): StairFlight {
  const tcount = n - 1;
  // Size of the run extent in the travel direction:
  const extent = (dir === 'north' || dir === 'south') ? rect.h : rect.w;
  // When the caller sizes rect to exactly reach the landing (h = flightH)
  // we stretch run to fill the extent so endPoint lands flush with the
  // landing; when the caller passes a generic rect (L-stair/straight leg)
  // we honour the requested tread. We stretch only if nominal tread
  // under-shoots by less than 0.20 m (i.e. within a reasonable margin).
  const nominalRun = tcount * tread;
  const run = (extent > nominalRun && extent - nominalRun < 0.20) ? extent : Math.min(nominalRun, extent);
  const usedTread = run / Math.max(1, tcount);
  let start: Vec2, end: Vec2;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  switch (dir) {
    case 'north':
      start = { x: cx, y: startAtMin ? rect.y : rect.y + rect.h };
      end   = { x: cx, y: startAtMin ? rect.y + run : rect.y + rect.h - run };
      break;
    case 'south':
      start = { x: cx, y: startAtMin ? rect.y + rect.h : rect.y };
      end   = { x: cx, y: startAtMin ? rect.y + rect.h - run : rect.y + run };
      break;
    case 'east':
      start = { x: startAtMin ? rect.x : rect.x + rect.w, y: cy };
      end   = { x: startAtMin ? rect.x + run : rect.x + rect.w - run, y: cy };
      break;
    case 'west':
    default:
      start = { x: startAtMin ? rect.x + rect.w : rect.x, y: cy };
      end   = { x: startAtMin ? rect.x + rect.w - run : rect.x + run, y: cy };
      break;
  }
  return {
    id, direction: dir,
    riserCount: n, treadCount: tcount,
    riserHeight: riser, treadDepth: usedTread, width,
    runLength: run,
    startPoint: start, endPoint: end,
    footprint: rect,
    treadLines: buildTreadLines(start, end, dir, usedTread, tcount),
  };
}

/** Distance along travel direction (0..run) for each tread's riser face.
 *  Tread 0 is at 1*tread from start (nosings line). We return positions
 *  along the centerline. */
function buildTreadLines(
  start: Vec2, end: Vec2, dir: 'north'|'south'|'east'|'west',
  tread: number, tcount: number,
): number[] {
  void start; void end; void dir;
  const out: number[] = [];
  for (let i = 1; i <= tcount; i++) out.push(+(i * tread).toFixed(4));
  return out;
}

function alongRun(
  dir: 'north'|'south'|'east'|'west',
  offsetAlong: number,
  perpCenter: number,
  width: number, run: number, well: Rect,
): { start: Vec2; end: Vec2 } {
  // v1.0.1 (stair-geometry hardening): honour `offsetAlong` — the absolute
  // coordinate along the travel axis where this flight starts (the caller
  // advances it past each flight and landing). The previous implementation
  // ignored it, so every flight of a multi-flight straight stair was built
  // at the corridor edge, exactly overlapping the previous flight.
  void width; void well;
  switch (dir) {
    case 'north':
      return {
        start: { x: perpCenter, y: offsetAlong },
        end:   { x: perpCenter, y: offsetAlong + run },
      };
    case 'south':
      return {
        start: { x: perpCenter, y: offsetAlong },
        end:   { x: perpCenter, y: offsetAlong - run },
      };
    case 'east':
      return {
        start: { x: offsetAlong, y: perpCenter },
        end:   { x: offsetAlong + run, y: perpCenter },
      };
    case 'west':
    default:
      return {
        start: { x: offsetAlong, y: perpCenter },
        end:   { x: offsetAlong - run, y: perpCenter },
      };
  }
}

function flightBox(start: Vec2, end: Vec2, width: number, dir: 'north'|'south'|'east'|'west'): Rect {
  const hw = width / 2;
  switch (dir) {
    case 'north':
    case 'south': {
      const x = start.x - hw, y = Math.min(start.y, end.y);
      return { x, y, w: width, h: Math.abs(end.y - start.y) };
    }
    case 'east':
    case 'west':
    default: {
      const y = start.y - hw, x = Math.min(start.x, end.x);
      return { x, y, w: Math.abs(end.x - start.x), h: width };
    }
  }
}

function landingBoxAt(
  end: Vec2, width: number, depth: number,
  dir: 'north'|'south'|'east'|'west', well: Rect,
): Rect | null {
  const hw = width / 2;
  let r: Rect;
  switch (dir) {
    case 'north': r = { x: end.x - hw, y: end.y, w: width, h: depth }; break;
    case 'south': r = { x: end.x - hw, y: end.y - depth, w: width, h: depth }; break;
    case 'east':  r = { x: end.x, y: end.y - hw, w: depth, h: width }; break;
    case 'west':  r = { x: end.x - depth, y: end.y - hw, w: depth, h: width }; break;
  }
  if (r.x < well.x - EPS || r.y < well.y - EPS ||
      r.x + r.w > well.x + well.w + EPS ||
      r.y + r.h > well.y + well.h + EPS) return null;
  return r;
}

function edgeOf(well: Rect, side: 'north'|'south'|'east'|'west'): number {
  switch (side) {
    case 'south': return well.y;
    case 'north': return well.y + well.h;
    case 'west':  return well.x;
    case 'east':  return well.x + well.w;
  }
}

function perpendicularCenter(well: Rect, dir: 'north'|'south'|'east'|'west'): number {
  switch (dir) {
    case 'north':
    case 'south': return well.x + well.w / 2;
    case 'east':
    case 'west':  return well.y + well.h / 2;
  }
}

function opposite(d: 'north'|'south'|'east'|'west'): 'north'|'south'|'east'|'west' {
  return d === 'north' ? 'south' : d === 'south' ? 'north' : d === 'east' ? 'west' : 'east';
}
function turnLeft(d: 'north'|'south'|'east'|'west'): 'north'|'south'|'east'|'west' {
  // Turn left relative to direction of travel.
  return d === 'north' ? 'west' : d === 'south' ? 'east' : d === 'east' ? 'north' : 'south';
}

// Expose helpers for tests.
export const _util = { V, opposite, turnLeft, edgeOf, makeFlight };
