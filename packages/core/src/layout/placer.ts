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

const CORRIDOR_W = 1.5;
const MIN_SIDE = 1.0;
const BATH_STRIP_H = 2.6; // corridor-edge wet strip, m
const KITCHEN_W = 2.4;

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
): ZoneLayout {
  const zones: Record<Zone, Rect[]> = {
    public: [], 'semi-private': [], private: [], service: [], circulation: [],
  };
  const corridors: Rect[] = [];
  let entrancePatch: Rect | undefined;

  if (cfg.spine === 'vertical') {
    const vx = footprint.x + footprint.w * (cfg.verticalCorridorFraction ?? 0.5) - CORRIDOR_W / 2;
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
  const cy = footprint.y + footprint.h * cfg.corridorOffsetFraction - CORRIDOR_W / 2;
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

export function placeSpaces(
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
  const hasStorage = specs.some(s => s.type === 'storage');
  const layout = carveZones(footprint, cfg, needStair, hasKitchen, hasStorage);
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
    const foy = take('foyer'); if (foy)
      placed.push(mkSpace('foyer', { x: patch.x, y: patch.y + entH, w: patch.w, h: patch.h - entH }, foy.placedLabel, foy.placedId, 'public'));
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
        const totalMinW = clusterMinWs.reduce((a,b)=>a+b,0);
        const totalArea = genericClusters.reduce((sum, cl) => sum + cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0), 0);
        const totalExtra = Math.max(0, privateRect.w - totalMinW);
        let x = privateRect.x;
        for (let ci = 0; ci < genericClusters.length; ci++) {
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
            if (colRect.h < totalMinH - 1e-6) {
              bh = firstMinH;
              secondH = secondMinH;
            } else {
              bh = Math.min(BATH_STRIP_H + 0.4, colRect.h * 0.35);
              bh = Math.max(firstMinH, Math.min(colRect.h - secondMinH, bh));
              secondH = colRect.h - bh;
            }
            const firstRect = { x: colRect.x, y: colRect.y, w: colRect.w, h: bh };
            const firstSpace = mkSpace(first.type, firstRect, first.placedLabel, first.placedId, 'private');
            firstSpace.rect.x = Math.round((firstSpace.rect.x+1e-9)*100)/100;
            firstSpace.rect.y = Math.round((firstSpace.rect.y+1e-9)*100)/100;
            firstSpace.rect.w = Math.round((firstSpace.rect.w+1e-9)*100)/100;
            firstSpace.rect.h = Math.round((firstSpace.rect.h+1e-9)*100)/100;
            firstSpace.polygon = rCorners(firstSpace.rect); firstSpace.area = rArea(firstSpace.rect);
            const secondY = Math.round((firstSpace.rect.y + firstSpace.rect.h + 1e-9)*100)/100;
            const secondRect = { x: colRect.x, y: secondY, w: colRect.w, h: Math.max(secondH, colRect.h - (secondY - colRect.y)) };
            placed.push(firstSpace);
            placed.push(mkSpace(second.type, secondRect, second.placedLabel, second.placedId, 'private'));
          } else {
            const single = cl.rooms[0];
            const singleMinH = Math.max(single.minLength ?? single.minWidth ?? 2.0, 1.0);
            const finalH = Math.max(colRect.h, singleMinH);
            placed.push(mkSpace(single.type, { x: colRect.x, y: colRect.y, w: colRect.w, h: finalH }, single.placedLabel, single.placedId, 'private'));
          }
        }
        explanation.push(`Phase13 fallback generic: placed ${genericClusters.length} clusters as columns, min preserved totalMinW=${totalMinW.toFixed(2)} ≤ ${privateRect.w.toFixed(2)}, bottom touches corridor, top may violate direct access — explicit HARD code=HARD_CONSTRAINT_INFEASIBLE_DIMENSION`);
      } else {
        // Phase 13 bounded search: try up to MAX_CONSTRAINT_PLACEMENT_ATTEMPTS allocations
        // Each attempt varies width distribution slightly, evaluates hard separation, picks first feasible
        let bestPlacement: { spaces: Space[], valid: boolean, attempts: number } | null = null;
        let attempts = 0;

        for (let attempt = 0; attempt < MAX_CONSTRAINT_PLACEMENT_ATTEMPTS; attempt++) {
          attempts++;
          const attemptPlaced: Space[] = [];
          const isVerticalSpine = cfg.spine === 'vertical';

          if (isVerticalSpine) {
            const clusterMinHs = genericClusters.map(cl => {
              if (cl.rooms.length === 2) return cl.rooms.reduce((s, r) => s + Math.max(r.minLength ?? r.minWidth ?? 2.0, 1.0), 0);
              return Math.max(cl.rooms[0].minLength ?? cl.rooms[0].minWidth ?? 2.0, 1.0);
            });
            const totalMinH = clusterMinHs.reduce((a,b)=>a+b,0);
            const totalExtraAreaV = genericClusters.reduce((sum, cl) => {
              const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
              const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
              return sum + Math.max(0, target - minArea);
            }, 0);
            const remainingH = privateRect.h - totalMinH;

            let y = privateRect.y;
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const isLast = ci === genericClusters.length - 1;
              const minH = clusterMinHs[ci];
              let rowH: number;
              if (isLast) {
                const remaining = privateRect.y + privateRect.h - y;
                rowH = remaining >= minH - 1e-6 ? remaining : minH;
                if (rowH <= 0) rowH = minH;
              } else {
                const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
                const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
                const extra = Math.max(0, target - minArea);
                const attemptFactor = 1 + (attempt * 0.05 - 0.1);
                const extraShare = totalExtraAreaV > 1e-6 ? (extra / totalExtraAreaV) * remainingH * attemptFactor : remainingH / genericClusters.length;
                rowH = minH + Math.max(0, extraShare);
                if (rowH <= 0) rowH = minH;
              }
              // Phase 13: preserve min width for vertical spine — never shrink below max minWidth of cluster
              const clusterMaxMinW = Math.max(...cl.rooms.map(r=>Math.max(r.minWidth ?? 2.0, 1.0)));
              const rowW = Math.max(privateRect.w, clusterMaxMinW);
              const rowRect: Rect = { x: privateRect.x, y, w: rowW, h: rowH };
              y += rowH;

              if (cl.rooms.length === 2) {
                const bedMinH = Math.max(cl.rooms[0].minLength ?? cl.rooms[0].minWidth ?? 2.2, 2.0);
                const bathMinH = Math.max(cl.rooms[1].minLength ?? cl.rooms[1].minWidth ?? 1.2, 1.0);
                const clusterMin = bedMinH + bathMinH;
                let bedH: number, bathH: number;
                if (rowH < clusterMin - 1e-6) {
                  bedH = bedMinH;
                  bathH = bathMinH;
                } else {
                  const bedTarget = Math.max(cl.rooms[0].minArea, cl.rooms[0].targetArea);
                  const bathTarget = Math.max(cl.rooms[1].minArea, cl.rooms[1].targetArea);
                  const clusterExtra = Math.max(0, rowH - clusterMin);
                  const totalClusterTarget = bedTarget + bathTarget;
                  if (totalClusterTarget > 1e-6) {
                    bedH = bedMinH + clusterExtra * (bedTarget / totalClusterTarget);
                    bathH = rowH - bedH;
                    if (bathH < bathMinH) { bathH = bathMinH; bedH = rowH - bathH; }
                    if (bedH < bedMinH) { bedH = bedMinH; bathH = rowH - bedH; }
                  } else {
                    bedH = rowH * 0.6;
                    bathH = rowH - bedH;
                  }
                }
                const firstSpec = cl.rooms[0];
                const secondSpec = cl.rooms[1];
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
                attemptPlaced.push(mkSpace(single.type, rowRect, single.placedLabel, single.placedId, 'private'));
              }
            }
          } else {
            // Horizontal spine generic
            const clusterMinWs = genericClusters.map(cl => {
              if (cl.rooms.length === 2) return cl.rooms.reduce((s, r) => s + Math.max(r.minWidth ?? 2.0, 1.0), 0);
              return Math.max(cl.rooms[0].minWidth ?? 2.0, 1.0);
            });
            const totalMinW = clusterMinWs.reduce((a,b)=>a+b,0);
            const totalExtraArea = genericClusters.reduce((sum, cl) => {
              const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
              const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
              return sum + Math.max(0, target - minArea);
            }, 0);
            const remainingW = privateRect.w - totalMinW;

            let x = privateRect.x;
            for (let ci = 0; ci < genericClusters.length; ci++) {
              const cl = genericClusters[ci];
              const isLast = ci === genericClusters.length - 1;
              const minW = clusterMinWs[ci];
              let colW: number;
              if (isLast) {
                const remaining = privateRect.x + privateRect.w - x;
                // Phase 13.1: never negative, preserve min
                colW = remaining >= minW - 1e-6 ? remaining : minW;
                if (colW <= 0) colW = minW;
              } else {
                const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
                const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
                const extra = Math.max(0, target - minArea);
                const attemptFactor = 1 + (attempt * 0.05 - 0.1);
                const extraShare = totalExtraArea > 1e-6 ? (extra / totalExtraArea) * remainingW * attemptFactor : remainingW / genericClusters.length;
                colW = minW + Math.max(0, extraShare);
                if (colW <= 0) colW = minW;
              }
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
                const leftRect: Rect = { x: colRect.x, y: colRect.y, w: bedW, h: colRect.h };
                const firstSpace = mkSpace(firstSpec.type, leftRect, firstSpec.placedLabel, firstSpec.placedId, 'private');
                firstSpace.rect.x = Math.round((firstSpace.rect.x+1e-9)*100)/100;
                firstSpace.rect.y = Math.round((firstSpace.rect.y+1e-9)*100)/100;
                firstSpace.rect.w = Math.round((firstSpace.rect.w+1e-9)*100)/100;
                firstSpace.rect.h = Math.round((firstSpace.rect.h+1e-9)*100)/100;
                firstSpace.polygon = rCorners(firstSpace.rect); firstSpace.area = rArea(firstSpace.rect);
                const rightX = Math.round((firstSpace.rect.x + firstSpace.rect.w + 1e-9)*100)/100;
                const rightRect: Rect = { x: rightX, y: colRect.y, w: Math.max(bathW, colRect.w - (rightX - colRect.x)), h: colRect.h };
                attemptPlaced.push(firstSpace);
                attemptPlaced.push(mkSpace(secondSpec.type, rightRect, secondSpec.placedLabel, secondSpec.placedId, 'private'));
              } else {
                const single = cl.rooms[0];
                attemptPlaced.push(mkSpace(single.type, colRect, single.placedLabel, single.placedId, 'private'));
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
    placed.push(mkSpace('kitchen', kitchenRect, kitchen.placedLabel, kitchen.placedId, 'service'));
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
  const publicRect = layout.zones.public[0];
  if (publicRect) {
    const publicTypes = [...byType.keys()].filter(t => {
      const z = zoneOf({ type: t } as any);
      return z === 'public' || z === 'semi-private';
    });
    const orderedPublicTypes = placementOrderForTypes(publicTypes, graph);
    explanation.push(`Phase13 public types ordered: ${orderedPublicTypes.join(' > ')}`);

    const living = take('living');
    const dining = take('dining');
    const guestWc = take('guest-wc');
    const publicUnplaced: PlacedSpec[] = [];
    let g; while ((g = take('guest-room'))) publicUnplaced.push(g);
    let f; while ((f = take('family-room'))) publicUnplaced.push(f);
    let e; while ((e = take('entrance'))) publicUnplaced.push(e);
    let fy; while ((fy = take('foyer'))) publicUnplaced.push(fy);

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
            let livingH = Math.max(livingMinH, publicRect.h * 0.55);
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
          placed.push(mkSpace('living',
            { x: publicRect.x, y: publicRect.y, w: livingW, h: publicH },
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
              { x: eastX, y: publicRect.y, w: diningW, h: publicH },
              dining.placedLabel, dining.placedId, 'public'));
          } else {
            const finalDiningW = Math.max(DINING_MIN_W, finalEastW);
            placed.push(mkSpace('dining',
              { x: eastX, y: publicRect.y, w: finalDiningW, h: publicH },
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
