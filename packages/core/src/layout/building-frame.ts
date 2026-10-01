/**
 * Coordinated Rectangle planner — P1: the pure building-frame foundation.
 *
 * A `BuildingFrame` is the single authoritative description of a rectangular
 * building's band geometry, derived ONCE from the buildable slice and the
 * programme of every floor, before any room is placed:
 *
 *   slice → access-normalized frame → room targets → public-band depth
 *         → private-band depth (P16-C) → corridor line → rear / side residual cuts
 *
 * P1 scope: pure data + deterministic derivation only. Nothing in the production
 * pipeline (generateLayouts, placeSpaces, floor placement, ranking, adoption) calls
 * this module yet, and no stair / elevator anchor is created here.
 *
 * Reuse, no parallel geometry system:
 *   - geometry: `Rect` + `rContains` / `rIntersects`; P16-B `buildAccessFrame` for the
 *     access-side normalization (street face at frame min-y);
 *   - zone model: `strategyConfig`, `zoneOf`, `zoneBandCells`, `strictifyBandCells`,
 *     `entrySpurWidth`, `kitchenStripWidth`, `stairPocketWidth`, `stairPocketDepth`,
 *     `CORRIDOR_W`, `elevatorCellSize` — exactly the carveZones arithmetic;
 *   - sizing: P16-C `cappedBandDepth`, `CELL_QUALITY_MAX_ASPECT`,
 *     `CELL_QUALITY_MIN_VOID`, `DINING_DAYLIGHT_MAX`, `mainRoomDimensionTarget`;
 *   - band feasibility: topology `solveRow` / `solveCol` (= `bandCanHost`), and the
 *     `chooseSpineFraction` ladder bounds [0.30, 0.70] used by carveZones.
 * No new threshold is introduced.
 *
 * P1 demand model: a band is sized as one row of its programme cells (the side-by-side
 * convention of solveRow and the P16-C private columns); when the row does not fit,
 * as the Phase 15 M3 entry column (entrance / foyer / guest WC stacked) beside a row
 * of the other cells, or beside the other cells stacked (Phase 13.1); otherwise as one
 * column (solveCol). Row and column feasibility
 * are exactly topology's bandCanHost predicate. The per-family public demand
 * (gallery, T-stack, stacked …) is P2.
 *
 * Supported: rectangle slices with the horizontal / L-spur spines. The vertical
 * spine (daylight-orientation) returns null in P1; P7 derives it on request
 * (BuildingFrameInput.verticalSpine, see deriveVerticalFrame).
 */
import type { Rect } from '../geometry/rect.js';
import { rContains, rIntersects } from '../geometry/rect.js';
import type { AccessSide } from '../model/site.js';
import type { CandidateStrategy } from '../model/layout.js';
import type { Zone } from '../model/space.js';
import { elevatorCellSize } from '../model/stairs.js';
import { bandCanHost, chooseSpineFraction, solveRow, solveCol, type BandCellDemand } from './topology.js';
import {
  CORRIDOR_W, CELL_QUALITY_MAX_ASPECT, CELL_QUALITY_MIN_VOID, DINING_DAYLIGHT_MAX,
  buildAccessFrame, cappedBandDepth, entrySpurWidth, kitchenStripWidth, mainRoomDimensionTarget,
  stairPocketDepth, stairPocketWidth, strategyConfig, strictifyBandCells, upperFloorFrontPrivateSplit,
  zoneBandCells, zoneOf, zoneUnitIsLarge, verticalSpineFits, carveVerticalZones, type PlacedSpec, type SpineKind,
} from './placer.js';

/** Band a programme room belongs to in the zone model. */
export type FrameBand = 'public' | 'private' | 'service' | 'circulation';

/** Programme-derived sizing target of one room (all values from the programme / zone model). */
export interface RoomTargets {
  placedId: string;
  type: string;
  band: FrameBand;
  /** zone-model band-cell minimums (zoneBandCells, incl. the main-room 12 m² preference). */
  minWidth: number;
  minDepth: number;
  minArea: number;
  /** max(programme target, minArea) — the target the band sizes toward. */
  targetArea: number;
  /** width floor: minWidth, raised to the MBH4-ROOM-001 width for the main room (5.5C) when requested. */
  widthFloor: number;
  /** dimension ceiling on both axes (DINING_DAYLIGHT_MAX for dining), or null. */
  maxDimension: number | null;
}

/**
 * Authoritative corridor line (world coordinates). `axis: 'y'` = a horizontal
 * corridor at constant y (south / north access); `axis: 'x'` = a vertical corridor
 * at constant x (east / west access). `offset` is the corridor's min edge on the
 * cross axis, `width` its cross extent, [from, to] its extent along the line.
 */
export interface CorridorLine {
  axis: 'x' | 'y';
  offset: number;
  width: number;
  from: number;
  to: number;
}

/** Band geometry of a frame (one coordinate system). */
export interface FrameGeometry {
  /** the building frame after residual cuts. */
  frame: Rect;
  publicBand: Rect;
  corridor: Rect;
  privateBand: Rect;
  entrySpur: Rect | null;
  kitchenStrip: Rect | null;
  residualRear: Rect | null;
  residualSide: Rect | null;
}

export interface BuildingFrame {
  strategy: CandidateStrategy;
  spine: SpineKind;
  access: AccessSide;
  /** authoritative buildable slice (world). */
  slice: Rect;
  /** world geometry (mapped back from the access frame). */
  world: FrameGeometry;
  /** access-normalized geometry: street face at min-y (P16-B frame). */
  local: FrameGeometry & { slice: Rect };
  corridorLine: CorridorLine;
  /** public band depth (street → corridor), m. */
  publicDepth: number;
  /** private band depth (corridor → rear of frame), m. */
  privateDepth: number;
  /** corridor centre fraction of the frame depth (carveZones' spine fraction). */
  corridorFraction: number;
  /** corridorFraction inside the carveZones chooseSpineFraction ladder [0.30, 0.70]. */
  ladderCompatible: boolean;
  /** per floor (index = level), the programme targets. */
  targets: RoomTargets[][];
}

export interface BuildingFrameInput {
  /** authoritative buildable rectangle / slice (world, after parking reservation). */
  slice: Rect;
  access: AccessSide;
  strategy: CandidateStrategy;
  /** placed programme specs per floor, level 0 first. */
  floorSpecs: PlacedSpec[][];
  /** size the main room to the MBH4-ROOM-001 width (the 5.5C option). Default false. */
  mainRoomMinDimension?: boolean;
  /**
   * Upper floors with no public programme may host trailing private rooms in the front
   * band when the band behind the corridor cannot (the Phase 5.6A option, which
   * generate() enables by default), via the existing upperFloorFrontPrivateSplit.
   * P1 splits per room (the placer splits per graph cluster). Default false.
   */
  upperFloorFrontPrivate?: boolean;
  /**
   * P7: derive the vertical-spine (daylight-orientation) frame — carveZones' vertical
   * zoning with ONE spine fraction shared by every floor. Default false: the vertical
   * spine returns null (P1 contract).
   */
  verticalSpine?: boolean;
  /**
   * P8: keep the frame at the full slice width (the existing no-cut path) — no side
   * residual strip; the rear residual is derived unchanged. Used ONLY by the coordinated
   * planner's single bounded retry after a P6 residual-intrusion rejection. Default false.
   */
  noSideResidual?: boolean;
  /**
   * P9: size every band demand with target-sized cell depths (bandDepthDemand `targetDepth`)
   * instead of the P16-C capped depths — the public band then follows the living / dining
   * targets. Used ONLY by the coordinated planner's single bounded retry after its G10
   * living / dining deviation comparison reports worse than legacy. Default false.
   */
  targetPublicDepth?: boolean;
  /**
   * P10: cut the vertical-spine frame to its target-sized column length (see
   * deriveVerticalFrame) — the rest of the slice becomes the rear residual strip. Null
   * when no cut fits. Used ONLY by the coordinated planner's single bounded retry after
   * every coordinated attempt on a vertical frame was rejected. Default false.
   */
  verticalTargetLength?: boolean;
}

const EPS = 1e-9;
const GEOM_EPS = 1e-6;
/** carveZones' chooseSpineFraction ladder bounds (horizontal / L-spur). */
const LADDER_LO = 0.30;
const LADDER_HI = 0.70;
/** carveZones' minimum band depth (hfTest rejects pubH / privH below it). */
const BAND_MIN_DEPTH = 1.2;

const ceilCm = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;
const finiteRect = (r: Rect) =>
  [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > GEOM_EPS && r.h > GEOM_EPS;

function bandOfZone(z: Zone): FrameBand {
  if (z === 'public' || z === 'semi-private') return 'public';
  if (z === 'private') return 'private';
  if (z === 'circulation') return 'circulation';
  return 'service';
}

/**
 * Pure: programme sizing targets of one floor. `large` is the zone model's
 * unit-size predicate (zoneUnitIsLarge of the frame footprint).
 */
export function deriveRoomTargets(
  specs: PlacedSpec[],
  large: boolean,
  mainRoomMinDimension = false,
): RoomTargets[] {
  const main = mainRoomMinDimension ? mainRoomDimensionTarget(specs, large) : null;
  return specs.map(sp => {
    const zone = zoneOf(sp as any);
    const [raw] = zoneBandCells([sp], [zone]);
    const [cell] = strictifyBandCells([raw], large);
    const widthFloor = main && main.placedId === sp.placedId ? Math.max(cell.minWidth, main.width) : cell.minWidth;
    return {
      placedId: sp.placedId,
      type: sp.type,
      band: bandOfZone(zone),
      minWidth: cell.minWidth,
      minDepth: cell.minHeight,
      minArea: cell.minArea,
      // never below the (preference-raised) minimum: a target under its minimum is no target.
      targetArea: Math.max(cell.target, cell.minArea),
      widthFloor,
      maxDimension: sp.type === 'dining' ? DINING_DAYLIGHT_MAX : null,
    };
  });
}

/** Band layout mode of a demand: one row, the M3 entry column beside a row or beside a stack (Phase 13.1 living-over-dining), or one column. */
export type BandDemandMode = 'row' | 'entry-column' | 'entry-stack' | 'column';

/** Entry-sequence types stacked in the Phase 15 M3 entry column (entrance → foyer → guest WC). */
const ENTRY_COLUMN_TYPES: ReadonlySet<string> = new Set(['entrance', 'foyer', 'guest-wc']);

export interface BandDemand {
  mode: BandDemandMode;
  /** required band depth, m (cm-rounded up). */
  depth: number;
}

const toCell = (t: RoomTargets): BandCellDemand => ({
  type: t.type, minWidth: t.widthFloor, minHeight: t.minDepth, minArea: t.minArea, target: t.targetArea,
});

/**
 * Depth a row of `targets` needs along `bandW` (P16-C capped), or null when the row does not fit.
 * P9 `targetDepth`: each cell at its target-sized depth (target area ÷ its row share) instead
 * of the P16-C cap; every contract / aspect / dimension bound below is unchanged.
 */
function rowDepth(targets: RoomTargets[], bandW: number, extent: number, targetDepth = false): number | null {
  if (targets.length === 0) return 0;
  const row = solveRow(bandW, extent, targets.map(toCell));
  if (!row) return null;
  let d = 0;
  targets.forEach((t, i) => {
    const flow = row.cells[i].flow;
    let di = targetDepth
      ? Math.min(t.targetArea / Math.max(flow, 0.5), extent)
      : cappedBandDepth({ minWidth: t.minWidth, minLength: t.minDepth, minArea: t.minArea, targetArea: t.targetArea }, flow, extent);
    di = Math.max(di, t.minDepth, t.minArea / Math.max(flow, 0.5));
    // aspect: a target-sized room must not need a width beyond 3.5 × its depth.
    di = Math.max(di, Math.sqrt(t.targetArea / CELL_QUALITY_MAX_ASPECT));
    if (t.maxDimension !== null) {
      // width ≤ max  ⇒  depth ≥ target / max; depth itself ≤ max (never below the contract depth).
      di = Math.max(di, t.targetArea / t.maxDimension);
      di = Math.max(Math.min(di, t.maxDimension), t.minDepth);
    }
    d = Math.max(d, Math.min(di, extent));
  });
  return Math.min(ceilCm(d), extent);
}

/**
 * Depth a stack of `targets` needs across a band of width `w`: each full-width cell at
 * its P16-C capped depth (the full-band-cell case cappedBandDepth exists for), never
 * below its contract depth / area; null when the contract stack does not fit (solveCol).
 */
function stackDepth(targets: RoomTargets[], w: number, extent: number, targetDepth = false): number | null {
  if (targets.length === 0) return 0;
  if (!solveCol(w, extent, targets.map(toCell))) return null;
  let d = 0;
  for (const t of targets) {
    // P9 `targetDepth`: the full-width cell at its target-sized depth instead of the P16-C cap.
    const di = targetDepth
      ? Math.min(t.targetArea / Math.max(w, 0.5), extent)
      : cappedBandDepth({ minWidth: t.minWidth, minLength: t.minDepth, minArea: t.minArea, targetArea: t.targetArea }, w, extent);
    d += Math.max(di, t.minDepth, t.minArea / Math.max(w, 0.5));
  }
  return Math.min(ceilCm(d), extent);
}

/** Width of the M3 entry column: the widest entry cell's width floor. */
const entryColumnWidth = (entry: RoomTargets[]) => Math.max(...entry.map(t => t.widthFloor));
/** Depth the stacked entry column needs at width `w` (every cell at its contract depth / area). */
const entryColumnDepth = (entry: RoomTargets[], w: number) =>
  ceilCm(entry.reduce((a, t) => a + Math.max(t.minDepth, t.minArea / Math.max(w, 0.5)), 0));

/**
 * Pure: required depth of a band hosting `targets` along a band of width `bandW`, with
 * at most `extent` available. Modes, in order: (1) one row — every cell at its P16-C
 * capped depth for its solveRow share, never below its contract depth / area or the
 * 3.5 aspect bound for its target, and (dining) never above DINING_DAYLIGHT_MAX;
 * (2) the M3 entry column (entrance / foyer / guest WC stacked) beside a row of the
 * other cells; (3) the entry column beside the other cells stacked (the Phase 13.1
 * stacked public branch); (4) one column. Stacked cells take their P16-C capped
 * depth at the full band width; contract feasibility is solveCol's. Null
 * when no mode fits.
 */
export function bandDepthDemand(targets: RoomTargets[], bandW: number, extent: number, targetDepth = false): BandDemand | null {
  if (!(bandW > 0) || !(extent > 0)) return null;
  if (targets.length === 0) return { mode: 'row', depth: 0 };
  const r = rowDepth(targets, bandW, extent, targetDepth);
  if (r !== null) return { mode: 'row', depth: r };
  const entry = targets.filter(t => ENTRY_COLUMN_TYPES.has(t.type));
  const rest = targets.filter(t => !ENTRY_COLUMN_TYPES.has(t.type));
  if (entry.length > 1 && rest.length > 0) {
    const cw = entryColumnWidth(entry);
    const cd = entryColumnDepth(entry, cw);
    const rd = cd <= extent + EPS ? rowDepth(rest, bandW - cw, extent, targetDepth) : null;
    if (rd !== null) return { mode: 'entry-column', depth: Math.min(Math.max(cd, rd), extent) };
    const st = cd <= extent + EPS && bandW - cw > 0 ? stackDepth(rest, bandW - cw, extent, targetDepth) : null;
    if (st !== null) return { mode: 'entry-stack', depth: Math.min(Math.max(cd, st), extent) };
  }
  const col = stackDepth(targets, bandW, extent, targetDepth);
  return col !== null ? { mode: 'column', depth: col } : null;
}

/** Row width of `targets` at depth `depth`: target-sized, aspect / dimension bounded, never below minimums. */
function rowWidth(targets: RoomTargets[], depth: number): number {
  let w = 0;
  for (const t of targets) {
    let wi = Math.min(t.targetArea / depth, CELL_QUALITY_MAX_ASPECT * depth);
    if (t.maxDimension !== null) wi = Math.min(wi, t.maxDimension);
    wi = Math.max(wi, t.widthFloor, t.minArea / depth);
    w += wi;
  }
  return w;
}

/**
 * Pure: band width `targets` need at depth `depth` in `mode` (the width counterpart of
 * bandDepthDemand). Null for the stacked modes — their cells share the band width, so
 * no width slack is derivable.
 */
export function bandWidthDemand(targets: RoomTargets[], depth: number, mode: BandDemandMode = 'row'): number | null {
  if (targets.length === 0) return 0;
  if (!(depth > 0) || mode === 'column' || mode === 'entry-stack') return null;
  if (mode === 'row') return ceilCm(rowWidth(targets, depth));
  const entry = targets.filter(t => ENTRY_COLUMN_TYPES.has(t.type));
  const rest = targets.filter(t => !ENTRY_COLUMN_TYPES.has(t.type));
  return ceilCm(entryColumnWidth(entry) + rowWidth(rest, depth));
}

interface FloorDemand {
  level: number;
  targets: RoomTargets[];
  pub: RoomTargets[];
  priv: RoomTargets[];
  hasKitchen: boolean;
  kitchen: RoomTargets | null;
  needStair: boolean;
  hasLift: boolean;
}

/** Widths of the zone-model strips at frame width W (the carveZones horizontal arithmetic). */
function stripsAt(W: number, cfg: ReturnType<typeof strategyConfig>, f: FloorDemand) {
  const spurW = entrySpurWidth(W, cfg.spurWidthFraction);
  const workW = W - spurW;
  const kwRaw = f.hasKitchen ? kitchenStripWidth(workW) : 0;
  const kw = f.hasKitchen && workW > kwRaw + 2.0 ? kwRaw : 0;
  const pubMainW = workW - kw;
  const pocketW = f.needStair && W > 5.5 ? stairPocketWidth(W) : 0;
  const liftW = f.needStair && W > 5.5 && f.hasLift ? elevatorCellSize().width : 0;
  const privMainW = W - pocketW - liftW;
  return { spurW, workW, kw, pubMainW, pocketW, liftW, privMainW };
}

/**
 * Smallest depth on the 1 cm grid in [lo, hi] satisfying the monotone predicate `ok`
 * (deterministic bisection), or null when even `hi` fails.
 */
function minFeasibleDepth(ok: (d: number) => boolean, lo: number, hi: number): number | null {
  let a = ceilCm(lo), b = Math.floor(hi * 100 + 1e-6) / 100;
  if (b < a - EPS || !ok(b)) return null;
  if (ok(a)) return a;
  // invariant: ok(b) && !ok(a)
  while (Math.round((b - a) * 100) > 1) {
    const m = Math.round(((a + b) / 2) * 100) / 100;
    if (ok(m)) b = m; else a = m;
  }
  return b;
}

/**
 * Rooms each band of a floor hosts at band depths (pubH, privH): the programme bands,
 * or — upper floor, 5.6A option, no public programme, private minimum widths beyond the
 * back band — the upperFloorFrontPrivateSplit of the private rooms (trailing rooms to
 * the front band).
 */
function bandSets(W: number, pubH: number, privH: number, cfg: ReturnType<typeof strategyConfig>, f: FloorDemand, frontPrivate: boolean) {
  const s = stripsAt(W, cfg, f);
  if (frontPrivate && f.level > 0 && f.pub.length === 0 && f.priv.length >= 2
    && f.priv.reduce((a, t) => a + t.widthFloor, 0) > s.privMainW + GEOM_EPS && pubH > 0 && privH > 0) {
    const k = upperFloorFrontPrivateSplit(
      f.priv.map(t => ({ minWidths: [t.widthFloor], minDepths: [t.minDepth] })),
      { w: s.privMainW, h: privH }, { w: s.pubMainW, h: pubH });
    if (k !== null) return { s, pub: f.priv.slice(f.priv.length - k), priv: f.priv.slice(0, f.priv.length - k) };
  }
  return { s, pub: f.pub, priv: f.priv };
}

/** Every floor's bands host their programme minimums at W × (pubD, privD). */
function framesHost(W: number, pubD: number, privD: number, cfg: ReturnType<typeof strategyConfig>, floors: FloorDemand[], frontPrivate: boolean, targetDepth = false): boolean {
  if (pubD < BAND_MIN_DEPTH - EPS || privD < BAND_MIN_DEPTH - EPS) return false;
  for (const f of floors) {
    const { s, pub, priv } = bandSets(W, pubD, privD, cfg, f, frontPrivate);
    if (s.pubMainW <= GEOM_EPS || s.privMainW <= 1.2) return false;
    // hosted = one of the demand modes (row / M3 entry column / column) fits at the band size;
    // row and column are exactly topology's bandCanHost predicate.
    if (pub.length > 0 && !bandDepthDemand(pub, s.pubMainW, pubD, targetDepth)) return false;
    if (priv.length > 0 && !bandDepthDemand(priv, s.privMainW, privD, targetDepth)) return false;
    if (f.kitchen && s.kw > 0 && pubD < Math.max(f.kitchen.minDepth, f.kitchen.minArea / s.kw) - EPS) return false;
    if (f.needStair && W > 5.5 && privD < stairPocketDepth(privD) - EPS) return false;
    if (f.needStair && f.hasLift && W > 5.5 && privD < elevatorCellSize().depth - EPS) return false;
  }
  return true;
}

/** World corridor line: `acrossY` = the corridor runs along x (constant y). */
function corridorLineOf(c: Rect, acrossY: boolean): CorridorLine {
  return acrossY
    ? { axis: 'y', offset: c.y, width: c.h, from: c.x, to: c.x + c.w }
    : { axis: 'x', offset: c.x, width: c.w, from: c.y, to: c.y + c.h };
}

/**
 * Pure, deterministic frame derivation. Returns null for non-finite / zero-area
 * slices, empty programmes, the vertical spine (P1), and slices whose bands cannot
 * host every floor's programme minimums. Never mutates its input.
 */
export function deriveBuildingFrame(input: BuildingFrameInput): BuildingFrame | null {
  const { slice, access, strategy, floorSpecs } = input;
  if (!slice || !finiteRect(slice)) return null;
  if (!Array.isArray(floorSpecs) || floorSpecs.length === 0 || floorSpecs.every(f => f.length === 0)) return null;
  if (!['south', 'north', 'east', 'west'].includes(access)) return null;
  const cfg = strategyConfig(strategy);
  if (cfg.spine === 'vertical') return input.verticalSpine === true ? deriveVerticalFrame(input, cfg) : null;

  // P16-B: work in the access frame (street face at min-y); map back at the end.
  const af = buildAccessFrame(slice, access);
  const toF = (r: Rect) => (af ? af.to(r) : { ...r });
  const fromF = (r: Rect) => (af ? af.from(r) : { ...r });
  const L = toF(slice);
  const W = L.w, H = L.h;
  const large = zoneUnitIsLarge(L);

  const frontPrivate = input.upperFloorFrontPrivate === true;
  const floors: FloorDemand[] = floorSpecs.map((specs, level) => {
    const targets = deriveRoomTargets(specs, large, input.mainRoomMinDimension === true);
    return {
      level,
      targets,
      pub: targets.filter(t => t.band === 'public'),
      priv: targets.filter(t => t.band === 'private'),
      hasKitchen: specs.some(s => s.type === 'kitchen'),
      kitchen: targets.find(t => t.type === 'kitchen') ?? null,
      needStair: specs.some(s => s.type === 'stair-hall'),
      hasLift: specs.some(s => s.type === 'elevator-hall'),
    };
  });

  const avail = H - CORRIDOR_W;
  if (avail < 2 * BAND_MIN_DEPTH - EPS) return null;
  const tgt = input.targetPublicDepth === true;

  // ---- private depth (P16-C capped depths at the private row shares) ----
  // Public-first, as the design orders it: (1) the private band's minimum feasible depth
  // (contract minimums, stair pocket, lift cell) on every floor; (2) the public band
  // takes its programme demand within what that leaves; (3) the private band takes its
  // P16-C demand within the rest; slack behind it becomes the rear residual.
  const minPrivOk = (d: number) => floors.every(f => {
    const { s, priv } = bandSets(W, avail - d, d, cfg, f, frontPrivate);
    if (priv.length > 0 && !bandDepthDemand(priv, s.privMainW, d, tgt)) return false;
    if (f.needStair && W > 5.5 && stairPocketDepth(d) > d + EPS) return false;
    if (f.needStair && f.hasLift && W > 5.5 && d < elevatorCellSize().depth - EPS) return false;
    return true;
  });
  const privMin = minFeasibleDepth(minPrivOk, BAND_MIN_DEPTH, avail - BAND_MIN_DEPTH);
  if (privMin === null) return null;

  let pubD = 0;
  for (const f of floors) {
    const { s, pub } = bandSets(W, avail - privMin, privMin, cfg, f, frontPrivate);
    if (pub.length > 0) {
      const d = bandDepthDemand(pub, s.pubMainW, avail - privMin, tgt);
      if (d === null) return null;
      pubD = Math.max(pubD, d.depth);
    }
    if (f.kitchen && s.kw > 0) pubD = Math.max(pubD, f.kitchen.minDepth, f.kitchen.minArea / s.kw);
  }
  pubD = Math.max(ceilCm(pubD), BAND_MIN_DEPTH);
  if (pubD > avail - privMin + GEOM_EPS) return null;

  let privD = privMin;
  for (const f of floors) {
    const { s, priv } = bandSets(W, pubD, avail - pubD, cfg, f, frontPrivate);
    if (priv.length > 0) {
      const d = bandDepthDemand(priv, s.privMainW, avail - pubD, tgt);
      if (d === null) return null;
      privD = Math.max(privD, d.depth);
    }
  }
  privD = Math.max(ceilCm(privD), BAND_MIN_DEPTH);
  if (pubD + CORRIDOR_W + privD > H + GEOM_EPS) return null;

  // Feasibility at the demand depths; otherwise the private band absorbs the rear slack.
  let rearH = H - (pubD + CORRIDOR_W + privD);
  if (rearH < CELL_QUALITY_MIN_VOID - EPS) { privD += rearH; rearH = 0; }
  if (!framesHost(W, pubD, privD, cfg, floors, frontPrivate, tgt)) {
    if (rearH === 0) return null;
    privD += rearH; rearH = 0;
    if (!framesHost(W, pubD, privD, cfg, floors, frontPrivate, tgt)) return null;
  }
  const frameH = pubD + CORRIDOR_W + privD;

  // ---- side residual: width beyond every floor's row demand (spur/kitchen/core strips included) ----
  let needW = 0;
  let rowModel = true;
  for (const f of floors) {
    const { s, pub, priv } = bandSets(W, pubD, privD, cfg, f, frontPrivate);
    // the width demand follows the mode each band actually needs at the chosen depth.
    const pm = pub.length > 0 ? bandDepthDemand(pub, s.pubMainW, pubD, tgt) : null;
    const vm = priv.length > 0 ? bandDepthDemand(priv, s.privMainW, privD, tgt) : null;
    const pw = pm ? bandWidthDemand(pub, pubD, pm.mode) : 0;
    const vw = vm ? bandWidthDemand(priv, privD, vm.mode) : 0;
    if ((pub.length > 0 && (!pm || pw === null)) || (priv.length > 0 && (!vm || vw === null))) { rowModel = false; break; }
    needW = Math.max(needW, s.spurW + s.kw + (pw ?? 0), s.pocketW + s.liftW + (vw ?? 0));
  }
  needW = ceilCm(needW);
  let frameW = W;
  if (rowModel && input.noSideResidual !== true && W - needW >= CELL_QUALITY_MIN_VOID - EPS) {
    // the stair-pocket rule must not switch off by the cut (W > 5.5 ⇔ W' > 5.5).
    const stairSafe = !floors.some(f => f.needStair) || W <= 5.5 || needW > 5.5;
    if (stairSafe && framesHost(needW, pubD, privD, cfg, floors, frontPrivate, tgt)) frameW = needW;
  }
  const sideW = W - frameW;

  // ---- local geometry (street at min-y, spur at min-x, side cut at max-x) ----
  const frameL: Rect = { x: L.x, y: L.y, w: frameW, h: frameH };
  const publicBand: Rect = { x: L.x, y: L.y, w: frameW, h: pubD };
  const corridor: Rect = { x: L.x, y: L.y + pubD, w: frameW, h: CORRIDOR_W };
  const privateBand: Rect = { x: L.x, y: L.y + pubD + CORRIDOR_W, w: frameW, h: privD };
  const f0 = floors.find(f => f.hasKitchen) ?? floors[0];
  const s0 = stripsAt(frameW, cfg, f0);
  const entrySpur: Rect | null = s0.spurW > 0 ? { x: L.x, y: L.y, w: s0.spurW, h: pubD } : null;
  const kitchenStrip: Rect | null = s0.kw > 0 ? { x: L.x + s0.spurW + s0.workW - s0.kw, y: L.y, w: s0.kw, h: pubD } : null;
  const residualRear: Rect | null = rearH > 0 ? { x: L.x, y: L.y + frameH, w: W, h: H - frameH } : null;
  const residualSide: Rect | null = sideW > 0 ? { x: L.x + frameW, y: L.y, w: sideW, h: frameH } : null;
  const local: FrameGeometry & { slice: Rect } = {
    slice: L, frame: frameL, publicBand, corridor, privateBand, entrySpur, kitchenStrip, residualRear, residualSide,
  };

  // ---- validity: positive, inside the slice, residuals disjoint from the frame ----
  const all = [frameL, publicBand, corridor, privateBand, entrySpur, kitchenStrip, residualRear, residualSide]
    .filter((r): r is Rect => r !== null);
  if (!all.every(r => finiteRect(r) && rContains(L, r, GEOM_EPS))) return null;
  // residual strips only touch the frame (negative eps: shared edges are not overlap).
  for (const res of [residualRear, residualSide]) {
    if (res && rIntersects(res, frameL, -GEOM_EPS)) return null;
  }
  if (residualRear && residualSide && rIntersects(residualRear, residualSide, -GEOM_EPS)) return null;

  const mapG = (g: FrameGeometry): FrameGeometry => ({
    frame: fromF(g.frame), publicBand: fromF(g.publicBand), corridor: fromF(g.corridor),
    privateBand: fromF(g.privateBand),
    entrySpur: g.entrySpur ? fromF(g.entrySpur) : null,
    kitchenStrip: g.kitchenStrip ? fromF(g.kitchenStrip) : null,
    residualRear: g.residualRear ? fromF(g.residualRear) : null,
    residualSide: g.residualSide ? fromF(g.residualSide) : null,
  });
  const world = mapG(local);
  const c = world.corridor;
  const corridorLine = corridorLineOf(c, access === 'south' || access === 'north');
  const corridorFraction = Math.round(((pubD + CORRIDOR_W / 2) / frameH) * 1e6) / 1e6;

  return {
    strategy, spine: cfg.spine, access,
    slice: { ...slice },
    world, local, corridorLine,
    publicDepth: pubD, privateDepth: privD,
    corridorFraction,
    ladderCompatible: corridorFraction >= LADDER_LO - EPS && corridorFraction <= LADDER_HI + EPS,
    targets: floors.map(f => f.targets),
  };
}

/**
 * P7: the vertical-spine frame. carveZones' vertical zoning (verticalSpineFits /
 * carveVerticalZones) with ONE spine fraction for the whole building: the ladder
 * fraction closest to the strategy default at which EVERY floor passes the vertical band
 * test (programme cells with the main-room preference first, then the raw minimums —
 * carveZones' own order). Null when no fraction fits every floor (the legacy per-floor
 * default would stand with an unhosted band). The frame is the whole slice: no residual
 * cut (the vertical bands have no column-demand model to size one). In this frame the
 * "public / private depth" are the west / east band widths (street-perpendicular spine)
 * and corridorFraction is the spine fraction itself.
 */
function deriveVerticalFrame(input: BuildingFrameInput, cfg: ReturnType<typeof strategyConfig>): BuildingFrame | null {
  const { slice, access, strategy, floorSpecs } = input;
  const af = buildAccessFrame(slice, access);
  const fromF = (r: Rect) => (af ? af.from(r) : { ...r });
  const L = af ? af.to(slice) : { ...slice };
  const large = zoneUnitIsLarge(L);
  const floors = floorSpecs.map(specs => {
    const pubR = zoneBandCells(specs, ['public', 'semi-private']);
    const privR = zoneBandCells(specs, ['private']);
    return {
      needStair: specs.some(s => s.type === 'stair-hall'),
      hasKitchen: specs.some(s => s.type === 'kitchen'),
      hasStorage: specs.some(s => s.type === 'storage'),
      pubR, privR, pub: strictifyBandCells(pubR, large), priv: strictifyBandCells(privR, large),
    };
  });
  const home = cfg.verticalCorridorFraction ?? 0.5;
  const ladder = { lo: LADDER_LO, hi: LADDER_HI, step: 0.01 };
  const fitsAll = (f: number, strict: boolean) => floors.every(fl =>
    verticalSpineFits(L, f, fl.needStair, fl.hasKitchen, fl.hasStorage, strict ? fl.pub : fl.pubR, strict ? fl.priv : fl.privR));
  let vf = chooseSpineFraction(home, f => fitsAll(f, true), ladder);
  if (!fitsAll(vf, true)) {
    vf = chooseSpineFraction(home, f => fitsAll(f, false), ladder);
    if (!fitsAll(vf, false)) return null;
  }
  const vx = L.x + L.w * vf - CORRIDOR_W / 2;
  // P10 (opt-in): the frame cut to its target-sized column length (null when none fits).
  let FL: Rect = { ...L };
  if (input.verticalTargetLength === true) {
    const h = verticalTargetLength(input, L, vf, vx, large, floors, fitsAll(vf, true));
    if (h === null) return null;
    FL = { ...L, h };
  }
  const publicBand: Rect = { x: L.x, y: L.y, w: vx - L.x, h: FL.h };
  const corridor: Rect = { x: vx, y: L.y, w: CORRIDOR_W, h: FL.h };
  const privateBand: Rect = { x: vx + CORRIDOR_W, y: L.y, w: L.x + L.w - (vx + CORRIDOR_W), h: FL.h };
  const f0 = floors.findIndex(f => f.hasKitchen);
  // the kitchen pocket is carveZones' full-slice pocket; a cut frame moves it (same size)
  // to the frame's new rear end.
  const kz = f0 >= 0 ? carveVerticalZones(L, vf, floors[f0].needStair, true, floors[f0].hasStorage, floors[f0].priv, null, true) : null;
  const kitchenStrip = kz?.kitchenPocket ? { ...kz.kitchenPocket, y: FL.y + FL.h - kz.kitchenPocket.h } : null;
  const frameL: Rect = { ...FL };
  const residualRear: Rect | null = FL.h < L.h - GEOM_EPS ? { x: L.x, y: L.y + FL.h, w: L.w, h: L.h - FL.h } : null;
  const all = [frameL, publicBand, corridor, privateBand, kitchenStrip].filter((r): r is Rect => r !== null);
  if (!all.every(r => finiteRect(r) && rContains(L, r, GEOM_EPS))) return null;
  const local: FrameGeometry & { slice: Rect } = {
    slice: L, frame: frameL, publicBand, corridor, privateBand, entrySpur: null, kitchenStrip,
    residualRear, residualSide: null,
  };
  const world: FrameGeometry = {
    frame: fromF(frameL), publicBand: fromF(publicBand), corridor: fromF(corridor), privateBand: fromF(privateBand),
    entrySpur: null, kitchenStrip: kitchenStrip ? fromF(kitchenStrip) : null,
    residualRear: residualRear ? fromF(residualRear) : null, residualSide: null,
  };
  return {
    strategy, spine: cfg.spine, access,
    slice: { ...slice },
    world, local,
    // the local corridor runs street → rear (constant local x).
    corridorLine: corridorLineOf(world.corridor, !(access === 'south' || access === 'north')),
    publicDepth: publicBand.w, privateDepth: privateBand.w,
    corridorFraction: vf,
    ladderCompatible: true,
    targets: floorSpecs.map(specs => deriveRoomTargets(specs, large, input.mainRoomMinDimension === true)),
  };
}

/**
 * P10: target-sized length of a vertical-spine frame (local coordinates), or null when no
 * cut fits. Every floor is carved on the FULL slice (carveVerticalZones), so its kitchen
 * pocket and its south stair / lift / storage pockets are exactly carveZones'. The public
 * column needs its public / semi-private target areas (RoomTargets.targetArea) along the
 * public band width, plus the kitchen pocket. The length starts at the largest such need
 * over the floors (cm-rounded up) and grows in 1 cm steps until every floor's public and
 * private columns pass bandCanHost at that length (strict cells when the spine fraction
 * was chosen on them, else raw — carveZones' order). Null when it reaches the slice
 * length (no cut). Pure, deterministic.
 */
function verticalTargetLength(
  input: BuildingFrameInput, L: Rect, vf: number, vx: number, large: boolean,
  floors: { needStair: boolean; hasKitchen: boolean; hasStorage: boolean; pub: BandCellDemand[]; pubR: BandCellDemand[]; priv: BandCellDemand[]; privR: BandCellDemand[] }[],
  strict: boolean,
): number | null {
  const pubW = vx - L.x;
  const privW = L.x + L.w - (vx + CORRIDOR_W);
  const per = input.floorSpecs.map((specs, l) => {
    const fl = floors[l];
    const z = carveVerticalZones(L, vf, fl.needStair, fl.hasKitchen, fl.hasStorage, fl.priv,
      specs.some(s => s.type === 'elevator-hall') ? elevatorCellSize() : null, true);
    const pubZ = z.zones.public[0], privZ = z.zones.private[0];
    const publicTargets = deriveRoomTargets(specs, large, input.mainRoomMinDimension === true).filter(t => {
      const sp = specs.find(s => s.placedId === t.placedId);
      const zone = sp ? zoneOf(sp) : null;
      return (zone === 'public' || zone === 'semi-private') && t.type !== 'yard' && t.type !== 'balcony';
    });
    return {
      pubCells: strict ? fl.pub : fl.pubR,
      privCells: strict ? fl.priv : fl.privR,
      kitchenH: L.h - pubZ.h,          // the full-slice kitchen pocket
      southH: privZ.y - L.y,           // the full-slice stair / lift / storage pockets
      need: publicTargets.reduce((a, t) => a + t.targetArea, 0) / Math.max(pubW, 0.5),
    };
  });
  const hosts = (h: number) => per.every(p =>
    (p.pubCells.length === 0 || (h - p.kitchenH > 0 && bandCanHost(pubW, h - p.kitchenH, p.pubCells)))
    && (p.privCells.length === 0 || (h - p.southH > 0 && bandCanHost(privW, h - p.southH, p.privCells))));
  let h = ceilCm(Math.max(...per.map(p => p.need + p.kitchenH)));
  while (h < L.h - GEOM_EPS && !hosts(h)) h = Math.round(h * 100 + 1) / 100;
  return h < L.h - GEOM_EPS ? h : null;
}
