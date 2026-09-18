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
import type { LayoutCandidate, CandidateStrategy, LayoutMetadata } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import { programForFloor, labelFor } from '../programming/program.js';
import { composePacks, computeBuildableArea, runPackRules, runPackRulesOnCandidate } from '../regulations/engine.js';
import { placeParking, placeParkingSiteAware } from './parking.js';
import { DEFAULT_FLOOR_HEIGHT } from './stairs.js';
import { solveStair } from './stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from '../model/stairs.js';
import { generateWalls } from './walls.js';
import { placeOpenings } from './openings.js';
import { computeMetrics } from '../optimizer/metrics.js';
import { validateLayout } from '../validation/validator.js';
import { placeSpaces, type PlacedSpec } from '../layout/placer.js';
import { sortCandidates } from '../layout/ranking.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from '../layout/constraints.js';
import { placeFurniture } from './furniture.js';
import type { Rect } from '../geometry/rect.js';
import { rArea, rCorners, rIntersects } from '../geometry/rect.js';
import { polygonArea } from '../geometry/polygon.js';
import { EPS } from '../units.js';
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

export const ALL_STRATEGIES: CandidateStrategy[] = [
  'area-efficiency',
  'functional-circulation',
  'daylight-orientation',
  'alternative-zoning',
];

export function generateLayouts(
  input: ProjectInput,
  strategies: CandidateStrategy[] = ['functional-circulation'],
): LayoutCandidate[] {
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
  const candidates: LayoutCandidate[] = [];

  for (const strategy of strategies) {
    const explanations: string[] = [];
    explanations.push(`Site shape ${input.site.shape}, siteArea ${buildableGeom.siteArea.toFixed(1)} m², buildableArea ${buildableGeom.buildableArea.toFixed(1)} m², buildableRects ${buildableGeom.buildableRects.length}, setbacks N=${bfp.setbacks.north} S=${bfp.setbacks.south} E=${bfp.setbacks.east} W=${bfp.setbacks.west} — ${buildableGeom.appliedSetbacks.map(s => `${s.direction}:${s.source}`).join(', ')}`);
    const floors: Floor[] = [];
    for (let level = 0; level < numFloors; level++) {
      floors.push(buildFloorSiteAware(input, buildableGeom, bfp, level, numFloors === 1, strategy, explanations));
    }

    explanations.push(`Constraint graph: ${DEFAULT_RESIDENTIAL_CONSTRAINTS.length} relationships loaded. Phase 11 canonical polygon rooms, parametric constraints, locking, editing foundation.`);
    const meta: LayoutMetadata = { strategy, seed, generatedAt: Date.now(), regulationPacks: packs.map(p => ({ id: p.id, edition: p.edition })) };
    const cand: LayoutCandidate = {
      id: `cand-${strategy}-${seed}`, buildableArea: footprint, floors,
      findings: [...packFindings], valid: false, metrics: zeroMetrics(),
      explanations: dedup(explanations), metadata: meta,
    };
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
    candidates.push(cand);
  }

  sortCandidates(candidates);
  return candidates;
}

function buildFloorSiteAware(
  input: ProjectInput,
  buildableGeom: ReturnType<typeof computeBuildableGeometry>,
  bfp: ReturnType<typeof computeBuildableArea>,
  level: number,
  isOnlyFloor: boolean,
  strategy: CandidateStrategy,
  explanations: string[],
): Floor {
  let spaceCounter = 0;
  const nextId = (type: string) => `${type}-${level}-${(spaceCounter++).toString(36).padStart(3, '0')}`;

  const siteRect: Rect = buildableGeom.siteBoundingRect;
  const buildableRect: Rect = buildableGeom.buildableRect;
  const buildableBoundary = buildableGeom.buildableBoundary;
  const siteBoundary = buildableGeom.siteBoundary;
  const buildableRects = buildableGeom.buildableRects;

  let parkingStalls: any[] = [];
  let parkingArea: any;
  if (level === 0 && input.building.parkingSpaces > 0) {
    const layoutPref = (input.site.parkingLayout ?? 'auto') as any;
    const p = placeParkingSiteAware(
      siteBoundary,
      buildableBoundary,
      buildableRects,
      siteRect,
      buildableRect,
      input.site.accessSide,
      input.building.parkingSpaces,
      level,
      layoutPref
    );
    parkingStalls = p.stalls;
    parkingArea = { aisleRect: p.aisle, arrangement: p.layout ?? 'perpendicular' as const };
    if (p.fits) explanations.push(`${p.stalls.length} parking stall(s) placed (${p.layout}) along the ${input.site.accessSide} frontage — site-aware fit checks.`);
    else explanations.push(`Parking fit issue: only ${p.stalls.length}/${input.building.parkingSpaces} stalls fit — attempts: ${p.attempts?.slice(0,3).join('; ')}`);
    if (p.attempts && p.attempts.length > 0) explanations.push(`Parking attempts: ${p.attempts.slice(0,5).join(' | ')}`);
  }

  const specs = programForFloor(input.building, level, isOnlyFloor);
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

  let placedRooms: Space[] = [];
  let corridors: Space[] = [];
  let placeExpl: string[] = [];

  if (buildableRects.length === 0) {
    explanations.push(`Decomposition failure for ${buildableBoundary.length}-vertex buildable polygon — cannot decompose safely into rectangles (bounded failure, no bbox fallback as canonical). Candidate will be marked SITE_GEOM_INVALID HARD.`);
    const result = placeSpaces(buildableRect, placedSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation.map(e => `[DECOMPOSITION-FAILURE-FALLBACK bounding] ${e}`);
  } else if (buildableRects.length === 1 || input.site.shape === 'rectangle') {
    const result = placeSpaces(buildableRect, placedSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation;
  } else {
    const result = placeSpacesAcrossRects(buildableRects, buildableBoundary, placedSpecs, strategy, access, mkSpace);
    placedRooms = result.spaces;
    corridors = result.corridors;
    placeExpl = result.explanation;
  }
  explanations.push(...placeExpl);

  const spaces: Space[] = [];
  let entrancePlaced = placedRooms.some(r => r.type === 'entrance');
  spaces.push(...placedRooms);
  spaces.push(...corridors);

  const repaired = repairSpacesToBuildable(spaces, buildableBoundary, buildableRects, buildableRect);
  const movedCount = repaired.movedCount;
  if (movedCount > 0) explanations.push(`Site-aware repair: ${movedCount} room(s) moved to fit inside buildable polygon ${input.site.shape} — buildableArea ${buildableGeom.buildableArea.toFixed(1)} m²`);

  snapCorridorsToRoomsSiteAware(repaired.spaces, buildableBoundary, buildableRect, buildableRects);

  if (!entrancePlaced) {
    const foyer = repaired.spaces.find(s => (s.type === 'foyer' || s.type === 'corridor') && s.rect.y <= buildableRect.y + EPS);
    if (foyer) {
      const spurH = Math.min(1.5, foyer.rect.h);
      const entrId = nextId('entrance');
      const entrRect: Rect = { x: foyer.rect.x, y: foyer.rect.y, w: Math.min(1.8, foyer.rect.w), h: spurH };
      if (rectInsidePolygon(entrRect, buildableBoundary, 1e-3)) {
        repaired.spaces.push(mkSpace('entrance', entrRect, 'Entrance', entrId, 'public'));
        // Update foyer rect/polygon canonical
        const newFoyerRect: Rect = { x: foyer.rect.x, y: foyer.rect.y + spurH, w: foyer.rect.w, h: foyer.rect.h - spurH };
        foyer.rect = newFoyerRect;
        foyer.polygon = createRectangleRoomPolygon(newFoyerRect);
        foyer.area = polygonArea(foyer.polygon);
        entrancePlaced = true;
        explanations.push('Entrance vestibule carved from corridor/foyer on the access facade — site-aware.');
      }
    }
  }
  if (!entrancePlaced) {
    const pub = repaired.spaces.find(s => s.zone === 'public' || s.type === 'living');
    if (pub) {
      const eW = Math.min(1.6, pub.rect.w);
      const eH = Math.min(1.5, pub.rect.h);
      const entrId = nextId('entrance');
      const r: Rect = { x: pub.rect.x, y: pub.rect.y, w: eW, h: eH };
      if (rectInsidePolygon(r, buildableBoundary, 1e-3)) {
        repaired.spaces.push(mkSpace('entrance', r, 'Entrance', entrId, 'public'));
        const newPubRect: Rect = { x: pub.rect.x, y: pub.rect.y + eH, w: pub.rect.w, h: pub.rect.h - eH };
        pub.rect = newPubRect;
        pub.polygon = createRectangleRoomPolygon(newPubRect);
        pub.area = polygonArea(pub.polygon);
        entrancePlaced = true;
      }
    }
  }

  const finalSpaces = repaired.spaces;

  const stairSpace = finalSpaces.find(s => s.type === 'stair-hall') || null;
  const stairRect = stairSpace ? stairSpace.rect : null;

  const walls: Wall[] = generateWalls(finalSpaces, level);
  const furniture = placeFurniture(finalSpaces);

  const stairs: any[] = [];
  if (stairRect && needStairForFloor(input, level)) {
    if (!rectInsidePolygon(stairRect, buildableBoundary, 1e-3)) {
      explanations.push(`Stair hall outside buildable polygon — attempting repair for level ${level}`);
      const repairedStairRect = findPositionForRect(stairRect, buildableBoundary, buildableRects, finalSpaces.filter(s => s.type !== 'stair-hall').map(s => s.rect));
      if (repairedStairRect) {
        stairSpace!.rect = repairedStairRect;
        stairSpace!.polygon = createRectangleRoomPolygon(repairedStairRect);
        stairSpace!.area = polygonArea(stairSpace!.polygon);
      }
    }
    const corridorSide: 'south'|'north'|'east'|'west' = 'south';
    const cfg = { ...DEFAULT_STAIR_CONFIG, floorHeight: DEFAULT_FLOOR_HEIGHT };
    const sol = solveStair(stairSpace ? stairSpace.rect : stairRect!, cfg, corridorSide, 'core-main', level);
    if (sol.ok && sol.stair) {
      const stFoot = sol.stair.footprint ?? sol.stair.rect;
      if (stFoot && !rectInsidePolygon(stFoot, buildableBoundary, 1e-3)) {
        explanations.push(`Stair footprint outside buildable — level ${level} — marking invalid`);
        sol.stair.valid = false;
      }
      stairs.push(sol.stair);
      explanations.push(...sol.stair.explanation.map(m => `Stair: ${m}`));
    } else {
      const totalRisers = Math.max(3, Math.ceil(cfg.floorHeight / cfg.maxRiserHeight));
      const riser = cfg.floorHeight / totalRisers;
      const fallback: any = {
        id: `stair-core-main-${level}`, type: 'straight' as const,
        coreId: 'core-main',
        totalRise: cfg.floorHeight,
        totalRisers,
        riserHeight: riser,
        treadDepth: cfg.minTreadDepth,
        width: cfg.minWidth,
        flights: [{
          id: `stair-core-main-${level}-f0`,
          direction: 'north' as const,
          riserCount: totalRisers,
          treadCount: totalRisers - 1,
          riserHeight: riser,
          treadDepth: cfg.minTreadDepth,
          width: cfg.minWidth,
          runLength: (totalRisers - 1) * cfg.minTreadDepth,
          startPoint: { x: stairRect!.x + stairRect!.w / 2, y: stairRect!.y },
          endPoint: { x: stairRect!.x + stairRect!.w / 2, y: stairRect!.y + (totalRisers - 1) * cfg.minTreadDepth },
          footprint: stairRect,
          treadLines: [],
        }],
        landings: [],
        footprint: stairRect,
        startPoint: { x: stairRect!.x + stairRect!.w / 2, y: stairRect!.y },
        endPoint: { x: stairRect!.x + stairRect!.w / 2, y: stairRect!.y + stairRect!.h },
        floor: level,
        explanation: [
          `NO_FEASIBLE_STAIR_CONFIGURATION: available hall ${stairRect!.w.toFixed(2)}×${stairRect!.h.toFixed(2)} m cannot fit a code-compliant stair. Attempted:`,
          ...sol.attempts.map(a => `  ${a.type}: ${a.requiredW.toFixed(2)}×${a.requiredH.toFixed(2)} m — ${a.reason}`),
          'Falling back to single-flight representation; expect MBH4-STAIR-003 HARD violation.',
        ],
        valid: false,
        rect: stairRect,
        flightWidth: cfg.minWidth,
        riser,
        tread: cfg.minTreadDepth,
        riserCount: totalRisers,
        floorHeight: cfg.floorHeight,
      };
      stairs.push(fallback);
      explanations.push(...fallback.explanation.map((m: string) => `Stair: ${m}`));
    }
  }

  const floor: Floor = {
    level, floorHeight: DEFAULT_FLOOR_HEIGHT,
    elevation: level * DEFAULT_FLOOR_HEIGHT,
    footprint: buildableRect,
    spaces: finalSpaces, walls, openings: [],
    stairs, elevators: [], furniture, parkingStalls, parkingArea,
  };
  (floor as any).siteBoundary = siteBoundary;
  (floor as any).buildableBoundary = buildableBoundary;
  (floor as any).buildableRects = buildableRects;
  (floor as any).siteShape = input.site.shape;

  const { openings } = placeOpenings(floor, input.site.accessSide);
  floor.openings = openings;

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
  explanations.push(`Furniture footprints placed: ${furniture.length}. Phase 11 polygon canonical, rect compatibility, shapeType rectangle default, editing/locking foundation.`);
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
  const sortedRects = [...buildableRects].sort((a, b) => rArea(b) - rArea(a) || a.y - b.y || a.x - b.x);
  explanation.push(`Site-aware placement across ${sortedRects.length} buildable rect(s) — areas ${sortedRects.map(r => rArea(r).toFixed(1)).join(', ')} m² — strategy ${strategy}`);

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

  const rectsByY = [...sortedRects].sort((a, b) => a.y - b.y);
  const southRect = rectsByY[0];
  const northRect = rectsByY[rectsByY.length - 1];

  const spaces: Space[] = [];
  const corridors: Space[] = [];

  if (sortedRects.length === 2) {
    const southSpecs = [...byZone.public, ...byZone['semi-private'], ...byZone.service.filter(s => s.type !== 'stair-hall'), ...byZone.circulation.filter(s => s.type === 'corridor').slice(0,1)];
    const northSpecs = [...byZone.private, ...byZone.service.filter(s => s.type === 'stair-hall')];

    if (southSpecs.length > 0) {
      const resSouth = placeSpaces(southRect, southSpecs, strategy, access, mkSpace);
      spaces.push(...resSouth.spaces);
      corridors.push(...resSouth.corridors);
      explanation.push(...resSouth.explanation.map(e => `[South rect] ${e}`));
    }
    if (northSpecs.length > 0) {
      const resNorth = placeSpaces(northRect, northSpecs, strategy, access, mkSpace);
      spaces.push(...resNorth.spaces);
      corridors.push(...resNorth.corridors);
      explanation.push(...resNorth.explanation.map(e => `[North rect] ${e}`));
    }
  } else {
    const totalArea = sortedRects.reduce((sum, r) => sum + rArea(r), 0);
    let specIdx = 0;
    const allSpecs = [...specs].sort((a, b) => (b.priority - a.priority) || (Math.max(b.minArea,b.targetArea) - Math.max(a.minArea,a.targetArea)));
    for (const rect of sortedRects) {
      const fraction = rArea(rect) / totalArea;
      const count = Math.max(1, Math.round(allSpecs.length * fraction));
      const slice = allSpecs.slice(specIdx, specIdx + count);
      specIdx += slice.length;
      if (slice.length === 0) continue;
      const res = placeSpaces(rect, slice, strategy, access, mkSpace);
      spaces.push(...res.spaces);
      corridors.push(...res.corridors);
      explanation.push(...res.explanation.map(e => `[Rect ${rect.x.toFixed(1)},${rect.y.toFixed(1)}] ${e}`));
      if (specIdx >= allSpecs.length) break;
    }
    if (specIdx < allSpecs.length) {
      const remaining = allSpecs.slice(specIdx);
      const largest = sortedRects[0];
      const res = placeSpaces(largest, remaining, strategy, access, mkSpace);
      spaces.push(...res.spaces);
      corridors.push(...res.corridors);
    }
  }

  return { spaces, corridors, explanation };
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

function snapCorridorsToRoomsSiteAware(
  spaces: Space[],
  buildableBoundary: Polygon,
  buildableRect: Rect,
  buildableRects: Rect[]
) {
  for (const s of spaces) {
    s.rect.x = Math.round(s.rect.x * 100) / 100;
    s.rect.y = Math.round(s.rect.y * 100) / 100;
    s.rect.w = Math.round(s.rect.w * 100) / 100;
    s.rect.h = Math.round(s.rect.h * 100) / 100;
    s.polygon = createRectangleRoomPolygon(s.rect);
    s.area = polygonArea(s.polygon);
  }
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
    s.rect.x = Math.round(s.rect.x * 100) / 100;
    s.rect.y = Math.round(s.rect.y * 100) / 100;
    s.rect.w = Math.round(s.rect.w * 100) / 100;
    s.rect.h = Math.round(s.rect.h * 100) / 100;
    s.polygon = createRectangleRoomPolygon(s.rect);
    s.area = polygonArea(s.polygon);
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
  }
  if (errs.length) throw new Error('Invalid project input:\\n  - ' + errs.join('\\n  - '));
}
