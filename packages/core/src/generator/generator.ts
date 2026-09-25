/**
 * Phase 11 — Deterministic constraint-based layout generator with canonical polygon rooms
 *
 * Pipeline:
 *   SITE GEOMETRY → BUILDABLE GEOMETRY → SITE-AWARE SPACE PLACEMENT (polygon canonical) → WALLS (from polygon) / OPENINGS / FURNITURE (polygon containment) / STAIRS → VALIDATION → INTELLIGENCE → WHOLE-BUILDING → OPTIMIZATION → DXF/PDF/XLSX/REPORT/MANIFEST/UI + EDITING
 *
 * Site shapes: rectangle, l-shape, polygon (orthogonal V1, 3..8 vertices)
 * Room shapes: rectangle (4 verts), L-shape (6 verts), orthogonal concave up to 8 verts — polygon canonical, rect derived bounding compatibility
 */

import type { ProjectInput } from '../model/project.js';
import type { Floor } from '../model/floor.js';
import type { Space, SpaceSpec } from '../model/space.js';
import type { Wall } from '../model/wall.js';
import type { Furniture } from '../model/furniture.js';
import type { LayoutCandidate, CandidateStrategy, LayoutMetadata } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import { computeAdjacencyMetrics, programAdjacencyByType } from '../quality/metrics-v1.js';
import { programForFloor, allocateBuildingProgram, labelFor } from '../programming/program.js';
import type { FloorProgramAllocation } from '../programming/program.js';
import { composePacks, computeBuildableArea, runPackRules, runPackRulesOnCandidate } from '../regulations/engine.js';
import { placeParking, placeParkingSiteAware, reserveParkingBand } from './parking.js';
import { DEFAULT_FLOOR_HEIGHT } from './stairs.js';
import { solveStair } from './stair-solver.js';
import {
  makeCoreAnchor, solveStairOrientations, inspectAnchorPlacement, sameRect,
  type CoreAnchor, type HallSide,
} from './vertical-core.js';
import { DEFAULT_STAIR_CONFIG, type Stair, type Elevator, type ElevatorDoorSide } from '../model/stairs.js';
import { buildElevator, cellFitsShaft, elevatorLandingSide, findCoreAdjacentShaftCell, rigidShaftCell } from './elevator-shaft.js';
import { generateWalls } from './walls.js';
import { placeOpenings, programmeDoorRequirements } from './openings.js';
import { computeMetrics } from '../optimizer/metrics.js';
import { validateLayout } from '../validation/validator.js';
import { placeSpaces, type PlacedSpec } from '../layout/placer.js';
import { rectPartitions, contactConnected, contactLen } from '../layout/regions.js';
import { solveRow, solveCol, type BandCellDemand } from '../layout/topology.js';
import { sortCandidates } from '../layout/ranking.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from '../layout/constraints.js';
import { placeFurniture } from './furniture.js';
import type { Rect } from '../geometry/rect.js';
import { rArea, rCorners, rIntersects } from '../geometry/rect.js';
import { polygonArea } from '../geometry/polygon.js';
import { EPS, CORRIDOR_MIN_WIDTH, DOOR_INT_WIDTH, DOOR_BATH_WIDTH } from '../units.js';
import { computeBuildableGeometry } from '../site/buildable.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import type { AccessSide } from '../model/site.js';
import {
  rectInsidePolygon,
  polygonBoundingRect,
  validateSitePolygon,
  createLShapePolygon,
  hasDuplicateConsecutiveVertices,
  hasZeroLengthEdges,
  hasSelfIntersection,
  isOrthogonal,
} from '../geometry/polygon-ops.js';
import { createRectangleRoomPolygon, roomPolygonToBoundingRect } from '../geometry/room-polygon.js';
import { applyFloorCompaction } from '../layout/compaction.js';
import { placeSpacesLShape, lAwareParkingEnvelope } from './l-shape.js';

export const ALL_STRATEGIES: CandidateStrategy[] = [
  'area-efficiency',
  'functional-circulation',
  'daylight-orientation',
  'alternative-zoning',
];

/** Phase 5.2 — optional generator behaviour. Every field defaults to OFF (legacy, byte-identical). */
export interface GenerateLayoutsOptions {
  /**
   * Opt-in programme door completion (openings stage 3b): adds a direct door
   * where a programme `doorRequired` pair already shares a wall but has no door.
   */
  programmeDoorCompletion?: boolean;
  /**
   * Phase 5.3A opt-in (default OFF): rectangular placer keeps the guest WC out of
   * the dining↔kitchen gap when the programme requires a dining↔kitchen door and
   * the entry column can host it at programme minimums (see PlacerOptions).
   */
  preferDiningKitchenAdjacency?: boolean;
  /**
   * Phase 5.3B opt-in (default OFF): L-shape wing selection prefers the plan with
   * more satisfied programme adjacency — only among plans that already pass every
   * mandatory gate (see LShapePlacementOptions).
   */
  preferLShapeProgrammeAdjacency?: boolean;
  /**
   * Phase 5.4A opt-in (default OFF): rectangular M3 entry gallery confined to the
   * living column when the full-width gallery would leave dining without an
   * exterior edge (see PlacerOptions.galleryDaylightAware). Adopted per candidate
   * only through the validator-guarded comparison (adoptGalleryDaylightVariant).
   */
  galleryDaylightAware?: boolean;
  /**
   * Phase 5.4B opt-in (default OFF): on upper floors, a stair hall with no corridor
   * contact is joined to the nearest corridor by a corridor connector filling the
   * smallest clean empty gap between them (see connectStairCoreToCorridor). Adopted
   * per candidate only through the validator-guarded comparison
   * (adoptStairCoreConnectorVariant).
   */
  connectStairCore?: boolean;
  /**
   * Phase 5.4C opt-in (default OFF): rectangular placer stacks living (front) and
   * dining (behind) when the side-by-side row would leave dining without an exterior
   * edge and the band's living-side edge is exterior (see
   * PlacerOptions.stackPublicForDaylight). Adopted per candidate only through the
   * validator-guarded comparison (adoptPublicStackDaylightVariant).
   */
  stackPublicForDaylight?: boolean;
  /**
   * Phase 5.4D opt-in (default OFF): on upper floors, a stair hall separated from a
   * facing corridor by an empty gap thinner than CORRIDOR_MIN_WIDTH (left by re-pinning
   * the hall onto the core anchor) is joined to it by a bridge corridor covering the
   * gap and the corridor's full depth over the hall overlap (see
   * findThinStairGapBridge). Adopted per candidate only through the validator-guarded
   * comparison (adoptThinStairGapBridgeVariant).
   */
  bridgeThinStairGap?: boolean;
  /**
   * Phase 5.4E opt-in (default OFF): on upper floors, a room with no wall contact to
   * a corridor / foyer / entrance / stair hall long enough for its door is joined to
   * the circulation by a corridor connector filling a clean empty gap, found with the
   * unchanged 5.4B search (see findRoomAccessConnectors). Adopted per candidate only
   * through the validator-guarded comparison (adoptRoomAccessConnectorVariant).
   */
  connectIsolatedRooms?: boolean;
  /**
   * Phase 5.5A opt-in (default OFF): within the 5.4A daylight-aware gallery arrangement,
   * a dining that would exceed 7 m in depth or frontage is placed on the street-façade
   * row beside the gallery cells (≤ 7 m both axes, programme-minimum sized) with living
   * behind across the full band (see PlacerOptions.diningFacadeRow). Adopted per
   * candidate only through the unchanged 5.4A guard (adoptGalleryDaylightVariant).
   */
  diningFacadeRow?: boolean;
}

export function generateLayouts(
  input: ProjectInput,
  strategies: CandidateStrategy[] = ['functional-circulation'],
  options: GenerateLayoutsOptions = {},
): LayoutCandidate[] {
  const programmeDoorCompletion = options.programmeDoorCompletion === true;
  const preferDiningKitchenAdjacency = options.preferDiningKitchenAdjacency === true;
  const preferLShapeProgrammeAdjacency = options.preferLShapeProgrammeAdjacency === true;
  const galleryDaylightAware = options.galleryDaylightAware === true;
  const connectStairCore = options.connectStairCore === true;
  const stackPublicForDaylight = options.stackPublicForDaylight === true;
  const bridgeThinStairGap = options.bridgeThinStairGap === true;
  const connectIsolatedRooms = options.connectIsolatedRooms === true;
  const diningFacadeRow = options.diningFacadeRow === true;
  validateInput(input);
  const packs = composePacks(input);
  const bfp = computeBuildableArea(input);
  const footprint: Rect = bfp.rect;
  const buildableGeom = computeBuildableGeometry(input.site);

  const packFindings: Finding[] = [];
  for (const r of runPackRules(packs, input, bfp)) {
    if (!r.pass) {
      packFindings.push({
        code: r.code, severity: r.severity, message: r.message, ruleId: r.code,
        reference: r.reference ?? 'Regulation pack', status: r.status, sources: r.sources,
      });
    }
  }
  for (const ap of bfp.appliedRules) {
    if (ap.status === 'REQUIRES_SOURCE_VERIFICATION') {
      packFindings.push({
        code: 'REG_RULE_UNVERIFIED', severity: 'advisory',
        message: `${ap.ruleId}: ${ap.message} — REQUIRES SOURCE VERIFICATION.`,
        ruleId: ap.ruleId, reference: ap.reference,
      });
    }
  }
  if (!buildableGeom.isValid) {
    for (const err of buildableGeom.validationErrors) {
      packFindings.push({
        code: 'SITE_GEOM_INVALID', severity: 'hard',
        message: `Site/buildable geometry invalid: ${err}`,
        ruleId: 'SITE_GEOM',
        reference: 'Site validation — Phase 10',
        status: 'VERIFIED',
      });
    }
  }

  const seed = input.seed ?? 1;
  const numFloors = Math.max(1, input.building.floors);
  // Phase 15 M3: the required program is distributed at BUILDING level once, and every
  // strategy receives the SAME per-floor allocation — no strategy may silently expand or
  // shrink the program on any floor.
  const allocations = allocateBuildingProgram(input.building, numFloors);
  const candidates: LayoutCandidate[] = [];

  const buildCandidate = (strategy: CandidateStrategy, lShapeAdj: boolean, galleryDaylight = false, stairConnector = false, publicStack = false, stairGapBridge = false, roomConnectors = false, facadeRow = false): LayoutCandidate => {
    const explanations: string[] = [];
    explanations.push(`Site shape ${input.site.shape}, siteArea ${buildableGeom.siteArea.toFixed(1)} m², buildableArea ${buildableGeom.buildableArea.toFixed(1)} m², buildableRects ${buildableGeom.buildableRects.length}, setbacks N=${bfp.setbacks.north} S=${bfp.setbacks.south} E=${bfp.setbacks.east} W=${bfp.setbacks.west} — ${buildableGeom.appliedSetbacks.map(s => `${s.direction}:${s.source}`).join(', ')}`);
    const floors: Floor[] = [];
    // Phase15 M7: building-level vertical-core anchors (stair/elevator halls).
    // Level 0 establishes them; upper floors must reuse them for coherence.
    const coreAnchors = new Map<'stair-hall' | 'elevator-hall', CoreAnchor>();
    for (let level = 0; level < numFloors; level++) {
      floors.push(buildFloorSiteAware(input, buildableGeom, bfp, level, numFloors === 1, strategy, explanations, allocations[level], coreAnchors, programmeDoorCompletion, preferDiningKitchenAdjacency, lShapeAdj, galleryDaylight, stairConnector, publicStack, stairGapBridge, roomConnectors, facadeRow));
    }

    explanations.push(`Constraint graph: ${DEFAULT_RESIDENTIAL_CONSTRAINTS.length} relationships loaded. Phase 11 canonical polygon rooms, parametric constraints, locking, editing foundation.`);
    const meta: LayoutMetadata = { strategy, seed, generatedAt: Date.now(), regulationPacks: packs.map(p => ({ id: p.id, edition: p.edition })) };
    const cand: LayoutCandidate = {
      id: `cand-${strategy}-${seed}`, buildableArea: footprint, floors,
      findings: [...packFindings], valid: false, metrics: zeroMetrics(),
      explanations: dedup(explanations), metadata: meta,
    };
    (cand as any).programRequirements = floors.map(fl => ({
      level: fl.level,
      byType: { ...(((fl as any).assignedProgram ?? {}) as Record<string, number>) },
    }));
    (cand as any).siteBoundary = buildableGeom.siteBoundary;
    (cand as any).buildableBoundary = buildableGeom.buildableBoundary;
    (cand as any).buildableRects = buildableGeom.buildableRects;
    (cand as any).siteShape = input.site.shape;
    (cand as any).buildableAreaValue = buildableGeom.buildableArea;
    (cand as any).siteAreaValue = buildableGeom.siteArea;
    (cand as any).appliedSetbacks = buildableGeom.appliedSetbacks;
    (cand as any).siteInput = input.site;

    const layoutFindings = runPackRulesOnCandidate(packs, input, bfp, cand).map(rr => ({
      code: rr.code,
      severity: rr.severity,
      message: rr.message,
      ruleId: rr.code,
      reference: rr.reference,
      status: rr.status,
      sources: rr.sources,
      entityIds: rr.entityIds,
      bbox: rr.bbox,
    }));
    cand.findings = [...cand.findings, ...layoutFindings];
    const vr = validateLayout(cand);
    cand.findings = vr.findings;
    cand.valid = vr.ok;
    cand.metrics = computeMetrics(cand);
    return cand;
  };

  for (const strategy of strategies) {
    const legacy = buildCandidate(strategy, false);
    // Phase 5.3B (opt-in): the L-wing adjacency preference is adopted ONLY when the
    // full validator confirms it costs nothing — the placer's gates are proxies.
    const base = preferLShapeProgrammeAdjacency && input.site.shape === 'l-shape'
      ? adoptLShapeAdjacencyVariant(legacy, buildCandidate(strategy, true), input)
      : legacy;
    // Phase 5.4A (opt-in): the daylight-aware gallery variant is adopted ONLY when the
    // full validator confirms strictly fewer MBH4-DYL-001 failures at no other cost.
    const lAdjUsed = base !== legacy;
    const withGallery = galleryDaylightAware
      ? adoptGalleryDaylightVariant(base, buildCandidate(strategy, lAdjUsed, true))
      : base;
    // Phase 5.5A (opt-in): immediately after 5.4A — the dining façade-row variant (built
    // with the 5.4A gallery arrangement enabled) is adopted ONLY through the unchanged 5.4A
    // guard, and only when the façade row actually fired in the placer.
    let withFacade = withGallery;
    if (galleryDaylightAware && diningFacadeRow) {
      const v = buildCandidate(strategy, lAdjUsed, true, false, false, false, false, true);
      if (v.explanations.some(e => e.startsWith(FACADE_ROW_PLACED))) {
        const adopted = adoptGalleryDaylightVariant(withGallery, v);
        if (adopted === v) {
          v.explanations.push('Phase 5.5A: dining façade-row variant adopted through the unchanged 5.4A guard.');
          withFacade = v;
        }
      }
    }
    const facadeUsed = withFacade !== withGallery;
    const galleryUsed = withGallery !== base || facadeUsed;
    // Phase 5.4B (opt-in): the stair-core connector variant (built on the same adopted
    // options) is adopted ONLY when the validator confirms strictly fewer
    // corridor↔stair-hall and inaccessible-space findings at no other cost.
    const withConnector = connectStairCore
      ? adoptStairCoreConnectorVariant(withFacade, buildCandidate(strategy, lAdjUsed, galleryUsed, true, false, false, false, facadeUsed))
      : withFacade;
    // Phase 5.4C (opt-in): deterministic order 5.3B → 5.4A → 5.4B → 5.4C. The public
    // stack variant is built on the options already adopted; in the placer a 5.4A
    // gallery that already placed living/dining takes precedence (stack never runs).
    const withStack = stackPublicForDaylight
      ? adoptPublicStackDaylightVariant(withConnector,
        buildCandidate(strategy, lAdjUsed, galleryUsed, withConnector !== withFacade, true, false, false, facadeUsed))
      : withConnector;
    // Phase 5.4D (opt-in): deterministic order 5.3B → 5.4A → 5.4B → 5.4C → 5.4D. The
    // thin-gap stair bridge is a post-placement repair built on the options already
    // adopted; it never fires where a 5.4B connector already joined the hall.
    const withBridge = bridgeThinStairGap
      ? adoptThinStairGapBridgeVariant(withStack,
        buildCandidate(strategy, lAdjUsed, galleryUsed, withConnector !== withFacade, withStack !== withConnector, true, false, facadeUsed))
      : withStack;
    // Phase 5.4E (opt-in): deterministic order 5.3B → 5.4A → 5.4B → 5.4C → 5.4D → 5.4E.
    // Isolated-room access connectors are a post-placement repair built on the options
    // already adopted.
    candidates.push(connectIsolatedRooms
      ? adoptRoomAccessConnectorVariant(withBridge,
        buildCandidate(strategy, lAdjUsed, galleryUsed, withConnector !== withFacade, withStack !== withConnector, withBridge !== withStack, true, facadeUsed))
      : withBridge);
  }

  sortCandidates(candidates);
  return candidates;
}

/** Programme adjacency key from the frozen quality metric (read-only): [doorRequired weight, total weight] satisfied. */
function programmeAdjacencyKeyOf(c: LayoutCandidate, input: ProjectInput): [number, number] {
  let door = 0, total = 0;
  for (const fl of c.floors) {
    for (const x of computeAdjacencyMetrics(fl, programAdjacencyByType(input, fl.level)).instances) {
      if (x.adjacencySatisfied !== true) continue;
      total += x.weight;
      if (x.doorRequired) door += x.weight;
    }
  }
  return [door, total];
}

/** Placer explanation prefix proving the Phase 5.5A façade row was actually built. */
const FACADE_ROW_PLACED = 'Phase 5.5A dining façade row';

const WATCHED_FINDING = /^CIRC|DIRECT_ACCESS|INACCESSIBLE|DAYLIGHT|DYL/;

/**
 * Phase 5.3B validated adoption. The adjacency-preferring variant replaces the
 * legacy candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - adds no HARD finding (per-code HARD counts never increase),
 *   - adds no circulation / access / daylight finding of any severity (per code),
 *   - strictly improves programme adjacency (doorRequired weight first, then total).
 * Otherwise the legacy candidate is returned untouched.
 */
export function adoptLShapeAdjacencyVariant(legacy: LayoutCandidate, variant: LayoutCandidate, input: ProjectInput): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(legacy.floors)) return legacy;
  if (legacy.valid && !variant.valid) return legacy;
  const counts = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const guarded = (f: Finding) => f.severity === 'hard' || WATCHED_FINDING.test(f.code);
  const lc = counts(legacy, guarded), vc = counts(variant, guarded);
  for (const [k, n] of vc) if (n > (lc.get(k) ?? 0)) return legacy;
  const kl = programmeAdjacencyKeyOf(legacy, input), kv = programmeAdjacencyKeyOf(variant, input);
  const better = kv[0] > kl[0] || (kv[0] === kl[0] && kv[1] > kl[1]);
  if (!better) return legacy;
  variant.explanations.push(`Phase 5.3B: L-wing programme-adjacency variant adopted (doorRequired weight ${kl[0]}→${kv[0]}, total ${kl[1]}→${kv[1]}) — validator confirmed no lost validity, no added HARD / circulation / access / daylight finding.`);
  return variant;
}

const DAYLIGHT_RULE = 'MBH4-DYL-001';

/**
 * Phase 5.4A validated adoption. The daylight-aware gallery variant replaces the
 * base candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - adds no HARD finding (per-code HARD counts never increase),
 *   - adds no circulation / access / daylight finding of any severity (per code),
 *   - has strictly fewer MBH4-DYL-001 findings.
 * Otherwise the base candidate is returned untouched. Deterministic.
 */
export function adoptGalleryDaylightVariant(base: LayoutCandidate, variant: LayoutCandidate): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(base.floors)) return base;
  if (base.valid && !variant.valid) return base;
  const counts = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const guarded = (f: Finding) => f.severity === 'hard' || WATCHED_FINDING.test(f.code);
  const bc = counts(base, guarded), vc = counts(variant, guarded);
  for (const [k, n] of vc) if (n > (bc.get(k) ?? 0)) return base;
  const dyl = (c: LayoutCandidate) => c.findings.filter(f => f.code === DAYLIGHT_RULE).length;
  const db = dyl(base), dv = dyl(variant);
  if (!(dv < db)) return base;
  variant.explanations.push(`Phase 5.4A: daylight-aware entry-gallery variant adopted (${DAYLIGHT_RULE} findings ${db}→${dv}) — validator confirmed no lost validity, no added HARD / circulation / access / daylight finding.`);
  return variant;
}

/**
 * Phase 5.4C validated adoption. The daylight-aware public-stack variant replaces
 * the base candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - adds no HARD finding (per-code HARD counts never increase),
 *   - adds no circulation / access / daylight finding of any severity (per code),
 *   - has strictly fewer MBH4-DYL-001 findings.
 * Otherwise the base candidate is returned untouched. Deterministic.
 */
export function adoptPublicStackDaylightVariant(base: LayoutCandidate, variant: LayoutCandidate): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(base.floors)) return base;
  if (base.valid && !variant.valid) return base;
  const counts = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const guarded = (f: Finding) => f.severity === 'hard' || WATCHED_FINDING.test(f.code);
  const bc = counts(base, guarded), vc = counts(variant, guarded);
  for (const [k, n] of vc) if (n > (bc.get(k) ?? 0)) return base;
  const dyl = (c: LayoutCandidate) => c.findings.filter(f => f.code === DAYLIGHT_RULE).length;
  const db = dyl(base), dv = dyl(variant);
  if (!(dv < db)) return base;
  variant.explanations.push(`Phase 5.4C: daylight-aware public-stack variant adopted (${DAYLIGHT_RULE} findings ${db}→${dv}) — validator confirmed no lost validity, no added HARD / circulation / access / daylight finding.`);
  return variant;
}

/**
 * Phase 5.4D validated adoption. The thin-gap stair-bridge variant replaces the base
 * candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - adds no HARD finding (per-code HARD counts never increase),
 *   - adds no circulation / access / daylight finding of any severity (per code),
 *   - has strictly fewer CONSTRAINT_MUST_ADJACENT findings AND strictly fewer
 *     CIRC_INACCESSIBLE_SPACE + CIRC_ROOM_THROUGH_ROOM findings combined.
 * Otherwise the base candidate is returned untouched. Deterministic.
 */
export function adoptThinStairGapBridgeVariant(base: LayoutCandidate, variant: LayoutCandidate): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(base.floors)) return base;
  if (base.valid && !variant.valid) return base;
  const counts = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const guarded = (f: Finding) => f.severity === 'hard' || WATCHED_FINDING.test(f.code);
  const bc = counts(base, guarded), vc = counts(variant, guarded);
  for (const [k, n] of vc) if (n > (bc.get(k) ?? 0)) return base;
  const n = (c: LayoutCandidate, code: string) => c.findings.filter(f => f.code === code).length;
  const adjB = n(base, 'CONSTRAINT_MUST_ADJACENT'), adjV = n(variant, 'CONSTRAINT_MUST_ADJACENT');
  const reachB = n(base, 'CIRC_INACCESSIBLE_SPACE') + n(base, 'CIRC_ROOM_THROUGH_ROOM');
  const reachV = n(variant, 'CIRC_INACCESSIBLE_SPACE') + n(variant, 'CIRC_ROOM_THROUGH_ROOM');
  if (!(adjV < adjB) || !(reachV < reachB)) return base;
  variant.explanations.push(`Phase 5.4D: thin-gap stair-bridge variant adopted (CONSTRAINT_MUST_ADJACENT ${adjB}→${adjV}, CIRC_INACCESSIBLE_SPACE+CIRC_ROOM_THROUGH_ROOM ${reachB}→${reachV}) — validator confirmed no lost validity, no added HARD / circulation / access / daylight finding.`);
  return variant;
}

/**
 * Phase 5.4B validated adoption. The stair-core connector variant replaces the base
 * candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - adds no HARD finding (per-code HARD counts never increase),
 *   - adds no circulation / access / daylight finding of any severity (per code),
 *   - has strictly fewer CONSTRAINT_MUST_ADJACENT AND strictly fewer
 *     CIRC_INACCESSIBLE_SPACE findings.
 * Otherwise the base candidate is returned untouched. Deterministic.
 */
export function adoptStairCoreConnectorVariant(base: LayoutCandidate, variant: LayoutCandidate): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(base.floors)) return base;
  if (base.valid && !variant.valid) return base;
  const counts = (c: LayoutCandidate, pick: (f: Finding) => boolean) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (pick(f)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const guarded = (f: Finding) => f.severity === 'hard' || WATCHED_FINDING.test(f.code);
  const bc = counts(base, guarded), vc = counts(variant, guarded);
  for (const [k, n] of vc) if (n > (bc.get(k) ?? 0)) return base;
  const n = (c: LayoutCandidate, code: string) => c.findings.filter(f => f.code === code).length;
  const adjB = n(base, 'CONSTRAINT_MUST_ADJACENT'), adjV = n(variant, 'CONSTRAINT_MUST_ADJACENT');
  const inB = n(base, 'CIRC_INACCESSIBLE_SPACE'), inV = n(variant, 'CIRC_INACCESSIBLE_SPACE');
  if (!(adjV < adjB) || !(inV < inB)) return base;
  variant.explanations.push(`Phase 5.4B: stair-core connector variant adopted (CONSTRAINT_MUST_ADJACENT ${adjB}→${adjV}, CIRC_INACCESSIBLE_SPACE ${inB}→${inV}) — validator confirmed no lost validity, no added HARD / circulation / access / daylight finding.`);
  return variant;
}

/** Minimum clear width of a stair-core connector (m) — the programme corridor minWidth used by the engine (1.1 m). */
export const STAIR_CONNECTOR_MIN_W = 1.1;
/** Preferred connector width: the placer's standard corridor width (CORRIDOR_W). */
const STAIR_CONNECTOR_PREF_W = 1.5;

type Side = 'north' | 'south' | 'east' | 'west';
const SIDE_ORDER: Side[] = ['north', 'east', 'south', 'west'];

/** Length of the shared boundary between two axis-aligned rects (0 when not edge-adjacent). */
function sharedEdge(a: Rect, b: Rect, tol = 1e-3): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) && oy > tol) return oy;
  if ((Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) && ox > tol) return ox;
  return 0;
}
const rectsOverlap = (a: Rect, b: Rect, tol = 1e-3) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol;

/**
 * Phase 5.4B — pure geometric search for a stair-core connector.
 *
 * Returns null when the hall already shares ≥ STAIR_CONNECTOR_MIN_W of wall with a
 * corridor. Otherwise, for every corridor lying wholly beyond one side of the hall
 * with a cross overlap ≥ STAIR_CONNECTOR_MIN_W, the gap between them is a candidate
 * connector (cross width = min(overlap, 1.5 m), aligned to either end of the overlap,
 * or the full overlap). A candidate must have BOTH sides ≥ STAIR_CONNECTOR_MIN_W (a
 * corridor's clear width is its short side — thinner gaps are rejected, never filled
 * with a sliver), lie inside the buildable geometry and overlap no other space. Ordering is deterministic: the stair entry
 * side first, then smallest area, then side order N/E/S/W, then x, then y.
 */
export function findStairCoreConnector(
  hall: Rect,
  spaces: readonly { type: string; rect: Rect }[],
  inside: (r: Rect) => boolean,
  entrySide: Side | null,
): { rect: Rect; side: Side } | null {
  const corridors = spaces.filter(s => s.type === 'corridor');
  if (corridors.some(k => sharedEdge(hall, k.rect) >= STAIR_CONNECTOR_MIN_W - 1e-6)) return null;
  const E = 1e-6;
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  const cands: { rect: Rect; side: Side }[] = [];
  for (const k of corridors) {
    const K = k.rect;
    const oy0 = Math.max(hall.y, K.y), oy1 = Math.min(hall.y + hall.h, K.y + K.h);
    const ox0 = Math.max(hall.x, K.x), ox1 = Math.min(hall.x + hall.w, K.x + K.w);
    const push = (side: Side, lo: number, hi: number, mk: (a: number, b: number) => Rect) => {
      if (hi - lo < STAIR_CONNECTOR_MIN_W - E) return;
      const w = Math.min(hi - lo, STAIR_CONNECTOR_PREF_W);
      for (const [a, b] of [[lo, lo + w], [hi - w, hi], [lo, hi]]) cands.push({ side, rect: mk(a, b) });
    };
    if (K.x + K.w <= hall.x + E) push('west', oy0, oy1, (a, b) => ({ x: K.x + K.w, y: a, w: hall.x - (K.x + K.w), h: b - a }));
    if (hall.x + hall.w <= K.x + E) push('east', oy0, oy1, (a, b) => ({ x: hall.x + hall.w, y: a, w: K.x - (hall.x + hall.w), h: b - a }));
    if (K.y + K.h <= hall.y + E) push('south', ox0, ox1, (a, b) => ({ x: a, y: K.y + K.h, w: b - a, h: hall.y - (K.y + K.h) }));
    if (hall.y + hall.h <= K.y + E) push('north', ox0, ox1, (a, b) => ({ x: a, y: hall.y + hall.h, w: b - a, h: K.y - (hall.y + hall.h) }));
  }
  const ok = cands
    .map(c => ({ side: c.side, rect: { x: r2(c.rect.x), y: r2(c.rect.y), w: r2(c.rect.w), h: r2(c.rect.h) } }))
    .filter(c => Math.min(c.rect.w, c.rect.h) >= STAIR_CONNECTOR_MIN_W - 1e-6 && inside(c.rect) && !spaces.some(s => rectsOverlap(s.rect, c.rect)));
  ok.sort((a, b) =>
    ((a.side === entrySide ? 0 : 1) - (b.side === entrySide ? 0 : 1)) ||
    (a.rect.w * a.rect.h - b.rect.w * b.rect.h) ||
    (SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)) ||
    (a.rect.x - b.rect.x) || (a.rect.y - b.rect.y));
  return ok[0] ?? null;
}

/**
 * Phase 5.4D — pure geometric search for a thin-gap stair bridge.
 *
 * Returns null when the hall already shares ≥ CORRIDOR_MIN_WIDTH of wall with a
 * corridor. Otherwise, for every corridor lying wholly beyond one side of the hall,
 * the strip between them (gap depth d, cross span = the hall/corridor overlap) is a
 * candidate when 0 < d < CORRIDOR_MIN_WIDTH (a gap 5.4B cannot fill without a sliver),
 * the span is ≥ CORRIDOR_MIN_WIDTH, and the strip is inside the buildable geometry
 * and overlaps no space. The bridge covers the strip plus the corridor's full depth
 * over the span; the corridor outside the span is kept as remainder pieces
 * (zero-length pieces dropped). Every resulting piece must have its short side
 * ≥ CORRIDOR_MIN_WIDTH, or the candidate is rejected. Hall, stair and rooms never
 * move. Ordering is deterministic: smallest gap, then smallest bridge area, then
 * side order N/E/S/W, then x, then y.
 */
export function findThinStairGapBridge(
  hall: Rect,
  spaces: readonly { type: string; rect: Rect }[],
  inside: (r: Rect) => boolean,
): { corridorIndex: number; side: Side; gap: number; bridge: Rect; remainders: Rect[] } | null {
  const MIN = CORRIDOR_MIN_WIDTH;
  const E = 1e-6;
  const corridors = spaces.map((s, i) => ({ s, i })).filter(x => x.s.type === 'corridor');
  if (corridors.some(k => sharedEdge(hall, k.s.rect) >= MIN - E)) return null;
  const out: { corridorIndex: number; side: Side; gap: number; bridge: Rect; remainders: Rect[] }[] = [];
  for (const { s: k, i } of corridors) {
    const K = k.rect;
    const oy0 = Math.max(hall.y, K.y), oy1 = Math.min(hall.y + hall.h, K.y + K.h);
    const ox0 = Math.max(hall.x, K.x), ox1 = Math.min(hall.x + hall.w, K.x + K.w);
    const tries: { side: Side; d: number; lo: number; hi: number; gap: Rect; bridge: Rect; rem: Rect[] }[] = [];
    if (K.x + K.w <= hall.x + E) {
      const d = hall.x - (K.x + K.w);
      tries.push({ side: 'west', d, lo: oy0, hi: oy1,
        gap: { x: K.x + K.w, y: oy0, w: d, h: oy1 - oy0 },
        bridge: { x: K.x, y: oy0, w: K.w + d, h: oy1 - oy0 },
        rem: [{ x: K.x, y: K.y, w: K.w, h: oy0 - K.y }, { x: K.x, y: oy1, w: K.w, h: K.y + K.h - oy1 }] });
    }
    if (hall.x + hall.w <= K.x + E) {
      const d = K.x - (hall.x + hall.w);
      tries.push({ side: 'east', d, lo: oy0, hi: oy1,
        gap: { x: hall.x + hall.w, y: oy0, w: d, h: oy1 - oy0 },
        bridge: { x: hall.x + hall.w, y: oy0, w: d + K.w, h: oy1 - oy0 },
        rem: [{ x: K.x, y: K.y, w: K.w, h: oy0 - K.y }, { x: K.x, y: oy1, w: K.w, h: K.y + K.h - oy1 }] });
    }
    if (K.y + K.h <= hall.y + E) {
      const d = hall.y - (K.y + K.h);
      tries.push({ side: 'south', d, lo: ox0, hi: ox1,
        gap: { x: ox0, y: K.y + K.h, w: ox1 - ox0, h: d },
        bridge: { x: ox0, y: K.y, w: ox1 - ox0, h: K.h + d },
        rem: [{ x: K.x, y: K.y, w: ox0 - K.x, h: K.h }, { x: ox1, y: K.y, w: K.x + K.w - ox1, h: K.h }] });
    }
    if (hall.y + hall.h <= K.y + E) {
      const d = K.y - (hall.y + hall.h);
      tries.push({ side: 'north', d, lo: ox0, hi: ox1,
        gap: { x: ox0, y: hall.y + hall.h, w: ox1 - ox0, h: d },
        bridge: { x: ox0, y: hall.y + hall.h, w: ox1 - ox0, h: d + K.h },
        rem: [{ x: K.x, y: K.y, w: ox0 - K.x, h: K.h }, { x: ox1, y: K.y, w: K.x + K.w - ox1, h: K.h }] });
    }
    for (const t of tries) {
      if (!(t.d > E && t.d < MIN - E)) continue;
      if (t.hi - t.lo < MIN - E) continue;
      if (!inside(t.gap) || !inside(t.bridge)) continue;
      if (spaces.some((o, j) => j !== i && rectsOverlap(o.rect, t.gap))) continue;
      if (spaces.some((o, j) => j !== i && rectsOverlap(o.rect, t.bridge))) continue;
      if (Math.min(t.bridge.w, t.bridge.h) < MIN - E) continue;
      const rem = t.rem.filter(r => Math.min(r.w, r.h) > E);
      if (rem.some(r => Math.min(r.w, r.h) < MIN - E)) continue;
      out.push({ corridorIndex: i, side: t.side, gap: t.d, bridge: t.bridge, remainders: rem });
    }
  }
  out.sort((a, b) =>
    (a.gap - b.gap) ||
    (a.bridge.w * a.bridge.h - b.bridge.w * b.bridge.h) ||
    (SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)) ||
    (a.bridge.x - b.bridge.x) || (a.bridge.y - b.bridge.y));
  return out[0] ?? null;
}

/** Circulation a room's primary door may open onto (openings.ts circTypes minus the elevator hall, which its LIFT_LANDING rule bars to rooms). */
const ROOM_ACCESS_CIRC = new Set(['corridor', 'foyer', 'entrance', 'stair-hall']);
/** Spaces that never need an access connector: circulation itself and exterior spaces (openings.ts needsDoor). */
const ROOM_ACCESS_EXEMPT = new Set(['corridor', 'foyer', 'entrance', 'stair-hall', 'elevator-hall', 'parking', 'yard', 'balcony']);
/** openings.ts WET set — these rooms take DOOR_BATH_WIDTH doors. */
const ROOM_ACCESS_WET = new Set(['bathroom', 'master-bathroom', 'guest-wc']);
/** openings.ts bestFreeWall minimum jamb margin (each side) on a short shared wall. */
const DOOR_MIN_JAMB = 0.02;

/**
 * Phase 5.4E — pure search for isolated-room access connectors.
 *
 * A room (any space except circulation / parking / yard / balcony) is isolated when
 * no corridor / foyer / entrance / stair-hall shares a wall with it at least as long
 * as its door needs (openings.ts: DOOR_BATH_WIDTH for wet rooms, else DOOR_INT_WIDTH,
 * plus the placer's minimum jamb margins). Exempt: a master-bathroom served by an
 * adjoining master-bedroom (en-suite), and storage / utility served by an adjoining
 * kitchen — the door placer's own non-circulation primary-access cases.
 *
 * Rooms are processed in id order. For each isolated room the unchanged 5.4B search
 * (findStairCoreConnector, room as source, every access-circulation space and every
 * connector already accepted as target) returns the smallest clean empty gap; the
 * result is kept only when its short side ≥ CORRIDOR_MIN_WIDTH, it lies on the 1 cm
 * grid and overlaps nothing. Accepted connectors become obstacles AND targets for the
 * rooms that follow. Pure and deterministic; spaces never move.
 */
export function findRoomAccessConnectors(
  spaces: readonly { id: string; type: string; rect: Rect }[],
  inside: (r: Rect) => boolean,
): { roomId: string; side: Side; rect: Rect }[] {
  const fits = (a: Rect, b: Rect, width: number) => sharedEdge(a, b) >= width + 2 * DOOR_MIN_JAMB - 1e-6;
  const onGrid = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  const work: { type: string; rect: Rect }[] = spaces.map(s => ({ type: s.type, rect: s.rect }));
  const out: { roomId: string; side: Side; rect: Rect }[] = [];
  const rooms = spaces.filter(s => !ROOM_ACCESS_EXEMPT.has(s.type))
    .slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const room of rooms) {
    const width = ROOM_ACCESS_WET.has(room.type) ? DOOR_BATH_WIDTH : DOOR_INT_WIDTH;
    if (work.some(s => ROOM_ACCESS_CIRC.has(s.type) && fits(room.rect, s.rect, width))) continue;
    if (room.type === 'master-bathroom' && work.some(s => s.type === 'master-bedroom' && fits(room.rect, s.rect, width))) continue;
    if ((room.type === 'storage' || room.type === 'utility') && work.some(s => s.type === 'kitchen' && fits(room.rect, s.rect, width))) continue;
    const view = work.filter(s => s.rect !== room.rect)
      .map(s => ({ type: ROOM_ACCESS_CIRC.has(s.type) ? 'corridor' : s.type, rect: s.rect }));
    const conn = findStairCoreConnector(room.rect, view, inside, null);
    if (!conn) continue;
    const r = conn.rect;
    if (Math.min(r.w, r.h) < CORRIDOR_MIN_WIDTH - 1e-6) continue;
    if (![r.x, r.y, r.w, r.h].every(onGrid)) continue;
    if (work.some(s => rectsOverlap(s.rect, r))) continue;
    out.push({ roomId: room.id, side: conn.side, rect: r });
    work.push({ type: 'corridor', rect: r });
  }
  return out;
}

/**
 * Phase 5.4E validated adoption. The isolated-room connector variant replaces the
 * base candidate only when, under the full validator, it:
 *   - keeps validity (never valid → invalid),
 *   - introduces no HARD finding code absent from the base,
 *   - has strictly fewer circulation HARD findings (^CIRC codes + CONSTRAINT_DIRECT_ACCESS),
 *   - does not increase the total HARD count,
 *   - keeps every base space unchanged (same type, rect and area — rooms, halls,
 *     stair and corridors never move) and adds only corridor connectors whose short
 *     side is ≥ CORRIDOR_MIN_WIDTH and which overlap no other space.
 * Otherwise the base candidate is returned untouched. Deterministic.
 */
export function adoptRoomAccessConnectorVariant(base: LayoutCandidate, variant: LayoutCandidate): LayoutCandidate {
  if (JSON.stringify(variant.floors) === JSON.stringify(base.floors)) return base;
  if (base.valid && !variant.valid) return base;
  const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');
  const hb = hard(base), hv = hard(variant);
  const baseCodes = new Set(hb.map(f => f.code));
  if (hv.some(f => !baseCodes.has(f.code))) return base;
  const circ = (fs: Finding[]) => fs.filter(f => /^CIRC/.test(f.code) || f.code === 'CONSTRAINT_DIRECT_ACCESS').length;
  const cb = circ(hb), cv = circ(hv);
  if (!(cv < cb)) return base;
  if (hv.length > hb.length) return base;
  if (variant.floors.length !== base.floors.length) return base;
  let added = 0;
  for (let i = 0; i < base.floors.length; i++) {
    const key = (s: Space) => `${s.type}|${s.rect.x}|${s.rect.y}|${s.rect.w}|${s.rect.h}|${s.area}`;
    const pool = new Map<string, number>();
    for (const s of variant.floors[i].spaces) pool.set(key(s), (pool.get(key(s)) ?? 0) + 1);
    for (const s of base.floors[i].spaces) {
      const k = key(s), m = pool.get(k) ?? 0;
      if (m <= 0) return base;
      pool.set(k, m - 1);
    }
    const baseKeys = new Map<string, number>();
    for (const s of base.floors[i].spaces) baseKeys.set(key(s), (baseKeys.get(key(s)) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const s of variant.floors[i].spaces) {
      const k = key(s), c = (seen.get(k) ?? 0) + 1;
      seen.set(k, c);
      if (c <= (baseKeys.get(k) ?? 0)) continue;
      if (s.type !== 'corridor' || Math.min(s.rect.w, s.rect.h) < CORRIDOR_MIN_WIDTH - 1e-6) return base;
      if (variant.floors[i].spaces.some(o => o !== s && rectsOverlap(o.rect, s.rect))) return base;
      added++;
    }
  }
  if (added === 0) return base;
  variant.explanations.push(`Phase 5.4E: isolated-room connector variant adopted (${added} connector(s); circulation HARD ${cb}→${cv}, HARD ${hb.length}→${hv.length}) — validator confirmed no lost validity, no new HARD code, no moved space, no overlap.`);
  return variant;
}

function buildFloorSiteAware(
  input: ProjectInput,
  buildableGeom: ReturnType<typeof computeBuildableGeometry>,
  bfp: ReturnType<typeof computeBuildableArea>,
  level: number,
  isOnlyFloor: boolean,
  strategy: CandidateStrategy,
  explanations: string[],
  alloc: FloorProgramAllocation,
  coreAnchors: Map<'stair-hall' | 'elevator-hall', CoreAnchor>,
  programmeDoorCompletion = false,
  preferDiningKitchenAdjacency = false,
  preferLShapeProgrammeAdjacency = false,
  galleryDaylightAware = false,
  connectStairCore = false,
  stackPublicForDaylight = false,
  bridgeThinStairGap = false,
  connectIsolatedRooms = false,
  diningFacadeRow = false,
): Floor {
  let spaceCounter = 0;
  const nextId = (type: string) => `${type}-${level}-${(spaceCounter++).toString(36).padStart(3, '0')}`;

  const siteRect: Rect = buildableGeom.siteBoundingRect;
  const buildableRect: Rect = buildableGeom.buildableRect;
  // P16-A: the rect fed to room slicing; shrinks when a parking band is
  // reserved. floor.footprint keeps the original envelope (reconciliation
  // semantics unchanged).
  let sliceRect: Rect = buildableGeom.buildableRect;
  const buildableBoundary = buildableGeom.buildableBoundary;
  const siteBoundary = buildableGeom.siteBoundary;
  let buildableRects = buildableGeom.buildableRects;

  let parkingStalls: any[] = [];
  let parkingArea: any;
  // P16-A: parking is placed AFTER all space modifications (below), against
  // the actual placed footprint — never as an aisle-only placeholder.
  const parkingRequestedLevel0 = level === 0 ? (input.building.parkingSpaces ?? 0) : 0;

  const specs = programForFloor(input.building, level, isOnlyFloor, alloc);
  const placedSpecs: PlacedSpec[] = [];
  let bedIdx = 0, bathIdx = 0, mbCount = 0, mbaCount = 0;
  for (const s of specs) {
    let label: string;
    switch (s.type) {
      case 'bedroom': label = labelFor(s.type, bedIdx); bedIdx++; break;
      case 'bathroom': label = labelFor(s.type, bathIdx); bathIdx++; break;
      case 'master-bedroom': label = labelFor(s.type, mbCount); mbCount++; break;
      case 'master-bathroom': label = labelFor(s.type, mbaCount); mbaCount++; break;
      default: label = labelFor(s.type);
    }
    placedSpecs.push({ ...s, placedId: nextId(s.type), placedLabel: label });
  }

  // Phase 15 M3: the exact per-floor program assigned by the building-level
  // distribution — carried on the candidate for honest program-completeness validation
  // (requested rooms must never be silently dropped by placement).
  const assignedProgram: Record<string, number> = {};
  for (const s of placedSpecs) assignedProgram[s.type] = (assignedProgram[s.type] ?? 0) + 1;

  const mkSpace = (type: Space['type'], r: Rect, label: string, id: string, zone: string): Space => {
    // Phase 11 canonical: polygon is authoritative, rect is derived bounding compatibility
    const poly = createRectangleRoomPolygon(r);
    const area = polygonArea(poly);
    const daylight = ['living', 'dining', 'bedroom', 'master-bedroom', 'guest-room', 'family-room', 'kitchen'].includes(type);
    // Find spec for constraints
    const spec = specs.find(sp => sp.type === type);
    const constraints = spec ? {
      minArea: spec.minArea,
      targetArea: spec.targetArea,
      maxArea: spec.maxArea,
      minWidth: spec.minWidth,
      minLength: spec.minLength,
      preferredAspectRatio: spec.preferredAspectRatio,
    } : undefined;
    return {
      id, type, label,
      privacy: privacyOf(type),
      zone: zone as Space['zone'],
      orientation: orientationOf(type),
      daylightRequired: daylight,
      polygon: poly, // canonical
      rect: r, // derived bounding compatibility
      area, // derived from polygon
      targetArea: spec?.targetArea ?? rArea(r),
      minArea: spec?.minArea ?? 0,
      maxArea: spec?.maxArea,
      minWidth: spec?.minWidth,
      minLength: spec?.minLength,
      preferredAspectRatio: spec?.preferredAspectRatio,
      shapeType: 'rectangle',
      constraints,
      locked: {},
      wallIds: [], openingIds: [], adjacentSpaceIds: [],
      hasExteriorWall: false,
      floor: level,
    };
  };

  const access = input.site.accessSide as 'north'|'south'|'east'|'west';

  // ---------- Phase 16 P16-A: parking band reservation (guarded) ----------
  // Reserve the access-side band (aisle + stall depth) BEFORE room slicing so
  // the building never grows into the stalls' space — but only when the
  // remaining envelope can still host the program's minimum areas (72%
  // headroom rule). Otherwise the reservation is refused: the floor keeps its
  // sane diagnostic geometry and parking surfaces honestly as
  // PARKING_PROGRAM_UNPLACED instead of crushing rooms into slivers.
  if ((input.building.parkingSpaces ?? 0) > 0) {
    const reserve = reserveParkingBand(
      siteRect, buildableGeom.buildableRects, input.site.accessSide,
      (input.site.parkingLayout ?? 'auto') as any,
      (input.building.parkingSpaces ?? 0),
    );
    if (reserve) {
      const remainingArea = reserve.rects.reduce((a, r) => a + r.w * r.h, 0);
      const minDemand = placedSpecs.reduce((a, s) => a + ((s as any).minArea ?? 6), 0);
      // P45-note: relaxing this gate to `minDemand > remainingArea` REGRESSED the
      // suite (15 failures): it reserved the full 6 m aisle+stall band on mid-size
      // sites, leaving a 72 m² remainder the placer cannot pack, turning
      // rooms-valid plans into HARD_CONSTRAINT_INFEASIBLE_DIMENSION. The genuine
      // root cause is that `reserveParkingBand` keeps the AISLE fully inside the
      // buildable even when the south setback/street could serve it; that is a
      // parking-geometry fix outside this scope, so the conservative headroom gate
      // is retained.
      if (minDemand > 0.72 * remainingArea) {
        explanations.push(`Parking band reservation REJECTED for level ${level}: program minimums need ${minDemand.toFixed(0)} m², the reduced envelope offers ${remainingArea.toFixed(0)} m² — parking will be reported as unplaced (no sliver buildings for parking).`);
      } else {
        buildableRects = reserve.rects;
        const rx0 = Math.min(...reserve.rects.map(r => r.x));
        const ry0 = Math.min(...reserve.rects.map(r => r.y));
        const rx1 = Math.max(...reserve.rects.map(r => r.x + r.w));
        const ry1 = Math.max(...reserve.rects.map(r => r.y + r.h));
        sliceRect = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
        explanations.push(`Parking band reserved along the ${input.site.accessSide} edge (${reserve.band.h.toFixed(1)}x${reserve.band.w.toFixed(1)}m, ${reserve.layout}) — building slices the remaining envelope.`);
      }
    } else {
      explanations.push(`Parking band could not be reserved without starving the building — parking will be reported INFEASIBLE if no free band fits later.`);
    }
  }

  let placedRooms: Space[] = [];
  let corridors: Space[] = [];
  let placeExpl: string[] = [];
  // True when the floor was laid out by the multi-rect / L-wing planners, which
  // cannot carry the fixed shaft cell (see the elevator stage below).
  let multiRectPlan = false;

  if (buildableRects.length === 0) {
    explanations.push(`Decomposition failure for ${buildableBoundary.length}-vertex buildable polygon — cannot decompose safely into rectangles (bounded failure, no bbox fallback as canonical). Candidate will be marked SITE_GEOM_INVALID HARD.`);
    const result = placeSpaces(sliceRect, placedSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation.map(e => `[DECOMPOSITION-FAILURE-FALLBACK bounding] ${e}`);
  } else if (buildableRects.length === 1 || input.site.shape === 'rectangle') {
    const placerOpts = {
      ...(preferDiningKitchenAdjacency ? { preferDiningKitchenAdjacency: true } : {}),
      ...(galleryDaylightAware ? { galleryDaylightAware: true } : {}),
      ...(stackPublicForDaylight ? { stackPublicForDaylight: true } : {}),
      ...(galleryDaylightAware && diningFacadeRow ? { diningFacadeRow: true } : {}),
    };
    const result = Object.keys(placerOpts).length > 0
      ? placeSpaces(sliceRect, placedSpecs, strategy, access, mkSpace, placerOpts)
      : placeSpaces(sliceRect, placedSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation;
  } else {
    // Phase 25: dedicated two-rectangle L-shape wing path. Rectangular sites
    // never reach this branch (guarded above); other polygons keep the
    // generic M6 planner exactly as before.
    // Elevator shaft (task-27 bounded scope): the shaft is reserved only by the
    // single-rectangle band zoning beside the stair pocket. The multi-rect / L-shape
    // planners would re-frame (rotate) that pocket per region, so the elevator
    // spec is withheld here and ELEV_SHAFT_MISSING reports it deterministically —
    // never placed generically, never dropped silently. No-lift input is unchanged.
    multiRectPlan = true;
    const multiSpecs = placedSpecs.some(sp => sp.type === 'elevator-hall')
      ? placedSpecs.filter(sp => sp.type !== 'elevator-hall')
      : placedSpecs;
    const lres = input.site.shape === 'l-shape' && buildableRects.length === 2
      ? (preferLShapeProgrammeAdjacency
        ? placeSpacesLShape(buildableRects, buildableBoundary, multiSpecs, strategy, access, mkSpace, { preferProgrammeAdjacency: true })
        : placeSpacesLShape(buildableRects, buildableBoundary, multiSpecs, strategy, access, mkSpace))
      : null;
    const result = lres ?? placeSpacesAcrossRects(buildableRects, buildableBoundary, multiSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation;
  }
  explanations.push(...placeExpl);

  const spaces: Space[] = [];
  let entrancePlaced = placedRooms.some(r => r.type === 'entrance');
  spaces.push(...placedRooms);
  // v1.0.1 (AGX-06): corridor ids must be globally unique across floors —
  // the placer numbers them per floor only ('corridor-0' on every level),
  // which collides in the candidate JSON and any id-keyed consumer.
  for (const [ci, corr] of corridors.entries()) corr.id = `corridor-${level}-${ci}`;
  spaces.push(...corridors);

  // P16-A: repair/snapping/entrance-recovery use sliceRect — with a reserved
  // parking band the building's front line is sliceRect.y, not the envelope.
  const repaired = repairSpacesToBuildable(spaces, buildableBoundary, buildableRects, sliceRect);
  const movedCount = repaired.movedCount;
  if (movedCount > 0) explanations.push(`Site-aware repair: ${movedCount} room(s) moved to fit inside buildable polygon ${input.site.shape} — buildableArea ${buildableGeom.buildableArea.toFixed(1)} m²`);

  // P46: trim the spine's unserved tail BEFORE snapping/welding, so the trimmed
  // corridor is welded against the rooms it serves and the P17-C envelope
  // compaction sees the honest extent. Runs ahead of wall/opening derivation.
  const corridorTrim = trimCorridorsToServedExtent(repaired.spaces);
  if (corridorTrim.length > 0) explanations.push(...corridorTrim);

  // The elevator shaft is a rigid cell: keep it OUT of the corridor weld /
  // welded-grid clustering so its edges can never shift the canonical weld
  // coordinates of rooms, corridors or the stair hall (shaft-free plans pass
  // the identical array). The shaft is made flush with its landing below.
  snapCorridorsToRoomsSiteAware(
    repaired.spaces.some(s => s.type === 'elevator-hall') ? repaired.spaces.filter(s => s.type !== 'elevator-hall') : repaired.spaces,
    buildableBoundary, sliceRect, buildableRects,
  );
  // The weld pass is also where every space's polygon is rebuilt from its rect
  // (placement frames map only rects back for north/east/west access). The
  // shaft skipped it, so rebuild its polygon the same way — walls and doors are
  // generated from polygons and must sit on the shaft's actual rect.
  for (const sp of repaired.spaces) {
    if (sp.type !== 'elevator-hall') continue;
    sp.polygon = createRectangleRoomPolygon(sp.rect);
    sp.area = polygonArea(sp.polygon);
  }

  // Phase 15 M3: entrance recovery is a GROUND-floor program repair. A floor whose
  // allocation contains no entrance spec must never synthesize one — upper floors get
  // their arrival from the stair/core, not a fabricated front door (pre-M3 this produced
  // "phantom upper-floor entrances" on multi-floor plans).
  const floorHasEntranceSpec = placedSpecs.some(s => s.type === 'entrance');
  // P16-B: recovery is access-aware — the "front" is the real street edge of
  // sliceRect, not min-y; the vestibule strip is carved against that edge.
  const accessEdge = input.site.accessSide;
  const touchesFront = (r: Rect): boolean =>
    accessEdge === 'south' ? r.y <= sliceRect.y + EPS
    : accessEdge === 'north' ? r.y + r.h >= sliceRect.y + sliceRect.h - EPS
    : accessEdge === 'west' ? r.x <= sliceRect.x + EPS
    : r.x + r.w >= sliceRect.x + sliceRect.w - EPS;
  const carveVestibule = (host: { rect: Rect; polygon?: any; area?: number }, depth: number): { entr: Rect; rest: Rect } | null => {
    const r = host.rect;
    if (accessEdge === 'west' || accessEdge === 'east') {
      const d = Math.min(depth, r.w);
      if (r.w <= d + 0.9) return null;
      const x = accessEdge === 'west' ? r.x : r.x + r.w - d;
      return { entr: { x, y: r.y, w: d, h: r.h }, rest: accessEdge === 'west' ? { x: r.x + d, y: r.y, w: r.w - d, h: r.h } : { x: r.x, y: r.y, w: r.w - d, h: r.h } };
    }
    const d = Math.min(depth, r.h);
    if (r.h <= d + 0.9) return null;
    const y = accessEdge === 'north' ? r.y + r.h - d : r.y;
    return { entr: { x: r.x, y, w: Math.min(1.8, r.w), h: d }, rest: accessEdge === 'north' ? { x: r.x, y: r.y, w: r.w, h: r.h - d } : { x: r.x, y: r.y + d, w: r.w, h: r.h - d } };
  };
  if (!entrancePlaced && floorHasEntranceSpec) {
    const foyer = repaired.spaces.find(s => (s.type === 'foyer' || s.type === 'corridor') && touchesFront(s.rect));
    if (foyer) {
      const cut = carveVestibule(foyer, 1.5);
      if (cut && rectInsidePolygon(cut.entr, buildableBoundary, 1e-3)) {
        const entrId = nextId('entrance');
        repaired.spaces.push(mkSpace('entrance', cut.entr, 'Entrance', entrId, 'public'));
        foyer.rect = cut.rest;
        foyer.polygon = createRectangleRoomPolygon(cut.rest);
        foyer.area = polygonArea(foyer.polygon);
        entrancePlaced = true;
        explanations.push(`Entrance vestibule carved from corridor/foyer on the ${accessEdge} facade — site-aware.`);
      }
    }
  }
  if (!entrancePlaced && floorHasEntranceSpec) {
    const pub = repaired.spaces.find(s => (s.zone === 'public' || s.type === 'living') && touchesFront(s.rect))
      ?? repaired.spaces.find(s => s.zone === 'public' || s.type === 'living');
    if (pub) {
      const cut = carveVestibule(pub, 1.5);
      if (cut && rectInsidePolygon(cut.entr, buildableBoundary, 1e-3)) {
        const entrId = nextId('entrance');
        repaired.spaces.push(mkSpace('entrance', cut.entr, 'Entrance', entrId, 'public'));
        pub.rect = cut.rest;
        pub.polygon = createRectangleRoomPolygon(cut.rest);
        pub.area = polygonArea(pub.polygon);
        entrancePlaced = true;
      }
    }
  }

  const finalSpaces = repaired.spaces;

  let stairSpace = finalSpaces.find(s => s.type === 'stair-hall') || null;
  // v1.0.1 (AGX-05): a stair-hall must live INSIDE the buildable boundary.
  // Repair an out-of-bounds hall when an in-bounds position exists; otherwise
  // remove the phantom space entirely — the STAIR_MISSING validation finding
  // then flags the missing vertical circulation deterministically, so a failed
  // stair placement can never silently disappear or leak outside the property.
  if (stairSpace && needStairForFloor(input, level) && !rectInsidePolygon(stairSpace.rect, buildableBoundary, 1e-3)) {
    const repairedStairRect = findPositionForRect(
      stairSpace.rect, buildableBoundary, buildableRects,
      finalSpaces.filter(s => s.type !== 'stair-hall').map(s => s.rect),
    );
    if (repairedStairRect) {
      stairSpace.rect = repairedStairRect;
      stairSpace.polygon = createRectangleRoomPolygon(repairedStairRect);
      stairSpace.area = polygonArea(stairSpace.polygon);
      explanations.push(`Stair hall outside buildable polygon — repaired for level ${level}.`);
    } else {
      explanations.push(`Stair hall outside buildable polygon and no in-bounds position found — stair-hall removed for level ${level}; expect STAIR_MISSING HARD finding (no vertical circulation on this floor).`);
      finalSpaces.splice(finalSpaces.indexOf(stairSpace), 1);
      stairSpace = null;
    }
  }
  // ---------- Phase 15 M7: cross-floor vertical-core coherence ----------
  // Level 0 establishes a building-level anchor for each required core hall
  // (stair-hall, and elevator-hall when the program requires one). Upper floors
  // must place their hall on the SAME rect so the vertical core stacks. The
  // relocation pass that frees an occupied anchor cell is BOUNDED (≤2
  // blockers) and deterministic; when coherence cannot be preserved the
  // engine records it and lets the stair validator flag the floor honestly —
  // coherence is never faked by snapping footprints together.
  const rePinHall = (sp: Space, r: Rect) => {
    sp.rect = { ...r };
    sp.polygon = createRectangleRoomPolygon(sp.rect);
    sp.area = polygonArea(sp.polygon);
  };
  const alignHallToAnchor = (
    hallType: 'stair-hall' | 'elevator-hall',
    getHall: () => Space | null,
    setHallMissing: (r: Rect) => boolean,
  ): Space | null => {
    const anchor = coreAnchors.get(hallType);
    let hall = getHall();
    if (!anchor || level <= anchor.originLevel) return hall;
    const other = finalSpaces.filter(s => s.type !== hallType);
    const insp = inspectAnchorPlacement(anchor, hall, other);
    explanations.push(...insp.explanation.map(m => `Level ${level}: ${m}`));
    if (insp.aligned) return hall;
    // Elevator shaft only: never relocate CIRCULATION to free the anchor — moving
    // a corridor/foyer/entrance/stair hall would redesign circulation. The floor
    // then keeps no shaft and ELEV_SHAFT_MISSING reports it. (Stair behaviour
    // is unchanged.)
    if (hallType === 'elevator-hall'
      && insp.blockers.some(b => b.type === 'corridor' || b.type === 'foyer' || b.type === 'entrance' || b.type === 'stair-hall')) {
      explanations.push(`Level ${level}: elevator anchor cell is occupied by circulation (${insp.blockers.map(b => b.type).join(', ')}) — circulation is never relocated for the shaft; ELEV_SHAFT_MISSING flags this floor.`);
      return hall;
    }
    if (insp.blockers.length <= 2) {
      let freed = true;
      for (const blk of insp.blockers) {
        const moved = findPositionForRect(
          blk.rect, buildableBoundary, buildableRects,
          finalSpaces.filter(s => s !== blk && s.type !== hallType).map(s => s.rect),
        );
        if (!moved || !rectInsidePolygon(moved, buildableBoundary, 1e-3)) { freed = false; break; }
        blk.rect = moved;
        blk.polygon = createRectangleRoomPolygon(moved);
        blk.area = polygonArea(blk.polygon);
      }
      if (freed) {
        if (hall) {
          rePinHall(hall, anchor.rect);
          explanations.push(`Level ${level}: ${hallType} pinned to the ${anchor.originLevel}-floor core anchor for vertical coherence.`);
        } else if (setHallMissing(anchor.rect)) {
          hall = getHall();
          explanations.push(`Level ${level}: ${hallType} re-created on the core anchor (placement had dropped it).`);
        }
      } else {
        explanations.push(`Level ${level}: core anchor cell could not be freed within the bounded relocation pass — keeping this floor's placement; the stair validator will judge coherence honestly.`);
      }
    }
    return hall;
  };
  stairSpace = alignHallToAnchor(
    'stair-hall',
    () => finalSpaces.find(s => s.type === 'stair-hall') ?? null,
    (r) => {
      if (!needStairForFloor(input, level)) return false;
      const created = mkSpace('stair-hall', r, 'Stair Hall', nextId('stair-hall'), 'service');
      finalSpaces.push(created);
      return true;
    },
  );
  // Elevator shaft (elevator-hall = the shaft cell the placer reserved beside the
  // stair core). Requested only on 2+ floor buildings. Level 0 fixes the building
  // anchor; upper floors reuse the SAME rect through the same bounded relocation
  // pass as the stair hall, and a dropped cell is re-created on the anchor. When
  // coherence cannot be achieved the validator says so (ELEV_SHAFT_MISSING /
  // ELEV_SHAFT_MISALIGNED) — the elevator is never dropped silently.
  const elevatorRequested = !!input.building.hasElevator && !isOnlyFloor;
  // Multi-rect / L-wing plans: the planners could not carry the fixed cell, so
  // on the origin floor look for the exact cell in FREE space beside the stair
  // hall with an exact landing edge, inside the buildable polygon and the
  // building slice. No room is moved or shrunk; upper floors reuse the anchor
  // below. No such cell → nothing is invented and ELEV_SHAFT_MISSING reports it.
  if (elevatorRequested && level === 0 && multiRectPlan && stairSpace
    && !finalSpaces.some(s => s.type === 'elevator-hall')) {
    const found = findCoreAdjacentShaftCell({
      stairHall: stairSpace.rect,
      spaces: finalSpaces,
      inside: (r) => rectInsidePolygon(r, buildableBoundary, 1e-3)
        && r.x >= sliceRect.x - 1e-6 && r.y >= sliceRect.y - 1e-6
        && r.x + r.w <= sliceRect.x + sliceRect.w + 1e-6 && r.y + r.h <= sliceRect.y + sliceRect.h + 1e-6,
    });
    if (found) {
      finalSpaces.push(mkSpace('elevator-hall', found.rect, labelFor('elevator-hall'), nextId('elevator-hall'), 'service'));
      explanations.push(`Level 0: multi-rectangle plan — elevator shaft cell placed in free space beside the stair hall at (${found.rect.x.toFixed(2)},${found.rect.y.toFixed(2)}), landing on its ${found.side} side (no room moved).`);
    } else {
      explanations.push(`Level 0: multi-rectangle plan — no free cell beside the stair hall can host the shaft with an exact circulation landing inside the building.`);
    }
  }
  // The shaft is a RIGID cell: undo the cm nudges the generic room passes
  // (snapping / corridor welding) applied, keeping its landing edge flush.
  if (elevatorRequested) {
    const cell = finalSpaces.find(s => s.type === 'elevator-hall');
    if (cell) {
      const rigid = rigidShaftCell(cell.rect, finalSpaces);
      if (rigid !== cell.rect) rePinHall(cell, rigid);
    }
  }
  const elevatorHall = alignHallToAnchor(
    'elevator-hall',
    () => finalSpaces.find(s => s.type === 'elevator-hall') ?? null,
    (r) => {
      if (!elevatorRequested) return false;
      finalSpaces.push(mkSpace('elevator-hall', r, labelFor('elevator-hall'), nextId('elevator-hall'), 'service'));
      return true;
    },
  );
  // Exact vertical reuse: the anchor inspection tolerates cm noise, a shaft may
  // not — pin a near-match onto the anchor rect verbatim.
  {
    const anchor = coreAnchors.get('elevator-hall');
    if (elevatorRequested && anchor && elevatorHall && level > anchor.originLevel
      && sameRect(elevatorHall.rect, anchor.rect)
      && (elevatorHall.rect.x !== anchor.rect.x || elevatorHall.rect.y !== anchor.rect.y
        || elevatorHall.rect.w !== anchor.rect.w || elevatorHall.rect.h !== anchor.rect.h)) {
      rePinHall(elevatorHall, anchor.rect);
    }
  }
  if (elevatorRequested && level === 0 && !coreAnchors.has('elevator-hall')) {
    const landing = elevatorHall ? elevatorLandingSide(elevatorHall.rect, finalSpaces) : null;
    if (elevatorHall && landing && rectInsidePolygon(elevatorHall.rect, buildableBoundary, 1e-3)) {
      coreAnchors.set('elevator-hall', makeCoreAnchor('elevator-hall', elevatorHall.rect, landing.side, null, 0));
      explanations.push(`Vertical-core: elevator shaft cell ${elevatorHall.rect.w.toFixed(2)}×${elevatorHall.rect.h.toFixed(2)} m anchored at (${elevatorHall.rect.x.toFixed(2)},${elevatorHall.rect.y.toFixed(2)}), landing on its ${landing.side} side — reused on every upper floor (DESIGN-ASSUMPTION dimensions, no compliance claimed).`);
    } else {
      explanations.push(`Level 0: elevator shaft ${elevatorHall ? 'cell has no usable landing edge or leaves the buildable area' : 'cell could not be reserved by placement'} — no shaft anchor; ELEV_SHAFT_MISSING will flag this candidate.`);
    }
  }

  // Phase 5.4B (opt-in): join an isolated upper-floor stair hall to the corridor
  // network through the smallest clean empty gap. Never moves the anchor or any
  // existing space; no clean gap → geometry unchanged.
  if (connectStairCore && level > 0 && stairSpace) {
    const entrySide = coreAnchors.get('stair-hall')?.corridorSide ?? null;
    const conn = findStairCoreConnector(stairSpace.rect, finalSpaces, (r) => rectInsidePolygon(r, buildableBoundary, 1e-3), entrySide);
    if (conn) {
      finalSpaces.push(mkSpace('corridor', conn.rect, 'Stair connector', nextId('corridor'), 'circulation'));
      explanations.push(`Level ${level}: Phase 5.4B stair-core connector ${conn.rect.w.toFixed(2)}×${conn.rect.h.toFixed(2)} m on the hall's ${conn.side} side joins the stair hall to the corridor network.`);
    }
  }

  // Phase 5.4D (opt-in): join an upper-floor stair hall left behind a thin empty gap
  // (< CORRIDOR_MIN_WIDTH) by re-pinning onto the core anchor. The facing corridor is
  // replaced by a bridge (gap + full corridor depth over the hall overlap) plus its
  // remainder pieces. Hall, stair, anchor and rooms never move; no valid bridge →
  // geometry unchanged.
  if (bridgeThinStairGap && level > 0 && stairSpace) {
    const br = findThinStairGapBridge(stairSpace.rect, finalSpaces, (r) => rectInsidePolygon(r, buildableBoundary, 1e-3));
    if (br) {
      const K = finalSpaces[br.corridorIndex];
      const piece = (r: Rect, id: string): Space => {
        const g = mkSpace('corridor', r, K.label, id, K.zone);
        return { ...K, id, rect: g.rect, polygon: g.polygon, area: g.area };
      };
      finalSpaces.splice(br.corridorIndex, 1, piece(br.bridge, K.id), ...br.remainders.map(r => piece(r, nextId('corridor'))));
      explanations.push(`Level ${level}: Phase 5.4D thin-gap stair bridge ${br.bridge.w.toFixed(2)}×${br.bridge.h.toFixed(2)} m on the hall's ${br.side} side closes a ${br.gap.toFixed(2)} m gap to the corridor (${br.remainders.length} remainder piece(s) kept).`);
    }
  }

  // Phase 5.4E (opt-in): join upper-floor rooms with no door-capable circulation wall
  // to the circulation through clean empty gaps (unchanged 5.4B search). Rooms, halls,
  // stair, anchor and corridors never move; no clean gap → geometry unchanged.
  if (connectIsolatedRooms && level > 0) {
    const conns = findRoomAccessConnectors(finalSpaces, (r) => rectInsidePolygon(r, buildableBoundary, 1e-3));
    for (const c of conns) {
      finalSpaces.push(mkSpace('corridor', c.rect, 'Room access connector', nextId('corridor'), 'circulation'));
      const room = finalSpaces.find(s => s.id === c.roomId);
      explanations.push(`Level ${level}: Phase 5.4E room-access connector ${c.rect.w.toFixed(2)}×${c.rect.h.toFixed(2)} m on the ${c.side} side of ${room?.label ?? c.roomId} joins it to the circulation.`);
    }
  }

  const stairRect = stairSpace ? stairSpace.rect : null;

  const walls: Wall[] = generateWalls(finalSpaces, level);

  // ---------- Phase 16 P16-A: real parking placement ----------
  // Runs after every space mutation (rescue/re-pin) so the obstacle set is
  // the ACTUAL building, and before floor assembly so findings gate it.
  // All-or-nothing: an unfillable request yields NO parking geometry and a
  // HARD PARKING_PROGRAM_UNPLACED finding (validator) — the plan then fails
  // the M2 gate instead of publishing misleading aisle-only drawings.
  const parkingRequested = parkingRequestedLevel0;
  if (parkingRequested > 0) {
    // Raw space rects: a stall touching the building edge (shared boundary)
    // is legal — only real overlaps (>0.02 m both axes) are rejected. Walls
    // nudge a few cm out of the room rect; that graphic adjacency is not a
    // collision.
    const obstacles = finalSpaces.map(s => s.rect);
    const p = placeParkingSiteAware({
      siteBoundary,
      siteRect,
      buildingRects: obstacles,
      access: input.site.accessSide,
      count: parkingRequested,
      floorLevel: level,
      layoutPref: (input.site.parkingLayout ?? 'auto') as any,
      // P16-A: stalls are permanent slabs — keep them inside the buildable
      // envelope; setbacks may only carry the drive aisle. Phase 25: on
      // L-shaped lots the envelope is clamped to the lot's front band so a
      // south-side notch can never host a stall (the notch is not part of the
      // site); other shapes and rear notches keep the original envelope.
      buildableRect: input.site.shape === 'l-shape' && input.site.lShape
        ? lAwareParkingEnvelope(input.site.lShape, buildableRect, access, buildableRect)
        : buildableRect,
    });
    if (p.fits) {
      parkingStalls = p.stalls;
      parkingArea = { aisleRect: p.aisle, arrangement: p.layout ?? ('perpendicular' as const) };
      explanations.push(`${p.stalls.length}/${parkingRequested} parking stall(s) placed (${p.layout}); aisle ${p.aisle.w.toFixed(1)}x${p.aisle.h.toFixed(1)}m with street access.`);
    } else {
      explanations.push(`Parking INFEASIBLE: could not place ${parkingRequested} valid stall(s) with real geometry anywhere on the site (${p.attempts?.slice(-1)[0] ?? 'no fitting band'}) — no parking geometry exported; PARKING_PROGRAM_UNPLACED flags this candidate.`);
    }
  }


  // ---------- Phase 15 M7: stair solving — real multi-flight geometry only ----------
  // The old path hardcoded a 'south' entry side and, on failure, painted a FAKE
  // single-flight stair (every riser in one flight — the Phase 3 defect shape).
  // Both are gone. The vertical-core engine searches orientations bounded by
  // measurable geometry (real circulation adjacency + plan slack), and an
  // unsolvable hall stays UNSOLVED: no stair is emitted, and the floor is judged
  // by STAIR_MISSING / the MBH4 pack — a deterministic, explained infeasibility.
  const stairs: Stair[] = [];
  if (stairSpace && needStairForFloor(input, level)) {
    const cfg = { ...DEFAULT_STAIR_CONFIG, floorHeight: DEFAULT_FLOOR_HEIGHT };
    const anchor = coreAnchors.get('stair-hall');
    let stair: Stair | null = null;
    let chosenSide: HallSide | null = null;
    if (anchor && anchor.stairType && level > anchor.originLevel && sameRect(stairSpace.rect, anchor.rect)) {
      // Coherent core: re-solve on the anchor's inputs (same hall rect, same
      // entry side, same config) — determinism makes the result identical to
      // the origin floor's stair: same type, flight split and well footprint.
      const sol = solveStair(stairSpace.rect, cfg, anchor.corridorSide, 'core-main', level);
      if (sol.ok && sol.stair) {
        stair = sol.stair;
        chosenSide = anchor.corridorSide;
        explanations.push(`Level ${level}: stair re-solved from core anchor (${stair.type}, ${stair.flights.map(f => f.riserCount).join('+')} risers) — stacks with floor ${anchor.originLevel}.`);
      } else {
        explanations.push(`Level ${level}: anchor re-solve failed although the origin floor solved — configuration drift, trying orientation search.`);
      }
    }
    if (!stair) {
      // The elevator shaft is not walkable circulation: it must never make a
      // stair entry side look "circulation-adjacent". Without a shaft this is
      // exactly the previous space list.
      const res = solveStairOrientations(stairSpace.rect, cfg, finalSpaces.filter(s => s.type !== 'elevator-hall'), 'core-main', level);
      stair = res.stair;
      chosenSide = res.side;
      explanations.push(...res.explanation.map(m => `Level ${level}: ${m}`));
    }
    if (stair) {
      if (!rectInsidePolygon(stair.footprint, buildableBoundary, 1e-3)) {
        explanations.push(`Stair footprint outside buildable — level ${level} — marking invalid`);
        stair.valid = false;
      }
      if (!coreAnchors.has('stair-hall') && level === 0) {
        coreAnchors.set('stair-hall', makeCoreAnchor('stair-hall', stairSpace.rect, chosenSide ?? 'south', stair, 0));
      } else if (anchor && !sameRect(stairSpace.rect, anchor.rect)) {
        explanations.push(`Level ${level}: stair hall sits off the core anchor — the stair validator will flag core misalignment (no fake coherence).`);
      }
      stairs.push(stair);
      explanations.push(...stair.explanation.map(m => `Stair: ${m}`));
    } else {
      explanations.push(`Level ${level}: NO_FEASIBLE_STAIR_CONFIGURATION — stair-hall ${stairSpace.rect.w.toFixed(2)}\u00d7${stairSpace.rect.h.toFixed(2)} m cannot host a code-compliant multi-flight stair in any orientation. No stair is emitted (never a fake single-flight rectangle); the candidate fails via STAIR_MISSING / MBH4-STAIR-003 with the attempt diagnostics above.`);
    }
  }

  // ---------- Elevator shaft record (explicit geometry) ----------
  const elevators: Elevator[] = [];
  if (elevatorRequested) {
    const hall = finalSpaces.find(s => s.type === 'elevator-hall') ?? null;
    const anchor = coreAnchors.get('elevator-hall');
    if (hall) {
      const landing = elevatorLandingSide(hall.rect, finalSpaces);
      // Keep the anchor's door side when this floor still lands there, so the
      // shaft, clear zone and cabin are identical on every floor.
      let side: ElevatorDoorSide | null = null;
      if (anchor && cellFitsShaft(hall.rect, anchor.corridorSide)) side = anchor.corridorSide;
      else if (landing) side = landing.side;
      if (side) {
        elevators.push(buildElevator({ hall, doorSide: side, level }));
      } else {
        explanations.push(`Level ${level}: elevator-hall ${hall.rect.w.toFixed(2)}×${hall.rect.h.toFixed(2)} m cannot host the shaft in any landing orientation — no elevator emitted; ELEV_SHAFT_MISSING flags this floor.`);
      }
    } else {
      explanations.push(`Level ${level}: elevator shaft requested but no elevator-hall cell exists on this floor — ELEV_SHAFT_MISSING flags it (never dropped silently).`);
    }
  }

  const floor: Floor = {
    level, floorHeight: DEFAULT_FLOOR_HEIGHT,
    elevation: level * DEFAULT_FLOOR_HEIGHT,
    footprint: buildableRect,
    accessSide: input.site.accessSide,
    spaces: finalSpaces, walls, openings: [],
    stairs, elevators, furniture: [] as Furniture[], parkingStalls, parkingArea,
    parkingRequested: parkingRequested > 0 ? parkingRequested : undefined,
    ...(elevatorRequested ? { elevatorRequested: true } : {}),
  };
  (floor as any).siteBoundary = siteBoundary;
  (floor as any).buildableBoundary = buildableBoundary;
  (floor as any).buildableRects = buildableRects;
  (floor as any).siteShape = input.site.shape;
  (floor as any).assignedProgram = assignedProgram;

  // Phase 5.2: stage 3b runs only when opted in; the omitted/false path makes the
  // exact legacy two-argument call so output stays byte-identical.
  const { openings } = programmeDoorCompletion
    ? placeOpenings(floor, input.site.accessSide, { programmeDoorRequirements: programmeDoorRequirements(specs) })
    : placeOpenings(floor, input.site.accessSide);
  floor.openings = openings;

  // Phase 18: furniture is placed AFTER the openings exist so pieces can avoid
  // door swing sectors (same exact sector geometry the validators check). The
  // former order placed furniture blind, then flagged it blocking its own door.
  floor.furniture = placeFurniture(finalSpaces, openings);

  for (const w of floor.walls) {
    for (const id of w.spaceIds) {
      if (!id) continue;
      const sp = floor.spaces.find(s => s.id === id);
      if (!sp) continue;
      if (!sp.wallIds.includes(w.id)) sp.wallIds.push(w.id);
      if (w.kind === 'exterior') sp.hasExteriorWall = true;
      for (const oid of w.spaceIds) {
        if (oid && oid !== id && !sp.adjacentSpaceIds.includes(oid)) sp.adjacentSpaceIds.push(oid);
      }
    }
  }
  for (const o of floor.openings) {
    const w = floor.walls.find(w => w.id === o.wallId);
    if (!w) continue;
    for (const id of w.spaceIds) {
      if (!id) continue;
      const sp = floor.spaces.find(s => s.id === id);
      if (sp && !sp.openingIds.includes(o.id)) sp.openingIds.push(o.id);
    }
  }

  if (level === 0) explanations.push(`Entrance placed on the ${access} facade — site shape ${input.site.shape}.`);
  explanations.push(`Furniture footprints placed: ${floor.furniture.length}. Phase 11 polygon canonical, rect compatibility, shapeType rectangle default, editing/locking foundation.`);
  // P17-C: compact the declared floor envelope to the actually-placed geometry.
  // The footprint used to stay the full buildable rect, leaving program-sized
  // interiors counted as built (the P17-A residual-void defect). Rooms, cores,
  // parking and walls are untouched — only the declared envelope shrinks to
  // honestly contain them; the fallback keeps the original envelope when the
  // shrink is unsafe. Site/buildable authority and per-floor cores unchanged.
  {
    const before = floor.footprint;
    if (applyFloorCompaction(floor)) {
      const a = floor.footprint;
      explanations.push(`Envelope compacted to placed geometry: ${a.w.toFixed(2)}x${a.h.toFixed(2)} m (was ${before.w.toFixed(2)}x${before.h.toFixed(2)} m) — P17-C.`);
    }
  }
  return floor;
}

function placeSpacesAcrossRects(
  buildableRects: Rect[],
  buildableBoundary: Polygon,
  specs: PlacedSpec[],
  strategy: CandidateStrategy,
  access: AccessSide,
  mkSpace: (type: Space['type'], r: Rect, label: string, id: string, zone: string) => Space
): { spaces: Space[]; corridors: Space[]; explanation: string[] } {
  const explanation: string[] = [];
  const byZone: Record<string, PlacedSpec[]> = { public: [], 'semi-private': [], private: [], service: [], circulation: [] };
  for (const s of specs) {
    let zone: string;
    switch (s.type) {
      case 'entrance': case 'foyer': case 'living': case 'guest-room': case 'guest-wc': case 'yard': case 'balcony':
        zone = 'public'; break;
      case 'dining': case 'family-room':
        zone = 'semi-private'; break;
      case 'kitchen': case 'storage': case 'utility': case 'parking':
        zone = 'service'; break;
      case 'corridor': case 'stair-hall': case 'elevator-hall':
        zone = 'circulation'; break;
      case 'bedroom': case 'master-bedroom': case 'bathroom': case 'master-bathroom':
        zone = 'private'; break;
      default:
        zone = 'service';
    }
    byZone[zone].push(s);
  }
  const corridors = byZone.circulation.filter(s => s.type === 'corridor');
  const frontSpecs = [...byZone.public, ...byZone['semi-private'], ...byZone.service.filter(s => s.type !== 'stair-hall'), ...corridors.slice(0, Math.ceil(corridors.length / 2))];
  const rearSpecs = [...byZone.private, ...byZone.circulation.filter(s => s.type !== 'corridor'), ...corridors.slice(Math.ceil(corridors.length / 2))];

  // Phase 15 M6 — REGION PLANNER for L-shape / orthogonal-polygon sites.
  // The previous behavior guessed "public on min-y rect, private on the other"
  // (wrong for side-by-side decompositions, capacity-blind everywhere) on ONE
  // arbitrary scanline decomposition. The generalized rule treats the cut itself
  // as a decision: enumerate the bounded set of guillotine rectangle partitions
  // of the actual buildable polygon, order the rects along their contact graph
  // from the street-facing rect, split them into a front (entry/public) prefix
  // and a rear (private/stair) suffix, and accept only splits where the REAL M4
  // band model (solveRow/solveCol — the same capacity math the rectangle path
  // runs) can host each group at contract dimensions. Cross-rect spine contact
  // falls out of the placer's corridor convention plus M5's hall-bridge pass on
  // the welded cut line. No valid partition ⇒ the program genuinely cannot live
  // across these regions: proportional tiling runs and the honest gates report.
  const cellsFor = (list: PlacedSpec[]): BandCellDemand[] =>
    list.map(s => ({
      type: s.type,
      minWidth: s.minWidth ?? 2.0,
      minHeight: s.minLength ?? s.minWidth ?? 2.0,
      minArea: Math.max(s.minArea ?? 6, 0.25),
      target: Math.max(s.targetArea ?? 0, s.minArea ?? 6, 0.25),
    }));
  const HABIT_TYPES = new Set(['living', 'dining', 'bedroom', 'master-bedroom', 'guest-room', 'family-room', 'kitchen', 'study', 'storage', 'utility', 'bathroom', 'master-bathroom', 'guest-wc', 'walk-in', 'laundry', 'entrance', 'foyer']);
  const hostFit = (r: Rect, list: PlacedSpec[]): { slack: number; worstAspect: number } | null => {
    if (list.length === 0) return { slack: 0.6, worstAspect: 1 };
    // Prefer the mode whose cells keep the better proportions — a band can be
    // "hostable" in both modes yet produce 1:4 ribbons in one of them. The aspect
    // is measured over ROOM cells only (circulation bands are legitimately 1:4).
    let bestFit: { slack: number; worstAspect: number } | null = null;
    for (const mode of ['row', 'col'] as const) {
      const sol = mode === 'row' ? solveRow(r.w, r.h, cellsFor(list)) : solveCol(r.w, r.h, cellsFor(list));
      if (!sol) continue;
      let worst = 1;
      for (let ci = 0; ci < sol.cells.length && ci < list.length; ci++) {
        if (!HABIT_TYPES.has(list[ci].type)) continue;
        const c = sol.cells[ci];
        const a = Math.max(c.flow, c.cross) / Math.max(0.5, Math.min(c.flow, c.cross));
        if (a > worst) worst = a;
      }
      const fit = { slack: (rArea(r) - sol.usedArea) / Math.max(rArea(r), 1), worstAspect: worst };
      if (!bestFit || fit.worstAspect < bestFit.worstAspect - 1e-9
        || (Math.abs(fit.worstAspect - bestFit.worstAspect) < 1e-9 && fit.slack > bestFit.slack)) bestFit = fit;
    }
    return bestFit;
  };
  const hostSlack = (r: Rect, list: PlacedSpec[]): number => hostFit(r, list)?.slack ?? -1;
  const faceDist = (r: Rect): number => {
    switch (access) {
      case 'south': return r.y;
      case 'north': return -(r.y + r.h);
      case 'west': return r.x;
      case 'east': return -(r.x + r.w);
    }
  };
  const orderContact = (rects: Rect[]): Rect[] => {
    const pool = [...rects].sort((a, b) => faceDist(a) - faceDist(b) || rArea(b) - rArea(a) || a.x - b.x);
    const ordered: Rect[] = [];
    const inList = new Set<Rect>();
    const frontier: Rect[] = [pool.shift()!];
    ordered.push(frontier[0]); inList.add(frontier[0]);
    while (frontier.length) {
      const cur = frontier.shift()!;
      const nbrs = pool.filter(r => !inList.has(r) && contactLen(cur, r) >= 1.2)
        .sort((a, b) => faceDist(a) - faceDist(b) || rArea(b) - rArea(a));
      for (const n of nbrs) { inList.add(n); ordered.push(n); frontier.push(n); }
    }
    for (const r of pool) if (!inList.has(r)) ordered.push(r);
    return ordered;
  };
  const greedyChunks = (rects: Rect[], list: PlacedSpec[]): PlacedSpec[][] | null => {
    // Contiguous chunks: feed each rect in contact order while its band model hosts
    // the accumulated rooms; overflow continues into the next rect of the group.
    const chunks: PlacedSpec[][] = rects.map(() => []);
    let ri = 0;
    for (const spec of list) {
      if (ri >= rects.length) return null;
      const tryWith = [...chunks[ri], spec];
      if (hostSlack(rects[ri], tryWith) >= -0.02) { chunks[ri] = tryWith; continue; }
      ri++;
      if (ri >= rects.length) return null;
      if (hostSlack(rects[ri], [spec]) < -0.02) return null;
      chunks[ri] = [spec];
    }
    return chunks;
  };

  const partitions: Rect[][] = [];
  if (buildableBoundary.length > 4) partitions.push(...rectPartitions(buildableBoundary));
  if (buildableRects.length >= 2) partitions.push(buildableRects);

  const rectOf = (r: Rect) => r;
  const dedup2 = (rs: Rect[]): string => rs.map(r => `${r.x.toFixed(2)},${r.y.toFixed(2)}x${r.w.toFixed(2)}x${r.h.toFixed(2)}`).join('|');
  type Candidate = { rects: Rect[]; groups: PlacedSpec[][]; frontCount: number; score: number; note: string };
  const candidates: Candidate[] = [];
  {
    const seenCuts = new Set<string>();
    for (const part of partitions) {
      if (part.length < 2) continue;
      if (!contactConnected(part, 1.0)) continue;
      const ordered = orderContact(part.map(rectOf));
      for (let cut = 1; cut < ordered.length; cut++) {
        const prefix = ordered.slice(0, cut);
        const suffix = ordered.slice(cut);
        const frontChunks = greedyChunks(prefix, frontSpecs);
        const rearChunks = greedyChunks(suffix, rearSpecs);
        if (!frontChunks || !rearChunks) continue;
        const groups = [...frontChunks, ...rearChunks];
        let minSlack = Infinity;
        let maxAspect = 0;
        for (let i = 0; i < ordered.length; i++) {
          const fit = hostFit(ordered[i], groups[i]);
          if (!fit || fit.slack < -0.02) { minSlack = -1; break; }
          minSlack = Math.min(minSlack, fit.slack);
          maxAspect = Math.max(maxAspect, fit.worstAspect);
        }
        if (!isFinite(minSlack) || minSlack < 0) continue;
        const key = dedup2(ordered) + '@' + cut;
        if (seenCuts.has(key)) continue;
        seenCuts.add(key);
        // Rank on model quality (habitable proportions + host slack) to decide which
        // candidate to TRY first — never as the acceptance criterion itself.
        const score = -maxAspect + 0.15 * minSlack;
        candidates.push({ rects: ordered, groups, frontCount: prefix.length, score, note: `${prefix.length}+${suffix.length} cut of ${part.length}-rect partition (model aspect ${maxAspect.toFixed(2)}, slack ${(minSlack * 100).toFixed(0)}%)` });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.rects.length - b.rects.length || dedup2(a.rects).localeCompare(dedup2(b.rects)));

  const rectCovers = (outer: Rect, inner: Rect): boolean =>
    inner.x >= outer.x - 0.02 && inner.y >= outer.y - 0.02 &&
    inner.x + inner.w <= outer.x + outer.w + 0.02 && inner.y + inner.h <= outer.y + outer.h + 0.02;

  // Phase 15 M6: the band model decides candidate ORDER; acceptance is the placer's
  // own verdict. A rectangle "hosts" the rooms it can actually paint in full,
  // containing every result inside itself — entry galleries, band composition and
  // all. Chunking therefore walks the placer directly: give the region its maximum
  // prefix that fully places, overflow the rest to the next region of the group.
  // Bounded and deterministic: per region at most |list| placer runs with early
  // accept, candidates tried in model-quality order.
  const placeFull = (rect: Rect, list: PlacedSpec[]) => {
    if (list.length === 0) return { ok: true as const, res: null as null | ReturnType<typeof placeSpaces> };
    const res = placeSpaces(rect, list, strategy, access, mkSpace);
    // Circulation specs (corridor/stair-hall/elevator-hall) are satisfied type-wise by
    // generated flow corridors — the band synthesizes a spine, and the M6 row re-tile
    // emits corridor cells into corridors[] (circulation coverage is a TYPE property of
    // the floor plan, exactly like the program-completeness gate checks it).
    const got = new Set(res.spaces.map(s => s.id));
    const typeCovered = (t: string) =>
      res.corridors.some(cs => cs.type === t) || res.spaces.some(s => s.type === t);
    const CIRC_TYPES = new Set(['corridor', 'stair-hall', 'elevator-hall']);
    if (list.some(spec => !got.has(spec.placedId) && !(CIRC_TYPES.has(spec.type) && typeCovered(spec.type)))) {
      return { ok: false as const, res };
    }
    if (res.spaces.some(s => !rectCovers(rect, s.rect))) return { ok: false as const, res };
    return { ok: true as const, res };
  };
  type PlaceRes = ReturnType<typeof placeSpaces>;
  const chunkByPlacer = (rects: Rect[], list: PlacedSpec[]): { chunks: PlacedSpec[][]; results: (PlaceRes | null)[]; why?: string } | null => {
    const chunks: PlacedSpec[][] = rects.map(() => []);
    const results: (ReturnType<typeof placeSpaces> | null)[] = rects.map(() => null);
    let rest = list;
    const fails: string[] = [];
    for (let ri = 0; ri < rects.length; ri++) {
      if (rest.length === 0) break;
      let acc: ReturnType<typeof placeSpaces> | null = null;
      let took = 0;
      for (let k = rest.length; k >= 1; k--) {
        const r = placeFull(rects[ri], rest.slice(0, k));
        if (r.ok && r.res) { acc = r.res; took = k; break; }
        if (r.res && k === rest.length) fails.push(...r.res.explanation.filter(e => /INFEASIBLE|dropped|no |cannot|fallback/i.test(e)).slice(0, 2));
      }
      if (!acc) continue; // region takes nothing this candidate — next rect tries
      chunks[ri] = rest.slice(0, took);
      results[ri] = acc;
      rest = rest.slice(took);
    }
    // A leftover corridor spec is satisfied by any generated flow corridor (circulation is a
    // layout artifact, like the M5 single-rect path's own corridor handling).
    return rest.length === 0 ? { chunks, results } : { chunks: [], results: [], why: `unplaced [${rest.map(s => s.type).join(',')}] — ${fails.slice(0, 3).join(' | ').slice(0, 240)}` };
  };

  const spaces: Space[] = [];
  const corridorSpaces: Space[] = [];

  for (let ci = 0; ci < candidates.length; ci++) {
    const candPlan = candidates[ci];
    const frontTry = chunkByPlacer(candPlan.rects.slice(0, candPlan.frontCount), frontSpecs);
    if (!frontTry || frontTry.why) { explanation.push(`Phase15 M6 region candidate ${ci + 1}/${candidates.length} rejected (${candPlan.note}) — front: ${frontTry?.why ?? 'no prefix fits'}`); continue; }
    const rearTry = chunkByPlacer(candPlan.rects.slice(candPlan.frontCount), rearSpecs);
    if (!rearTry || rearTry.why) { explanation.push(`Phase15 M6 region candidate ${ci + 1}/${candidates.length} rejected (${candPlan.note}) — rear: ${rearTry?.why ?? 'no prefix fits'}`); continue; }
    const results = [...frontTry.results, ...rearTry.results];
    explanation.push(`Phase15 M6 region plan ACCEPTED: ${candPlan.note} — ${frontSpecs.length} front + ${rearSpecs.length} rear rooms all placed and contained (placer verdict)`);
    for (const res of results) {
      if (!res) continue;
      spaces.push(...res.spaces);
      corridorSpaces.push(...res.corridors);
    }
    if (spaces.length === 0) continue;
    return { spaces, corridors: corridorSpaces, explanation };
  }
  if (candidates.length > 0) explanation.push(`Phase15 M6 region planner: all ${candidates.length} split candidate(s) failed the placer-actual check — trying unsplit flow`);
  // Unsplittable polygon families (U/T: public row across the base, bedrooms down
  // the legs interleave the two groups per rect): the entire program flows through
  // ALL contact-ordered rects in one greedy pass. Acceptance stays placer-actual,
  // so this can only ADD layouts that fully place and stay contained.
  {
    const flowRects = orderContact([...buildableRects].sort((a, b) => rArea(b) - rArea(a) || a.y - b.y || a.x - b.x));
    const flowPlan = rectPartitions(buildableBoundary).sort((a, b) => a.length - b.length)[0];
    const rects = (flowPlan && flowPlan.length >= 2 ? orderContact(flowPlan) : flowRects);
    const tryFlow = chunkByPlacer(rects, [...frontSpecs, ...rearSpecs]);
    if (tryFlow && !tryFlow.why && tryFlow.results.some(Boolean)) {
      explanation.push(`Phase15 M6 region plan ACCEPTED (unsplit flow): ${rects.length} rects ${rects.map(r => `${r.w.toFixed(1)}x${r.h.toFixed(1)}`).join(' + ')} — all ${frontSpecs.length + rearSpecs.length} rooms placed by placer verdict`);
      for (const res of tryFlow.results) {
        if (!res) continue;
        spaces.push(...res.spaces);
        corridorSpaces.push(...res.corridors);
      }
      return { spaces, corridors: corridorSpaces, explanation };
    }
    if (tryFlow?.why) explanation.push(`Phase15 M6 unsplit flow rejected: ${tryFlow.why.slice(0, 220)}`);
  }

  explanation.push(`Phase15 M6 region planner: no capacity-valid front/rear split across ${buildableRects.length} decomposition rect(s) — proportional tiling fallback; capacity gates will report honestly`);
  const ordered = orderContact([...buildableRects].sort((a, b) => rArea(b) - rArea(a) || a.y - b.y || a.x - b.x));
  const totalArea = ordered.reduce((sum, r) => sum + rArea(r), 0);
  let specIdx = 0;
  const allSpecs = [...specs].sort((a, b) => (b.priority - a.priority) || (Math.max(b.minArea, b.targetArea) - Math.max(a.minArea, a.targetArea)));
  let fallbackIdx = 0;
  for (const rect of ordered) {
    const fraction = rArea(rect) / totalArea;
    const count = Math.max(1, Math.round(allSpecs.length * fraction));
    const slice = allSpecs.slice(specIdx, specIdx + count);
    specIdx += slice.length;
    if (slice.length === 0) continue;
    const res = placeSpaces(rect, slice, strategy, access, mkSpace);
    spaces.push(...res.spaces);
    corridorSpaces.push(...res.corridors);
    explanation.push(...res.explanation.map(e => `[Rect ${ordered[fallbackIdx].x.toFixed(1)},${ordered[fallbackIdx].y.toFixed(1)}] ${e}`));
    fallbackIdx++;
    if (specIdx >= allSpecs.length) break;
  }
  if (specIdx < allSpecs.length) {
    const remaining = allSpecs.slice(specIdx);
    const largest = ordered[0];
    const res = placeSpaces(largest, remaining, strategy, access, mkSpace);
    spaces.push(...res.spaces);
    corridorSpaces.push(...res.corridors);
  }
  return { spaces, corridors: corridorSpaces, explanation };
}

function findPositionForRect(
  rect: Rect,
  buildableBoundary: Polygon,
  buildableRects: Rect[],
  existingRects: Rect[]
): Rect | null {
  const step = 0.5;
  for (const bRect of buildableRects) {
    for (let y = bRect.y; y <= bRect.y + bRect.h - rect.h + 1e-6; y += step) {
      for (let x = bRect.x; x <= bRect.x + bRect.w - rect.w + 1e-6; x += step) {
        const candidate: Rect = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, w: rect.w, h: rect.h };
        if (!rectInsidePolygon(candidate, buildableBoundary, 1e-3)) continue;
        let overlaps = false;
        for (const ex of existingRects) {
          if (rIntersects(candidate, ex, 1e-3)) {
            const ow = Math.min(candidate.x + candidate.w, ex.x + ex.w) - Math.max(candidate.x, ex.x);
            const oh = Math.min(candidate.y + candidate.h, ex.y + ex.h) - Math.max(candidate.y, ex.y);
            if (ow > 0.05 && oh > 0.05) { overlaps = true; break; }
          }
        }
        if (!overlaps) return candidate;
      }
    }
  }
  return null;
}

function repairSpacesToBuildable(
  spaces: Space[],
  buildableBoundary: Polygon,
  buildableRects: Rect[],
  buildableRect: Rect
): { spaces: Space[]; movedCount: number } {
  let movedCount = 0;
  const keptRects: Rect[] = [];
  const result: Space[] = [];

  for (const s of spaces) {
    if (rectInsidePolygon(s.rect, buildableBoundary, 1e-3)) {
      result.push(s);
      keptRects.push(s.rect);
    }
  }
  for (const s of spaces) {
    if (result.includes(s)) continue;
    const repaired = findPositionForRect(s.rect, buildableBoundary, buildableRects, keptRects);
    if (repaired) {
      s.rect = repaired;
      s.polygon = createRectangleRoomPolygon(repaired);
      s.area = polygonArea(s.polygon);
      result.push(s);
      keptRects.push(repaired);
      movedCount++;
    } else {
      result.push(s);
      keptRects.push(s.rect);
    }
  }
  return { spaces: result, movedCount };
}

/** Rects touch when they overlap OR abut (shared edge) within `e`. */
function rectsTouchOrAbut(a: Rect, b: Rect, e: number): boolean {
  return (
    Math.min(a.x + a.w, b.x + b.w) + e > Math.max(a.x, b.x) &&
    Math.min(a.y + a.h, b.y + b.h) + e > Math.max(a.y, b.y)
  );
}

/**
 * P46 — a corridor's extent follows the geometry it actually serves.
 *
 * The placer emits its spine across the whole band (placer.ts:
 * `corridors.push({ x: footprint.x, y: cy, w: footprint.w, h: CORRIDOR_W })`),
 * which is right whenever rooms line the spine for its full length. When the
 * served rooms stop short of the band end — an upper floor whose bedrooms end
 * before the site's east line, say — the spine keeps a tail that touches no
 * room and no other circulation space. That tail is dead circulation area, and
 * because P17-C declares the floor envelope as the bounding box of the placed
 * geometry, the tail also drags the envelope outward, so the empty corner it
 * covers gets reported as inside-the-building residual.
 *
 * This pass re-derives each corridor's extent ALONG ITS LONG AXIS from the
 * spaces it genuinely serves, using only the placer's existing rect/polygon
 * conventions:
 *   - a space is served when it touches one of the corridor's two long faces
 *     (north/south for a horizontal spine, east/west for a vertical one) and
 *     overlaps the corridor along that axis; its contact interval is kept;
 *   - a space touching a corridor END face pins that end, because it is reached
 *     through the end — trimming there would disconnect it;
 *   - the new extent is the union of those intervals, clamped to the original
 *     and never shorter than the corridor's own cross dimension.
 *
 * Nothing is site-specific: the result is a pure function of the placed
 * geometry, so a fully-lined spine is left byte-identical and a tail of any
 * length is handled the same way. The cross axis (corridor width) is never
 * touched, so CORRIDOR_MIN_WIDTH semantics are unaffected.
 *
 * Safety: the trim is applied only where no space touches the removed area, and
 * it is REVERTED for that corridor if the set of spaces touching it would
 * shrink — an honest fallback rather than a silent connectivity change.
 * Deterministic: arithmetic over `spaces` in array order, no iteration order or
 * time dependence.
 *
 * @returns one explanation line per trimmed corridor.
 */
function trimCorridorsToServedExtent(spaces: Space[]): string[] {
  const eps = 0.02;
  const notes: string[] = [];
  for (const c of spaces) {
    if (c.type !== 'corridor') continue;
    const r = c.rect;
    const horizontal = r.w >= r.h; // the long axis is the trim axis
    const cLo = horizontal ? r.x : r.y;
    const cHi = horizontal ? r.x + r.w : r.y + r.h;
    const cross = horizontal ? r.h : r.w;
    /** Position of a rect's low/high edge on the trim (long) axis. */
    const lo = (s: Rect) => (horizontal ? s.x : s.y);
    const hi = (s: Rect) => (horizontal ? s.x + s.w : s.y + s.h);
    /** Position of a rect's low/high edge on the CROSS axis — the two long faces. */
    const crossLoEdge = (s: Rect) => (horizontal ? s.y : s.x);
    const crossHiEdge = (s: Rect) => (horizontal ? s.y + s.h : s.x + s.w);
    const cCrossLo = horizontal ? r.y : r.x;
    const cCrossHi = horizontal ? r.y + r.h : r.x + r.w;
    /** Overlap with the corridor on the CROSS axis. */
    const crossOverlap = (s: Rect) => (horizontal
      ? Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y)
      : Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x));

    let needLo = Infinity;
    let needHi = -Infinity;
    let contacts = 0;
    let pinLo = false;
    let pinHi = false;
    for (const s of spaces) {
      if (s === c) continue;
      const oLo = Math.max(cLo, lo(s.rect));
      const oHi = Math.min(cHi, hi(s.rect));
      if (oHi - oLo <= eps) {
        // No overlap along the long axis — this can only be an END contact.
        if (crossOverlap(s.rect) > eps) {
          if (Math.abs(hi(s.rect) - cLo) < eps) pinLo = true;
          if (Math.abs(lo(s.rect) - cHi) < eps) pinHi = true;
        }
        continue;
      }
      // Overlaps along the long axis: served only if it touches a long face,
      // i.e. it sits directly against the corridor's cross-axis boundary.
      const touchesHiFace = Math.abs(crossLoEdge(s.rect) - cCrossHi) < eps;
      const touchesLoFace = Math.abs(crossHiEdge(s.rect) - cCrossLo) < eps;
      if (!touchesHiFace && !touchesLoFace) continue;
      contacts++;
      needLo = Math.min(needLo, oLo);
      needHi = Math.max(needHi, oHi);
    }
    if (contacts === 0) continue; // nothing is known to be served — leave as generated
    if (pinLo) needLo = cLo;
    if (pinHi) needHi = cHi;
    const newLo = Math.max(needLo, cLo);
    const newHi = Math.min(needHi, cHi);
    const cutLo = newLo - cLo;
    const cutHi = cHi - newHi;
    if (cutLo <= eps && cutHi <= eps) continue; // already tight — no tail
    if (newHi - newLo < cross - 1e-6) continue; // never shorter than its own width

    const before = spaces.filter(s => s !== c && rectsTouchOrAbut(c.rect, s.rect, eps)).map(s => s.id);
    const trimmed: Rect = horizontal
      ? { x: newLo, y: r.y, w: newHi - newLo, h: r.h }
      : { x: r.x, y: newLo, w: r.w, h: newHi - newLo };
    const after = spaces.filter(s => s !== c && rectsTouchOrAbut(trimmed, s.rect, eps)).map(s => s.id);
    const lost = before.filter(id => !after.includes(id));
    if (lost.length > 0) {
      notes.push(`Corridor "${c.label}" trim SKIPPED — would drop contact with ${lost.join(', ')} (connectivity preserved as generated).`);
      continue;
    }
    const prevArea = c.area;
    c.rect = trimmed;
    c.polygon = createRectangleRoomPolygon(trimmed);
    c.area = polygonArea(c.polygon);
    notes.push(`Corridor "${c.label}" extent trimmed to the served boundary: ${horizontal ? `${r.w.toFixed(2)}→${trimmed.w.toFixed(2)} m long` : `${r.h.toFixed(2)}→${trimmed.h.toFixed(2)} m long`} (removed ${cutLo.toFixed(2)} m + ${cutHi.toFixed(2)} m of unserved tail, ${(prevArea - c.area).toFixed(2)} m²) — P46.`);
  }
  return notes;
}

function snapCorridorsToRoomsSiteAware(
  spaces: Space[],
  buildableBoundary: Polygon,
  buildableRect: Rect,
  buildableRects: Rect[]
) {
  const eps = 0.02;
  const corridors = spaces.filter(s => s.type === 'corridor');
  for (const c of corridors) {
    const edges = {
      south: c.rect.y, north: c.rect.y + c.rect.h, west: c.rect.x, east: c.rect.x + c.rect.w,
    };
    for (const s of spaces) {
      if (s === c) continue;
      if (Math.abs(s.rect.y - edges.north) < eps) { s.rect.y = edges.north; }
      if (Math.abs(s.rect.y + s.rect.h - edges.south) < eps) { s.rect.y = edges.south - s.rect.h; }
      if (Math.abs(s.rect.x - edges.east) < eps) { s.rect.x = edges.east; }
      if (Math.abs(s.rect.x + s.rect.w - edges.west) < eps) { s.rect.x = edges.west - s.rect.w; }
      s.polygon = createRectangleRoomPolygon(s.rect);
      s.area = polygonArea(s.polygon);
    }
  }
  const fx0 = buildableRect.x, fy0 = buildableRect.y;
  const fx1 = buildableRect.x + buildableRect.w;
  const fy1 = buildableRect.y + buildableRect.h;
  for (const s of spaces) {
    const minW = s.minWidth ?? 0.9;
    const minH = s.minLength ?? s.minWidth ?? 0.9;
    if (s.rect.x < fx0) {
      const over = fx0 - s.rect.x;
      s.rect.x = fx0;
      const newW = s.rect.w - over;
      if (newW >= minW - 1e-6) s.rect.w = Math.max(0.01, newW);
      // else preserve min and allow GEO outside
    }
    if (s.rect.y < fy0) {
      const over = fy0 - s.rect.y;
      s.rect.y = fy0;
      const newH = s.rect.h - over;
      if (newH >= minH - 1e-6) s.rect.h = Math.max(0.01, newH);
    }
    if (s.rect.x + s.rect.w > fx1) {
      const maxW = fx1 - s.rect.x;
      if (maxW >= minW - 1e-6) s.rect.w = Math.max(0.01, maxW);
    }
    if (s.rect.y + s.rect.h > fy1) {
      const maxH = fy1 - s.rect.y;
      if (maxH >= minH - 1e-6) s.rect.h = Math.max(0.01, maxH);
    }
  }
  for (const s of spaces) {
    if (!rectInsidePolygon(s.rect, buildableBoundary, 1e-3)) {
      const others = spaces.filter(o => o !== s).map(o => o.rect);
      const repaired = findPositionForRect(s.rect, buildableBoundary, buildableRects, others);
      if (repaired) {
        s.rect = repaired;
        s.polygon = createRectangleRoomPolygon(repaired);
        s.area = polygonArea(s.polygon);
      }
    }
  }
  // Phase 15 M6: WELDED GRID SNAP. Rounding each rect's four fields independently
  // created 0.01 m seams between stacked band rooms (living top 7.80 vs dining
  // bottom 7.81). The wall scanline then saw two one-sided exterior walls instead
  // of ONE interior partition — and M5's hall-bridge pass had no pair-wall to
  // bridge on, isolating entire rear wings of narrow plans. Cluster all vertical
  // and horizontal edges within the weld epsilon and snap a touching pair to one
  // canonical coordinate, so shared edges become exact and wall continuity holds
  // for any band or region layout.
  snapSpacesToWeldedGrid(spaces);
}

/** Snap rect edges to clustered canonical coordinates (weld within weldEps). */
export function snapSpacesToWeldedGrid(spaces: Space[], weldEps = 0.03): void {
  const canonical = (vals: number[]): Map<number, number> => {
    const sorted = [...vals].sort((a, b) => a - b);
    const map = new Map<number, number>();
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i];
      if (map.has(v)) continue;
      let j = i;
      let sum = 0;
      let n = 0;
      while (j < sorted.length && sorted[j] - v <= weldEps) { sum += sorted[j]; n++; j++; }
      const c = Math.round((sum / n) * 100) / 100;
      for (let k = i; k < j; k++) map.set(sorted[k], c);
    }
    return map;
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of spaces) { xs.push(s.rect.x, s.rect.x + s.rect.w); ys.push(s.rect.y, s.rect.y + s.rect.h); }
  const cx = canonical(xs);
  const cy = canonical(ys);
  for (const s of spaces) {
    const x0 = cx.get(s.rect.x) ?? Math.round(s.rect.x * 100) / 100;
    const x1 = cx.get(s.rect.x + s.rect.w) ?? Math.round((s.rect.x + s.rect.w) * 100) / 100;
    const y0 = cy.get(s.rect.y) ?? Math.round(s.rect.y * 100) / 100;
    const y1 = cy.get(s.rect.y + s.rect.h) ?? Math.round((s.rect.y + s.rect.h) * 100) / 100;
    s.rect = { x: x0, y: y0, w: Math.max(0.01, x1 - x0), h: Math.max(0.01, y1 - y0) };
    s.polygon = createRectangleRoomPolygon(s.rect);
    s.area = polygonArea(s.polygon);
  }
}

function needStairForFloor(input: ProjectInput, level: number): boolean {
  if (!input.building.hasStair && input.building.floors <= 1) return false;
  return level < Math.max(1, input.building.floors);
}

function privacyOf(t: Space['type']): Space['privacy'] {
  if (['entrance', 'foyer', 'living', 'dining', 'guest-wc', 'guest-room', 'yard', 'balcony'].includes(t)) return 'public';
  if (['kitchen', 'family-room'].includes(t)) return 'semi-private';
  if (['bedroom', 'master-bedroom', 'bathroom', 'master-bathroom'].includes(t)) return 'private';
  return 'service';
}
function orientationOf(t: Space['type']): Space['orientation'] {
  if (t === 'living' || t === 'master-bedroom') return 'south';
  return 'any';
}
function dedup(arr: string[]): string[] { return Array.from(new Set(arr)); }
function zeroMetrics() {
  return { usableAreaRatio: 0, circulationRatio: 0, wastedArea: 0, roomAreaDeviation: 0, adjacencySatisfaction: 0, collisionCount: 0, parkingFeasibility: 0, daylightExposure: 0, orientationSatisfaction: 0, privacySatisfaction: 0, stairFootprintArea: 0, stairFlightCount: 0, constraintViolations: 0 };
}

export const FLOOR_COUNT_MIN = 1;
export const FLOOR_COUNT_MAX = 10;

export function validateInput(input: ProjectInput): void {
  const errs: string[] = [];
  if (!input.site) errs.push('site is required');
  else {
    const shape = (input.site as any).shape ?? 'rectangle';
    if (!['rectangle', 'l-shape', 'polygon'].includes(shape)) errs.push('site.shape must be one of rectangle, l-shape, polygon');
    if (shape === 'rectangle' || shape === 'l-shape') {
      if (!(input.site.width > 2)) errs.push('site.width must be > 2 m');
      if (!(input.site.length > 2)) errs.push('site.length must be > 2 m');
    }
    if (shape === 'polygon') {
      if (input.site.width !== undefined && !(input.site.width > 2)) errs.push('site.width must be > 2 m for polygon bounding hint');
      if (input.site.length !== undefined && !(input.site.length > 2)) errs.push('site.length must be > 2 m for polygon bounding hint');
      const poly = (input.site as any).polygon;
      if (!poly || !poly.vertices) errs.push('site.polygon.vertices required for polygon shape');
      else {
        const verts = poly.vertices;
        if (verts.length < 3) errs.push('polygon must have at least 3 vertices');
        if (verts.length > 8) errs.push(`polygon exceeds maximum vertices 8, got ${verts.length}`);
        for (const v of verts) {
          if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) errs.push('polygon vertex must be finite');
        }
        try {
          const polyPts = verts.map((v: any) => ({ x: v.x, y: v.y }));
          if (hasDuplicateConsecutiveVertices(polyPts)) errs.push('polygon has duplicate consecutive vertices');
          if (hasZeroLengthEdges(polyPts)) errs.push('polygon has zero-length edges');
          const area = Math.abs(polyPts.reduce((acc: number, p: any, i: number) => {
            const p2 = polyPts[(i + 1) % polyPts.length];
            return acc + p.x * p2.y - p2.x * p.y;
          }, 0) / 2);
          if (area < 10) errs.push(`polygon area too small ${area.toFixed(2)} < 10 m²`);
          if (hasSelfIntersection(polyPts)) errs.push('polygon self-intersecting');
          if (!isOrthogonal(polyPts)) errs.push('polygon non-orthogonal — V1 only supports orthogonal (axis-aligned) polygons');
        } catch (e: any) {
          errs.push(`polygon validation error: ${e?.message ?? e}`);
        }
      }
    }
    if (shape === 'l-shape') {
      const ls = (input.site as any).lShape;
      if (!ls) errs.push('site.lShape required for l-shape');
      else {
        if (!(ls.width > 2)) errs.push('lShape.width must be >2');
        if (!(ls.length > 2)) errs.push('lShape.length must be >2');
        if (!(ls.notchWidth > 0)) errs.push('lShape.notchWidth must be >0');
        if (!(ls.notchLength > 0)) errs.push('lShape.notchLength must be >0');
        if (ls.notchWidth >= ls.width) errs.push('lShape.notchWidth must be < width');
        if (ls.notchLength >= ls.length) errs.push('lShape.notchLength must be < length');
        const cornerMap: Record<string, string> = { 'north-east': 'ne', 'north-west': 'nw', 'south-east': 'se', 'south-west': 'sw', 'ne': 'ne', 'nw': 'nw', 'se': 'se', 'sw': 'sw' };
        const normalizedCorner = cornerMap[ls.notchCorner] ?? ls.notchCorner;
        if (!['ne','nw','se','sw'].includes(normalizedCorner)) errs.push('lShape.notchCorner must be ne/nw/se/sw (or north-east etc)');
        else {
          ls.notchCorner = normalizedCorner as any;
        }
        try {
          const poly = createLShapePolygon(ls.width, ls.length, ls.notchWidth, ls.notchLength, ls.notchCorner, 0, 0);
          const v = validateSitePolygon(poly, 8, 10);
          if (!v.valid) errs.push(...v.errors.map(e => `l-shape polygon invalid: ${e}`));
        } catch (e: any) {
          errs.push(`l-shape validation error: ${e?.message ?? e}`);
        }
      }
    }
    if (!['north', 'south', 'east', 'west'].includes(input.site.accessSide)) errs.push('site.accessSide must be one of north/south/east/west');
    if (input.site.parkingLayout && !['perpendicular','parallel','auto'].includes(input.site.parkingLayout)) errs.push('site.parkingLayout must be perpendicular/parallel/auto');
    // v1.0.1 (AGX-03): setbacks are user-defined design inputs measured INWARD
    // from the property line. Negative or non-finite values would push the
    // buildable boundary outside the site (or corrupt it) — reject both the
    // field form (setbackNorth/...) and the legacy object form (setbacks.{n,s,e,w}).
    const sbSite = input.site as any;
    const checkSetback = (name: string, v: unknown) => {
      if (v === undefined || v === null) return;
      if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`site.${name} must be a finite number`);
      else if (v < 0) errs.push(`site.${name} must be >= 0 — setbacks shrink the buildable area inward; negative values would extend it outside the property`);
    };
    checkSetback('setbackNorth', sbSite.setbackNorth);
    checkSetback('setbackSouth', sbSite.setbackSouth);
    checkSetback('setbackEast', sbSite.setbackEast);
    checkSetback('setbackWest', sbSite.setbackWest);
    if (sbSite.setbacks !== undefined && sbSite.setbacks !== null) {
      for (const dir of ['north', 'south', 'east', 'west'] as const) {
        checkSetback(`setbacks.${dir}`, (sbSite.setbacks as Record<string, unknown>)?.[dir]);
      }
    }
  }
  if (!input.building) errs.push('building is required');
  else {
    const floors = input.building.floors;
    if (floors === undefined || floors === null) errs.push('building.floors is required');
    else {
      if (!Number.isFinite(floors)) errs.push('building.floors must be finite number');
      else {
        if (!Number.isInteger(floors)) errs.push(`building.floors must be integer, got ${floors}`);
        if (floors < FLOOR_COUNT_MIN) errs.push(`building.floors must be >= ${FLOOR_COUNT_MIN}, got ${floors}`);
        if (floors > FLOOR_COUNT_MAX) errs.push(`building.floors must be <= ${FLOOR_COUNT_MAX} (technical maximum), got ${floors}`);
      }
    }
    if (!(input.building.bedrooms >= 0)) errs.push('building.bedrooms must be >= 0');
    if (input.building.masterBedrooms > input.building.bedrooms) errs.push('masterBedrooms cannot exceed bedrooms');
    if (input.building.parkingSpaces < 0) errs.push('parkingSpaces must be >= 0');
    // v1.0.1 (AGX-02): multi-floor buildings require vertical circulation.
    // hasStair defaults to TRUE when the caller omitted the field and
    // floors > 1. An explicit false is rejected for floors > 1: V1 generates
    // no elevator cabins, so a stairless multi-floor building would have no
    // vertical circulation at all and could never validate as a usable plan.
    if (input.building.hasStair === undefined) {
      if (Number.isFinite(floors) && floors > 1) input.building.hasStair = true;
    } else if (input.building.hasStair === false && Number.isFinite(floors) && floors > 1) {
      errs.push('building.hasStair must be true for floors > 1 — a stairless multi-floor building has no vertical circulation (V1 generates no elevator cabins)');
    }
    // v1.0.1 (AGX-08): reject unsupported enum values instead of silently
    // treating them as the default program.
    if (input.building.kitchenType !== undefined && !['closed', 'open', 'semi-open'].includes(input.building.kitchenType)) {
      errs.push(`building.kitchenType must be one of closed/open/semi-open, got '${input.building.kitchenType}'`);
    }
    if (input.building.type !== undefined && !['villa', 'apartment', 'apartment-building'].includes(input.building.type)) {
      errs.push(`building.type must be one of villa/apartment/apartment-building, got '${input.building.type}'`);
    }
  }
  // v1.0.1 (AGX-07): seed must be a finite non-negative integer so it can
  // never leak NaN or other non-numeric text into candidate ids and exports.
  if (input.seed !== undefined && input.seed !== null) {
    if (!Number.isFinite(input.seed) || !Number.isInteger(input.seed) || input.seed < 0) {
      errs.push(`seed must be a non-negative integer, got ${input.seed}`);
    }
  }
  if (errs.length) throw new Error('Invalid project input:\\n  - ' + errs.join('\\n  - '));
}
