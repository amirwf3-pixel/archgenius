/**
 * Coordinated Rectangle planner — P4: guarded prototype for single-floor rectangle
 * floors WITHOUT a stair / elevator core.
 *
 *   BuildingFrame (P1) → public family (P2) → placeSpaces(pinnedZones + publicFamily) (P3)
 *
 * The frame's band geometry becomes the placer's zone partition; the public family is
 * the one the frame sized the public band for. Everything after placement (openings,
 * walls, validation, ranking) is the unchanged pipeline, and the generator adopts the
 * result only through adoptCoordinatedRectVariant — otherwise the legacy candidate
 * stands unchanged. Nothing here runs unless the caller opts in
 * (GenerateLayoutsOptions.coordinatedRectPlanner === true).
 *
 * P5 adds the multi-floor core plan and P6 the frame residuals (below). P7 extends both to
 * the vertical spine (carveZones' vertical zoning at one shared spine fraction, stair pocket
 * + lift cell on the spine) and designates the kitchen / stair pockets of every pinned
 * layout so rotated / residual-narrowed frames (north / east / west access) keep their
 * core on the plan cell. No new threshold: every dimension is the frame's (P1) or
 * carveZones' arithmetic.
 */
import type { Rect } from '../geometry/rect.js';
import type { CandidateStrategy } from '../model/layout.js';
import type { AccessSide } from '../model/site.js';
import type { Space, SpaceType, Zone } from '../model/space.js';
import {
  buildAccessFrame, carveVerticalZones, mapZoneLayout, placeSpaces, stairPocketDepth, stairPocketWidth,
  strictifyBandCells, zoneBandCells, zoneUnitIsLarge,
  type PlacedSpec, type PlacerOptions, type PublicFamilyId, type ZoneLayout,
} from './placer.js';
import { bandDepthDemand, deriveBuildingFrame, type BandDemandMode, type BuildingFrame } from './building-frame.js';
import { elevatorCellSize } from '../model/stairs.js';

/** Explanation prefix of a floor laid out by the coordinated planner. */
export const COORDINATED_RECT_APPLIED = 'P4 coordinated rectangle planner:';

/** Programme types that make a vertical core (P4 does not handle them). */
const CORE_TYPES: ReadonlySet<string> = new Set(['stair-hall', 'elevator-hall']);

/** P4 scope: a single-floor programme without a stair / elevator core. */
export function coordinatedRectEligible(specs: PlacedSpec[], isOnlyFloor: boolean): boolean {
  return isOnlyFloor && specs.length > 0 && !specs.some(s => CORE_TYPES.has(s.type));
}

/**
 * The frame's zone partition as a placer ZoneLayout (world coordinates): the corridor
 * (and L-spur entry patch), the public main band between the spur and the kitchen
 * strip, the kitchen strip as the service zone, and the private band. The residual
 * rear / side strips stay outside every zone (unused buildable area).
 */
export function frameZoneLayout(frame: BuildingFrame, specs: PlacedSpec[] = []): ZoneLayout {
  if (frame.spine === 'vertical') return verticalFloorZones(frame, specs);
  const af = buildAccessFrame(frame.slice, frame.access);
  const fromF = (r: Rect): Rect => (af ? af.from(r) : { ...r });
  const g = frame.local;
  const x0 = g.entrySpur ? g.entrySpur.x + g.entrySpur.w : g.publicBand.x;
  const x1 = g.kitchenStrip ? g.kitchenStrip.x : g.publicBand.x + g.publicBand.w;
  const publicMain: Rect = { x: x0, y: g.publicBand.y, w: x1 - x0, h: g.publicBand.h };
  const corridors: Rect[] = [fromF(g.corridor)];
  let entrancePatch: Rect | undefined;
  if (g.entrySpur) { entrancePatch = fromF(g.entrySpur); corridors.push(entrancePatch); }
  const kitchenPocket = g.kitchenStrip ? fromF(g.kitchenStrip) : undefined;
  return {
    zones: {
      public: [fromF(publicMain)],
      'semi-private': [],
      private: [fromF(g.privateBand)],
      service: kitchenPocket ? [kitchenPocket] : [],
      circulation: [],
    },
    corridors,
    entrancePatch,
    elevatorPocket: undefined,
    ...(kitchenPocket ? { kitchenPocket } : {}),
  };
}

/**
 * P7: one floor's zone partition on a vertical-spine frame (world coordinates) —
 * carveZones' vertical zoning (carveVerticalZones) at the frame's shared spine fraction
 * with this floor's programme flags, the kitchen / stair pockets designated. The lift
 * cell is reserved exactly as carveZones reserves it (programme carries an elevator).
 */
export function verticalFloorZones(frame: BuildingFrame, specs: PlacedSpec[]): ZoneLayout {
  const L = frame.local.slice;
  const af = buildAccessFrame(frame.slice, frame.access);
  const fromF = (r: Rect): Rect => (af ? af.from(r) : { ...r });
  const privCells = strictifyBandCells(zoneBandCells(specs, ['private']), zoneUnitIsLarge(L));
  const local = carveVerticalZones(L, frame.corridorFraction,
    specs.some(s => s.type === 'stair-hall'), specs.some(s => s.type === 'kitchen'), specs.some(s => s.type === 'storage'),
    privCells, specs.some(s => s.type === 'elevator-hall') ? elevatorCellSize() : null, true);
  // P10: a cut frame (verticalTargetLength) — the full-slice zones end at the frame's rear
  // edge; the south pockets are unchanged and the kitchen pocket keeps its size, moved to
  // the new rear end. An uncut frame (frame = slice) is left exactly as carved.
  const F = frame.local.frame;
  if (F.h < L.h - 1e-9) {
    const top = F.y + F.h;
    for (const c of local.corridors) c.h = top - c.y;
    const kp = local.kitchenPocket;
    for (const r of local.zones.public) r.h = top - (kp ? kp.h : 0) - r.y;
    if (kp) kp.y = top - kp.h;
    for (const r of local.zones.private) r.h = top - r.y;
  }
  return mapZoneLayout(local, fromF);
}

/**
 * The public family the frame sized its public band for (its bandDepthDemand mode at
 * the frame's public depth): one row of the whole public programme → shallow-band; the
 * M3 entry column beside the living field → entry-column (the living / dining layer then
 * keeps its own side-by-side / stacked rule); one column → stacked. Undefined when the
 * band carries no public programme.
 */
export function framePublicFamily(frame: BuildingFrame, level = 0, hasKitchen = true): PublicFamilyId | undefined {
  // P7: the vertical public column keeps the placer's own family selection.
  if (frame.spine === 'vertical') return undefined;
  const pub = (frame.targets[level] ?? []).filter(t => t.band === 'public');
  if (pub.length === 0) return undefined;
  const g = frame.local;
  const x0 = g.entrySpur ? g.entrySpur.x + g.entrySpur.w : g.publicBand.x;
  const x1 = g.kitchenStrip && hasKitchen ? g.kitchenStrip.x : g.publicBand.x + g.publicBand.w;
  const d = bandDepthDemand(pub, x1 - x0, frame.publicDepth);
  if (!d) return undefined;
  const byMode: Record<BandDemandMode, PublicFamilyId> = {
    'row': 'shallow-band', 'entry-column': 'entry-column', 'entry-stack': 'entry-column', 'column': 'stacked',
  };
  return byMode[d.mode];
}

export interface CoordinatedRectRequest {
  slice: Rect;
  specs: PlacedSpec[];
  strategy: CandidateStrategy;
  access: AccessSide;
  /** 'frame' pins framePublicFamily; 'placer' pins the zones only (the placer's own family selection). */
  family: 'frame' | 'placer';
  mainRoomMinDimension?: boolean;
  /** P8: derive the frame without the side residual strip (BuildingFrameInput.noSideResidual). */
  noSideResidual?: boolean;
  /** P9: target-sized band depths (BuildingFrameInput.targetPublicDepth). */
  targetPublicDepth?: boolean;
  /** P10: the vertical frame cut to its target-sized length (BuildingFrameInput.verticalTargetLength). */
  verticalTargetLength?: boolean;
}

/**
 * P4: place one eligible floor through the frame. Null when the frame cannot be derived
 * (vertical spine, infeasible demand …) — the caller then keeps the legacy placement.
 */
export function placeCoordinatedRect(
  req: CoordinatedRectRequest,
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
  opts: PlacerOptions = {},
): { spaces: Space[]; corridors: Space[]; explanation: string[]; residual: FrameResidual } | null {
  const frame = deriveBuildingFrame({
    slice: req.slice, access: req.access, strategy: req.strategy, floorSpecs: [req.specs],
    mainRoomMinDimension: req.mainRoomMinDimension === true,
    verticalSpine: true,
    ...(req.noSideResidual === true ? { noSideResidual: true } : {}),
    ...(req.targetPublicDepth === true ? { targetPublicDepth: true } : {}),
    ...(req.verticalTargetLength === true ? { verticalTargetLength: true } : {}),
  });
  if (!frame) return null;
  const pinnedZones = frameZoneLayout(frame, req.specs);
  const publicFamily = req.family === 'frame' ? framePublicFamily(frame) : undefined;
  const out = placeSpaces(req.slice, req.specs, req.strategy, req.access, mkSpace,
    { ...opts, pinnedZones, ...(publicFamily ? { publicFamily } : {}) });
  const r2 = (v: number) => v.toFixed(2);
  out.explanation.unshift(`${COORDINATED_RECT_APPLIED} frame public ${r2(frame.publicDepth)} m + corridor + private ${r2(frame.privateDepth)} m` +
    ` (frame ${r2(frame.local.frame.w)}×${r2(frame.local.frame.h)} m in slice ${r2(frame.local.slice.w)}×${r2(frame.local.slice.h)} m), public family ${publicFamily ?? 'placer selection'}.`);
  return { ...out, residual: frameResidual(frame) };
}

// ---------------------------------------------------------------------------
// P5 — multi-floor: one authoritative pre-placement core / corridor frame.
// ---------------------------------------------------------------------------

/** Explanation prefix of a floor laid out from the coordinated multi-floor core plan. */
export const COORDINATED_CORE_APPLIED = 'P5 coordinated multi-floor core:';

export type CoreSide = 'north' | 'south' | 'east' | 'west';

/** One pre-placement core cell (world) and the side its circulation approaches from. */
export interface CoordinatedCoreCell { rect: Rect; side: CoreSide }

/**
 * The building's coordinated plan, derived ONCE before the floor loop: the frame
 * (one corridor line for every floor), the stair and elevator cells (the carveZones
 * pocket / shaft arithmetic on the frame's private band), and each floor's pinned zone
 * partition and public family.
 */
export interface CoordinatedCorePlan {
  frame: BuildingFrame;
  slice: Rect;
  stair: CoordinatedCoreCell | null;
  elevator: CoordinatedCoreCell | null;
  /** per level (index = level). */
  floorZones: ZoneLayout[];
  floorFamilies: (PublicFamilyId | undefined)[];
}

export interface CoordinatedCorePlanInput {
  slice: Rect;
  access: AccessSide;
  strategy: CandidateStrategy;
  /** placed programme specs per floor, level 0 first (2+ floors). */
  floorSpecs: PlacedSpec[][];
  mainRoomMinDimension?: boolean;
  /** the Phase 5.6A split the placer applies on upper floors (sizes the frame the same way). */
  upperFloorFrontPrivate?: boolean;
  /** P8: derive the frame without the side residual strip (BuildingFrameInput.noSideResidual). */
  noSideResidual?: boolean;
  /** P9: target-sized band depths (BuildingFrameInput.targetPublicDepth). */
  targetPublicDepth?: boolean;
  /** P10: the vertical frame cut to its target-sized length (BuildingFrameInput.verticalTargetLength). */
  verticalTargetLength?: boolean;
}

/** Side of `cell` touched by `corr` along a full shared edge, or null. */
function touchingSide(cell: Rect, corr: Rect): CoreSide | null {
  const E = 1e-6;
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  const alongX = ov(cell.x, cell.x + cell.w, corr.x, corr.x + corr.w) >= cell.w - E;
  const alongY = ov(cell.y, cell.y + cell.h, corr.y, corr.y + corr.h) >= cell.h - E;
  if (alongX && Math.abs(corr.y + corr.h - cell.y) < E) return 'south';
  if (alongX && Math.abs(corr.y - (cell.y + cell.h)) < E) return 'north';
  if (alongY && Math.abs(corr.x + corr.w - cell.x) < E) return 'west';
  if (alongY && Math.abs(corr.x - (cell.x + cell.w)) < E) return 'east';
  return null;
}

/**
 * P5: the coordinated core plan, or null when the building cannot be coordinated
 * (no frame, a floor needs a stair the frame's private band cannot pocket, the lift cell
 * does not fit beside it, or a core cell does not face the corridor). Pure, deterministic.
 */
export function planCoordinatedCore(input: CoordinatedCorePlanInput): CoordinatedCorePlan | null {
  const { slice, access, strategy, floorSpecs } = input;
  if (floorSpecs.length < 2) return null;
  const frame = deriveBuildingFrame({
    slice, access, strategy, floorSpecs,
    mainRoomMinDimension: input.mainRoomMinDimension === true,
    upperFloorFrontPrivate: input.upperFloorFrontPrivate === true,
    verticalSpine: true,
    ...(input.noSideResidual === true ? { noSideResidual: true } : {}),
    ...(input.targetPublicDepth === true ? { targetPublicDepth: true } : {}),
    ...(input.verticalTargetLength === true ? { verticalTargetLength: true } : {}),
  });
  if (!frame) return null;
  if (frame.spine === 'vertical') return planVerticalCore(frame, floorSpecs);
  const af = buildAccessFrame(slice, access);
  const fromF = (r: Rect): Rect => (af ? af.from(r) : { ...r });
  const g = frame.local;
  const band = g.privateBand;
  const needStair = floorSpecs.map(f => f.some(s => s.type === 'stair-hall'));
  const needLift = floorSpecs.map((f, l) => needStair[l] && f.some(s => s.type === 'elevator-hall'));
  // carveZones: the stair pocket exists only on bands wider than 5.5 m; the lift cell
  // beside it only when the band is deep enough and the private main stays > 1.2 m.
  let pocket: Rect | null = null;
  let lift: Rect | null = null;
  if (needStair.some(Boolean)) {
    if (!(band.w > 5.5)) return null;
    const pw = stairPocketWidth(band.w);
    pocket = { x: band.x, y: band.y, w: pw, h: stairPocketDepth(band.h) };
    if (needLift.some(Boolean)) {
      const cell = elevatorCellSize();
      if (!(band.h + 1e-9 >= cell.depth && band.w - pw - cell.width > 1.2)) return null;
      lift = { x: band.x + pw, y: band.y, w: cell.width, h: cell.depth };
    }
  }
  const corridorW = fromF(g.corridor);
  const cellOf = (r: Rect | null): CoordinatedCoreCell | null | false => {
    if (!r) return null;
    const w = fromF(r);
    const side = touchingSide(w, corridorW);
    return side ? { rect: w, side } : false;
  };
  const stair = cellOf(pocket);
  const elevator = cellOf(lift);
  if (stair === false || elevator === false) return null;

  const floorZones: ZoneLayout[] = [];
  const floorFamilies: (PublicFamilyId | undefined)[] = [];
  floorSpecs.forEach((specs, level) => {
    const hasKitchen = specs.some(s => s.type === 'kitchen');
    const x0 = g.entrySpur ? g.entrySpur.x + g.entrySpur.w : g.publicBand.x;
    const x1 = g.kitchenStrip && hasKitchen ? g.kitchenStrip.x : g.publicBand.x + g.publicBand.w;
    const publicMain: Rect = { x: x0, y: g.publicBand.y, w: x1 - x0, h: g.publicBand.h };
    const service: Rect[] = [];
    let privX = band.x;
    let stairPocket: Rect | undefined;
    let kitchenPocket: Rect | undefined;
    if (needStair[level] && pocket) { stairPocket = fromF(pocket); service.push(stairPocket); privX = pocket.x + pocket.w; }
    let elevatorPocket: Rect | undefined;
    if (needLift[level] && lift) { elevatorPocket = fromF(lift); privX = lift.x + lift.w; }
    if (g.kitchenStrip && hasKitchen) { kitchenPocket = fromF(g.kitchenStrip); service.push(kitchenPocket); }
    const privateMain: Rect = { x: privX, y: band.y, w: band.x + band.w - privX, h: band.h };
    const corridors: Rect[] = [fromF(g.corridor)];
    let entrancePatch: Rect | undefined;
    if (g.entrySpur) { entrancePatch = fromF(g.entrySpur); corridors.push(entrancePatch); }
    floorZones.push({
      zones: { public: [fromF(publicMain)], 'semi-private': [], private: [fromF(privateMain)], service, circulation: [] },
      corridors, entrancePatch, elevatorPocket,
      ...(kitchenPocket ? { kitchenPocket } : {}),
      ...(stairPocket ? { stairPocket } : {}),
    });
    floorFamilies.push(framePublicFamily(frame, level, hasKitchen));
  });
  return { frame, slice: { ...slice }, stair, elevator, floorZones, floorFamilies };
}

const sameCell = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * P7: the core plan of a vertical-spine frame. Every floor's zones are carveZones'
 * vertical zoning at the ONE shared spine fraction; the stair pocket (south end of the
 * east band, against the spine) and the lift cell above it must exist on every floor
 * that needs them and be the same cell on each — otherwise null (legacy). No new cell
 * geometry: the pockets are exactly carveZones'.
 */
function planVerticalCore(frame: BuildingFrame, floorSpecs: PlacedSpec[][]): CoordinatedCorePlan | null {
  const floorZones = floorSpecs.map(specs => verticalFloorZones(frame, specs));
  const needStair = floorSpecs.map(f => f.some(s => s.type === 'stair-hall'));
  const needLift = floorSpecs.map((f, l) => needStair[l] && f.some(s => s.type === 'elevator-hall'));
  let pocket: Rect | null = null;
  let lift: Rect | null = null;
  for (let l = 0; l < floorSpecs.length; l++) {
    const z = floorZones[l];
    if (needStair[l]) {
      if (!z.stairPocket) return null;
      if (pocket && !sameCell(pocket, z.stairPocket)) return null;
      pocket = pocket ?? { ...z.stairPocket };
    }
    if (needLift[l]) {
      if (!z.elevatorPocket) return null;
      if (lift && !sameCell(lift, z.elevatorPocket)) return null;
      lift = lift ?? { ...z.elevatorPocket };
    } else if (z.elevatorPocket) {
      return null; // a shaft on a floor without a stair core is not a coordinated core
    }
  }
  const corridor = frame.world.corridor;
  const s = frame.slice;
  const E = 1e-6;
  const cellOf = (r: Rect | null): CoordinatedCoreCell | null | false => {
    if (!r) return null;
    // carveZones' minimum pocket width can exceed a narrow east band — a cell past the
    // slice edge is not a coherent core (the placer would clamp the hall off the cell).
    if (r.x < s.x - E || r.y < s.y - E || r.x + r.w > s.x + s.w + E || r.y + r.h > s.y + s.h + E) return false;
    const side = touchingSide(r, corridor);
    return side ? { rect: r, side } : false;
  };
  const stair = cellOf(pocket);
  const elevator = cellOf(lift);
  if (stair === false || elevator === false) return null;
  return { frame, slice: { ...frame.slice }, stair, elevator, floorZones, floorFamilies: floorSpecs.map(() => undefined) };
}

/**
 * P5: place one floor of a coordinated building with its pinned zones and public family.
 * Null when this floor's slice is not the plan's slice (the plan cannot be shared).
 */
export function placeCoordinatedFloor(
  plan: CoordinatedCorePlan,
  level: number,
  slice: Rect,
  specs: PlacedSpec[],
  strategy: CandidateStrategy,
  access: AccessSide,
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
  opts: PlacerOptions = {},
): { spaces: Space[]; corridors: Space[]; explanation: string[]; residual: FrameResidual } | null {
  const p = plan.slice;
  if (slice.x !== p.x || slice.y !== p.y || slice.w !== p.w || slice.h !== p.h) return null;
  const pinnedZones = plan.floorZones[level];
  if (!pinnedZones) return null;
  const publicFamily = plan.floorFamilies[level];
  const out = placeSpaces(slice, specs, strategy, access, mkSpace,
    { ...opts, pinnedZones, ...(publicFamily ? { publicFamily } : {}) });
  const r2 = (v: number) => v.toFixed(2);
  const c = plan.frame.corridorLine;
  out.explanation.unshift(`${COORDINATED_CORE_APPLIED} level ${level} on the shared frame — corridor ${c.axis === 'y' ? 'y' : 'x'}=${r2(c.offset)} (${r2(c.width)} m)` +
    `${plan.stair ? `, stair cell (${r2(plan.stair.rect.x)}, ${r2(plan.stair.rect.y)}) ${r2(plan.stair.rect.w)}×${r2(plan.stair.rect.h)} m` : ''}` +
    `${plan.elevator ? `, elevator cell (${r2(plan.elevator.rect.x)}, ${r2(plan.elevator.rect.y)})` : ''}, public family ${publicFamily ?? 'placer selection'}.`);
  return { ...out, residual: frameResidual(plan.frame) };
}

// ---------------------------------------------------------------------------
// P6 — the frame's residual rear / side cuts as intentional open space.
// ---------------------------------------------------------------------------

/** Explanation prefix of the P6 residual handling on a coordinated floor. */
export const COORDINATED_RESIDUAL_APPLIED = 'P6 coordinated frame residual:';

/** Explanation prefix of a coordinated variant adopted from the P8 side-strip-free retry. */
export const COORDINATED_RESIDUAL_RETRY = 'P8 coordinated residual retry:';

/** Explanation prefix of a coordinated variant adopted from the P9 target-depth retry. */
export const COORDINATED_TARGET_RETRY = 'P9 coordinated target-depth retry:';
/** P10: explanation prefix of a candidate adopted through the vertical target-length retry. */
export const COORDINATED_VERTICAL_RETRY = 'P10 coordinated vertical target-length retry:';

/**
 * The coordinated frame (world) and its residual rear / side cuts (BuildingFrame.world).
 * The residuals are intentional open space: no room, core, parking or wall mass may sit
 * in them, and they stay outside every floor's compacted envelope.
 */
export interface FrameResidual {
  frame: Rect;
  rear: Rect | null;
  side: Rect | null;
}

export function frameResidual(frame: BuildingFrame): FrameResidual {
  const w = frame.world;
  return {
    frame: { ...w.frame },
    rear: w.residualRear ? { ...w.residualRear } : null,
    side: w.residualSide ? { ...w.residualSide } : null,
  };
}

const RES_EPS = 1e-3;
const overlapsOpen = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > RES_EPS
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > RES_EPS;

/** Residual strips of `res` (rear first). */
export function residualRects(res: FrameResidual): Rect[] {
  return [res.rear, res.side].filter((r): r is Rect => r !== null);
}

/** Rects entering a residual strip with positive area (shared edges are not intrusion). */
export function residualIntrusions(res: FrameResidual, rects: Rect[]): Rect[] {
  const strips = residualRects(res);
  return rects.filter(r => strips.some(s => overlapsOpen(r, s)));
}

/**
 * The compaction bound of a coordinated floor: `footprint` cut back to the frame edge on
 * every side a residual strip adjoins the frame (the other sides — street, parking band —
 * stay the footprint's own). Null when no residual exists.
 */
export function frameEnvelopeBound(footprint: Rect, res: FrameResidual): Rect | null {
  const f = res.frame;
  let x0 = footprint.x, y0 = footprint.y, x1 = footprint.x + footprint.w, y1 = footprint.y + footprint.h;
  const strips = residualRects(res);
  if (strips.length === 0) return null;
  for (const s of strips) {
    if (s.x >= f.x + f.w - RES_EPS) x1 = Math.min(x1, f.x + f.w);
    else if (s.x + s.w <= f.x + RES_EPS) x0 = Math.max(x0, f.x);
    else if (s.y >= f.y + f.h - RES_EPS) y1 = Math.min(y1, f.y + f.h);
    else if (s.y + s.h <= f.y + RES_EPS) y0 = Math.max(y0, f.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Open residual area (m²) a floor envelope covers beyond the exterior-wall pad: each
 * strip minus the `pad`-deep band along the frame edge it adjoins. 0 = the residual is
 * entirely outside the envelope.
 */
export function residualEnvelopeOverlap(footprint: Rect, res: FrameResidual, pad: number): number {
  const f = res.frame;
  let area = 0;
  for (const s of residualRects(res)) {
    let o = { ...s };
    if (s.x >= f.x + f.w - RES_EPS) o = { ...o, x: o.x + pad, w: o.w - pad };
    else if (s.x + s.w <= f.x + RES_EPS) o = { ...o, w: o.w - pad };
    else if (s.y >= f.y + f.h - RES_EPS) o = { ...o, y: o.y + pad, h: o.h - pad };
    else if (s.y + s.h <= f.y + RES_EPS) o = { ...o, h: o.h - pad };
    if (!(o.w > 0) || !(o.h > 0)) continue;
    const w = Math.min(o.x + o.w, footprint.x + footprint.w) - Math.max(o.x, footprint.x);
    const h = Math.min(o.y + o.h, footprint.y + footprint.h) - Math.max(o.y, footprint.y);
    if (w > RES_EPS && h > RES_EPS) area += w * h;
  }
  return area;
}
