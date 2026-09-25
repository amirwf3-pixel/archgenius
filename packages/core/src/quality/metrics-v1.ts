/**
 * Phase 5.1b — Architectural Quality Metrics V1.
 *
 * Pure, deterministic, mathematically defined metrics. Implemented here:
 *   1. leftover / residual area   (computeResidualMetrics)
 *   2. parking / site usability   (computeParkingMetrics)
 *   3. programme adjacency        (computeAdjacencyMetrics + programAdjacencyByType)
 *   4. circulation efficiency     (computeCirculationMetrics)
 * Phase 5.1b-2 adds:
 *   5. room usability / proportion (computeRoomUsabilityMetrics)
 *   6. daylight                    (computeDaylightMetrics)
 *   7. privacy                     (computePrivacyMetrics)
 *   8. vertical stair/elevator integration (computeVerticalMetrics)
 *
 * Scope guarantees:
 *   - no weighted composite score: every result is a vector of independent values;
 *   - not wired into ranking, the manifest, the UI, the generator, regulations or DXF;
 *   - no regulatory thresholds: the only threshold used (fragment usability) is taken
 *     from the programme's own per-space `minWidth`, never invented;
 *   - not-applicable metrics are `value: null` (never a vacuous 1 or 0);
 *   - inputs are never mutated.
 *
 * Domain-model findings this module relies on (verified by inspection at 75216a7,
 * pinned by tests in metrics-v1.test.ts):
 *
 *   (Q1) Space polygons are WALL-CENTRELINE cells. `generator/walls.ts` derives every
 *        wall from room-polygon edges and `model/wall.ts` documents `start`/`end` as
 *        the wall centreline; on the canonical rect and L-shape layouts every wall
 *        segment lies on an edge of each space it bounds (115/115 walls, 48/48
 *        two-sided walls coincide with the edges of BOTH neighbours) and adjacent
 *        spaces share edges with no gap. Wall thickness is therefore NOT excluded
 *        from space polygons: spaces tile each other edge-to-edge, and an exterior
 *        wall's outer half-thickness lies OUTSIDE every space. P17-C compaction
 *        (`layout/compaction.ts`) pads `floor.footprint` by max(wall thickness)/2 so
 *        that band is inside the envelope. Residual analysis therefore counts wall
 *        bodies (segment ± thickness/2, with end caps) as occupied, so that band is
 *        not misreported as leftover area.
 *        Spaces do NOT generally tile the footprint: the ground floor keeps an
 *        unassigned zone beside the parking band, and upper floors are compacted.
 *
 *   (Q2) `preferredAspectRatio` is NOT populated by the generator. `makeSpec` in
 *        `programming/program.ts` never sets it and no `programForFloor` override
 *        supplies it; the generator only passes `spec.preferredAspectRatio` through
 *        (undefined). Every space in the canonical layouts has it undefined. It is
 *        not used here (room proportion belongs to 5.1b-2, where it must yield null).
 *
 *   Real footprint geometry: `Floor.footprint` is a bounding Rect (after P17-C
 *   compaction, the bbox of placed geometry clipped to the buildable rect). The
 *   generator also stamps an untyped runtime field `buildableBoundary` (the canonical
 *   buildable polygon, 6 vertices for an L-shape) and `siteBoundary` on every floor.
 *   The analysed envelope is `buildableBoundary ∩ footprint`. When the polygon is
 *   absent (hand-built fixtures), the footprint rect itself is the envelope and
 *   `envelopeSource` says so explicitly.
 */
import type { Floor } from '../model/floor.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Space, SpaceType, AdjacencyRequirement } from '../model/space.js';
import type { Rect } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import { pointInPolygon, polygonCentroid, polygonSignedArea } from '../geometry/polygon-ops.js';
import { hasDirectAccess } from '../intelligence/graph.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import { rOverlapArea } from '../geometry/rect.js';
import { stairFootprintOverlap } from '../intelligence/vertical-circulation.js';
import { stepFreeReachable } from '../validation/accessibility.js';

export const QUALITY_METRICS_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Shared value type
// ---------------------------------------------------------------------------

export type QualityBasis = 'GEOMETRIC' | 'PROGRAM';

/** value = num / den in [0,1], higher is better; null when den <= 0 (not applicable). */
export interface MetricValue {
  value: number | null;
  num: number;
  den: number;
  basis: QualityBasis;
}

export function metricRatio(num: number, den: number, basis: QualityBasis): MetricValue {
  return { value: den > 0 ? num / den : null, num, den, basis };
}

const notApplicable = (basis: QualityBasis): MetricValue => ({ value: null, num: 0, den: 0, basis });

/** Runtime extras the generator stamps on floors (not declared on `Floor`). */
interface FloorRuntimeGeometry {
  buildableBoundary?: Polygon;
  siteBoundary?: Polygon;
}

const EPS = 1e-6;
/** Coordinate snap (0.1 mm) so float noise such as 1.7999999999999998 cannot create sliver cells. */
const SNAP = 1e4;
const snap = (v: number): number => Math.round(v * SNAP) / SNAP;

const rectArea = (r: Rect): number => r.w * r.h;
const validRect = (r: Rect | undefined | null): r is Rect =>
  !!r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0;
const validPolygon = (p: unknown): p is Polygon => Array.isArray(p) && p.length >= 3;
const inRectOpen = (p: Vec2, r: Rect): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------------------------------------------------------------------------
// 1. Residual / leftover area
// ---------------------------------------------------------------------------

export interface ResidualFragment {
  area: number;
  bbox: Rect;
  /** min(bbox.w, bbox.h) — descriptive only (a thin ring can have a large bbox). */
  minSide: number;
  /** true when an axis-aligned t×t square (t = usableWidthThreshold) fits entirely
   *  inside the fragment; null when the threshold is null. */
  fitsUsableSquare: boolean | null;
}

export interface ResidualMetrics {
  envelopeSource: 'buildableBoundary∩footprint' | 'footprint-rect';
  /** Area of the analysed envelope (real polygon ∩ footprint), m². */
  envelopeArea: number;
  /** Area of the footprint bounding rect, reported only for comparison, m². */
  footprintRectArea: number;
  /** Envelope area covered by spaces, wall bodies, stairs, elevators, stalls and aisle, m². */
  occupiedArea: number;
  residualArea: number;
  /** occupiedArea / envelopeArea */
  coverage: MetricValue;
  /** Connected residual components (4-neighbour), sorted by area desc, then y, then x. */
  fragments: ResidualFragment[];
  fragmentCount: number;
  largestFragmentArea: number | null;
  /** min Space.minWidth on this floor (programme data); null if no space declares one. */
  usableWidthThreshold: number | null;
  /** Σ area of fragments that cannot contain a t×t square (t = usableWidthThreshold);
   *  null if the threshold is null. */
  unusableArea: number | null;
  unusableFragmentCount: number | null;
  /** Walls that are not axis-aligned cannot be rasterised exactly and are skipped. */
  skippedNonAxisWalls: number;
}

type Occupant = { rect: Rect } | { poly: Polygon };

/**
 * True when an axis-aligned t×t square fits inside the fragment (cells owned by fragId).
 * For a union of grid cells, if any such square fits, one fits with its lower-left
 * corner on a grid-line intersection (slide it left, then down, until it meets the
 * boundary, which consists of grid lines), so testing those corners is exact.
 */
function squareFits(cells: Int32Array, fragId: number, owner: Int32Array, xs: number[], ys: number[], nx: number, ny: number, t: number): boolean {
  const firstAtLeast = (arr: number[], v: number): number => {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] >= v - EPS) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    return ans;
  };
  for (const idx of cells) {
    const j = Math.floor(idx / nx), i = idx % nx;
    const i2 = firstAtLeast(xs, xs[i] + t); // square spans cells i .. i2-1
    const j2 = firstAtLeast(ys, ys[j] + t);
    if (i2 < 0 || j2 < 0 || i2 > nx || j2 > ny) continue;
    let ok = true;
    for (let jj = j; jj < j2 && ok; jj++) for (let ii = i; ii < i2; ii++) if (owner[jj * nx + ii] !== fragId) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

function wallRect(w: Floor['walls'][number]): Rect | null {
  if (!w?.start || !w?.end) return null;
  const t = Math.max(0, w.thickness ?? 0) / 2;
  const x0 = Math.min(w.start.x, w.end.x), x1 = Math.max(w.start.x, w.end.x);
  const y0 = Math.min(w.start.y, w.end.y), y1 = Math.max(w.start.y, w.end.y);
  const horizontal = Math.abs(y1 - y0) < EPS;
  const vertical = Math.abs(x1 - x0) < EPS;
  if (!horizontal && !vertical) return null;
  // centreline ± t on every side (end caps included so corners are closed)
  const r = { x: x0 - t, y: y0 - t, w: x1 - x0 + 2 * t, h: y1 - y0 + 2 * t };
  return r.w > 0 && r.h > 0 ? r : null;
}

function isAxisRectPolygon(poly: Polygon, rect: Rect): boolean {
  if (poly.length !== 4) return false;
  return poly.every(p =>
    (Math.abs(p.x - rect.x) < EPS || Math.abs(p.x - (rect.x + rect.w)) < EPS) &&
    (Math.abs(p.y - rect.y) < EPS || Math.abs(p.y - (rect.y + rect.h)) < EPS));
}

function spaceOccupant(s: Space): Occupant | null {
  const poly = (s as Partial<Space>).polygon;
  if (validPolygon(poly) && !(validRect(s.rect) && isAxisRectPolygon(poly, s.rect))) return { poly };
  return validRect(s.rect) ? { rect: s.rect } : validPolygon(poly) ? { poly } : null;
}

function occupantCovers(o: Occupant, p: Vec2): boolean {
  return 'rect' in o ? inRectOpen(p, o.rect) : pointInPolygon(p, o.poly);
}

/**
 * Leftover area inside the real floor envelope.
 *
 * Exact for orthogonal geometry (everything the generator emits): all boundary
 * coordinates become grid lines of a coordinate-compressed grid, so each cell is
 * wholly inside or outside every shape and cell-centre tests are exact.
 */
export function computeResidualMetrics(floor: Floor): ResidualMetrics {
  const fp = floor.footprint;
  const rt = floor as Floor & FloorRuntimeGeometry;
  const hasPoly = validPolygon(rt.buildableBoundary);
  const envelopeSource: ResidualMetrics['envelopeSource'] = hasPoly ? 'buildableBoundary∩footprint' : 'footprint-rect';
  const minWidths = (floor.spaces ?? []).map(s => s.minWidth).filter((v): v is number => typeof v === 'number' && v > 0);
  const usableWidthThreshold = minWidths.length ? Math.min(...minWidths) : null;

  const empty = (): ResidualMetrics => ({
    envelopeSource, envelopeArea: 0, footprintRectArea: validRect(fp) ? rectArea(fp) : 0,
    occupiedArea: 0, residualArea: 0, coverage: notApplicable('GEOMETRIC'), fragments: [], fragmentCount: 0,
    largestFragmentArea: null, usableWidthThreshold, unusableArea: usableWidthThreshold === null ? null : 0,
    unusableFragmentCount: usableWidthThreshold === null ? null : 0, skippedNonAxisWalls: 0,
  });
  if (!validRect(fp)) return empty();

  const envelope: Polygon = hasPoly ? rt.buildableBoundary! : [
    { x: fp.x, y: fp.y }, { x: fp.x + fp.w, y: fp.y }, { x: fp.x + fp.w, y: fp.y + fp.h }, { x: fp.x, y: fp.y + fp.h },
  ];

  const occupants: Occupant[] = [];
  for (const s of floor.spaces ?? []) { const o = spaceOccupant(s); if (o) occupants.push(o); }
  let skippedNonAxisWalls = 0;
  for (const w of floor.walls ?? []) {
    const r = wallRect(w);
    if (r) occupants.push({ rect: r });
    else if (w?.start && w?.end) skippedNonAxisWalls++;
  }
  for (const st of floor.stairs ?? []) {
    const r = (st as { footprint?: Rect; rect?: Rect }).footprint ?? (st as { rect?: Rect }).rect;
    if (validRect(r)) occupants.push({ rect: r });
  }
  for (const el of floor.elevators ?? []) if (validRect(el?.rect)) occupants.push({ rect: el.rect });
  for (const p of floor.parkingStalls ?? []) if (validRect(p?.rect)) occupants.push({ rect: p.rect });
  if (validRect(floor.parkingArea?.aisleRect)) occupants.push({ rect: floor.parkingArea!.aisleRect });

  // coordinate compression
  const xsSet = new Set<number>([snap(fp.x), snap(fp.x + fp.w)]);
  const ysSet = new Set<number>([snap(fp.y), snap(fp.y + fp.h)]);
  for (const p of envelope) { xsSet.add(snap(p.x)); ysSet.add(snap(p.y)); }
  for (const o of occupants) {
    if ('rect' in o) { xsSet.add(snap(o.rect.x)); xsSet.add(snap(o.rect.x + o.rect.w)); ysSet.add(snap(o.rect.y)); ysSet.add(snap(o.rect.y + o.rect.h)); }
    else for (const p of o.poly) { xsSet.add(snap(p.x)); ysSet.add(snap(p.y)); }
  }
  const x0 = snap(fp.x), x1 = snap(fp.x + fp.w), y0 = snap(fp.y), y1 = snap(fp.y + fp.h);
  const xs = [...xsSet].filter(v => v >= x0 && v <= x1).sort((a, b) => a - b);
  const ys = [...ysSet].filter(v => v >= y0 && v <= y1).sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return empty();

  // state: 0 = outside envelope, 1 = occupied, 2 = residual
  const state = new Uint8Array(nx * ny);
  let envelopeArea = 0, occupiedArea = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (!pointInPolygon(c, envelope)) continue;
      const a = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      envelopeArea += a;
      let occ = false;
      for (const o of occupants) if (occupantCovers(o, c)) { occ = true; break; }
      if (occ) { occupiedArea += a; state[j * nx + i] = 1; } else state[j * nx + i] = 2;
    }
  }

  // connected residual components (row-major seed order → deterministic)
  const fragments: ResidualFragment[] = [];
  const seen = new Uint8Array(nx * ny);
  const owner = new Int32Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  for (let start = 0; start < state.length; start++) {
    if (state[start] !== 2 || seen[start]) continue;
    const fragId = fragments.length + 1;
    let head = 0, tail = 0, area = 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    seen[start] = 1; queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      owner[idx] = fragId;
      const j = Math.floor(idx / nx), i = idx % nx;
      area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      bx0 = Math.min(bx0, xs[i]); bx1 = Math.max(bx1, xs[i + 1]);
      by0 = Math.min(by0, ys[j]); by1 = Math.max(by1, ys[j + 1]);
      const nb = [j > 0 ? idx - nx : -1, j + 1 < ny ? idx + nx : -1, i > 0 ? idx - 1 : -1, i + 1 < nx ? idx + 1 : -1];
      for (const n of nb) if (n >= 0 && state[n] === 2 && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
    const bbox = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    const fitsUsableSquare = usableWidthThreshold === null ? null
      : squareFits(queue.subarray(0, tail), fragId, owner, xs, ys, nx, ny, usableWidthThreshold);
    fragments.push({ area, bbox, minSide: Math.min(bbox.w, bbox.h), fitsUsableSquare });
  }
  fragments.sort((a, b) => (b.area - a.area) || (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x));

  const residualArea = fragments.reduce((s, f) => s + f.area, 0);
  let unusableArea: number | null = null, unusableFragmentCount: number | null = null;
  if (usableWidthThreshold !== null) {
    const bad = fragments.filter(f => f.fitsUsableSquare === false);
    unusableArea = bad.reduce((s, f) => s + f.area, 0);
    unusableFragmentCount = bad.length;
  }
  return {
    envelopeSource, envelopeArea, footprintRectArea: rectArea(fp), occupiedArea, residualArea,
    coverage: metricRatio(occupiedArea, envelopeArea, 'GEOMETRIC'),
    fragments, fragmentCount: fragments.length,
    largestFragmentArea: fragments.length ? fragments[0].area : null,
    usableWidthThreshold, unusableArea, unusableFragmentCount, skippedNonAxisWalls,
  };
}

// ---------------------------------------------------------------------------
// 2. Parking / site usability
// ---------------------------------------------------------------------------

export interface ParkingMetrics {
  /** floor.parkingRequested (generator-stamped, ground floor, >0) or null. */
  requested: number | null;
  placed: number;
  /** min(placed, requested) / requested */
  fulfilment: MetricValue;
  /** stalls whose rect touches or overlaps the aisle / placed; null without an aisle. */
  aisleAccess: MetricValue;
  /** Aisle edge on accessSide is collinear with a site-boundary edge facing accessSide
   *  (positive overlap length); null when siteBoundary, accessSide or aisle is missing. */
  streetAccess: boolean | null;
  /** Σ stall area / area(stalls ∪ aisle); null without an aisle. */
  stallAreaShare: MetricValue;
}

/** Shared contact of positive length, or positive-area overlap. */
export function rectsTouch(a: Rect, b: Rect, eps = EPS): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox > eps && oy > eps) return true;
  if (ox > eps && Math.abs(oy) <= eps) return true; // horizontal shared edge
  if (oy > eps && Math.abs(ox) <= eps) return true; // vertical shared edge
  return false;
}

/** Exact area of a union of axis-aligned rects (coordinate compression). */
export function rectUnionArea(rects: Rect[]): number {
  const rs = rects.filter(validRect);
  if (!rs.length) return 0;
  const xs = [...new Set(rs.flatMap(r => [snap(r.x), snap(r.x + r.w)]))].sort((a, b) => a - b);
  const ys = [...new Set(rs.flatMap(r => [snap(r.y), snap(r.y + r.h)]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    if (rs.some(r => inRectOpen(c, r))) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return area;
}

type Side = 'north' | 'south' | 'east' | 'west';

/** Convention used across the codebase (generator/openings.ts wallSide): south = min y, north = max y. */
function aisleStreetEdge(r: Rect, side: Side): [Vec2, Vec2] {
  switch (side) {
    case 'south': return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }];
    case 'north': return [{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
    case 'west': return [{ x: r.x, y: r.y }, { x: r.x, y: r.y + r.h }];
    case 'east': return [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }];
  }
}

export function aisleReachesStreet(aisle: Rect, site: Polygon, side: Side, eps = EPS): boolean {
  const ccw = polygonSignedArea(site) > 0;
  const [a0, a1] = aisleStreetEdge(aisle, side);
  const want = { south: { x: 0, y: -1 }, north: { x: 0, y: 1 }, west: { x: -1, y: 0 }, east: { x: 1, y: 0 } }[side];
  for (let i = 0; i < site.length; i++) {
    const p = site[i], q = site[(i + 1) % site.length];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < eps) continue;
    // outward normal: (dy,-dx) for CCW, (-dy,dx) for CW
    const n = ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
    if (Math.abs(n.x - want.x) > 1e-9 || Math.abs(n.y - want.y) > 1e-9) continue;
    if (side === 'south' || side === 'north') {
      if (Math.abs(p.y - a0.y) > eps) continue;
      const ov = Math.min(Math.max(p.x, q.x), a1.x) - Math.max(Math.min(p.x, q.x), a0.x);
      if (ov > eps) return true;
    } else {
      if (Math.abs(p.x - a0.x) > eps) continue;
      const ov = Math.min(Math.max(p.y, q.y), a1.y) - Math.max(Math.min(p.y, q.y), a0.y);
      if (ov > eps) return true;
    }
  }
  return false;
}

/** Returns null when parking does not apply to this floor (no request, no stalls, no aisle). */
export function computeParkingMetrics(floor: Floor): ParkingMetrics | null {
  const requested = typeof floor.parkingRequested === 'number' && floor.parkingRequested > 0 ? floor.parkingRequested : null;
  const stalls = (floor.parkingStalls ?? []).filter(s => validRect(s?.rect));
  const aisle = validRect(floor.parkingArea?.aisleRect) ? floor.parkingArea!.aisleRect : null;
  if (requested === null && stalls.length === 0 && !aisle) return null;
  const placed = stalls.length;

  const fulfilment = requested === null ? notApplicable('PROGRAM') : metricRatio(Math.min(placed, requested), requested, 'PROGRAM');
  const aisleAccess = aisle ? metricRatio(stalls.filter(s => rectsTouch(s.rect, aisle)).length, placed, 'GEOMETRIC') : notApplicable('GEOMETRIC');
  const stallArea = stalls.reduce((a, s) => a + rectArea(s.rect), 0);
  const stallAreaShare = aisle && placed > 0
    ? metricRatio(stallArea, rectUnionArea([...stalls.map(s => s.rect), aisle]), 'GEOMETRIC')
    : notApplicable('GEOMETRIC');
  const site = (floor as Floor & FloorRuntimeGeometry).siteBoundary;
  const streetAccess = aisle && validPolygon(site) && floor.accessSide ? aisleReachesStreet(aisle, site, floor.accessSide) : null;
  return { requested, placed, fulfilment, aisleAccess, streetAccess, stallAreaShare };
}

// ---------------------------------------------------------------------------
// 3. Programme adjacency
// ---------------------------------------------------------------------------

export type AdjacencyRequirementsByType = Map<SpaceType, AdjacencyRequirement[]>;

/**
 * Re-derives the programme's per-type adjacency requirements for one floor, exactly
 * as the generator does (`allocateBuildingProgram(building, floors)[level]` →
 * `programForFloor(building, level, floors === 1, alloc)`). The generator does not
 * copy `adjacencies` onto `Space`, so this is the only source. Within one floor every
 * spec of a given type carries the same list; the first occurrence is used.
 */
export function programAdjacencyByType(input: ProjectInput, level: number): AdjacencyRequirementsByType {
  const out: AdjacencyRequirementsByType = new Map();
  const n = Math.max(1, input.building.floors);
  if (!Number.isInteger(level) || level < 0 || level >= n) return out;
  const alloc = allocateBuildingProgram(input.building, n)[level];
  if (!alloc) return out;
  for (const spec of programForFloor(input.building, level, n === 1, alloc)) {
    if (!spec.adjacencies?.length || out.has(spec.type)) continue;
    out.set(spec.type, spec.adjacencies.map(a => ({ ...a })));
  }
  return out;
}

/**
 * Phase 5.3C: number of programme specs per type on one floor, from the same
 * `programForFloor` call as programAdjacencyByType. Used to detect generated rooms
 * that split one programme spec (e.g. one corridor spec realised as several rooms).
 */
export type ProgramSpecCountByType = Map<SpaceType, number>;

export function programSpecCountByType(input: ProjectInput, level: number): ProgramSpecCountByType {
  const out: ProgramSpecCountByType = new Map();
  const n = Math.max(1, input.building.floors);
  if (!Number.isInteger(level) || level < 0 || level >= n) return out;
  const alloc = allocateBuildingProgram(input.building, n)[level];
  if (!alloc) return out;
  for (const spec of programForFloor(input.building, level, n === 1, alloc)) out.set(spec.type, (out.get(spec.type) ?? 0) + 1);
  return out;
}

export interface AdjacencyInstance {
  sourceSpaceId: string;
  sourceType: SpaceType;
  /** null when the programme entry names no target type (then never applicable). */
  targetType: SpaceType | null;
  weight: number;
  wantAdjacent: boolean;
  doorRequired: boolean;
  /** false when no OTHER space of targetType exists on the floor (missing rooms are
   *  counted by requiredMissing elsewhere; self-type entries with a single instance land here). */
  applicable: boolean;
  /** adjacency satisfied (wantAdjacent ? shares a wall : does not); null if not applicable */
  adjacencySatisfied: boolean | null;
  /** door access exists to some target; null if not applicable or no door required */
  doorSatisfied: boolean | null;
  /**
   * Phase 5.3C: present only when the floor has MORE generated rooms of sourceType
   * than programme specs — the rooms (sorted ids) evaluated as one group for this
   * programme requirement. Absent whenever room and spec counts match (legacy shape).
   */
  groupedSpaceIds?: string[];
}

export interface AdjacencyMetrics {
  /** Σ w·[adjacency satisfied] / Σ w over applicable instances */
  required: MetricValue;
  /** Σ w·[door access] / Σ w over applicable instances with doorRequired */
  door: MetricValue;
  instances: AdjacencyInstance[];
  notApplicableCount: number;
}

/**
 * Programme adjacency, evaluated per programme spec.
 *
 * Legacy (specCounts omitted, or rooms of a type ≤ programme specs of that type):
 * one instance per generated room, exactly as before.
 *
 * Phase 5.3C split-room semantics (specCounts given and a type has MORE generated
 * rooms than programme specs, k): those rooms are one group per requirement, yielding
 * k instances (one per spec). Per-room outcomes are computed exactly as in the legacy
 * path, then aggregated:
 *   - adjacent requirement: satisfied instances = min(k, #rooms touching a target) —
 *     for k = 1, passes iff ANY room of the type touches the target;
 *   - separation requirement: satisfied instances = max(0, k − #rooms touching a target)
 *     — for k = 1, passes iff NO room of the type touches it;
 *   - doorRequired: door-satisfied instances = min(k, #rooms with direct door access).
 * Weights, normalisation and the not-applicable rule are unchanged.
 */
export function computeAdjacencyMetrics(floor: Floor, reqs: AdjacencyRequirementsByType, specCounts?: ProgramSpecCountByType): AdjacencyMetrics {
  const spaces = [...(floor.spaces ?? [])].sort(byId);
  const instances: AdjacencyInstance[] = [];
  let reqNum = 0, reqDen = 0, doorNum = 0, doorDen = 0, na = 0;
  // Phase 5.3C: types whose generated rooms outnumber their programme specs.
  const grouped = new Map<string, number>();
  if (specCounts) {
    const roomCount = new Map<string, number>();
    for (const s of spaces) roomCount.set(s.type, (roomCount.get(s.type) ?? 0) + 1);
    for (const [t, n] of roomCount) {
      const k = specCounts.get(t as SpaceType) ?? 0;
      if (k >= 1 && n > k && (reqs.get(t as SpaceType)?.length ?? 0) > 0) grouped.set(t, k);
    }
  }
  const emitGroup = (t: string, k: number): void => {
    const members = spaces.filter(s => s.type === t);
    const groupedSpaceIds = members.map(m => m.id);
    for (const r of reqs.get(t as SpaceType) ?? []) {
      const w = Math.max(0, r.weight);
      const targetType = r.spaceType ?? null;
      const doorRequired = !!r.doorRequired;
      const per = members.map(m => {
        const targets = targetType === null ? [] : spaces.filter(x => x.type === targetType && x.id !== m.id);
        const touching = targets.some(x => (m.adjacentSpaceIds ?? []).includes(x.id) || (x.adjacentSpaceIds ?? []).includes(m.id));
        const door = doorRequired && targets.some(x => hasDirectAccess(m.id, x.id, floor));
        return { id: m.id, applicable: targets.length > 0, touching, door };
      });
      const app = per.filter(p => p.applicable);
      if (app.length === 0) {
        for (let j = 0; j < k; j++) {
          na++;
          instances.push({ sourceSpaceId: members[Math.min(j, members.length - 1)].id, sourceType: t as SpaceType, targetType, weight: w,
            wantAdjacent: r.adjacent, doorRequired, applicable: false, adjacencySatisfied: null, doorSatisfied: null, groupedSpaceIds });
        }
        continue;
      }
      const nTouch = app.filter(p => p.touching).length;
      const nAdjOk = r.adjacent ? Math.min(k, nTouch) : Math.max(0, k - nTouch);
      const nDoor = Math.min(k, app.filter(p => p.door).length);
      // Deterministic representative rooms: satisfying rooms first, then by id.
      const reps = [...app].sort((a, b) => {
        const sa = (r.adjacent ? a.touching : !a.touching) ? 0 : 1, sb = (r.adjacent ? b.touching : !b.touching) ? 0 : 1;
        return sa - sb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      for (let j = 0; j < k; j++) {
        const adjacencySatisfied = j < nAdjOk;
        reqDen += w; if (adjacencySatisfied) reqNum += w;
        let doorSatisfied: boolean | null = null;
        if (doorRequired) { doorSatisfied = j < nDoor; doorDen += w; if (doorSatisfied) doorNum += w; }
        instances.push({ sourceSpaceId: reps[Math.min(j, reps.length - 1)].id, sourceType: t as SpaceType, targetType, weight: w,
          wantAdjacent: r.adjacent, doorRequired, applicable: true, adjacencySatisfied, doorSatisfied, groupedSpaceIds });
      }
    }
  };
  const emitted = new Set<string>();
  for (const s of spaces) {
    if (grouped.has(s.type)) {
      // emitted once, at the position of the group's first room (sorted ids)
      if (!emitted.has(s.type)) { emitted.add(s.type); emitGroup(s.type, grouped.get(s.type)!); }
      continue;
    }
    for (const r of reqs.get(s.type) ?? []) {
      const w = Math.max(0, r.weight);
      const targetType = r.spaceType ?? null;
      const targets = targetType === null ? [] : spaces.filter(t => t.type === targetType && t.id !== s.id);
      const doorRequired = !!r.doorRequired;
      if (!targets.length) {
        na++;
        instances.push({ sourceSpaceId: s.id, sourceType: s.type, targetType, weight: w, wantAdjacent: r.adjacent,
          doorRequired, applicable: false, adjacencySatisfied: null, doorSatisfied: null });
        continue;
      }
      const touching = targets.some(t => (s.adjacentSpaceIds ?? []).includes(t.id) || (t.adjacentSpaceIds ?? []).includes(s.id));
      const adjacencySatisfied = r.adjacent ? touching : !touching;
      reqDen += w; if (adjacencySatisfied) reqNum += w;
      let doorSatisfied: boolean | null = null;
      if (doorRequired) {
        doorSatisfied = targets.some(t => hasDirectAccess(s.id, t.id, floor));
        doorDen += w; if (doorSatisfied) doorNum += w;
      }
      instances.push({ sourceSpaceId: s.id, sourceType: s.type, targetType, weight: w, wantAdjacent: r.adjacent,
        doorRequired, applicable: true, adjacencySatisfied, doorSatisfied });
    }
  }
  return {
    required: metricRatio(reqNum, reqDen, 'PROGRAM'),
    door: metricRatio(doorNum, doorDen, 'PROGRAM'),
    instances, notApplicableCount: na,
  };
}

// ---------------------------------------------------------------------------
// 4. Circulation efficiency
// ---------------------------------------------------------------------------

/** Same set as validation/architectural-qa.ts CIRC_TYPES. */
export const CIRCULATION_SPACE_TYPES: ReadonlySet<string> = new Set(['corridor', 'foyer', 'entrance', 'stair-hall', 'elevator-hall']);
/** Same set as validation/accessibility.ts DOOR_TYPES (every non-window opening). */
const DOOR_OPENING_TYPES: ReadonlySet<string> = new Set(['door', 'entrance', 'sliding-door']);

export interface CirculationRoute {
  targetId: string;
  /** origin the shortest route starts from; null if unreachable */
  originId: string | null;
  /** |centroid(origin) − centroid(target)| ; null if unreachable */
  straight: number | null;
  /** shortest walking polyline centroid→door…door→centroid, m; null if unreachable */
  route: number | null;
}

export interface CirculationMetrics {
  /** entrance spaces if the floor has any, otherwise stair-hall / elevator-hall spaces */
  originIds: string[];
  /** Σ area(circulation spaces) / Σ area(all spaces) — net space area, not the footprint rect */
  share: MetricValue;
  /** spaces reachable from the origins through door openings / all spaces */
  reach: MetricValue;
  /** Σ straight / Σ route over reachable non-circulation destinations; 1 = straight-line access */
  detour: MetricValue;
  /** corridors with ≤ 1 door opening, counted once per corridor */
  deadEnds: number;
  deadEndIds: string[];
  /** one entry per non-circulation destination, sorted by id */
  routes: CirculationRoute[];
}

function spaceCentroid(s: Space): Vec2 | null {
  const poly = (s as Partial<Space>).polygon;
  if (validPolygon(poly) && Math.abs(polygonSignedArea(poly)) > EPS) return polygonCentroid(poly);
  return validRect(s.rect) ? { x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h / 2 } : null;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function computeCirculationMetrics(floor: Floor): CirculationMetrics {
  const spaces = [...(floor.spaces ?? [])].sort(byId);
  const ids = new Set(spaces.map(s => s.id));
  const wallById = new Map((floor.walls ?? []).map(w => [w.id, w]));

  // Door openings, sorted by id; each lists the floor spaces on its wall.
  const doors = (floor.openings ?? [])
    .filter(o => DOOR_OPENING_TYPES.has(o.type))
    .map(o => {
      const w = wallById.get(o.wallId);
      const sp = w ? [...new Set(w.spaceIds.filter((x): x is string => !!x && ids.has(x)))] : [];
      return { id: o.id, center: o.center, spaces: sp };
    })
    .filter(d => d.spaces.length > 0)
    .sort(byId);

  const doorsOf = new Map<string, typeof doors>();
  for (const s of spaces) doorsOf.set(s.id, []);
  for (const d of doors) for (const sid of d.spaces) doorsOf.get(sid)!.push(d);

  // share
  const totalArea = spaces.reduce((a, s) => a + (s.area ?? 0), 0);
  const circArea = spaces.filter(s => CIRCULATION_SPACE_TYPES.has(s.type)).reduce((a, s) => a + (s.area ?? 0), 0);
  const share = metricRatio(circArea, totalArea, 'GEOMETRIC');

  // dead ends
  const deadEndIds = spaces.filter(s => s.type === 'corridor' && doorsOf.get(s.id)!.length <= 1).map(s => s.id);

  // origins
  let origins = spaces.filter(s => s.type === 'entrance');
  if (!origins.length) origins = spaces.filter(s => s.type === 'stair-hall' || s.type === 'elevator-hall');
  const originIds = origins.map(s => s.id);

  const destinations = spaces.filter(s => !CIRCULATION_SPACE_TYPES.has(s.type) && !originIds.includes(s.id));
  if (!origins.length) {
    return {
      originIds, share, reach: notApplicable('GEOMETRIC'), detour: notApplicable('GEOMETRIC'),
      deadEnds: deadEndIds.length, deadEndIds,
      routes: destinations.map(s => ({ targetId: s.id, originId: null, straight: null, route: null })),
    };
  }

  // reach: BFS on the door graph (space ↔ space through a two-sided door)
  const reached = new Set<string>(originIds);
  const bfs = [...originIds];
  while (bfs.length) {
    const cur = bfs.shift()!;
    for (const d of doorsOf.get(cur)!) for (const nb of d.spaces) if (!reached.has(nb)) { reached.add(nb); bfs.push(nb); }
  }
  const reach = metricRatio(reached.size, spaces.length, 'GEOMETRIC');

  // Walking graph: vertices = door centres + centroid vertices; within each space every
  // pair of its doors, and its centroid to each of its doors, are joined by straight segments.
  const key = (kind: 'c' | 'd', id: string) => `${kind}:${id}`;
  const adj = new Map<string, Array<{ to: string; w: number }>>();
  const pos = new Map<string, Vec2>();
  const link = (a: string, b: string) => {
    const w = dist(pos.get(a)!, pos.get(b)!);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, w });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, w });
  };
  for (const d of doors) pos.set(key('d', d.id), d.center);
  for (const s of spaces) {
    const c = spaceCentroid(s);
    if (c) pos.set(key('c', s.id), c);
    const ds = doorsOf.get(s.id)!;
    for (let i = 0; i < ds.length; i++) {
      if (c) link(key('c', s.id), key('d', ds[i].id));
      for (let j = i + 1; j < ds.length; j++) link(key('d', ds[i].id), key('d', ds[j].id));
    }
  }

  // Multi-source Dijkstra (O(V²), deterministic tie-break on vertex key).
  const best = new Map<string, number>();
  const src = new Map<string, string>();
  const done = new Set<string>();
  for (const o of origins) { const k = key('c', o.id); if (pos.has(k)) { best.set(k, 0); src.set(k, o.id); } }
  for (;;) {
    let u: string | null = null, du = Infinity;
    for (const [k, v] of best) if (!done.has(k) && (v < du || (v === du && u !== null && k < u))) { u = k; du = v; }
    if (u === null) break;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = du + e.w;
      const cur = best.get(e.to);
      if (cur === undefined || nd < cur - 1e-12 || (Math.abs(nd - cur) <= 1e-12 && src.get(u)! < src.get(e.to)!)) {
        best.set(e.to, nd); src.set(e.to, src.get(u)!);
      }
    }
  }

  const centroidOf = new Map(spaces.map(s => [s.id, spaceCentroid(s)]));
  let sumStraight = 0, sumRoute = 0;
  const routes: CirculationRoute[] = destinations.map(s => {
    const k = key('c', s.id);
    const route = best.get(k);
    if (route === undefined || !reached.has(s.id)) return { targetId: s.id, originId: null, straight: null, route: null };
    const originId = src.get(k)!;
    const straight = dist(centroidOf.get(originId)!, centroidOf.get(s.id)!);
    sumStraight += straight; sumRoute += route;
    return { targetId: s.id, originId, straight, route };
  });
  const detour = metricRatio(sumStraight, sumRoute, 'GEOMETRIC');

  return { originIds, share, reach, detour, deadEnds: deadEndIds.length, deadEndIds, routes };
}

// ===========================================================================
// Phase 5.1b-2 — rooms, daylight, privacy, vertical integration
//
// Additional domain-model findings used below (verified at 75216a7, pinned by
// metrics-v1-b2.test.ts):
//   (Q3) Window `normal` points INTO the room (generator/openings.ts normalIntoSpace;
//        19/19 windows on the canonical rect, L-shape and 3-floor lift layouts).
//        The facade a window faces is therefore −normal. Every generated window sits
//        on a one-sided (exterior) wall; at most one window per room is emitted.
//   (Q4) `Space.orientation` is set by generator `orientationOf(type)`: living and
//        master-bedroom → 'south', everything else → 'any'. The programme's east/west
//        preference for regular bedrooms does not reach the plan; 'any' means no
//        preference and is excluded (not applicable), never counted as satisfied.
//   (Q5) `Space.privacy` is set by generator `privacyOf(type)` (public / semi-private /
//        private / service) and is the band used here.
//   (Q6) Stairs are emitted on every floor, including the top floor, with a stable
//        footprint; elevators on every floor share one `coreId`.
// ===========================================================================

const CARDINALS = ['north', 'south', 'east', 'west'] as const;
export type Cardinal = typeof CARDINALS[number];

function spaceBBox(s: Space): Rect | null {
  const poly = (s as Partial<Space>).polygon;
  if (validPolygon(poly)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if (x1 - x0 > 0 && y1 - y0 > 0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return validRect(s.rect) ? s.rect : null;
}

/** Non-circulation spaces ("rooms"), sorted by id. */
function roomsOf(floor: Floor): Space[] {
  return [...(floor.spaces ?? [])].filter(s => !CIRCULATION_SPACE_TYPES.has(s.type)).sort(byId);
}

/** Two-sided door edges and one-sided (street/exterior) door openings on a floor. */
function doorTopology(floor: Floor): { nb: Map<string, Set<string>>; edges: Array<{ id: string; a: string; b: string }>; exterior: Array<{ id: string; space: string }> } {
  const ids = new Set((floor.spaces ?? []).map(s => s.id));
  const wallById = new Map((floor.walls ?? []).map(w => [w.id, w]));
  const nb = new Map<string, Set<string>>();
  for (const id of [...ids].sort()) nb.set(id, new Set());
  const edges: Array<{ id: string; a: string; b: string }> = [];
  const exterior: Array<{ id: string; space: string }> = [];
  for (const o of [...(floor.openings ?? [])].sort(byId)) {
    if (!DOOR_OPENING_TYPES.has(o.type)) continue;
    const w = wallById.get(o.wallId);
    if (!w) continue;
    const sp = [...new Set(w.spaceIds.filter((x): x is string => !!x && ids.has(x)))];
    if (sp.length === 2) { edges.push({ id: o.id, a: sp[0], b: sp[1] }); nb.get(sp[0])!.add(sp[1]); nb.get(sp[1])!.add(sp[0]); }
    else if (sp.length === 1) exterior.push({ id: o.id, space: sp[0] });
  }
  return { nb, edges, exterior };
}

function bfsReach(starts: string[], nb: Map<string, Set<string>>, canExpand: (id: string) => boolean = () => true): Map<string, number> {
  const d = new Map<string, number>();
  const q: string[] = [];
  for (const s of [...starts].sort()) if (!d.has(s)) { d.set(s, 0); q.push(s); }
  while (q.length) {
    const cur = q.shift()!;
    if (d.get(cur)! > 0 && !canExpand(cur)) continue;
    for (const n of [...(nb.get(cur) ?? [])].sort()) if (!d.has(n)) { d.set(n, d.get(cur)! + 1); q.push(n); }
  }
  return d;
}

function floorOrigins(floor: Floor): string[] {
  const sp = [...(floor.spaces ?? [])].sort(byId);
  const e = sp.filter(s => s.type === 'entrance').map(s => s.id);
  return e.length ? e : sp.filter(s => s.type === 'stair-hall' || s.type === 'elevator-hall').map(s => s.id);
}

// ---------------------------------------------------------------------------
// 5. Room usability / proportion
// ---------------------------------------------------------------------------

export interface RoomUsabilityEntry {
  spaceId: string;
  type: SpaceType;
  area: number;
  /** short / long side of the polygon bounding box */
  minSide: number;
  maxSide: number;
  /** maxSide / minSide (raw, no threshold) */
  aspectRatio: number;
  /** area / bbox area (1 for rectangles) */
  rectangularity: number;
  /** min(1, minSide / minWidth); null when the programme gives no minWidth */
  widthFit: number | null;
  /** 1 − min(1, |area − targetArea| / targetArea); null when targetArea ≤ 0 */
  areaFit: number | null;
  /** min(α, α*) / max(α, α*) with α* = preferredAspectRatio; null when α* is absent (always, see Q2) */
  aspectFit: number | null;
}

export interface RoomUsabilityMetrics {
  roomCount: number;
  /** Σ A·widthFit / Σ A over rooms with minWidth (area-weighted) */
  widthFit: MetricValue;
  /** Σ areaFit / count over rooms with targetArea */
  areaFit: MetricValue;
  /** Σ A / Σ bboxArea */
  rectangularity: MetricValue;
  /** Σ aspectFit / count over rooms with preferredAspectRatio — null for generated plans (Q2) */
  aspect: MetricValue;
  /** rooms whose short side is below their programme minWidth; null if no room declares one */
  belowMinWidthCount: number | null;
  rooms: RoomUsabilityEntry[];
}

export function computeRoomUsabilityMetrics(floor: Floor): RoomUsabilityMetrics {
  const rooms: RoomUsabilityEntry[] = [];
  let wNum = 0, wDen = 0, aNum = 0, aDen = 0, rNum = 0, rDen = 0, pNum = 0, pDen = 0, below = 0, anyMinWidth = false;
  for (const s of roomsOf(floor)) {
    const bb = spaceBBox(s);
    if (!bb) continue;
    const area = s.area ?? rectArea(bb);
    const minSide = Math.min(bb.w, bb.h), maxSide = Math.max(bb.w, bb.h);
    const aspectRatio = maxSide / minSide;
    // area ≤ bbox area mathematically; min() only absorbs shoelace-vs-w·h float noise
    const inBox = Math.min(area, rectArea(bb));
    const rectangularity = inBox / rectArea(bb);
    rNum += inBox; rDen += rectArea(bb);
    let widthFit: number | null = null;
    if (typeof s.minWidth === 'number' && s.minWidth > 0) {
      anyMinWidth = true;
      widthFit = Math.min(1, minSide / s.minWidth);
      wNum += area * widthFit; wDen += area;
      if (minSide < s.minWidth - EPS) below++;
    }
    let areaFit: number | null = null;
    if (typeof s.targetArea === 'number' && s.targetArea > 0) {
      areaFit = 1 - Math.min(1, Math.abs(area - s.targetArea) / s.targetArea);
      aNum += areaFit; aDen += 1;
    }
    let aspectFit: number | null = null;
    const pref = s.preferredAspectRatio;
    if (typeof pref === 'number' && pref > 0) {
      aspectFit = Math.min(aspectRatio, pref) / Math.max(aspectRatio, pref);
      pNum += aspectFit; pDen += 1;
    }
    rooms.push({ spaceId: s.id, type: s.type, area, minSide, maxSide, aspectRatio, rectangularity, widthFit, areaFit, aspectFit });
  }
  return {
    roomCount: rooms.length,
    widthFit: metricRatio(wNum, wDen, 'PROGRAM'),
    areaFit: metricRatio(aNum, aDen, 'PROGRAM'),
    rectangularity: metricRatio(rNum, rDen, 'GEOMETRIC'),
    aspect: metricRatio(pNum, pDen, 'PROGRAM'),
    belowMinWidthCount: anyMinWidth ? below : null,
    rooms,
  };
}

// ---------------------------------------------------------------------------
// 6. Daylight
// ---------------------------------------------------------------------------

/** Facade direction of a window = −normal (window normals point into the room, Q3).
 *  Dominant axis; null for a zero or exactly diagonal normal. South = min y (codebase convention). */
export function windowFacing(normal: Vec2 | undefined): Cardinal | null {
  if (!normal) return null;
  const fx = -normal.x, fy = -normal.y;
  const ax = Math.abs(fx), ay = Math.abs(fy);
  if (Math.abs(ax - ay) <= 1e-9) return null;
  if (ay > ax) return fy < 0 ? 'south' : 'north';
  return fx > 0 ? 'east' : 'west';
}

interface FacadeWindow { id: string; spaceId: string; width: number; height: number; facing: Cardinal | null }

/** Windows on one-sided walls (facade windows), sorted by id. */
function facadeWindows(floor: Floor): { windows: FacadeWindow[]; nonFacade: number } {
  const ids = new Set((floor.spaces ?? []).map(s => s.id));
  const wallById = new Map((floor.walls ?? []).map(w => [w.id, w]));
  const windows: FacadeWindow[] = [];
  let nonFacade = 0;
  for (const o of [...(floor.openings ?? [])].sort(byId)) {
    if (o.type !== 'window') continue;
    const w = wallById.get(o.wallId);
    const sp = w ? [...new Set(w.spaceIds.filter((x): x is string => !!x && ids.has(x)))] : [];
    if (sp.length !== 1) { nonFacade++; continue; }
    windows.push({ id: o.id, spaceId: sp[0], width: Math.max(0, o.width ?? 0), height: Math.max(0, o.height ?? 0), facing: windowFacing(o.normal) });
  }
  return { windows, nonFacade };
}

export interface DaylightRoomEntry {
  spaceId: string;
  type: SpaceType;
  daylightRequired: boolean;
  /** Space.orientation when it is a cardinal preference; null for 'any'/undefined */
  orientationPref: Cardinal | null;
  windowCount: number;
  /** Σ facade window width, m */
  windowWidth: number;
  /** Σ width × height of facade windows, m² (raw, no threshold) */
  glazedArea: number;
  facings: Cardinal[];
  /** Room dimension perpendicular to its windowed facade (min over windows), m.
   *  Reported only — no depth threshold is applied. null without a facade window. */
  depth: number | null;
}

export interface DaylightMetrics {
  /** daylightRequired rooms with ≥ 1 facade window / daylightRequired rooms */
  windowed: MetricValue;
  /** rooms with a cardinal orientation preference having a window facing it / such rooms */
  orientation: MetricValue;
  /** largest reported depth, m (raw); null when no room has a facade window */
  maxDepth: number | null;
  /** windows on walls that are not one-sided (not counted as daylight) */
  nonFacadeWindows: number;
  rooms: DaylightRoomEntry[];
}

export function computeDaylightMetrics(floor: Floor): DaylightMetrics {
  const { windows, nonFacade } = facadeWindows(floor);
  const rooms: DaylightRoomEntry[] = [];
  let wNum = 0, wDen = 0, oNum = 0, oDen = 0, maxDepth: number | null = null;
  for (const s of roomsOf(floor)) {
    const ws = windows.filter(w => w.spaceId === s.id);
    const bb = spaceBBox(s);
    const facings = [...new Set(ws.map(w => w.facing).filter((f): f is Cardinal => f !== null))].sort();
    let depth: number | null = null;
    if (bb) for (const f of facings) {
      const d = f === 'north' || f === 'south' ? bb.h : bb.w;
      depth = depth === null ? d : Math.min(depth, d);
    }
    if (depth !== null) maxDepth = maxDepth === null ? depth : Math.max(maxDepth, depth);
    const pref = s.orientation && (CARDINALS as readonly string[]).includes(s.orientation) ? s.orientation as Cardinal : null;
    const daylightRequired = !!s.daylightRequired;
    if (daylightRequired) { wDen++; if (ws.length > 0) wNum++; }
    if (pref) { oDen++; if (facings.includes(pref)) oNum++; }
    rooms.push({
      spaceId: s.id, type: s.type, daylightRequired, orientationPref: pref, windowCount: ws.length,
      windowWidth: ws.reduce((a, w) => a + w.width, 0), glazedArea: ws.reduce((a, w) => a + w.width * w.height, 0),
      facings, depth,
    });
  }
  return {
    windowed: metricRatio(wNum, wDen, 'GEOMETRIC'),
    orientation: metricRatio(oNum, oDen, 'GEOMETRIC'),
    maxDepth, nonFacadeWindows: nonFacade, rooms,
  };
}

// ---------------------------------------------------------------------------
// 7. Privacy
// ---------------------------------------------------------------------------

export interface PrivacyRoomEntry {
  spaceId: string;
  reachable: boolean;
  /** true when some door path from an origin reaches it through public spaces only */
  exposed: boolean | null;
  /** door openings of this room onto public spaces or the street */
  publicDoors: number;
  doors: number;
  /** Σ width of this room's facade windows facing floor.accessSide, m */
  streetFacingWindowWidth: number;
  windowWidth: number;
}

export interface PrivacyMetrics {
  originIds: string[];
  /** reachable private rooms not exposed / reachable private rooms */
  buffered: MetricValue;
  /** 1 − (private-room doors onto public spaces or the street) / (all private-room doors) */
  exposure: MetricValue;
  /** 1 − (private facade-window width facing accessSide) / (private facade-window width) */
  streetFacingPrivate: MetricValue;
  rooms: PrivacyRoomEntry[];
}

export function computePrivacyMetrics(floor: Floor): PrivacyMetrics {
  const spaces = [...(floor.spaces ?? [])].sort(byId);
  const band = new Map(spaces.map(s => [s.id, s.privacy]));
  const priv = spaces.filter(s => s.privacy === 'private');
  const { nb, edges, exterior } = doorTopology(floor);
  const originIds = floorOrigins(floor);
  const reach = bfsReach(originIds, nb);
  // spaces reachable from an origin while only passing THROUGH public spaces (origins may always be left)
  const publicReach = bfsReach(originIds, nb, id => band.get(id) === 'public');
  const { windows } = facadeWindows(floor);
  const side = floor.accessSide ?? null;

  const rooms: PrivacyRoomEntry[] = [];
  let bNum = 0, bDen = 0, eNum = 0, eDen = 0, sNum = 0, sDen = 0;
  for (const p of priv) {
    const reachable = reach.has(p.id);
    let exposed: boolean | null = null;
    if (originIds.length && reachable) {
      // exposed iff reached by a door path whose intermediate spaces are all origins or public
      exposed = publicReach.has(p.id);
      bDen++; if (!exposed) bNum++;
    }
    const twoSided = edges.filter(e => e.a === p.id || e.b === p.id);
    const street = exterior.filter(e => e.space === p.id).length;
    const pubTwo = twoSided.filter(e => band.get(e.a === p.id ? e.b : e.a) === 'public').length;
    const doors = twoSided.length + street;
    const publicDoors = pubTwo + street;
    eDen += doors; eNum += doors - publicDoors;
    const ws = windows.filter(w => w.spaceId === p.id);
    const windowWidth = ws.reduce((a, w) => a + w.width, 0);
    const streetFacingWindowWidth = side ? ws.filter(w => w.facing === side).reduce((a, w) => a + w.width, 0) : 0;
    if (side) { sDen += windowWidth; sNum += windowWidth - streetFacingWindowWidth; }
    rooms.push({ spaceId: p.id, reachable, exposed, publicDoors, doors, streetFacingWindowWidth, windowWidth });
  }
  return {
    originIds,
    buffered: metricRatio(bNum, bDen, 'GEOMETRIC'),
    exposure: metricRatio(eNum, eDen, 'GEOMETRIC'),
    streetFacingPrivate: metricRatio(sNum, sDen, 'GEOMETRIC'),
    rooms,
  };
}

// ---------------------------------------------------------------------------
// 8. Vertical stair / elevator integration (building level)
// ---------------------------------------------------------------------------

export interface VerticalPair {
  fromLevel: number;
  toLevel: number;
  /** intelligence/vertical-circulation stairFootprintOverlap: max overlap / min area; null if neither floor has a stair */
  stairOverlap: number | null;
  /** same formula on elevator shaft rects; null if neither floor has or requests an elevator */
  liftOverlap: number | null;
  /** same coreId and identical shaft rect (1e-6) — the stacking test validation/accessibility uses */
  liftExactStack: boolean | null;
}

export interface VerticalFloorEntry {
  level: number;
  coreHallIds: string[];
  /** every space on the floor is door-reachable from its stair/elevator halls; null without halls */
  coreServesAll: boolean | null;
  /** door steps from elevator.hallSpaceId to the nearest stair-hall; null if no elevator or unreachable */
  liftToStairDoorSteps: number | null;
}

export interface VerticalMetrics {
  floorCount: number;
  pairs: VerticalPair[];
  /** Σ stairOverlap / #pairs with a stair */
  stairAlign: MetricValue;
  minStairOverlap: number | null;
  /** Σ liftOverlap / #pairs with an elevator */
  liftAlign: MetricValue;
  minLiftOverlap: number | null;
  /** floors whose core halls reach every space / floors with core halls */
  coreReach: MetricValue;
  /** floors where the elevator hall is door-connected to a stair-hall / floors with an elevator */
  liftStairLinked: MetricValue;
  /** spaces step-free reachable (validation/accessibility stepFreeReachable) / all spaces;
   *  advisory only, null when the ground floor has no street entrance */
  stepFree: MetricValue;
  floors: VerticalFloorEntry[];
}

function liftShaftOverlap(a: Floor, b: Floor): number {
  let best = 0;
  for (const ea of a.elevators ?? []) for (const eb of b.elevators ?? []) {
    if (!validRect(ea?.rect) || !validRect(eb?.rect)) continue;
    const m = Math.min(rectArea(ea.rect), rectArea(eb.rect));
    if (m > 0) best = Math.max(best, rOverlapArea(ea.rect, eb.rect) / m);
  }
  return best;
}

function liftExact(a: Floor, b: Floor): boolean {
  const same = (r: Rect, q: Rect) => Math.abs(r.x - q.x) < 1e-6 && Math.abs(r.y - q.y) < 1e-6 && Math.abs(r.w - q.w) < 1e-6 && Math.abs(r.h - q.h) < 1e-6;
  return (a.elevators ?? []).some(ea => (b.elevators ?? []).some(eb => ea.coreId === eb.coreId && validRect(ea.rect) && validRect(eb.rect) && same(ea.rect, eb.rect)));
}

export function computeVerticalMetrics(candidate: LayoutCandidate): VerticalMetrics {
  const floors = [...(candidate.floors ?? [])].sort((a, b) => a.level - b.level);
  const pairs: VerticalPair[] = [];
  let sSum = 0, sN = 0, lSum = 0, lN = 0, minS: number | null = null, minL: number | null = null;
  for (let i = 0; i + 1 < floors.length; i++) {
    const a = floors[i], b = floors[i + 1];
    const hasS = (a.stairs?.length ?? 0) > 0 || (b.stairs?.length ?? 0) > 0;
    const hasL = (a.elevators?.length ?? 0) > 0 || (b.elevators?.length ?? 0) > 0 || !!a.elevatorRequested || !!b.elevatorRequested;
    // min(1, ·) only absorbs float noise (identical rects give 1.0000000000000009)
    const stairOverlap = hasS ? Math.min(1, stairFootprintOverlap(a, b)) : null;
    const liftOverlap = hasL ? Math.min(1, liftShaftOverlap(a, b)) : null;
    if (stairOverlap !== null) { sSum += stairOverlap; sN++; minS = minS === null ? stairOverlap : Math.min(minS, stairOverlap); }
    if (liftOverlap !== null) { lSum += liftOverlap; lN++; minL = minL === null ? liftOverlap : Math.min(minL, liftOverlap); }
    pairs.push({ fromLevel: a.level, toLevel: b.level, stairOverlap, liftOverlap, liftExactStack: hasL ? liftExact(a, b) : null });
  }

  const entries: VerticalFloorEntry[] = [];
  let cNum = 0, cDen = 0, kNum = 0, kDen = 0;
  for (const f of floors) {
    const sp = [...(f.spaces ?? [])].sort(byId);
    const coreHallIds = sp.filter(s => s.type === 'stair-hall' || s.type === 'elevator-hall').map(s => s.id);
    const { nb } = doorTopology(f);
    let coreServesAll: boolean | null = null;
    if (coreHallIds.length) {
      const r = bfsReach(coreHallIds, nb);
      coreServesAll = sp.every(s => r.has(s.id));
      cDen++; if (coreServesAll) cNum++;
    }
    let liftToStairDoorSteps: number | null = null;
    if ((f.elevators?.length ?? 0) > 0) {
      kDen++;
      const stairHalls = sp.filter(s => s.type === 'stair-hall').map(s => s.id);
      const halls = [...new Set(f.elevators.map(e => e.hallSpaceId))].filter(h => nb.has(h)).sort();
      for (const h of halls) {
        const r = bfsReach([h], nb);
        for (const st of stairHalls) {
          const d = r.get(st);
          if (d !== undefined) liftToStairDoorSteps = liftToStairDoorSteps === null ? d : Math.min(liftToStairDoorSteps, d);
        }
      }
      if (liftToStairDoorSteps !== null) kNum++;
    }
    entries.push({ level: f.level, coreHallIds, coreServesAll, liftToStairDoorSteps });
  }

  const sf = stepFreeReachable(candidate);
  const totalSpaces = floors.reduce((a, f) => a + (f.spaces?.length ?? 0), 0);
  const stepFree = sf.origins.length ? metricRatio(sf.reached.size, totalSpaces, 'GEOMETRIC') : notApplicable('GEOMETRIC');

  return {
    floorCount: floors.length, pairs,
    stairAlign: metricRatio(sSum, sN, 'GEOMETRIC'), minStairOverlap: minS,
    liftAlign: metricRatio(lSum, lN, 'GEOMETRIC'), minLiftOverlap: minL,
    coreReach: metricRatio(cNum, cDen, 'GEOMETRIC'),
    liftStairLinked: metricRatio(kNum, kDen, 'GEOMETRIC'),
    stepFree, floors: entries,
  };
}

// ---------------------------------------------------------------------------
// Candidate-level aggregation (vector only — no composite)
// ---------------------------------------------------------------------------

export interface FloorQualityV1 {
  level: number;
  residual: ResidualMetrics;
  parking: ParkingMetrics | null;
  adjacency: AdjacencyMetrics;
  circulation: CirculationMetrics;
  rooms: RoomUsabilityMetrics;
  daylight: DaylightMetrics;
  privacy: PrivacyMetrics;
}

export interface QualityMetricsV1 {
  version: typeof QUALITY_METRICS_VERSION;
  floors: FloorQualityV1[];
  vertical: VerticalMetrics;
}

/** Pure: reads the candidate and project input, never mutates either. */
export function computeQualityMetricsV1(candidate: LayoutCandidate, input: ProjectInput): QualityMetricsV1 {
  return {
    version: QUALITY_METRICS_VERSION,
    floors: (candidate.floors ?? []).map(fl => ({
      level: fl.level,
      residual: computeResidualMetrics(fl),
      parking: computeParkingMetrics(fl),
      adjacency: computeAdjacencyMetrics(fl, programAdjacencyByType(input, fl.level), programSpecCountByType(input, fl.level)),
      circulation: computeCirculationMetrics(fl),
      rooms: computeRoomUsabilityMetrics(fl),
      daylight: computeDaylightMetrics(fl),
      privacy: computePrivacyMetrics(fl),
    })),
    vertical: computeVerticalMetrics(candidate),
  };
}
