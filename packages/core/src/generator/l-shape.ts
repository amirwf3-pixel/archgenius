/**
 * Phase 25 — Dedicated L-shape wing placement (MEDIUM-1 from the Phase 24 gate).
 *
 * Root cause being addressed: `computeBuildableGeometry()` provides the
 * `buildableRects` decomposition of the L-shaped buildable polygon (and the
 * parking-band reserve may re-clip those rects), but the generic Phase-15 M6
 * region planner can accept "unsplit flow" placements whose wings end up
 * disconnected across the cut line (CIRC_INACCESSIBLE_SPACE) or whose rooms
 * overlap (placer repair defects under mixed day/night lists on one rect).
 *
 * This module is NOT a second general placement engine. It is the dedicated
 * two-rectangle L-shape path that, for each of the (at most two) natural
 * rectangle re-cuts of the L union,
 *   1. carves ONE bridge-corridor strip along the shared cut — preferring the
 *      STREET-wing side, where the wing's own circulation spine touches the
 *      strip by construction (corridor↔corridor spine links connect both
 *      wings; a room-mediated connection could turn that room into an
 *      illegal pass-through),
 *   2. allocates the program between the wings with a deterministic
 *      area-fit variant ladder (bedroom overflow to the day wing first; the
 *      master suite stays paired), with small night wings tiled directly by
 *      the existing M4 band solvers so every night room keeps a full edge on
 *      the bridge strip (connected by construction) and the opposite edge on
 *      the exterior wall (daylight),
 *   3. places each wing with the existing `placeSpaces` primitive, and
 *   4. accepts a wing plan ONLY on geometry-authoritative gates: full spec
 *      coverage, no pairwise room overlap, every room inside the buildable
 *      polygon (nothing in the notch). P29-B: ALL gate-passing plans are
 *      collected and the one with the lowest wing-residual imbalance wins
 *      (total residual, then the fixed ladder order, as tie-breakers) — the
 *      first-accept behavior that could pack almost all rooms into one wing
 *      is gone; the gates themselves are unchanged.
 * Determinism: fixed split/strip/orientation/variant order, explicit
 * tie-breakers, no randomness. `null` return = no wing plan passed the
 * gates — the caller falls back to the pre-existing
 * `placeSpacesAcrossRects` behavior and the honest infeasibility gates
 * report exactly as before. Rectangular sites never reach this module
 * (caller guards on `shape === 'l-shape'` and `buildableRects.length === 2`).
 */
import type { Rect } from '../geometry/rect.js';
import { rArea, rOverlapArea } from '../geometry/rect.js';
import type { Space, SpaceType, Zone } from '../model/space.js';
import type { CandidateStrategy } from '../model/layout.js';
import type { AccessSide } from '../model/site.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import { placeSpaces, hasOverlappingRooms, type PlacedSpec } from '../layout/placer.js';
import { contactLen } from '../layout/regions.js';
import { solveRow, solveCol, type BandCellDemand, type BandSolution } from '../layout/topology.js';
import { EPS } from '../units.js';

/**
 * P29-B FIX 2 — wing-residual stats for the balance selection (pure, exported
 * for tests). Residual notion matches the validator's EXCESSIVE_RESIDUAL
 * metric (assigned area subtracted from the area of the region that should
 * host it), applied per L wing: wing rectangle area minus the total area of
 * the rooms whose centroid lies in that wing. `imbalance` is the selection
 * key; `totalResidual` (wing union = the L polygon minus rooms) and the
 * ladder order are the deterministic tie-breakers.
 */
export function wingResidualStats(
  spaces: ReadonlyArray<Space>, street: Rect, other: Rect,
): { resStreet: number; resOther: number; imbalance: number; totalResidual: number } {
  const wingResidualOf = (wing: Rect): number => {
    let covered = 0;
    for (const s of spaces) {
      const cx = s.rect.x + s.rect.w / 2, cy = s.rect.y + s.rect.h / 2;
      if (cx >= wing.x - EPS && cx <= wing.x + wing.w + EPS && cy >= wing.y - EPS && cy <= wing.y + wing.h + EPS) {
        covered += s.rect.w * s.rect.h;
      }
    }
    return Math.max(0, rArea(wing) - covered);
  };
  const resStreet = wingResidualOf(street);
  const resOther = wingResidualOf(other);
  return { resStreet, resOther, imbalance: Math.abs(resStreet - resOther), totalResidual: resStreet + resOther };
}

/** Bridge corridor width — mirrors the placer spine width convention (CORRIDOR_W = 1.5 m). */
const BRIDGE_W = 1.5;
/** Minimum shared cut length for a buildable wing bridge (door + passage). */
const MIN_CUT_LEN = 1.2;
/** Minimum usable cross-extent a wing must keep beyond the bridge strip. */
const MIN_USABLE = 1.2;

const DAY_TYPES = new Set<string>([
  'entrance', 'foyer', 'guest-wc', 'living', 'dining', 'kitchen',
  'family-room', 'guest-room', 'storage', 'utility', 'yard', 'balcony',
]);
const NIGHT_TYPES = new Set<string>([
  'bedroom', 'master-bedroom', 'bathroom', 'master-bathroom',
  'walk-in', 'wardrobe', 'laundry', 'study', 'stair-hall', 'elevator-hall',
]);
const MAIN_FLOOR_AREA = new Set<string>(['living', 'master-bedroom', 'family-room', 'dining', 'bedroom']);
// MBH4 (1396) §7-1-1-8 large-unit floor (12 m²) used as a WING-LEVEL sizing
// aim only — the same published value the placer's own main-habitable
// preference mirrors. Program specs, validation thresholds and ranking stay
// untouched; this only aims band growth inside the two L-wings.
const MAIN_AIM_AREA = 12;
const aimMainRooms = (list: PlacedSpec[]): PlacedSpec[] =>
  list.map(sp => MAIN_FLOOR_AREA.has(sp.type) && (sp.targetArea ?? 0) < MAIN_AIM_AREA
    ? { ...sp, targetArea: MAIN_AIM_AREA }
    : sp);
/** Day-wing types that may overflow into the night wing when the day wing is short. */
const MOVABLE_DAY = new Set<string>(['guest-wc', 'storage', 'utility', 'family-room', 'guest-room', 'dining']);

// ---- P31-P1 circulation connectivity (geometry-level proxy) ---------------------
// The door pass (generator/openings.ts) turns every adjacent circulation pair
// into a spine door, so adjacency here is the exact precondition for a door.
const L_CIRC_TYPES = new Set<string>(['corridor', 'entrance', 'foyer', 'stair-hall', 'elevator-hall']);
const L_CIRC_LINK = 0.8; // minimum shared edge for a viable door (door width 0.9, adaptive margin)
const L_CONNECTOR_W = 1.5; // connector corridor width — mirrors CORRIDOR_W
const L_BAND_H = 1.8; // entry-band height mirror

/** Shared-edge length between two rects (0 when not touching). */
function sharedEdgeLen(a: Rect, b: Rect): number {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (xOverlap < -1e-9 || yOverlap < -1e-9) return 0; // separated
  if (Math.abs(a.y + a.h - b.y) < 1e-6 || Math.abs(b.y + b.h - a.y) < 1e-6) return Math.max(0, xOverlap);
  if (Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) return Math.max(0, yOverlap);
  return 0;
}

/** Circulation component reachable from the entry spaces through circulation
 * spaces only. Returns the component id set (seeds included). */
function circulationComponent(spaces: ReadonlyArray<Space>): Set<string> {
  const seeds = spaces.filter(s => s.type === 'entrance' || s.type === 'foyer');
  const circ = spaces.filter(s => L_CIRC_TYPES.has(s.type));
  const comp = new Set<string>(seeds.map(s => s.id));
  const q = [...seeds];
  while (q.length) {
    const cur = q.shift()!;
    for (const c of circ) {
      if (comp.has(c.id)) continue;
      if (sharedEdgeLen(cur.rect, c.rect) >= L_CIRC_LINK) { comp.add(c.id); q.push(c); }
    }
  }
  return comp;
}

/** Main habitable rooms — a habitable room that does not itself touch the
 * circulation system would be reachable only THROUGH another room at door
 * time (through-room), so it counts as not connected. */
const L_HABITABLE_ATTACH = new Set<string>([
  'living', 'dining', 'kitchen', 'bedroom', 'master-bedroom', 'family-room', 'guest-room', 'study',
]);

/** True when every corridor is transitively adjacent-connected to the entry
 * spaces (entrance/foyer) through circulation spaces only AND every main
 * habitable room directly touches the connected circulation system — no
 * habitable or wet room is needed as a bridge. A wet room whose only neighbor
 * is its own bedroom is an intentional ensuite (the door-level validator
 * exempts the same topology), so it counts as attached. */
function circulationConnected(spaces: ReadonlyArray<Space>): boolean {
  const circ = spaces.filter(s => L_CIRC_TYPES.has(s.type));
  if (!spaces.some(s => s.type === 'entrance' || s.type === 'foyer')) return true;
  const comp = circulationComponent(spaces);
  if (!circ.every(c => comp.has(c.id))) return false;
  const connectedCirc = circ.filter(c => comp.has(c.id));
  const L_WET = new Set<string>(['bathroom', 'master-bathroom', 'guest-wc', 'laundry']);
  const isSuiteHost = (t: string): boolean => t === 'master-bedroom' || t === 'bedroom';
  return spaces
    .filter(s2 => L_HABITABLE_ATTACH.has(s2.type))
    .every(h => {
      if (connectedCirc.some(c => sharedEdgeLen(h.rect, c.rect) >= L_CIRC_LINK)) return true;
      if (L_WET.has(h.type)) {
        return spaces.some(s2 => isSuiteHost(s2.type) && sharedEdgeLen(h.rect, s2.rect) >= L_CIRC_LINK);
      }
      return false;
    });
}


// ---- P35 downstream-failure proxy ------------------------------------------
// P31's circulation preference let a connector-twin plan win this stage while
// failing the downstream hard validators (MBH4-DYL-001 daylight,
// CONSTRAINT_DIRECT_ACCESS), displacing the previously downstream-valid plan
// and turning four L-stress scenarios honestly infeasible. This proxy mirrors
// those downstream predicates at plan level — its only numeric tolerance is
// the sub-centimetre gap bound the compaction stage demonstrably closes — so
// a plan that would fail them downstream can no longer displace one that
// would not.
const L_DYL_TYPES = new Set<string>([
  // MBH4-DYL-001 needsDaylight + closed kitchens (kitchen independence is
  // mandatory for the villa floor areas this stage plans for).
  'living', 'bedroom', 'master-bedroom', 'dining', 'family-room', 'guest-room', 'kitchen',
]);

// Hard DIRECT_ACCESS_REQUIRED / MUST_BE_ADJACENT pairs from
// DEFAULT_RESIDENTIAL_CONSTRAINTS: EVERY instance of `to` must share a
// positive wall edge with at least one room of a `from` type (the validator
// skips the pair when no from-type room exists).
const L_DIRECT_PAIRS: Array<{ to: string; from: string[] }> = [
  { to: 'foyer', from: ['entrance'] },
  { to: 'living', from: ['foyer'] },
  { to: 'bedroom', from: ['corridor'] },
  { to: 'master-bedroom', from: ['corridor'] },
  { to: 'bathroom', from: ['corridor'] },
  { to: 'master-bathroom', from: ['corridor'] },
];

/** True when at least one edge segment of `rect` has no other room on the
 * opposite side — the same one-sided wall rule the generator's wall builder
 * uses to set hasExteriorWall (MBH4-DYL-001's only daylight predicate). */
function hasExteriorEdge(rect: Rect, all: ReadonlyArray<Space>): boolean {
  const eps = 1e-6;
  const edges: Array<{ axis: 'h' | 'v'; coord: number; lo: number; hi: number }> = [
    { axis: 'h', coord: rect.y, lo: rect.x, hi: rect.x + rect.w },
    { axis: 'h', coord: rect.y + rect.h, lo: rect.x, hi: rect.x + rect.w },
    { axis: 'v', coord: rect.x, lo: rect.y, hi: rect.y + rect.h },
    { axis: 'v', coord: rect.x + rect.w, lo: rect.y, hi: rect.y + rect.h },
  ];
  for (const e of edges) {
    const covered: Array<[number, number]> = [];
    for (const o of all) {
      if (o.rect.x === rect.x && o.rect.y === rect.y && o.rect.w === rect.w && o.rect.h === rect.h) continue;
      const r = o.rect;
      const touchesLine = e.axis === 'h'
        ? (Math.abs(r.y + r.h - e.coord) < eps || Math.abs(r.y - e.coord) < eps)
        : (Math.abs(r.x + r.w - e.coord) < eps || Math.abs(r.x - e.coord) < eps);
      if (!touchesLine) continue;
      const oLo = e.axis === 'h' ? r.x : r.y;
      const oHi = e.axis === 'h' ? r.x + r.w : r.y + r.h;
      const ovLo = Math.max(e.lo, oLo);
      const ovHi = Math.min(e.hi, oHi);
      if (ovHi - ovLo > eps) covered.push([ovLo, ovHi]);
    }
    // merge covered intervals; any uncovered remainder counts as exterior
    covered.sort((a, b) => a[0] - b[0]);
    let cursor = e.lo;
    let exposed = false;
    for (const [lo, hi] of covered) {
      if (lo - cursor > eps) exposed = true;
      if (hi > cursor) cursor = hi;
    }
    if (!exposed && e.hi - cursor > eps) exposed = true;
    if (exposed) return true;
  }
  return false;
}

/** Conservative local mirror of the downstream hard failure modes: daylight
 * eligibility (MBH4-DYL-001) and the hard direct-access pairs
 * (CONSTRAINT_DIRECT_ACCESS / MUST_ADJACENT). Sub-centimetre gaps between a
 * room and its required neighbour count as adjacent — the compaction stage
 * closes exactly this class of placement-rounding gap (measured 0.005 m on
 * the L2 stress site), so rejecting those plans would displace downstream
 * valid ones again. The third failure mode — a room dependent on
 * living/dining/kitchen as its only access path — stays enforced by the
 * separate circulationConnected gate (the circulationOk criterion), which any
 * plan winning on circulation must pass. */
const L_DA_GAP_TOLERANCE = 0.01;

/** Shared-edge length across a gap (or overlap) of at most `tol` (0 when the
 * rects are farther apart or overlap substantially). */
function sharedEdgeNear(a: Rect, b: Rect, tol: number): number {
  const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (xOv < -tol || yOv < -tol) return 0;
  if (Math.abs(a.y + a.h - b.y) <= tol || Math.abs(b.y + b.h - a.y) <= tol) return Math.max(0, xOv);
  if (Math.abs(a.x + a.w - b.x) <= tol || Math.abs(b.x + b.w - a.x) <= tol) return Math.max(0, yOv);
  return 0;
}

function downstreamProxyOk(spaces: ReadonlyArray<Space>): boolean {
  const present = new Set<string>(spaces.map(s => s.type));
  // (0) real overlaps — the ladder's own room gate misses room×corridor
  // collisions (e.g. a carved-region twin whose dining straddles the
  // synthesized corridor); downstream these get "repaired" by moving the
  // room, which orphans its daylight/direct-access geometry. Dedupe by id:
  // the caller's list can repeat the bridge space across its room and
  // circulation parts.
  const seen = new Set<string>();
  const unique: Space[] = [];
  for (const s of spaces) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    unique.push(s);
  }
  if (hasOverlappingRooms(unique)) return false;
  // (A) daylight eligibility — MBH4-DYL-001
  for (const s of spaces) {
    if (!L_DYL_TYPES.has(s.type)) continue;
    if (!hasExteriorEdge(s.rect, spaces)) return false;
  }
  // (B) hard direct-access pairs — CONSTRAINT_DIRECT_ACCESS / MUST_ADJACENT
  for (const pair of L_DIRECT_PAIRS) {
    if (!present.has(pair.to)) continue;
    const sources = spaces.filter(s => pair.from.includes(s.type as string));
    if (sources.length === 0) continue;
    const targets = spaces.filter(s => s.type === pair.to);
    if (!targets.every(t => sources.some(f => f.id !== t.id && sharedEdgeNear(t.rect, f.rect, L_DA_GAP_TOLERANCE) > 1e-6))) return false;
  }
  return true;
}

function zoneFor(type: string): Zone {
  switch (type) {
    case 'entrance': case 'foyer': case 'living': case 'guest-room': case 'guest-wc': case 'yard': case 'balcony': return 'public';
    case 'dining': case 'family-room': return 'semi-private';
    case 'kitchen': case 'storage': case 'utility': case 'parking': return 'service';
    case 'corridor': case 'stair-hall': case 'elevator-hall': return 'circulation';
    default: return 'private';
  }
}

interface WingPlan {
  spaces: Space[];
  corridors: Space[];
  explanation: string[];
}

interface StripCfg {
  side: 'far' | 'near';
  strip: Rect;
  redStreet: Rect;
  redFar: Rect;
  note: string;
}

/** Edge-coverage tolerance: walls between adjacent rooms deviate by a few cm. */
const EDGE_COVER_TOL = 0.05;

/**
 * Phase 25: a room is "fully interior" when every one of its four edges is
 * (near-completely) covered by other placed rooms — i.e. the room never
 * touches the building footprint boundary, so it cannot get an exterior wall
 * or daylight. MBH4 §7 daylight requires exterior contact for habitable
 * rooms; plans with fully-interior habitable rooms are not accepted by the
 * dedicated L path (the generic planner gets its turn instead).
 */
function coveredLen(axis: 'x' | 'y', at: number, others: Rect[], lo: number, hi: number): number {
  const ivs: Array<[number, number]> = [];
  for (const o of others) {
    const a = axis === 'x' ? o.y : o.x;
    const b = axis === 'x' ? o.y + o.h : o.x + o.w;
    const near = axis === 'x' ? o.x : o.y;
    const far = axis === 'x' ? o.x + o.w : o.y + o.h;
    // The neighbor may end at the edge (o.far == at) or start at it (o.near == at).
    if (Math.abs(far - at) <= EDGE_COVER_TOL || Math.abs(near - at) <= EDGE_COVER_TOL) {
      const lo2 = Math.max(lo, a);
      const hi2 = Math.min(hi, b);
      if (hi2 > lo2) ivs.push([lo2, hi2]);
    }
  }
  if (ivs.length === 0) return 0;
  ivs.sort((p, q) => p[0] - q[0]);
  let total = 0;
  let curA = ivs[0][0];
  let curB = ivs[0][1];
  for (let i = 1; i < ivs.length; i++) {
    if (ivs[i][0] <= curB + 1e-9) curB = Math.max(curB, ivs[i][1]);
    else { total += curB - curA; curA = ivs[i][0]; curB = ivs[i][1]; }
  }
  total += curB - curA;
  return total;
}

function isFullyInterior(r: Rect, all: Space[]): boolean {
  const others = all.filter(o => o.rect !== r).map(o => o.rect);
  const span = (axis: 'x' | 'y') => (axis === 'x' ? r.h : r.w);
  const left = coveredLen('x', r.x, others, r.y, r.y + r.h);
  const right = coveredLen('x', r.x + r.w, others, r.y, r.y + r.h);
  const bottom = coveredLen('y', r.y, others, r.x, r.x + r.w);
  const top = coveredLen('y', r.y + r.h, others, r.x, r.x + r.w);
  return left >= span('x') - EDGE_COVER_TOL && right >= span('x') - EDGE_COVER_TOL
    && bottom >= span('y') - EDGE_COVER_TOL && top >= span('y') - EDGE_COVER_TOL;
}

const DAYLIGHT_HABITABLE = new Set(['living', 'dining', 'bedroom', 'master-bedroom']);

/**
 * Phase 25: L-aware parking envelope. The site boundary of an L-shaped lot is
 * the L polygon itself — the notch is NOT part of the site. The generic stall
 * scan pins its along-axis range to the buildable bounding box, whose corners
 * can lie inside a south-side notch; stalls there would land outside the lot.
 * This helper clamps the envelope's x-range to the lot's actual front band
 * (south corners bite for south access, north corners for north access).
 */
export function lAwareParkingEnvelope(
  lShape: { width: number; length: number; notchWidth: number; notchLength: number; notchCorner: string },
  buildableRect: Rect,
  access: 'north' | 'south' | 'east' | 'west',
  fallback: Rect,
): Rect {
  if (access !== 'south' && access !== 'north') return fallback;
  const w = lShape.width;
  const southNotch = lShape.notchCorner === 'sw' || lShape.notchCorner === 'se';
  const northNotch = lShape.notchCorner === 'nw' || lShape.notchCorner === 'ne';
  const frontBites = (access === 'south' && southNotch) || (access === 'north' && northNotch);
  if (!frontBites) return fallback;
  const x0 = lShape.notchCorner === 'sw' || lShape.notchCorner === 'nw' ? lShape.notchWidth : 0;
  const x1 = lShape.notchCorner === 'se' || lShape.notchCorner === 'ne' ? w - lShape.notchWidth : w;
  if (x1 - x0 <= 0) return fallback;
  const env: Rect = { x: x0, y: buildableRect.y, w: x1 - x0, h: buildableRect.h };
  return env.w >= 6 ? env : fallback;
}

/** Opt-in L-wing selection preferences. Every field defaults to OFF (legacy selection). */
export interface LShapePlacementOptions {
  /**
   * Phase 5.3B: among wing plans that ALL pass the existing dimension-contract,
   * circulation and downstream daylight/direct-access gates, prefer the plan that
   * satisfies more programme adjacency (spec.adjacencies): doorRequired weight
   * first, then total weight. Never lets a gate-failing plan win; ties fall back
   * to the legacy imbalance / residual / suite order.
   */
  preferProgrammeAdjacency?: boolean;
  /**
   * Phase 5.5B: forwarded to every wing placeSpaces() call as
   * PlacerOptions.rotateShallowStairPocket (default OFF — wings placed exactly as before).
   */
  rotateShallowStairPocket?: boolean;
}

/**
 * Programme adjacency key of a wing plan, from the programme's own spec.adjacencies
 * (first spec per type, as in the quality metric's programAdjacencyByType). An
 * instance is one placed room of a type carrying requirements; "adjacent" is any
 * positive shared wall edge (the same relation the master-suite tie-break uses).
 * Returns [Σ weight of satisfied doorRequired instances, Σ weight of all satisfied].
 */
function programmeAdjacencyKey(specs: ReadonlyArray<PlacedSpec>, p: { spaces: Space[]; corridors: Space[] }): [number, number] {
  const reqByType = new Map<string, NonNullable<PlacedSpec['adjacencies']>>();
  for (const sp of specs) if (sp.adjacencies?.length && !reqByType.has(sp.type)) reqByType.set(sp.type, sp.adjacencies);
  const all = [...p.spaces, ...p.corridors];
  let door = 0, total = 0;
  for (const s of all) {
    const reqs = reqByType.get(s.type);
    if (!reqs) continue;
    for (const r of reqs) {
      const targets = all.filter(t => t.type === r.spaceType && t.id !== s.id);
      if (targets.length === 0) continue; // not applicable on this plan
      const touching = targets.some(t => sharedEdgeLen(s.rect, t.rect) > 1e-6);
      if (r.adjacent ? touching : !touching) {
        const w = r.weight ?? 1;
        total += w;
        if (r.doorRequired === true) door += w;
      }
    }
  }
  return [door, total];
}

export function placeSpacesLShape(
  buildableRects: Rect[],
  buildableBoundary: Polygon,
  specs: PlacedSpec[],
  strategy: CandidateStrategy,
  access: AccessSide,
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
  opts: LShapePlacementOptions = {},
): WingPlan | null {
  if (buildableRects.length !== 2) {  return null; }
  const [rawA, rawB] = buildableRects;
  if (!(rawA.w > 0) || !(rawA.h > 0) || !(rawB.w > 0) || !(rawB.h > 0)) return null;
  if (contactLen(rawA, rawB) < MIN_CUT_LEN) {  return null; }
  if (!rectInsidePolygon(rawA, buildableBoundary, 1e-3) || !rectInsidePolygon(rawB, buildableBoundary, 1e-3)) {
        return null;
  }

  // ---- program split inputs (split-independent) ----
  const daySpecs = specs.filter(s => DAY_TYPES.has(s.type));
  const nightSpecs = specs.filter(s => NIGHT_TYPES.has(s.type));
  const dropped = specs.filter(s => !DAY_TYPES.has(s.type) && !NIGHT_TYPES.has(s.type));
  const explanation: string[] = [];
  for (const d of dropped) explanation.push(`L-wings: ${d.type} spec carried by dedicated stages (corridor synthesis) — not assigned to a wing.`);
  const bySmall = (a: PlacedSpec, b: PlacedSpec) =>
    (a.minArea ?? 6) - (b.minArea ?? 6) || (a.targetArea ?? 0) - (b.targetArea ?? 0) || a.type.localeCompare(b.type);
  // Deterministic area-fit variant ladder: bedrooms overflow to the day wing
  // first (the master suite stays paired with its bathroom while it fits).
  const movableNight = [...nightSpecs].filter(s => s.type !== 'master-bedroom' && s.type !== 'stair-hall').sort(bySmall);
  const dayMovable = daySpecs.filter(s => MOVABLE_DAY.has(s.type)).sort(bySmall);
  const variants: { day: PlacedSpec[]; night: PlacedSpec[]; note: string; connector?: boolean }[] = [];
  for (const [kN, kD] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1]] as const) {
    if (kN > movableNight.length) continue;
    const toDay = movableNight.slice(0, kN);
    const toNight = dayMovable.slice(0, kD);
    variants.push({
      day: [...daySpecs.filter(s => !toNight.includes(s)), ...toDay],
      night: [...nightSpecs.filter(s => !toDay.includes(s)), ...toNight],
      note: kN === 0 && kD === 0 ? 'straight day/street + night split' : `overflow ${kN} night→day, ${kD} day→night`,
    });
  }

  const place = (rect: Rect, list: PlacedSpec[]) =>
    list.length === 0
      ? { spaces: [] as Space[], corridors: [] as Space[], explanation: [] as string[] }
      : (opts.rotateShallowStairPocket === true
        ? placeSpaces(rect, list, strategy, access, mkSpace, { rotateShallowStairPocket: true })
        : placeSpaces(rect, list, strategy, access, mkSpace));
  const covered = (list: PlacedSpec[], res: { spaces: Space[] }): boolean =>
    list.every(sp => res.spaces.some(s => s.id === sp.placedId));

  // P33-P3: suite-preserving variant — the master bathroom never leaves the
  // master bedroom's wing; the bedroom(s) overflow to the day wing instead.
  // The prefix-slice ladder above always moves the (smaller) bathroom first,
  // which makes the same-wing suite inexpressible there. Pushed last so the
  // existing ladder order is untouched; the selection tiebreak below is what
  // prefers it when every existing metric is exactly tied.
  if (nightSpecs.some(s => s.type === 'master-bedroom') && nightSpecs.some(s => s.type === 'master-bathroom')) {
    const suite = nightSpecs.filter(s => s.type === 'master-bedroom' || s.type === 'master-bathroom');
    const overflowBeds = nightSpecs.filter(s => s.type === 'bedroom');
    if (overflowBeds.length > 0) {
      const suiteRest = nightSpecs.filter(s => s.type !== 'master-bedroom' && s.type !== 'master-bathroom' && s.type !== 'bedroom' && s.type !== 'stair-hall');
      variants.push({
        day: [...daySpecs, ...overflowBeds],
        night: [...suite, ...suiteRest],
        note: 'suite same-wing (bedroom → day)',
      });
    }
  }

  // P31-P1: connector twins of every standard variant — identical program
  // split, but the cut-side band of the day wing is pre-reserved for a link
  // corridor (see the circulation-completion stage at acceptance). Tried
  // after the standard variants; the geometry gates and the circulation-aware
  // selection decide whether a twin wins. Scenarios where no twin passes the
  // gates keep their standard plan unchanged.
  for (const v of [...variants]) {
    variants.push({ ...v, note: `${v.note} + corridor-link`, connector: true });
  }

  // Band-tile a SMALL night wing directly from the M4 band solvers (the same
  // primitives that gate the allocation): cells stack perpendicular to the
  // cut so every room keeps a full edge on the bridge strip (connected by
  // construction) and the opposite edge on the wing's exterior wall.
  const bandTileNight = (rect: Rect, list: PlacedSpec[], verticalCut: boolean, maxCells?: number): { spaces: Space[]; corridors: Space[]; explanation: string[] } | null => {
    // P31-P1: a vertical (cut-parallel) stack keeps every cell's full edge on
    // the bridge strip regardless of cell count, so 3 cells stay
    // connected-by-construction there; horizontal stacks keep the 2-cell cap
    // unless the caller raises it (P31-P1 day-row mode: full-width rows in the
    // carved day region, each row touching the connector corridor).
    if (list.length === 0 || list.length > (maxCells ?? (verticalCut ? 3 : 2))) return null;
    const cells: BandCellDemand[] = list.map(sp => ({
      type: sp.type,
      minWidth: Math.max(sp.minWidth ?? 2.0, MAIN_FLOOR_AREA.has(sp.type) ? 2.7 : 0),
      minHeight: sp.minLength ?? sp.minWidth ?? 2.0,
      minArea: Math.max(sp.minArea ?? 6, MAIN_FLOOR_AREA.has(sp.type) ? 12 : 0, 0.25),
      target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 6, 0.25),
    }));
    const sol: BandSolution | null = verticalCut
      ? (solveCol(rect.w, rect.h, cells) ?? solveRow(rect.w, rect.h, cells))
      : (solveRow(rect.w, rect.h, cells) ?? solveCol(rect.w, rect.h, cells));
    if (!sol) return null;
    // P31-P1 fix: the stacking axis follows the SOLUTION mode (col → cells
    // stack along x with full height; row → cells stack along y with full
    // width). The previous ternary mis-mapped a row fallback under a vertical
    // cut, feeding row heights in as widths.
    const verticalStack = sol.mode === 'col';
    const spaces: Space[] = [];
    let flow = verticalStack ? rect.y : rect.x;
    for (let i = 0; i < list.length; i++) {
      const cell = sol.cells[i];
      const r: Rect = verticalStack
        ? { x: rect.x, y: flow, w: rect.w, h: cell.flow }
        : { x: flow, y: rect.y, w: cell.flow, h: rect.h };
      flow += cell.flow;
      const sp = list[i];
      // P31-P1: the solver's cap-growth branch can hand back a flow below the
      // cell's own minimum (e.g. a guest-WC row squeezed under its usable
      // floor). The packer must never emit such a sliver — reject the solution
      // so the caller falls back to the placer.
      const minW = Math.max(sp.minWidth ?? 2.0, MAIN_FLOOR_AREA.has(sp.type) ? 2.7 : 0);
      const minH = sp.minLength ?? sp.minWidth ?? 2.0;
      const minA = Math.max(sp.minArea ?? 6, MAIN_FLOOR_AREA.has(sp.type) ? 12 : 0, 0.25);
      if (r.w + 1e-6 < minW - 1e-9 || r.h + 1e-6 < minH - 1e-9 || r.w * r.h + 1e-6 < minA - 1e-9) return null;
      spaces.push(mkSpace(sp.type as SpaceType, r, sp.placedLabel, sp.placedId, zoneFor(sp.type)));
    }
    return {
      spaces,
      corridors: [],
      explanation: [`[wing] Phase 25 band-tile: ${list.length} room(s) via M4 ${sol.mode} solver (${sol.cells.map(c => c.flow.toFixed(2)).join('+')} m) — every room keeps a full edge on the adjacent circulation strip.`],
    };
  };

  // ---- the (at most two) natural rectangle re-cuts of the L union ----
  const faceDistOf = (r: Rect): number => {
    switch (access) {
      case 'south': return r.y;
      case 'north': return -(r.y + r.h);
      case 'west': return r.x;
      case 'east': return -(r.x + r.w);
    }
  };
  interface Split { rects: [Rect, Rect]; note: string; unionFront: number }
  const mkSplit = (pair: [Rect, Rect], note: string): Split | null => {
    if (contactLen(pair[0], pair[1]) < MIN_CUT_LEN) return null;
    if (!rectInsidePolygon(pair[0], buildableBoundary, 1e-3) || !rectInsidePolygon(pair[1], buildableBoundary, 1e-3)) return null;
    const unionFront =
      access === 'south' ? Math.min(pair[0].y, pair[1].y)
      : access === 'north' ? Math.max(pair[0].y + pair[0].h, pair[1].y + pair[1].h)
      : access === 'west' ? Math.min(pair[0].x, pair[1].x)
      : Math.max(pair[0].x + pair[0].w, pair[1].x + pair[1].w);
    return { rects: pair, note, unionFront };
  };
  const splits: Split[] = [];
  {
    const primary = mkSplit([rawA, rawB], 'site decomposition cut');
    if (primary) splits.push(primary);
    // Horizontal re-cut of the union: bottom slab = full x-range up to the
    // lower of the two tops; top bar = the taller rect's remainder. Accepted
    // only when it tiles EXACTLY the same union area (guard for the general L).
    const x0 = Math.min(rawA.x, rawB.x);
    const x1 = Math.max(rawA.x + rawA.w, rawB.x + rawB.w);
    const y0 = Math.min(rawA.y, rawB.y);
    const tops = [rawA.y + rawA.h, rawB.y + rawB.h].sort((a, b) => a - b);
    const yMid = tops[0], yTop = tops[1];
    const taller = (rawA.y + rawA.h) > yMid ? rawA : rawB;
    if (yTop - yMid > MIN_USABLE && yMid - y0 > MIN_USABLE) {
      const bottom: Rect = { x: x0, y: y0, w: x1 - x0, h: yMid - y0 };
      const top: Rect = { x: taller.x, y: yMid, w: taller.w, h: yTop - yMid };
      if (Math.abs(rArea(bottom) + rArea(top) - (rArea(rawA) + rArea(rawB))) < 1e-6) {
        const recut = mkSplit([bottom, top], 'horizontal re-cut');
        if (recut) splits.push(recut);
      }
    }
  }
  if (splits.length === 0) {  return null; }

  interface SplitPlan { split: Split; stripCfgs: StripCfg[]; nightFits: boolean; cut: { axis: 'x' | 'y'; at: number }; nearLeft: boolean; nearAbove: boolean }
  const splitPlans: SplitPlan[] = [];
  for (const split of splits) {
    const [rA, rB] = split.rects;
    const sorted = [...split.rects].sort((a, b) =>
      faceDistOf(a) - faceDistOf(b) || rArea(b) - rArea(a) || a.x - b.x || a.y - b.y);
    const street = sorted[0];
    const other = sorted[1];
    const touchesFront = (r: Rect): boolean => {
      switch (access) {
        case 'south': return Math.abs(r.y - split.unionFront) <= EPS;
        case 'north': return Math.abs(r.y + r.h - split.unionFront) <= EPS;
        case 'west': return Math.abs(r.x - split.unionFront) <= EPS;
        case 'east': return Math.abs(r.x + r.w - split.unionFront) <= EPS;
      }
    };

    // ---- cut detection between the two wings ----
    let cut: { axis: 'x' | 'y'; at: number } | null = null;
    let nearLeft = false, nearAbove = false;
    if (Math.abs(street.x + street.w - other.x) <= 1e-6) { cut = { axis: 'x', at: other.x }; nearLeft = true; }
    else if (Math.abs(other.x + other.w - street.x) <= 1e-6) { cut = { axis: 'x', at: street.x }; }
    else if (Math.abs(street.y + street.h - other.y) <= 1e-6) { cut = { axis: 'y', at: other.y }; nearAbove = true; }
    else if (Math.abs(other.y + other.h - street.y) <= 1e-6) { cut = { axis: 'y', at: street.y }; }
    if (!cut) {  continue; }

    // ---- bridge strip configs (near/street-wing side preferred: the street
    // wing's own spine touches it by construction) ----
    const stripCfgs: StripCfg[] = [];
    if (cut.axis === 'x') {
      if (street.w >= BRIDGE_W + MIN_USABLE) {
        const strip = nearLeft
          ? { x: cut.at - BRIDGE_W, y: street.y, w: BRIDGE_W, h: street.h }
          : { x: cut.at, y: street.y, w: BRIDGE_W, h: street.h };
        const red = nearLeft
          ? { x: street.x, y: street.y, w: street.w - BRIDGE_W, h: street.h }
          : { x: cut.at + BRIDGE_W, y: street.y, w: street.w - BRIDGE_W, h: street.h };
        if (contactLen(strip, other) >= MIN_CUT_LEN) {
          stripCfgs.push({ side: 'near', strip, redStreet: red, redFar: { ...other }, note: 'bridge strip in the street wing' });
        }
      }
      if (other.w >= BRIDGE_W + MIN_USABLE) {
        const strip = nearLeft
          ? { x: cut.at, y: other.y, w: BRIDGE_W, h: other.h }
          : { x: cut.at - BRIDGE_W, y: other.y, w: BRIDGE_W, h: other.h };
        const red = nearLeft
          ? { x: cut.at + BRIDGE_W, y: other.y, w: other.w - BRIDGE_W, h: other.h }
          : { x: other.x, y: other.y, w: other.w - BRIDGE_W, h: other.h };
        if (contactLen(strip, street) >= MIN_CUT_LEN) {
          stripCfgs.push({ side: 'far', strip, redStreet: { ...street }, redFar: red, note: 'bridge strip in the far wing' });
        }
      }
    } else {
      if (street.h >= BRIDGE_W + MIN_USABLE) {
        const strip = nearAbove
          ? { x: street.x, y: cut.at - BRIDGE_W, w: street.w, h: BRIDGE_W }
          : { x: street.x, y: cut.at, w: street.w, h: BRIDGE_W };
        const red = nearAbove
          ? { x: street.x, y: street.y, w: street.w, h: street.h - BRIDGE_W }
          : { x: street.x, y: cut.at + BRIDGE_W, w: street.w, h: street.h - BRIDGE_W };
        if (contactLen(strip, other) >= MIN_CUT_LEN) {
          stripCfgs.push({ side: 'near', strip, redStreet: red, redFar: { ...other }, note: 'bridge strip in the street wing' });
        }
      }
      if (other.h >= BRIDGE_W + MIN_USABLE) {
        const strip = nearAbove
          ? { x: other.x, y: cut.at, w: other.w, h: BRIDGE_W }
          : { x: other.x, y: cut.at - BRIDGE_W, w: other.w, h: BRIDGE_W };
        const red = nearAbove
          ? { x: other.x, y: cut.at + BRIDGE_W, w: other.w, h: other.h - BRIDGE_W }
          : { x: other.x, y: other.y, w: other.w, h: other.h - BRIDGE_W };
        if (contactLen(strip, street) >= MIN_CUT_LEN) {
          stripCfgs.push({ side: 'far', strip, redStreet: { ...street }, redFar: red, note: 'bridge strip in the far wing' });
        }
      }
    }

    if (stripCfgs.length === 0) {  continue; }
    // Splits whose night wing can host the straight night program at the
    // MBH4 main floors are tried first (keeps the master suite + bedrooms
    // together where the geometry allows).
    const probe = stripCfgs[0].redFar;
    const nightCellsAll: BandCellDemand[] = nightSpecs.map(sp => ({
      type: sp.type,
      minWidth: Math.max(MAIN_FLOOR_AREA.has(sp.type) ? 2.7 : 0, sp.minWidth ?? 2.0),
      minHeight: sp.minLength ?? sp.minWidth ?? 2.0,
      minArea: Math.max(MAIN_FLOOR_AREA.has(sp.type) ? 12 : 0, sp.minArea ?? 6, 0.25),
      target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 6, 0.25),
    }));
    const nightFits = nightSpecs.length === 0
      || !!solveRow(probe.w, probe.h, nightCellsAll)
      || !!solveCol(probe.w, probe.h, nightCellsAll);
    splitPlans.push({ split, stripCfgs, nightFits, cut, nearLeft, nearAbove });
  }

  splitPlans.sort((a, b) => (a.nightFits === b.nightFits ? 0 : a.nightFits ? -1 : 1));

  // P29-B FIX 2 — collect EVERY gate-passing wing plan instead of returning the
  // first. Feasibility gates below are unchanged and still run per variant; the
  // selection afterwards ranks the feasible plans by lowest wing-residual
  // imbalance (same residual notion as the validator: wing rectangle area minus
  // the rooms assigned to that wing), with total residual and the original
  // ladder order as deterministic tie-breakers. This avoids packing almost all
  // rooms into one wing when an already-valid balanced variant exists.
  const acceptedWingPlans: Array<{
    spaces: Space[];
    corridors: Space[];
    lines: string[];
    imbalance: number;
    totalResidual: number;
    dimContractOk: boolean;
    circulationOk: boolean;
    downstreamOk: boolean;
  }> = [];

  for (const plan of splitPlans) {
    const split = plan.split;
    const [rA, rB] = split.rects;
    const sorted = [...split.rects].sort((a, b) =>
      faceDistOf(a) - faceDistOf(b) || rArea(b) - rArea(a) || a.x - b.x || a.y - b.y);
    const street = sorted[0];
    const other = sorted[1];
    const touchesFront = (r: Rect): boolean => {
      switch (access) {
        case 'south': return Math.abs(r.y - split.unionFront) <= EPS;
        case 'north': return Math.abs(r.y + r.h - split.unionFront) <= EPS;
        case 'west': return Math.abs(r.x - split.unionFront) <= EPS;
        case 'east': return Math.abs(r.x + r.w - split.unionFront) <= EPS;
      }
    };
    const cut: { axis: 'x' | 'y'; at: number } = plan.cut;
    const nearLeft = plan.nearLeft;
    const nearAbove = plan.nearAbove;
    const stripCfgs = plan.stripCfgs;

    const orientations: { dayOnStreet: boolean; note: string }[] = [
      { dayOnStreet: true, note: 'day wing on the street rect' },
    ];
    if (touchesFront(other) && rArea(other) <= rArea(street)) {
      orientations.push({ dayOnStreet: false, note: 'day wing on the secondary street rect' });
    }

    for (const orient of orientations) {
      // Prefer variants whose night wing can host its main rooms at the
      // MBH4 §7-1-1-8 large-unit floors (12 m² / 2.70 m) — allocation aim.
      const redFarProbe = stripCfgs[0]?.redFar ?? other;
      const nightFitMainFloors = (v: { night: PlacedSpec[] }): boolean => {
        if (v.night.length === 0) return true;
        const cells: BandCellDemand[] = v.night.map(sp => ({
          type: sp.type,
          minWidth: Math.max(MAIN_FLOOR_AREA.has(sp.type) ? 2.7 : 0, sp.minWidth ?? 2.0),
          minHeight: sp.minLength ?? sp.minWidth ?? 2.0,
          minArea: Math.max(MAIN_FLOOR_AREA.has(sp.type) ? 12 : 0, sp.minArea ?? 6, 0.25),
          target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 6, 0.25),
        }));
        return !!solveRow(redFarProbe.w, redFarProbe.h, cells) || !!solveCol(redFarProbe.w, redFarProbe.h, cells);
      };
      const orderedVariants = [
        ...variants.filter(v => nightFitMainFloors(v)),
        ...variants.filter(v => !nightFitMainFloors(v)),
      ];
      for (const v of orderedVariants) {
        for (const cfg of stripCfgs) {
          const dayRectCfg = orient.dayOnStreet ? cfg.redStreet : cfg.redFar;
          const nightRectCfg = orient.dayOnStreet ? cfg.redFar : cfg.redStreet;
          const dayArea = rArea(dayRectCfg);
          const nightArea = rArea(nightRectCfg);
          const dayMin = v.day.reduce((a, s) => a + (s.minArea ?? 6), 0);
          const nightMin = v.night.reduce((a, s) => a + (s.minArea ?? 6), 0);
          if (dayMin > dayArea || nightMin > nightArea) continue;

          // ---- entry-band mode (far strip + day on street + N/S access +
          // vertical cut): carve a full-width entry band (entrance / guest WC /
          // foyer, foyer at the CUT end) from the street edge of the day wing
          // BEFORE running the placer on the remainder. The foyer then touches
          // the bridge strip directly, so the wings join circulation-to-
          // circulation and no habitable room becomes a pass-through.
          const ENTRY_TYPES = new Set(['entrance', 'foyer', 'guest-wc']);
          const useEntryBand = cfg.side === 'far' && orient.dayOnStreet
            && access !== 'east' && access !== 'west' && cut!.axis === 'x'
            && v.day.some(sp => ENTRY_TYPES.has(sp.type))
            && v.day.some(sp => !ENTRY_TYPES.has(sp.type));
          let dayRectEff: Rect = dayRectCfg;
          let preEntry: Space[] = [];
          let entryRes: { spaces: Space[]; corridors: Space[]; explanation: string[] } = { spaces: [], corridors: [], explanation: [] };
          const dayList = v.day;
          if (useEntryBand) {
            const entrySpecs = v.day.filter(sp => ENTRY_TYPES.has(sp.type));
            const restSpecs = v.day.filter(sp => !ENTRY_TYPES.has(sp.type));
            const BAND_H = 1.8;
            if (dayRectCfg.h > BAND_H + 3.0) {
              const bandRect: Rect = access === 'south'
                ? { x: dayRectCfg.x, y: dayRectCfg.y, w: dayRectCfg.w, h: BAND_H }
                : { x: dayRectCfg.x, y: dayRectCfg.y + dayRectCfg.h - BAND_H, w: dayRectCfg.w, h: BAND_H };
              dayRectEff = access === 'south'
                ? { x: dayRectCfg.x, y: dayRectCfg.y + BAND_H, w: dayRectCfg.w, h: dayRectCfg.h - BAND_H }
                : { x: dayRectCfg.x, y: dayRectCfg.y, w: dayRectCfg.w, h: dayRectCfg.h - BAND_H };
              // Foyer goes to the CUT end of the band (east when the street
              // wing is left of the cut) so it meets the bridge strip, and it
              // stays adjacent to the entrance (entry sequence constraint).
              const eastness = (t: string) => (t === 'guest-wc' ? 0 : t === 'entrance' ? 1 : 2);
              const ordered = [...entrySpecs].sort((a, b) =>
                nearLeft ? eastness(a.type) - eastness(b.type) : eastness(b.type) - eastness(a.type));
              const cells: BandCellDemand[] = ordered.map(sp => ({
                type: sp.type,
                minWidth: sp.minWidth ?? 1.2,
                minHeight: 1.0,
                minArea: Math.max(sp.minArea ?? 2, 0.25),
                target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 2, 0.25),
              }));
              const bandSol = solveRow(bandRect.w, BAND_H, cells);
              if (bandSol) {
                // x positions west→east; the foyer cell must end at cutEnd.
                const widths = bandSol.cells.map(c => c.flow);
                const sumW = widths.reduce((a, b) => a + b, 0);
                const slack = Math.max(0, bandRect.w - sumW);
                let cx = nearLeft ? bandRect.x + slack : bandRect.x;
                preEntry = [];
                for (let i = 0; i < ordered.length; i++) {
                  const sp = ordered[i];
                  const r: Rect = { x: cx, y: bandRect.y, w: widths[i], h: BAND_H };
                  cx += widths[i];
                  if (widths[i] < (sp.minWidth ?? 1.2) - 1e-9 || widths[i] * BAND_H < (sp.minArea ?? 2) - 1e-9) { preEntry = []; break; }
                  preEntry.push(mkSpace(sp.type as SpaceType, r, sp.placedLabel, sp.placedId, zoneFor(sp.type)));
                }
                if (preEntry.length > 0) {
                  entryRes = { spaces: preEntry, corridors: [], explanation: [`[entry band] Phase 25: entrance/guest-WC/foyer tiled along the street edge (foyer at the cut end, touching the bridge strip).`] };
                }
              }
              if (preEntry.length === 0) { dayRectEff = dayRectCfg; }
              var dayListEff = restSpecs.length > 0 ? restSpecs : v.day;
              if (preEntry.length === 0) var dayListEff = v.day;
            } else {
              var dayListEff = v.day;
            }
          } else {
            var dayListEff = v.day;
          }
          // P31-P1: kitchen-moved variants pre-reserve the cut-side band of
          // the day wing for the link corridor, so the day placer packs the
          // remaining width and the connector corridor is guaranteed a free,
          // gated path between the entry band and the north circulation.
          let connectorRect: Rect | null = null;
          if (v.connector === true && preEntry.length > 0
            && cut!.axis === 'x' && access !== 'east' && access !== 'west') {
            const stripEastOfDay = Math.abs(cfg.strip.x - (dayRectCfg.x + dayRectCfg.w)) < 0.01;
            const stripWestOfDay = Math.abs(cfg.strip.x + cfg.strip.w - dayRectCfg.x) < 0.01;
            if (stripEastOfDay || stripWestOfDay) {
              const base = dayRectEff;
              const cand: Rect = stripEastOfDay
                ? { x: base.x + base.w - L_CONNECTOR_W, y: base.y, w: L_CONNECTOR_W, h: base.h }
                : { x: base.x, y: base.y, w: L_CONNECTOR_W, h: base.h };
              if (cand.h >= 1.2) {
                connectorRect = cand;
                dayRectEff = stripEastOfDay
                  ? { x: base.x, y: base.y, w: base.w - L_CONNECTOR_W, h: base.h }
                  : { x: base.x + L_CONNECTOR_W, y: base.y, w: base.w - L_CONNECTOR_W, h: base.h };
              }
            }
          }
          // P31-P1: in the carved (connector-twin) region the day content is
          // placed as full-width rows via the M4 row solver first — every row
          // then touches the connector corridor on the cut side (door pass
          // wires room↔connector directly, no in-region spine needed) and the
          // rows keep their full min-area contract, which the spine-synthesizing
          // placer could not guarantee in the narrower region. A connector twin
          // whose rows do not fit is skipped outright — falling back to the
          // placer in the narrower region would only squeeze rooms below the
          // unusable floor and pollute the infeasible diagnostics.
          const dayCarved = v.connector === true && preEntry.length > 0 && dayRectEff.w < dayRectCfg.w - 0.01;
          const dayRowsRes = dayCarved ? bandTileNight(dayRectEff, dayListEff, false, 6) : null;
          if (dayCarved && !dayRowsRes) continue;
          const dayRes = dayRowsRes ?? (preEntry.length > 0
            ? place(dayRectEff, aimMainRooms(dayListEff))
            : place(dayRectCfg, aimMainRooms(dayListEff)));
          const nightRes = v.night.length <= 2
            ? (bandTileNight(nightRectCfg, v.night, cut!.axis === 'x') ?? place(nightRectCfg, aimMainRooms(v.night)))
            : place(nightRectCfg, aimMainRooms(v.night));
          const dayAll: { spaces: Space[]; corridors: Space[]; explanation: string[] } = { spaces: [...entryRes.spaces, ...dayRes.spaces], corridors: [...entryRes.corridors, ...dayRes.corridors], explanation: [...entryRes.explanation, ...dayRes.explanation] };
          if (!covered(dayListEff, dayAll) || !covered(v.night, nightRes)) {
            const miss = (list: PlacedSpec[], res: { spaces: Space[] }) =>
              list.filter(sp => !res.spaces.some(x => x.id === sp.placedId)).map(x => x.type).join(',');
            continue;
          }
          const bridgeSpace = mkSpace('corridor', cfg.strip, 'Corridor', 'corridor-bridge', 'circulation');
          const all = [...dayAll.spaces, ...nightRes.spaces, bridgeSpace];
          // Geometry-authoritative gates — accepted only when the actual
          // placed rectangles are collision-free and nothing leaves the
          // L-shaped buildable polygon (the notch stays empty).
          if (hasOverlappingRooms(all)) continue;
          // P31-P1: unusable-floor gate — rooms below the Phase-13.2 usable
          // minimum (0.85 m per edge) never leave this stage, not even as
          // rejected candidates: the infeasible reporter must keep its
          // "diagnostics stay ≥ 0.85" promise.
          if (all.some(sp => sp.rect.w < 0.85 || sp.rect.h < 0.85)) continue;
          if (!all.every(s => rectInsidePolygon(s.rect, buildableBoundary, 1e-3))) {
            const out = all.filter(sp => !rectInsidePolygon(sp.rect, buildableBoundary, 1e-3))
              .map(sp => `${sp.type}@${sp.rect.x.toFixed(1)},${sp.rect.y.toFixed(1)}+${sp.rect.w.toFixed(1)}x${sp.rect.h.toFixed(1)}`);
            void out;
            continue;
          }
          // Daylight-aware acceptance: a habitable room fully covered by
          // other rooms on all four edges can never get an exterior wall —
          // reject the variant so the generic planner gets its turn.
          if (all.some(sp => DAYLIGHT_HABITABLE.has(sp.type) && isFullyInterior(sp.rect, all))) continue;
          // ---- P31-P1 circulation completion --------------------------------
          // Geometry-level connectivity proxy (the door pass doors every
          // adjacent circulation pair). Kitchen-moved variants pre-reserve a
          // cut-side connector band (connectorRect); other plans fall back to
          // a deterministic free-strip scan. Either way the connector is
          // emitted only when it passes every geometry gate and actually
          // connects the corridor system to the entry spaces.
          const circSpacesNow = [bridgeSpace, ...dayAll.corridors, ...nightRes.corridors];
          let circOk = circulationConnected([...all, ...circSpacesNow]);
          let connectorSpace: Space | null = null;
          const tryConnector = (cand: Rect): void => {
            if (cand.h < 1.2 || cand.w < 1.2) return;
            const occupied = [...all, ...circSpacesNow];
            if (occupied.some(sp => rOverlapArea(cand, sp.rect) > 1e-3)) return;
            const candidate = mkSpace('corridor', cand, 'Corridor', 'corridor-link', 'circulation');
            const allC = [...all, candidate];
            if (hasOverlappingRooms(allC)) return;
            if (!allC.every(s2 => rectInsidePolygon(s2.rect, buildableBoundary, 1e-3))) return;
            connectorSpace = candidate;
          };
          if (connectorRect) {
            tryConnector(connectorRect);
          } else if (!circOk && preEntry.length > 0 && access !== 'east' && access !== 'west' && cut!.axis === 'x') {
            const stripEastOfDay = Math.abs(cfg.strip.x - (dayRectCfg.x + dayRectCfg.w)) < 0.01;
            const stripWestOfDay = Math.abs(cfg.strip.x + cfg.strip.w - dayRectCfg.x) < 0.01;
            if (stripEastOfDay || stripWestOfDay) {
              const south = access === 'south';
              const bandTopY = south
                ? dayRectCfg.y + L_BAND_H
                : dayRectCfg.y + dayRectCfg.h - L_BAND_H;
              const compNow = circulationComponent([...all, ...circSpacesNow]);
              const disc = circSpacesNow.filter(c => c.type === 'corridor' && !compNow.has(c.id));
              for (let i = 0; i <= 40 && !connectorSpace; i++) {
                const x = stripEastOfDay
                  ? dayRectCfg.x + dayRectCfg.w - L_CONNECTOR_W - i * 0.1
                  : dayRectCfg.x + i * 0.1;
                // anchor the connector at the entry band; cap it at the nearest
                // disconnected-corridor edge so corridors touch, not overlap
                let bestEdge: number | null = null;
                for (const d of disc) {
                  const xOv = Math.min(x + L_CONNECTOR_W, d.rect.x + d.rect.w) - Math.max(x, d.rect.x);
                  if (xOv < L_CIRC_LINK) continue;
                  const edge = south ? d.rect.y : d.rect.y + d.rect.h;
                  const beyond = south ? edge > bandTopY + 1e-6 : edge < bandTopY - 1e-6;
                  if (!beyond) continue;
                  if (bestEdge === null || (south ? edge < bestEdge : edge > bestEdge)) bestEdge = edge;
                }
                if (bestEdge === null) continue;
                const cand: Rect = south
                  ? { x, y: bandTopY, w: L_CONNECTOR_W, h: bestEdge - bandTopY }
                  : { x, y: bestEdge, w: L_CONNECTOR_W, h: bandTopY - bestEdge };
                if (!disc.some(d => sharedEdgeLen(cand, d.rect) >= L_CIRC_LINK)) continue;
                const compSpaces = circSpacesNow.filter(c => compNow.has(c.id));
                const entrySpaces = all.filter(s2 => s2.type === 'entrance' || s2.type === 'foyer');
                const compAnchors = [...compSpaces, ...entrySpaces];
                if (!compAnchors.some(c => sharedEdgeLen(cand, c.rect) >= L_CIRC_LINK)) continue;
                tryConnector(cand);
              }
            }
          }
          if (connectorSpace) {
            circOk = circulationConnected([...all, connectorSpace, ...circSpacesNow]);
            if (!circOk) connectorSpace = null; // honest: only keep a connector that actually connects
          }
          // P29-B FIX 2 — wing-residual metrics for the balance ranking (no
          // thresholds changed; purely a selection order among gate-passers).
          // A balanced variant may only displace the ladder-first plan when it
          // satisfies the same min-dimension contract the pipeline's Phase-13.2
          // hard gate enforces (same tolerances) — otherwise a balanced-but-
          // undersized plan could displace a compliant one and be excluded
          // downstream anyway. Violating variants stay accepted (first-accept
          // semantics preserved when NOTHING compliant exists).
          const specById = new Map<string, PlacedSpec>();
          for (const sp of [...v.day, ...v.night]) specById.set(sp.placedId, sp);
          const dimContractOk = all.every(s => {
            const spec = specById.get(s.id);
            if (!spec) return true; // bridge/synthesized corridor rooms
            const minW = spec.minWidth ?? 0.9;
            const minL = spec.minLength ?? spec.minWidth ?? 0.9;
            const minA = spec.minArea ?? 0;
            if (s.rect.w + 1e-6 < minW - 0.05) return false;
            if (s.rect.h + 1e-6 < minL - 0.05) return false;
            if (minA > 1e-6 && s.rect.w * s.rect.h + 1e-6 < minA - 0.1) return false;
            return true;
          });
          const { imbalance, totalResidual } = wingResidualStats(all, street, other);
          // P35: conservative downstream-failure proxy — the plan may only
          // outrank others on circulation when it also mirrors downstream
          // daylight / direct-access validity (see downstreamProxyOk).
          const downstreamOk = downstreamProxyOk([...all, ...circSpacesNow, ...(connectorSpace ? [connectorSpace] : [])]);
          acceptedWingPlans.push({
            spaces: [...dayAll.spaces, ...nightRes.spaces],
            corridors: [...dayAll.corridors, ...nightRes.corridors, bridgeSpace, ...(connectorSpace ? [connectorSpace] : [])],
            lines: [
              `Phase 25 L-wings: plan ACCEPTED (${split.note}; ${orient.note}; ${v.note}; ${cfg.note}${connectorSpace ? '; corridor-link added' : ''}) — day ${v.day.length} room(s) on ${dayRectCfg.w.toFixed(1)}x${dayRectCfg.h.toFixed(1)} m, night ${v.night.length} on ${nightRectCfg.w.toFixed(1)}x${nightRectCfg.h.toFixed(1)} m, bridge strip ${cfg.strip.w.toFixed(1)}x${cfg.strip.h.toFixed(1)} m on the shared cut.`,
              ...dayAll.explanation.map(e => `[day wing] ${e}`),
              ...nightRes.explanation.map(e => `[night wing] ${e}`),
            ],
            imbalance,
            totalResidual,
            dimContractOk,
            circulationOk: circOk,
            downstreamOk,
          });
        }
      }
    }
  }

  // P29-B FIX 2 — deterministic selection among the gate-passing wing plans:
  // lowest wing-residual imbalance first, then lowest total residual, then the
  // existing ladder order (strict < comparisons keep the earliest plan on
  // ties). With no feasible wing plan the entry-annex fallback below runs
  // exactly as before.
  if (acceptedWingPlans.length > 0) {
    // P33-P3: same-wing master suite — mirrors the soft p-mb-mbath adjacency
    // constraint (any positive shared wall edge, the same relationship the
    // validator's CONSTRAINT_PREFER_ADJACENT pass rewards).
    const suiteAdjacent = (p: { spaces: Space[] }): boolean => {
      const mbr = p.spaces.find(s => s.type === 'master-bedroom');
      const mbath = p.spaces.find(s => s.type === 'master-bathroom');
      return !!mbr && !!mbath && sharedEdgeLen(mbr.rect, mbath.rect) > 1e-6;
    };
    // P35: a plan that fails the downstream mirror must never displace a
    // downstream-valid one; when NO accepted plan passes the mirror, yield to
    // the caller's generic region planner (the same path these sites took
    // before circulation-preference twins existed) instead of returning a
    // plan known to violate daylight/direct-access rules downstream.
    const eligibleWingPlans = acceptedWingPlans.filter(c => c.downstreamOk);
    if (eligibleWingPlans.length === 0) {
      explanation.push('Phase 25 L-wings: no wing plan passed the downstream daylight / direct-access mirror — falling back to the generic region planner.');
      return null;
    }
    const preferAdj = opts.preferProgrammeAdjacency === true;
    const adjKeyCache = new Map<object, [number, number]>();
    const adjKey = (p: { spaces: Space[]; corridors: Space[] }): [number, number] => {
      let k = adjKeyCache.get(p);
      if (!k) { k = programmeAdjacencyKey(specs, p); adjKeyCache.set(p, k); }
      return k;
    };
    let best = eligibleWingPlans[0];
    for (const c of eligibleWingPlans) {
      if (c.dimContractOk !== best.dimContractOk) {
        if (c.dimContractOk) best = c;
        continue;
      }
      // P31-P1: a circulation-connected plan always beats a disconnected one
      // (the door pass turns the connector adjacency into spine doors).
      if (c.circulationOk !== best.circulationOk) {
        if (c.circulationOk) best = c;
        continue;
      }
      // Phase 5.3B (opt-in): both plans already pass every mandatory gate
      // (downstream mirror via eligibleWingPlans, dimension contract, circulation)
      // — only then may programme adjacency decide, and only strictly.
      if (preferAdj && c.dimContractOk && c.circulationOk && best.dimContractOk && best.circulationOk) {
        const kc = adjKey(c), kb = adjKey(best);
        if (kc[0] !== kb[0] || kc[1] !== kb[1]) {
          if (kc[0] > kb[0] || (kc[0] === kb[0] && kc[1] > kb[1])) best = c;
          continue;
        }
      }
      if (c.imbalance < best.imbalance - 1e-9) best = c;
      else if (c.imbalance <= best.imbalance + 1e-9 && c.totalResidual < best.totalResidual - 1e-9) best = c;
      // P33-P3: on an EXACT tie of every existing metric (dimension contract,
      // circulation connectivity, imbalance, residual), prefer the plan that
      // keeps the master suite in one wing. Deterministic; never overrides a
      // strictly better plan; weights and thresholds untouched.
      else if (c.imbalance <= best.imbalance + 1e-9 && c.totalResidual <= best.totalResidual + 1e-9
        && suiteAdjacent(c) && !suiteAdjacent(best)) best = c;
    }
    explanation.push(...best.lines);
    return {
      spaces: best.spaces,
      corridors: best.corridors,
      explanation,
    };
  }

  // ---- Entry-annex fallback (south access; axis-y Ls like SW: the street
  // wing is a shallow stub that cannot host the day program, while the deep
  // main block can). The stub carries the entry sequence full-width
  // (entrance row on the street facade, guest WC + foyer on the cut edge).
  // The main block is tiled by hand: a corridor row on the cut edge, the
  // living room in the cut corner directly above the foyer (the program's
  // foyer-living adjacency), and a central spine with a private stack (west)
  // and a public stack (east). Every habitable room becomes a circulation
  // leaf, so no room is a pass-through. The stub must be wide enough for the
  // foyer to span both the corridor row and the living corner
  // (door 0.9 + living 3.0); narrower stubs (3 m SE-style) stay honestly
  // infeasible — the foyer-living adjacency cannot coexist with wing
  // circulation there.
  if (access === 'south') {
    const sortedAnnex = [...buildableRects].sort((a, b) =>
      faceDistOf(a) - faceDistOf(b) || rArea(b) - rArea(a) || a.x - b.x || a.y - b.y);
    const street = sortedAnnex[0];
    const other = sortedAnnex[1];
    const ENTRY_TYPES = new Set(['entrance', 'foyer', 'guest-wc']);
    const specByType = new Map(specs.filter(sp => ENTRY_TYPES.has(sp.type)).map(sp => [sp.type, sp]));
    const restSpecs = specs.filter(sp => !ENTRY_TYPES.has(sp.type) && sp.type !== 'corridor');
    const restMin = restSpecs.reduce((a, sp) => a + (sp.minArea ?? 6), 0);
    const entr = specByType.get('entrance');
    const foyer = specByType.get('foyer');
    const gwc = specByType.get('guest-wc');
    const bedSpec = restSpecs.find(sp => sp.type === 'bedroom');
    const masterSpec = restSpecs.find(sp => sp.type === 'master-bedroom');
    const mbaSpec = restSpecs.find(sp => sp.type === 'master-bathroom');
    const kitchenSpec = restSpecs.find(sp => sp.type === 'kitchen');
    const diningSpec = restSpecs.find(sp => sp.type === 'dining');
    const streetTooSmall = restMin > rArea(street);
    const livingSpec = restSpecs.find(sp => sp.type === 'living');
    const STUB_MIN_W = 5.5; // foyer must span a 0.9 door onto the corridor row plus the 3.0 m living corner
    if (streetTooSmall && rArea(other) >= restMin && entr && foyer && gwc && livingSpec
      && bedSpec && masterSpec && mbaSpec && kitchenSpec && diningSpec
      && street.w >= STUB_MIN_W - EPS && street.h >= 3.3 - 1e-6
      && other.w >= 3 + 1.5 + EPS && other.h >= 1.5 + 5.3 + EPS) {
      const mkAnnexSpace = (sp: PlacedSpec, r: Rect): Space =>
        mkSpace(sp.type as SpaceType, r, sp.placedLabel, sp.placedId, zoneFor(sp.type));
      // stub: entrance row on the street, then [guest WC | foyer] on the cut
      const h1 = 1.5;
      const backY = street.y + h1;
      const backH = street.h - h1;
      const gwcW = Math.max(1.1, Math.min(1.8, street.w * 0.25));
      const foyerW = street.w - gwcW;
      const annexSpaces: Space[] = [
        mkAnnexSpace(entr, { x: street.x, y: street.y, w: street.w, h: h1 }),
        mkAnnexSpace(gwc, { x: street.x, y: backY, w: gwcW, h: backH }),
        mkAnnexSpace(foyer, { x: street.x + gwcW, y: backY, w: foyerW, h: backH }),
      ];
      // main block: living corner over the foyer, corridor row west of it
      const livingW = 3;
      const livingX = other.x + other.w - livingW;
      const livingH = Math.max(3.0, 12 / livingW);
      const corrW = livingX - other.x; // corridor row reaches the living corner's west edge
      const restY = other.y + 1.5;
      const restH = other.h - 1.5;
      const mainSpaces: Space[] = [];
      let tilingOk = corrW >= 2.5 + EPS && foyerW + street.x > livingX - 3 + 0.9
        && livingX >= street.x + gwcW
        && restH >= Math.max(2.8 + 2.5, 2.4 + 2.0 + 1.5) + EPS;
      if (tilingOk) {
        mainSpaces.push(mkAnnexSpace(livingSpec, { x: livingX, y: other.y, w: livingW, h: livingH }));
        const corridorSpec = specs.find(sp => sp.type === 'corridor');
        const corridorSpace = corridorSpec
          ? mkAnnexSpace(corridorSpec, { x: other.x, y: other.y, w: corrW, h: 1.5 })
          : mkSpace('corridor', { x: other.x, y: other.y, w: corrW, h: 1.5 }, 'Corridor', 'corridor-main', 'circulation');
        mainSpaces.push(corridorSpace);
        // central spine + private (west) and public+wet (east) stacks
        const westW = corrW;
        const spineW = 1.5;
        const leftW = (westW - spineW) / 2;
        const rightW = westW - spineW - leftW;
        const spineX = other.x + leftW;
        const spine: Space = mkSpace('corridor', { x: spineX, y: restY, w: spineW, h: restH }, 'Corridor', 'corridor-spine', 'circulation');
        mainSpaces.push(spine);
        const privCells: BandCellDemand[] = [masterSpec, bedSpec].map(sp => ({
          type: sp.type, minWidth: sp.minWidth ?? 2.5,
          minHeight: sp.type === 'master-bedroom' ? 2.8 : 2.5,
          minArea: 12, target: Math.max(sp.targetArea ?? 0, 12),
        }));
        const pubCells: BandCellDemand[] = [diningSpec, kitchenSpec, mbaSpec].map(sp => ({
          type: sp.type, minWidth: sp.minWidth ?? 2.4,
          minHeight: sp.type === 'dining' ? 2.4 : sp.type === 'kitchen' ? 2.0 : 1.5,
          minArea: sp.type === 'dining' ? 12 : sp.type === 'kitchen' ? 5.5 : 3.4,
          target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 5.5),
        }));
        const privSol = solveCol(leftW, restH, privCells);
        const pubSol = solveCol(rightW, restH, pubCells);
        tilingOk = !!privSol && !!pubSol;
        if (privSol && pubSol) {
          const privSpecs = [masterSpec, bedSpec];
          let cy = restY;
          for (let i = 0; i < privSpecs.length; i++) {
            const h = privSol.cells[i].flow;
            mainSpaces.push(mkAnnexSpace(privSpecs[i], { x: other.x, y: cy, w: leftW, h }));
            cy += h;
          }
          const pubSpecs = [diningSpec, kitchenSpec, mbaSpec];
          cy = restY;
          for (let i = 0; i < pubSpecs.length; i++) {
            const h = pubSol.cells[i].flow;
            mainSpaces.push(mkAnnexSpace(pubSpecs[i], { x: spineX + spineW, y: cy, w: rightW, h }));
            cy += h;
          }
        }
      }
      const all = [...annexSpaces, ...mainSpaces];
      const coveredAll = [entr, foyer, gwc, livingSpec].every(sp => all.some(x => x.id === sp.placedId))
        && covered([bedSpec, masterSpec, mbaSpec, kitchenSpec, diningSpec], { spaces: mainSpaces });
      if (tilingOk && coveredAll && !hasOverlappingRooms(all)
        && all.every(sp => rectInsidePolygon(sp.rect, buildableBoundary, 1e-3))
        && !all.some(sp => DAYLIGHT_HABITABLE.has(sp.type) && isFullyInterior(sp.rect, all))) {
        const explanation: string[] = [];
        explanation.push(
          `Phase 25 L-wings: entry-annex plan — entrance/guest-WC/foyer tile the street stub (${street.w.toFixed(1)}x${street.h.toFixed(1)} m, foyer on the cut edge), main block (${other.w.toFixed(1)}x${other.h.toFixed(1)} m) carries living at the cut corner (foyer adjacency) plus a spine with private/public stacks.`,
        );
        return {
          spaces: all,
          corridors: [],
          explanation,
        };
      }
    }
  }

  explanation.push('Phase 25 L-wings: no wing allocation passed the placer verdict / collision gates — falling back to the generic region planner.');
  return null;
}
