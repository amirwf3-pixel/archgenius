/**
 * Phase 15 M7 — Professional vertical-circulation engine.
 *
 * Wraps the Phase 4 stair solver (`stair-solver.ts`) with the two capabilities
 * a multi-floor building needs and the naive generator path lacked:
 *
 *  1. ACCESS-AWARE ORIENTATION SEARCH. A stair-hall can be entered from any
 *     side; which sides are USABLE is a measurable geometric fact (a shared
 *     edge of at least door-going width with a circulation space — corridor,
 *     foyer, entrance, or the hall's own circulation). The engine tries every
 *     admissible (entry side → travel direction) orientation through the
 *     solver's deterministic type/flight search and ranks the feasible
 *     results by real geometry metrics only (hall slack, then the fixed side
 *     order). No coordinates, stair types, or flight splits are hardcoded.
 *
 *  2. CROSS-FLOOR CORE COHERENCE. For multi-floor buildings the vertical core
 *     (stair hall, and elevator hall when the program requires one) is a
 *     building-level anchor: level 0 fixes it, every upper floor reuses the
 *     SAME rect, entry side, and — through the same solver call on the same
 *     inputs — the SAME stair type, flight split, well footprint and direction.
 *     Floors never solve their stairs independently and scatter cores.
 *     When an upper-floor layout has grown a room into the anchor, a BOUNDED,
 *     deterministic relocation pass frees the anchor cell; if the anchor
 *     cannot be preserved, the engine says so in the explanation and lets the
 *     stair validator flag the result honestly (STAIR_CORE_MISALIGNED /
 *     STAIR_MISSING). It never fakes coherence.
 *
 * REGULATORY HONESTY: this module introduces NO new dimensional rules. It
 * consumes StairConfig values exactly as configured (riser/tread/flight
 * limits verified by the IR-national MBH4 pack) and the solver enforces the
 * rise arithmetic (totalRise = totalRisers × riserHeight, treadCount =
 * riserCount − 1 — the solver's documented convention used identically in
 * geometry, validation, DXF and tests). Headroom is a 3D property the 2D
 * engine cannot evaluate: it is reported as NOT_IMPLEMENTED advisory
 * metadata, never as compliance.
 */
import type { Rect } from '../geometry/rect.js';
import { rArea, rOverlapArea } from '../geometry/rect.js';
import type { Space } from '../model/space.js';
import type { Stair, StairConfig, StairType } from '../model/stairs.js';
import { solveStair } from './stair-solver.js';

/** Entry-side of a hall. Same axis convention as the solver's corridorSide. */
export type HallSide = 'north' | 'south' | 'east' | 'west';

/** A fixed vertical-circulation anchor for one hall type (deterministic:
 *  produced once per building from level 0, reused verbatim above). */
export interface CoreAnchor {
  /** Space type this anchor pins: 'stair-hall' or 'elevator-hall'. */
  hallType: 'stair-hall' | 'elevator-hall';
  /** The hall rect on the anchor floor — every floor reuses this rect. */
  rect: Rect;
  /** Which side of the hall the circulation approaches from (entry side). */
  corridorSide: HallSide;
  /** Solved stair type (documentation of the solved configuration; the upper
   *  floors re-solve and must land on it because inputs are identical). */
  stairType?: StairType;
  /** Solved flight riser counts, e.g. [9, 9] — recorded for coherence audits. */
  flightCounts?: number[];
  /** Well footprint of the solved stair (what stacking validators compare). */
  wellFootprint?: Rect;
  /** Level this anchor was established on. */
  originLevel: number;
}

export interface OrientationAttempt {
  side: HallSide;
  ok: boolean;
  stair?: Stair;
  /** hallArea − stairArea for a fit; 0..−Infinity style penalty otherwise. */
  slack: number;
  /** Whether the side has a REAL circulation adjacency ≥ minEdgeWidth. */
  circulationAdjacency: boolean;
  /** Shared edge length (m) between hall and circulation on this side. */
  adjLength: number;
  reason?: string;
}

/** Minimum shared-edge length counted as a walkable circulation adjacency
 *  (door-going width; the openings module places the physical door there). */
export const MIN_ADJ_EDGE = 0.8;

const CIRC_TYPES = new Set(['corridor', 'foyer', 'entrance', 'stair-hall', 'elevator-hall']);

/** Length of the shared portion of `hall`'s side `side` with rect `b`
 *  (measured in plan geometry — no touching heuristics beyond EPS). */
export function sharedEdgeLength(hall: Rect, side: HallSide, b: Rect, eps = 0.05): number {
  const overlap = (a0: number, a1: number, c0: number, c1: number) =>
    Math.max(0, Math.min(a1, c1) - Math.max(a0, c0));
  switch (side) {
    case 'south':
      return Math.abs(hall.y - (b.y + b.h)) < eps ? overlap(hall.x, hall.x + hall.w, b.x, b.x + b.w) : 0;
    case 'north':
      return Math.abs((hall.y + hall.h) - b.y) < eps ? overlap(hall.x, hall.x + hall.w, b.x, b.x + b.w) : 0;
    case 'west':
      return Math.abs(hall.x - (b.x + b.w)) < eps ? overlap(hall.y, hall.y + hall.h, b.y, b.y + b.h) : 0;
    case 'east':
      return Math.abs((hall.x + hall.w) - b.x) < eps ? overlap(hall.y, hall.y + hall.h, b.y, b.y + b.h) : 0;
  }
}

/** Best circulation adjacency for a hall on each side (max over all
 *  circulation spaces sharing that edge). */
export function hallCirculationAdjacency(hall: Rect, spaces: Space[]): Record<HallSide, number> {
  const out: Record<HallSide, number> = { north: 0, south: 0, east: 0, west: 0 };
  for (const s of spaces) {
    if (!CIRC_TYPES.has(s.type)) continue;
    for (const side of ['south', 'north', 'east', 'west'] as HallSide[]) {
      out[side] = Math.max(out[side], sharedEdgeLength(hall, side, s.rect));
    }
  }
  return out;
}

/**
 * Bounded, deterministic orientation search over the solver.
 *
 * Candidate set: the 4 entry sides. A side is PREFERRED when the hall has a
 * real circulation adjacency there (≥ MIN_ADJ_EDGE); sides without adjacency
 * are still tried (a hall can sit at a corridor end) but only if nothing
 * with adjacency solves. Ranking inside the preferred set: feasible first,
 * then maximal plan slack (hall area − stair area), then the fixed side
 * order south→east→north→west. All inputs equal → all outputs equal.
 */
export function solveStairOrientations(
  hallRect: Rect,
  cfg: StairConfig,
  spaces: Space[],
  coreId: string,
  level: number,
): { stair: Stair | null; side: HallSide | null; attempts: OrientationAttempt[]; explanation: string[] } {
  const adj = hallCirculationAdjacency(hallRect, spaces);
  const sides: HallSide[] = ['south', 'east', 'north', 'west'];
  const explanation: string[] = [];
  const attempts: OrientationAttempt[] = [];
  for (const side of sides) {
    const sol = solveStair(hallRect, cfg, side, coreId, level);
    if (sol.ok && sol.stair) {
      attempts.push({
        side,
        ok: true,
        stair: sol.stair,
        slack: rArea(hallRect) - rArea(sol.stair.footprint),
        circulationAdjacency: adj[side] >= MIN_ADJ_EDGE,
        adjLength: adj[side],
      });
    } else {
      attempts.push({
        side, ok: false, slack: 0,
        circulationAdjacency: adj[side] >= MIN_ADJ_EDGE,
        adjLength: adj[side],
        reason: sol.attempts.length
          ? sol.attempts[0].reason
          : 'no configuration fit',
      });
    }
  }
  const preferred = attempts.filter(a => a.ok && a.circulationAdjacency);
  const fallbackSet = attempts.filter(a => a.ok);
  const chosen = (preferred.length ? preferred : fallbackSet)
    .sort((a, b) => (b.slack - a.slack) || (sides.indexOf(a.side) - sides.indexOf(b.side)))[0];
  if (chosen) {
    explanation.push(
      `Vertical-core: ${chosen.stair!.type} stair solved entering from ${chosen.side} ` +
      `(${chosen.stair!.flights.map(f => f.riserCount).join('+')} risers, ` +
      `${chosen.stair!.landings.length} landing(s), slack ${chosen.slack.toFixed(2)} m²)` +
      (preferred.length ? '' : ' — no circulation-adjacent entry side solved; hall-side fallback') + '.',
    );
    return { stair: chosen.stair!, side: chosen.side, attempts, explanation };
  }
  explanation.push(
    `Vertical-core: NO_FEASIBLE_STAIR_CONFIGURATION for hall ${hallRect.w.toFixed(2)}×${hallRect.h.toFixed(2)} m ` +
    `across ${attempts.length} orientation(s) — attempts: ` +
    attempts.map(a => `${a.side}: ${a.reason}`).join(' | ').slice(0, 400),
  );
  return { stair: null, side: null, attempts, explanation };
}

/** Build the coherent anchor from a solved level-0 (or origin-level) core. */
export function makeCoreAnchor(
  hallType: 'stair-hall' | 'elevator-hall',
  hallRect: Rect,
  side: HallSide,
  stair: Stair | null,
  originLevel: number,
): CoreAnchor {
  return {
    hallType,
    rect: { ...hallRect },
    corridorSide: side,
    stairType: stair?.type,
    flightCounts: stair ? stair.flights.map(f => f.riserCount) : undefined,
    wellFootprint: stair ? { ...stair.footprint } : undefined,
    originLevel,
  };
}

export interface AnchorAlignment {
  /** true when the hall ended up exactly on the anchor rect (coherent core). */
  aligned: boolean;
  /** Deterministic notes for the explanation log. */
  explanation: string[];
}

/** Deterministic rect equality at mm tolerance (placement snaps to cm grid). */
export function sameRect(a: Rect, b: Rect, eps = 0.011): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
    && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

/** Overlap test helper: area of intersection above the noise floor. */
export function overlaps(a: Rect, b: Rect, min = 0.01): boolean {
  return rOverlapArea(a, b) > min;
}

/**
 * Coherence check for an upper floor's hall given the building anchor.
 * Reports whether the placed hall already sits on the anchor (aligned),
 * and otherwise lists exactly which spaces occupy the anchor cell (the
 * generator performs the bounded relocation pass). This function is pure.
 */
export function inspectAnchorPlacement(
  anchor: CoreAnchor,
  hall: Space | null,
  otherSpaces: Space[],
): AnchorAlignment & { blockers: Space[] } {
  const explanation: string[] = [];
  if (hall && sameRect(hall.rect, anchor.rect)) {
    return { aligned: true, explanation, blockers: [] };
  }
  const blockers = otherSpaces.filter(s => overlaps(anchor.rect, s.rect));
  if (blockers.length === 0 && !hall) {
    explanation.push(`Vertical-core: ${anchor.hallType} not placed on this floor; anchor cell is free — re-pinning it for core coherence.`);
  } else if (blockers.length === 0 && hall) {
    explanation.push(`Vertical-core: ${anchor.hallType} drifts to (${hall.rect.x.toFixed(2)},${hall.rect.y.toFixed(2)}); sliding back onto the anchor without displacing rooms.`);
  } else if (blockers.length > 2) {
    explanation.push(
      `Vertical-core: anchor cell occupied by ${blockers.length} rooms [${blockers.map(b => b.type).join(',')}] — ` +
      'relocation pass bounded to ≤2 blockers skipped; coherence NOT faked (stair validator will judge this floor honestly).',
    );
    return { aligned: false, explanation, blockers };
  } else {
    explanation.push(
      `Vertical-core: anchor cell occupied by ${blockers.map(b => b.type).join(',')} — attempting bounded relocation.`,
    );
  }
  return { aligned: false, explanation, blockers };
}
