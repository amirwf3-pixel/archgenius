/**
 * Phase 3 deterministic constraint-based layout generator.
 *
 * Pipeline:
 *   1. Site analysis → compute buildable footprint from setbacks, place parking.
 *   2. Space program → per-floor SpaceSpec[] (programming/program.ts).
 *   3. Constraint graph → data-driven adjacency/separation/access constraints
 *      (layout/constraints.ts).
 *   4. For each candidate strategy, place spaces via layout/placer.ts:
 *        - reserve circulation spine (horizontal / vertical / L-spur)
 *        - slice each zone among rooms by priority + weighted target area,
 *          recursively splitting long axis of each sub-rectangle.
 *   5. Construct walls (sweep-line merge).
 *   6. Construct circulation graph and place interior doors based on graph
 *      edges (doors module handles the wall-local positioning).
 *   7. Place exterior entrance door on access facade; place windows on
 *      exterior walls of daylight-required rooms.
 *   8. Place minimal furniture footprints (beds, sofas, sanitary, counter)
 *      for usability / clearance QA.
 *   9. Run geometric validation, circulation validation, and regulation rules.
 *  10. Compute transparent metrics; return all candidates. Ranking is
 *      handled in layout/ranking.ts (called by consumer).
 *
 * Strategies:
 *   - area-efficiency        → single horizontal corridor, minimal circulation
 *   - functional-circulation → L-spine (horizontal + south-west entry spur),
 *                              best connectivity
 *   - daylight-orientation   → vertical central corridor, maximises facade
 *                              access for daylight rooms
 *   - alternative-zoning     → L-spine + SW service corner, alternative layout
 */
import type { ProjectInput } from '../model/project.js';
import type { Floor } from '../model/floor.js';
import type { Space, SpaceSpec } from '../model/space.js';
import type { Wall } from '../model/wall.js';
import type { LayoutCandidate, CandidateStrategy, LayoutMetadata } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import { programForFloor, labelFor } from '../programming/program.js';
import { composePacks, computeBuildableArea, runPackRules, runPackRulesOnCandidate } from '../regulations/engine.js';
import { placeParking } from './parking.js';
import { DEFAULT_FLOOR_HEIGHT } from './stairs.js';
import { solveStair } from './stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from '../model/stairs.js';
import { generateWalls } from './walls.js';
import { placeOpenings } from './openings.js';
import { computeMetrics } from '../optimizer/metrics.js';
import { validateLayout } from '../validation/validator.js';
import { placeSpaces, zoneOf, type PlacedSpec } from '../layout/placer.js';
import { sortCandidates } from '../layout/ranking.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from '../layout/constraints.js';
import { placeFurniture } from './furniture.js';
import type { Rect } from '../geometry/rect.js';
import { rInset, rArea, rCorners, rContains } from '../geometry/rect.js';
import { polygonArea } from '../geometry/polygon.js';
import { EPS } from '../units.js';

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

  const seed = input.seed ?? 1;
  const numFloors = Math.max(1, input.building.floors);
  const candidates: LayoutCandidate[] = [];

  for (const strategy of strategies) {
    const explanations: string[] = [];
    const floors: Floor[] = [];
    for (let level = 0; level < numFloors; level++) {
      floors.push(buildFloor(input, footprint, level, numFloors === 1, strategy, explanations));
    }

    explanations.push(`Constraint graph: ${DEFAULT_RESIDENTIAL_CONSTRAINTS.length} relationships loaded.`);
    const meta: LayoutMetadata = { strategy, seed, generatedAt: Date.now(), regulationPacks: packs.map(p => ({ id: p.id, edition: p.edition })) };
    const cand: LayoutCandidate = {
      id: `cand-${strategy}-${seed}`, buildableArea: footprint, floors,
      findings: [...packFindings], valid: false, metrics: zeroMetrics(),
      explanations: dedup(explanations), metadata: meta,
    };
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

  // Deterministic ranking: sort so consumer gets best-first.
  sortCandidates(candidates);
  return candidates;
}

function buildFloor(
  input: ProjectInput,
  footprint: Rect,
  level: number,
  isOnlyFloor: boolean,
  strategy: CandidateStrategy,
  explanations: string[],
): Floor {
  let spaceCounter = 0;
  const nextId = (type: string) => `${type}-${level}-${(spaceCounter++).toString(36).padStart(3, '0')}`;

  // Phase 3: do NOT inset the footprint — use the full buildable rect so
  // walls align with setback lines. The original 5cm inset was a V1 margin
  // that the new placer handles by snapping rooms to corridor/zone
  // boundaries explicitly.
  let rect: Rect = footprint;

  // Parking
  let parkingStalls: any[] = [];
  let parkingArea;
  if (level === 0 && input.building.parkingSpaces > 0) {
    const siteRect: Rect = { x: 0, y: 0, w: input.site.width, h: input.site.length };
    const p = placeParking(siteRect, footprint, input.site.accessSide, input.building.parkingSpaces, level);
    parkingStalls = p.stalls;
    parkingArea = { aisleRect: p.aisle, arrangement: 'perpendicular' as const };
    if (p.fits) explanations.push(`${p.stalls.length} parking stall(s) placed along the ${input.site.accessSide} frontage with a central aisle.`);
    else explanations.push(`Parking fit issue: only ${p.stalls.length}/${input.building.parkingSpaces} stalls fit on the ${input.site.accessSide} frontage.`);
  }

  // Program → PlacedSpec[] with ids and labels.
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

  // The placer wants a mkSpace function.
  const mkSpace = (type: Space['type'], r: Rect, label: string, id: string, zone: string): Space => {
    const poly = rCorners(r);
    const daylight = ['living', 'dining', 'bedroom', 'master-bedroom', 'guest-room', 'family-room', 'kitchen'].includes(type);
    return {
      id, type, label,
      privacy: privacyOf(type),
      zone: zone as Space['zone'],
      orientation: orientationOf(type),
      daylightRequired: daylight,
      rect: r, polygon: poly,
      area: polygonArea(poly),
      targetArea: rArea(r), minArea: 0,
      wallIds: [], openingIds: [], adjacentSpaceIds: [],
      hasExteriorWall: false,
      floor: level,
    };
  };

  // Place rooms and corridors.
  const access = input.site.accessSide as 'north'|'south'|'east'|'west';
  const { spaces: placedRooms, corridors, explanation: placeExpl } =
    placeSpaces(rect, placedSpecs, strategy, access, mkSpace);
  explanations.push(...placeExpl);

  // Convert vertical entry spur into an explicit "entrance" space if the
  // entrance room didn't land in the public zone and a spur exists.
  const spaces: Space[] = [];
  let entrancePlaced = placedRooms.some(r => r.type === 'entrance');
  spaces.push(...placedRooms);
  spaces.push(...corridors);

  // Snap corridors and rooms so that corridor walls exactly align with
  // adjacent rooms (no 1-cm drift from snapAlign causing GEO_OVERLAPPING_WALLS).
  snapCorridorsToRooms(spaces, rect);

  // If entrance was dropped during tight-site fallback, add it as a 1.5m spur
  // on the facade edge inside the foyer or corridor rectangle (so exterior
  // door still has a space to open into).
  if (!entrancePlaced) {
    // Forge an entrance from the south side of whichever corridor or foyer
    // touches the facade.
    const foyer = spaces.find(s => (s.type === 'foyer' || s.type === 'corridor') && s.rect.y <= rect.y + EPS);
    if (foyer) {
      const spurH = Math.min(1.5, foyer.rect.h);
      const entrId = nextId('entrance');
      const entrRect: Rect = { x: foyer.rect.x, y: foyer.rect.y, w: Math.min(1.8, foyer.rect.w), h: spurH };
      spaces.push(mkSpace('entrance', entrRect, 'Entrance', entrId, 'public'));
      // Shrink foyer/corridor northward to make room for entrance.
      foyer.rect = { x: foyer.rect.x, y: foyer.rect.y + spurH, w: foyer.rect.w, h: foyer.rect.h - spurH };
      foyer.polygon = rCorners(foyer.rect);
      foyer.area = rArea(foyer.rect);
      entrancePlaced = true;
      explanations.push('Entrance vestibule carved from corridor/foyer on the access facade.');
    }
  }

  if (!entrancePlaced) {
    // Last resort: a tiny entrance rectangle touching south facade in first public room.
    const pub = spaces.find(s => s.zone === 'public' || s.type === 'living');
    if (pub) {
      const eW = Math.min(1.6, pub.rect.w);
      const eH = Math.min(1.5, pub.rect.h);
      const entrId = nextId('entrance');
      const r: Rect = { x: pub.rect.x, y: pub.rect.y, w: eW, h: eH };
      spaces.push(mkSpace('entrance', r, 'Entrance', entrId, 'public'));
      pub.rect = { x: pub.rect.x, y: pub.rect.y + eH, w: pub.rect.w, h: pub.rect.h - eH };
      pub.polygon = rCorners(pub.rect);
      pub.area = rArea(pub.rect);
      entrancePlaced = true;
    }
  }

  // Identify stair hall for stair model.
  const stairSpace = spaces.find(s => s.type === 'stair-hall') || null;
  const stairRect = stairSpace ? stairSpace.rect : null;

  // Walls
  const walls: Wall[] = generateWalls(spaces, level);
  const furniture = placeFurniture(spaces);

  // Build Stair geometry using the professional stair solver when we have a stair hall.
  const stairs: any[] = [];
  if (stairRect && needStairForFloor(input, level)) {
    // Corridor side: in our placer, corridor runs horizontally above the
    // public band; the stair pocket is placed at the WEST end of the
    // private band, with corridor to its SOUTH. For vertical-spine
    // strategies (daylight-orientation), corridor is the central vertical
    // strip and the stair pocket falls back to the north-side heuristic;
    // treat corridor as 'south' for V1 (the solver will rotate internally
    // if the available rect is taller than wide).
    const corridorSide: 'south'|'north'|'east'|'west' = 'south';
    const cfg = { ...DEFAULT_STAIR_CONFIG, floorHeight: DEFAULT_FLOOR_HEIGHT };
    const sol = solveStair(stairRect, cfg, corridorSide, 'core-main', level);
    if (sol.ok && sol.stair) {
      stairs.push(sol.stair);
      explanations.push(...sol.stair.explanation.map(m => `Stair: ${m}`));
    } else {
      // No feasible multi-flight stair fits in the hall. Emit a straight
      // single-flight fallback (the legacy V1 representation) so that the
      // MBH4-STAIR-003 regulation rule and STAIR_FLIGHT_OVER_MAX_RISERS fire
      // with a clear message rather than producing an empty/zero-riser
      // placeholder. The candidate is still HARD-invalid; the ranking
      // system will demote it.
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
          startPoint: { x: stairRect.x + stairRect.w / 2, y: stairRect.y },
          endPoint: { x: stairRect.x + stairRect.w / 2, y: stairRect.y + (totalRisers - 1) * cfg.minTreadDepth },
          footprint: stairRect,
          treadLines: [],
        }],
        landings: [],
        footprint: stairRect,
        startPoint: { x: stairRect.x + stairRect.w / 2, y: stairRect.y },
        endPoint: { x: stairRect.x + stairRect.w / 2, y: stairRect.y + stairRect.h },
        floor: level,
        explanation: [
          `NO_FEASIBLE_STAIR_CONFIGURATION: available hall ${stairRect.w.toFixed(2)}×${stairRect.h.toFixed(2)} m cannot fit a code-compliant stair. Attempted:`,
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
    footprint: rect, spaces, walls, openings: [],
    stairs, elevators: [], furniture, parkingStalls, parkingArea,
  };

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

  if (level === 0) explanations.push(`Entrance placed on the ${access} facade.`);
  explanations.push(`Furniture footprints placed: ${furniture.length}.`);
  return floor;
}

/** Ensure corridor edges align exactly with adjacent room edges so the
 *  sweep-line wall generator doesn't produce proper X-crossings from tiny
 *  floating-point gaps. After zone placement, room edges may be within
 *  0.01 m of the corridor edge; snap them to the corridor line.
 *
 *  IMPORTANT: corridors MUST be snapped to the same 1 cm grid before this
 *  routine runs. Otherwise raw floating-point corridor edges (e.g. 6.825
 *  from 1.5 + 13.5*0.45 - 0.75) will pull snapped rooms off-grid by up to
 *  5 mm (e.g. dragging room top from 6.83 down to the raw 6.825, pushing
 *  room bottom from 1.500 to 1.495 → GEO_ROOM_OUTSIDE_FOOTPRINT).
 *
 *  After snapping we also clamp every room to the buildable footprint so
 *  that 1 cm rounding does not push a room 5-10 mm outside (e.g. private
 *  band height 6.675 → 6.68 + y 8.33 → top 15.01 > 15.0). */
function snapCorridorsToRooms(spaces: Space[], footprint: Rect) {
  // First pass: snap every space (including corridors) to the 1 cm grid
  // so that all edges are on the same coordinate grid before we snap rooms
  // to corridor edges. This mirrors the snap() in placeSpaces but ensures
  // corridors are also snapped (placeSpaces only snaps placed rooms, not
  // the corridor array which it returns separately).
  for (const s of spaces) {
    s.rect.x = Math.round(s.rect.x * 100) / 100;
    s.rect.y = Math.round(s.rect.y * 100) / 100;
    s.rect.w = Math.round(s.rect.w * 100) / 100;
    s.rect.h = Math.round(s.rect.h * 100) / 100;
    s.polygon = rCorners(s.rect);
    s.area = rArea(s.rect);
  }
  const eps = 0.02;
  const corridors = spaces.filter(s => s.type === 'corridor');
  for (const c of corridors) {
    const edges = {
      south: c.rect.y, north: c.rect.y + c.rect.h, west: c.rect.x, east: c.rect.x + c.rect.w,
    };
    for (const s of spaces) {
      if (s === c) continue;
      // Snap room edges that touch corridor within eps.
      if (Math.abs(s.rect.y - edges.north) < eps) { s.rect.y = edges.north; }
      if (Math.abs(s.rect.y + s.rect.h - edges.south) < eps) { s.rect.y = edges.south - s.rect.h; }
      if (Math.abs(s.rect.x - edges.east) < eps) { s.rect.x = edges.east; }
      if (Math.abs(s.rect.x + s.rect.w - edges.west) < eps) { s.rect.x = edges.west - s.rect.w; }
      s.polygon = rCorners(s.rect);
      s.area = rArea(s.rect);
    }
  }
  // Final clamp to buildable footprint (within 1 mm tolerance). This
  // corrects the 5-10 mm overshoot caused by rounding private-band height
  // up (e.g. 6.675 → 6.68) while the corridor y was rounded up as well.
  const fx0 = footprint.x, fy0 = footprint.y;
  const fx1 = footprint.x + footprint.w;
  const fy1 = footprint.y + footprint.h;
  for (const s of spaces) {
    // Clamp west/south edges.
    if (s.rect.x < fx0) {
      const over = fx0 - s.rect.x;
      s.rect.x = fx0;
      s.rect.w = Math.max(0.01, s.rect.w - over);
    }
    if (s.rect.y < fy0) {
      const over = fy0 - s.rect.y;
      s.rect.y = fy0;
      s.rect.h = Math.max(0.01, s.rect.h - over);
    }
    // Clamp east/north edges by shrinking w/h.
    if (s.rect.x + s.rect.w > fx1) {
      s.rect.w = Math.max(0.01, fx1 - s.rect.x);
    }
    if (s.rect.y + s.rect.h > fy1) {
      s.rect.h = Math.max(0.01, fy1 - s.rect.y);
    }
    // Re-snap to 1 cm after clamp to keep grid coherence.
    s.rect.x = Math.round(s.rect.x * 100) / 100;
    s.rect.y = Math.round(s.rect.y * 100) / 100;
    s.rect.w = Math.round(s.rect.w * 100) / 100;
    s.rect.h = Math.round(s.rect.h * 100) / 100;
    s.polygon = rCorners(s.rect);
    s.area = rArea(s.rect);
  }
}

/** Stairs are placed on every floor except the top one (the top floor's
 *  stair arrives at its level from below, but in V1 the stair HALL room
 *  is reserved on every floor; we populate a stair object on every floor
 *  below the roof so multi-story models show consistent cores). For a
 *  single-story building we only place stairs if the building type
 *  requires it (hasStair flag is preserved for future use). */
function needStairForFloor(input: ProjectInput, level: number): boolean {
  if (!input.building.hasStair && input.building.floors <= 1) return false;
  // Place a stair on every floor from 0..floors-1 (the top floor receives
  // arrivals from below — the stair hall is there in the plan).
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

export function validateInput(input: ProjectInput): void {
  const errs: string[] = [];
  if (!input.site) errs.push('site is required');
  else {
    if (input.site.shape !== 'rectangle') errs.push('V1 only supports rectangular sites');
    if (!(input.site.width > 2)) errs.push('site.width must be > 2 m');
    if (!(input.site.length > 2)) errs.push('site.length must be > 2 m');
    if (!['north', 'south', 'east', 'west'].includes(input.site.accessSide)) errs.push('site.accessSide must be one of north/south/east/west');
  }
  if (!input.building) errs.push('building is required');
  else {
    if (!(input.building.floors >= 1)) errs.push('building.floors must be >= 1');
    if (!(input.building.bedrooms >= 0)) errs.push('building.bedrooms must be >= 0');
    if (input.building.masterBedrooms > input.building.bedrooms) errs.push('masterBedrooms cannot exceed bedrooms');
    if (input.building.parkingSpaces < 0) errs.push('parkingSpaces must be >= 0');
  }
  if (errs.length) throw new Error('Invalid project input:\n  - ' + errs.join('\n  - '));
}
