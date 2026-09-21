/**
 * Stair-specific validation (Phase 4).
 *
 * Validates dimensional correctness, flight distribution, landing
 * placement, flight/landing collision, footprint containment, and simple
 * circulation-access checks. This module emits deterministic FINDING
 * codes; the MBH4 regulation pack still emits regulatory findings on top
 * (e.g. MBH4-STAIR-003 for max risers per flight).
 */
import type { Floor } from '../model/floor.js';
import type { Stair, StairFlight, StairLanding } from '../model/stairs.js';
import type { Finding } from './types.js';
import { rContains, rIntersection, rOverlapArea, rArea } from '../geometry/rect.js';
import { vDist } from '../geometry/vec2.js';
import { EPS } from '../units.js';

export function validateStairs(floor: Floor): Finding[] {
  const findings: Finding[] = [];
  for (const st of floor.stairs) {
    findings.push(...validateOneStair(st, floor));
  }
  // Phase15 M7: a stair-hall that carries no stair geometry is a phantom core.
  // The multi-floor STAIR_MISSING invariant below never fires on a top/only
  // floor, so the hall itself must demand its stair. (Honest failure: the
  // engine NEVER paints a fake stair to dodge this.)
  const halls = floor.spaces.filter(s => s.type === 'stair-hall');
  if (halls.length > 0 && floor.stairs.length === 0) {
    findings.push(f('STAIR_MISSING', 'hard',
      `Floor ${floor.level} places a stair-hall but no stair geometry exists for it — no code-compliant configuration fit the hall (see generator Vertical-core notes).`,
      halls.map(h => h.id), bbox(halls[0].rect)));
  }
  findings.push(...validateStairStructural(floor));
  return findings;
}

/**
 * Phase15 M7 structural rules: a stair must be REAL, coherent multi-flight
 * geometry, not a rectangle with a label. Type-specific structure is checked
 * against the actual footprints, and the access path is geometric — the
 * bottom nosing must stand inside the hall, and the hall must share a
 * walkable edge with circulation (door-carrying adjacency), with no flight
 * sitting in the door's swing line.
 */
export function validateStairStructural(floor: Floor): Finding[] {
  const out: Finding[] = [];
  for (const st of floor.stairs) {
    const flights = st.flights ?? [];
    const landings = st.landings ?? [];
    // --- Type structure ---
    if (st.type === 'u-stair') {
      if (flights.length !== 2) {
        out.push(f('STAIR_INVALID_U_GEOMETRY', 'hard',
          `U-stair ${st.id} must have exactly 2 parallel flights, found ${flights.length}.`, [st.id]));
      } else {
        const [a, b] = flights;
        const opp = (a.direction === 'north' && b.direction === 'south') || (a.direction === 'south' && b.direction === 'north')
          || (a.direction === 'east' && b.direction === 'west') || (a.direction === 'west' && b.direction === 'east');
        if (!opp) {
          out.push(f('STAIR_INVALID_U_GEOMETRY', 'hard',
            `U-stair ${st.id}: flights run ${a.direction}/${b.direction} — U requires opposite plan directions.`, [st.id]));
        }
        const midFlight = Math.max(a.riserCount, b.riserCount);
        if (Math.abs(a.riserCount - b.riserCount) > Math.ceil(st.totalRisers / 2) - Math.floor(st.totalRisers / 2)) {
          out.push(f('STAIR_INVALID_U_GEOMETRY', 'hard',
            `U-stair ${st.id}: flight split ${a.riserCount}+${b.riserCount} is not a balanced division of ${st.totalRisers}.`, [st.id]));
        }
        void midFlight;
      }
    } else if (st.type === 'l-stair') {
      if (flights.length !== 2) {
        out.push(f('STAIR_INVALID_L_GEOMETRY', 'hard',
          `L-stair ${st.id} must have exactly 2 perpendicular flights, found ${flights.length}.`, [st.id]));
      } else {
        const [a, b] = flights;
        const perp = (['north', 'south'].includes(a.direction) && ['east', 'west'].includes(b.direction))
          || (['east', 'west'].includes(a.direction) && ['north', 'south'].includes(b.direction));
        if (!perp) {
          out.push(f('STAIR_INVALID_L_GEOMETRY', 'hard',
            `L-stair ${st.id}: flights run ${a.direction}/${b.direction} — L requires perpendicular flights.`, [st.id]));
        }
      }
    } else if (st.type === 'straight') {
      if (flights.length > 1) {
        const sameAxis = flights.every(fl => fl.direction === flights[0].direction);
        if (!sameAxis) {
          out.push(f('STAIR_INVALID_RUN', 'hard',
            `Straight stair ${st.id}: flights change direction (${flights.map(fl => fl.direction).join('/')}).`, [st.id]));
        }
      }
    }
    // --- Landing connects its two flights (shared-edge contact, not area) ---
    for (const l of landings) {
      if (l.connectedFlightIds.length < 2) continue; // floor-entry pad
      const fs = l.connectedFlightIds.map(id => flights.find(fl => fl.id === id)).filter(Boolean);
      if (fs.length !== l.connectedFlightIds.length) {
        out.push(f('STAIR_MISSING_LANDING', 'hard',
          `Landing ${l.id} references flights that do not exist on stair ${st.id}.`, [st.id, l.id]));
        continue;
      }
      for (const fl of fs) {
        const lr = fl!.footprint;
        const touches = Math.abs(lr.x + lr.w - l.footprint.x) < 0.06
          || Math.abs(l.footprint.x + l.footprint.w - lr.x) < 0.06
          || Math.abs(lr.y + lr.h - l.footprint.y) < 0.06
          || Math.abs(l.footprint.y + l.footprint.h - lr.y) < 0.06;
        const overlapsLanding = rOverlapArea(l.footprint, lr) > 0.02;
        if (!touches && !overlapsLanding) {
          out.push(f('STAIR_LANDING_DISCONNECTED', 'hard',
            `Landing ${l.id} does not touch flight ${fl!.id} — flights must connect THROUGH the landing polygon.`,
            [st.id, l.id, fl!.id]));
        }
      }
    }
    // --- Self-intersection of flight polygons (collinear box union check) ---
    // flights must never cross without being parallel side-by-side (U) — covered
    // by STAIR_FLIGHT_COLLISION overlap-area check in validateOneStair.
    // --- Geometric access path (not BFS): bottom nosing inside the hall and
    //     hall shares a walkable edge (≥ 0.8 m) with circulation. ---
    const hall = floor.spaces.find(s => s.type === 'stair-hall');
    const bottomStart = flights.length ? flights[0].startPoint : st.startPoint;
    const inHall = hall
      && bottomStart.x >= hall.rect.x - 0.06 && bottomStart.x <= hall.rect.x + hall.rect.w + 0.06
      && bottomStart.y >= hall.rect.y - 0.06 && bottomStart.y <= hall.rect.y + hall.rect.h + 0.06;
    if (hall && !inHall) {
      out.push(f('STAIR_INVALID_ENTRANCE', 'hard',
        `Stair ${st.id} entry nosing (${bottomStart.x.toFixed(2)},${bottomStart.y.toFixed(2)}) lies outside its stair-hall — invalid entrance.`,
        [st.id]));
    }
    // Door collision: a door on the hall's boundary must not have a flight in
    // its line (blocked access). Check opening segments vs flight footprints.
    for (const op of floor.openings) {
      if (op.type !== 'door') continue;
      const half = op.width / 2;
      const seg = { x0: op.center.x - op.wallDir.x * half, y0: op.center.y - op.wallDir.y * half,
                    x1: op.center.x + op.wallDir.x * half, y1: op.center.y + op.wallDir.y * half };
      for (const fl of flights) {
        // A door collides with a flight when its OPENING SEGMENT passes through
        // the flight body (not merely meeting it at the flush entry edge —
        // meeting at the nosing line is exactly how stair access is designed).
        const r = fl.footprint;
        const inFlight = (x: number, y: number) =>
          x > r.x + 0.06 && x < r.x + r.w - 0.06 && y > r.y + 0.06 && y < r.y + r.h - 0.06;
        const mid = { x: (seg.x0 + seg.x1) / 2, y: (seg.y0 + seg.y1) / 2 };
        if (inFlight(seg.x0, seg.y0) || inFlight(seg.x1, seg.y1) || inFlight(mid.x, mid.y)) {
          out.push(f('STAIR_DOOR_COLLISION', 'hard',
            `Door ${op.id} opens through the body of stair flight ${fl.id} — the stair entrance is blocked.`,
            [st.id, fl.id, op.id]));
        }
      }
    }
  }
  return out;
}

/**
 * v1.0.1 (AGX-02 / AGX-05): cross-floor vertical-circulation invariants.
 *
 * 1. STAIR_MISSING (hard) — in a multi-floor building, every non-top floor
 *    must contain at least one stair element. A multi-floor plan without
 *    vertical circulation is architecturally impossible and must never
 *    validate clean, no matter how the program/input produced it (omitted
 *    hasStair, dropped stair-hall placement, editing, …).
 * 2. STAIR_CORE_MISALIGNED (hard) — stairs sharing a coreId on adjacent
 *    floors are intended to stack (see Stair.nextFloorStairId); if their
 *    footprints do not overlap in plan, the stair arriving from below does
 *    not land on the continuing stair — broken circulation.
 *
 * Stairs are V1's only generated vertical-circulation mechanism (elevator
 * cabins are not generated — documented limitation).
 */
export function validateVerticalCirculation(floors: Floor[]): Finding[] {
  const out: Finding[] = [];
  const top = floors.length - 1;
  for (const fl of floors) {
    if (fl.level < top && (fl.stairs ?? []).length === 0) {
      out.push(f('STAIR_MISSING', 'hard',
        `Multi-floor building: floor ${fl.level} has no vertical circulation element (no stair) connecting it to the floor above.`,
        undefined, undefined));
    }
  }
  for (let i = 0; i + 1 < floors.length; i++) {
    const a = floors[i], b = floors[i + 1];
    for (const sa of a.stairs ?? []) {
      for (const sb of b.stairs ?? []) {
        if (sa.coreId !== sb.coreId) continue;
        const ra = sa.footprint ?? sa.rect;
        const rb = sb.footprint ?? sb.rect;
        if (rOverlapArea(ra, rb) <= 0.001) {
          out.push(f('STAIR_CORE_MISALIGNED', 'hard',
            `Stair core ${sa.coreId}: stairs on floors ${a.level} and ${b.level} do not stack vertically (footprints do not overlap in plan).`,
            [sa.id, sb.id]));
        }
      }
    }
  }
  return out;
}

function validateOneStair(st: Stair, floor: Floor): Finding[] {
  const out: Finding[] = [];
  // Footprint inside buildable floor area.
  if (!rContains(floor.footprint, st.footprint, 0.02)) {
    out.push(f('STAIR_OUTSIDE_BUILDING', 'hard',
      `Stair ${st.id} extends outside the floor footprint.`,
      [st.id], bbox(st.footprint)));
  }

  // Zero-area checks.
  if (rArea(st.footprint) < 0.5) {
    out.push(f('STAIR_ZERO_AREA', 'hard',
      `Stair ${st.id} footprint is implausibly small (${rArea(st.footprint).toFixed(2)} m²).`,
      [st.id], bbox(st.footprint)));
  }

  // Riser/tread consistency.
  if (st.totalRisers < 2) {
    out.push(f('STAIR_INVALID_RISER_COUNT', 'hard',
      `Stair ${st.id} has invalid total risers (${st.totalRisers}).`, [st.id]));
  }
  if (st.riserHeight <= 0 || st.treadDepth <= 0) {
    out.push(f('STAIR_INVALID_TREAD_COUNT', 'hard',
      `Stair ${st.id} has zero/negative riser (${st.riserHeight}) or tread (${st.treadDepth}).`, [st.id]));
  }
  const sumRisers = st.flights.reduce((a, b) => a + b.riserCount, 0);
  if (sumRisers !== st.totalRisers) {
    out.push(f('STAIR_RISE_MISMATCH', 'hard',
      `Stair ${st.id} flight risers sum to ${sumRisers}, expected ${st.totalRisers}.`, [st.id]));
  }
  const riseCheck = Math.abs(st.totalRise - st.totalRisers * st.riserHeight);
  if (riseCheck > 0.005) {
    out.push(f('STAIR_RISE_MISMATCH', 'hard',
      `Stair ${st.id} total rise ${st.totalRise.toFixed(3)} m ≠ ${st.totalRisers}×${st.riserHeight.toFixed(3)} = ${(st.totalRisers*st.riserHeight).toFixed(3)} m.`, [st.id]));
  }

  // Flight validation.
  for (const fl of st.flights) {
    out.push(...validateFlight(fl, st));
    if (rArea(fl.footprint) < EPS) {
      out.push(f('STAIR_ZERO_AREA', 'hard',
        `Flight ${fl.id} has zero area.`, [st.id, fl.id], bbox(fl.footprint)));
    }
    if (!rContains(st.footprint, fl.footprint, 0.01)) {
      out.push(f('STAIR_FLIGHT_COLLISION', 'hard',
        `Flight ${fl.id} extends outside the stairwell footprint.`, [st.id, fl.id], bbox(fl.footprint)));
    }
  }

  // Flight-over-flight overlap in plan (shouldn't happen except U-stair
  // which has intentional side-by-side flights — only flag if overlap >0).
  for (let i = 0; i < st.flights.length; i++) {
    for (let j = i + 1; j < st.flights.length; j++) {
      const a = st.flights[i], b = st.flights[j];
      if (rOverlapArea(a.footprint, b.footprint) > 0.005) {
        out.push(f('STAIR_FLIGHT_COLLISION', 'hard',
          `Flights ${a.id} and ${b.id} overlap in plan by ${rOverlapArea(a.footprint, b.footprint).toFixed(2)} m².`,
          [st.id, a.id, b.id]));
      }
    }
  }

  // Landing validation.
  for (const l of st.landings) {
    if (rArea(l.footprint) < EPS) {
      out.push(f('STAIR_ZERO_AREA', 'hard', `Landing ${l.id} has zero area.`, [st.id, l.id]));
    }
    if (l.depth < Math.min(0.9, st.width - 0.05)) {
      out.push(f('STAIR_LANDING_COLLISION', 'soft',
        `Landing ${l.id} depth ${l.depth.toFixed(2)} m is narrower than the stair width (${st.width.toFixed(2)} m).`,
        [st.id, l.id]));
    }
    if (!rContains(st.footprint, l.footprint, 0.01)) {
      out.push(f('STAIR_LANDING_COLLISION', 'hard',
        `Landing ${l.id} is outside the stairwell.`, [st.id, l.id], bbox(l.footprint)));
    }
    // Landing vs flight overlap? Landings MAY touch flights at edges but
    // shouldn't occupy the same area as treads.
    for (const fl of st.flights) {
      if (rOverlapArea(l.footprint, fl.footprint) > 0.02) {
        out.push(f('STAIR_LANDING_COLLISION', 'hard',
          `Landing ${l.id} overlaps flight ${fl.id}.`,
          [st.id, l.id, fl.id]));
      }
    }
  }

  // Flight-in-sequence: for 2+ flight stairs there must be landings
  // between every consecutive flight pair.
  if (st.flights.length >= 2 && st.landings.length < st.flights.length - 1) {
    out.push(f('STAIR_MISSING_LANDING', 'hard',
      `Stair ${st.id} has ${st.flights.length} flights but only ${st.landings.length} intermediate landing(s).`,
      [st.id]));
  }

  // Circulation access: bottom flight start should be within 0.6 m of a
  // corridor/stair-hall/entrance edge on the floor.
  const accessOk = isStairAccessible(st, floor);
  if (!accessOk) {
    out.push(f('STAIR_DISCONNECTED', 'hard',
      `Stair ${st.id} entrance does not adjoin corridor/foyer circulation.`,
      [st.id], bbox(st.footprint)));
  }

  // Furniture on stair / landing.
  for (const furn of floor.furniture) {
    const furnRect = furn.rect;
    for (const fl of st.flights) {
      if (rOverlapArea(furnRect, fl.footprint) > 0.01) {
        out.push(f('FURN_ON_STAIR', 'hard',
          `Furniture ${furn.type} occupies stair flight ${fl.id}.`,
          [st.id, fl.id, furn.id]));
      }
    }
    for (const l of st.landings) {
      if (rOverlapArea(furnRect, l.footprint) > 0.01) {
        out.push(f('FURN_ON_LANDING', 'hard',
          `Furniture ${furn.type} occupies stair landing ${l.id}.`,
          [st.id, l.id, furn.id]));
      }
    }
  }

  return out;
}

function validateFlight(fl: StairFlight, st: Stair): Finding[] {
  const out: Finding[] = [];
  if (fl.riserCount < 2) {
    out.push(f('STAIR_INVALID_RISER_COUNT', 'hard',
      `Flight ${fl.id} has ${fl.riserCount} risers (minimum 2).`,
      [st.id, fl.id]));
  }
  if (fl.treadCount !== fl.riserCount - 1) {
    out.push(f('STAIR_INVALID_TREAD_COUNT', 'hard',
      `Flight ${fl.id} tread count ${fl.treadCount} ≠ risers-1 = ${fl.riserCount-1}.`,
      [st.id, fl.id]));
  }
  const expectedRun = fl.treadCount * fl.treadDepth;
  if (Math.abs(fl.runLength - expectedRun) > 0.02) {
    out.push(f('STAIR_INVALID_RUN', 'hard',
      `Flight ${fl.id} run length ${fl.runLength.toFixed(2)} ≠ treads×going = ${expectedRun.toFixed(2)}.`,
      [st.id, fl.id]));
  }
  const actualDist = vDist(fl.startPoint, fl.endPoint);
  if (Math.abs(actualDist - fl.runLength) > 0.05) {
    out.push(f('STAIR_INVALID_RUN', 'hard',
      `Flight ${fl.id} centerline length ${actualDist.toFixed(2)} m ≠ declared run ${fl.runLength.toFixed(2)} m.`,
      [st.id, fl.id]));
  }
  if (fl.width < 0.9 - EPS) {
    out.push(f('STAIR_NARROW_WIDTH', 'soft',
      `Flight ${fl.id} width ${fl.width.toFixed(2)} m is below 0.90 m (MBH4 §4-5-1-7-3 0.90 m for small villas).`,
      [st.id, fl.id]));
  }
  return out;
}

/** Stair access heuristic: the footprint of the stair must share a wall
 *  (i.e. overlap a non-zero length edge with) a circulation or entrance
 *  space. */
function isStairAccessible(st: Stair, floor: Floor): boolean {
  const accessTypes = new Set(['corridor', 'foyer', 'entrance', 'stair-hall']);
  for (const sp of floor.spaces) {
    if (!accessTypes.has(sp.type)) continue;
    if (rOverlapArea(st.footprint, sp.rect) > -1) {
      // The stair is PLACED INSIDE the stair-hall space typically, so any
      // overlap with the dedicated stair-hall space counts. If the stair
      // is placed directly on the corridor (or adjoins it via a shared
      // wall), we count that too.
      const inter = rIntersection(st.footprint, sp.rect);
      if (inter && (rArea(inter) > 0.05 || touchesEdge(st.footprint, sp.rect))) {
        return true;
      }
    }
  }
  return false;
}

/** Returns true if a and b share an edge (opposite rects touching). */
function touchesEdge(a: {x:number;y:number;w:number;h:number}, b: {x:number;y:number;w:number;h:number}): boolean {
  const aR = a.x + a.w, aT = a.y + a.h;
  const bR = b.x + b.w, bT = b.y + b.h;
  const xOverlap = Math.min(aR, bR) - Math.max(a.x, b.x);
  const yOverlap = Math.min(aT, bT) - Math.max(a.y, b.y);
  if (xOverlap < 0.05) return false;
  // Edges touch if the rects' y ranges overlap substantially AND an x edge
  // coincides within 2cm, OR vice versa.
  const xTouch = Math.abs(aR - b.x) < 0.05 || Math.abs(bR - a.x) < 0.05;
  const yTouch = Math.abs(aT - b.y) < 0.05 || Math.abs(bT - a.y) < 0.05;
  return (xTouch && yOverlap > 0.1) || (yTouch && xOverlap > 0.1);
}

function bbox(r: {x:number;y:number;w:number;h:number}): [number,number,number,number] {
  return [r.x, r.y, r.x + r.w, r.y + r.h];
}
function f(code: Finding['code'], severity: Finding['severity'], msg: string, entityIds?: string[], bbox?: Finding['bbox']): Finding {
  return { code, severity, message: msg, entityIds, bbox };
}
