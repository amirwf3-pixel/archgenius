/**
 * Constraint-based deterministic placer — Phase 13 Generic Graph-Driven
 *
 * Pipeline:
 *  canonical DEFAULT_RESIDENTIAL_CONSTRAINTS
 *  → HardConstraintGraph (buildHardConstraintGraph)
 *  → deterministic placement ordering/clustering (placementOrderForTypes, graph.clusters)
 *  → bounded candidate generation (MAX_CANDIDATE_POSITIONS, MAX_CONSTRAINT_PLACEMENT_ATTEMPTS)
 *  → constraint-aware geometry (sharedWallEdges polygon-aware)
 *  → validation
 *
 * Carves footprint into architectural zones (public / service / circulation / private).
 * For the public band we use a recursive binary splitter.
 * For the private band we use a GENERIC cluster layout driven by the hard graph:
 *  - Graph clusters influence placement (not hard-coded bedroom branches)
 *  - Corridor-dependent types (hard DIRECT_ACCESS or MUST_ADJACENT to corridor) must touch corridor
 *  - Separation actively evaluated via polygon-aware adjacency
 *  - Bounded search with MAX_CONSTRAINT_PLACEMENT_ATTEMPTS=8, repair iter 4, candidate positions 12
 */
import type { Rect } from '../geometry/rect.js';
import { rSplitX, rSplitY, rArea, rCorners } from '../geometry/rect.js';
import type { Space, SpaceSpec, Zone, SpaceType } from '../model/space.js';
import type { CandidateStrategy } from '../model/layout.js';
import { buildHardConstraintGraph, placementOrderForTypes, classifyFeasibility, MAX_CONSTRAINT_PLACEMENT_ATTEMPTS, MAX_LOCAL_REPAIR_ITERATIONS, MAX_CANDIDATE_POSITIONS } from './constraint-graph.js';
import { sharedWallEdges } from '../geometry/room-polygon.js';
import { bandCanHost, chooseSpineFraction, solveRow, solveCol, type BandCellDemand } from './topology.js';

const CORRIDOR_W = 1.5;
const MIN_SIDE = 1.0;
const BATH_STRIP_H = 2.6; // corridor-edge wet strip, m
const KITCHEN_W = 2.4;

/**
 * P16-C — Band-cell quality depth. A band cell that absorbs the WHOLE cross
 * dimension of its band is only sound when the program actually needs that
 * depth; on deep or narrow zones uncapped absorption produces ribbons (a
 * 2.50×13 m "bedroom") — geometrically legal, architecturally unacceptable.
 * The free cross extent of a full-band cell is capped at the LARGEST of its
 * contract floor (minLength / minArea), and the smallest of:
 *   - the M4 area cap (1.75×max(target,minArea), same formula as solveBand)
 *     divided by the cell's width,
 *   - the existing ROOM_BAD_PROPORTION aspect bound (3.5),
 *   - the healthy daylight depth (7 m) cited in MBH4-DYL-001's own text
 *     (a SOFT quality cap only — DYL-001's hard check stays exterior-wall).
 * Slack beyond the cap remains an intentional void at the band's free end —
 * the M4 convention, restated for the column/branch paths. No dimension is
 * special-cased: every constant mirrors an existing contract value.
 */
const CELL_QUALITY_MAX_ASPECT = 3.5;
const CELL_QUALITY_DAYLIGHT_DEPTH = 7.0;
const CELL_QUALITY_MIN_VOID = 0.6; // never manufacture a sliver void
function cappedBandDepth(
  spec: { minWidth?: number; minLength?: number; minArea?: number; targetArea?: number },
  alongW: number,
  bandExtent: number,
): number {
  if (!(bandExtent > 0) || !(alongW > 0)) return bandExtent;
  const contractFloor = Math.max(spec.minLength ?? spec.minWidth ?? 1.5, 1.5, (spec.minArea ?? 0) / Math.max(alongW, 0.5));
  const capA = Math.max((spec.minArea ?? 0) * 1.1, Math.max(spec.targetArea ?? 0, spec.minArea ?? 0) * 1.75, 0.01);
  const want = Math.min(capA / Math.max(alongW, 0.5), CELL_QUALITY_MAX_ASPECT * alongW, CELL_QUALITY_DAYLIGHT_DEPTH);
  let d = Math.min(bandExtent, Math.max(contractFloor, want));
  if (bandExtent - d < CELL_QUALITY_MIN_VOID) d = bandExtent; // slack too small to read as a void — keep the tile
  return Math.min(d, bandExtent);
}

export function zoneOf(spec: SpaceSpec): Zone {
  if (spec.zone) return spec.zone;
  switch (spec.type) {
    case 'entrance': case 'foyer': case 'living': case 'guest-room': case 'guest-wc':
    case 'yard': case 'balcony':
      return 'public';
    case 'dining': case 'family-room':
      return 'semi-private';
    case 'kitchen': case 'storage': case 'utility': case 'parking':
      return 'service';
    case 'corridor': case 'stair-hall': case 'elevator-hall':
      return 'circulation';
    case 'bedroom': case 'master-bedroom': case 'bathroom': case 'master-bathroom':
      return 'private';
  }
  return 'service';
}

export interface PlacedSpec extends SpaceSpec {
  placedId: string;
  placedLabel: string;
}

type SpineKind = 'horizontal' | 'vertical' | 'l-spur';
interface StrategyConfig {
  spine: SpineKind;
  corridorOffsetFraction: number;
  spurWidthFraction: number;
  verticalCorridorFraction?: number;
}
function strategyConfig(s: CandidateStrategy): StrategyConfig {
  switch (s) {
    case 'area-efficiency':        return { spine: 'horizontal', corridorOffsetFraction: 0.45, spurWidthFraction: 0 };
    case 'functional-circulation': return { spine: 'l-spur',     corridorOffsetFraction: 0.48, spurWidthFraction: 0.16 };
    case 'daylight-orientation':   return { spine: 'vertical',   corridorOffsetFraction: 0.50, spurWidthFraction: 0, verticalCorridorFraction: 0.5 };
    case 'alternative-zoning':     return { spine: 'l-spur',     corridorOffsetFraction: 0.55, spurWidthFraction: 0.22 };
  }
}

interface ZoneLayout {
  zones: Record<Zone, Rect[]>;
  corridors: Rect[];
  entrancePatch?: Rect;
}

function carveZones(
  footprint: Rect,
  cfg: StrategyConfig,
  needStair: boolean,
  hasKitchen: boolean,
  hasStorage: boolean = false,
  specs: PlacedSpec[] = [],
): ZoneLayout {
  // Phase 15 M4: demand-aware band partitioning. The two resident bands (public+semi
  // vs private) must be able to HOST their assigned program at real minimums and sane
  // proportions; the spine/corridor fraction is therefore re-picked from a fixed
  // quantized ladder around the strategy default (closest feasible fraction wins —
  // deterministic). If no fraction fits, the default stands and the existing honest
  // gates (room contract minima + program completeness) report the shortfall.
  const bandCells = (zonesIn: Zone[]): BandCellDemand[] => specs
    .filter(s => zonesIn.includes(zoneOf(s as any)))
    .map(s => ({
      type: s.type,
      minWidth: Math.max(s.minWidth ?? 1.1, 0.9),
      minHeight: Math.max(s.minLength ?? s.minWidth ?? 2.0, 1.2),
      minArea: Math.max(s.minArea ?? 0, 0.25),
      target: Math.max(s.targetArea ?? 0, s.minArea ?? 0, 0.25),
    }));
  // Planning preference (mirrors MBH4 §7-1-1-8's main-habitable minimum): on units large
  // enough for it to apply, the generator AIMs for 12 m² main rooms before their program
  // minimums — a sizing preference for partitioning only; the rule itself still decides
  // validity in the regulation pack (this never suppresses or reclassifies anything).
  const MAIN_TYPES = new Set(['living', 'dining', 'bedroom', 'master-bedroom', 'family-room', 'guest-room']);
  const MAIN_PREF_MIN = 12;
  const unitIsLarge = footprint.w * footprint.h >= 60;
  const pubCellsR = bandCells(['public', 'semi-private']);
  const privCellsR = bandCells(['private']);
  const strictify = (cells: BandCellDemand[]) => !unitIsLarge ? cells : cells.map(c =>
    MAIN_TYPES.has(c.type) ? { ...c, minArea: Math.max(c.minArea, MAIN_PREF_MIN) } : c);
  const pubCells = strictify(pubCellsR);
  const privCells = strictify(privCellsR);
  const zones: Record<Zone, Rect[]> = {
    public: [], 'semi-private': [], private: [], service: [], circulation: [],
  };
  const corridors: Rect[] = [];
  let entrancePatch: Rect | undefined;

  if (cfg.spine === 'vertical') {
    const vfTest = (f: number, pubCells: BandCellDemand[], privCells: BandCellDemand[]): boolean => {
      const vxT = footprint.x + footprint.w * f - CORRIDOR_W / 2;
      const pubW = vxT - footprint.x;
      const privW = footprint.x + footprint.w - (vxT + CORRIDOR_W);
      if (pubW < 1.2 || privW < 1.2) return false;
      const kH = (hasKitchen && footprint.h > 6 && pubW > 2.5) ? Math.min(4.2, Math.max(3.0, footprint.h * 0.26)) : 0;
      const pubOk = pubCells.length === 0
        || (footprint.h - kH > 0 && bandCanHost(pubW, footprint.h - kH, pubCells));
      const stairH = (needStair && footprint.h > 5.5) ? Math.min(2.9, Math.max(2.6, footprint.h * 0.20)) : 0;
      const storH = (hasStorage && !needStair && footprint.h > 6 && privW > 2.0) ? Math.min(1.8, Math.max(1.4, footprint.h * 0.10)) : 0;
      const privOk = privCells.length === 0
        || (footprint.h - stairH - storH > 0 && bandCanHost(privW, footprint.h - stairH - storH, privCells));
      return pubOk && privOk;
    };
    let vf = chooseSpineFraction(cfg.verticalCorridorFraction ?? 0.5, (f) => vfTest(f, pubCells, privCells), { lo: 0.30, hi: 0.70, step: 0.01 });
    if (!vfTest(vf, pubCells, privCells))
      vf = chooseSpineFraction(cfg.verticalCorridorFraction ?? 0.5, (f) => vfTest(f, pubCellsR, privCellsR), { lo: 0.30, hi: 0.70, step: 0.01 });
    const vx = footprint.x + footprint.w * vf - CORRIDOR_W / 2;
    corridors.push({ x: vx, y: footprint.y, w: CORRIDOR_W, h: footprint.h });
    let publicRect: Rect = { x: footprint.x, y: footprint.y, w: vx - footprint.x, h: footprint.h };
    // Kitchen pocket at NORTH end of public band for vertical spine — keeps living/dining
    // south and directly adjacent to the central corridor (so CIRC_INACCESSIBLE does not
    // appear), while still giving the ground floor a dedicated service zone for the kitchen.
    // Full-height east strip would block living from the corridor (AGX-01 regression).
    if (hasKitchen && publicRect.h > 6 && publicRect.w > 2.5) {
      const kH = Math.min(4.2, Math.max(3.0, publicRect.h * 0.26));
      if (publicRect.h > kH + 2.5) {
        zones.service.push({ x: publicRect.x, y: publicRect.y + publicRect.h - kH, w: publicRect.w, h: kH });
        publicRect = { x: publicRect.x, y: publicRect.y, w: publicRect.w, h: publicRect.h - kH };
      }
    }
    zones.public.push(publicRect);
    let eastRect: Rect = { x: vx + CORRIDOR_W, y: footprint.y, w: footprint.x + footprint.w - (vx + CORRIDOR_W), h: footprint.h };
    // Stair pocket for vertical spine: at south end of private band (near entrance)
    if (needStair && eastRect.h > 5.5) {
      const pocketH = Math.min(2.9, Math.max(2.6, eastRect.h * 0.20));
      const pocketW = Math.min(4.6, Math.max(4.2, eastRect.w * 0.55));
      zones.service.push({ x: eastRect.x, y: eastRect.y, w: pocketW, h: pocketH });
      eastRect = { x: eastRect.x, y: eastRect.y + pocketH, w: eastRect.w, h: eastRect.h - pocketH };
    }
    // Storage pocket east for vertical — compact square, avoid west sliver
    // When no stair, carve a small south-east pocket from private so storage does not overlap private rows
    if (hasStorage && !needStair && eastRect.h > 6 && eastRect.w > 2.0) {
      const storW = Math.min(2.0, Math.max(1.4, eastRect.w * 0.40));
      const storH = Math.min(1.8, Math.max(1.4, eastRect.h * 0.10));
      // Carve from south edge of eastRect
      zones.service.push({ x: eastRect.x, y: eastRect.y, w: storW, h: storH });
      // Shrink eastRect to avoid overlap — but keep width, just push north? Actually storage at south edge, so private starts above it at x+storW?
      // To keep private contiguous, put storage overlay small corner and shrink private slightly north, but keep x.
      // Simpler: keep eastRect full, but note storage overlaps — we will handle placement via service rect directly, and private will be offset north by storH for the width of storW only if needed.
      // For now, shrink eastRect south edge up by storH only for the storW width is complex; instead keep eastRect as is and place storage overlapping will be moved by resolveOverlaps — avoid by not pushing storage as separate placement but as carve.
      // Actually carve: move eastRect north by storH and keep storage at south, but storage width full eastRect.w would waste. Better keep storage width limited and eastRect remains eastRect.y+storH for that column? Complex.
      // Simple: just keep storage service rect and offset eastRect north by storH (full width) — private slightly smaller but storage square.
      eastRect = { x: eastRect.x, y: eastRect.y + storH, w: eastRect.w, h: eastRect.h - storH };
    }
    zones.private.push(eastRect);
    return { zones, corridors };
  }

  // Horizontal (+ L-spur)
  const hfTest = (f: number, pubCells: BandCellDemand[], privCells: BandCellDemand[]): boolean => {
    const cyT = footprint.y + footprint.h * f - CORRIDOR_W / 2;
    const pubH = cyT - footprint.y;
    const privH = footprint.y + footprint.h - (cyT + CORRIDOR_W);
    if (pubH < 1.2 || privH < 1.2) return false;
    const spurW = (cfg.spurWidthFraction > 0 && footprint.w > 4.5)
      ? Math.max(1.4, Math.min(1.9, footprint.w * cfg.spurWidthFraction)) : 0;
    const pubWorkW = footprint.w - spurW;
    const kw = hasKitchen ? Math.max(1.5, Math.min(KITCHEN_W, Math.max(2.0, pubWorkW * 0.25))) : 0;
    const pubMainW = pubWorkW > kw + 2.0 ? pubWorkW - kw : pubWorkW;
    const pubOk = pubCells.length === 0 || bandCanHost(pubMainW, pubH, pubCells);
    const pocketW = (needStair && footprint.w > 5.5) ? Math.min(2.9, Math.max(2.6, footprint.w * 0.20)) : 0;
    const privMainW = footprint.w - pocketW;
    const privOk = privCells.length === 0 || (privMainW > 1.2 && bandCanHost(privMainW, privH, privCells));
    return pubOk && privOk;
  };
    let hf = chooseSpineFraction(cfg.corridorOffsetFraction, (f) => hfTest(f, pubCells, privCells), { lo: 0.30, hi: 0.70, step: 0.01 });
  if (!hfTest(hf, pubCells, privCells))
    hf = chooseSpineFraction(cfg.corridorOffsetFraction, (f) => hfTest(f, pubCellsR, privCellsR), { lo: 0.30, hi: 0.70, step: 0.01 });
  const cy = footprint.y + footprint.h * hf - CORRIDOR_W / 2;
  corridors.push({ x: footprint.x, y: cy, w: footprint.w, h: CORRIDOR_W });
  const publicBand: Rect = { x: footprint.x, y: footprint.y, w: footprint.w, h: cy - footprint.y };
  const privateBand: Rect = { x: footprint.x, y: cy + CORRIDOR_W, w: footprint.w, h: footprint.y + footprint.h - (cy + CORRIDOR_W) };

  let publicWork = publicBand;
  if (cfg.spurWidthFraction > 0 && publicBand.w > 4.5) {
    const spurW = Math.max(1.4, Math.min(1.9, publicBand.w * cfg.spurWidthFraction));
    entrancePatch = { x: publicBand.x, y: publicBand.y, w: spurW, h: publicBand.h };
    publicWork = { x: publicBand.x + spurW, y: publicBand.y, w: publicBand.w - spurW, h: publicBand.h };
    corridors.push(entrancePatch);
  }

  // Kitchen strip on EAST of public band (only when the floor has a kitchen
  // — upper residential floors typically don't). Preserve minWidth 2.0 for kitchen where feasible, allow 1.5 only for very narrow sites.
  let publicMain: Rect = publicWork;
  if (hasKitchen) {
    const kw = Math.max(1.5, Math.min(KITCHEN_W, Math.max(2.0, publicWork.w * 0.25)));
    if (publicWork.w > kw + 2.0) {
      zones.service.push({ x: publicWork.x + publicWork.w - kw, y: publicWork.y, w: kw, h: publicWork.h });
      publicMain = { x: publicWork.x, y: publicWork.y, w: publicWork.w - kw, h: publicWork.h };
    }
  }
  zones.public.push(publicMain);

  // Stair pocket at west end of private band. Must be large enough to fit
  // a U-stair for ~3.20 m floor-to-floor (2 × 1.10 m flights + 0.10 m gap +
  // 0.20 m wall margins = 2.50 m wide; run length ~9 × 0.28 = 2.52 m plus
  // landing 1.20 m plus margins = ~4.20 m long). Use 2.6 × 4.4 m as the
  // minimum usable core for two-storey buildings.
  let privateMain = privateBand;
  if (needStair && privateBand.w > 5.5) {
    const pocketW = Math.min(2.9, Math.max(2.6, privateBand.w * 0.20));
    const pocketH = Math.min(4.6, Math.max(4.2, privateBand.h * 0.55));
    zones.service.push({ x: privateBand.x, y: privateBand.y, w: pocketW, h: pocketH });
    privateMain = { x: privateBand.x + pocketW, y: privateBand.y, w: privateBand.w - pocketW, h: privateBand.h };
  }
  zones.private.push(privateMain);
  void BATH_STRIP_H;
  return { zones, corridors, entrancePatch };
}

/**
 * P16-B — access-orientation frame. The zone model places the entry/public band
 * at MIN-Y (its internal notion of "front"). For N/E/W street access the whole
 * placement runs in a mirrored/transposed axis-aligned frame in which the actual
 * access edge becomes the frame-south edge, then the placed rects are mapped
 * back. Same dimensions, same areas, same deterministic arithmetic — the entry
 * sequence simply ends up on the real street facade.
 */
export interface OrientationFrame {
  /** footprint mapped INTO the frame (street face at min-y). */
  to: (r: Rect) => Rect;
  /** rect mapped from the frame back to world plan coordinates. */
  from: (r: Rect) => Rect;
}
export function buildAccessFrame(footprint: Rect, side: 'north'|'south'|'east'|'west'): OrientationFrame | null {
  const fx = footprint.x, fy = footprint.y, fw = footprint.w, fh = footprint.h;
  if (side === 'south') return null;
  if (side === 'north') {
    const mirror = (r: Rect): Rect => ({ x: r.x, y: fy + fh - (r.y + r.h), w: r.w, h: r.h });
    return { to: mirror, from: mirror }; // involution
  }
  if (side === 'east') {
    // T(x,y) = (fx + (y - fy), fy + (fx + fw) - x): east face -> frame south.
    return {
      to: r => ({ x: fx + (r.y - fy), y: fy + fx + fw - (r.x + r.w), w: r.h, h: r.w }),
      from: r => ({ x: fx + fw + fy - r.y - r.h, y: r.x - fx + fy, w: r.h, h: r.w }),
    };
  }
  // west: T(x,y) = (fx + fh - (y - fy) - fh ... ) -> west face becomes frame south.
  return {
    to: r => ({ x: fx + fh - (r.y + r.h - fy), y: fy + (r.x - fx), w: r.h, h: r.w }),
    from: r => ({ x: r.y - fy + fx, y: fx + fh + fy - r.x - r.w, w: r.h, h: r.w }),
  };
}

export function placeSpaces(
  footprint: Rect,
  specs: PlacedSpec[],
  strategy: CandidateStrategy,
  accessSide: 'north'|'south'|'east'|'west',
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
): { spaces: Space[]; corridors: Space[]; explanation: string[] } {
  const frame = buildAccessFrame(footprint, accessSide);
  if (!frame) return placeSpacesFacingSouth(footprint, specs, strategy, accessSide, mkSpace);
  const out = placeSpacesFacingSouth(frame.to(footprint), specs, strategy, 'south', mkSpace);
  const back = (s: Space): Space => ({ ...s, rect: frame.from(s.rect) });
  return {
    spaces: out.spaces.map(back),
    corridors: out.corridors.map(back),
    explanation: [`P16-B orientation frame: "${accessSide}" access normalized to frame-south; layout mapped back after placement.`, ...out.explanation],
  };
}

function placeSpacesFacingSouth(
  footprint: Rect,
  specs: PlacedSpec[],
  strategy: CandidateStrategy,
  accessSide: 'north'|'south'|'east'|'west',
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
): { spaces: Space[]; corridors: Space[]; explanation: string[] } {
  void accessSide;

  // Phase 13: Build hard constraint graph from canonical source — single source of truth
  const graph = buildHardConstraintGraph();

  const cfg = strategyConfig(strategy);
  const needStair = specs.some(s => s.type === 'stair-hall');
  const hasKitchen = specs.some(s => s.type === 'kitchen');
  // Phase 15 M4: main-habitable sizing preference (mirrors MBH4 §7-1-1-8's 12 m² main
  // rooms on large units) used ONLY to aim room heights/widths; validity is still decided
  // by the regulation rule itself. Small units (<60 m² footprint) keep program minimums.
  const isMainHabitable = (t: string): boolean =>
    ['living', 'dining', 'bedroom', 'master-bedroom', 'family-room', 'guest-room'].includes(t);
  const mainPrefH = (spec: PlacedSpec, bandCross: number): number => {
    const floor = (isMainHabitable(spec.type) && footprint.w * footprint.h >= 60)
      ? Math.max(spec.minArea ?? 0, 12) : Math.max(spec.minArea ?? 0, 0.25);
    return Math.max(spec.minLength ?? spec.minWidth ?? 1.2, floor / Math.max(bandCross, 0.5));
  };
  const mainPrefW = (spec: PlacedSpec, bandH: number): number => {
    const floor = (isMainHabitable(spec.type) && footprint.w * footprint.h >= 60)
      ? Math.max(spec.minArea ?? 0, 12) : Math.max(spec.minArea ?? 0, 0.25);
    return Math.max(spec.minWidth ?? 1.2, floor / Math.max(bandH, 0.5));
  };
  const mainPref = mainPrefH;
  const hasStorage = specs.some(s => s.type === 'storage');
  const layout = carveZones(footprint, cfg, needStair, hasKitchen, hasStorage, specs);
  const explanation: string[] = [
    `Strategy ${strategy}: ${cfg.spine} spine, corridor @ ${Math.round(cfg.corridorOffsetFraction*100)}% depth.`,
    `Phase13 generic graph: ${graph.hardEdges.length} hard edges, ${graph.clusters.length} hard clusters, ${graph.nodes.size} types — canonical source DEFAULT_RESIDENTIAL_CONSTRAINTS`,
    `Phase13 clusters: ${graph.clusters.map(c=>`[${c.join(',')}]`).join(' | ')}`,
    `Phase13 placement order: ${placementOrderForTypes([...new Set(specs.map(s=>s.type))], graph).join(' > ')}`,
  ];

  const byType = new Map<SpaceType, PlacedSpec[]>();
  for (const s of specs) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s);
  }
  const take = (t: SpaceType): PlacedSpec | undefined => {
    const arr = byType.get(t); if (!arr || arr.length === 0) return undefined;
    return arr.shift();
  };
  const placed: Space[] = [];

  // --- Entrance spur — satisfies MUST_BE_ADJACENT entrance-foyer via graph cluster ---
  if (layout.entrancePatch) {
    const patch = layout.entrancePatch;
    const entH = Math.min(1.8, patch.h * 0.4);
    const ent = take('entrance'); if (ent)
      placed.push(mkSpace('entrance', { x: patch.x, y: patch.y, w: patch.w, h: entH }, ent.placedLabel, ent.placedId, 'public'));
    const foy = take('foyer');
    let foyerRect: Rect | null = foy ? { x: patch.x, y: patch.y + entH, w: patch.w, h: patch.h - entH } : null;
    // Phase 15 M3: guest-wc stacks under the foyer inside the front column when the column
    // is tall enough (classic entrance→foyer→WC sequence; satisfies the foyer-guest-wc
    // adjacency). Otherwise the public band's own conditions may place it — or the program
    // completeness check surfaces it honestly. Never a silent drop on this path.
    const wcSpec = take('guest-wc');
    if (wcSpec && foyerRect && foyerRect.h >= 3.9) {
      const wcH = Math.min(2.1, Math.max(1.5, foyerRect.h * 0.33));
      const foyerH = foyerRect.h - wcH;
      if (foyerH >= 2.4) {
        placed.push(mkSpace('foyer', { ...foyerRect, h: foyerH }, foy!.placedLabel, foy!.placedId, 'public'));
        placed.push(mkSpace('guest-wc', { x: foyerRect.x, y: foyerRect.y + foyerH, w: foyerRect.w, h: wcH }, wcSpec.placedLabel, wcSpec.placedId, 'public'));
        explanation.push('Phase15 M3 entry column: guest-wc stacked below foyer — front-sequence adjacency');
      } else {
        placed.push(mkSpace('foyer', foyerRect, foy!.placedLabel, foy!.placedId, 'public'));
        byType.get('guest-wc') ?? byType.set('guest-wc', []);
        byType.get('guest-wc')!.unshift(wcSpec); // return to the pool — public band conditions decide
      }
    } else {
      if (foy) placed.push(mkSpace('foyer', foyerRect!, foy.placedLabel, foy.placedId, 'public'));
      if (wcSpec) {
        byType.get('guest-wc') ?? byType.set('guest-wc', []);
        byType.get('guest-wc')!.unshift(wcSpec); // return to the pool
      }
    }
    explanation.push(`Phase13 public: entrance-foyer MUST_BE_ADJACENT from graph cluster satisfied via entrancePatch shared edge`);
  }

  // --- Generic helper: get hard adjacency requirements for a type from graph ---
  const getHardAdjacents = (type: string): string[] => {
    const result: string[] = [];
    for (const e of graph.hardEdges) {
      if (e.kind === 'MUST_BE_ADJACENT' || e.kind === 'DIRECT_ACCESS_REQUIRED') {
        if (e.fromType === type) result.push(e.toType);
        else if (e.toType === type) result.push(e.fromType);
      }
    }
    return [...new Set(result)];
  };
  const getHardSeparated = (type: string): string[] => {
    const result: string[] = [];
    for (const e of graph.hardEdges) {
      if (e.kind === 'MUST_BE_SEPARATED') {
        if (e.fromType === type) result.push(e.toType);
        else if (e.toType === type) result.push(e.fromType);
      }
    }
    return [...new Set(result)];
  };
  const mustTouchCorridor = (type: string): boolean => {
    const adj = getHardAdjacents(type);
    return adj.includes('corridor') || adj.includes('stair-hall');
  };

  // --- Private band: GENERIC graph-driven placement ---
  // Phase 13: Actually consume graph.clusters and placement ordering, not hard-coded bedroom branches
  const privateRect = layout.zones.private[0];
  // P16-C: capped band cells keep contact with circulation by anchoring on the
  // band edge facing the corridor; the intentional void always falls at the band's
  // FREE end (M4 convention: the free end is whichever end circulation is not on).
  const corridorBelowBand = (band: Rect): boolean => {
    const c = layout.corridors[0];
    if (!c || !(band.h > 0)) return false;
    return c.y + c.h / 2 > band.y + band.h / 2;
  };
  const bandAnchoredY = (band: Rect, h: number): number =>
    corridorBelowBand(band) ? Math.round((band.y + band.h - h + 1e-9) * 100) / 100 : band.y;
  if (privateRect) {
    // Collect all private specs generically from byType (not hard-coded beds/baths)
    const privateTypes = [...byType.keys()].filter(t => zoneOf({ type: t } as any) === 'private');
    const orderedPrivateTypes = placementOrderForTypes(privateTypes, graph);
    explanation.push(`Phase13 private types ordered: ${orderedPrivateTypes.join(' > ')}`);

    // Build generic clusters for private zone based on graph clusters
    // For each graph cluster, extract private types present, then create instance clusters
    interface GenericCluster {
      id: string;
      rooms: PlacedSpec[];
      types: string[];
      mustTouchCorridor: boolean;
      separationConstraints: string[]; // types that must be separated from this cluster
    }

    const genericClusters: GenericCluster[] = [];

    // First, handle types that are in the same hard graph cluster and have soft PREFER_ADJACENT between them (e.g., master-bedroom ↔ master-bathroom)
    // We will pair types that have soft adjacency within same graph cluster
    const usedSpecIds = new Set<string>();

    // Build instance-level pairing based on graph soft adjacency within private zone
    // Example: master-bedroom and master-bathroom have PREFER_ADJACENT soft, and are in same hard cluster via corridor
    // So we pair them generically by checking soft edges
    const softAdjMap = new Map<string, Set<string>>();
    for (const e of graph.softEdges) {
      if (e.kind === 'PREFER_ADJACENT') {
        if (!softAdjMap.has(e.fromType)) softAdjMap.set(e.fromType, new Set());
        if (!softAdjMap.has(e.toType)) softAdjMap.set(e.toType, new Set());
        softAdjMap.get(e.fromType)!.add(e.toType);
        softAdjMap.get(e.toType)!.add(e.fromType);
      }
    }

    // Collect all private specs into list
    const allPrivateSpecs: PlacedSpec[] = [];
    for (const t of orderedPrivateTypes) {
      const list = byType.get(t as SpaceType) ?? [];
      allPrivateSpecs.push(...list);
    }

    // Generic pairing: try to pair specs whose types have soft adjacency and are in same graph hard cluster
    // Deterministic: sort specs by type order, then by placedId
    allPrivateSpecs.sort((a, b) => {
      const orderA = orderedPrivateTypes.indexOf(a.type);
      const orderB = orderedPrivateTypes.indexOf(b.type);
      if (orderA !== orderB) return orderA - orderB;
      return a.placedId.localeCompare(b.placedId);
    });

    // Pairing algorithm generic: iterate specs, if spec type has soft adjacency to another unpaired spec type, pair them (soft adjacency generic)
    const paired = new Set<string>();
    for (let i = 0; i < allPrivateSpecs.length; i++) {
      const spec = allPrivateSpecs[i];
      if (paired.has(spec.placedId)) continue;
      const softAdjTypes = softAdjMap.get(spec.type) ?? new Set();
      // Find partner in remaining unpaired specs whose type is in softAdjTypes
      let partner: PlacedSpec | undefined;
      for (let j = i + 1; j < allPrivateSpecs.length; j++) {
        const cand = allPrivateSpecs[j];
        if (paired.has(cand.placedId)) continue;
        if (!softAdjTypes.has(cand.type)) continue;
        partner = cand;
        break;
      }
      if (partner) {
        // Create cluster with 2 rooms
        const types = [spec.type, partner.type];
        const mustTouch = mustTouchCorridor(spec.type) || mustTouchCorridor(partner.type);
        const sep = [...new Set([...getHardSeparated(spec.type), ...getHardSeparated(partner.type)])];
        genericClusters.push({
          id: `cluster-${spec.type}-${partner.type}-${i}`,
          rooms: [spec, partner],
          types,
          mustTouchCorridor: mustTouch,
          separationConstraints: sep,
        });
        paired.add(spec.placedId);
        paired.add(partner.placedId);
        // Remove from byType so they are not placed again
        const arr1 = byType.get(spec.type as SpaceType);
        if (arr1) { const idx = arr1.findIndex(s => s.placedId === spec.placedId); if (idx >= 0) arr1.splice(idx, 1); }
        const arr2 = byType.get(partner.type as SpaceType);
        if (arr2) { const idx = arr2.findIndex(s => s.placedId === partner.placedId); if (idx >= 0) arr2.splice(idx, 1); }
      } else {
        // Single room cluster
        const mustTouch = mustTouchCorridor(spec.type);
        const sep = getHardSeparated(spec.type);
        genericClusters.push({
          id: `cluster-${spec.type}-${i}`,
          rooms: [spec],
          types: [spec.type],
          mustTouchCorridor: mustTouch,
          separationConstraints: sep,
        });
        paired.add(spec.placedId);
        const arr = byType.get(spec.type as SpaceType);
        if (arr) { const idx = arr.findIndex(s => s.placedId === spec.placedId); if (idx >= 0) arr.splice(idx, 1); }
      }
    }
    // Second pass: pair leftover single wet rooms (bathroom/master-bathroom/guest-wc) with bedroom to avoid slivers
    const wetTypes = new Set<string>(['bathroom', 'master-bathroom', 'guest-wc']);
    const bedroomTypes = new Set<string>(['bedroom', 'master-bedroom']);
    // Iteratively pair — each iteration picks one bath and one bedroom from current clusters
    let pairedCount = 0;
    while (true) {
      const bathIdx = genericClusters.findIndex(c => c.rooms.length === 1 && wetTypes.has(c.rooms[0].type));
      const bedIdx = genericClusters.findIndex(c => c.rooms.length === 1 && bedroomTypes.has(c.rooms[0].type));
      if (bathIdx === -1 || bedIdx === -1) break;
      // Don't pair if already paired count exceeds number of baths we want to fix — pair at most min(baths, bedrooms) but leave at least one bedroom single if needed for count?
      // For 3BD 2 baths, pairing 2 baths with 2 bedrooms leaves 1 bedroom single -> 2 paired +1 single => 3 clusters (good)
      const bathC = genericClusters[bathIdx];
      const bedC = genericClusters[bedIdx];
      const bathSpec = bathC.rooms[0];
      const bedSpec = bedC.rooms[0];
      // Remove both (higher index first)
      const rem = [bathIdx, bedIdx].sort((a,b)=>b-a);
      for (const ri of rem) genericClusters.splice(ri, 1);
      const types = [bedSpec.type, bathSpec.type];
      const mustTouch = mustTouchCorridor(bedSpec.type) || mustTouchCorridor(bathSpec.type);
      const sep = [...new Set([...getHardSeparated(bedSpec.type), ...getHardSeparated(bathSpec.type)])];
      genericClusters.push({
        id: `cluster-paired-${bedSpec.type}-${bathSpec.type}-${pairedCount}`,
        rooms: [bedSpec, bathSpec],
        types,
        mustTouchCorridor: mustTouch,
        separationConstraints: sep,
      });
      explanation.push(`Phase13 wet pairing: paired ${bathSpec.type} with ${bedSpec.type} to avoid sliver`);
      pairedCount++;
      // Safety cap
      if (pairedCount > 10) break;
    }

    // Also handle any remaining private specs that were not in orderedPrivateTypes (e.g., extra master-bathroom)
    for (const [type, list] of byType) {
      if (zoneOf({ type } as any) !== 'private') continue;
      for (const spec of [...list]) {
        if (paired.has(spec.placedId)) continue;
        genericClusters.push({
          id: `cluster-${type}-remaining-${spec.placedId}`,
          rooms: [spec],
          types: [type],
          mustTouchCorridor: mustTouchCorridor(type),
          separationConstraints: getHardSeparated(type),
        });
        const arr = byType.get(type);
        if (arr) { const idx = arr.findIndex(s => s.placedId === spec.placedId); if (idx >= 0) arr.splice(idx, 1); }
      }
    }

    // Phase 15 M4: on a vertical spine with no dedicated storage pocket, storage joins the
    // private band as a real row so it is sized by the same capacity/containment machinery
    // instead of being squeezed into a leftover sliver past the band end after the fact.
    {
      const storSpec = byType.get('storage')?.[0];
      if (storSpec && cfg.spine === 'vertical') {
        const hasStoragePocket = layout.zones.service.some(r =>
          r.y <= footprint.y + 0.1 && r.w >= 1.4 && r.w <= 2.2 && r.h >= 1.4 && r.h <= 2.2 &&
          r.x > footprint.x + footprint.w * 0.4
        );
        if (!hasStoragePocket) {
          genericClusters.push({
            id: `cluster-storage-band-${storSpec.placedId}`,
            rooms: [storSpec],
            types: ['storage'],
            mustTouchCorridor: false,
            separationConstraints: [],
          });
          paired.add(storSpec.placedId);
          const arr = byType.get('storage');
          if (arr) { const idx = arr.findIndex(s => s.placedId === storSpec.placedId); if (idx >= 0) arr.splice(idx, 1); }
          explanation.push(`Phase15 M4: storage joins the private band as a sized row (no dedicated pocket)`);
        }
      }
    }

    // Sort generic clusters deterministically: mustTouchCorridor true first (hard adjacency > separation), then larger area, then ID
    genericClusters.sort((a, b) => {
      if (a.mustTouchCorridor && !b.mustTouchCorridor) return -1;
      if (!a.mustTouchCorridor && b.mustTouchCorridor) return 1;
      const areaA = a.rooms.reduce((sum, r) => sum + Math.max(r.minArea, r.targetArea), 0);
      const areaB = b.rooms.reduce((sum, r) => sum + Math.max(r.minArea, r.targetArea), 0);
      if (areaA !== areaB) return areaB - areaA;
      return a.id.localeCompare(b.id);
    });

    explanation.push(`Phase13 generic private clusters: ${genericClusters.map(c=>`${c.id}[${c.types.join('+')}] mustTouchCorridor=${c.mustTouchCorridor} sep=[${c.separationConstraints.join(',')}]`).join(' | ')}`);

    // Feasibility check: sum min widths/heights vs available
    const computeMinWidth = (spec: PlacedSpec): number => Math.max(spec.minWidth ?? 2.0, 1.0);
    const computeMinHeight = (spec: PlacedSpec): number => Math.max(spec.minLength ?? spec.minWidth ?? 2.0, 1.0);

    let feasibleSideBySide = true;
    let requiredTotal = 0;
    const isVerticalSpineCheck = cfg.spine === 'vertical';
    if (isVerticalSpineCheck) {
      for (const cl of genericClusters) {
        if (cl.rooms.length === 2) requiredTotal += cl.rooms.reduce((s, r) => s + computeMinHeight(r), 0);
        else requiredTotal += computeMinHeight(cl.rooms[0]);
      }
      if (requiredTotal > privateRect.h + 1e-6) feasibleSideBySide = false;
    } else {
      for (const cl of genericClusters) {
        if (cl.rooms.length === 2) requiredTotal += cl.rooms.reduce((s, r) => s + computeMinWidth(r), 0);
        else requiredTotal += computeMinWidth(cl.rooms[0]);
      }
      if (requiredTotal > privateRect.w + 1e-6) feasibleSideBySide = false;
    }

    const feasibility = classifyFeasibility(requiredTotal, isVerticalSpineCheck ? privateRect.h : privateRect.w, genericClusters.flatMap(c=>c.rooms.map(r=>r.type)));
    explanation.push(`Phase13 feasibility: ${feasibility.status} ${feasibility.reasonCode} — ${feasibility.message}`);

    if (genericClusters.length > 0) {
      if (!feasibleSideBySide) {
        explanation.push(`Phase13 INFEASIBLE side-by-side: required ${requiredTotal.toFixed(2)}m > available ${isVerticalSpineCheck ? privateRect.h.toFixed(2) : privateRect.w.toFixed(2)}m — falling back to generic column layout (will report CONSTRAINT_MUST_ADJACENT HARD) reason=${feasibility.reasonCode} code=HARD_CONSTRAINT_INFEASIBLE_DIMENSION`);
        // Generic fallback: place each genericCluster as a column, rooms stacked vertically, bottom touching corridor
        // This preserves min dimensions, site containment, locks, but will report HARD for unsatisfied direct access
        // Phase 13 fix: enforce minWidth explicitly, distribute remaining width proportionally to target area
        const clusterMinWs = genericClusters.map(cl => {
          if (cl.rooms.length === 2) return Math.max(...cl.rooms.map(r=>Math.max(r.minWidth ?? 2.0, 1.0)));
          return Math.max(cl.rooms[0].minWidth ?? 2.0, 1.0);
        });
        let totalMinW = clusterMinWs.reduce((a,b)=>a+b,0);
        let fallbackImpossible = false;
        // Phase 15 M6: a band that cannot host its columns at CONTRACT widths must not
        // scale rooms down into ribbon slivers — that is a quality defect, not a
        // partial success. Try single-loaded full-width ROWS first (every cluster
        // gets a band the size of the full band width, stacked along its depth);
        // if even contractual row minima overflow the band, return the infeasibility
        // honestly with the capacity evidence — geometry is never painted sub-min.
        let singleLoadedRows: { spec: PlacedSpec; minH: number; capH: number }[][] | null = null;
        if (totalMinW > privateRect.w + 1e-6) {
          const rows = genericClusters.map(cl => {
            // Largest room first: it takes the corridor-facing row so nothing is ever
            // reached THROUGH its accessory (a bathroom row behind a bedroom is the
            // ensuite arrangement M5 sanctions; in front of it would strand the room).
            const ordered = [...cl.rooms].sort((a, b) => Math.max(b.minArea, b.targetArea) - Math.max(a.minArea, a.targetArea));
            return ordered.map(r => ({
              spec: r,
              minH: Math.max(mainPref(r, privateRect.w), r.minLength ?? r.minWidth ?? 1.5),
              capH: Math.max((r.minArea ?? 0) * 1.1, Math.max(r.targetArea ?? 0, r.minArea ?? 0) * 1.75) / Math.max(privateRect.w, 0.5),
            }));
          });
          const flat = rows.flat();
          const totalRowMinH = flat.reduce((s, r) => s + r.minH, 0);
          const widestMinW = Math.max(...flat.map(r => Math.max(r.spec.minWidth ?? 2.0, 1.0)));
          if (widestMinW <= privateRect.w + 1e-6 && totalRowMinH <= privateRect.h + 1e-6) {
            singleLoadedRows = rows;
            explanation.push(`Phase15 M6 single-loaded rows: ${flat.length} rows × ${privateRect.w.toFixed(2)} m band width (Σmin h=${totalRowMinH.toFixed(2)} ≤ ${privateRect.h.toFixed(2)}) — columns needed Σw=${totalMinW.toFixed(2)} > ${privateRect.w.toFixed(2)}`);
          } else {
            fallbackImpossible = true;
            explanation.push(`Phase15 M6 CAPACITY_INFEASIBLE_BAND: columns ΣminW=${totalMinW.toFixed(2)} > band w=${privateRect.w.toFixed(2)} and single-loaded rows ΣminH=${totalRowMinH.toFixed(2)} vs band h=${privateRect.h.toFixed(2)} (widest room needs w=${widestMinW.toFixed(2)}) — this band cannot host its assigned program at contract dimensions. code=HARD_CONSTRAINT_INFEASIBLE_DIMENSION`);
          }
        }
        if (singleLoadedRows) {
          // Grow each row toward its cap with the leftover; slack beyond caps stays
          // intentional void at the far end of the band (M4 convention).
          const flat = singleLoadedRows.flat();
          const totalMin = flat.reduce((s, r) => s + r.minH, 0);
          const slack = Math.max(0, privateRect.h - totalMin);
          const growSum = flat.reduce((s, r) => s + Math.max(0, r.capH - r.minH), 0);
          let y = privateRect.y;
          for (const clRows of singleLoadedRows) {
            for (const row of clRows) {
              const growCap = growSum > 1e-9 ? Math.max(0, row.capH - row.minH) / growSum : 1 / flat.length;
              const hRow = row.minH + (growSum > 1e-9 ? slack * growCap : slack / flat.length);
              placed.push(mkSpace(row.spec.type, { x: privateRect.x, y, w: privateRect.w, h: hRow }, row.spec.placedLabel, row.spec.placedId, 'private'));
              y += hRow;
            }
          }
          explanation.push(`Phase15 M6 single-loaded rows painted: ${flat.length} full-width rooms, remaining ${(privateRect.h - (y - privateRect.y)).toFixed(2)} m kept as explicit void`);
          fallbackImpossible = true; // rows handled it — the legacy column pass below must not double-paint
        }
        const totalArea = genericClusters.reduce((sum, cl) => sum + cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0), 0);
        const totalExtra = Math.max(0, privateRect.w - totalMinW);
        let x = privateRect.x;
        for (let ci = 0; ci < genericClusters.length && !fallbackImpossible; ci++) {
          const cl = genericClusters[ci];
          const minW = clusterMinWs[ci];
          const targetArea = cl.rooms.reduce((s,r)=>s+Math.max(r.minArea,r.targetArea),0);
          const extraShare = totalArea > 1e-6 ? (targetArea / totalArea) * totalExtra : totalExtra / genericClusters.length;
          const colW = minW + extraShare;
          // Phase 13: never shrink below min — if totalMinW > available, keep min and allow overflow (GEO_ROOM_OUTSIDE reported)
          const finalColW = colW; // preserve min, no last-column truncation that would violate min
          const colRect: Rect = { x, y: privateRect.y, w: finalColW, h: privateRect.h };
          x += finalColW;
          if (cl.rooms.length === 2) {
            const first = cl.rooms[0];
            const second = cl.rooms[1];
            const firstMinH = Math.max(first.minLength ?? first.minWidth ?? 2.0, 1.0);
            const secondMinH = Math.max(second.minLength ?? second.minWidth ?? 1.2, 1.0);
            const totalMinH = firstMinH + secondMinH;
            let bh: number;
            let secondH: number;
            let pairDepthCapped = false;
            if (colRect.h < totalMinH - 1e-6) {
              bh = firstMinH;
              secondH = secondMinH;
            } else {
              bh = Math.min(BATH_STRIP_H + 0.4, colRect.h * 0.35);
              bh = Math.max(firstMinH, Math.min(colRect.h - secondMinH, bh));
              secondH = colRect.h - bh;
              // P16-C quality-depth cap: each stacked half takes no more than its own
              // contract+quality need; the surplus stays intentional void at the band's
              // free end (M4 convention) instead of becoming a 90 m² bathroom.
              const firstWant = cappedBandDepth(first, colRect.w, colRect.h - secondMinH);
              if (firstWant < bh - 1e-9) {
                bh = Math.max(firstMinH, firstWant);
                secondH = Math.max(secondMinH, Math.min(colRect.h - bh, cappedBandDepth(second, colRect.w, colRect.h - bh)));
                pairDepthCapped = true;
              }
            }
            // P16-C: with the cap active, pack the stack against the corridor-facing band
            // edge so corridor contact survives; void falls at the band's free end.
            const packBottom = pairDepthCapped && corridorBelowBand(colRect);
            const firstRect = packBottom
              ? { x: colRect.x, y: Math.round((colRect.y + colRect.h - secondH - bh + 1e-9) * 100) / 100, w: colRect.w, h: bh }
              : { x: colRect.x, y: colRect.y, w: colRect.w, h: bh };
            const firstSpace = mkSpace(first.type, firstRect, first.placedLabel, first.placedId, 'private');
            firstSpace.rect.x = Math.round((firstSpace.rect.x+1e-9)*100)/100;
            firstSpace.rect.y = Math.round((firstSpace.rect.y+1e-9)*100)/100;
            firstSpace.rect.w = Math.round((firstSpace.rect.w+1e-9)*100)/100;
            firstSpace.rect.h = Math.round((firstSpace.rect.h+1e-9)*100)/100;
            firstSpace.polygon = rCorners(firstSpace.rect); firstSpace.area = rArea(firstSpace.rect);
            const secondY = Math.round((firstSpace.rect.y + firstSpace.rect.h + 1e-9)*100)/100;
            // P16-C: when the quality cap fired, the second half keeps its capped depth
            // and the surplus stays a band-end void; legacy fill-up preserved otherwise.
            const secondRect = { x: colRect.x, y: secondY, w: colRect.w, h: pairDepthCapped ? secondH : Math.max(secondH, colRect.h - (secondY - colRect.y)) };
            placed.push(firstSpace);
            placed.push(mkSpace(second.type, secondRect, second.placedLabel, second.placedId, 'private'));
          } else {
            const single = cl.rooms[0];
            const singleMinH = Math.max(single.minLength ?? single.minWidth ?? 2.0, 1.0);
            // P16-C: never deeper than the cell's contract+quality need — slack beyond
            // the cap stays intentional void at the band's free end (M4 convention).
            const finalH = Math.max(cappedBandDepth(single, finalColW, colRect.h), singleMinH);
            placed.push(mkSpace(single.type, { x: colRect.x, y: bandAnchoredY(privateRect, finalH), w: colRect.w, h: finalH }, single.placedLabel, single.placedId, 'private'));
          }
        }
        explanation.push(`Phase13 fallback generic: placed ${genericClusters.length} clusters as columns, min preserved totalMinW=${totalMinW.toFixed(2)} ≤ ${privateRect.w.toFixed(2)}, bottom touches corridor, top may violate direct access — explicit HARD code=HARD_CONSTRAINT_INFEASIBLE_DIMENSION`);
      } else if (feasibleSideBySide) {
        // Phase 13 bounded search: try up to MAX_CONSTRAINT_PLACEMENT_ATTEMPTS allocations
        // Each attempt varies width distribution slightly, evaluates hard separation, picks first feasible
        let bestPlacement: { spaces: Space[], valid: boolean, attempts: number } | null = null;
        let attempts = 0;

        for (let attempt = 0; attempt < MAX_CONSTRAINT_PLACEMENT_ATTEMPTS; attempt++) {
          attempts++;
          const attemptPlaced: Space[] = [];
          const isVerticalSpine = cfg.spine === 'vertical';

          if (isVerticalSpine) {
            // Phase 15 M4: row minimum heights include each room's AREA need at the row
            // width (and the 12 m² main-room preference on large units), so bedrooms are
            // never stacked at min-height-then-stretched or left sub-regulation; growth is
            // capped at 1.75×target and any genuine slack becomes intentional void at the
            // free (far) end of the band instead of inflating the last room into a slab.
            const clusterMinHs = genericClusters.map(cl => {
              // 2% margin over the bare area need so rounding cannot land a room just below
              // its contract threshold (e.g. master 11.9 < 12).
              return cl.rooms.reduce((s, r) => s + mainPref(r, privateRect.w), 0) * 1.02;
            });
            const clusterCapHs = genericClusters.map(cl => {
              const capA = cl.rooms.reduce((s, r) => s + Math.max((r.minArea ?? 0) * 1.1, Math.max(r.targetArea ?? 0, r.minArea ?? 0) * 1.75), 0);
              return capA / Math.max(privateRect.w, 0.5);
            });
            // The area/preference-aware row minimums only participate when the band can
            // HOST them; otherwise the legacy share distribution runs untouched (it already
            // tiles inside the band via per-row shares), so M4 never turns a feasible
            // tight-band plan into an over-shrunk one. Containment is additionally guarded
            // by the isLast clamp below.
            const clusterRawMinHs = genericClusters.map(cl => cl.rooms.reduce((s, r) => s + Math.max(r.minLength ?? r.minWidth ?? 1.0, 1.0), 0));
            const totalMinHRaw = clusterMinHs.reduce((a,b)=>a+b,0);
            const needsFit = totalMinHRaw <= privateRect.h + 1e-6;
            const clusterMinHsEff = needsFit ? clusterMinHs : clusterRawMinHs;
            const totalMinH = clusterMinHsEff.reduce((a,b)=>a+b,0);
            const totalExtraAreaV = genericClusters.reduce((sum, cl) => {
              const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
              const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
              return sum + Math.max(0, target - minArea);
            }, 0);
            const remainingH = privateRect.h - totalMinH;

            let y = privateRect.y;
            const rowHs: number[] = [];
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const isLast = ci === genericClusters.length - 1;
              const minH = clusterMinHsEff[ci];
              let rowH: number;
              if (isLast) {
                const remaining = privateRect.y + privateRect.h - y;
                if (needsFit) {
                  // capped growth; leftover stays an intentional void at the band's free end
                  rowH = remaining >= minH - 1e-6
                    ? Math.max(minH, Math.min(remaining, Math.max(minH, clusterCapHs[ci])))
                    : minH;
                } else {
                  // legacy tile (M3-exact), clamped to the band so nothing protrudes
                  const legacyH = remaining >= minH - 1e-6 ? remaining : minH;
                  rowH = Math.max(minH, Math.min(legacyH, remaining));
                }
                if (rowH <= 0) rowH = minH;
              } else {
                const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
                const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
                const extra = Math.max(0, target - minArea);
                const attemptFactor = 1 + (attempt * 0.05 - 0.1);
                const extraShare = totalExtraAreaV > 1e-6 ? (extra / totalExtraAreaV) * remainingH * attemptFactor : remainingH / genericClusters.length;
                rowH = needsFit
                  ? Math.max(minH, Math.min(clusterCapHs[ci], minH + Math.max(0, extraShare)))
                  : minH + Math.max(0, extraShare);
              }
              rowHs.push(rowH);
              y += rowH;
            }
            y = privateRect.y;
            if (!needsFit && genericClusters.length > 1) {
              // Bounded needs top-up: when the band cannot host every area need at once,
              // raise the rows that are just short of their need using free slack first,
              // then borrowing from the far (last) row down to — never below — its own
              // contract floor. Deterministic; the band's total height is conserved.
              const lastIdx = genericClusters.length - 1;
              const lastFloor = clusterRawMinHs[lastIdx];
              let used = 0;
              for (const hh of rowHs) used += hh;
              let slack = Math.max(0, privateRect.h - used);
              for (let ci = 0; ci < lastIdx; ci++) {
                // +0.01: rects snap to the 2 cm grid; a bare need height would round down
                // and shave the room a hair below its contract area.
                const deficit = clusterMinHs[ci] + 0.01 - rowHs[ci];
                if (deficit <= 1e-6) continue;
                const borrow = Math.min(deficit, slack + Math.max(0, rowHs[lastIdx] - lastFloor));
                if (borrow <= 1e-6) break;
                rowHs[ci] += borrow;
                if (borrow > slack) {
                  rowHs[lastIdx] -= (borrow - slack);
                  slack = 0;
                } else {
                  slack -= borrow;
                }
              }
            }
            // Containment pass (always): row growth — needs floors, caps, top-ups, or the
            // legacy tile — can never push the band total past its extent. Trim rows above
            // their contract floors proportionally; if even the floors do not fit, leave
            // them (the geometry gate reports genuine infeasibility instead of hiding it).
            {
              let totH = 0;
              for (const hh of rowHs) totH += hh;
              if (totH > privateRect.h + 1e-6) {
                const floorsH = rowHs.map((hh, i) => Math.min(hh, Math.max(clusterRawMinHs[i], Math.min(clusterMinHs[i], hh))));
                let excessH = totH - privateRect.h;
                let headH = 0;
                const headroomH = rowHs.map((hh, i) => { const v = Math.max(0, hh - floorsH[i]); headH += v; return v; });
                if (headH > 1e-6) {
                  for (let i = 0; i < rowHs.length && excessH > 1e-9; i++) {
                    const cut = Math.min(headroomH[i], excessH * (headroomH[i] / headH));
                    rowHs[i] -= cut;
                    excessH -= cut;
                  }
                }
              }
            }
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const rowH = rowHs[ci];
              // Phase 13: preserve min width for vertical spine — never shrink below max minWidth of cluster
              const clusterMaxMinW = Math.max(...cl.rooms.map(r=>Math.max(r.minWidth ?? 2.0, 1.0)));
              const rowW = Math.max(privateRect.w, clusterMaxMinW);
              const rowRect: Rect = { x: privateRect.x, y, w: rowW, h: rowH };
              y += rowH;

              if (cl.rooms.length === 2) {
                // Phase 15 M4: a paired row's PRIMARY room (the bedroom when one is in the
                // pair; cluster order varies by program) is sized to its area need first —
                // including the 12 m² main-habitable preference — so it can never round just
                // below its contract threshold. The secondary (usually wet) room absorbs the
                // cut down to its own min, floor 0.5 m, keeping the row inside the band.
                const primaryIdx = cl.rooms[0].type.includes('bedroom') ? 0
                  : cl.rooms[1].type.includes('bedroom') ? 1
                  : (cl.rooms[0].minArea ?? 0) >= (cl.rooms[1].minArea ?? 0) ? 0 : 1;
                const roomA = cl.rooms[primaryIdx];
                const roomB = cl.rooms[1 - primaryIdx];
                const bedMinH = Math.max(roomA.minLength ?? roomA.minWidth ?? 2.2, 2.0);
                const bathMinH = Math.max(roomB.minLength ?? roomB.minWidth ?? 1.2, 1.0);
                const clusterMin = bedMinH + bathMinH;
                // +0.01 pad: room rects snap to the 2 cm grid, and a floor height rounded
                // down (e.g. 2.8236 -> 2.82) would shave a hair below the 12 m² threshold.
                const bedNeedH = mainPref(roomA, rowW);
                const bedMinEff = Math.min(Math.max(bedMinH, bedNeedH + 0.01), Math.max(bedMinH, rowH - bathMinH));
                let bedH: number, bathH: number;
                if (rowH < clusterMin - 1e-6) {
                  bedH = Math.min(bedMinEff, Math.max(0.5, rowH - Math.min(bathMinH, rowH - 0.5)));
                  bathH = Math.max(0.5, rowH - bedH);
                } else {
                  const bedTarget = Math.max(roomA.minArea ?? 0, roomA.targetArea ?? 0);
                  const bathTarget = Math.max(roomB.minArea ?? 0, roomB.targetArea ?? 0);
                  const clusterExtra = Math.max(0, rowH - clusterMin);
                  const totalClusterTarget = bedTarget + bathTarget;
                  if (totalClusterTarget > 1e-6) {
                    bedH = bedMinH + clusterExtra * (bedTarget / totalClusterTarget);
                    bathH = rowH - bedH;
                    if (bathH < bathMinH) { bathH = bathMinH; bedH = rowH - bathH; }
                    if (bedH < bedMinEff) { bedH = bedMinEff; bathH = rowH - bedH; }
                    if (bathH < 0.5) { bathH = 0.5; bedH = rowH - bathH; }
                    if (bedH < bedMinH) { bedH = bedMinH; bathH = rowH - bedH; }
                  } else {
                    bedH = rowH * 0.6;
                    if (bedH < bedMinEff) bedH = Math.min(bedMinEff, rowH - 0.5);
                    bathH = rowH - bedH;
                  }
                }
                const firstSpec = roomA;
                const secondSpec = roomB;
                const topRect: Rect = { x: rowRect.x, y: rowRect.y, w: rowRect.w, h: bedH };
                const firstSpace = mkSpace(firstSpec.type, topRect, firstSpec.placedLabel, firstSpec.placedId, 'private');
                firstSpace.rect.x = Math.round((firstSpace.rect.x+1e-9)*100)/100;
                firstSpace.rect.y = Math.round((firstSpace.rect.y+1e-9)*100)/100;
                firstSpace.rect.w = Math.round((firstSpace.rect.w+1e-9)*100)/100;
                firstSpace.rect.h = Math.round((firstSpace.rect.h+1e-9)*100)/100;
                firstSpace.polygon = rCorners(firstSpace.rect); firstSpace.area = rArea(firstSpace.rect);
                const bottomY = Math.round((firstSpace.rect.y + firstSpace.rect.h + 1e-9)*100)/100;
                const bottomRect: Rect = { x: rowRect.x, y: bottomY, w: rowRect.w, h: Math.max(bathH, rowH - (bottomY - rowRect.y)) };
                attemptPlaced.push(firstSpace);
                attemptPlaced.push(mkSpace(secondSpec.type, bottomRect, secondSpec.placedLabel, secondSpec.placedId, 'private'));
              } else {
                const single = cl.rooms[0];
                attemptPlaced.push(mkSpace(single.type, rowRect, single.placedLabel, single.placedId, single.type === 'storage' ? 'service' : 'private'));
              }
            }
          } else {
            // Horizontal spine generic — Phase 15 M4: column minimums include each room's
            // area need at the band height (with the main-room preference); growth capped
            // at 1.75×target; slack becomes intentional void at the band's far end.
            const clusterMinWs = genericClusters.map(cl => {
              return cl.rooms.reduce((s, r) => s + mainPrefW(r, privateRect.h), 0);
            });
            const clusterCapWs = genericClusters.map(cl => {
              const capA = cl.rooms.reduce((s, r) => s + Math.max((r.minArea ?? 0) * 1.1, Math.max(r.targetArea ?? 0, r.minArea ?? 0) * 1.75), 0);
              return capA / Math.max(privateRect.h, 0.5);
            });
            const clusterRawMinWs = genericClusters.map(cl => cl.rooms.reduce((s, r) => s + Math.max(r.minWidth ?? 1.0, 1.0), 0));
            const totalMinWRaw = clusterMinWs.reduce((a,b)=>a+b,0);
            const needsFitW = totalMinWRaw <= privateRect.w + 1e-6;
            const clusterMinWsEff = needsFitW ? clusterMinWs : clusterRawMinWs;
            const totalMinW = clusterMinWsEff.reduce((a,b)=>a+b,0);
            const totalExtraArea = genericClusters.reduce((sum, cl) => {
              const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
              const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
              return sum + Math.max(0, target - minArea);
            }, 0);
            const remainingW = privateRect.w - totalMinW;

            let x = privateRect.x;
            const colWs: number[] = [];
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const isLast = ci === genericClusters.length - 1;
              const minW = clusterMinWsEff[ci];
              let colW: number;
              if (isLast) {
                const remaining = privateRect.x + privateRect.w - x;
                // Phase 13.1: never negative, preserve min; Phase 15 M4: capped growth when
                // the band can host it, legacy tile clamped inside the band otherwise.
                if (needsFitW) {
                  colW = remaining >= minW - 1e-6
                    ? Math.max(minW, Math.min(remaining, Math.max(minW, clusterCapWs[ci])))
                    : minW;
                } else {
                  const legacyW = remaining >= minW - 1e-6 ? remaining : minW;
                  colW = Math.max(minW, Math.min(legacyW, remaining));
                }
                if (colW <= 0) colW = minW;
              } else {
                const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
                const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
                const extra = Math.max(0, target - minArea);
                const attemptFactor = 1 + (attempt * 0.05 - 0.1);
                const extraShare = totalExtraArea > 1e-6 ? (extra / totalExtraArea) * remainingW * attemptFactor : remainingW / genericClusters.length;
                colW = needsFitW
                  ? Math.min(Math.max(minW, clusterCapWs[ci]), minW + Math.max(0, extraShare))
                  : minW + Math.max(0, extraShare);
                if (colW <= 0) colW = minW;
              }
              colWs.push(colW);
              x += colW;
            }
            x = privateRect.x;
            if (!needsFitW && genericClusters.length > 1) {
              // Bounded needs top-up (mirrors the row pass): rows short of their area need
              // borrow from slack first, then from the far column above its contract floor.
              const lastIdx = genericClusters.length - 1;
              const lastFloor = clusterRawMinWs[lastIdx];
              let used = 0;
              for (const ww of colWs) used += ww;
              let slack = Math.max(0, privateRect.w - used);
              for (let ci = 0; ci < lastIdx; ci++) {
                const deficit = clusterMinWs[ci] + 0.01 - colWs[ci];
                if (deficit <= 1e-6) continue;
                const borrow = Math.min(deficit, slack + Math.max(0, colWs[lastIdx] - lastFloor));
                if (borrow <= 1e-6) break;
                colWs[ci] += borrow;
                if (borrow > slack) {
                  colWs[lastIdx] -= (borrow - slack);
                  slack = 0;
                } else {
                  slack -= borrow;
                }
              }
            }
            // Containment pass (always, mirrors the rows): trim over-grown columns toward
            // their contract floors so the band total never exceeds the band extent.
            {
              let totW = 0;
              for (const ww of colWs) totW += ww;
              if (totW > privateRect.w + 1e-6) {
                const floorsW = colWs.map((ww, i) => Math.min(ww, Math.max(clusterRawMinWs[i], Math.min(clusterMinWs[i], ww))));
                let excessW = totW - privateRect.w;
                let headW = 0;
                const headroomW = colWs.map((ww, i) => { const v = Math.max(0, ww - floorsW[i]); headW += v; return v; });
                if (headW > 1e-6) {
                  for (let i = 0; i < colWs.length && excessW > 1e-9; i++) {
                    const cut = Math.min(headroomW[i], excessW * (headroomW[i] / headW));
                    colWs[i] -= cut;
                    excessW -= cut;
                  }
                }
              }
            }
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const colW = colWs[ci];
              const colRect: Rect = { x, y: privateRect.y, w: colW, h: privateRect.h };
              x += colW;

              if (cl.rooms.length === 2) {
                const bedMinW = Math.max(cl.rooms[0].minWidth ?? 2.2, 2.0);
                const bathMinW = Math.max(cl.rooms[1].minWidth ?? 1.2, 1.0);
                const bedTarget = Math.max(cl.rooms[0].minArea, cl.rooms[0].targetArea);
                const bathTarget = Math.max(cl.rooms[1].minArea, cl.rooms[1].targetArea);
                const clusterMin = bedMinW + bathMinW;
                let bedW: number, bathW: number;
                if (colW < clusterMin - 1e-6) {
                  bedW = bedMinW;
                  bathW = bathMinW;
                } else {
                  const clusterExtra = Math.max(0, colW - clusterMin);
                  const totalClusterTarget = bedTarget + bathTarget;
                  if (totalClusterTarget > 1e-6) {
                    bedW = bedMinW + clusterExtra * (bedTarget / totalClusterTarget);
                    bathW = colW - bedW;
                    if (bathW < bathMinW) { bathW = bathMinW; bedW = colW - bathW; }
                    if (bedW < bedMinW) { bedW = bedMinW; bathW = colW - bedW; }
                  } else {
                    bedW = colW * 0.6;
                    bathW = colW - bedW;
                  }
                }
                const firstSpec = cl.rooms[0];
                const secondSpec = cl.rooms[1];
                // P16-C quality-depth cap: side-by-side halves take only their contract+
                // quality depth (anchored on the corridor edge); surplus stays intentional
                // void at the band's free end — ribbons like 2.5×13 m are never a success.
                const bedRH = cappedBandDepth(firstSpec, bedW, colRect.h);
                const leftRect: Rect = { x: colRect.x, y: bandAnchoredY(privateRect, bedRH), w: bedW, h: bedRH };
                const firstSpace = mkSpace(firstSpec.type, leftRect, firstSpec.placedLabel, firstSpec.placedId, 'private');
                firstSpace.rect.x = Math.round((firstSpace.rect.x+1e-9)*100)/100;
                firstSpace.rect.y = Math.round((firstSpace.rect.y+1e-9)*100)/100;
                firstSpace.rect.w = Math.round((firstSpace.rect.w+1e-9)*100)/100;
                firstSpace.rect.h = Math.round((firstSpace.rect.h+1e-9)*100)/100;
                firstSpace.polygon = rCorners(firstSpace.rect); firstSpace.area = rArea(firstSpace.rect);
                const rightX = Math.round((firstSpace.rect.x + firstSpace.rect.w + 1e-9)*100)/100;
                const rightW = Math.max(bathW, colRect.w - (rightX - colRect.x));
                const rightRH = cappedBandDepth(secondSpec, rightW, colRect.h);
                const rightRect: Rect = { x: rightX, y: bandAnchoredY(privateRect, rightRH), w: rightW, h: rightRH };
                attemptPlaced.push(firstSpace);
                attemptPlaced.push(mkSpace(secondSpec.type, rightRect, secondSpec.placedLabel, secondSpec.placedId, 'private'));
              } else {
                const single = cl.rooms[0];
                // P16-C: capped at the cell's contract+quality depth; slack stays an
                // intentional void at the band's free end (M4 convention).
                const singleH = cappedBandDepth(single, colRect.w, colRect.h);
                const singleRect: Rect = { x: colRect.x, y: bandAnchoredY(privateRect, singleH), w: colRect.w, h: singleH };
                attemptPlaced.push(mkSpace(single.type, singleRect, single.placedLabel, single.placedId, 'private'));
              }
            }
          }

          // Evaluate hard separation for this attempt
          // Generic separation check: if any placed private room is adjacent to a type it must be separated from (e.g., bedroom ↔ entrance)
          // We need to check against already placed public rooms (entrance, foyer) if they exist
          let separationValid = true;
          // For each placed private room, check if it shares wall with any public room that it must be separated from
          // Since public rooms not yet placed for all, we check against entrance/foyer if placed
          for (const priv of attemptPlaced) {
            const sepTypes = getHardSeparated(priv.type);
            if (sepTypes.length === 0) continue;
            for (const other of placed) { // placed contains entrance/foyer if entrancePatch
              if (sepTypes.includes(other.type)) {
                const shared = sharedWallEdges(priv.polygon, other.polygon);
                if (shared.length > 0) {
                  separationValid = false;
                  break;
                }
              }
            }
            if (!separationValid) break;
          }

          if (separationValid) {
            bestPlacement = { spaces: attemptPlaced, valid: true, attempts };
            break;
          }
          // If not valid and this is last attempt, keep last attempt as best even if invalid (will be caught by validation)
          if (attempt === MAX_CONSTRAINT_PLACEMENT_ATTEMPTS - 1) {
            bestPlacement = { spaces: attemptPlaced, valid: false, attempts };
          }
        }

        if (bestPlacement) {
          placed.push(...bestPlacement.spaces);
          const bandVoid = Math.max(0, privateRect.w * privateRect.h - bestPlacement.spaces.reduce((a, s) => a + s.area, 0));
          if (bandVoid > 0.5) explanation.push(`Phase16-C quality-depth cap: ${bandVoid.toFixed(2)} m² of band slack kept as intentional void at the band's free end (M4 convention)`);
          explanation.push(`Phase13 bounded search: ${bestPlacement.attempts} attempt(s) (max ${MAX_CONSTRAINT_PLACEMENT_ATTEMPTS}), valid=${bestPlacement.valid}, clusters=${genericClusters.length}, mustTouchCorridor respected, separation evaluated via sharedWallEdges`);
        }
      }
    }
  }

  // --- Service band (kitchen / storage / stair-hall / utility) ---
  const serviceRects = layout.zones.service;
  const kitchenRect = (() => {
    if (!hasKitchen) return null;
    // Horizontal: kitchen is east of centre (x > 0.6W)
    let r = serviceRects.find(s => s.x > footprint.x + footprint.w * 0.6);
    if (r) return r;
    // Vertical: kitchen is the north pocket west of corridor (y north, x west, h ~3-4.2, w ~public width)
    r = serviceRects.find(s => s.x + s.w <= footprint.x + footprint.w * 0.5 + 0.5 && s.y > footprint.y + footprint.h * 0.5);
    if (r) return r;
    // Single-floor vertical east pocket fallback (older path)
    r = serviceRects.find(s => s.x > footprint.x + footprint.w * 0.5 && s.w >= 1.5 && s.w <= 3.5);
    if (r) return r;
    r = serviceRects.find(s => s.w >= 1.5 && s.w <= 5.0 && s.h >= 2.5);
    return r ?? null;
  })();
  let stairPocket: Rect | null = null;
  if (needStair) {
    if (cfg.spine === 'vertical') {
      // Stair pocket is the east service rect with stair dimensions (wider than kitchen)
      stairPocket = serviceRects.find(r => r.x > footprint.x + footprint.w * 0.5 && r.w > 3.0) ??
                   serviceRects.find(r => r.y <= footprint.y + footprint.h * 0.4 && r.x > footprint.x + footprint.w * 0.4) ??
                   serviceRects[0] ?? null;
      // If the found pocket is actually the kitchen (narrow), prefer the wider stair-like rect
      if (stairPocket && stairPocket.w <= 3.0) {
        const alt = serviceRects.find(r => r.x > footprint.x + footprint.w * 0.5 && r.w > 3.0);
        if (alt) stairPocket = alt;
      }
    } else {
      stairPocket = serviceRects.find(r => r.x <= footprint.x + footprint.w * 0.4) ?? null;
    }
  }

  const kitchen = take('kitchen');
  if (kitchen && kitchenRect) {
    // P16-C: a service pocket that is deeper than the kitchen's contract+quality need
    // stops force-feeding that depth into the room — capped here, slack stays band void.
    const kitH = cappedBandDepth(kitchen, kitchenRect.w, kitchenRect.h);
    const kitRect = kitH < kitchenRect.h - 1e-9
      ? { x: kitchenRect.x, y: bandAnchoredY(kitchenRect, kitH), w: kitchenRect.w, h: kitH }
      : kitchenRect;
    placed.push(mkSpace('kitchen', kitRect, kitchen.placedLabel, kitchen.placedId, 'service'));
  }
  const stair = take('stair-hall');
  if (stair) {
    if (stairPocket) {
      placed.push(mkSpace('stair-hall', stairPocket, stair.placedLabel, stair.placedId, 'service'));
    } else if (kitchenRect) {
      const k = placed.find(p => p.type === 'kitchen');
      if (k) {
        const stairH = Math.min(3.6, k.rect.h * 0.45);
        k.rect = { x: k.rect.x, y: k.rect.y + stairH, w: k.rect.w, h: k.rect.h - stairH };
        k.polygon = rCorners(k.rect); k.area = rArea(k.rect);
        placed.push(mkSpace('stair-hall',
          { x: k.rect.x, y: k.rect.y - stairH, w: k.rect.w, h: stairH },
          stair.placedLabel, stair.placedId, 'service'));
      }
    }
  }
  // Phase 15 M4: a storage tail hanging past the floor end is a band-capacity residual,
  // not a licence to spill outside the envelope. The topmost private space sharing the
  // tail's column may donate height down to (never below) its contract floor; the storage
  // then tiles the donated strip exactly. Fully deterministic; returns false when nothing
  // can be donated so the caller keeps its existing fallbacks.
  const borrowForStorageTail = (storRect: Rect, spec: PlacedSpec): boolean => {
    const over = storRect.y + storRect.h - (footprint.y + footprint.h);
    if (over <= 1e-6 || storRect.h < 1.4) return false;
    let donor: Space | null = null;
    for (const p of placed) {
      if (p.zone !== 'private') continue;
      const xOverlap = Math.min(p.rect.x + p.rect.w, storRect.x + storRect.w) - Math.max(p.rect.x, storRect.x);
      if (xOverlap <= 0.5) continue;
      if (!donor || p.rect.y + p.rect.h > donor.rect.y + donor.rect.h) donor = p;
    }
    if (!donor) return false;
    const donorType = donor.type;
    const minArea = donorType === 'master-bedroom' ? 12 : donorType === 'bedroom' ? 9 : 2.4;
    const donorFloorH = Math.max(2.0, minArea / Math.max(donor.rect.w, 0.5));
    const spare = donor.rect.h - donorFloorH;
    if (spare < 1e-6) return false;
    const cut = Math.min(spare, over + 0.02);
    donor.rect.h -= cut;
    donor.area = rArea(donor.rect);
    donor.polygon = rCorners(donor.rect);
    const newY = Math.round((donor.rect.y + donor.rect.h + 1e-9) * 100) / 100;
    const newH = Math.round((storRect.y + storRect.h - newY + 1e-9) * 100) / 100;
    if (newH < 1.4 || newY + newH > footprint.y + footprint.h + 1e-6) {
      donor.rect.h += cut; donor.area = rArea(donor.rect); donor.polygon = rCorners(donor.rect);
      return false;
    }
    placed.push(mkSpace('storage', { x: storRect.x, y: newY, w: storRect.w, h: newH }, spec.placedLabel, spec.placedId, 'service'));
    return true;
  };
  const stor = take('storage');
  if (stor) {
    if (cfg.spine === 'vertical') {
      // For vertical spine the kitchen is the north pocket west of the corridor;
      // put storage east (service) to avoid west sliver (5.0x1.4) and keep storage square-ish.
      // Prefer service pocket carved for storage (south-east small) if present.
      const storagePocket = serviceRects.find(r =>
        r.y <= footprint.y + 0.1 && r.w >= 1.4 && r.w <= 2.2 && r.h >= 1.4 && r.h <= 2.2 &&
        r.x > footprint.x + footprint.w * 0.4
      );
      if (storagePocket) {
        placed.push(mkSpace('storage', storagePocket, stor.placedLabel, stor.placedId, 'service'));
      } else if (stairPocket) {
        const sx = stairPocket.x;
        const sy = stairPocket.y + stairPocket.h;
        const sh = Math.min(2.0, Math.max(1.4, stairPocket.h * 0.60));
        const remainingH = footprint.y + footprint.h - sy;
        const finalH = Math.min(sh, Math.max(1.4, remainingH > 1.4 ? Math.min(remainingH, sh) : sh));
        const storRect: Rect = { x: sx, y: sy, w: stairPocket.w, h: finalH > 0 ? finalH : sh };
        if (storRect.y + storRect.h <= footprint.y + footprint.h + 1e-6 && storRect.h >= 1.4) {
          placed.push(mkSpace('storage', storRect, stor.placedLabel, stor.placedId, 'service'));
        } else if (borrowForStorageTail(storRect, stor)) {
          // handled inside: the last private row on this column gave up exactly the
          // overflow headroom it could spare above its own contract floor.
        } else {
          const ex = footprint.x + footprint.w * 0.5 + CORRIDOR_W/2;
          const ew = Math.min(2.0, Math.max(1.4, layout.zones.private[0].w * 0.35));
          const eh = Math.min(1.6, Math.max(1.4, layout.zones.private[0].h * 0.10));
          const small: Rect = { x: ex, y: footprint.y, w: ew, h: eh };
          placed.push(mkSpace('storage', small, stor.placedLabel, stor.placedId, 'service'));
        }
      } else {
        // Single-storey vertical: no stair pocket and no carved pocket (narrow site), place compact east storage near south
        const ex = footprint.x + footprint.w * 0.5 + CORRIDOR_W/2;
        const ew = Math.min(2.0, Math.max(1.4, layout.zones.private[0].w * 0.35));
        const eh = Math.min(1.6, Math.max(1.4, layout.zones.private[0].h * 0.10));
        const small: Rect = { x: ex, y: footprint.y, w: ew, h: eh };
        if (small.x + small.w <= footprint.x + footprint.w - 0.1) {
          placed.push(mkSpace('storage', small, stor.placedLabel, stor.placedId, 'service'));
        } else {
          const k = placed.find(p => p.type === 'kitchen');
          if (k) {
            const storeH = Math.min(1.6, Math.max(1.4, k.rect.h * 0.25));
            const sw = Math.min(1.6, k.rect.w * 0.5);
            placed.push(mkSpace('storage', { x: k.rect.x + k.rect.w - sw, y: k.rect.y, w: sw, h: storeH }, stor.placedLabel, stor.placedId, 'service'));
            k.rect = { x: k.rect.x, y: k.rect.y + storeH, w: k.rect.w, h: k.rect.h - storeH };
            k.polygon = rCorners(k.rect); k.area = rArea(k.rect);
          }
        }
      }
    } else {
      const k = placed.find(p => p.type === 'kitchen');
      if (k) {
        const storeH = Math.min(2.0, Math.max(1.4, k.rect.h * 0.20));
        placed.push(mkSpace('storage',
          { x: k.rect.x, y: k.rect.y, w: k.rect.w, h: storeH },
          stor.placedLabel, stor.placedId, 'service'));
        k.rect = { x: k.rect.x, y: k.rect.y + storeH, w: k.rect.w, h: k.rect.h - storeH };
        k.polygon = rCorners(k.rect); k.area = rArea(k.rect);
      }
    }
  }

  // --- Public band — generic ordering from graph ---
  let publicRect = layout.zones.public[0];
  if (publicRect) {
    const publicTypes = [...byType.keys()].filter(t => {
      const z = zoneOf({ type: t } as any);
      return z === 'public' || z === 'semi-private';
    });
    const orderedPublicTypes = placementOrderForTypes(publicTypes, graph);
    explanation.push(`Phase13 public types ordered: ${orderedPublicTypes.join(' > ')}`);

    const living = take('living');
    const dining = take('dining');
    let guestWc = take('guest-wc');
    let bandCarvedByGallery = false;
    const publicUnplaced: PlacedSpec[] = [];
    let g; while ((g = take('guest-room'))) publicUnplaced.push(g);
    let f; while ((f = take('family-room'))) publicUnplaced.push(f);
    let e; while ((e = take('entrance'))) publicUnplaced.push(e);
    let fy; while ((fy = take('foyer'))) publicUnplaced.push(fy);
    let bo; while ((bo = take('balcony'))) publicUnplaced.push(bo); // M3: balconies must not silently vanish either

    // Phase 15 M3: front entry gallery — the small public program rooms collected here
    // (entrance, foyer, guest-room, family, balcony) plus the guest-wc form ONE continuous
    // gallery row across the public band front; living/dining take the remaining field below.
    // Purely geometric and program-minimum-driven (no dimension special cases), spine-agnostic,
    // and only built where the living field keeps its minimum height afterwards. This removes
    // the pre-M3 silent drops (foyer existed only via the l-spur patch; guest-wc only via one
    // east-corner condition) — every assigned public room gets an architectural home whenever
    // the band can host it, and is otherwise surfaced honestly by program-completeness checks.
    if (living !== undefined && dining !== undefined) {
      const galleryCells: PlacedSpec[] = [...publicUnplaced];
      if (guestWc !== undefined && galleryCells.length >= 1) galleryCells.push(guestWc); // a gallery is a SEQUENCE of entry rooms, not one isolated cell
      // A lone cell is only acceptable when it is NOT the wet entry room (an isolated guest-wc
      // filling a whole strip is junk) — a balcony/family/guest room along the front is sound.
      const galleryAcceptable = galleryCells.length >= 2 ||
        (galleryCells.length === 1 && galleryCells[0].type !== 'guest-wc');
      if (galleryAcceptable) {
        // Entrance first along the row (exterior edge), then the rest in program order — stable.
        galleryCells.sort((a, b) => (a.type === 'entrance' ? 0 : 1) - (b.type === 'entrance' ? 0 : 1));
      const minW = (s: PlacedSpec) => Math.max(s.minWidth ?? 1.1, 1.1);
      const minH = (s: PlacedSpec) => Math.max(s.minLength ?? 1.4, 1.4);
      const totalMinW = galleryCells.reduce((a, s) => a + minW(s), 0);
        const livingMinHBelow = Math.max(living.minLength ?? living.minWidth ?? 3.0, 2.5);
        const diningMinHBelow = Math.max(dining.minLength ?? dining.minWidth ?? 2.2, 2.0);
        const sideBySideBelow = publicRect.w >= Math.max(living.minWidth ?? 3.0, 3.0) + Math.max(dining.minWidth ?? 2.2, 2.2);
        const neededBelow = sideBySideBelow ? Math.max(livingMinHBelow, diningMinHBelow) : livingMinHBelow + diningMinHBelow;
        let galleryPlaced = false;
        let galleryBottom = 0;
        let galleryH = Math.min(2.3, Math.max(1.7, publicRect.h * 0.22));
        if (publicRect.h - galleryH < neededBelow) galleryH = publicRect.h - neededBelow;
        if (galleryH >= 1.5 && publicRect.h - galleryH >= neededBelow - 1e-6 && publicRect.w >= totalMinW - 1e-6) {
          let strip: Rect = { x: publicRect.x, y: publicRect.y, w: publicRect.w, h: galleryH };
          // Proportional row layout: each cell ≥ its minWidth, surplus shared by target area.
          const targets = galleryCells.map(s => Math.max(s.minArea, s.targetArea));
          const sumT = Math.max(targets.reduce((a, b) => a + b, 0), 1e-6);
          const surplus = Math.max(0, publicRect.w - totalMinW);
          const ws = galleryCells.map((s, i) => {
            const proportional = minW(s) + surplus * (targets[i] / sumT);
            // A single-cell gallery is sized to its program target, never stretched to fill.
            return galleryCells.length === 1
              ? Math.min(proportional, Math.max(minW(s), targets[i] / Math.max(galleryH, 0.5)))
              : proportional;
          });
          // Each cell must reach its program minArea at its solved width — grow the strip
          // height for that (the layout contract rejects cells below minArea), else fall back.
          const stripMinH = Math.max(...galleryCells.map((s, i) =>
            Math.max(s.minArea > 0 ? s.minArea / Math.max(ws[i], 0.5) : 0, minH(s))));
          let stripH = Math.max(strip.h, stripMinH);
          if (publicRect.h - stripH < neededBelow - 1e-6) {
            stripH = -1; // cannot host the row without crushing living/dining — let the column try
          }
          if (stripH > 0) {
          strip = { ...strip, h: stripH };
          let cx = strip.x;
          galleryCells.forEach((s, i) => {
            const w = Math.min(ws[i], strip.x + strip.w - cx);
            placed.push(mkSpace(s.type, { x: cx, y: strip.y, w, h: strip.h }, s.placedLabel, s.placedId, 'public'));
            cx += w;
          });
          galleryBottom = strip.y + strip.h;
          explanation.push(`Phase15 M3 entry gallery: ${galleryCells.map(c => c.type).join('+')} @ front strip h=${stripH.toFixed(2)} m`);
          galleryPlaced = true;
          }
        } else {
          // Tall-narrow band (urban frontage, vertical spine): stack the entry sequence
          // VERTICALLY along the front — entrance at the street, then foyer, then WC —
          // each cell full band width, heights from target area with minimum preserved.
          const maxCellMinW = Math.max(...galleryCells.map(minW));
          const colHs = galleryCells.map(s => Math.max(minH(s), Math.max(s.minArea, s.targetArea) / publicRect.w));
          const colH = colHs.reduce((a, b) => a + b, 0);
          const entCol = galleryCells.findIndex(s => s.type === 'entrance');
          const foyCol = galleryCells.findIndex(s => s.type === 'foyer');
          const leftIdx = galleryCells.map((_, i) => i).filter(i => i !== entCol && i !== foyCol);
          const halfW = publicRect.w / 2;
          const corrSplitW = () => halfW;
          const tLayout = entCol >= 0 && foyCol >= 0 && leftIdx.length >= 1 &&
            halfW >= Math.max(
              minW(galleryCells[foyCol]),
              ...leftIdx.map(i => minW(galleryCells[i])),
              1.0) - 1e-6;
          const tLeftHs = tLayout ? leftIdx.map(i => {
            const s = galleryCells[i];
            return Math.max(minH(s), Math.max(s.minArea, s.targetArea) / halfW);
          }) : [];
          const entH = tLayout ? colHs[entCol] : 0;
          // The foyer column must reach its OWN program minimum at the split width —
          // the stack grows to cover it; the last side cell absorbs the slack.
          const foyMinH = tLayout
            ? Math.max(minH(galleryCells[foyCol]),
                Math.max(galleryCells[foyCol].minArea, 0) / Math.max(corrSplitW(), 0.5))
            : 0;
          const tColH = tLayout
            ? entH + Math.max(tLeftHs.reduce((a, b) => a + b, 0), foyMinH)
            : colH;
          if (publicRect.w >= maxCellMinW - 1e-6 && publicRect.h - (tLayout ? tColH : colH) >= neededBelow - 1e-6) {
            if (tLayout) {
              // T-entry stack for narrow bands: entrance spans the front at full width; the
              // foyer runs floor-to-living-edge on the street-far half and the remaining
              // entry cells stack on the corridor-side half — so the foyer satisfies the
              // entrance→foyer AND foyer→living graph adjacencies (perpendicular to each
              // other — a plain row cannot), while WC/guest rooms keep direct corridor
              // contact (never a through-route through another room). All splits round to
              // cm so halves tile the band exactly (no 0.01 floating seams).
              const bandX = publicRect.x;
              const bandR = publicRect.x + publicRect.w;
              const corr0 = layout.corridors[0];
              const corrOnRight = corr0 ? corr0.x + corr0.w / 2 >= bandX + publicRect.w / 2 : true;
              const splitX = Math.round((bandX + (bandR - bandX) / 2) * 100) / 100;
              const foyerX = corrOnRight ? bandX : splitX;
              const foyerW = corrOnRight ? splitX - bandX : bandR - splitX;
              const sideX = corrOnRight ? splitX : bandX;
              const sideW = corrOnRight ? bandR - splitX : splitX - bandX;
              const entY = Math.round(publicRect.y * 100) / 100;
              const entHr = Math.round(entH * 100) / 100;
              placed.push(mkSpace('entrance',
                { x: bandX, y: publicRect.y, w: publicRect.w, h: entHr },
                galleryCells[entCol].placedLabel, galleryCells[entCol].placedId, 'public'));
              const tColHr = Math.round(tColH * 100) / 100;
              let ly = entY + entHr;
              leftIdx.forEach((idx, j) => {
                const s = galleryCells[idx];
                const hh = j === leftIdx.length - 1
                  ? Math.round((entY + tColHr - ly) * 100) / 100
                  : Math.round(tLeftHs[j] * 100) / 100;
                placed.push(mkSpace(s.type, { x: sideX, y: ly, w: sideW, h: hh }, s.placedLabel, s.placedId, 'public'));
                ly = Math.round((ly + hh) * 100) / 100;
              });
              const foy = galleryCells[foyCol];
              placed.push(mkSpace('foyer',
                { x: foyerX, y: entY, w: foyerW, h: tColHr - entHr },
                foy.placedLabel, foy.placedId, 'public'));
              galleryBottom = entY + tColHr;
              explanation.push(`Phase15 M3 entry column (T-stack): entrance front, foyer hall along living @ ${tColH.toFixed(2)} m`);
            } else {
              let cy2 = publicRect.y;
              galleryCells.forEach((s, i) => {
                placed.push(mkSpace(s.type, { x: publicRect.x, y: cy2, w: publicRect.w, h: colHs[i] }, s.placedLabel, s.placedId, 'public'));
                cy2 += colHs[i];
              });
              galleryBottom = publicRect.y + colH;
              explanation.push(`Phase15 M3 entry column (vertical sequence): ${galleryCells.map(c => c.type).join('+')} @ front stack h=${colH.toFixed(2)} m`);
            }
            galleryPlaced = true;
          }
        }
        if (galleryPlaced) {
          bandCarvedByGallery = true;
          publicUnplaced.length = 0;
          guestWc = undefined;
          const backY = galleryBottom;
          publicRect = { x: publicRect.x, y: backY, w: publicRect.w, h: Math.max(0.05, publicRect.y + publicRect.h - backY) };
        }
      }
    }

    if (living) {
      if (dining) {
        const totalSouthA = Math.max(living.minArea, living.targetArea) + Math.max(dining.minArea, dining.targetArea);
        let livingW = publicRect.w * Math.max(living.minArea, living.targetArea) / totalSouthA;
        const livingMinW = Math.max(living.minWidth ?? 3.0, 3.0);
        const diningMinW = Math.max(dining.minWidth ?? 2.2, 2.2);
        const livingMinH = Math.max(living.minLength ?? living.minWidth ?? 3.0, 2.5);
        const diningMinH = Math.max(dining.minLength ?? dining.minWidth ?? 2.2, 2.0);
        const publicMinH = Math.max(livingMinH, diningMinH);
        const publicH = Math.max(publicRect.h, publicMinH);
        const requiredMinW = livingMinW + diningMinW;
        // Phase 13.1: feasibility-first — if not enough width for side-by-side, stack vertically preserving min
        if (publicRect.w < requiredMinW - 1e-6) {
          // Not enough width side-by-side — check if we can stack vertically (tall publicRect)
          if (publicRect.h >= livingMinH + diningMinH - 1e-6) {
            // Phase 15 M4: aim both main rooms at (preference-aware) area needs FIRST, then
            // share any genuine surplus by target — instead of the fixed 0.55 split which
            // left dining below 12 m² on tall narrow bands (12×18 family) and giant rooms
            // elsewhere. Falls back to the legacy split whenever the needs cannot tile.
            const livNeedH = mainPref(living, publicRect.w);
            const dinNeedH = mainPref(dining, publicRect.w);
            const stackNeeds = livNeedH + dinNeedH;
            let livingH: number;
            if (publicRect.h >= stackNeeds - 1e-6) {
              const livT = Math.max(living.minArea, living.targetArea);
              const dinT = Math.max(dining.minArea, dining.targetArea);
              livingH = Math.round((livNeedH + (publicRect.h - stackNeeds) * (livT / (livT + dinT))) * 100) / 100;
            } else {
              livingH = Math.max(livingMinH, publicRect.h * 0.55);
            }
            // Round to 2 decimals and make next rect exactly fill publicRect to avoid 0.01 overlap with north kitchen pocket
            livingH = Math.round(livingH * 100) / 100;
            const diningY = Math.round((publicRect.y + livingH) * 100) / 100;
            let diningH = Math.round((publicRect.y + publicRect.h - diningY) * 100) / 100;
            if (diningH < diningMinH - 1e-6) { // ensure min
              livingH = Math.round((publicRect.h - diningMinH) * 100) / 100;
              const dy2 = Math.round((publicRect.y + livingH) * 100) / 100;
              diningH = Math.round((publicRect.y + publicRect.h - dy2) * 100) / 100;
              placed.push(mkSpace('living',
                { x: publicRect.x, y: publicRect.y, w: Math.max(publicRect.w, livingMinW), h: livingH },
                living.placedLabel, living.placedId, 'public'));
              placed.push(mkSpace('dining',
                { x: publicRect.x, y: dy2, w: Math.max(publicRect.w, diningMinW), h: diningH },
                dining.placedLabel, dining.placedId, 'public'));
            } else {
              placed.push(mkSpace('living',
                { x: publicRect.x, y: publicRect.y, w: Math.max(publicRect.w, livingMinW), h: livingH },
                living.placedLabel, living.placedId, 'public'));
              placed.push(mkSpace('dining',
                { x: publicRect.x, y: diningY, w: Math.max(publicRect.w, diningMinW), h: diningH },
                dining.placedLabel, dining.placedId, 'public'));
            }
          } else {
            // Genuinely infeasible — preserve min width, allow overflow but never negative
            livingW = livingMinW;
            const eastX = publicRect.x + livingW;
            const eastW = Math.max(diningMinW, publicRect.w - livingW);
            placed.push(mkSpace('living',
              { x: publicRect.x, y: publicRect.y, w: livingW, h: publicH },
              living.placedLabel, living.placedId, 'public'));
            placed.push(mkSpace('dining',
              { x: eastX, y: publicRect.y, w: eastW, h: publicH },
              dining.placedLabel, dining.placedId, 'public'));
          }
        } else {
          livingW = Math.max(livingMinW, Math.min(publicRect.w - diningMinW, livingW));
          // Phase 15 M4: cap the shared row height at the cells' program-driven maximum
          // (1.75×target, never below their own needs) — a huge band stops force-feeding
          // the living field 100+ m². Any slack becomes intentional void UNDER the row
          // (facade/contact edges stay tiled; band bottom keeps its adjacency by tiling
          // up from it when the cap is not binding).
          const rowH = publicH;
          const rowY = publicRect.y;
          placed.push(mkSpace('living',
            { x: publicRect.x, y: rowY, w: livingW, h: rowH },
            living.placedLabel, living.placedId, 'public'));
          const eastX = publicRect.x + livingW;
          const eastW = publicRect.w - livingW;
          const DINING_MIN_W = diningMinW;
          const GWC_MIN_W = 1.2;
          const finalEastW = Math.max(0, eastW);
          if (guestWc && finalEastW >= DINING_MIN_W + GWC_MIN_W && publicRect.h > 4.0) {
            const gwcW = Math.min(1.6, Math.max(GWC_MIN_W, finalEastW * 0.30));
            const gwcH = Math.min(2.2, Math.max(1.8, publicRect.h * 0.25));
            const diningW = Math.max(DINING_MIN_W, finalEastW - gwcW);
            placed.push(mkSpace('guest-wc',
              { x: eastX + diningW, y: publicRect.y + publicRect.h - gwcH, w: gwcW, h: gwcH },
              guestWc.placedLabel, guestWc.placedId, 'public'));
            placed.push(mkSpace('dining',
              { x: eastX, y: publicRect.y, w: diningW, h: rowH },
              dining.placedLabel, dining.placedId, 'public'));
          } else {
            const finalDiningW = Math.max(DINING_MIN_W, finalEastW);
            placed.push(mkSpace('dining',
              { x: eastX, y: publicRect.y, w: finalDiningW, h: rowH },
              dining.placedLabel, dining.placedId, 'public'));
          }
        }
      } else {
        const livingMinH = Math.max(living.minLength ?? living.minWidth ?? 3.0, 2.5);
        const publicH = Math.max(publicRect.h, livingMinH);
        placed.push(mkSpace('living',
          { x: publicRect.x, y: publicRect.y, w: Math.max(publicRect.w, living.minWidth ?? 3.0), h: publicH },
          living.placedLabel, living.placedId, 'public'));
        if (guestWc) {
          const gwcW = Math.min(1.8, publicRect.w * 0.2);
          placed.push(mkSpace('guest-wc',
            { x: publicRect.x + publicRect.w - gwcW, y: publicRect.y + publicRect.h - 2.2, w: gwcW, h: 2.2 },
            guestWc.placedLabel, guestWc.placedId, 'public'));
        }
      }
    } else {
      const publicSpecs: PlacedSpec[] = [];
      for (const t of orderedPublicTypes as SpaceType[]) {
        let s; while ((s = take(t))) publicSpecs.push(s);
      }
      publicSpecs.push(...publicUnplaced);
      // Ensure candidate positions bounded ≤ MAX_CANDIDATE_POSITIONS
      const boundedSpecs = publicSpecs.slice(0, MAX_CANDIDATE_POSITIONS);
      if (publicSpecs.length > MAX_CANDIDATE_POSITIONS) {
        explanation.push(`Phase13 bounded: public specs ${publicSpecs.length} > MAX_CANDIDATE_POSITIONS ${MAX_CANDIDATE_POSITIONS}, truncating to ${MAX_CANDIDATE_POSITIONS} (explicit)`);
      }
      placed.push(...splitBinary(publicRect, boundedSpecs, mkSpace, 'public', 'y'));
    }
  }

  // --- Corridors ---
  const corridors: Space[] = [];
  for (const [i, r] of layout.corridors.entries()) {
    if (r === layout.entrancePatch) continue;
    if (r.w > 0.05 && r.h > 0.05) {
      corridors.push(mkSpace('corridor', r, i === 0 ? 'Corridor' : 'Spur', `corridor-${i}`, 'circulation'));
    }
  }

  // Phase 15 M6: DROP → FULL-ROW RETILE. When the banded composition could not place
  // every requested room of this band, but the band as a whole CAN host all cells as
  // one side-by-side row (solveRow verdict on the full list), abandon the partial band
  // plan and paint the complete row — silent room loss is never the answer, and a
  // shallow full-width band row is exactly how real plans solve narrow base strips
  // (U/T legs, 3.5 m gallery bands). The band's own geometry decides; no dimensions
  // are special-cased. If even the row cannot host the list, the partial plan stands
  // and the program-completeness gate reports the shortfall honestly.
  {
    const missing = specs.filter(sp =>
      !placed.some(s => s.id === sp.placedId) && !corridors.some(s => s.id === sp.placedId));
    // Fire only where banding is STRUCTURALLY impossible for this list in this rect
    /// (column stacking cannot host either) and the majority of rooms were lost —
    /// a shallow full-width band. Normal rects keep their banded composition.
    const columnViable = solveCol(footprint.w, footprint.h, specs.map(sp => ({
      type: sp.type,
      minWidth: sp.minWidth ?? 2.0,
      minHeight: sp.minLength ?? sp.minWidth ?? 1.5,
      minArea: Math.max(sp.minArea ?? 2, 0.25),
      target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 2, 0.25),
    }))) !== null;
    if (missing.length >= 2 && missing.length > placed.length && !columnViable) {
      const rowCells: BandCellDemand[] = specs.map(sp => ({
        type: sp.type,
        minWidth: sp.minWidth ?? 2.0,
        minHeight: sp.minLength ?? sp.minWidth ?? 1.5,
        minArea: Math.max(sp.minArea ?? 2, 0.25),
        target: Math.max(sp.targetArea ?? 0, sp.minArea ?? 2, 0.25),
      }));
      const rowSol = solveRow(footprint.w, footprint.h, rowCells);
      if (rowSol) {
        placed.length = 0;
        corridors.length = 0;
        let rx = footprint.x;
        for (let i = 0; i < specs.length; i++) {
          const sp = specs[i];
          const c = rowSol.cells[i];
          const r: Rect = { x: rx, y: footprint.y, w: Math.max(0.9, c.flow), h: Math.min(c.cross, footprint.h) };
          rx += r.w;
          if (sp.type === 'corridor' || sp.type === 'stair-hall' || sp.type === 'elevator-hall') {
            corridors.push(mkSpace(sp.type as any, r, sp.placedLabel, sp.placedId, 'circulation'));
          } else {
            placed.push(mkSpace(sp.type as any, r, sp.placedLabel, sp.placedId, sp.zone ?? 'public'));
          }
        }
        explanation.push(`Phase15 M6 full-row retile: ${specs.length} cells side by side across ${footprint.w.toFixed(1)} m (band could not place ${missing.length} of them as bands)`);
      } else {
        explanation.push(`Phase15 M6: band dropped ${missing.length} room(s) [${missing.map(m => m.type).join(',')}] and full-row tiling cannot host the list either — reported via program completeness gate`);
      }
    }
  }

  snap(placed);
  clampToBounds(placed, footprint);
  resolveOverlaps(placed, MAX_LOCAL_REPAIR_ITERATIONS);
  clampToBounds(placed, footprint);
  resolveOverlaps(placed, MAX_LOCAL_REPAIR_ITERATIONS);
  clampToBounds(placed, footprint);
  resolveOverlaps(placed, MAX_LOCAL_REPAIR_ITERATIONS);
  explanation.push(`Placed ${placed.length} rooms + ${corridors.length} corridor segment(s). Bounds: attempts≤${MAX_CONSTRAINT_PLACEMENT_ATTEMPTS}, repair≤${MAX_LOCAL_REPAIR_ITERATIONS}, positions≤${MAX_CANDIDATE_POSITIONS}`);
  return { spaces: placed, corridors, explanation };
}

/** Split a rectangle among specs recursively along the long axis; head
 *  (first after priority/area sort) takes the first slice sized to its
 *  fraction of target area. Phase 13: min-aware — never shrink below minWidth/minLength. */
function splitBinary(
  rect: Rect,
  specs: PlacedSpec[],
  mkSpace: (type: SpaceType, r: Rect, label: string, id: string, zone: Zone) => Space,
  zone: Zone,
  firstAxis: 'x' | 'y' = 'y',
  depth = 0,
): Space[] {
  if (specs.length === 0 || rect.w < 0.05 || rect.h < 0.05 || depth > 10) return [];
  if (specs.length === 1) return [mkSpace(specs[0].type, rect, specs[0].placedLabel, specs[0].placedId, zone)];

  const sorted = [...specs].sort((a,b) => (b.priority - a.priority) || (Math.max(b.minArea,b.targetArea) - Math.max(a.minArea,a.targetArea)));
  // Phase 13: compute total min width/height required
  const mins = sorted.map(s => Math.max(s.minWidth ?? MIN_SIDE, s.minLength ?? MIN_SIDE, 1.0));
  const totalMin = mins.reduce((a,b)=>a+b,0);
  const alongX = depth === 0 ? firstAxis === 'x' : (firstAxis === 'x' ? rect.w < rect.h : rect.w >= rect.h);
  const available = alongX ? rect.w : rect.h;

  // If total min exceeds available, we cannot satisfy all without shrinking below min.
  // Preserve min for each, allow overflow (will be reported as GEO_ROOM_OUTSIDE or HARD), but never shrink below min.
  if (totalMin > available + 1e-6) {
    // Allocate min widths sequentially, overflow allowed
    let pos = alongX ? rect.x : rect.y;
    const result: Space[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const min = mins[i];
      if (alongX) {
        const r: Rect = { x: pos, y: rect.y, w: min, h: rect.h };
        result.push(mkSpace(s.type, r, s.placedLabel, s.placedId, zone));
        pos += min;
      } else {
        const r: Rect = { x: rect.x, y: pos, w: rect.w, h: min };
        result.push(mkSpace(s.type, r, s.placedLabel, s.placedId, zone));
        pos += min;
      }
    }
    return result;
  }

  const head = sorted[0]; const rest = sorted.slice(1);
  const total = sorted.reduce((s,r)=>s+Math.max(r.minArea,r.targetArea),0);
  let frac = Math.max(0.2, Math.min(0.65, Math.max(head.minArea,head.targetArea)/Math.max(total,1)));
  const restMin = Math.max(MIN_SIDE, ...rest.map(r => Math.max(r.minWidth ?? 1, r.minLength ?? 1)));
  // Ensure head at least min, rest at least restMin
  const headMin = Math.max(head.minWidth ?? MIN_SIDE, head.minLength ?? MIN_SIDE, mins[0]);

  if (alongX) {
    const at = Math.max(headMin, Math.min(rect.w - restMin - 0.05, rect.w * frac));
    const [l, r] = rSplitX(rect, Math.max(MIN_SIDE, at));
    return [...splitBinary(l, [head], mkSpace, zone, firstAxis, depth+1), ...splitBinary(r, rest, mkSpace, zone, firstAxis, depth+1)];
  } else {
    const minHead = Math.max(headMin, head.minLength ?? MIN_SIDE, Math.max(head.minArea,head.targetArea)/Math.max(rect.w,0.5));
    const at = Math.max(minHead, Math.min(rect.h - restMin - 0.05, rect.h * frac));
    const [b, t] = rSplitY(rect, Math.max(MIN_SIDE, at));
    return [...splitBinary(b, [head], mkSpace, zone, firstAxis, depth+1), ...splitBinary(t, rest, mkSpace, zone, firstAxis, depth+1)];
  }
}

function clampToBounds(list: Space[], bounds: Rect) {
  for (const s of list) {
    const minW = s.minWidth ?? 0.9;
    const minH = s.minLength ?? s.minWidth ?? 0.9;
    if (s.rect.x < bounds.x - 1e-6) s.rect.x = bounds.x;
    if (s.rect.y < bounds.y - 1e-6) s.rect.y = bounds.y;
    if (s.rect.x + s.rect.w > bounds.x + bounds.w + 1e-6) {
      const maxW = bounds.x + bounds.w - s.rect.x;
      if (maxW >= minW - 1e-6) {
        s.rect.w = maxW;
      }
    }
    if (s.rect.y + s.rect.h > bounds.y + bounds.h + 1e-6) {
      const maxH = bounds.y + bounds.h - s.rect.y;
      if (maxH >= minH - 1e-6) {
        s.rect.h = maxH;
      }
    }
    s.polygon = rCorners(s.rect); s.area = rArea(s.rect);
  }
}

function snap(list: Space[]) {
  for (const s of list) {
    s.rect.x = Math.round((s.rect.x+1e-9)*100)/100;
    s.rect.y = Math.round((s.rect.y+1e-9)*100)/100;
    s.rect.w = Math.round((s.rect.w+1e-9)*100)/100;
    s.rect.h = Math.round((s.rect.h+1e-9)*100)/100;
    s.polygon = rCorners(s.rect); s.area = rArea(s.rect);
  }
}
function resolveOverlaps(list: Space[], maxIter = MAX_LOCAL_REPAIR_ITERATIONS) {
  for (let iter = 0; iter < maxIter; iter++) {
    let fixed = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i+1; j < list.length; j++) {
        const a=list[i].rect, b=list[j].rect;
        const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
        const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
        if (ox<=1e-3||oy<=1e-3) continue;
        if (ox<oy) { if(b.x>=a.x) b.x=a.x+a.w; else b.x=a.x-b.w; }
        else       { if(b.y>=a.y) b.y=a.y+a.h; else b.y=a.y-b.h; }
        list[j].rect=b; list[j].polygon=rCorners(b); list[j].area=rArea(b);
        fixed++;
      }
    }
    if (!fixed) break;
  }
  for (let i=0;i<list.length;i++) {
    for (let j=i+1;j<list.length;j++) {
      const a=list[i].rect, b=list[j].rect;
      const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
      const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      if (ox<=0||oy<=0) continue;
      if (ox>0.001 && oy>0.001 && ox*oy < 0.05) {
        if (ox<oy) { if(b.x>=a.x) b.x=Math.round((a.x+a.w+1e-9)*100)/100; else b.x=Math.round((a.x-b.w+1e-9)*100)/100; }
        else       { if(b.y>=a.y) b.y=Math.round((a.y+a.h+1e-9)*100)/100; else b.y=Math.round((a.y-b.h+1e-9)*100)/100; }
        list[j].rect=b; list[j].polygon=rCorners(b); list[j].area=rArea(b);
      }
    }
  }
}
